#!/usr/bin/env python3
"""
Backfill f_pitching_trials.events: V3D's EVENT_LABEL times for every stored pitching trial.

Why: f_pitching_trials.metrics only keeps METRIC values. The TIMING.*Time metrics there are
measured from V3D's SETUP event, not from the start of the capture, so they can't place an
event in the marker/force frames (SETUP sits anywhere from 0 to 0.5+ s in). EVENT_LABEL times
are seconds from the start of the cropped capture, i.e. frame index / frame rate.

events = {"Release": 2.0733, "Max_Shoulder_Rot": 2.04, "Footstrike": 1.9633, "MaxKneeHeight": 1.19, ...}

Run `npm run pitchtype:events` first (adds the column). New ingests store events themselves.

Usage:
  cd uais
  python python/scripts/backfill_pitching_events.py --dry-run
  python python/scripts/backfill_pitching_events.py
  python python/scripts/backfill_pitching_events.py --athlete-uuid <uuid> [--force]
  python python/scripts/backfill_pitching_events.py --pitching-root "D:/Pitching/Data"

--pitching-root remaps stored session_data_xml_path values to a different drive while keeping
the athlete/session sub-folders (same rule as backfill_pitching_time_data.py).
After this, re-run the force metrics so FC/BR use the events:
  Rscript R/pitching/backfill_force_metrics.R
"""

import argparse
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection  # noqa: E402


def remap(path: str, pitching_root: Path | None) -> Path:
    p = Path(path)
    if pitching_root is None:
        return p
    parent = p.parent
    n = len(pitching_root.parts)
    new_parent = pitching_root / Path(*parent.parts[n:]) if len(parent.parts) > n else pitching_root
    return new_parent / p.name


def read_xml(path: Path) -> ET.Element:
    raw = gzip.open(path, "rb").read() if path.suffix.lower() == ".gz" else path.read_bytes()
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        # Same repair as read_xml_robust in the R ingest: cut trailing junk after the root element.
        txt = raw.decode("utf-8", errors="replace")
        end = txt.find("</v3d>")
        if end < 0:
            raise
        return ET.fromstring(txt[: end + len("</v3d>")])


_NUM = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


def event_labels(root: ET.Element, owner: str) -> dict:
    out: dict = {}
    for own in root.findall("owner"):
        if own.get("value") != owner:
            continue
        for typ in own.findall("type"):
            if typ.get("value") != "EVENT_LABEL":
                continue
            for name in typ.iter("name"):
                comp = name.find("component")
                if comp is None:
                    continue
                data = comp.get("data") or comp.text or ""
                vals = [float(x) for x in _NUM.findall(data)]
                if vals:
                    out[name.get("value")] = vals[0] if len(vals) == 1 else vals
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="Parse and report; write nothing")
    ap.add_argument("--athlete-uuid", help="Only this athlete")
    ap.add_argument("--force", action="store_true", help="Also redo trials that already have events")
    ap.add_argument("--pitching-root", type=Path, help="Local root of the pitching data tree (remaps stored paths)")
    args = ap.parse_args()

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
                "AND table_name = 'f_pitching_trials' AND column_name = 'events'"
            )
            if cur.fetchone() is None:
                print("f_pitching_trials.events doesn't exist yet: run `npm run pitchtype:events` first.")
                return 1
            where = ["session_data_xml_path IS NOT NULL", "owner_filename IS NOT NULL"]
            params: list = []
            if not args.force:
                where.append("events IS NULL")
            if args.athlete_uuid:
                where.append("athlete_uuid = %s")
                params.append(args.athlete_uuid)
            cur.execute(
                f"""SELECT id, athlete_uuid, session_date::text, pitch_category, trial_index, owner_filename, session_data_xml_path
                      FROM public.f_pitching_trials WHERE {' AND '.join(where)}
                     ORDER BY session_data_xml_path, owner_filename""",
                params,
            )
            rows = cur.fetchall()
        print(f"{len(rows)} trials to backfill{' (dry run)' if args.dry_run else ''}")

        docs: dict[Path, ET.Element | None] = {}
        updates: list[tuple[str, int]] = []
        missing_file = no_events = 0
        for rid, _uuid, _date, _cat, _ti, owner, xml_path in rows:
            path = remap(xml_path, args.pitching_root)
            if path not in docs:
                try:
                    docs[path] = read_xml(path) if path.exists() else None
                except Exception as e:  # noqa: BLE001
                    print(f"  could not parse {path}: {e}")
                    docs[path] = None
            root = docs[path]
            if root is None:
                missing_file += 1
                continue
            ev = event_labels(root, owner)
            if not ev or "Release" not in ev:
                no_events += 1
                continue
            updates.append((json.dumps(ev), rid))

        print(f"  events found: {len(updates)}  |  session_data.xml missing/unreadable: {missing_file}  |  no Release event: {no_events}")
        if missing_file and not args.pitching_root:
            print("  (files not at their stored path? pass --pitching-root with your local pitching data folder)")
        if updates:
            print(f"  e.g. {updates[0][0][:160]}")
        if args.dry_run or not updates:
            return 0
        with conn.cursor() as cur:
            cur.executemany("UPDATE public.f_pitching_trials SET events = %s::jsonb WHERE id = %s", updates)
        conn.commit()
        print(f"  wrote events for {len(updates)} trials")
        print("Next: Rscript R/pitching/backfill_force_metrics.R  (force FC/BR now use the events)")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
