#!/usr/bin/env python3
"""
Blast Motion team portal -> CSV in blast_out/ (download only; load_blast_csv.py does the rest).

    uais\\venv\\Scripts\\python.exe uais\\python\\blast\\blast_pull.py --login              # sign in once (as Bobby)
    uais\\venv\\Scripts\\python.exe uais\\python\\blast\\blast_pull.py --headed --from 2026-11-03 --to 2026-11-04
    uais\\venv\\Scripts\\python.exe uais\\python\\blast\\blast_pull.py --days 2 --headless  # nightly (run_nightly.bat)
    ... blast_pull.py --probe --headed     # open Insights, dump frames/controls to blast_out/debug, no export

Steps (from Joey's Nov 6 demo; first written by Muse, moved into the repo 2026-11-06):
    team.winreality.com/insights -> "All Swings (non events)" -> Controls ->
    Swing Timestamp between <from> - <to> -> "All swings by player" table -> (...) ->
    Export to CSV -> "Your CSV is ready." -> download

Differences from Muse's standalone version
  * Lives in the repo and uses the uais venv (Playwright + Chromium are already there for TrackMan).
  * Saved sign-in is a persistent browser profile (.blast_profile/, like .trackman_profile/),
    and --login waits for Enter in the terminal: closing the window used to lose the session.
  * Insights is Amazon QuickSight, which is normally embedded in an iframe: every lookup searches
    the page AND its frames (TrackMan's Power BI needed the same).
  * Files land in <repo>/blast_out/ (what run_nightly.bat loads), archive copy in blast_out/archive/.
  * No done.json skip: re-pulling a range is harmless (the loader skips identical files by sha256
    and upserts on captureid), and a skip could block the retry after a bad night.
  * Signed-out runs write blast_out/NEEDS_LOGIN.txt and exit 3; failures save a screenshot and a
    frame dump to blast_out/debug/ so the selectors can be fixed from them.

The date filter leaks (Nov 6 sample: asked for Nov 3-4, got Oct 30 - Nov 5) and the export can
hold more than was asked for. That's fine: the loader keeps every swing, dedupes on captureid.
Swing Timestamp is UTC, so evening Eastern swings fall on the next UTC date; --days 2 run in the
early morning covers the whole previous day either way.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]                    # repo root: uais/python/blast -> repo
OUT = ROOT / "blast_out"
PROFILE = ROOT / ".blast_profile"

BASE = "https://team.winreality.com"
INSIGHTS_URL = f"{BASE}/insights"

EXPECTED_COLUMNS = [
    "captureid", "Swing Timestamp", "timezone", "first_name", "last_name",
    "user_id", "Environment Tag", "Bat Nickname", "sensorserialnumber",
    "Bat Speed (MPH)", "Peak Hand Speed (MPH)", "Rotational Acceleration (G's)", "Power (kW)",
    "On Plane Efficiency (%)", "Attack Angle (°'s)", "Vert. Bat Angle (°'s)", "Time to Contact (s)",
    "Commit Time (s)", "Early Connection (°'s)", "Hinge Angle at Impact (°'s)",
    "Connection at Impact (°'s)", "Body Tilt Angle (°'s)", "Upload Timestamp", "actiontype",
]


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Browser
# ---------------------------------------------------------------------------

def launch(pw, headless: bool):
    PROFILE.mkdir(parents=True, exist_ok=True)
    opts = dict(accept_downloads=True, viewport={"width": 1600, "height": 1200})
    try:
        ctx = pw.chromium.launch_persistent_context(str(PROFILE), headless=headless, **opts)
    except Exception as e:  # noqa: BLE001
        if any(k in str(e) for k in ("ProcessSingleton", "already in use", "SingletonLock")):
            raise SystemExit(f"The Blast browser profile {PROFILE} is in use (another run, or a window left open).") from e
        raise
    if headless:  # same trick as trackman_pull: look like the windowed browser
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        ua = page.evaluate("navigator.userAgent")
        if "Headless" in ua:
            ctx.close()
            ctx = pw.chromium.launch_persistent_context(str(PROFILE), headless=True,
                                                        user_agent=ua.replace("HeadlessChrome", "Chrome"), **opts)
    return ctx


def frames(page):
    """Main page first, then every frame (QuickSight is usually an iframe)."""
    return [page.main_frame] + [f for f in page.frames if f is not page.main_frame]


def first_visible(page, make, timeout_ms: int = 10_000, what: str = ""):
    """Poll page + frames until make(frame) yields a visible locator. -> (locator, frame) or (None, None)."""
    deadline = datetime.now() + timedelta(milliseconds=timeout_ms)
    while True:
        for fr in frames(page):
            try:
                loc = make(fr).first
                if loc.count() and loc.is_visible():
                    return loc, fr
            except Exception:  # noqa: BLE001 - detached frames while QuickSight loads
                continue
        if datetime.now() >= deadline:
            if what:
                log(f"  not found: {what}")
            return None, None
        page.wait_for_timeout(500)


def dump(page, tag: str) -> None:
    """Screenshot + frame list + the clickable things in each frame, for fixing selectors."""
    d = OUT / "debug"
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    try:
        page.screenshot(path=str(d / f"{stamp}_{tag}.png"), full_page=True)
    except Exception:  # noqa: BLE001
        pass
    lines = []
    for fr in frames(page):
        lines.append(f"## frame {fr.url}")
        try:
            items = fr.evaluate("""() => [...document.querySelectorAll(
                'button,[role=button],[role=menuitem],[role=tab],input,[aria-label],label')].slice(0, 400).map(e =>
                [e.tagName, e.getAttribute('role') || '', e.getAttribute('aria-label') || '',
                 (e.innerText || e.value || '').trim().slice(0, 80), e.getAttribute('type') || ''].join(' | '))""")
            lines += items
        except Exception as e:  # noqa: BLE001
            lines.append(f"(could not read: {e})")
    (d / f"{stamp}_{tag}_frames.txt").write_text("\n".join(lines), encoding="utf-8")
    log(f"  Debug saved to {d} ({stamp}_{tag}.*)")


def signed_in(page) -> bool:
    page.goto(INSIGHTS_URL, wait_until="domcontentloaded")
    for _ in range(20):
        page.wait_for_timeout(1500)
        if "login" not in page.url.lower() and "signin" not in page.url.lower():
            return True
    return False


# ---------------------------------------------------------------------------
# Insights steps
# ---------------------------------------------------------------------------

def open_sheet(page) -> None:
    loc, _ = first_visible(page, lambda f: f.get_by_text("All Swings (non events)", exact=False), 45_000,
                           "'All Swings (non events)' tab")
    if loc:
        loc.click()
        page.wait_for_timeout(3000)
        log("  Opened 'All Swings (non events)'")
    else:
        log("  WARNING: staying on the current sheet")


def set_date_filter(page, from_date: date, to_date: date) -> str:
    """-> how the range was set ('typed', 'calendar', or 'not set')."""
    loc, _ = first_visible(page, lambda f: f.get_by_text("Controls", exact=True), 8_000)
    if loc:
        loc.click()
        page.wait_for_timeout(1500)

    from_str, to_str = from_date.strftime("%Y/%m/%d"), to_date.strftime("%Y/%m/%d")   # the portal shows 2026/11/03
    log(f"  Swing Timestamp between {from_str} - {to_str}")

    typed = 0
    for label, value in (("Start Date", from_str), ("End Date", to_str)):
        box, _ = first_visible(page, lambda f, label=label: f.get_by_label(label, exact=False), 6_000)
        if box is None:
            box, _ = first_visible(page, lambda f, label=label: f.get_by_placeholder(label, exact=False), 2_000)
        if box is None:
            continue
        box.click()
        box.fill(value)
        box.press("Enter")
        typed += 1
        page.wait_for_timeout(800)
    if typed == 2:
        page.wait_for_timeout(3000)
        return "typed"

    try:  # calendar fallback: day buttons are labelled with the day number
        for label, d in (("Start Date", from_date), ("End Date", to_date)):
            opener, fr = first_visible(page, lambda f, label=label: f.get_by_text(label, exact=False), 6_000)
            if opener is None:
                raise LookupError(label)
            opener.click()
            page.wait_for_timeout(800)
            fr.get_by_role("button", name=str(d.day), exact=True).first.click(timeout=5_000)
            page.wait_for_timeout(800)
        page.wait_for_timeout(3000)
        return "calendar"
    except Exception as e:  # noqa: BLE001
        log(f"  WARNING: date filter not set ({e}); exporting whatever range the dashboard shows")
        dump(page, "date_filter")
        return "not set"


def export_csv(page, download_dir: Path) -> Path | None:
    first_visible(page, lambda f: f.get_by_text("All swings by player", exact=False), 20_000, "'All swings by player' table")
    menu = None
    for name in ("Menu options, All swings by player, Table", "Menu options", "More options"):
        menu, _ = first_visible(page, lambda f, name=name: f.get_by_role("button", name=name), 5_000)
        if menu:
            # QuickSight shows a visual's menu on hover.
            try:
                menu.hover()
            except Exception:  # noqa: BLE001
                pass
            menu.click()
            log(f"  Opened table menu ({name})")
            break
    if menu is None:
        log("  ERROR: table menu not found")
        dump(page, "menu")
        return None
    page.wait_for_timeout(800)

    item, _ = first_visible(page, lambda f: f.get_by_role("menuitem", name="Export to CSV"), 8_000, "'Export to CSV'")
    if item is None:
        item, _ = first_visible(page, lambda f: f.get_by_text("Export to CSV", exact=False), 3_000)
    if item is None:
        dump(page, "export_item")
        return None
    try:
        with page.expect_download(timeout=150_000) as dl:
            item.click()
            toast, _ = first_visible(page, lambda f: f.get_by_text("Your CSV is ready", exact=False), 60_000)
            if toast:   # some QuickSight builds only download when the toast is clicked
                try:
                    toast.click(timeout=3_000)
                except Exception:  # noqa: BLE001
                    pass
        download = dl.value
    except Exception as e:  # noqa: BLE001 - Playwright TimeoutError
        log(f"  ERROR: no download after Export to CSV ({e.__class__.__name__})")
        dump(page, "download")
        return None
    name = download.suggested_filename or f"All_swings_by_player_{int(datetime.now().timestamp() * 1000)}.csv"
    dest = download_dir / name
    if dest.exists():   # never overwrite (the loader may not have read it yet)
        dest = download_dir / f"{dest.stem}_{datetime.now().strftime('%H%M%S')}{dest.suffix}"
    download.save_as(str(dest))
    log(f"  Downloaded {dest.name} ({dest.stat().st_size:,} bytes)")
    return dest


def validate_csv(path: Path, from_date: date, to_date: date) -> dict:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    headers = list(rows[0].keys()) if rows else []
    swings = sorted(r["Swing Timestamp"] for r in rows if r.get("Swing Timestamp"))
    ids = [r.get("captureid", "") for r in rows]
    # Swing Timestamp is UTC; an evening Eastern swing is on the next UTC date, so allow +1 day.
    hi = (to_date + timedelta(days=1)).isoformat()
    in_range = sum(1 for s in swings if from_date.isoformat() <= s[:10] <= hi)
    report = {
        "file": path.name, "rows": len(rows), "columns": len(headers),
        "missing_columns": [c for c in EXPECTED_COLUMNS if c not in headers],
        "extra_columns": [c for c in headers if c not in EXPECTED_COLUMNS],
        "swing_min_utc": swings[0] if swings else None, "swing_max_utc": swings[-1] if swings else None,
        "rows_in_requested_range": in_range, "rows_outside_requested_range": len(rows) - in_range,
        "players": sorted({f"{r.get('first_name', '')} {r.get('last_name', '')}".strip() for r in rows}),
        "user_ids": sorted({r.get("user_id", "") for r in rows}),
        "sensors": sorted({r.get("sensorserialnumber", "") for r in rows if r.get("sensorserialnumber")}),
        "duplicate_captureid": len(ids) - len(set(ids)),
    }
    log(f"  Rows {len(rows)} | swings {report['swing_min_utc']} .. {report['swing_max_utc']} UTC | "
        f"in range {in_range}, outside {len(rows) - in_range}")
    log(f"  Players: {', '.join(report['players']) or '-'} | sensors: {', '.join(report['sensors']) or '-'}")
    if report["missing_columns"]:
        log(f"  WARNING: missing columns {report['missing_columns']} (the loader may refuse this file)")
    if len(report["players"]) > 1:
        log("  NOTE: more than one Blast account in the file; the loader still attributes by sensor + assignment")
    return report


# ---------------------------------------------------------------------------

def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--login", action="store_true", help="open the portal to sign in as Bobby; press Enter here when done")
    ap.add_argument("--from", dest="from_date", help="first date YYYY-MM-DD (default: yesterday)")
    ap.add_argument("--to", dest="to_date", help="last date YYYY-MM-DD (default: today)")
    ap.add_argument("--days", type=int, help="the last N days ending today (overrides --from/--to)")
    ap.add_argument("--out", default=str(OUT), help="folder the CSV lands in (default: <repo>/blast_out)")
    ap.add_argument("--headed", action="store_true", help="show the browser (first runs / debugging)")
    ap.add_argument("--headless", action="store_true", help="no window (scheduled runs; the default unless --headed)")
    ap.add_argument("--probe", action="store_true", help="open Insights, set the dates, dump frames/controls; no export")
    args = ap.parse_args()

    today = date.today()
    if args.days:
        from_date, to_date = today - timedelta(days=args.days - 1), today
    else:
        to_date = date.fromisoformat(args.to_date) if args.to_date else today
        from_date = date.fromisoformat(args.from_date) if args.from_date else today - timedelta(days=1)
    if from_date > to_date:
        from_date, to_date = to_date, from_date

    out = Path(args.out).expanduser().resolve()
    (out / "archive").mkdir(parents=True, exist_ok=True)
    needs_login = out / "NEEDS_LOGIN.txt"

    from playwright.sync_api import sync_playwright   # imported here so --help works without Playwright

    with sync_playwright() as pw:
        if args.login:
            ctx = launch(pw, headless=False)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"{BASE}/login")
            log("Sign in as the Bobby Wahl coach account in the browser window,")
            input("then press Enter here (leave the window open)... ")
            ok = "login" not in page.url.lower()
            ctx.close()
            if ok:
                needs_login.unlink(missing_ok=True)
                log(f"Sign-in saved in {PROFILE}.")
                return 0
            log("Still on the login page. Run --login again.")
            return 3

        ctx = launch(pw, headless=not args.headed)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if not signed_in(page):
                needs_login.write_text(f"{datetime.now().isoformat(timespec='seconds')}: the Blast sign-in expired. "
                                       f"Run: uais\\venv\\Scripts\\python.exe uais\\python\\blast\\blast_pull.py --login\n")
                log("Not signed in. Run blast_pull.py --login once, then re-run.")
                return 3
            needs_login.unlink(missing_ok=True)
            open_sheet(page)
            how = set_date_filter(page, from_date, to_date)
            if args.probe:
                dump(page, "probe")
                return 0
            downloaded = export_csv(page, out)
        except Exception as e:  # noqa: BLE001 - keep the evidence
            log(f"ERROR: {e}")
            dump(page, "error")
            return 1
        finally:
            ctx.close()

    if not downloaded:
        return 1
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archived = out / "archive" / f"blast_{from_date}_to_{to_date}_{run_ts}.csv"
    shutil.copy2(downloaded, archived)
    report = validate_csv(downloaded, from_date, to_date)
    report.update(run_at=datetime.now().isoformat(timespec="seconds"), requested_from=str(from_date),
                  requested_to=str(to_date), date_filter=how, archived_file=archived.name)
    with open(out / "blast_pull_log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(report) + "\n")
    log("Done. The loader picks the file up from " + str(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
