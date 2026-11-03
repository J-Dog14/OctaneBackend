#!/usr/bin/env python3
"""
Backfill f_pitching_trials.capture_time (and qtm_pitch_type) for trials ingested before the
pitch-category change, so the 3D <-> TrackMan matcher can pair them.

Both come from QTM's session.xml, exactly as the R ingest reads them (extract_measurement_info):
  <Measurement Filename="Fastball RH 4.qtm"> <Fields> <Creation_date>10/30/2026</Creation_date>
  <Creation_time>14:03:27</Creation_time> <Pitch_type>…</Pitch_type> <Pitch_subtype>…</Pitch_subtype>

Usage (from uais/):
  python python/scripts/backfill_pitching_capture_time.py --dry-run
  python python/scripts/backfill_pitching_capture_time.py
  python python/scripts/backfill_pitching_capture_time.py --athlete-uuid <uuid> [--force]
  python python/scripts/backfill_pitching_capture_time.py --pitching-root "D:/Pitching/Data"

Then pair them:  python -m python.trackman.match_3d --all            (dry run)
                 python -m python.trackman.match_3d --all --write
"""

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
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
    raw = path.read_bytes()
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        txt = raw.decode("utf-8", errors="replace")
        end = txt.find("</Subject>")
        if end < 0:
            raise
        return ET.fromstring(txt[: end + len("</Subject>")])


def _date(s: str | None):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime((s or "").strip(), fmt).date()
        except ValueError:
            pass
    return None


def _variants(name: str) -> set[str]:
    n = name.strip().lower()
    stem = re.sub(r"\.[^.]+$", "", n)
    c3d = re.sub(r"\.qtm$", ".c3d", n)
    return {n, stem, c3d, re.sub(r"\.[^.]+$", "", c3d)}


def measurements(root: ET.Element) -> dict[str, tuple[str | None, str | None]]:
    """filename variant -> (capture_time 'YYYY-MM-DD HH:MM:SS', qtm_pitch_type)."""
    out: dict[str, tuple[str | None, str | None]] = {}
    if root.tag != "Subject":
        return out
    for meas in root.iter("Measurement"):
        fn = meas.get("Filename")
        if not fn:
            continue
        fields = meas.find("Fields")
        get = (lambda k: (fields.findtext(k) or "").strip() or None) if fields is not None else (lambda k: None)
        d, t = _date(get("Creation_date")), get("Creation_time")
        cap = None
        if d and t and re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", t):
            cap = f"{d:%Y-%m-%d} {t if t.count(':') == 2 else t + ':00'}"
        ptype, psub = get("Pitch_type"), get("Pitch_subtype")
        if psub and psub.lower() in ("unspecified", "none"):
            psub = None
        qtm = None if not ptype else (ptype if not psub else f"{ptype} / {psub}")
        for v in _variants(fn):
            out[v] = (cap, qtm)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--athlete-uuid")
    ap.add_argument("--force", action="store_true", help="Also redo trials that already have a capture_time")
    ap.add_argument("--pitching-root", type=Path, help="Local root of the pitching data tree (remaps stored paths)")
    args = ap.parse_args()

    conn = get_warehouse_connection()
    try:
        where = ["session_xml_path IS NOT NULL", "owner_filename IS NOT NULL"]
        params: list = []
        if not args.force:
            where.append("capture_time IS NULL")
        if args.athlete_uuid:
            where.append("athlete_uuid = %s")
            params.append(args.athlete_uuid)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, owner_filename, session_xml_path FROM public.f_pitching_trials WHERE {' AND '.join(where)} ORDER BY session_xml_path",
                params,
            )
            rows = cur.fetchall()
        print(f"{len(rows)} trials without a capture time{' (dry run)' if args.dry_run else ''}")

        cache: dict[Path, dict | None] = {}
        updates: list[tuple[str, str | None, int]] = []
        missing_file = no_match = no_time = 0
        for rid, owner, xml_path in rows:
            path = remap(xml_path, args.pitching_root)
            if path not in cache:
                try:
                    cache[path] = measurements(read_xml(path)) if path.exists() else None
                except Exception as e:  # noqa: BLE001
                    print(f"  could not parse {path}: {e}")
                    cache[path] = None
            m = cache[path]
            if m is None:
                missing_file += 1
                continue
            hit = next((m[v] for v in _variants(owner) if v in m), None)
            if hit is None:
                no_match += 1
                continue
            if hit[0] is None:
                no_time += 1
                continue
            updates.append((hit[0], hit[1], rid))

        print(f"  capture times found: {len(updates)}  |  session.xml missing/unreadable: {missing_file}  |  "
              f"trial not in session.xml: {no_match}  |  no Creation_date/time: {no_time}")
        if missing_file and not args.pitching_root:
            print("  (files not at their stored path? pass --pitching-root with your local pitching data folder)")
        if updates:
            print(f"  e.g. {updates[0][0]}  {updates[0][1] or ''}")
        if args.dry_run or not updates:
            return 0
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE public.f_pitching_trials SET capture_time = %s::timestamp, "
                "qtm_pitch_type = COALESCE(qtm_pitch_type, %s) WHERE id = %s",
                updates,
            )
        conn.commit()
        print(f"  wrote capture times for {len(updates)} trials")
        print("Next: python -m python.trackman.match_3d --all   (dry run), then add --write")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
