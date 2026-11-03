"""
Morning status for the 8ctane nightly jobs.

Reads the logs each nightly job already writes, plus Windows Task Scheduler,
and pops open one page summarising last night:

  Mobility        uais/python/mobility/daily_run.log + uais/data/mobility_last_run.json
  Proteus         uais/python/proteus/daily_run.log  + uais/python/proteus/logs/proteus_YYYYMMDD.log
  TrackMan        trackman_out/logs/task_console.log
  3D/TM pairing   trackman_out/logs/task_console.log (step inside run_nightly.bat)
  xArsenal        trackman_out/logs/task_console.log (step inside run_nightly.bat)
  Program data    ../OctaneAiLayer/outputs/app_db_sync.log (App DB snapshot)

Stdlib only. Read-only: never touches a database or re-runs a job.

  python morning_status.py                 # build + open the page
  python morning_status.py --no-open       # build only
  python morning_status.py --date 2026-11-03   # pretend "this morning" is that date
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]                      # OctaneBiomechBackend
UAIS = ROOT / "uais"
AI_LAYER = ROOT.parent / "OctaneAiLayer"
OUT_DIR = UAIS / "data" / "nightly_status"

# Windows Task Scheduler names (pairing + xArsenal ride inside the TrackMan task)
TASKS = {
    "mobility": "UAIS Mobility Assessment Processing",
    "proteus": "UAIS Proteus Processing",
    "trackman": "UAIS TrackMan Nightly",
    "pairing": "UAIS TrackMan Nightly",
    "xarsenal": "UAIS TrackMan Nightly",
    "programs": "8ctane App DB Sync",
}

# "Tue 11/03/2026  2:00:43.84 - message"   (cmd.exe %date% %time%)
BAT_LINE = re.compile(r"^\w{3} (\d\d/\d\d/\d{4})\s+(\d{1,2}:\d\d:\d\d)(?:\.\d+)?\s+-\s+(.*)$")


# ---------------------------------------------------------------- helpers
def read_lines(p: Path) -> list[str]:
    try:
        return p.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        return []


def bat_events(lines: list[str]):
    """(index, datetime, message) for every timestamped line a .bat wrote."""
    for i, ln in enumerate(lines):
        m = BAT_LINE.match(ln.strip())
        if m:
            try:
                ts = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%m/%d/%Y %H:%M:%S")
            except ValueError:
                continue
            yield i, ts, m.group(3).strip()


def last_run(lines, since, start_pat, end_pat):
    """Last run started after `since`: (start_ts, end_ts, end_msg, start_idx, end_idx)."""
    ev = list(bat_events(lines))
    until = since + timedelta(hours=24)
    starts = [(i, t, m) for i, t, m in ev if since <= t < until and re.search(start_pat, m)]
    if not starts:
        return None
    si, st, _ = starts[-1]
    for i, t, m in ev:
        if i > si and re.search(end_pat, m):
            return st, t, m, si, i
    return st, None, None, si, None


def fmt_t(t: datetime | None) -> str:
    return t.strftime("%a %H:%M") if t else "—"


def dur(a, b) -> str:
    if not a or not b:
        return ""
    s = int((b - a).total_seconds())
    return f"{s // 3600}h {s % 3600 // 60}m" if s >= 3600 else f"{s // 60}m {s % 60}s"


def job(key, name, status, headline, details=None, started=None, ended=None, fix=None):
    return dict(key=key, name=name, status=status, headline=headline, details=details or [],
                started=started, ended=ended, fix=fix)


# ---------------------------------------------------------------- checks
def check_mobility(since):
    lines = read_lines(UAIS / "python/mobility/daily_run.log")
    r = last_run(lines, since, r"Mobility processing started", r"Mobility processing (completed|finished|FAILED)")
    if not r:
        return job("mobility", "Mobility", "missing", "Didn't run last night",
                   fix="Check Task Scheduler → 'UAIS Mobility Assessment Processing'. It uses Interactive logon, so it only runs while you're signed in.")
    st, et, msg, *_ = r
    if not et:
        return job("mobility", "Mobility", "fail", "Started but never finished (killed, crashed or still running)", started=st)
    details, fix = [], None
    summary = {}
    try:
        summary = json.loads((UAIS / "data/mobility_last_run.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    try:
        fresh = datetime.fromisoformat(summary.get("run_at", "")) >= st - timedelta(minutes=1)
    except ValueError:
        fresh = False
    if fresh:
        d = summary.get("drive", {})
        details.append(f"{summary.get('files_processed', 0)} sheet(s) checked, {d.get('downloaded', 0)} downloaded from Drive"
                       + ("" if d.get("ok", True) else f" — Drive error: {d.get('error')}"))
        if summary.get("new_athletes"):
            details.append(f"New athletes: {', '.join(map(str, summary['new_athletes']))}")
        if summary.get("possible_duplicate_athletes"):
            details.append(f"Possible duplicates: {len(summary['possible_duplicate_athletes'])}")
        errs = summary.get("errors", [])
        no_name = [e["file"] for e in errs if "No name found" in str(e.get("error"))]
        other = [e for e in errs if e["file"] not in no_name]
        if no_name:
            details.append(f"{len(no_name)} sheet(s) with no athlete name (same files fail every night): " + "; ".join(no_name))
            fix = "Fill in the athlete name on those sheets in Drive, or move them out of the mobility folder, and this warning clears."
        for e in other:
            details.append(f"{e['file']}: {e.get('error')}")
        for w in summary.get("warnings", []):
            details.append(f"Warning: {w}")
    if "completed successfully" in msg:
        return job("mobility", "Mobility", "ok", "Ran clean", details, st, et)
    if "NEEDS ATTENTION" in msg:
        n_new = sum(1 for ln in lines[r[3]:r[4]] if "Inserted new record" in ln)
        head = f"Ran — {n_new} new assessment(s) loaded, but some sheets need attention"
        return job("mobility", "Mobility", "warn", head, details, st, et, fix)
    tail = [ln for ln in lines[r[3]:r[4]] if ln.strip()][-6:]
    return job("mobility", "Mobility", "fail", msg, details + tail, st, et)


def check_proteus(since):
    lines = read_lines(UAIS / "python/proteus/daily_run.log")
    r = last_run(lines, since, r"Proteus processing started", r"Proteus processing (completed|FAILED)")
    if not r:
        return job("proteus", "Proteus", "missing", "Didn't run last night",
                   fix="Check Task Scheduler → 'UAIS Proteus Processing'.")
    st, et, msg, si, ei = r
    if not et:
        return job("proteus", "Proteus", "fail", "Started but never finished", started=st)
    seg = lines[si:ei]
    processed = failed = empty = 0
    for ln in seg:
        if m := re.search(r"Processed: (\d+) files", ln): processed = int(m.group(1))
        if m := re.search(r"Failed: (\d+) files", ln): failed = int(m.group(1))
        if "File is empty" in ln: empty += 1
    details = [f"{processed} export(s) loaded, {failed} failed"]
    if empty:
        details.append(f"{empty} of the failures are empty exports (days with no Proteus sessions) — retried every night")
    real_fail = failed - empty
    if "FAILED" in msg:
        tail = [ln for ln in seg if ln.strip()][-8:]
        return job("proteus", "Proteus", "fail", msg, details + tail, st, et)
    if real_fail > 0:
        errs = [ln for ln in seg if "ERROR" in ln][:8]
        return job("proteus", "Proteus", "warn", f"Ran, but {real_fail} export(s) failed to load", details + errs, st, et)
    return job("proteus", "Proteus", "ok", f"Ran clean — {processed} export(s) loaded", details, st, et)


def check_trackman(since):
    lines = read_lines(ROOT / "trackman_out/logs/task_console.log")
    out = []
    r = last_run(lines, since, r"TrackMan nightly started", r"TrackMan nightly finished")
    if not r:
        out.append(job("trackman", "TrackMan", "missing", "Didn't run last night",
                       fix="Check Task Scheduler → 'UAIS TrackMan Nightly'. Runs only while you're signed in; needs wake timers on."))
        seg, after = [], len(lines)
    else:
        st, et, msg, si, ei = r
        seg = lines[si:ei] if ei else lines[si:]
        after = ei or len(lines)
        summ = [ln.split("] ", 1)[-1] for ln in seg if re.search(r"NIGHTLY (OK|PARTIAL|FAIL)|Done\. \d+ pulled|holds \d{4}-", ln)]
        not_in = [ln.strip() for ln in seg if "not in report" in ln]
        if not et:
            out.append(job("trackman", "TrackMan", "fail", "Started but never finished", summ, st))
        else:
            rc = int(m.group(1)) if (m := re.search(r"exit code (\d+)", msg)) else -1
            pulled = int(m.group(1)) if (m := re.search(r"NIGHTLY \w+: (\d+) pitcher-sessions", "\n".join(seg))) else None
            fix = None
            if not_in:
                fix = "Sessions not in the Power BI report yet are retried automatically on the next run."
            if rc == 0:
                out.append(job("trackman", "TrackMan", "ok" if not not_in else "warn",
                               f"Ran — {pulled if pulled is not None else '?'} pitcher-session(s) pulled", summ, st, et, fix))
            elif rc == 4:
                out.append(job("trackman", "TrackMan", "warn", "Partial pull — tomorrow's run re-covers the missed days", summ, st, et, fix))
            else:
                err = [ln.strip() for ln in seg if "Error" in ln or "Timeout" in ln][-3:]
                out.append(job("trackman", "TrackMan", "fail", f"Failed (exit code {rc})", summ + err, st, et,
                               "If it's a sign-in/timeout: open the TrackMan portal in the browser profile it uses and sign in again."))

    # Steps chained after the pull in run_nightly.bat
    def step(key, name, start_pat, end_pat, parse):
        rr = last_run(lines, since, start_pat, end_pat)
        if not rr:
            return job(key, name, "missing", "Didn't run last night",
                       fix="Runs at the end of run_nightly.bat (after the TrackMan pull). Added 3 Nov 2026 — first run is the night of the 3rd.")
        st, et, msg, si, ei = rr
        if not et:
            return job(key, name, "fail", "Started but never finished", started=st)
        rc = int(m.group(1)) if (m := re.search(r"exit code (\d+)", msg)) else -1
        status, head, det = parse(lines[si:ei], rc)
        return job(key, name, status, head, det, st, et)

    def parse_pairing(seg, rc):
        links = sum(int(m.group(1)) for ln in seg if (m := re.search(r"stored (\d+) link", ln)))
        sess = next((ln.strip() for ln in seg if "session(s) with 3D capture times" in ln), None)
        probs = [ln.strip() for ln in seg if "no capture_time" in ln or "Run `npm" in ln][:5]
        det = ([sess] if sess else []) + probs
        if rc != 0:
            return "fail", f"Failed (exit code {rc})", det + [ln.strip() for ln in seg if ln.strip()][-5:]
        if probs:
            return "warn", f"Ran — {links} link(s) stored, some sessions couldn't pair", det
        return "ok", f"Ran — {links} 3D↔TrackMan link(s) stored", det

    def parse_grade(seg, rc):
        line = next((ln.strip() for ln in seg if "full TrackMan read" in ln), "")
        m = re.search(r"Sent (\d+), (\d+) came back graded", line)
        if rc != 0:
            return "fail", f"Failed (exit code {rc})", [ln.strip() for ln in seg if ln.strip()][-6:]
        if m and int(m.group(1)) != int(m.group(2)):
            return "warn", f"{m.group(2)} of {m.group(1)} pitches graded", [line]
        return "ok", (f"Ran — {m.group(2)} pitch(es) graded" if m else "Ran"), [line] if line else []

    out.append(step("pairing", "3D ↔ TrackMan pairing", r"3D/TrackMan pairing started", r"3D/TrackMan pairing finished", parse_pairing))
    out.append(step("xarsenal", "xArsenal grading", r"xArsenal pitch grading started", r"xArsenal pitch grading finished", parse_grade))
    return out


def check_programs(since):
    log = AI_LAYER / "outputs/app_db_sync.log"
    lines = read_lines(log)
    if not lines:
        return job("programs", "Octane program data", "missing", "Never run — not scheduled yet",
                   fix="Register it: run setup_nightly_tasks.ps1 (adds '8ctane App DB Sync' at 3:45 AM).")
    r = last_run(lines, since, r"app db snapshot started", r"app db snapshot finished")
    if not r:
        return job("programs", "Octane program data", "missing", "Didn't run last night",
                   fix="Check Task Scheduler → '8ctane App DB Sync'.")
    st, et, msg, si, ei = r
    if not et:
        return job("programs", "Octane program data", "fail", "Started but never finished", started=st)
    rc = int(m.group(1)) if (m := re.search(r"rc=(\d+)", msg)) else -1
    seg = [ln.strip() for ln in lines[si + 1:ei] if ln.strip()]
    if rc == 0:
        return job("programs", "Octane program data", "ok", "App DB snapshot refreshed (users, programs, exercises, workout logs)", seg[-6:], st, et)
    return job("programs", "Octane program data", "fail", f"Failed (rc={rc})", seg[-8:], st, et)


# ---------------------------------------------------------------- Task Scheduler (Windows only)
def scheduler_info() -> dict[str, dict]:
    if os.name != "nt":
        return {}
    info = {}
    for tn in sorted(set(TASKS.values())):
        try:
            p = subprocess.run(["schtasks", "/query", "/tn", tn, "/fo", "LIST", "/v"],
                               capture_output=True, text=True, timeout=20)
        except Exception as e:  # noqa: BLE001
            info[tn] = {"registered": False, "error": str(e)}
            continue
        if p.returncode != 0:
            info[tn] = {"registered": False}
            continue
        d = {"registered": True}
        for ln in p.stdout.splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                k = k.strip()
                if k in ("Next Run Time", "Last Run Time", "Last Result", "Scheduled Task State", "Status", "Start Time"):
                    d.setdefault(k, v.strip())
        info[tn] = d
    return info


# ---------------------------------------------------------------- page
CSS = """
:root{--bg:#0b0d10;--card:#14181d;--line:#232a33;--fg:#f3f6f9;--mut:#9aa6b2;--accent:#5cc8ff;
--ok:#3ecf8e;--warn:#f5b84a;--fail:#ff5d5d;--miss:#8b96a3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 "Segoe UI",system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px 16px 40px}
h1{margin:0;font-size:24px}h1 span{color:var(--accent)}.sub{color:var(--mut);margin:4px 0 22px}
.strip{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
.pill{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-weight:600}
.dot{width:10px;height:10px;border-radius:50%}
.ok .dot,.dot.ok{background:var(--ok)}.warn .dot,.dot.warn{background:var(--warn)}.fail .dot,.dot.fail{background:var(--fail)}.missing .dot,.dot.missing{background:var(--miss)}
.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--miss);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.card.ok{border-left-color:var(--ok)}.card.warn{border-left-color:var(--warn)}.card.fail{border-left-color:var(--fail)}
.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.name{font-weight:700;font-size:16px}
.badge{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:6px}
.badge.ok{background:#3ecf8e22;color:var(--ok)}.badge.warn{background:#f5b84a22;color:var(--warn)}.badge.fail{background:#ff5d5d22;color:var(--fail)}.badge.missing{background:#8b96a322;color:var(--miss)}
.head{margin:6px 0 2px}.when{color:var(--mut);font-size:13px}
ul{margin:8px 0 0;padding-left:18px;color:#c9d2db;font-size:13.5px}li{margin:2px 0;word-break:break-word}
.fix{margin-top:8px;font-size:13.5px;color:var(--accent)}
.sched{color:var(--mut);font-size:12.5px;margin-top:6px}
footer{color:var(--mut);font-size:12px;margin-top:20px}
"""

LABEL = {"ok": "OK", "warn": "Check", "fail": "Failed", "missing": "Didn't run"}


def render(jobs, sched, morning: date) -> str:
    e = html.escape
    counts = {s: sum(j["status"] == s for j in jobs) for s in LABEL}
    pills = "".join(f'<div class="pill {s}"><span class="dot"></span>{counts[s]} {LABEL[s]}</div>' for s in LABEL if counts[s])
    cards = []
    for j in jobs:
        when = ""
        if j["started"]:
            when = f"{fmt_t(j['started'])} → {fmt_t(j['ended'])}" + (f" · {dur(j['started'], j['ended'])}" if j["ended"] else "")
        det = "".join(f"<li>{e(str(d))}</li>" for d in j["details"])
        s = sched.get(TASKS[j["key"]])
        sline = ""
        if s is not None:
            if not s.get("registered"):
                sline = f'<div class="sched">Task Scheduler: “{e(TASKS[j["key"]])}” is <b>not registered</b></div>'
            elif j["key"] not in ("pairing", "xarsenal"):
                sline = (f'<div class="sched">Task Scheduler: {e(s.get("Status", "?"))} · last result {e(s.get("Last Result", "?"))}'
                         f' · next run {e(s.get("Next Run Time", "?"))}</div>')
        cards.append(f"""<div class="card {j['status']}"><div class="top"><div class="name">{e(j['name'])}</div>
<span class="badge {j['status']}">{LABEL[j['status']]}</span></div>
<div class="head">{e(j['headline'])}</div><div class="when">{e(when)}</div>
{f'<ul>{det}</ul>' if det else ''}{f'<div class="fix">→ {e(j["fix"])}</div>' if j['fix'] else ''}{sline}</div>""")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nightly Status</title><style>{CSS}</style></head><body><div class="wrap">
<h1><span>8ctane</span> nightly status</h1>
<div class="sub">Night of {(morning - timedelta(days=1)).strftime('%a %b %d')} · built {datetime.now().strftime('%a %b %d %I:%M %p')}</div>
<div class="strip">{pills}</div>{''.join(cards)}
<footer>Read-only summary of the job logs. Source: uais/python/nightly_status/morning_status.py</footer></div></body></html>"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="treat this as 'this morning' (YYYY-MM-DD)")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--once", action="store_true", help="open the page only the first time per morning (scheduled runs)")
    a = ap.parse_args(argv)
    morning = date.fromisoformat(a.date) if a.date else date.today()
    since = datetime.combine(morning - timedelta(days=1), datetime.min.time()) + timedelta(hours=18)  # 6 PM the evening before

    jobs = []
    for fn in (check_proteus, check_mobility):
        try:
            jobs.append(fn(since))
        except Exception as ex:  # noqa: BLE001
            jobs.append(job(fn.__name__[6:], fn.__name__[6:].title(), "fail", f"Status check crashed: {ex}"))
    try:
        jobs.extend(check_trackman(since))
    except Exception as ex:  # noqa: BLE001
        jobs.append(job("trackman", "TrackMan", "fail", f"Status check crashed: {ex}"))
    try:
        jobs.append(check_programs(since))
    except Exception as ex:  # noqa: BLE001
        jobs.append(job("programs", "Octane program data", "fail", f"Status check crashed: {ex}"))

    sched = scheduler_info()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    page = render(jobs, sched, morning)
    dated = OUT_DIR / f"morning_status_{morning.isoformat()}.html"
    dated.write_text(page, encoding="utf-8")
    (OUT_DIR / "latest.html").write_text(page, encoding="utf-8")
    with (OUT_DIR / "history.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"morning": morning.isoformat(),
                            "jobs": {j["key"]: {"status": j["status"], "headline": j["headline"]} for j in jobs}}) + "\n")

    for j in jobs:
        print(f"[{LABEL[j['status']]:>10}] {j['name']}: {j['headline']}")
    print(f"\n{dated}")
    marker = OUT_DIR / f".opened_{morning.isoformat()}"
    if a.once and marker.exists():
        return 0
    if not a.no_open and os.name == "nt":
        marker.touch()
        os.startfile(dated)  # noqa: S606 - opens in the default browser
    return 0


if __name__ == "__main__":
    sys.exit(main())
