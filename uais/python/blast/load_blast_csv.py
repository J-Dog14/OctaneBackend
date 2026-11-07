#!/usr/bin/env python3
"""
Load Blast Motion team-portal CSV exports into the warehouse and work out who swung.

    python uais/python/blast/load_blast_csv.py --dir blast_out --move-loaded   # nightly: every new CSV, then file it in blast_out/loaded
    python uais/python/blast/load_blast_csv.py --file All_swings_by_player_1793987718430.csv
    python uais/python/blast/load_blast_csv.py --dir blast_out --dry-run   # parse + attribute, write nothing
    python uais/python/blast/load_blast_csv.py --reattribute --since 2026-11-01
    python uais/python/blast/load_blast_csv.py --report                    # swings that need a look
    python uais/python/blast/load_blast_csv.py --manual 664 "2026-11-04 15:10" "2026-11-04 15:40" <athlete_uuid>

What it writes (schema: uais/sql/create_hitting_intel_schema.sql, `npm run blast:setup`)
  hitting_intel.blast_sensors   any serial not registered yet (label = last 3 digits)
  hitting_intel.blast_swings    one row per captureid; re-downloads update the metrics only
  hitting_intel.ingest_runs     one row per file (a file with the same sha256 is skipped)

Attribution (python/blast/attribution.py) runs after every load over the dates the files
touched plus the last --days days (default 14), so assignment fixes made in the coach portal
(/coach/blast) are picked up on the next night. Swings set by --manual are never changed.

Every row's first/last name is the Blast account owner (individual subscription) and is
ignored for attribution. Timestamps in the export are UTC.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve()
UAIS = HERE.parents[2]          # .../uais
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / "python"))

import psycopg2  # noqa: E402
from psycopg2.extras import Json, RealDictCursor, execute_values  # noqa: E402

from python.blast.attribution import Assignment, Swing, attribute  # noqa: E402
from python.blast.blast_csv import LOCAL_TZ, BlastCsvError, default_label, file_sha256, read_blast_csv  # noqa: E402

SWING_COLS = [
    "capture_id", "swing_at", "local_date", "sensor_serial", "blast_user_id", "blast_user_name",
    "environment", "bat_nickname", "action_type",
    "bat_speed_mph", "peak_hand_speed_mph", "rotational_accel_g", "power_kw", "on_plane_efficiency_pct",
    "attack_angle_deg", "vertical_bat_angle_deg", "time_to_contact_s", "commit_time_s",
    "early_connection_deg", "hinge_angle_at_impact_deg", "connection_at_impact_deg", "body_tilt_deg",
    "uploaded_at", "raw", "source_file", "ingest_run_id",
]
UPSERT_SWINGS = f"""
INSERT INTO hitting_intel.blast_swings ({", ".join(SWING_COLS)})
VALUES %s
ON CONFLICT (capture_id) DO UPDATE SET
  {", ".join(f"{c} = EXCLUDED.{c}" for c in SWING_COLS if c != "capture_id")},
  updated_at = NOW()
RETURNING (xmax = 0) AS inserted
"""


def connect():
    url = os.environ.get("BLAST_DATABASE_URL")   # tests / one-off runs against a branch
    if url:
        return psycopg2.connect(url, connect_timeout=10)
    from python.common.athlete_manager import get_warehouse_connection
    return get_warehouse_connection()


def q(conn, sql, *params):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


def settings(conn) -> tuple[int, int]:
    r = q(conn, "SELECT hitting_intel.blast_idle_minutes() AS idle, hitting_intel.blast_grace_seconds() AS grace")[0]
    return int(r["idle"]), int(r["grace"])


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def ensure_sensors(conn, serials: set[str], first_last: dict[str, tuple[datetime, datetime]]) -> list[str]:
    """Register unknown serials; widen first/last swing times. -> labels of new sensors."""
    rows = q(conn, "SELECT serial, label FROM hitting_intel.blast_sensors")
    known = {r["serial"] for r in rows}
    taken = {r["label"] for r in rows}
    new = []
    with conn.cursor() as cur:
        for serial in sorted(serials - known):
            label = default_label(serial, taken)
            taken.add(label)
            cur.execute("""INSERT INTO hitting_intel.blast_sensors (serial, label, registered_by, notes)
                           VALUES (%s, %s, 'blast-csv', 'auto-registered from a Blast export; rename it in the coach portal')
                           ON CONFLICT (serial) DO NOTHING""", (serial, label))
            new.append(f"{label} ({serial})")
        for serial, (lo, hi) in first_last.items():
            cur.execute("""UPDATE hitting_intel.blast_sensors
                              SET first_swing_at = LEAST(COALESCE(first_swing_at, %s), %s),
                                  last_swing_at = GREATEST(COALESCE(last_swing_at, %s), %s), updated_at = NOW()
                            WHERE serial = %s""", (lo, lo, hi, hi, serial))
    return new


def load_file(conn, path: Path, dry_run: bool, force: bool) -> dict:
    sha = file_sha256(path)
    if not force:
        done = q(conn, "SELECT id, finished_at FROM hitting_intel.ingest_runs WHERE source = 'blast_csv' AND file_sha256 = %s AND status IN ('ok','flagged') LIMIT 1", sha)
        if done:
            return {"file": path.name, "skipped": f"already loaded (run #{done[0]['id']})"}
    rows, warnings = read_blast_csv(path)
    dates = sorted({r["local_date"] for r in rows})
    summary = {"file": path.name, "rows": len(rows), "dates": [str(d) for d in dates], "warnings": warnings}
    owners = Counter(r.get("blast_user_name") for r in rows)
    summary["blast_accounts"] = dict(owners)
    summary["sensors"] = dict(Counter(r["sensor_serial"] for r in rows))
    if dry_run:
        return summary

    run_id = q(conn, """INSERT INTO hitting_intel.ingest_runs (source, file_name, file_sha256, rows_read)
                        VALUES ('blast_csv', %s, %s, %s) RETURNING id""", path.name, sha, len(rows))[0]["id"]
    conn.commit()
    try:
        first_last: dict[str, tuple[datetime, datetime]] = {}
        for r in rows:
            lo, hi = first_last.get(r["sensor_serial"], (r["swing_at"], r["swing_at"]))
            first_last[r["sensor_serial"]] = (min(lo, r["swing_at"]), max(hi, r["swing_at"]))
        summary["new_sensors"] = ensure_sensors(conn, set(first_last), first_last)
        values = []
        for r in rows:
            r = {**r, "raw": Json(r["raw"]), "source_file": path.name, "ingest_run_id": run_id}
            values.append(tuple(r.get(c) for c in SWING_COLS))
        inserted = updated = 0
        with conn.cursor() as cur:
            for k in range(0, len(values), 500):
                res = execute_values(cur, UPSERT_SWINGS, values[k:k + 500], fetch=True)
                n_ins = sum(1 for (ins,) in res if ins)
                inserted += n_ins
                updated += len(res) - n_ins
            cur.execute("""UPDATE hitting_intel.ingest_runs SET rows_inserted = %s, rows_updated = %s,
                                  status = %s, checks = %s, finished_at = NOW() WHERE id = %s""",
                        (inserted, updated, "flagged" if warnings else "ok",
                         Json({"warnings": warnings, "dates": summary["dates"], "sensors": summary["sensors"]}), run_id))
        conn.commit()
        summary.update(inserted=inserted, updated=updated, run_id=run_id)
        return summary
    except Exception as e:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("UPDATE hitting_intel.ingest_runs SET status = 'failed', error = %s, finished_at = NOW() WHERE id = %s", (str(e)[:2000], run_id))
        conn.commit()
        raise


# ---------------------------------------------------------------------------
# Attribution
# ---------------------------------------------------------------------------

def day_bounds(d0: date, d1: date) -> tuple[datetime, datetime]:
    lo = datetime(d0.year, d0.month, d0.day, tzinfo=LOCAL_TZ)
    hi = datetime(d1.year, d1.month, d1.day, tzinfo=LOCAL_TZ) + timedelta(days=1)
    return lo, hi


def reattribute(conn, dates: set[date], dry_run: bool = False, preview_rows: list[dict] | None = None) -> dict:
    """Recompute attribution for every swing on these local dates. -> counts."""
    if not dates and not preview_rows:
        return {}
    idle, grace = settings(conn)
    swings: list[Swing] = []
    current: dict[str, dict] = {}
    if dates:
        for r in q(conn, """SELECT capture_id, sensor_serial, swing_at, attribution, athlete_uuid, assignment_id, attribution_note
                              FROM hitting_intel.blast_swings WHERE local_date = ANY(%s)""", sorted(dates)):
            current[r["capture_id"]] = r
            swings.append(Swing(r["capture_id"], r["sensor_serial"], r["swing_at"], r["attribution"], r["athlete_uuid"]))
    for r in preview_rows or []:   # dry run: rows not in the database yet
        if r["capture_id"] not in current:
            swings.append(Swing(r["capture_id"], r["sensor_serial"], r["swing_at"]))
    if not swings:
        return {}
    lo = min(s.swing_at for s in swings)
    hi = max(s.swing_at for s in swings)
    # Assignments that could cover them: started before the last swing (+grace), not ended before the first.
    ases = [Assignment(a["id"], a["sensor_serial"], a["athlete_uuid"], a["started_at"], a["ended_at"], a["voided"])
            for a in q(conn, """SELECT id, sensor_serial, athlete_uuid, started_at, ended_at, voided
                                  FROM hitting_intel.blast_assignments
                                 WHERE started_at <= %s AND (ended_at IS NULL OR ended_at >= %s - INTERVAL '1 day')""",
                       hi + timedelta(seconds=grace), lo)]
    results = attribute(swings, ases, idle_minutes=idle, grace_seconds=grace, tz=LOCAL_TZ)
    counts = Counter(r.attribution for r in results.values())
    changes = []
    for cid, res in results.items():
        cur = current.get(cid)
        if res.attribution == "manual":
            continue
        if cur and (cur["attribution"], cur["athlete_uuid"], cur["assignment_id"], cur["attribution_note"]) == \
                (res.attribution, res.athlete_uuid, res.assignment_id, res.note):
            continue
        changes.append((cid, res.athlete_uuid, res.assignment_id, res.attribution, res.note))
    if changes and not dry_run and current:
        with conn.cursor() as cur:
            execute_values(cur, """UPDATE hitting_intel.blast_swings s
                                      SET athlete_uuid = v.athlete_uuid, assignment_id = v.assignment_id::bigint,
                                          attribution = v.attribution, attribution_note = v.note,
                                          attributed_at = NOW(), updated_at = NOW()
                                     FROM (VALUES %s) AS v(capture_id, athlete_uuid, assignment_id, attribution, note)
                                    WHERE s.capture_id = v.capture_id AND s.attribution <> 'manual'""",
                           [c for c in changes if c[0] in current], template="(%s, %s, %s, %s, %s)")
        conn.commit()
    return {"swings": len(results), "changed": len(changes), **dict(counts)}


def set_manual(conn, sensor: str, t0: str, t1: str, athlete_uuid: str | None) -> int:
    """Pin swings on one sensor in a local-time window to an athlete (or 'clear' to release them)."""
    serial = q(conn, "SELECT serial FROM hitting_intel.blast_sensors WHERE serial = %s OR label = %s", sensor, sensor)
    if not serial:
        raise SystemExit(f"Unknown sensor {sensor!r} (use the serial or the label)")
    lo = datetime.fromisoformat(t0).replace(tzinfo=LOCAL_TZ)
    hi = datetime.fromisoformat(t1).replace(tzinfo=LOCAL_TZ)
    with conn.cursor() as cur:
        if athlete_uuid in (None, "clear"):
            cur.execute("""UPDATE hitting_intel.blast_swings SET attribution = 'unassigned', athlete_uuid = NULL, assignment_id = NULL,
                                  attribution_note = 'manual cleared', attributed_at = NOW(), updated_at = NOW()
                            WHERE sensor_serial = %s AND swing_at >= %s AND swing_at < %s AND attribution = 'manual'""",
                        (serial[0]["serial"], lo, hi))
        else:
            cur.execute("SELECT name FROM analytics.d_athletes WHERE athlete_uuid = %s", (athlete_uuid,))
            row = cur.fetchone()
            if not row:
                raise SystemExit(f"No athlete {athlete_uuid}")
            cur.execute("""UPDATE hitting_intel.blast_swings SET attribution = 'manual', athlete_uuid = %s, assignment_id = NULL,
                                  attribution_note = %s, attributed_at = NOW(), updated_at = NOW()
                            WHERE sensor_serial = %s AND swing_at >= %s AND swing_at < %s""",
                        (athlete_uuid, f"set by hand to {row[0]}", serial[0]["serial"], lo, hi))
        n = cur.rowcount
    conn.commit()
    if athlete_uuid in (None, "clear"):
        reattribute(conn, {lo.date(), hi.date()})
    return n


def report(conn, days: int = 30) -> None:
    rows = q(conn, """SELECT s.local_date, b.label, s.attribution, COUNT(*) AS n,
                             MIN(s.swing_at) AS first_at, MAX(s.swing_at) AS last_at, MIN(s.attribution_note) AS note
                        FROM hitting_intel.blast_swings s JOIN hitting_intel.blast_sensors b ON b.serial = s.sensor_serial
                       WHERE s.attribution IN ('stale', 'unassigned', 'conflict') AND s.local_date >= CURRENT_DATE - %s
                       GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3""", days)
    if not rows:
        print(f"Nothing to review in the last {days} days.")
        return
    print(f"Swings without an athlete (last {days} days):")
    for r in rows:
        t0 = r["first_at"].astimezone(LOCAL_TZ).strftime("%H:%M")
        t1 = r["last_at"].astimezone(LOCAL_TZ).strftime("%H:%M")
        print(f"  {r['local_date']}  sensor {r['label']:<6} {r['attribution']:<10} {r['n']:>4} swings  {t0}-{t1}  {r['note'] or ''}")
    print('\nFix: assign the sensor in the coach portal for that time, or\n'
          '     --manual <sensor> "YYYY-MM-DD HH:MM" "YYYY-MM-DD HH:MM" <athlete_uuid>')


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", help="folder of Blast CSV exports (every *.csv not loaded yet)")
    ap.add_argument("--file", action="append", default=[], help="one export (repeatable)")
    ap.add_argument("--dry-run", action="store_true", help="parse and attribute, write nothing")
    ap.add_argument("--force", action="store_true", help="load a file again even if its sha256 was loaded before")
    ap.add_argument("--move-loaded", action="store_true",
                    help="with --dir: move each file that loaded (or was already loaded) into <dir>/loaded/")
    ap.add_argument("--days", type=int, default=14, help="also re-attribute the last N days (default 14)")
    ap.add_argument("--reattribute", action="store_true", help="only re-run attribution (with --since)")
    ap.add_argument("--since", help="with --reattribute: first local date (YYYY-MM-DD)")
    ap.add_argument("--report", action="store_true", help="list swings without an athlete")
    ap.add_argument("--manual", nargs=4, metavar=("SENSOR", "FROM", "TO", "ATHLETE_UUID"),
                    help='pin swings in a local-time window to an athlete ("clear" releases them)')
    args = ap.parse_args()

    conn = connect()
    try:
        if q(conn, "SELECT to_regclass('hitting_intel.blast_swings') AS t")[0]["t"] is None:
            print("hitting_intel.blast_swings doesn't exist yet. Run `npm run blast:setup` first.")
            return 2
        if args.report:
            report(conn)
            return 0
        if args.manual:
            n = set_manual(conn, *args.manual)
            print(f"{n} swing(s) updated.")
            return 0
        today = datetime.now(LOCAL_TZ).date()
        recent = {today - timedelta(days=k) for k in range(args.days + 1)}
        if args.reattribute:
            start = date.fromisoformat(args.since) if args.since else today - timedelta(days=args.days)
            dates = {start + timedelta(days=k) for k in range((today - start).days + 1)}
            print(json.dumps(reattribute(conn, dates, dry_run=args.dry_run), indent=1, default=str))
            return 0

        files = [Path(f) for f in args.file]
        if args.dir:
            files += sorted(p for p in Path(args.dir).glob("*.csv") if p.is_file())
        if not files:
            ap.error("give --dir or --file (or --reattribute / --report / --manual)")
        touched: set[date] = set()
        failed = 0
        preview: list[dict] = []
        for f in files:
            try:
                s = load_file(conn, f, args.dry_run, args.force)
            except (BlastCsvError, psycopg2.Error, OSError) as e:
                failed += 1
                print(f"FAILED {f.name}: {e}")
                continue
            print(json.dumps(s, indent=1, default=str))
            touched |= {date.fromisoformat(d) for d in s.get("dates", [])}
            if args.move_loaded and args.dir and not args.dry_run and f.parent.resolve() == Path(args.dir).resolve():
                done_dir = f.parent / "loaded"
                done_dir.mkdir(exist_ok=True)
                target = done_dir / f.name
                if target.exists():
                    target = done_dir / f"{f.stem}_{datetime.now().strftime('%Y%m%d%H%M%S')}{f.suffix}"
                f.replace(target)
            if args.dry_run and "rows" in s:
                preview += read_blast_csv(f)[0]
        attr = reattribute(conn, touched | recent, dry_run=args.dry_run, preview_rows=preview if args.dry_run else None)
        print("Attribution:", json.dumps(attr, default=str))
        if attr.get("stale") or attr.get("unassigned"):
            print("Some swings have no athlete. `--report` lists them.")
        if args.dry_run:
            print("\nDry run: nothing was written.")
        return 1 if failed else 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
