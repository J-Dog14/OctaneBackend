"""
OctaneSync Agent
================
Bridges your local Windows data folders to your Railway-hosted Octane Biomech app.

Setup (one-time per machine):
  1. Copy config.example.json -> config.json
  2. Fill in railway_url and agent_token (get the token from Settings -> Sync Agent in the app)
  3. Run: python octane_sync.py  (or double-click OctaneSync.exe)

The agent polls your Railway app every 3 seconds. When the app triggers a run,
the agent uploads the correct folder's files to R2 and notifies Railway to proceed.
All credentials and folder paths are pulled from your Railway Settings — nothing
sensitive is stored locally except the agent token.
"""

import json
import os
import sys
import time
import logging
import threading
from pathlib import Path
from typing import Optional

import boto3
import requests
from botocore.config import Config

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("OctaneSync")

# ── Config loading ────────────────────────────────────────────────────────────

def load_local_config() -> dict:
    """Load the minimal local config (Railway URL + agent token only)."""
    config_path = Path(__file__).parent / "config.json"
    if not config_path.exists():
        log.error("config.json not found. Copy config.example.json -> config.json and fill it in.")
        sys.exit(1)
    with open(config_path) as f:
        cfg = json.load(f)
    required = ["railway_url", "agent_token"]
    for key in required:
        if not cfg.get(key):
            log.error(f"config.json is missing required field: {key}")
            sys.exit(1)
    cfg["railway_url"] = cfg["railway_url"].rstrip("/")
    return cfg


def fetch_remote_config(railway_url: str, agent_token: str) -> Optional[dict]:
    """Fetch R2 credentials + runner paths from the Railway app Settings."""
    try:
        r = requests.get(
            f"{railway_url}/api/sync/config",
            headers={"Authorization": f"Bearer {agent_token}"},
            timeout=10,
        )
        if r.status_code == 401:
            log.error("Agent token rejected. Regenerate it in Settings -> Sync Agent.")
            return None
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        log.warning(f"Could not fetch remote config: {e}")
        return None

# ── File type filtering ───────────────────────────────────────────────────────

# Runners that produce XML output files (V3D exports)
XML_RUNNERS = {"pitching", "hitting", "pro-sup"}

def get_allowed_extensions(runner_id: str) -> set:
    """Return the set of file extensions to upload for this runner."""
    if runner_id in XML_RUNNERS:
        return {".xml"}
    # All other runners use ASCII/text exports
    return {".txt", ".asc", ".csv"}

# ── R2 upload ─────────────────────────────────────────────────────────────────

def build_s3_client(r2_cfg: dict):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{r2_cfg['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=r2_cfg["access_key_id"],
        aws_secret_access_key=r2_cfg["secret_access_key"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_folder_to_r2(folder_path: str, runner_id: str, r2_cfg: dict) -> list:
    """
    Upload files in folder_path to R2, filtered by the runner's expected file types.
    Returns list of R2 object keys.
    Raises on any error.
    """
    folder = Path(folder_path)
    if not folder.exists():
        raise FileNotFoundError(f"Data folder not found: {folder_path}")

    allowed_exts = get_allowed_extensions(runner_id)
    all_files = [f for f in folder.iterdir() if f.is_file()]
    files = [f for f in all_files if f.suffix.lower() in allowed_exts]

    if not files:
        ext_list = ", ".join(sorted(allowed_exts))
        raise ValueError(
            f"No {ext_list} files found in: {folder_path}\n"
            f"  ({len(all_files)} other file(s) present but not the expected type for '{runner_id}')"
        )

    log.info(f"Uploading {len(files)} file(s) from {folder_path}")

    s3 = build_s3_client(r2_cfg)
    bucket = r2_cfg["bucket_name"]
    timestamp = int(time.time() * 1000)
    keys = []

    for file in files:
        key = f"uploads/{runner_id}/{timestamp}/{file.name}"
        content_type = "application/octet-stream"
        # Basic content type detection
        ext = file.suffix.lower()
        if ext in (".txt", ".csv"):
            content_type = "text/plain"
        elif ext == ".xml":
            content_type = "application/xml"
        elif ext == ".json":
            content_type = "application/json"

        with open(file, "rb") as fh:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=fh,
                ContentType=content_type,
            )
        keys.append(key)
        log.info(f"  Uploaded: {file.name}")

    return keys

# ── Polling loop ──────────────────────────────────────────────────────────────

def poll_loop(local_cfg: dict, remote_cfg: dict):
    railway_url = local_cfg["railway_url"]
    agent_token = local_cfg["agent_token"]
    headers = {"Authorization": f"Bearer {agent_token}"}
    r2_cfg = remote_cfg["r2"]
    runner_paths: dict = remote_cfg["runner_paths"]

    log.info("Agent online. Polling for requests...")

    while True:
        try:
            r = requests.get(f"{railway_url}/api/sync/poll", headers=headers, timeout=10)

            if r.status_code == 401:
                log.error("Token rejected mid-session. Exiting.")
                sys.exit(1)

            if not r.ok:
                log.warning(f"Poll returned {r.status_code}")
                time.sleep(3)
                continue

            data = r.json()
            pending = data.get("request")

            if not pending:
                time.sleep(3)
                continue

            request_id = pending["id"]
            runner_id = pending["runnerId"]
            data_path_override = (pending.get("dataPath") or "").strip()
            log.info(f"Received upload request: runner={runner_id} requestId={request_id}")

            # dataPath from the browser takes priority over the configured runner path
            if data_path_override:
                folder_path = data_path_override
                log.info(f"Using per-run path override: {folder_path}")
            else:
                folder_path = runner_paths.get(runner_id, "").strip()

            if not folder_path:
                msg = f"No data directory configured for runner '{runner_id}' in Settings."
                log.error(msg)
                requests.post(
                    f"{railway_url}/api/sync/complete",
                    headers=headers,
                    json={"requestId": request_id, "error": msg},
                    timeout=10,
                )
                time.sleep(3)
                continue

            # Upload files
            try:
                # Re-fetch config in case credentials changed
                fresh_cfg = fetch_remote_config(railway_url, agent_token)
                if fresh_cfg:
                    r2_cfg = fresh_cfg["r2"]
                    runner_paths = fresh_cfg["runner_paths"]

                file_keys = upload_folder_to_r2(folder_path, runner_id, r2_cfg)

                requests.post(
                    f"{railway_url}/api/sync/complete",
                    headers=headers,
                    json={"requestId": request_id, "fileKeys": file_keys},
                    timeout=30,
                )
                log.info(f"Upload complete: {len(file_keys)} file(s) — request fulfilled.")

            except Exception as upload_err:
                msg = str(upload_err)
                log.error(f"Upload failed: {msg}")
                requests.post(
                    f"{railway_url}/api/sync/complete",
                    headers=headers,
                    json={"requestId": request_id, "error": msg},
                    timeout=10,
                )

        except requests.RequestException as e:
            log.warning(f"Network error: {e}")

        time.sleep(3)

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info("OctaneSync Agent starting...")

    local_cfg = load_local_config()
    railway_url = local_cfg["railway_url"]
    agent_token = local_cfg["agent_token"]

    log.info(f"Connecting to: {railway_url}")

    # Fetch remote config (retry until successful)
    remote_cfg = None
    retries = 0
    while remote_cfg is None:
        remote_cfg = fetch_remote_config(railway_url, agent_token)
        if remote_cfg is None:
            retries += 1
            if retries >= 5:
                log.error("Could not connect to Railway app after 5 attempts. Check railway_url and agent_token in config.json.")
                sys.exit(1)
            log.info(f"Retrying in 5 seconds... ({retries}/5)")
            time.sleep(5)

    log.info("Remote config loaded.")

    # Check which runner paths are configured
    configured = {k: v for k, v in remote_cfg["runner_paths"].items() if v.strip()}
    if not configured:
        log.warning("No data directories configured in Settings. Set them in Settings -> Runner Data Directories.")
    else:
        for runner_id, path in configured.items():
            log.info(f"  {runner_id}: {path}")

    poll_loop(local_cfg, remote_cfg)


if __name__ == "__main__":
    main()
