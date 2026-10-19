#!/usr/bin/env python3
"""
TrackMan portal -> warehouse, unattended (no browser window, keeps the PC awake while it runs).

    run_trackman.py nightly            pull + load everything since the last good run (Task Scheduler runs this)
    run_trackman.py backfill           pull + load month by month, newest first, resumable
    run_trackman.py backfill --year 2025      one calendar year (about a day per busy year)
    run_trackman.py backfill --from 2024-01-01
    run_trackman.py status             what's done, what's left
    run_trackman.py login              open the portal to sign in again (when a run says the sign-in expired)

Run from the repo root with the uais venv:
    uais\\venv\\Scripts\\python.exe uais\\python\\trackman\\run_trackman.py backfill

Everything lands in trackman_out/:
    runs/<nightly-YYYY-MM-DD | backfill-YYYY-MM>/   sessions.json, pitches.jsonl, validation.json, summary.json, load_summary.json
    logs/trackman_YYYY-MM-DD.log                    full output of every run that day
    state.json                                      which months are done, last good nightly
    NEEDS_LOGIN.txt                                 present when the saved sign-in has expired

Backfill without --from walks back until it finds 6 months in a row with no pitching
sessions. A month counts as done only when every pitcher pulled cleanly and the load
succeeded; otherwise the next backfill run retries just what's missing (up to 3 tries).
Nightly and backfill share one browser profile, so they can't run at the same time:
whichever starts second exits with code 3 and says so in the log.
"""
from __future__ import annotations

import argparse
import calendar
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # repo root: uais/python/trackman -> repo
OUT = ROOT / "trackman_out"
PROFILE = ROOT / ".trackman_profile"
PULL = HERE / "trackman_pull.py"
LOAD = HERE / "load_trackman_pull.py"
STATE = OUT / "state.json"
LOGS = OUT / "logs"

EMPTY_MONTHS_TO_STOP = 6
MAX_MONTH_ATTEMPTS = 3
NIGHTLY_OVERLAP_DAYS = 2      # re-check the last couple of days (sessions left open overnight)
NIGHTLY_MIN_DAYS = 3
NIGHTLY_MAX_DAYS = 60

_log_file = None


def log(msg: str) -> None:
    line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    if _log_file:
        _log_file.write(line + "\n")
        _log_file.flush()


def open_log() -> None:
    global _log_file
    LOGS.mkdir(parents=True, exist_ok=True)
    _log_file = open(LOGS / f"trackman_{date.today():%Y-%m-%d}.log", "a", encoding="utf-8")
    for old in sorted(LOGS.glob("trackman_*.log"))[:-90]:  # keep ~3 months of logs
        try:
            old.unlink()
        except OSError:
            pass


def keep_awake(on: bool) -> None:
    """Windows: don't let the PC go to sleep while a run is going (the screen may still turn off)."""
    if os.name != "nt":
        return
    import ctypes
    ES_CONTINUOUS, ES_SYSTEM_REQUIRED, ES_AWAYMODE_REQUIRED = 0x80000000, 0x00000001, 0x00000040
    flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED if on else 0)
    if not ctypes.windll.kernel32.SetThreadExecutionState(flags) and on:
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(st: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, default=str))
    tmp.replace(STATE)


def read_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def run(cmd: list[str]) -> int:
    """Run a step, streaming its output to the console and the day's log."""
    env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", env=env)
    for line in proc.stdout:
        line = line.rstrip()
        print(line, flush=True)
        if _log_file:
            _log_file.write(line + "\n")
            _log_file.flush()
    return proc.wait()


def pull(from_d: date, to_d: date, run_dir: Path, show: bool) -> int:
    cmd = [sys.executable, "-u", str(PULL), "--out", str(OUT), "--profile", str(PROFILE),
           "--from", from_d.isoformat(), "--to", to_d.isoformat(), "--run-dir", str(run_dir)]
    if not show:
        cmd.append("--headless")
    return run(cmd)


def load(run_dir: Path) -> int:
    pj = run_dir / "pitches.jsonl"
    if not pj.exists() or pj.stat().st_size == 0:
        log("  nothing new to load")
        return 0
    return run([sys.executable, "-u", str(LOAD), "--dir", str(run_dir)])


def handle_pull_rc(rc: int) -> int | None:
    """Fatal pull results stop the whole run. Returns an exit code, or None to carry on."""
    if rc == 2:
        (OUT / "NEEDS_LOGIN.txt").write_text(
            f"{datetime.now():%Y-%m-%d %H:%M} The saved TrackMan sign-in expired.\n"
            "Run:  uais\\venv\\Scripts\\python.exe uais\\python\\trackman\\run_trackman.py login\n"
            "then the next scheduled run picks up where it left off.\n")
        log("SIGN-IN EXPIRED. Run `run_trackman.py login`, then re-run. (See trackman_out/NEEDS_LOGIN.txt)")
        return 2
    if rc == 3:
        log("Another TrackMan run is using the browser profile (backfill still going?). Skipping this run.")
        return 3
    return None


def month_ranges(newest: date, oldest: date):
    y, m = newest.year, newest.month
    while (y, m) >= (oldest.year, oldest.month):
        first = date(y, m, 1)
        last = date(y, m, calendar.monthrange(y, m)[1])
        yield f"{y:04d}-{m:02d}", max(first, oldest), min(last, newest)
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)


# ---------------------------------------------------------------------------

def cmd_nightly(args) -> int:
    st = load_state()
    today = date.today()
    start = today - timedelta(days=NIGHTLY_MIN_DAYS)
    last_ok = st.get("last_ok_to")
    if last_ok:
        start = min(start, date.fromisoformat(last_ok) - timedelta(days=NIGHTLY_OVERLAP_DAYS))
    start = max(start, today - timedelta(days=NIGHTLY_MAX_DAYS))
    run_dir = OUT / "runs" / f"nightly-{today:%Y-%m-%d}"
    log(f"NIGHTLY {start} -> {today}")
    rc = pull(start, today, run_dir, args.show)
    fatal = handle_pull_rc(rc)
    if fatal is not None:
        return fatal
    summ = read_json(run_dir / "summary.json", {})
    lrc = load(run_dir)
    if lrc != 0:
        log(f"LOAD FAILED (exit {lrc}); the pulled pitches are kept in {run_dir} and load next time")
        return 5
    if rc == 0 and not summ.get("errors"):
        st["last_ok_to"] = today.isoformat()
        st["last_nightly"] = {"at": datetime.now().isoformat(timespec="seconds"), "from": start.isoformat(), **summ}
        save_state(st)
        (OUT / "NEEDS_LOGIN.txt").unlink(missing_ok=True)
        log(f"NIGHTLY OK: {summ.get('ok', 0)} pitcher-sessions pulled, {summ.get('sessions', 0)} sessions")
        return 0
    log(f"NIGHTLY PARTIAL (pull exit {rc}, {summ.get('errors', '?')} errors); tomorrow's run re-covers these days")
    return 4


def cmd_backfill(args) -> int:
    st = load_state()
    months = st.setdefault("backfill", {})
    newest = date.fromisoformat(args.to) if args.to else date.today()
    oldest = date.fromisoformat(args.from_date) if args.from_date else date(2015, 1, 1)
    log(f"BACKFILL {newest} back to {args.from_date or 'the first month with sessions'}")
    empty_streak = 0
    worked = 0
    for key, a, b in month_ranges(newest, oldest):
        m = months.get(key, {})
        if m.get("status") == "done" and not args.rescan:
            empty_streak = empty_streak + 1 if m.get("sessions") == 0 else 0
            if not args.from_date and empty_streak >= EMPTY_MONTHS_TO_STOP:
                break
            continue
        if m.get("attempts", 0) >= MAX_MONTH_ATTEMPTS and not (args.retry or args.rescan):
            log(f"{key}: skipped after {m['attempts']} tries ({m.get('note')}); `backfill --retry` to try again")
            continue
        run_dir = OUT / "runs" / f"backfill-{key}"
        log(f"--- {key} ({a} -> {b})")
        rc = pull(a, b, run_dir, args.show)
        fatal = handle_pull_rc(rc)
        if fatal is not None:
            save_state(st)
            return fatal
        summ = read_json(run_dir / "summary.json", {})
        lrc = load(run_dir)
        m = {**m, "attempts": m.get("attempts", 0) + 1, "sessions": summ.get("sessions"),
             "pulled": summ.get("ok"), "errors": summ.get("errors"), "at": datetime.now().isoformat(timespec="seconds")}
        if rc == 0 and lrc == 0 and not summ.get("errors"):
            m.update(status="done", note=None)
            if key == f"{newest:%Y-%m}":
                st["last_ok_to"] = max(st.get("last_ok_to") or "", newest.isoformat())
        else:
            m.update(status="partial", note=f"pull exit {rc}, load exit {lrc}, {summ.get('errors', '?')} errors")
        months[key] = m
        save_state(st)
        worked += 1
        log(f"{key}: {m['status']} - {summ.get('sessions', 0)} sessions, {summ.get('ok', 0)} pitcher-sessions pulled"
            + (f" ({m['note']})" if m.get("note") else ""))
        if m["status"] == "done" and summ.get("sessions") == 0:
            empty_streak += 1
            if not args.from_date and empty_streak >= EMPTY_MONTHS_TO_STOP:
                log(f"No pitching sessions for {EMPTY_MONTHS_TO_STOP} months before {key}; treating that as the start of the data.")
                break
        else:
            empty_streak = 0
    in_range = {k for k, _, _ in month_ranges(newest, oldest)}
    left = [k for k, v in months.items() if v.get("status") != "done" and k in in_range]
    log(f"BACKFILL finished this pass ({worked} months worked). " + (f"Not done yet: {', '.join(sorted(left))}" if left else "All months done."))
    return 0 if not left else 4


def cmd_status(args) -> int:
    st = load_state()
    print(f"Last good nightly / covered through: {st.get('last_ok_to') or '-'}")
    if st.get("last_nightly"):
        print(f"Last nightly: {st['last_nightly']}")
    if (OUT / "NEEDS_LOGIN.txt").exists():
        print("!! Sign-in expired: run `run_trackman.py login`")
    for key, m in sorted(st.get("backfill", {}).items(), reverse=True):
        print(f"  {key}  {m.get('status', '?'):<8} sessions={m.get('sessions')} pulled={m.get('pulled')} "
              f"errors={m.get('errors')} tries={m.get('attempts')} {m.get('note') or ''}")
    return 0


def cmd_login(args) -> int:
    rc = run([sys.executable, "-u", str(PULL), "--login", "--out", str(OUT), "--profile", str(PROFILE)])
    if rc == 0:
        (OUT / "NEEDS_LOGIN.txt").unlink(missing_ok=True)
    return rc


def main() -> int:
    # Names can contain emoji (e.g. "Jimmy 🦴 Morgan"); a Windows console or a
    # redirected log defaults to cp1252 and would crash on them.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("nightly")
    n.add_argument("--show", action="store_true", help="show the browser window (debugging)")
    b = sub.add_parser("backfill")
    b.add_argument("--year", type=int, help="one calendar year, e.g. 2025 (same as --from 2025-01-01 --to 2025-12-31)")
    b.add_argument("--from", dest="from_date", help="YYYY-MM-DD; default: walk back until 6 empty months")
    b.add_argument("--to", help="YYYY-MM-DD; default: today")
    b.add_argument("--retry", action="store_true", help="also retry months that failed 3 times")
    b.add_argument("--rescan", action="store_true",
                   help="walk months already marked done again; pitcher-sessions already pulled are skipped (done.json)")
    b.add_argument("--show", action="store_true", help="show the browser window (debugging)")
    sub.add_parser("status")
    sub.add_parser("login")
    args = ap.parse_args()

    if args.cmd == "backfill" and args.year:
        args.from_date = f"{args.year}-01-01"
        args.to = min(date(args.year, 12, 31), date.today()).isoformat()
    if args.cmd == "status":
        return cmd_status(args)
    if args.cmd == "login":
        return cmd_login(args)
    open_log()
    keep_awake(True)
    try:
        return cmd_nightly(args) if args.cmd == "nightly" else cmd_backfill(args)
    except KeyboardInterrupt:
        log("Stopped by hand. Re-run the same command to continue where it left off.")
        return 130
    finally:
        keep_awake(False)


if __name__ == "__main__":
    sys.exit(main())
