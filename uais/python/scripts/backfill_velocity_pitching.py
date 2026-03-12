#!/usr/bin/env python3
"""
Backfill velocity_mph in f_kinematics_pitching from session.xml files.

Follows the same logic as R pitching main.R:
1. Find all session.xml under pitching data root.
2. For each session.xml:
   - Parse Subject name and Creation_date (-> session_date).
   - Parse each Measurement: Filename and Fields/Comments (-> velocity MPH).
3. Match (name, session_date) to d_athletes to get athlete_uuid.
4. Match filename with R logic: try exact, basename, no-ext, .qtm, .c3d.
5. For each (athlete_uuid, session_date) we have an ordered list of (filename, velocity).
   DB rows for that (athlete, session) are assumed to be in the same order as
   trials (session_data.xml owner order). Partition rows into K chunks and assign
   velocity to each chunk.

Usage:
  python python/scripts/backfill_velocity_pitching.py --pitching-root "H:/Pitching/Data" --dry-run
  python python/scripts/backfill_velocity_pitching.py --pitching-root "H:/Pitching/Data"
"""

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection, load_db_config


def normalize_name_for_matching(name):
    """LAST, FIRST or LAST, FIRST DATE -> FIRST LAST (uppercase). Match R logic."""
    if not name or not isinstance(name, str):
        return ""
    s = name.strip().upper()
    # Remove trailing date pattern (e.g. " 11-25" or " 01/07/2026")
    s = re.sub(r"\s+\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?\s*$", "", s).strip()
    if "," in s:
        parts = [p.strip() for p in s.split(",", 1)]
        if len(parts) == 2:
            return f"{parts[1]} {parts[0]}"
    return s


def _read_session_xml(path):
    """Read session.xml; handle UTF-16 BOM and UTF-8."""
    path = Path(path)
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16", errors="replace")
    else:
        text = raw.decode("utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    return text


def parse_session_xml(path):
    """
    Parse session.xml. Returns (subject_name, session_date, measurements).
    measurements = list of (filename, velocity_mph) in document order.
    """
    path = Path(path)
    if not path.exists():
        return None
    try:
        text = _read_session_xml(path)
        root = ET.fromstring(text)
    except Exception:
        return None
    # Subject root (tag may be "Subject" or with namespace)
    tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if tag != "Subject":
        return None
    subject_name = None
    session_date = None
    for child in root:
        ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if ctag == "Fields":
            for f in child:
                ftag = f.tag.split("}")[-1] if "}" in f.tag else f.tag
                if ftag == "Name" and f.text:
                    subject_name = f.text.strip()
                if ftag == "Creation_date" and f.text:
                    raw = f.text.strip()
                    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%d/%m/%Y"):
                        try:
                            session_date = datetime.strptime(raw, fmt).date()
                            break
                        except ValueError:
                            continue
            break
    measurements = []
    for meas in root.iter("*"):
        if meas.tag.split("}")[-1] != "Measurement":
            continue
        filename = meas.get("Filename")
        if not filename:
            continue
        velocity_mph = None
        fields = meas.find("Fields")
        if fields is not None:
            comments = fields.find("Comments")
            if comments is not None and comments.text:
                try:
                    v = float(comments.text.strip())
                    if v > 0:
                        velocity_mph = v
                except ValueError:
                    pass
        measurements.append((filename.strip(), velocity_mph))
    return (subject_name, session_date, measurements)


def find_session_xml_files(root_dir):
    """Yield (session_xml_path, session_date, subject_name) for each session.xml."""
    root = Path(root_dir)
    if not root.is_dir():
        return
    for path in root.rglob("session.xml"):
        parsed = parse_session_xml(path)
        if parsed is None:
            continue
        name, session_date, measurements = parsed
        if not name or not session_date or not measurements:
            continue
        yield (path, session_date, name, measurements)


def main():
    parser = argparse.ArgumentParser(description="Backfill velocity_mph from session.xml")
    parser.add_argument(
        "--pitching-root",
        type=str,
        default=os.environ.get("PITCHING_DATA_DIR", "H:/Pitching/Data"),
        help="Root directory for pitching data (session.xml search)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write to DB")
    args = parser.parse_args()

    pitching_root = Path(args.pitching_root)
    if not pitching_root.is_dir():
        print(f"Pitching root not found: {pitching_root}")
        return 1

    conn = get_warehouse_connection()
    try:
        # Ensure velocity_mph column exists (R pipeline adds it at runtime; may be missing in DB)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'f_kinematics_pitching'
                AND column_name = 'velocity_mph'
            """)
            if cur.fetchone() is None:
                cur.execute(
                    "ALTER TABLE public.f_kinematics_pitching ADD COLUMN IF NOT EXISTS velocity_mph NUMERIC"
                )
                conn.commit()
                print("Added velocity_mph column to f_kinematics_pitching")

        # Load athletes: normalized_name -> athlete_uuid
        with conn.cursor() as cur:
            cur.execute("""
                SELECT athlete_uuid, name, normalized_name
                FROM analytics.d_athletes
            """)
            rows = cur.fetchall()
        name_to_uuid = {}
        for athlete_uuid, name, normalized_name in rows:
            key = (normalized_name or "").strip().upper()
            if not key and name:
                key = normalize_name_for_matching(name)
            if key:
                name_to_uuid[key] = athlete_uuid

        # Collect (athlete_uuid, session_date, list of velocity_mph in document order, path)
        # Use full measurement order (including None) so chunk index = trial index.
        session_velocities = []
        for path, session_date, subject_name, measurements in find_session_xml_files(pitching_root):
            norm = normalize_name_for_matching(subject_name)
            athlete_uuid = name_to_uuid.get(norm)
            if not athlete_uuid:
                continue
            # Keep full list so chunk i = measurement i (R logic matches by filename; we match by order)
            vel_list = [v for (_, v) in measurements]
            if not vel_list:
                continue
            # Skip session if no velocities at all (nothing to backfill)
            if all(v is None for v in vel_list):
                continue
            session_velocities.append((athlete_uuid, session_date, vel_list, path))

        print(f"Found {len(session_velocities)} sessions with velocity data")

        if args.dry_run:
            print("(Dry run: no DB writes)")
            for athlete_uuid, session_date, vel_list, path in session_velocities[:5]:
                with_vel = sum(1 for v in vel_list if v is not None)
                print(f"  {athlete_uuid} {session_date} trials={len(vel_list)} with_velocity={with_vel} e.g. {vel_list[:3]} from {path}")
            return 0

        updated_total = 0
        for athlete_uuid, session_date, vel_list, _ in session_velocities:
            K = len(vel_list)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM public.f_kinematics_pitching
                    WHERE athlete_uuid = %s AND session_date = %s
                    ORDER BY id
                    """,
                    (athlete_uuid, session_date),
                )
                ids = [r[0] for r in cur.fetchall()]
            if not ids:
                continue
            R = len(ids)
            rpt = R // K
            if rpt == 0:
                continue
            for i, velocity_mph in enumerate(vel_list):
                if velocity_mph is None:
                    continue
                start = i * rpt
                end = (i + 1) * rpt if i < K - 1 else R
                chunk_ids = ids[start:end]
                if not chunk_ids:
                    continue
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE public.f_kinematics_pitching
                        SET velocity_mph = %s
                        WHERE id = ANY(%s)
                        """,
                        (float(velocity_mph), chunk_ids),
                    )
                    updated_total += cur.rowcount
        conn.commit()
        print(f"Updated {updated_total} rows with velocity_mph")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
