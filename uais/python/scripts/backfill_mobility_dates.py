#!/usr/bin/env python3
"""
Re-date and re-ingest every mobility sheet (fix for the 2026-06-08 session dates).

Why: the first bulk download of the Drive folder (2026-06-08) happened before the
pipeline wrote a date sidecar, so 173 sheets fell back to the local file time and
were stored with session_date = 2026-06-08. Old "Assessment Key" sheets also put
1-3 color grades into degree columns. See uais/python/mobility/sheet_rules.py.

What it does:
  1. Lists the Drive "Mobility Assessments" folder and maps every sheet to its
     cached .xlsx by Drive file id (writes _drive_manifest.json and a .meta.json
     sidecar with the Drive created date next to each file; downloads new or
     same-named sheets).
  2. Re-ingests every cached sheet with the current rules (date from the file
     name, else the Drive created date; legacy scale filter; blanks stay NULL).
     Rows are matched by source_file, so dates are corrected in place.
  3. Cached files with no Drive sheet are moved to mobility_cache/_stale/; with
     --delete-orphans their f_mobility rows are deleted too.

Dry run (default) prints the date change for every sheet and touches nothing:
  python python/scripts/backfill_mobility_dates.py
  python python/scripts/backfill_mobility_dates.py --apply
  python python/scripts/backfill_mobility_dates.py --apply --delete-orphans
"""
import argparse
import collections
import logging
import os
import shutil
import sys
from pathlib import Path

python_dir = Path(__file__).resolve().parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from openpyxl import load_workbook  # noqa: E402

from common.athlete_manager import get_warehouse_connection  # noqa: E402
from mobility import main as mob  # noqa: E402
from mobility.google_drive_utils import (  # noqa: E402
    GOOGLE_API_AVAILABLE, download_missing_sheets, get_google_credentials,
    list_drive_sheets, load_manifest, plan_cache,
)
from mobility.sheet_rules import session_date_from  # noqa: E402


def norm(p) -> str:
    return os.path.normcase(os.path.normpath(str(p)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="Write sidecars, re-ingest and move stale files (default: dry run)")
    ap.add_argument("--delete-orphans", action="store_true", help="With --apply: delete f_mobility rows of cached files that have no Drive sheet")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    log = logging.getLogger("backfill_mobility")
    excel_directory, gsheet_directory, credentials_path = mob.resolve_directories(log)
    excel_dir = Path(excel_directory)
    if not GOOGLE_API_AVAILABLE:
        sys.exit("Google API libraries are not installed (pip install -r python/requirements.txt)")

    from googleapiclient.discovery import build

    creds = get_google_credentials(str(credentials_path))
    if not creds:
        sys.exit("Google sign-in failed")
    service = build("drive", "v3", credentials=creds)
    drive_files = list_drive_sheets(service, gsheet_directory)
    if drive_files is None:
        sys.exit(f"Drive folder not found: {gsheet_directory}")
    plan, orphans = plan_cache(drive_files, excel_dir, load_manifest(excel_dir))

    conn = get_warehouse_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT source_file, session_date::text FROM public.f_mobility WHERE source_file IS NOT NULL")
        db_dates = collections.defaultdict(list)
        for sf, d in cur.fetchall():
            db_dates[norm(sf)].append(d)
        cur.execute("SELECT count(*) FROM public.f_mobility WHERE source_file IS NULL")
        null_source = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM public.f_mobility WHERE session_date = DATE '2026-06-08'")
        june8 = cur.fetchone()[0]

    # ---- report --------------------------------------------------------------
    changes = collections.Counter()
    reused = []
    dup_rows = 0
    print(f"\n{'Sheet':58} {'DB date(s)':24} -> {'new date':10}  source          template  filled")
    print("-" * 120)
    for f, local, needs in plan:
        new_date, src = session_date_from(local.name, f.get("createdTime"))
        template, filled = "?", "?"
        if local.exists():
            try:
                ws = load_workbook(local, data_only=True, read_only=False).active
                a = mob.extract_assessment_data(ws)
                template, filled = a["template"], a["filled_count"]
            except Exception as e:  # noqa: BLE001
                template = f"err: {e}"[:20]
        old = sorted(set(db_dates.get(norm(local), [])))
        old_s = ",".join(old) or "(none)"
        tag = "same" if old == [str(new_date)] else ("new" if not old else "CHANGE")
        if len(db_dates.get(norm(local), [])) > 1:
            with conn.cursor() as cur:
                rows, history, dups = mob.classify_sheet_rows(cur, norm(local))
            if history:
                reused.append((local.name, rows[0][1], [(h[1], h[2]) for h in history]))
                new_date, src = rows[0][1], "reused_sheet"
            if dups:
                dup_rows += len(dups)
        changes[tag] += 1
        flag = " (download)" if needs else ""
        print(f"{local.name[:58]:58} {old_s[:24]:24} -> {str(new_date):10}  {src:15} {template:9} {filled}{flag}")

    print("\nSummary")
    print(f"  Drive sheets: {len(drive_files)}   date changes: {changes['CHANGE']}   unchanged: {changes['same']}   not in DB yet: {changes['new']}")
    print(f"  Rows dated 2026-06-08 today: {june8}")
    print(f"  Duplicate rows from edits to the same sheet (will be removed): {dup_rows}")
    print(f"  Sheets re-used in place for a re-test (earlier version kept as its own session): {len(reused)}")
    for name, cur_date, hist in reused:
        print(f"    - {name}: current values stay {cur_date}; earlier: "
              + ", ".join(f"{d} ({n} metrics differ)" for d, n in hist))
    known = {norm(p[1]) for p in plan} | {norm(o) for o in orphans}
    loose = {sf: ds for sf, ds in db_dates.items() if sf not in known and '#earlier-version' not in sf}
    print(f"  Rows whose source file isn't in the cache (left as they are): {sum(len(v) for v in loose.values())}")
    for sf in sorted(loose)[:15]:
        print(f"    - {sf}  ({', '.join(sorted(loose[sf]))})")
    print(f"  Rows with no source_file (can't be matched to a sheet; review by hand): {null_source}")
    print(f"  Cached files with no Drive sheet: {len(orphans)}")
    for o in orphans:
        rows = len(db_dates.get(norm(o), []))
        print(f"    - {o.name}  ({rows} f_mobility row(s))")

    if not args.apply:
        print("\nDry run - nothing changed. Re-run with --apply.")
        conn.close()
        return

    # ---- apply ---------------------------------------------------------------
    print("\nStep 1: Drive sidecars + downloads")
    res = download_missing_sheets(excel_directory=excel_directory, gsheet_directory=gsheet_directory,
                                  credentials_path=str(credentials_path))
    print(f"  downloaded {res.get('downloaded', 0)}, failed {res.get('failed', 0)}")

    stale_dir = excel_dir / "_stale"
    if orphans:
        stale_dir.mkdir(exist_ok=True)
        with conn.cursor() as cur:
            for o in orphans:
                if args.delete_orphans:
                    cur.execute("DELETE FROM public.f_mobility WHERE lower(source_file) = lower(%s)", (norm(o),))
                    print(f"  deleted {cur.rowcount} row(s) for {o.name}")
                for side in (o, Path(str(o) + ".date"), Path(str(o) + ".meta.json")):
                    if side.exists():
                        shutil.move(str(side), str(stale_dir / side.name))
        conn.commit()
    conn.close()

    print("\nStep 2: re-ingest every cached sheet")
    os.environ.setdefault("AUTOMATED_RUN", "1")
    report = mob.process_mobility_directory(excel_directory, force=True, drive_result=res) or {}
    print(f"\nNeeds attention: {len(report.get('critical', []))} critical, {len(report.get('warnings', []))} warning(s) - details in {mob.RUN_REPORT_FILE}")
    print("\nDone. The coach view caches mobility percentiles for an hour; restart the dev server to see changes at once.")


if __name__ == "__main__":
    main()
