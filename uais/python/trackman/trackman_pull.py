#!/usr/bin/env python3
"""
TrackMan Team Portal -> per-pitch pull (Legacy "Portable - Pitching Player" report).

Run on a machine with a browser (Joey's PC), not on Railway: the portal needs an
interactive sign-in.

    pip install playwright
    playwright install chromium
    python uais/python/trackman/trackman_pull.py --login            # sign in once
    python uais/python/trackman/trackman_pull.py --probe            # check one player/session
    python uais/python/trackman/trackman_pull.py --from 2026-10-01 --to 2026-10-14
    python uais/python/trackman/load_trackman_pull.py --dir trackman_out   # then load into the warehouse

How it gets the data
  * Sessions and the players in each session: the portal's own /api/sessions
    JSON, captured as the page loads it (no DOM scraping, no tokens handled by
    us). The request is widened to one page of up to 1000 sessions.
  * Roster: /api/players JSON the same way (falls back to "Export to .csv").
  * Pitches: the report is a Power BI embed (cross-origin iframe). For each
    session x player: set the pitcher_full_name and US DATE slicers, keep Live
    only, open VELO VS. SPIN -> More options -> Show as a table, then read the
    grid. The grid is virtualized, so it is scrolled until no new rows appear.
    Columns are mapped by header text, not position.

Checks written to <out>/validation.json
  * per session: pitches pulled (all players) vs the session's Plays count.
    The report shows only each pitcher's top-5 pitch types, so a pitcher with
    6+ types can come up short. Shortfalls are listed, never hidden.
  * every row's session_id must match the session being pulled.

Outputs in --out (default ./trackman_out): sessions.json, roster.json,
pitches.jsonl, done.json, validation.json, raw/ (captured API JSON), probe/.
Keep this folder out of git (it holds athlete names and birth dates).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

try:
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - only hit when playwright isn't installed
    print("Playwright is not installed: pip install playwright && playwright install chromium", file=sys.stderr)
    raise

BASE = "https://teamportal.trackmanbaseball.com"
PITCHING_REPORT = f"{BASE}/reports/1b8c3723-e220-4a2b-b34a-38fb27cd9dc4"
SESSIONS_URL = f"{BASE}/sessions"
PLAYERS_URL = f"{BASE}/players"
PBI_FRAME = 'iframe[src*="powerbi.com"]'
VISUAL_TITLE = "VELO VS. SPIN"

# Header text -> field. Headers are normalized first (lower case, underscores and
# camelCase split into words), so both friendly names ("Induced Vertical Break (in)")
# and the model's field names ("pitch_trajectory_inducedVerticalBreak_in") match.
# Order matters: more specific first.
HEADER_RULES = [
    ("measured tilt", "measured_tilt"),
    ("m. tilt", "measured_tilt"),
    ("3d tilt", "measured_tilt"),
    ("active spin", "active_spin_rpm"),
    ("tilt", "tilt"),
    ("pitch type", "pitch_type"),
    ("created time", "pitch_time"),
    ("pitch time", "pitch_time"),
    ("time", "pitch_time"),
    ("release height", "release_height_ft"),
    ("release side", "release_side_ft"),
    ("extension", "extension_ft"),
    ("gyro", "gyro_deg"),
    ("longitudinal angle", "gyro_deg"),
    ("spin efficiency", "spin_efficiency_pct"),
    ("induced vertical", "ivb_in"),
    ("horizontal break", "hb_in"),
    ("vertical approach", "vaa_deg"),
    ("location angle", "vaa_deg"),
    ("horizontal approach", "haa_deg"),
    ("location direction", "haa_deg"),
    ("location height", "location_height_ft"),
    ("location side", "location_side_ft"),
    ("plate height", "location_height_ft"),
    ("plate side", "location_side_ft"),
    ("zone", "zone_location"),
    ("play id", "play_id"),
    ("pitch id", "play_id"),
    ("session", "session_id"),
    ("full name", "pitcher_name"),
    ("name", "pitcher_name"),
    ("pitcher", "pitcher_name"),
    ("speed spin", "speed_spin_label"),   # the combined "82.7, 2475" column
    ("speed", "release_speed"),
    ("velo", "release_speed"),
    ("spinrate", "spin_rate"),
    ("spin rate", "spin_rate"),
    ("total spin", "spin_rate"),
]


def norm_header(h: str) -> str:
    h = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", h or "")
    h = re.sub(r"[_,]+", " ", h).lower()
    h = re.sub(r"\s+", " ", h).strip()
    if "speed" in h and "spin" in h:
        return "speed spin " + h
    return h


# Positional fallback (recon of Oct 13, 2026), used only if headers can't be read.
POSITIONAL = [
    "pitch_type", "speed_spin_label", "pitcher_name", "pitch_time",
    "release_height_ft", "release_side_ft", "extension_ft", "tilt",
    "measured_tilt", "gyro_deg", "spin_efficiency_pct",
    "ivb_in", "hb_in", "vaa_deg", "haa_deg",
    "location_height_ft", "location_side_ft", "zone_location", "session_id",
]
SPEED_SPIN_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)?\s*$")  # spin may be blank: "68.4,"
GUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def pick(obj: dict, *names: str):
    """First present key, case-insensitive (the portal JSON's exact casing isn't documented)."""
    if not isinstance(obj, dict):
        return None
    low = {k.lower(): v for k, v in obj.items()}
    for n in names:
        v = low.get(n.lower())
        if v not in (None, ""):
            return v
    return None


def iso_date(value) -> str | None:
    """'2026-10-09T15:29:00', 'Oct. 9, 2026 @ 3:29 PM', '10/09/2026' -> '2026-10-09'."""
    if value in (None, ""):
        return None
    s = str(value).strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    s2 = " ".join(s.split("@")[0].replace(".", "").replace(",", " ").split())
    for fmt in ("%b %d %Y", "%B %d %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s2, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def us_date_variants(iso: str) -> list[str]:
    """The US DATE slicer text. Recon saw 03/20/2026; also try 3/20/2026 (no %-m: Windows lacks it)."""
    d = date.fromisoformat(iso)
    return [f"{d.month:02d}/{d.day:02d}/{d.year}", f"{d.month}/{d.day}/{d.year}"]


def to_float(v):
    if v in (None, "", "-", "—"):
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def widen_take(url: str, take: int = 100) -> str:
    parts = urlsplit(url)
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    lower = {k.lower(): k for k in q}
    if "take" in lower:
        q[lower["take"]] = str(take)
    if "skip" in lower:
        q[lower["skip"]] = "0"
    return urlunsplit(parts._replace(query=urlencode(q)))


# ---------------------------------------------------------------------------
# JSON capture from the portal's own API calls
# ---------------------------------------------------------------------------

class ApiCapture:
    def __init__(self, raw_dir: Path | None):
        self.raw_dir = raw_dir  # None: don't write raw files (long runs)
        self.items: list[tuple[str, object]] = []
        self.pbi: list[tuple[float, str, object]] = []  # (time, url, json) of Power BI querydata
        self.pbi_urls: list[str] = []  # every Power BI request seen (probe diagnostics)

    def on_response(self, resp) -> None:
        url = resp.url
        if "analysis.windows.net" in url or "powerbi.com" in url:
            self.pbi_urls.append(f"{resp.request.method} {resp.status} {url.split('?')[0]}")
            del self.pbi_urls[:-500]
            if "querydata" in url.lower() or "/query" in url.lower():  # the data behind each visual
                try:
                    self.pbi.append((time.time(), url, json.loads(resp.text())))
                except Exception as e:  # noqa: BLE001
                    self.pbi_urls.append(f"   (body unreadable: {type(e).__name__}: {str(e)[:120]})")
            return
        if "/api/" not in url or "teamportal.trackmanbaseball.com" not in url:
            return
        if "json" not in (resp.headers.get("content-type") or ""):
            return
        try:
            data = resp.json()
        except Exception:  # noqa: BLE001 - body may be gone after navigation
            return
        self.items.append((url, data))
        del self.items[:-200]  # only recent responses are ever looked up
        if self.raw_dir is not None:
            name = re.sub(r"[^A-Za-z0-9]+", "_", urlsplit(url).path.strip("/"))[:60]
            (self.raw_dir / f"{name}_{int(time.time() * 1000)}.json").write_text(json.dumps(data, indent=1, default=str))

    def latest(self, path_part: str):
        for url, data in reversed(self.items):
            if path_part in urlsplit(url).path:
                return data
        return None


def list_in(data) -> list:
    """The record list in an API payload: a bare list, or the biggest list-of-dicts field."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        best: list = []
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict) and len(v) > len(best):
                best = v
            elif isinstance(v, dict):
                inner = list_in(v)
                if len(inner) > len(best):
                    best = inner
        return best
    return []


# Foreign IDs come as "SYSTEM-number" strings, e.g. "TMBB-1000218557", "MLB-809790",
# "AMA-1017...", "PG-...", "PBR-...", "BBP-...". The portal's displayed Player ID is
# the MLB ID if there is one, else the first TMBB ID, else the first AMA ID
# (checked against the portal's own roster export, Oct 14 2026).
ID_PRIORITY = ("MLB", "TMBB", "AMA")
THROWS = {"right": "R", "r": "R", "left": "L", "l": "L"}


def split_foreign(value) -> tuple[str, str] | None:
    if isinstance(value, dict):
        sysn = str(pick(value, "source", "system", "type", "provider") or "")
        v = pick(value, "id", "value", "foreignId", "externalId")
        return (sysn.upper(), str(v)) if v else None
    m = re.match(r"^\s*([A-Za-z]+)-(.+?)\s*$", str(value or ""))
    return (m.group(1).upper(), m.group(2)) if m else None


def parse_player_id_text(text: str) -> tuple[str | None, str]:
    """'1000218557 TrackMan' / '809790 MLB' / '1000218557\nTrackMan' -> (id, system)."""
    parts = str(text or "").split()
    if not parts:
        return None, ""
    return parts[0], (parts[1] if len(parts) > 1 else "")


def normalize_player(p: dict) -> dict | None:
    name = pick(p, "name", "fullName", "playerName", "displayName")
    if not name:
        name = " ".join(x for x in (pick(p, "firstName"), pick(p, "lastName")) if x)
    if not name:
        return None
    foreign = [f for f in (split_foreign(x) for x in (pick(p, "foreignIds", "externalIds") or [])) if f]
    pid, system = None, ""
    for want in ID_PRIORITY:
        hit = next((f for f in foreign if f[0] == want), None)
        if hit:
            system, pid = hit
            break
    if not pid and foreign:
        system, pid = foreign[0]
    if not pid:
        pid, system = parse_player_id_text(pick(p, "playerId", "player_id", "trackmanId") or "")
    if not pid:
        return None
    throws = THROWS.get(str(pick(p, "throws") or "").strip().lower())
    portal_id = pick(p, "id")
    return {
        "player_id": str(pid).strip(),
        "id_source": "mlb" if system.upper() == "MLB" else "trackman",
        "foreign_ids": [f"{a}-{b}" for a, b in foreign],
        "portal_id": str(portal_id) if portal_id and GUID_RE.fullmatch(str(portal_id)) else None,
        "name": " ".join(str(name).split()),
        "dob": iso_date(pick(p, "dateOfBirth", "dob", "birthDate", "birthday")),
        "jersey": pick(p, "jerseyNumber", "number", "jersey"),
        "team": pick(p, "team", "teamName"),
        "throws": throws,
        "bats": pick(p, "bats"),
        "raw": p,
    }


def normalize_session(s: dict) -> dict | None:
    sid = pick(s, "id", "sessionId", "session_id")
    if not sid or not GUID_RE.search(str(sid)):
        return None
    local = pick(s, "localDate", "localTime", "dateLocal", "localDateTime", "date")
    utc = pick(s, "utcDate", "utcTime", "dateUtc", "utcDateTime", "createdAt")
    players_raw = pick(s, "players", "playersInSession", "sessionPlayers") or []
    players = [x for x in (normalize_player(p) for p in players_raw if isinstance(p, dict)) if x]
    plays = pick(s, "plays", "playCount", "playsCount", "numberOfPlays")
    pcount = pick(s, "playerCount", "playersCount", "numberOfPlayers")
    return {
        "session_id": str(sid),
        "type": str(pick(s, "type", "sessionType", "kind") or ""),
        "local_date": iso_date(local) or iso_date(utc),
        "local_datetime": local,
        "utc_datetime": utc,
        "radar_serial": pick(s, "radarSerial", "serialNumber", "radar", "deviceSerial"),
        "plays": int(plays) if str(plays or "").isdigit() else None,
        "player_count": int(pcount) if str(pcount or "").isdigit() else (len(players) or None),
        "players": players,
        "raw": {k: v for k, v in s.items() if k not in ("players", "playersInSession", "sessionPlayers")},
    }


# ---------------------------------------------------------------------------
# Portal pages
# ---------------------------------------------------------------------------

SESSIONS_TAKE = 100  # the portal API refuses more ("Maximum allowed value is 100")


def api_error(data) -> str | None:
    items = data if isinstance(data, list) else [data]
    for it in items:
        if isinstance(it, dict) and (it.get("exceptionType") or (it.get("code") and it.get("message"))):
            return str(it.get("message"))[:400]
    return None


def search_sessions(page, cap: ApiCapture, from_iso: str, to_iso: str) -> list[dict]:
    """One search on /sessions for [from, to]; returns the raw session records."""
    def widen(route):
        route.continue_(url=widen_take(route.request.url, SESSIONS_TAKE))

    fmt = lambda iso: date.fromisoformat(iso).strftime("%b %d, %Y")  # inputs show "mmm dd, yyyy"
    boxes = page.get_by_placeholder(re.compile("mmm dd", re.I))
    page.route("**/api/sessions?*", widen)
    try:
        with page.expect_response(lambda r: "/api/sessions" in r.url, timeout=90_000) as resp:
            boxes.nth(0).fill(fmt(from_iso))
            boxes.nth(1).fill(fmt(to_iso))
            page.keyboard.press("Escape")
            page.get_by_role("button", name="Search").click()
        data = resp.value.json()
    finally:
        page.unroute("**/api/sessions?*")
    err = api_error(data)
    if err:
        raise RuntimeError(f"portal /api/sessions error for {from_iso}..{to_iso}: {err}")
    return list_in(data)


def get_sessions(page, cap: ApiCapture, from_iso: str, to_iso: str) -> list[dict]:
    """Sessions in [from, to]. The API returns at most 100 per call, so the range is
    searched in 7-day windows, and a window that comes back full is split in half."""
    page.goto(SESSIONS_URL)
    page.wait_for_load_state("networkidle")
    if page.get_by_placeholder(re.compile("mmm dd", re.I)).count() < 2:
        raise RuntimeError("Date inputs not found on /sessions (page layout changed?)")

    found: dict[str, dict] = {}

    def run(a: date, b: date) -> None:
        recs = search_sessions(page, cap, a.isoformat(), b.isoformat())
        if len(recs) >= SESSIONS_TAKE and a < b:
            mid = date.fromordinal((a.toordinal() + b.toordinal()) // 2)
            run(a, mid)
            run(date.fromordinal(mid.toordinal() + 1), b)
            return
        if len(recs) >= SESSIONS_TAKE:
            log(f"  WARNING: {a} alone has {len(recs)}+ sessions; some may be missing")
        for r in recs:
            n = normalize_session(r) if isinstance(r, dict) else None
            if not n:
                continue
            # No player list in the JSON: read the "Players in session" dialog while this
            # window's results are on screen (pitching sessions only).
            if not n["players"] and "pitch" in n["type"].lower():
                try:
                    n["players"] = get_session_players_dom(page, n)
                except Exception as e:  # noqa: BLE001
                    log(f"  couldn't read players for session {n['session_id'][:8]}: {e}")
            found[n["session_id"]] = n

    a, end = date.fromisoformat(from_iso), date.fromisoformat(to_iso)
    while a <= end:
        b = min(end, date.fromordinal(a.toordinal() + 6))
        run(a, b)
        a = date.fromordinal(b.toordinal() + 1)
    return sorted(found.values(), key=lambda x: (x["local_date"] or "", x["session_id"]))


def get_session_players_dom(page, session: dict) -> list[dict]:
    """Fallback when the session JSON has no player list: the 'Players in session' dialog."""
    search = page.get_by_placeholder(re.compile("search for sessions", re.I))
    if search.count():
        search.first.fill(session["session_id"])
        page.wait_for_timeout(800)
    row = page.locator("table tbody tr", has_text=session["session_id"][:8]).first
    if row.count() == 0:
        if search.count():
            search.first.fill("")
        return []
    row.locator("button, a").filter(has_text=re.compile(r"^\s*\d+\s*$")).first.click()
    dialog = page.get_by_role("dialog").first
    dialog.wait_for(timeout=15_000)
    page.wait_for_timeout(800)
    headers = [norm(h.inner_text()) for h in dialog.locator("thead th, [role='columnheader']").all()]
    players = []
    for tr in dialog.locator("tbody tr").all():
        cells = [(c.inner_text() or "").strip() for c in tr.locator("td").all()]
        if not cells:
            continue
        rec = dict(zip(headers, cells)) if headers else {}
        name = rec.get("name") or cells[0]
        pid, system = parse_player_id_text(rec.get("player id") or (cells[4] if len(cells) > 4 else ""))
        if pid:
            players.append({"player_id": pid, "id_source": "mlb" if system.lower() == "mlb" else "trackman",
                            "foreign_ids": [], "portal_id": None, "name": name,
                            "dob": iso_date(rec.get("date of birth") or (cells[1] if len(cells) > 1 else None)),
                            "jersey": rec.get("jersey number"), "team": rec.get("team"), "throws": None, "bats": None,
                            "raw": rec or {"cells": cells}})
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    if search.count():
        search.first.fill("")
    return players


def get_roster(page, cap: ApiCapture, out: Path) -> dict[str, dict]:
    def widen(route):
        route.continue_(url=widen_take(route.request.url, 5000))

    page.route("**/api/players*", widen)
    try:
        page.goto(PLAYERS_URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
    finally:
        page.unroute("**/api/players*")
    roster = {}
    data = cap.latest("/api/players")
    if api_error(data):
        log(f"  /api/players error: {api_error(data)}")
        data = None
    for p in list_in(data):
        n = normalize_player(p) if isinstance(p, dict) else None
        if n:
            roster[n["player_id"]] = n
    if roster:
        return roster
    # Fallback: the page's own "Export to .csv"
    try:
        with page.expect_download(timeout=20_000) as dl:
            page.get_by_role("button", name=re.compile(r"export.*csv", re.I)).click()
        dest = out / "roster.csv"
        dl.value.save_as(str(dest))
        with open(dest, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                low = {k.strip().lower(): v for k, v in r.items() if k}
                n = normalize_player({"name": low.get("name"), "playerId": low.get("playerid") or low.get("player id"),
                                      "dateOfBirth": low.get("dateofbirth") or low.get("date of birth"),
                                      "team": None if low.get("team") in ("-", "") else low.get("team"),
                                      "number": None if low.get("number") in ("-", "") else low.get("number")})
                if n:
                    roster[n["player_id"]] = n
    except PWTimeout:
        log("  Roster download not captured; continuing with players from sessions only.")
    return roster


# ---------------------------------------------------------------------------
# Power BI report
# ---------------------------------------------------------------------------

def pbi(page):
    return page.frame_locator(PBI_FRAME).first


def wait_report(page) -> None:
    page.goto(PITCHING_REPORT)
    page.wait_for_selector(PBI_FRAME, timeout=60_000)
    pbi(page).get_by_role("combobox", name="pitcher_full_name").wait_for(timeout=90_000)
    page.wait_for_timeout(2000)


HTML_OPTION = "div[role='option'], span[role='option'], li[role='option'], a[role='option']"


def el_text(el) -> str:
    """Visible label of an element. Power BI puts some items in SVG, where inner_text()
    fails ("Node is not an HTMLElement"), so prefer aria-label/title, then textContent."""
    for attr in ("aria-label", "title"):
        v = el.get_attribute(attr)
        if v and v.strip():
            return v.strip()
    return (el.text_content() or "").strip()


def slicer_popup(page, combo):
    """The dropdown that belongs to this combobox: via aria-controls/aria-owns when Power BI
    sets them, else the visible slicer dropdown (HTML only, never a chart's SVG listbox)."""
    f = pbi(page)
    for attr in ("aria-controls", "aria-owns"):
        pid = combo.get_attribute(attr)
        if pid:
            loc = f.locator(f"[id='{pid.split()[0]}']")
            if loc.count():
                return loc.first
    for sel in (".slicer-dropdown-popup:visible", ".slicer-dropdown-content:visible",
                "div.slicerBody:visible", "div[role='listbox']:visible"):
        loc = f.locator(sel)
        if loc.count():
            return loc.last  # the popup opened last sits at the end of the DOM
    return f.locator("body")


CLEAR_SLICER_JS = """(name) => {
  const combo = document.querySelector(`[role=combobox][aria-label="${name}"]`);
  const box = combo && combo.closest('.visualContainer, .slicer-container, visual-modern');
  const btn = box && box.querySelector('.slicer-header-clear, [aria-label="Clear selections"]');
  if (!btn) return false;
  btn.click();  // the header (and its eraser) is hidden in this report, but the handler still runs
  return true;
}"""


def slicer_value(page, slicer: str) -> str:
    try:
        # the combobox's aria-label is the slicer name; the selection is its text
        return (pbi(page).get_by_role("combobox", name=slicer).first.text_content() or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def clear_slicer(page, slicer: str) -> bool:
    """Back to "All". Slicers filter each other and the portal remembers the last
    selection, so e.g. a leftover date hides every pitcher who didn't throw that day."""
    before = slicer_value(page, slicer)
    if norm(before) in ("", "all"):
        return True
    frame = pbi_frame(page)
    if frame.evaluate(CLEAR_SLICER_JS, slicer):
        page.wait_for_timeout(1500)
    if norm(slicer_value(page, slicer)) in ("", "all"):
        return True
    # Fallback: open the list and click the selected item to toggle it off.
    f = pbi(page)
    combo = f.get_by_role("combobox", name=slicer).first
    combo.click()
    page.wait_for_timeout(1000)
    popup = slicer_popup(page, combo)
    sel = popup.locator("[role='option'][aria-selected='true'], [role='option'][aria-checked='true']")
    if sel.count():
        sel.first.click(modifiers=["Control"])
        page.wait_for_timeout(800)
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    after = slicer_value(page, slicer)
    ok = norm(after) in ("", "all")
    if not ok:
        log(f"  WARNING: couldn't clear '{slicer}' (still '{after}')")
    return ok


SCROLL_LIST_JS = """(el) => {
  // scroll the slicer's (virtualized) list one page down; false at the end
  const cands = [el, ...el.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  if (!cands.length) return false;
  const sc = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  const before = sc.scrollTop;
  sc.scrollTop = before + Math.max(40, sc.clientHeight * 0.8);
  sc.dispatchEvent(new Event('scroll'));
  return sc.scrollTop > before;
}"""


OPTIONS_JS = """(el, want) => {
  // One pass over the rendered options: their labels, and tag the exact match.
  // Done in-page because the virtualized list re-renders between separate calls.
  const norm = t => (t || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  el.querySelectorAll('[data-tm-opt]').forEach(o => o.removeAttribute('data-tm-opt'));
  const out = {texts: [], hit: null, selected: false};
  for (const o of el.querySelectorAll("div[role='option'], span[role='option'], li[role='option'], a[role='option']")) {
    const t = (o.getAttribute('aria-label') || o.getAttribute('title') || o.textContent || '').trim();
    out.texts.push(t);
    if (!out.hit && norm(t) === norm(want)) {
      o.setAttribute('data-tm-opt', '1');
      out.hit = t;
      out.selected = o.getAttribute('aria-selected') === 'true' || o.getAttribute('aria-checked') === 'true';
    }
  }
  return out;
}"""


def _find_option(popup, want: str, seen: list[str]):
    """-> (locator of the tagged match, its text, already selected) or (None, None, False)."""
    try:
        r = popup.evaluate(OPTIONS_JS, want)
    except Exception:  # noqa: BLE001 - popup re-rendering; caller retries
        return None, None, False
    for t in r["texts"]:
        if t not in seen:
            seen.append(t)
    if r["hit"]:
        return popup.locator("[data-tm-opt='1']").first, r["hit"], r["selected"]
    return None, None, False


def _open_slicer(page, combo):
    """Click the combobox until its dropdown shows (a closing dropdown can swallow the first click)."""
    for attempt in range(3):
        combo.click()
        page.wait_for_timeout(1000 + 700 * attempt)
        popup = slicer_popup(page, combo)
        try:
            n = popup.evaluate("el => el.querySelectorAll(\"[role='option'], input\").length")
        except Exception:  # noqa: BLE001
            n = 0
        if n:
            return popup
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
    return slicer_popup(page, combo)


def set_slicer(page, slicer: str, wanted: list[str]) -> str | None:
    """Select exactly one item whose text equals one of `wanted` (case/space-insensitive).
    Returns the matched text, or None if the item isn't in the list.

    The list is virtualized (only ~8 names exist in the page at a time, A-Z), so we type
    into the slicer's search box with real key presses (Power BI ignores a bare value
    change), and if that doesn't narrow it, scroll the list until the name shows up.
    """
    f = pbi(page)
    combo = f.get_by_role("combobox", name=slicer).first
    popup = _open_slicer(page, combo)
    search = popup.locator("input.searchInput, input[type='text'], input[type='search'], [role='searchbox']").first
    hit = None
    seen: list[str] = []
    for want in wanted:
        opt = text = None
        selected = False
        if search.count():
            try:
                search.click(timeout=5000, force=True)
                search.press("Control+a")
                search.press("Backspace")
                search.press_sequentially(want, delay=35)
                page.wait_for_timeout(1500)
            except Exception as e:  # noqa: BLE001
                log(f"    search box: {type(e).__name__}: {str(e).splitlines()[0][:120]}")
            opt, text, selected = _find_option(popup, want, seen)
            if opt is None:  # typing didn't narrow it: empty the box and walk the whole list
                try:
                    search.press("Control+a")
                    search.press("Backspace")
                    page.wait_for_timeout(1000)
                except Exception:  # noqa: BLE001
                    pass
        if opt is None:
            for _ in range(200):
                opt, text, selected = _find_option(popup, want, seen)
                if opt is not None:
                    break
                try:
                    if not popup.evaluate(SCROLL_LIST_JS):
                        break
                except Exception:  # noqa: BLE001
                    pass
                page.wait_for_timeout(250)
        if opt is not None:
            if not selected:
                for attempt in range(3):  # the tagged element can be swapped out by a re-render
                    try:
                        opt.click(timeout=5000)
                        break
                    except Exception:  # noqa: BLE001
                        page.wait_for_timeout(500)
                        opt, text, selected = _find_option(popup, want, seen)
                        if opt is None or selected:
                            break
                page.wait_for_timeout(800)
            hit = text
            break
    if not hit:
        log(f"    '{slicer}': no exact '{wanted[0]}' (current: '{(combo.text_content() or '').strip()}'; "
            f"{len(seen)} names seen, e.g. {seen[:4]} ... {seen[-3:]})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    shown = norm(combo.text_content())
    if hit and norm(hit) not in shown and "multiple" in shown:
        log(f"  WARNING: '{slicer}' shows multiple selections after picking '{hit}'")
        return None
    return hit


def dump_frame(page, folder: Path, tag: str) -> None:
    """Probe diagnostics: screenshot + the Power BI frame's interactive elements and HTML."""
    try:
        page.screenshot(path=str(folder / f"{tag}.png"), full_page=True)
    except Exception as e:  # noqa: BLE001
        log(f"  (screenshot failed: {e})")
    frame = next((fr for fr in page.frames if "powerbi.com" in fr.url), None)
    if not frame:
        (folder / f"{tag}_frames.txt").write_text("\n".join(fr.url for fr in page.frames))
        return
    try:
        summary = frame.evaluate("""() => [...document.querySelectorAll(
            '[role=combobox],[role=listbox],[role=option],[role=group],[role=checkbox],[role=grid],[role=columnheader],[role=menuitem],input,.slicer-dropdown-popup,.slicerItemContainer,button[aria-label]'
          )].slice(0, 400).map(e => ({tag: e.tagName, role: e.getAttribute('role'), cls: (e.getAttribute('class') || '').slice(0, 80),
             label: e.getAttribute('aria-label'), title: e.getAttribute('title'), id: e.id || null,
             controls: e.getAttribute('aria-controls'), selected: e.getAttribute('aria-selected') || e.getAttribute('aria-checked'),
             visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
             text: (e.textContent || '').trim().slice(0, 60)}))""")
        (folder / f"{tag}_elements.json").write_text(json.dumps(summary, indent=1))
        (folder / f"{tag}_frame.html").write_text(frame.content(), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        log(f"  (frame dump failed: {e})")


def ensure_live_only(page) -> None:
    group = pbi(page).get_by_role("group", name="warmup_state")
    for name, want in (("Live", True), ("Warmup", False)):
        try:
            cb = group.get_by_role("checkbox", name=name)
            if cb.count() == 0:
                continue
            checked = cb.get_attribute("aria-checked") == "true" or cb.get_attribute("aria-selected") == "true"
            if checked != want:
                cb.click()
                page.wait_for_timeout(800)
        except PWTimeout:
            pass


# The chart titles are images, so the VELO VS. SPIN scatter is found by its data:
# its points are labelled "<Pitch type> (<velo>, <spin>)", e.g. "Sinker (75.85, 2006)".
FIND_VELO_SPIN_JS = """() => {
  document.querySelectorAll('[data-tm-target]').forEach(e => e.removeAttribute('data-tm-target'));
  const re = /^[A-Za-z\\- ]+ \\((-?[\\d.]+), (-?[\\d.]+)\\)$/;
  for (const vc of document.querySelectorAll('.visualContainer')) {
    const pts = [...vc.querySelectorAll('[role=option][aria-label]')].map(e => e.getAttribute('aria-label').match(re)).filter(Boolean);
    if (pts.length && pts.every(m => +m[1] >= 30 && +m[1] <= 110 && +m[2] >= 300 && +m[2] <= 4000)) {
      vc.setAttribute('data-tm-target', 'velo-spin');
      const r = vc.getBoundingClientRect();
      return {points: pts.length, x: r.x, y: r.y, w: r.width, h: r.height};
    }
  }
  return null;
}"""


def pbi_frame(page):
    fr = next((fr for fr in page.frames if "powerbi.com" in fr.url), None)
    if fr is None:
        raise RuntimeError("Power BI frame not found")
    return fr


RECT_JS = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight};
}"""


def screen_box(page, frame, selector: str) -> dict | None:
    """Box of `selector` (inside `frame`) in main-page CSS pixels, computed by hand.

    Playwright's hover/click refuse this report's chart ("Element is outside of the
    viewport") even though it's on screen, so we work out where it is ourselves and
    drive page.mouse. Walks up the iframe chain, adding each iframe's offset and
    border and allowing for a CSS-scaled iframe.
    """
    r = frame.evaluate(RECT_JS, selector)
    if not r:
        return None
    x, y, w, h = r["x"], r["y"], r["w"], r["h"]
    child = frame
    while child.parent_frame is not None:
        handle = child.frame_element()
        fr = handle.evaluate("""(el) => {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          return {x: r.x, y: r.y, w: r.width, ow: el.offsetWidth,
                  bl: el.clientLeft + parseFloat(cs.paddingLeft || 0),
                  bt: el.clientTop + parseFloat(cs.paddingTop || 0)};
        }""")
        # rendered vs layout width of the <iframe> -> CSS transform scale (1.0 normally)
        scale = fr["w"] / fr["ow"] if fr["ow"] else 1.0
        if abs(scale - 1) < 0.01:
            scale = 1.0
        x = fr["x"] + (fr["bl"] + x) * scale
        y = fr["y"] + (fr["bt"] + y) * scale
        w, h = w * scale, h * scale
        child = child.parent_frame
    return {"x": x, "y": y, "w": w, "h": h}


def mouse_to(page, frame, selector: str, button: str | None = None, label: str = "", quiet: bool = False) -> bool:
    """Scroll the main page so the element is on screen, then move (and optionally click) the real mouse."""
    vp = page.viewport_size or page.evaluate("() => ({width: innerWidth, height: innerHeight})")
    box = screen_box(page, frame, selector)
    if not box or box["w"] <= 0 or box["h"] <= 0:
        if not quiet:
            log(f"    {label or selector}: no box")
        return False
    cy = box["y"] + box["h"] / 2
    if cy < 10 or cy > vp["height"] - 10:
        page.evaluate("(dy) => window.scrollBy(0, dy)", cy - vp["height"] / 2)
        page.wait_for_timeout(500)
        box = screen_box(page, frame, selector) or box
    cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
    if not quiet:
        log(f"    {label or selector}: mouse -> ({cx:.0f}, {cy:.0f}) box {box['w']:.0f}x{box['h']:.0f}")
    page.mouse.move(cx, cy, steps=8)
    if button:
        page.mouse.click(cx, cy, button=button)
    return True


JS_CLICK = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  for (const t of ['pointerover','pointerenter','mouseover','pointerdown','mousedown','pointerup','mouseup'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, {bubbles: true, cancelable: true, view: window}));
  el.click();
  return true;
}"""

TAG_MENU_ITEM_JS = """() => {
  document.querySelectorAll('[data-tm-menu]').forEach(e => e.removeAttribute('data-tm-menu'));
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [...document.querySelectorAll('[role=menuitem], button, li, a, div, span')]
    .filter(e => /^show as a table$/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && vis(e));
  if (!cands.length) return false;
  // innermost clickable: prefer role=menuitem / button
  const best = cands.find(e => e.getAttribute('role') === 'menuitem') || cands.find(e => e.tagName === 'BUTTON') || cands[cands.length - 1];
  best.setAttribute('data-tm-menu', 'show-table');
  return true;
}"""

TABLE_OPEN_JS = """() => [...document.querySelectorAll('[role=grid]')].some(g => {
  const r = g.getBoundingClientRect();
  return r.width > 300 && r.height > 150 && g.querySelectorAll('[role=columnheader]').length >= 6;
})"""


def click_show_as_table(page) -> bool:
    """With a visual's menu open, click "Show as a table". True once the table view is up."""
    frame = pbi_frame(page)
    deadline = time.time() + 4
    while time.time() < deadline and not frame.evaluate(TAG_MENU_ITEM_JS):
        page.wait_for_timeout(250)
    if not frame.evaluate(TAG_MENU_ITEM_JS):
        return False
    sel = "[data-tm-menu='show-table']"
    try:
        mouse_to(page, frame, sel, button="left", label="Show as a table")
    except Exception as e:  # noqa: BLE001
        log(f"    mouse click on menu item failed: {e}")
    page.wait_for_timeout(2500)
    if frame.evaluate(TABLE_OPEN_JS):
        return True
    if frame.evaluate(TAG_MENU_ITEM_JS):  # menu still open -> click it from script
        frame.evaluate(JS_CLICK, sel)
        page.wait_for_timeout(2500)
    return bool(frame.evaluate(TABLE_OPEN_JS))


def _attempt(name: str, fn) -> bool:
    try:
        ok = bool(fn())
        log(f"  open table via {name}: {'ok' if ok else 'no'}")
        return ok
    except Exception as e:  # noqa: BLE001  (each route is independent)
        log(f"  open table via {name}: error {type(e).__name__}: {str(e).splitlines()[0][:160]}")
        return False


def open_table(page) -> tuple[str, int]:
    """Open VELO VS. SPIN -> Show as a table. Returns (how it got there, points on the chart)."""
    frame = pbi_frame(page)
    found = frame.evaluate(FIND_VELO_SPIN_JS)
    if not found:
        raise RuntimeError("VELO VS. SPIN chart not found (no scatter with velo/spin points; no pitches for this filter?)")
    tgt = "[data-tm-target='velo-spin']"
    btn = f"{tgt} button.vcMenuBtn, {tgt} [aria-label='More options']"
    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(500)

    def wait_btn(ms: int = 3000) -> bool:
        end = time.time() + ms / 1000
        while time.time() < end:
            if frame.evaluate("(s) => { const b = document.querySelector(s); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }", btn):
                return True
            page.wait_for_timeout(200)
        return False

    def esc():
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

    # 1) real mouse over the chart -> its own "More options" button -> Show as a table
    def via_mouse():
        mouse_to(page, frame, tgt, label="VELO VS. SPIN")
        page.wait_for_timeout(900)
        if not wait_btn():
            frame.evaluate("(s) => document.querySelector(s)?.focus()", tgt)  # focus also shows the header
            if not wait_btn():
                log("    More options button never appeared on the chart")
                return False
        mouse_to(page, frame, btn, button="left", label="More options")
        if click_show_as_table(page):
            return True
        esc()
        return False

    # 2) same button, clicked from script
    def via_js_button():
        frame.evaluate("(s) => document.querySelector(s)?.focus()", tgt)
        mouse_to(page, frame, tgt, label="VELO VS. SPIN")
        if not wait_btn():
            return False
        frame.evaluate(JS_CLICK, btn)
        if click_show_as_table(page):
            return True
        esc()
        return False

    # 3) right-click the chart -> context menu
    def via_context():
        mouse_to(page, frame, f"{tgt} svg[aria-label='Plot area']", button="right", label="plot (right-click)")
        if click_show_as_table(page):
            return True
        esc()
        return False

    # 4) keyboard: focus the visual, Alt+Shift+F10 into its header, tab to More options
    def via_keyboard():
        frame.evaluate("(s) => document.querySelector(s)?.focus()", tgt)
        page.keyboard.press("Alt+Shift+F10")
        page.wait_for_timeout(500)
        for _ in range(8):
            if frame.evaluate("() => document.activeElement?.classList?.contains('vcMenuBtn') || document.activeElement?.getAttribute('aria-label') === 'More options'"):
                page.keyboard.press("Enter")
                if click_show_as_table(page):
                    return True
                esc()
                return False
            page.keyboard.press("Tab")
            page.wait_for_timeout(200)
        return False

    for name, fn in (("mouse + More options", via_mouse), ("script click on More options", via_js_button),
                     ("right-click", via_context), ("keyboard Alt+Shift+F10", via_keyboard)):
        if _attempt(name, fn):
            return (name, found["points"])
    raise RuntimeError("Couldn't open 'Show as a table' (tried mouse, script click, right-click, keyboard)")


def back_to_report(page) -> None:
    f = pbi(page)
    for role in ("button", "menuitem", "link"):
        el = f.get_by_role(role, name="Back to report")
        if el.count():
            el.first.click()
            page.wait_for_timeout(1500)
            return


def header_fields(headers: list[str]) -> list[str | None]:
    out = []
    for h in headers:
        h2 = norm_header(h)
        if h2 in ("row selection", "") or h2.startswith("row selection"):
            out.append(None)
            continue
        out.append(next((f for key, f in HEADER_RULES if key in h2), None))
    return out


GRID_TAG_JS = """() => {
  document.querySelectorAll('[data-tm-grid]').forEach(e => e.removeAttribute('data-tm-grid'));
  let best = null, n = -1;
  for (const g of document.querySelectorAll('[role=grid]')) {
    const r = g.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const k = g.querySelectorAll('[role=columnheader]').length;
    if (k > n) { best = g; n = k; }
  }
  if (best) best.setAttribute('data-tm-grid', '1');
  return n;
}"""

# Snapshot of what the virtualized grid has rendered right now, keyed by
# aria-rowindex / aria-colindex so pieces from different scroll positions merge.
GRID_SNAPSHOT_JS = """() => {
  const g = document.querySelector('[data-tm-grid]');
  if (!g) return null;
  const txt = e => (e.textContent || '').replace(/\u00a0/g, ' ').trim();
  const headers = {};
  let indexed = true;
  for (const h of g.querySelectorAll('[role=columnheader]')) {
    const c = h.getAttribute('aria-colindex');
    if (!c) { indexed = false; continue; }
    headers[c] = txt(h);
  }
  const firstCol = Object.keys(headers).map(Number).sort((a, b) => a - b).find(c => !/^row selection/i.test(headers[c]));
  const cells = {};
  for (const c of g.querySelectorAll('[role=gridcell], [role=rowheader]')) {
    const row = c.closest('[aria-rowindex]');
    const ri = c.getAttribute('aria-rowindex') || (row && row.getAttribute('aria-rowindex'));
    let ci = c.getAttribute('aria-colindex');
    if (!ci && c.getAttribute('role') === 'rowheader' && firstCol) ci = String(firstCol);
    if (!ri || !ci) { indexed = false; continue; }
    (cells[ri] = cells[ri] || {})[ci] = txt(c);
  }
  return {indexed, headers, cells};
}"""

H_SCROLLERS_JS = """(dx) => {
  const g = document.querySelector('[data-tm-grid]');
  let moved = false;
  for (const e of [g, ...g.querySelectorAll('*')]) {
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && /(auto|scroll)/.test(cs.overflowX)) {
      const before = e.scrollLeft; e.scrollLeft += dx; if (e.scrollLeft !== before) moved = true;
    }
  }
  return moved;
}"""


def read_grid(page) -> tuple[list[str], list[list[str]]]:
    """Read every cell of the show-as-table grid.

    The grid is virtualized both ways: only the rows and columns on screen exist in
    the DOM, and it's wider than the window (HAA, plate location, zone and session
    are off to the right). So we sweep: down the rows at each horizontal position,
    then step right, merging cells by aria-rowindex / aria-colindex.
    """
    frame = pbi_frame(page)
    f = pbi(page)
    f.get_by_role("grid").first.wait_for(timeout=20_000)
    page.wait_for_timeout(1000)
    frame.evaluate(GRID_TAG_JS)
    snap = frame.evaluate(GRID_SNAPSHOT_JS)
    if not snap or not snap["indexed"]:
        log("    grid has no aria-colindex; reading rows as rendered")
        return read_grid_simple(page)

    headers: dict[int, str] = {}
    cells: dict[int, dict[int, str]] = {}
    # start at the far left (a retry may begin with the grid scrolled right)
    frame.evaluate(H_SCROLLERS_JS, -100000)

    def absorb() -> int:
        sn = frame.evaluate(GRID_SNAPSHOT_JS) or {"headers": {}, "cells": {}}
        for c, h in sn["headers"].items():
            headers[int(c)] = h
        for r, row in sn["cells"].items():
            dst = cells.setdefault(int(r), {})
            for c, v in row.items():
                if v or int(c) not in dst:
                    dst[int(c)] = v
        return len(headers) * 100000 + sum(len(v) for v in cells.values())

    def wheel(dx: int, dy: int) -> None:
        try:
            mouse_to(page, frame, "[data-tm-grid]", quiet=True)  # pointer over the grid so it takes the wheel
            page.mouse.wheel(dx, dy)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(300)

    def vertical_sweep() -> None:
        stable, last = 0, absorb()
        for _ in range(300):
            wheel(0, 400)
            now = absorb()
            stable = stable + 1 if now == last else 0
            last = now
            if stable >= 3:
                break
        for _ in range(3):  # back to the top
            wheel(0, -50000)
        frame.evaluate("""() => { const g = document.querySelector('[data-tm-grid]');
          for (const e of [g, ...g.querySelectorAll('*')]) if (e.scrollTop) e.scrollTop = 0; }""")

    # Most tables (one pitcher, one day) fit on screen top to bottom; then only the
    # columns need scrolling. Sweep rows only if the first sweep found rows below the fold.
    for _ in range(3):
        wheel(-5000, 0)
    first_view_rows = len(frame.evaluate(GRID_SNAPSHOT_JS)["cells"])
    vertical_sweep()
    tall = len(cells) > first_view_rows
    still = 0
    for step in range(25):  # hard stop: 25 horizontal positions
        n_cols = len(headers)
        if step > 0 and tall:
            vertical_sweep()
        if not frame.evaluate(H_SCROLLERS_JS, 500):  # real scrollbar if there is one, else the wheel
            wheel(500, 0)
        absorb()
        if len(headers) == n_cols and step > 0:
            still += 1
            page.wait_for_timeout(600)  # a busy PC renders slowly; give it a moment before giving up
        else:
            still = 0
        if still >= 3:
            break
    log(f"    grid: {len(headers)} columns x {len(cells)} rows")

    cols = sorted(headers)
    head_list = [headers[c] for c in cols]
    rows = []
    for r in sorted(cells):
        vals = [cells[r].get(c, "") for c in cols]
        if any(vals) and vals != head_list:
            rows.append(vals)
    return head_list, rows


def read_grid_simple(page) -> tuple[list[str], list[list[str]]]:
    """Fallback for grids without aria-colindex: rows as rendered, scrolling vertically only."""
    f = pbi(page)
    grids = f.get_by_role("grid").all()
    widths = [g.get_by_role("columnheader").count() for g in grids]
    grid = grids[widths.index(max(widths))]
    headers = [(h.text_content() or "").strip() for h in grid.get_by_role("columnheader").all()]
    rows: dict[str, list[str]] = {}
    stable = 0
    scroller = grid.locator(".mid-viewport, .scrollable-cells-viewport, [class*='scroll']").first
    for _ in range(400):  # hard stop: 400 scroll steps
        before = len(rows)
        for r in grid.get_by_role("row").all():
            cells = r.locator("[role='gridcell'], [role='rowheader'], td").all()
            vals = [(c.text_content() or "").strip() for c in cells]
            if not any(vals) or (headers and vals == headers):
                continue
            key = r.get_attribute("aria-rowindex") or "|".join(vals)
            rows[key] = vals
        stable = stable + 1 if len(rows) == before else 0
        if stable >= 3:
            break
        try:
            if scroller.count():
                scroller.evaluate("el => el.scrollBy(0, el.clientHeight * 0.8)")
            else:
                grid.hover()
                page.mouse.wheel(0, 600)
        except Exception:  # noqa: BLE001
            page.mouse.wheel(0, 600)
        page.wait_for_timeout(350)

    def order(k: str):
        return (0, int(k)) if k.isdigit() else (1, k)

    return headers, [rows[k] for k in sorted(rows, key=order)]


def rows_to_pitches(headers: list[str], rows: list[list[str]]) -> tuple[list[dict], str]:
    """Grid rows -> pitch dicts.

    The table is a matrix grouped by pitch type: a group row carries only the type
    ("ChangeUp"), and each pitch row's first cell is its "velo, spin" label
    ("72.7, 1534"; spin can be missing: "68.4,").
    """
    fields = header_fields(headers)
    use_headers = headers and len([f for f in fields if f]) >= 8
    mode = "headers" if use_headers else "positional"
    out = []
    group = None
    for vals in rows:
        rec: dict = {}
        if use_headers:
            # Some grids add a leading row-number/selection cell; align from the right.
            offset = max(0, len(vals) - len(headers))
            for i, h in enumerate(headers):
                v = vals[i + offset] if i + offset < len(vals) else ""
                rec[fields[i] or f"col:{h}"] = v
        else:
            for i, field in enumerate(POSITIONAL):
                rec[field] = vals[i] if i < len(vals) else ""
        nonempty = [v for v in rec.values() if isinstance(v, str) and v.strip()]
        first = (rec.get("pitch_type") or "").strip()
        if len(nonempty) == 1 and first and not SPEED_SPIN_RE.match(first):
            if first.lower().startswith("total"):
                continue
            group = first  # pitch-type group header row
            continue
        if not nonempty or first.lower().startswith("total"):
            continue
        if SPEED_SPIN_RE.match(first):  # first cell is the label; type comes from the group
            rec.setdefault("speed_spin_label", "")
            rec["speed_spin_label"] = rec["speed_spin_label"] or first
            rec["pitch_type"] = group or ""
        # The combined "82.7, 2475" label can sit under any header; find it.
        label = rec.get("speed_spin_label") or next((v for v in rec.values() if isinstance(v, str) and SPEED_SPIN_RE.match(v)), "")
        m = SPEED_SPIN_RE.match(label or "")
        rec["speed_spin_label"] = label
        rec["release_speed_mph"] = float(m.group(1)) if m else to_float(rec.get("release_speed"))
        rec["spin_rate_rpm"] = (float(m.group(2)) if m.group(2) else None) if m else to_float(rec.get("spin_rate"))
        out.append(rec)
    return out, mode


def save_querydata(cap: "ApiCapture", folder: Path, name: str) -> None:
    """Probe only: Power BI's own query responses (the data behind each visual), raw."""
    (folder / name).write_text(json.dumps([{"t": t, "url": u.split("?")[0], "body": b} for t, u, b in cap.pbi], default=str))
    (folder / "powerbi_requests.txt").write_text("\n".join(cap.pbi_urls))


def pull_player_session(page, player: dict, session: dict, probe_dir: Path | None = None, cap: "ApiCapture | None" = None) -> dict:
    if cap is not None:
        cap.pbi.clear()
        cap.pbi_urls.clear()
    wait_report(page)
    # The two slicers filter each other: with a date picked, the pitcher list only holds
    # that day's pitchers (and vice versa). Clear the date before picking the pitcher.
    clear_slicer(page, "US DATE")
    name_hit = set_slicer(page, "pitcher_full_name", [player["name"]])
    if not name_hit:
        clear_slicer(page, "pitcher_full_name")
        clear_slicer(page, "US DATE")
        name_hit = set_slicer(page, "pitcher_full_name", [player["name"]])
    if not name_hit:
        return {"status": "player_not_in_report", "pitches": [],
                "detail": f"date slicer showed '{slicer_value(page, 'US DATE')}'"}
    date_hit = set_slicer(page, "US DATE", us_date_variants(session["local_date"]))
    if not date_hit:
        return {"status": "date_not_in_report", "pitches": []}
    ensure_live_only(page)
    page.wait_for_timeout(4000)
    if probe_dir and cap is not None:
        save_querydata(cap, probe_dir, "querydata_report.json")
    try:
        how, chart_points = open_table(page)
    except RuntimeError as e:
        if "chart not found" in str(e):  # in the slicer, but no Live pitches on this date
            return {"status": "no_live_pitches", "pitches": []}
        raise
    headers, rows = read_grid(page)
    if "session_id" not in header_fields(headers):  # columns on the right didn't render: try once more
        log(f"    only {len(headers)} columns (no session_id); reading the table again")
        headers, rows = read_grid(page)
    if "session_id" not in header_fields(headers):
        raise RuntimeError(f"table incomplete: {len(headers)} columns, no session_id (retried next run)")
    pitches, mode = rows_to_pitches(headers, rows)
    if probe_dir:
        page.screenshot(path=str(probe_dir / "table.png"), full_page=True)
        (probe_dir / "table.json").write_text(json.dumps({"opened_by": how, "chart_points": chart_points, "headers": headers, "mapping": header_fields(headers),
                                                          "mode": mode, "row_count": len(rows), "first_rows": rows[:5]}, indent=1))
        if cap is not None:
            save_querydata(cap, probe_dir, "querydata_table.json")
        dump_frame(page, probe_dir, "table_view")  # grid DOM, in case columns need another look
    back_to_report(page)

    # Guard against a stale table (slicer change not applied yet): every row names the pitcher.
    names = {norm(p.get("pitcher_name")) for p in pitches if p.get("pitcher_name")}
    if names and norm(player["name"]) not in names:
        raise RuntimeError(f"table shows {sorted(names)[:3]}, expected {player['name']} (stale filter?)")
    wrong_session = [p for p in pitches if p.get("session_id") and GUID_RE.search(p["session_id"])
                     and p["session_id"].lower() != session["session_id"].lower()]
    other_pitcher = [p for p in pitches if p.get("pitcher_name") and norm(p["pitcher_name"]) != norm(player["name"])]
    keep = [p for p in pitches if p not in wrong_session and p not in other_pitcher]
    for i, p in enumerate(keep):
        p.update({
            "tm_session_id": session["session_id"],
            "tm_player_id": player["player_id"],
            "filter_player": player["name"],
            "filter_date": date_hit,
            "session_local_date": session["local_date"],
            "row_in_table": i,
            "column_mode": mode,
        })
    return {"status": "ok", "pitches": keep, "wrong_session": len(wrong_session), "column_mode": mode,
            "chart_points": chart_points}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

class ProfileInUse(RuntimeError):
    pass


def launch(pw, args):
    """Browser with the saved sign-in. --headless runs it with no window (Chromium's
    full "new" headless, with the normal Chrome user agent so the portal and Power BI
    treat it like the windowed browser)."""
    profile = Path(args.profile).resolve()
    profile.mkdir(parents=True, exist_ok=True)
    headless = args.headless and not args.login
    opts = dict(accept_downloads=True, viewport={"width": 1600, "height": 2400})

    def start(**extra):
        try:
            return pw.chromium.launch_persistent_context(str(profile), headless=headless, **opts, **extra)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if any(k in msg for k in ("ProcessSingleton", "already in use", "SingletonLock", "existing browser session")):
                raise ProfileInUse(f"the browser profile {profile} is in use (another TrackMan run, or a window left open)") from e
            raise

    if not headless:
        return start()
    try:
        ctx = start(channel="chromium")  # new headless mode (same engine as the window)
    except ProfileInUse:
        raise
    except Exception:  # noqa: BLE001 - older Playwright: default headless shell
        ctx = start()
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    ua = page.evaluate("navigator.userAgent")
    if "Headless" in ua:
        ctx.close()
        ctx = start(channel="chromium", user_agent=ua.replace("HeadlessChrome", "Chrome"))
    return ctx


def main() -> int:
    # Names can contain emoji (e.g. "Jimmy 🦴 Morgan"); a Windows console or a
    # redirected log defaults to cp1252 and would crash on them.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--login", action="store_true", help="open the portal to sign in; press Enter here when done")
    ap.add_argument("--probe", action="store_true", help="pull one player from the newest session and save diagnostics")
    ap.add_argument("--from", dest="from_date", default=None, help="YYYY-MM-DD (default: 14 days ago)")
    ap.add_argument("--to", dest="to_date", default=None, help="YYYY-MM-DD (default: today)")
    ap.add_argument("--out", default="trackman_out")
    ap.add_argument("--profile", default=".trackman_profile", help="browser profile folder that keeps the sign-in")
    ap.add_argument("--player", help="only pull players whose name contains this")
    ap.add_argument("--headless", action="store_true", help="no browser window (scheduled / background runs)")
    ap.add_argument("--run-dir", help="where this run's sessions.json / pitches.jsonl / validation.json go (default: --out)")
    ap.add_argument("--save-raw", action="store_true", help="keep every captured portal API response in <out>/raw")
    args = ap.parse_args()

    today = date.today()
    to_iso = args.to_date or today.isoformat()
    from_iso = args.from_date or date.fromordinal(today.toordinal() - 14).isoformat()
    out = Path(args.out).resolve()
    run_dir = Path(args.run_dir).resolve() if args.run_dir else out
    run_dir.mkdir(parents=True, exist_ok=True)
    (out / "raw").mkdir(parents=True, exist_ok=True)
    log(f"Output folder: {out}" + (f" (this run: {run_dir})" if run_dir != out else ""))

    with sync_playwright() as pw:
        try:
            ctx = launch(pw, args)
        except ProfileInUse as e:
            log(f"Can't start: {e}.")
            return 3
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        if args.login:
            page.goto(BASE)
            input("Sign in to the TrackMan portal in the browser window, then press Enter here... ")
            ctx.close()
            log(f"Sign-in saved in {args.profile}. Re-run without --login.")
            return 0

        cap = ApiCapture(out / "raw" if (args.save_raw or args.probe) else None)
        page.on("response", cap.on_response)

        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        if "login" in page.url.lower() or "signin" in page.url.lower():
            log("Not signed in (the saved TrackMan sign-in expired). Run trackman_pull.py --login once, then re-run.")
            ctx.close()
            return 2

        log("Roster...")
        roster = get_roster(page, cap, out)
        (out / "roster.json").write_text(json.dumps(list(roster.values()), indent=1, default=str))
        log(f"  {len(roster)} players")

        log(f"Sessions {from_iso} -> {to_iso}...")
        try:
            all_sessions = get_sessions(page, cap, from_iso, to_iso)
        except RuntimeError as e:
            log(f"  {e}")
            return 1
        types = sorted({s["type"] or "?" for s in all_sessions})
        sessions = [s for s in all_sessions if "pitch" in s["type"].lower()]
        log(f"  {len(all_sessions)} sessions ({', '.join(types) or 'none'}); {len(sessions)} pitching")
        # Players per session: from the session JSON, else the "Players in session" dialog.
        # Then fill in throws / foreign IDs from the roster (same displayed Player ID).
        for s in sessions:
            for i, pl in enumerate(s["players"]):
                r = roster.get(pl["player_id"])
                if r:
                    s["players"][i] = {**r, **{k: v for k, v in pl.items() if v not in (None, [], "")}}
                    s["players"][i]["throws"] = pl.get("throws") or r.get("throws")
                    s["players"][i]["foreign_ids"] = pl.get("foreign_ids") or r.get("foreign_ids") or []
        (run_dir / "sessions.json").write_text(json.dumps(sessions, indent=1, default=str))
        if not sessions:
            log("  No pitching sessions in this range.")
            (run_dir / "summary.json").write_text(json.dumps({"sessions": 0, "ok": 0, "errors": 0, "not_in_report": 0}))
            ctx.close()
            return 0

        if args.probe:
            probe_dir = out / "probe"
            probe_dir.mkdir(exist_ok=True)
            s = sorted(sessions, key=lambda x: x["local_date"] or "")[-1]
            pl = next((p for p in s["players"] if not args.player or norm(args.player) in norm(p["name"])), None)
            if not pl:
                log("  No players found for that session; see raw/ and sessions.json.")
                return 1
            log(f"PROBE: {pl['name']} in session {s['session_id']} ({s['local_date']}, {s['plays']} plays for {s['player_count']} players)")
            try:
                res = pull_player_session(page, pl, s, probe_dir, cap)
            except Exception as e:  # noqa: BLE001 - the probe's job is to report, not to crash
                log(f"  FAILED: {type(e).__name__}: {str(e).splitlines()[0][:300]}")
                dump_frame(page, probe_dir, "failure")
                save_querydata(cap, probe_dir, "querydata_failure.json")
                # also show the pitcher dropdown opened, the step that usually breaks first
                try:
                    pbi(page).get_by_role("combobox", name="pitcher_full_name").first.click()
                    page.wait_for_timeout(1500)
                    dump_frame(page, probe_dir, "pitcher_dropdown")
                    page.keyboard.press("Escape")
                except Exception:  # noqa: BLE001
                    pass
                log(f"  Diagnostics in {probe_dir} (failure.png, *_elements.json, *_frame.html). Send these back.")
                ctx.close()
                return 1
            (probe_dir / "pitches.json").write_text(json.dumps(res, indent=1, default=str))
            log(f"  status={res['status']} rows={len(res['pitches'])} (chart shows {res.get('chart_points')} points) "
                f"columns={res.get('column_mode')} wrong_session={res.get('wrong_session', 0)}")
            if res["pitches"]:
                p0 = res["pitches"][0]
                log(f"  first row: {p0.get('pitch_type')} {p0.get('release_speed_mph')} mph {p0.get('spin_rate_rpm')} rpm "
                    f"IVB {p0.get('ivb_in')} HB {p0.get('hb_in')} time {p0.get('pitch_time')}")
            log(f"  Diagnostics in {probe_dir} (table.png, table.json, pitches.json, querydata_*.json). Send these back to check.")
            ctx.close()
            return 0

        # done.json is shared by every run. The key includes the session's Plays count, so a
        # session that keeps growing after we pulled it (left open overnight) is pulled again.
        done_path = out / "done.json"
        done = set(json.loads(done_path.read_text())) if done_path.exists() else set()
        validation = json.loads((run_dir / "validation.json").read_text()) if (run_dir / "validation.json").exists() else {}
        out_path = run_dir / "pitches.jsonl"
        hits = misses = errors = 0
        for s in sorted(sessions, key=lambda x: x["local_date"] or ""):
            v = validation.setdefault(s["session_id"], {"date": s["local_date"], "plays": s["plays"], "players": {}})
            for pl in s["players"]:
                if args.player and norm(args.player) not in norm(pl["name"]):
                    continue
                key = f"{s['session_id']}|{pl['player_id']}|{s.get('plays') or ''}"
                if key in done:
                    continue
                log(f"{s['local_date']}  {pl['name']}  (session {s['session_id'][:8]})")
                try:
                    res = pull_player_session(page, pl, s)
                except Exception as e:  # noqa: BLE001 - keep the loop alive, retry next run
                    errors += 1
                    log(f"  ERROR: {str(e).splitlines()[0][:300]}")
                    v["players"][pl["player_id"]] = {"name": pl["name"], "status": f"error: {e}"[:300]}
                    (run_dir / "validation.json").write_text(json.dumps(validation, indent=1))
                    if errors >= 8 and errors > 2 * hits:
                        log("STOPPING: too many errors in a row; the report may have changed. Retry later or send me the log.")
                        dump_frame(page, out / "probe", "errors")
                        ctx.close()
                        return 4
                    continue
                if res["status"] == "player_not_in_report":
                    misses += 1
                    v["players"][pl["player_id"]] = {"name": pl["name"], "status": res["status"], "detail": res.get("detail")}
                    log(f"  not in report ({res.get('detail')}); will retry next run")
                    if misses >= 5 and not hits:
                        log("STOPPING: the first 5 players weren't found in the report's pitcher list. Something is filtering it; send me the output.")
                        dump_frame(page, out / "probe", "not_in_report")
                        ctx.close()
                        return 1
                    continue
                hits += 1
                with open(out_path, "a", encoding="utf-8") as f:
                    for p in res["pitches"]:
                        f.write(json.dumps(p, default=str) + "\n")
                v["players"][pl["player_id"]] = {"name": pl["name"], "status": res["status"], "pitches": len(res["pitches"]),
                                                 "wrong_session_rows": res.get("wrong_session", 0)}
                done.add(key)
                done_path.write_text(json.dumps(sorted(done), indent=1))
                pulled = sum(x.get("pitches", 0) for x in v["players"].values())
                v["pulled"] = pulled
                v["short_by"] = (s["plays"] - pulled) if s["plays"] else None
                (run_dir / "validation.json").write_text(json.dumps(validation, indent=1))
                log(f"  {res['status']}: {len(res['pitches'])} pitches")
                time.sleep(1)

        short = {k: x for k, x in validation.items() if (x.get("short_by") or 0) > 0}
        (run_dir / "summary.json").write_text(json.dumps({"sessions": len(sessions), "ok": hits, "errors": errors,
                                                          "not_in_report": misses, "short_sessions": len(short)}))
        log(f"Done. {hits} pulled, {errors} errors, {misses} not in the report; "
            f"{len(short)} session(s) short of their Plays count (see validation.json).")
        ctx.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
