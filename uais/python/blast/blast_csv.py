"""
Read a Blast Motion team-portal export ("All_swings_by_player_<ms>.csv") into clean rows.

Quirks handled (all seen in the 2026-11-06 export):
  * UTF-8 BOM before the first header.
  * The timezone field holds embedded newlines ("America/New_York\\nstandard time\\nGMT-5"),
    so a 390-swing file is 1,170 physical lines. Always read with the csv module.
  * "Swing Timestamp" / "Upload Timestamp" are UTC (every swing in the sample lands inside
    the facility's 1-9 PM Eastern window only when read as UTC; as local time 62% fall outside).
  * On Plane Efficiency is a 0-1 fraction under a "(%)" header -> stored as a percent.
  * Float noise from the app (0.1519999999999999) -> rounded per metric.
  * Every row carries the account owner's name (individual subscription); it says nothing
    about who swung, so it is kept only as blast_user_name.

Header matching ignores case, punctuation and the degree sign, so "Attack Angle (°'s)",
"Attack Angle (deg)" and "attack_angle" all land on attack_angle_deg.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/New_York")

# normalised header key -> (column, decimals). Keys come from _key().
METRICS: dict[str, tuple[str, int]] = {
    "batspeed": ("bat_speed_mph", 2),
    "peakhandspeed": ("peak_hand_speed_mph", 2),
    "rotationalacceleration": ("rotational_accel_g", 2),
    "power": ("power_kw", 2),
    "onplaneefficiency": ("on_plane_efficiency_pct", 1),   # x100 below
    "attackangle": ("attack_angle_deg", 2),
    "vertbatangle": ("vertical_bat_angle_deg", 2),
    "verticalbatangle": ("vertical_bat_angle_deg", 2),
    "timetocontact": ("time_to_contact_s", 3),
    "committime": ("commit_time_s", 3),
    "earlyconnection": ("early_connection_deg", 2),
    "hingeangleatimpact": ("hinge_angle_at_impact_deg", 2),
    "connectionatimpact": ("connection_at_impact_deg", 2),
    "bodytiltangle": ("body_tilt_deg", 2),
}
TEXT: dict[str, str] = {
    "captureid": "capture_id",
    "swingtimestamp": "swing_ts",
    "uploadtimestamp": "upload_ts",
    "timezone": "timezone",
    "firstname": "first_name",
    "lastname": "last_name",
    "userid": "blast_user_id",
    "environmenttag": "environment",
    "batnickname": "bat_nickname",
    "sensorserialnumber": "sensor_serial",
    "actiontype": "action_type",
}
REQUIRED = ("capture_id", "swing_ts", "sensor_serial")

UNIT_SUFFIX = re.compile(r"\((?:[^)]*)\)\s*$")


class BlastCsvError(ValueError):
    pass


def _key(header: str) -> str:
    """'Rotational Acceleration (G's)' -> 'rotationalacceleration'."""
    h = UNIT_SUFFIX.sub("", header.replace("﻿", "")).strip().lower()
    return re.sub(r"[^a-z0-9]", "", h)


def _num(v: str | None) -> float | None:
    if v is None:
        return None
    v = v.strip()
    if v == "" or v.lower() in ("nan", "null", "none", "-"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_utc(v: str | None) -> datetime | None:
    """'2026-11-04 22:58:33' (UTC) -> aware datetime. Accepts an ISO 'T' and a trailing Z too."""
    if not v or not v.strip():
        return None
    s = v.strip().replace("T", " ").rstrip("Z")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise BlastCsvError(f"unreadable timestamp {v!r}")


def clean_serial(v: str | None) -> str | None:
    """Excel can turn 111444004664 into 1.11444E+11 or '111444004664.0'; keep digits as text."""
    if v is None:
        return None
    s = v.strip()
    if re.fullmatch(r"\d+\.0+", s):
        s = s.split(".")[0]
    if re.fullmatch(r"[\d.]+[eE]\+\d+", s):
        raise BlastCsvError(f"sensor serial {s!r} was mangled into scientific notation (opened/saved in Excel?)")
    return s or None


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_blast_csv(path: Path | str) -> tuple[list[dict], list[str]]:
    """-> (rows, warnings). Each row: the columns of hitting_intel.blast_swings it fills, plus 'raw'."""
    text = Path(path).read_bytes().decode("utf-8-sig", errors="replace")
    return parse_blast_text(text)


def parse_blast_text(text: str) -> tuple[list[dict], list[str]]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if not reader.fieldnames:
        raise BlastCsvError("empty file")
    colmap: dict[str, tuple[str, str]] = {}   # original header -> (kind, column)
    for h in reader.fieldnames:
        k = _key(h)
        if k in TEXT:
            colmap[h] = ("text", TEXT[k])
        elif k in METRICS:
            colmap[h] = ("num", METRICS[k][0])
    found = {c for _, c in colmap.values()}
    missing = [c for c in REQUIRED if c not in found]
    if missing:
        raise BlastCsvError(f"not a Blast swing export: missing {missing} (headers: {reader.fieldnames})")
    warnings: list[str] = []
    unknown = [h for h in reader.fieldnames if h not in colmap]
    if unknown:
        warnings.append(f"columns not mapped (kept in raw only): {unknown}")
    decimals = {col: d for col, d in METRICS.values()}

    rows: list[dict] = []
    seen: set[str] = set()
    for i, rec in enumerate(reader, start=2):
        raw = {k: (v if v is None else v.replace("\r", "")) for k, v in rec.items() if k is not None}
        r: dict = {"raw": raw}
        for h, (kind, col) in colmap.items():
            v = rec.get(h)
            r[col] = _num(v) if kind == "num" else (v.strip() if isinstance(v, str) and v.strip() else None)
        cid = r.get("capture_id")
        if not cid:
            warnings.append(f"record {i}: no captureid, skipped")
            continue
        if cid in seen:
            warnings.append(f"record {i}: duplicate captureid {cid}, skipped")
            continue
        seen.add(cid)
        swing_at = parse_utc(r.pop("swing_ts"))
        if swing_at is None:
            warnings.append(f"record {i}: no swing timestamp, skipped")
            continue
        r["swing_at"] = swing_at
        r["local_date"] = swing_at.astimezone(LOCAL_TZ).date()
        r["uploaded_at"] = parse_utc(r.pop("upload_ts", None))
        r["sensor_serial"] = clean_serial(r.get("sensor_serial"))
        if not r["sensor_serial"]:
            warnings.append(f"record {i}: no sensor serial, skipped")
            continue
        uid = r.get("blast_user_id")
        try:
            r["blast_user_id"] = int(float(uid)) if uid else None
        except ValueError:
            r["blast_user_id"] = None
        r["blast_user_name"] = " ".join(x for x in (r.pop("first_name", None), r.pop("last_name", None)) if x) or None
        r.pop("timezone", None)
        if r.get("on_plane_efficiency_pct") is not None and r["on_plane_efficiency_pct"] <= 1.0:
            r["on_plane_efficiency_pct"] *= 100.0
        for col, d in decimals.items():
            if r.get(col) is not None:
                r[col] = round(r[col], d)
        rows.append(r)
    return rows, warnings


def default_label(serial: str, taken: set[str]) -> str:
    """Last 3 digits of the serial (what's printed on the sensor), lengthened if that's taken."""
    for n in (3, 4, 6, len(serial)):
        label = serial[-n:]
        if label not in taken:
            return label
    return serial
