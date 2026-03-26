#!/usr/bin/env python3
"""
Backfill f_pitching_time_data from existing f_pitching_trials rows.

For each row in f_pitching_trials that has a session_xml_path and owner_filename,
this script:
  1. Constructs the 3D-data JSON file path:
       dirname(session_xml_path) / "{owner_filename}-3d-data.json"
  2. Parses the JSON and splits it into flat scalar columns + individual JSONB
     columns (labels, bones, segments, force, frames) so the table is easily
     viewable in Neon and queryable without touching the heavy frames blob.

Schema (f_pitching_time_data):
  Demographic columns  — same as f_pitching_trials
  frame_rate           — NUMERIC  (top-level scalar)
  start_time           — NUMERIC
  end_time             — NUMERIC
  uncropped_length     — NUMERIC
  labels               — JSONB    (marker label list, small/static)
  bones                — JSONB    (skeleton edges, small/static)
  segments             — JSONB    (segment names + lengths, small/static)
  force                — JSONB    (force plate metadata, usually small)
  frames               — JSONB    (per-frame marker/segment data, large)

Usage:
  cd uais
  python python/scripts/backfill_pitching_time_data.py --dry-run
  python python/scripts/backfill_pitching_time_data.py
  python python/scripts/backfill_pitching_time_data.py --athlete-uuid <uuid>
  python python/scripts/backfill_pitching_time_data.py --pitching-root "D:/Pitching/Data"

--pitching-root remaps stored session_xml_path values to a different drive while
preserving the full sub-directory structure beneath the root.
"""

import argparse
import json
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection  # noqa: E402


# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public.f_pitching_time_data (
  id SERIAL PRIMARY KEY,
  athlete_uuid VARCHAR(36) NOT NULL,
  name VARCHAR(255),
  session_date DATE NOT NULL,
  source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
  source_athlete_id VARCHAR(100),
  owner_filename TEXT,
  handedness VARCHAR(20),
  trial_index INTEGER NOT NULL,
  velocity_mph NUMERIC,
  score NUMERIC,
  age_at_collection NUMERIC,
  age_group TEXT,
  height NUMERIC,
  weight NUMERIC,
  frame_rate NUMERIC,
  start_time NUMERIC,
  end_time NUMERIC,
  uncropped_length NUMERIC,
  labels JSONB,
  bones JSONB,
  segments JSONB,
  force JSONB,
  frames JSONB NOT NULL,
  session_xml_path TEXT,
  session_data_xml_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT f_pitching_time_data_athlete_uuid_fkey
    FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE
)
"""

CREATE_INDEX_SQLS = [
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_f_pitching_time_data_unique
      ON public.f_pitching_time_data(athlete_uuid, session_date, trial_index)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_f_pitching_time_data_owner
      ON public.f_pitching_time_data(owner_filename)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_f_pitching_time_data_date
      ON public.f_pitching_time_data(session_date)
    """,
]

UPSERT_SQL = """
INSERT INTO public.f_pitching_time_data
  (athlete_uuid, name, session_date, source_system, source_athlete_id,
   owner_filename, handedness, trial_index, velocity_mph, score,
   age_at_collection, age_group, height, weight,
   frame_rate, start_time, end_time, uncropped_length,
   labels, bones, segments, force, frames,
   session_xml_path, session_data_xml_path)
VALUES
  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
   %s, %s, %s, %s,
   %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
   %s, %s)
ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
  name = COALESCE(EXCLUDED.name, f_pitching_time_data.name),
  owner_filename = EXCLUDED.owner_filename,
  handedness = COALESCE(EXCLUDED.handedness, f_pitching_time_data.handedness),
  source_athlete_id = COALESCE(EXCLUDED.source_athlete_id, f_pitching_time_data.source_athlete_id),
  velocity_mph = EXCLUDED.velocity_mph,
  score = EXCLUDED.score,
  age_at_collection = EXCLUDED.age_at_collection,
  age_group = EXCLUDED.age_group,
  height = COALESCE(EXCLUDED.height, f_pitching_time_data.height),
  weight = COALESCE(EXCLUDED.weight, f_pitching_time_data.weight),
  frame_rate = EXCLUDED.frame_rate,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  uncropped_length = EXCLUDED.uncropped_length,
  labels = EXCLUDED.labels,
  bones = EXCLUDED.bones,
  segments = EXCLUDED.segments,
  force = EXCLUDED.force,
  frames = EXCLUDED.frames,
  session_xml_path = EXCLUDED.session_xml_path,
  session_data_xml_path = EXCLUDED.session_data_xml_path,
  created_at = NOW()
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def migrate_table_if_needed(cur) -> bool:
    """
    If f_pitching_time_data exists with the old single-metrics-column schema,
    drop it so it can be recreated with the new split-column schema.
    Returns True if a migration (drop) was performed.
    """
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'f_pitching_time_data'
    """)
    existing_cols = {r[0] for r in cur.fetchall()}
    if not existing_cols:
        return False  # table doesn't exist yet, nothing to migrate
    if "frames" not in existing_cols and "metrics" in existing_cols:
        print("  Detected old schema (single 'metrics' column). Dropping table for recreation...")
        cur.execute("DROP TABLE public.f_pitching_time_data CASCADE")
        return True
    return False


def ensure_table(cur) -> None:
    migrate_table_if_needed(cur)
    cur.execute(CREATE_TABLE_SQL)
    for sql in CREATE_INDEX_SQLS:
        cur.execute(sql)


def build_json_path(
    session_xml_path: str,
    owner_filename: str,
    pitching_root: Path | None = None,
) -> Path:
    """Return the expected 3D-data JSON path for a given trial.

    owner_filename may include a file extension (e.g. "Fastball LH 11.c3d");
    only the stem is used when building the JSON filename.

    If pitching_root is supplied the stored drive/root is replaced while
    preserving the full sub-directory structure beneath it.

    Example (stored):  H:/Pitching/Data/Garrett, Parker/Baseball Left-handed/session.xml
    pitching_root:     D:/Pitching/Data
    resolved dir:      D:/Pitching/Data/Garrett, Parker/Baseball Left-handed
    """
    xml_parent = Path(session_xml_path).parent
    if pitching_root is not None:
        stored_parts = xml_parent.parts
        root_parts   = pitching_root.parts
        n = len(root_parts)
        if len(stored_parts) > n:
            xml_parent = pitching_root / Path(*stored_parts[n:])
        else:
            xml_parent = pitching_root
    stem = Path(owner_filename).stem
    return xml_parent / f"{stem}-3d-data.json"


def parse_json_fields(json_data: dict) -> dict:
    """Extract and split top-level JSON fields into separate column values."""
    return {
        "frame_rate":       json_data.get("frameRate"),
        "start_time":       json_data.get("startTime"),
        "end_time":         json_data.get("endTime"),
        "uncropped_length": json_data.get("uncroppedLength"),
        "labels":           json.dumps(json_data.get("labels") or []),
        "bones":            json.dumps(json_data.get("bones") or []),
        "segments":         json.dumps(json_data.get("segments") or []),
        "force":            json.dumps(json_data.get("force") or {}),
        "frames":           json.dumps(json_data.get("frames") or []),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill f_pitching_time_data from f_pitching_trials + local JSON files"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Locate and validate JSON files but do not write to the database",
    )
    parser.add_argument(
        "--athlete-uuid",
        help="Limit backfill to a single athlete UUID",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Process at most N trials (0 = all)",
    )
    parser.add_argument(
        "--pitching-root",
        help=(
            "Local root of the pitching data tree (e.g. H:/Pitching/Data). "
            "Remaps stored session_xml_path values to a different drive while "
            "preserving the athlete/session sub-folder structure."
        ),
    )
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        # ------------------------------------------------------------------
        # 1. Ensure table exists with correct schema (auto-migrates old schema)
        # ------------------------------------------------------------------
        if not args.dry_run:
            print("Ensuring f_pitching_time_data table exists...")
            with conn.cursor() as cur:
                ensure_table(cur)
            conn.commit()
            print("  Table ready.\n")

        # ------------------------------------------------------------------
        # 2. Fetch source rows from f_pitching_trials
        # ------------------------------------------------------------------
        query = """
            SELECT
                athlete_uuid, name, session_date, source_system, source_athlete_id,
                owner_filename, handedness, trial_index, velocity_mph, score,
                age_at_collection, age_group, height, weight,
                session_xml_path, session_data_xml_path
            FROM public.f_pitching_trials
            WHERE session_xml_path IS NOT NULL
              AND owner_filename   IS NOT NULL
        """
        params: list = []
        if args.athlete_uuid:
            query += " AND athlete_uuid = %s"
            params.append(args.athlete_uuid)
        query += " ORDER BY session_date, athlete_uuid, trial_index"
        if args.limit > 0:
            query += f" LIMIT {args.limit}"

        with conn.cursor() as cur:
            cur.execute(query, params or None)
            rows = cur.fetchall()
            cols = [d.name for d in cur.description]

        pitching_root = Path(args.pitching_root) if args.pitching_root else None
        if pitching_root:
            print(f"Remapping paths under pitching root: {pitching_root}")

        print(f"Found {len(rows)} trial(s) in f_pitching_trials to process.")
        if not rows:
            print("Nothing to do.")
            return 0

        # ------------------------------------------------------------------
        # 3. Process each trial
        # ------------------------------------------------------------------
        n_inserted = 0
        n_missing  = 0
        n_error    = 0

        for row_tuple in rows:
            row = dict(zip(cols, row_tuple))
            session_xml_path = row["session_xml_path"] or ""
            owner_filename   = row["owner_filename"] or ""

            if not session_xml_path or not owner_filename:
                n_missing += 1
                continue

            json_path = build_json_path(session_xml_path, owner_filename, pitching_root)

            if not json_path.exists():
                n_missing += 1
                continue

            # Parse JSON and split fields
            try:
                with open(json_path, "r", encoding="utf-8") as fh:
                    json_data = json.load(fh)
                fields = parse_json_fields(json_data)
            except Exception as exc:
                print(f"  [WARNING] Could not read {json_path}: {exc}")
                n_error += 1
                continue

            if args.dry_run:
                print(
                    f"  [DRY RUN] {row['athlete_uuid']} | "
                    f"{row['session_date']} | trial {row['trial_index']} | "
                    f"{json_path.name}"
                )
                n_inserted += 1
                continue

            # Upsert
            try:
                with conn.cursor() as cur:
                    cur.execute(UPSERT_SQL, (
                        row["athlete_uuid"],
                        row["name"],
                        row["session_date"],
                        row["source_system"] or "pitching",
                        row["source_athlete_id"],
                        owner_filename,
                        row["handedness"],
                        row["trial_index"],
                        row["velocity_mph"],
                        row["score"],
                        row["age_at_collection"],
                        row["age_group"],
                        row["height"],
                        row["weight"],
                        fields["frame_rate"],
                        fields["start_time"],
                        fields["end_time"],
                        fields["uncropped_length"],
                        fields["labels"],
                        fields["bones"],
                        fields["segments"],
                        fields["force"],
                        fields["frames"],
                        row["session_xml_path"],
                        row["session_data_xml_path"],
                    ))
                conn.commit()
                n_inserted += 1
                if n_inserted % 25 == 0:
                    print(f"  Progress: {n_inserted} upserted...")
            except Exception as exc:
                conn.rollback()
                print(
                    f"  [ERROR] Upsert failed for {row['athlete_uuid']} / "
                    f"{owner_filename}: {exc}"
                )
                n_error += 1

        # ------------------------------------------------------------------
        # 4. Summary
        # ------------------------------------------------------------------
        print("\n=== Backfill Complete ===")
        if args.dry_run:
            print(f"  [DRY RUN] Would insert/update : {n_inserted}")
        else:
            print(f"  Inserted / updated            : {n_inserted}")
        print(f"  JSON file not found / skipped : {n_missing}")
        print(f"  Errors                        : {n_error}")

        return 0 if n_error == 0 else 1

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
