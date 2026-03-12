#!/usr/bin/env python3
"""
Sync missing DOBs from LOCAL -> WAREHOUSE (Neon).

Problem this solves:
- Your fact rows (e.g. pitching) can’t backfill `age_at_collection` unless
  `analytics.d_athletes.date_of_birth` is populated for those athlete_uuids.
- After pg_restore/duplicates, Neon can end up with athletes but DOB = NULL.

This script:
1) Connects to LOCAL Postgres using env vars (safe to commit).
2) Connects to WAREHOUSE using UAIS config (db_connections.yaml / athlete_manager).
3) Copies DOB for athlete_uuids where:
   - warehouse.d_athletes.date_of_birth IS NULL
   - local.d_athletes.date_of_birth IS NOT NULL

Usage (PowerShell):
  $env:UAIS_LOCAL_PGPASSWORD="your_local_password"
  python python/scripts/sync_dob_local_to_warehouse.py --dry-run
  python python/scripts/sync_dob_local_to_warehouse.py

Optional LOCAL overrides:
  UAIS_LOCAL_PGHOST (default localhost)
  UAIS_LOCAL_PGPORT (default 5432)
  UAIS_LOCAL_PGDATABASE (default uais_warehouse)
  UAIS_LOCAL_PGUSER (default postgres)
  UAIS_LOCAL_PGPASSWORD (required if PGPASSWORD not set)
"""

import os
import sys
import argparse
from datetime import date, datetime
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.age_utils import parse_date


def get_local_connection():
    host = os.environ.get("UAIS_LOCAL_PGHOST", "localhost")
    port = int(os.environ.get("UAIS_LOCAL_PGPORT", "5432"))
    database = os.environ.get("UAIS_LOCAL_PGDATABASE", "uais_warehouse")
    user = os.environ.get("UAIS_LOCAL_PGUSER", "postgres")
    password = os.environ.get("UAIS_LOCAL_PGPASSWORD") or os.environ.get("PGPASSWORD")

    if not password:
        raise RuntimeError(
            "Local DB password not provided. Set UAIS_LOCAL_PGPASSWORD (recommended) "
            "or PGPASSWORD before running."
        )

    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )


def normalize_dob(val):
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    # strings
    return parse_date(str(val))


def main():
    parser = argparse.ArgumentParser(description="Sync missing DOBs from local Postgres to warehouse (Neon).")
    parser.add_argument("--dry-run", action="store_true", help="Show counts only; do not write anything.")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch size for updates (default 5000).")
    args = parser.parse_args()

    local = None
    wh = None
    try:
        print("Connecting to LOCAL...")
        local = get_local_connection()
        print("Connected to LOCAL.")

        print("Connecting to WAREHOUSE...")
        wh = get_warehouse_connection()
        print("Connected to WAREHOUSE.")

        with wh.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM analytics.d_athletes WHERE date_of_birth IS NULL")
            wh_missing = cur.fetchone()[0]
        print(f"Warehouse athletes missing DOB: {wh_missing:,}")

        # Pull local DOBs
        with local.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid, date_of_birth
                FROM analytics.d_athletes
                WHERE date_of_birth IS NOT NULL
            """)
            local_rows = cur.fetchall()

        local_map = {}
        for athlete_uuid, dob in local_rows:
            dob_norm = normalize_dob(dob)
            if dob_norm:
                local_map[str(athlete_uuid)] = dob_norm

        print(f"Local athletes with DOB: {len(local_map):,}")

        # Find which warehouse athlete_uuids need DOB and exist locally
        with wh.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid
                FROM analytics.d_athletes
                WHERE date_of_birth IS NULL
            """)
            wh_missing_ids = [str(r[0]) for r in cur.fetchall()]

        candidates = [(uid, local_map.get(uid)) for uid in wh_missing_ids if uid in local_map]
        candidates = [(uid, dob) for uid, dob in candidates if dob is not None]

        print(f"Warehouse athletes that can be filled from local: {len(candidates):,}")

        if args.dry_run:
            print("DRY RUN: no updates applied.")
            return 0

        updated_total = 0
        batch_size = max(100, args.batch_size)

        for i in range(0, len(candidates), batch_size):
            batch = candidates[i:i + batch_size]
            # execute_values to send one big VALUES list
            with wh.cursor() as cur:
                execute_values(
                    cur,
                    """
                    UPDATE analytics.d_athletes d
                    SET date_of_birth = v.dob::date
                    FROM (VALUES %s) AS v(athlete_uuid, dob)
                    WHERE d.athlete_uuid = v.athlete_uuid::varchar
                      AND d.date_of_birth IS NULL
                    """,
                    batch,
                )
                updated_total += cur.rowcount
            wh.commit()
            if (i // batch_size) % 10 == 0:
                print(f"Updated so far: {updated_total:,}")

        print(f"Done. Updated DOB for {updated_total:,} warehouse athletes.")

        return 0
    finally:
        try:
            if local:
                local.close()
        except Exception:
            pass
        try:
            if wh:
                wh.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

