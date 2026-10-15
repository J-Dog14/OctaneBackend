#!/usr/bin/env python3
"""
Load a TrackMan portal pull (trackman_pull.py output) into the warehouse.

    python uais/python/trackman/load_trackman_pull.py --dir trackman_out --dry-run   # report only
    python uais/python/trackman/load_trackman_pull.py --dir trackman_out             # write
    python uais/python/trackman/load_trackman_pull.py --relink                       # re-match unlinked players
    python uais/python/trackman/load_trackman_pull.py --link 1000537565 <athlete_uuid>
    python uais/python/trackman/load_trackman_pull.py --report                       # players needing review

What it writes (schema: uais/sql/create_pitch_intel_schema.sql, `npm run pi:setup`)
  pitch_intel.trackman_players   every TrackMan player seen (roster + sessions), linked or not
  pitch_intel.trackman_sessions  one row per portal session
  pitch_intel.trackman_pitches   one row per pitch, data_source = 'portal'
  pitch_intel.athlete_source_links (source 'trackman') for each linked player, so the
      Pitch Intel pages, Sessions page and coach suite pick the pitches up
  analytics.d_athletes           only for players WITH pitch data who match nobody:
      created through athlete_manager.get_or_create_athlete with
      source_system = 'trackman' and source_athlete_id = the TrackMan player ID

Matching a player to an athlete, first hit wins
  1. already linked in trackman_players (a previous run or a manual --link)
  2. an existing Trackman link (pitch_intel.athlete_source_links, e.g. from a CSV upload)
  3. MLB-ID players: an existing Savant link with that MLB ID
  4. analytics.source_athlete_map (trackman, player ID)
  5. athlete_manager's own resolution (exact normalized name + DOB, then 90% fuzzy name),
     the same rule every other pipeline uses, EXCEPT: when both sides have a birth
     date and they differ, nothing is linked or created. The player is marked
     'conflict' and their pitches are stored with athlete_uuid NULL until --link.
  6. no match -> new athlete, origin 'trackman'

Players in the roster without any pitches get a trackman_players row only (no athlete).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve()
UAIS = HERE.parents[2]          # .../uais
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / "python"))

import psycopg2  # noqa: E402
from psycopg2.extras import Json, RealDictCursor, execute_values  # noqa: E402

SOURCE_SYSTEM = "trackman"
LINKED_BY = "trackman-portal"

# Same mapping as lib/pitch-intel/pitch-types.ts (TRACKMAN_TO_CODE). Keep them in step.
TRACKMAN_TO_CODE = {
    "fastball": "FF", "four-seam": "FF", "four seam": "FF", "fourseamfastball": "FF", "4-seam": "FF",
    "sinker": "SI", "twoseamfastball": "SI", "two-seam": "SI", "two seam": "SI",
    "cutter": "FC", "slider": "SL", "sweeper": "ST", "curveball": "CU", "curve": "CU",
    "knuckle curve": "KC", "knucklecurve": "KC", "splitter": "FS", "split-finger": "FS", "splitfinger": "FS",
    "changeup": "CH", "change-up": "CH", "change up": "CH",
}


# Below the shared 90% auto-match rule, a name this close to an existing athlete is held
# for a person to decide instead of creating a probable duplicate.
REVIEW_SIMILARITY = 0.80
REVIEW_SIMILARITY_SAME_DOB = 0.60


def athlete_name(name: str) -> str:
    """Portal name -> name for the athlete record: drop emoji and other symbols
    ("Jimmy 🦴 Morgan" -> "Jimmy Morgan"), keep letters, accents, apostrophes, hyphens, periods."""
    import unicodedata
    kept = "".join(ch for ch in name if unicodedata.category(ch)[0] in ("L", "M", "Z") or ch in "'’-.")
    return " ".join(kept.split())


def code_for(name: str | None) -> str:
    return TRACKMAN_TO_CODE.get((name or "").strip().lower(), "OTHER")


def num(v):
    if v in (None, "", "-", "—"):
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


PITCH_TIME_FORMATS = ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S")


def pitch_time_key(v) -> datetime:
    """Sortable pitch time. The portal shows "10/10/2026 11:39:18 AM"; string order breaks on AM/PM."""
    s = str(v or "").strip()
    for fmt in PITCH_TIME_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return datetime.max


def level_for_age(dob: str | None, on: str | None) -> str | None:
    """Grading level for a new Trackman link, from age on the session date (xArsenal comp levels)."""
    if not dob or not on:
        return None
    b, d = date.fromisoformat(dob), date.fromisoformat(on)
    age = d.year - b.year - ((d.month, d.day) < (b.month, b.day))
    if age <= 14:
        return "Youth (14U)"
    if age <= 18:
        return "High School"
    if age <= 22:
        return "College"
    return None  # adults: set by hand (MiLB / Indy / MLB)


def infer_throws(pitches: list[dict]) -> tuple[str | None, str]:
    """Fallback when the portal has no throwing hand. Portable TrackMan reports release side and HB from the pitcher's view, + = pitcher's right
    (checked on a known RHP export: RelSide +2.7 ft, fastball HB +15 in). Both signs must agree."""
    sides = [p["rel_side"] for p in pitches if p["rel_side"] is not None]
    fb = [p["hb"] for p in pitches if p["hb"] is not None and p["pitch_type"] in ("FF", "SI")]
    if len(sides) < 3:
        return None, "too few pitches with release side"
    by_side = "R" if statistics.median(sides) > 0 else "L"
    if len(fb) >= 3:
        by_fb = "R" if statistics.median(fb) > 0 else "L"
        if by_fb != by_side:
            return None, f"release side says {by_side}, fastball break says {by_fb}"
    return by_side, "inferred"


def pitch_uid(p: dict) -> str:
    key = "|".join(str(p.get(k) or "") for k in ("tm_session_id", "tm_player_id", "pitch_time", "release_speed_mph", "spin_rate_rpm"))
    return "tmportal:" + hashlib.sha1(key.encode()).hexdigest()[:24]


# ---------------------------------------------------------------------------
# Reading the pull folder
# ---------------------------------------------------------------------------

def read_pull(folder: Path):
    sessions = json.loads((folder / "sessions.json").read_text()) if (folder / "sessions.json").exists() else []
    # A run folder (trackman_out/runs/...) shares the roster saved one or two levels up.
    roster_file = next((d / "roster.json" for d in (folder, folder.parent, folder.parent.parent) if (d / "roster.json").exists()), None)
    roster = json.loads(roster_file.read_text()) if roster_file else []
    pitches = []
    pj = folder / "pitches.jsonl"
    if pj.exists():
        with open(pj, encoding="utf-8") as f:
            pitches = [json.loads(line) for line in f if line.strip()]
    players: dict[str, dict] = {}
    for p in roster:
        players[str(p["player_id"])] = p
    for s in sessions:
        for p in s.get("players") or []:
            players.setdefault(str(p["player_id"]), p)
    return sessions, players, pitches


def build_pitch_rows(raw_pitches: list[dict], sessions_by_id: dict[str, dict]):
    rows, seen = [], set()
    for p in raw_pitches:
        sid, pid = p.get("tm_session_id"), str(p.get("tm_player_id") or "")
        if not sid or not pid:
            continue
        uid = pitch_uid(p)
        if uid in seen:
            continue
        seen.add(uid)
        s = sessions_by_id.get(sid, {})
        rows.append({
            "pitch_uid": uid,
            "tm_session_id": sid,
            "tm_player_id": pid,
            "session_date": p.get("session_local_date") or s.get("local_date"),
            "pitch_time": p.get("pitch_time"),
            "pitcher_name": p.get("pitcher_name") or p.get("filter_player"),
            "tagged_pitch_type": p.get("pitch_type"),
            "pitch_type": code_for(p.get("pitch_type")),
            "rel_speed": p.get("release_speed_mph"),
            "spin_rate": p.get("spin_rate_rpm"),
            "ivb": num(p.get("ivb_in")),
            "hb": num(p.get("hb_in")),
            "rel_height": num(p.get("release_height_ft")),
            "rel_side": num(p.get("release_side_ft")),
            "extension": num(p.get("extension_ft")),
            "vaa": num(p.get("vaa_deg")),
            "haa": num(p.get("haa_deg")),
            "plate_loc_height": num(p.get("location_height_ft")),
            "plate_loc_side": num(p.get("location_side_ft")),
            "spin_efficiency": num(p.get("spin_efficiency_pct")),
            "gyro": num(p.get("gyro_deg")),
            "tilt": p.get("tilt") or None,
            "measured_tilt": p.get("measured_tilt") or None,
            "zone_location": p.get("zone_location") or None,
            "raw": p,
        })
    # pitch_no: order within (session, player) by pitch time, then table order
    groups = defaultdict(list)
    for r in rows:
        groups[(r["tm_session_id"], r["tm_player_id"])].append(r)
    for g in groups.values():
        g.sort(key=lambda r: (pitch_time_key(r["pitch_time"]), r["raw"].get("row_in_table", 0)))
        for i, r in enumerate(g, 1):
            r["pitch_no"] = i
    return rows


# ---------------------------------------------------------------------------
# Athlete resolution
# ---------------------------------------------------------------------------

class Resolver:
    def __init__(self, conn, dry_run: bool):
        self.conn = conn
        self.dry_run = dry_run
        self._athletes = None
        from python.common import athlete_manager as am  # the shared identity rules
        self.am = am
        try:
            from python.common.athlete_cleanup import clean_athlete_name_for_processing
            self.clean = clean_athlete_name_for_processing
        except ImportError:
            self.clean = lambda n: (am.normalize_name_for_display(n), am.normalize_name_for_matching(n))

    def near_miss(self, normalized: str, dob: str | None) -> str | None:
        """Best existing athlete that is close but below the shared 90% name rule:
        name similarity >= REVIEW_SIMILARITY, or the same DOB with a looser name match
        (nicknames: "Mike" / "Michael")."""
        if self._athletes is None:
            self._athletes = self.q("SELECT athlete_uuid, name, normalized_name, date_of_birth::text AS dob FROM analytics.d_athletes "
                                    "WHERE normalized_name IS NOT NULL AND normalized_name <> ''")
        best, best_r = None, 0.0
        for a in self._athletes:
            r = self.am._name_similarity(normalized, a["normalized_name"])
            same_dob = bool(dob and a["dob"] and a["dob"] == dob)
            if (r >= REVIEW_SIMILARITY or (same_dob and r >= REVIEW_SIMILARITY_SAME_DOB)) and r > best_r:
                best, best_r = a, r
        if not best:
            return None
        dob_note = "same DOB" if dob and best["dob"] == dob else (f"DOB {best['dob']}" if best["dob"] else "no DOB on file")
        return (f"HELD: possible match {best['name']} ({best['athlete_uuid']}, {round(best_r * 100)}% name, {dob_note}). "
                f"Same person: --link {{pid}} {best['athlete_uuid']}  |  different person: --create {{pid}}")

    def q(self, sql, *params):
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else []

    def resolve(self, player: dict, current: dict | None) -> tuple[str | None, str, str]:
        """-> (athlete_uuid, match_status, note)"""
        pid = str(player["player_id"])
        if current and current.get("athlete_uuid"):
            return current["athlete_uuid"], current["match_status"], current.get("match_note") or ""
        # Every ID the portal knows for this person ("TMBB-1000069193", "MLB-809790", ...).
        # A CSV export's PitcherId is one of the TMBB/AMA numbers.
        ids = {pid}
        mlb_ids = {pid} if player.get("id_source") == "mlb" else set()
        for f in player.get("foreign_ids") or []:
            sysn, _, num = str(f).partition("-")
            if num:
                ids.add(num)
                if sysn.upper() == "MLB":
                    mlb_ids.add(num)
        r = self.q("SELECT athlete_uuid, source_player_id FROM pitch_intel.athlete_source_links WHERE source = 'trackman' AND source_player_id = ANY(%s)", list(ids))
        if r:
            return r[0]["athlete_uuid"], "linked", f"existing Trackman link ({r[0]['source_player_id']})"
        if mlb_ids:
            r = self.q("SELECT athlete_uuid FROM pitch_intel.athlete_source_links WHERE source = 'savant' AND source_player_id = ANY(%s)", list(mlb_ids))
            if r:
                return r[0]["athlete_uuid"], "linked", "existing Savant link (MLB ID)"
        try:
            r = self.q("SELECT athlete_uuid FROM analytics.source_athlete_map WHERE source_system = %s AND source_athlete_id = %s", SOURCE_SYSTEM, pid)
            if r:
                return r[0]["athlete_uuid"], "linked", "source_athlete_map"
        except psycopg2.Error:
            self.conn.rollback()

        display, normalized = self.clean(athlete_name(player["name"]))
        if not normalized:
            return None, "unmatched", "empty name"
        dob = player.get("dob")
        existing = self.am.find_existing_athlete_by_name_or_email(self.conn, normalized, email=None, date_of_birth=dob)
        if existing:
            ex_dob = existing.get("date_of_birth")
            ex_dob = ex_dob.isoformat() if hasattr(ex_dob, "isoformat") else (str(ex_dob) if ex_dob else None)
            if dob and ex_dob and dob != ex_dob:
                return None, "conflict", f"name matches {existing['name']} ({existing['athlete_uuid']}) but DOB {ex_dob} != TrackMan {dob}"
            status = "matched_exact" if (existing.get("normalized_name") or "") == normalized else "matched_fuzzy"
            note = f"{existing['name']}" + ("" if status == "matched_exact" else f" (fuzzy from '{display}')")
            if self.dry_run:
                return existing["athlete_uuid"], status, note
            uuid, _created = self.am.get_or_create_athlete(name=athlete_name(player["name"]), date_of_birth=dob,
                                                          source_system=SOURCE_SYSTEM, source_athlete_id=pid)
            return uuid, status, note
        near = self.near_miss(normalized, dob)
        if near:
            # Close to someone we already have, but under the shared 90% rule: don't guess.
            # Hold the player (pitches are stored, no athlete) until --link or --create.
            return None, "unmatched", near.replace("{pid}", pid)
        if self.dry_run:
            return None, "created", f"would create '{display}' (origin trackman)"
        uuid, created = self.am.get_or_create_athlete(name=athlete_name(player["name"]), date_of_birth=dob,
                                                     source_system=SOURCE_SYSTEM, source_athlete_id=pid)
        return uuid, ("created" if created else "matched_exact"), "new athlete, origin trackman" if created else "matched on create"


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

UPSERT_PLAYERS = """
INSERT INTO pitch_intel.trackman_players (player_id, id_source, name, date_of_birth, team, jersey_number, raw, portal_id, foreign_ids, bats)
VALUES %s
ON CONFLICT (player_id) DO UPDATE SET
  name = EXCLUDED.name,
  portal_id = COALESCE(EXCLUDED.portal_id, pitch_intel.trackman_players.portal_id),
  foreign_ids = CASE WHEN cardinality(EXCLUDED.foreign_ids) > 0 THEN EXCLUDED.foreign_ids ELSE pitch_intel.trackman_players.foreign_ids END,
  bats = COALESCE(EXCLUDED.bats, pitch_intel.trackman_players.bats),
  id_source = EXCLUDED.id_source,
  date_of_birth = COALESCE(EXCLUDED.date_of_birth, pitch_intel.trackman_players.date_of_birth),
  team = COALESCE(EXCLUDED.team, pitch_intel.trackman_players.team),
  jersey_number = COALESCE(EXCLUDED.jersey_number, pitch_intel.trackman_players.jersey_number),
  raw = EXCLUDED.raw,
  updated_at = NOW()
"""

UPSERT_SESSIONS = """
INSERT INTO pitch_intel.trackman_sessions
  (session_id, session_type, local_date, local_datetime, utc_datetime, radar_serial, player_count, plays, raw, pulled_at)
VALUES %s
ON CONFLICT (session_id) DO UPDATE SET
  session_type = EXCLUDED.session_type, local_date = EXCLUDED.local_date, local_datetime = EXCLUDED.local_datetime,
  utc_datetime = EXCLUDED.utc_datetime, radar_serial = EXCLUDED.radar_serial, player_count = EXCLUDED.player_count,
  plays = EXCLUDED.plays, raw = EXCLUDED.raw, pulled_at = NOW(), updated_at = NOW()
"""

PITCH_COLS = [
    "pitch_uid", "athlete_uuid", "link_id", "session_date", "session_type", "pitch_no", "pitch_time",
    "pitcher_name", "pitcher_id", "pitcher_throws", "tagged_pitch_type", "pitch_type",
    "rel_speed", "spin_rate", "ivb", "hb", "rel_height", "rel_side", "extension", "vaa", "haa",
    "plate_loc_height", "plate_loc_side", "spin_efficiency", "raw", "source_file", "upload_id",
    "data_source", "tm_session_id", "tm_player_id", "gyro", "tilt", "measured_tilt", "zone_location",
]
UPSERT_PITCHES = f"""
INSERT INTO pitch_intel.trackman_pitches ({", ".join(PITCH_COLS)})
VALUES %s
ON CONFLICT (pitch_uid) DO UPDATE SET
  {", ".join(f"{c} = EXCLUDED.{c}" for c in PITCH_COLS if c != "pitch_uid")},
  updated_at = NOW()
RETURNING (xmax = 0) AS inserted
"""


def ensure_link(cur, athlete_uuid: str, player: dict, throws: str | None, level: str | None) -> int:
    pid = str(player["player_id"])
    cur.execute("SELECT id, athlete_uuid FROM pitch_intel.athlete_source_links WHERE source = 'trackman' AND source_player_id = %s", (pid,))
    row = cur.fetchone()
    if row:
        if row[1] != athlete_uuid:
            raise RuntimeError(f"TrackMan player {pid} is linked to {row[1]}, not {athlete_uuid}; fix the link first")
        cur.execute("UPDATE pitch_intel.athlete_source_links SET throws = COALESCE(throws, %s), level = COALESCE(level, %s), league = COALESCE(league, %s) WHERE id = %s",
                    (throws, level, level, row[0]))
        return row[0]
    cur.execute(
        """INSERT INTO pitch_intel.athlete_source_links
             (athlete_uuid, source, source_player_id, source_player_name, throws, level, league, pull_enabled, linked_by)
           VALUES (%s, 'trackman', %s, %s, %s, %s, %s, FALSE, %s) RETURNING id""",
        (athlete_uuid, pid, player["name"], throws, level, level, LINKED_BY),
    )
    return cur.fetchone()[0]


def load(conn, folder: Path, dry_run: bool) -> dict:
    sessions, players, raw_pitches = read_pull(folder)
    sessions_by_id = {s["session_id"]: s for s in sessions}
    rows = build_pitch_rows(raw_pitches, sessions_by_id)
    by_player = defaultdict(list)
    for r in rows:
        by_player[r["tm_player_id"]].append(r)
    for pid in by_player:  # players seen only in pitch rows
        if pid not in players:
            first = by_player[pid][0]
            players[pid] = {"player_id": pid, "name": first["pitcher_name"] or pid, "dob": None, "id_source": "trackman", "raw": {}}

    summary = {"players": len(players), "players_with_pitches": len(by_player), "sessions": len(sessions),
               "pitches": len(rows), "status": defaultdict(int), "review": [], "inserted": 0, "updated": 0}
    res = Resolver(conn, dry_run)
    cur = conn.cursor()

    if not dry_run:
        execute_values(cur, UPSERT_PLAYERS, [
            (str(p["player_id"]), p.get("id_source") or "trackman", p["name"], p.get("dob"), p.get("team"),
             None if p.get("jersey") in (None, "-") else str(p.get("jersey")), Json(p.get("raw") or {}),
             p.get("portal_id"), list(p.get("foreign_ids") or []), p.get("bats"))
            for p in players.values()
        ])
        if sessions:
            execute_values(cur, UPSERT_SESSIONS, [
                (s["session_id"], s.get("type"), s.get("local_date"), s.get("local_datetime"), s.get("utc_datetime"),
                 s.get("radar_serial"), s.get("player_count"), s.get("plays"), Json(s.get("raw") or {}))
                for s in sessions
            ], template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())")
        conn.commit()

    current = {r["player_id"]: r for r in res.q("SELECT player_id, athlete_uuid, match_status, match_note FROM pitch_intel.trackman_players WHERE player_id = ANY(%s)", list(by_player))} if by_player else {}

    upload_id = None
    if not dry_run and rows:
        cur.execute("INSERT INTO pitch_intel.uploads (kind, filename, uploaded_by) VALUES ('trackman_portal', %s, %s) RETURNING id",
                    (str(folder), LINKED_BY))
        upload_id = cur.fetchone()[0]

    for pid, prow in by_player.items():
        player = players[pid]
        athlete_uuid, status, note = res.resolve(player, current.get(pid))
        throws, throws_note = (player["throws"], "portal") if player.get("throws") in ("L", "R") else infer_throws(prow)
        last_date = max((r["session_date"] for r in prow if r["session_date"]), default=None)
        summary["status"][status] += 1
        if status in ("conflict", "matched_fuzzy", "created", "unmatched") or throws is None:
            summary["review"].append({"player_id": pid, "name": player["name"], "dob": player.get("dob"), "status": status,
                                      "note": note, "throws": throws or f"unknown ({throws_note})", "pitches": len(prow)})
        if dry_run:
            continue
        link_id = ensure_link(cur, athlete_uuid, player, throws, level_for_age(player.get("dob"), last_date)) if athlete_uuid else None
        cur.execute(
            """UPDATE pitch_intel.trackman_players
                  SET athlete_uuid = %s, match_status = %s, match_note = %s,
                      throws = COALESCE(CASE WHEN throws_source = 'manual' THEN throws END, %s),
                      throws_source = CASE WHEN throws_source = 'manual' THEN throws_source ELSE %s END,
                      updated_at = NOW()
                WHERE player_id = %s""",
            (athlete_uuid, status, note, throws, (throws_note if throws_note in ("portal", "inferred") else None) if throws else None, pid),
        )
        records = []
        for r in prow:
            vals = dict(r, athlete_uuid=athlete_uuid, link_id=link_id, session_type="bullpen", pitcher_id=pid,
                        pitcher_throws=throws, source_file=f"trackman-portal:{r['tm_session_id']}", upload_id=upload_id,
                        data_source="portal")
            vals["raw"] = Json(r["raw"])
            records.append(tuple(vals[c] for c in PITCH_COLS))
        for i in range(0, len(records), 500):
            for (inserted,) in execute_values(cur, UPSERT_PITCHES, records[i:i + 500], fetch=True):
                summary["inserted" if inserted else "updated"] += 1
        if link_id:
            cur.execute("""UPDATE pitch_intel.athlete_source_links SET last_pulled_at = NOW(),
                             last_game_date = (SELECT max(session_date) FROM pitch_intel.trackman_pitches WHERE link_id = %s)
                           WHERE id = %s""", (link_id, link_id))
        conn.commit()

    if not dry_run:
        cur.execute("""UPDATE pitch_intel.trackman_sessions s SET pitches_pulled = c.n
                         FROM (SELECT tm_session_id, count(*) AS n FROM pitch_intel.trackman_pitches WHERE data_source = 'portal' GROUP BY 1) c
                        WHERE c.tm_session_id = s.session_id""")
        if upload_id:
            cur.execute("UPDATE pitch_intel.uploads SET rows_saved = %s, summary = %s WHERE id = %s",
                        (summary["inserted"] + summary["updated"], Json({k: v for k, v in summary.items() if k != "review"}), upload_id))
        conn.commit()
    summary["status"] = dict(summary["status"])
    return summary


def link_player(conn, pid: str, athlete_uuid: str) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM analytics.d_athletes WHERE athlete_uuid = %s", (athlete_uuid,))
        if not cur.fetchone():
            raise SystemExit(f"No athlete {athlete_uuid} in analytics.d_athletes")
        cur.execute("SELECT player_id, name, date_of_birth::text, throws FROM pitch_intel.trackman_players WHERE player_id = %s", (pid,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"No TrackMan player {pid}; load a pull first")
        player = {"player_id": row[0], "name": row[1], "dob": row[2]}
        cur.execute("SELECT max(session_date)::text FROM pitch_intel.trackman_pitches WHERE tm_player_id = %s", (pid,))
        last = cur.fetchone()[0]
        link_id = ensure_link(cur, athlete_uuid, player, row[3], level_for_age(row[2], last))
        cur.execute("UPDATE pitch_intel.trackman_players SET athlete_uuid = %s, match_status = 'manual', match_note = 'linked by hand', updated_at = NOW() WHERE player_id = %s",
                    (athlete_uuid, pid))
        cur.execute("UPDATE pitch_intel.trackman_pitches SET athlete_uuid = %s, link_id = %s, updated_at = NOW() WHERE tm_player_id = %s AND data_source = 'portal'",
                    (athlete_uuid, link_id, pid))
        n = cur.rowcount
    try:
        from python.common.source_athlete_map import add_source_mapping
        add_source_mapping(conn, athlete_uuid, SOURCE_SYSTEM, pid)
    except Exception as e:  # noqa: BLE001
        print(f"(source_athlete_map not updated: {e})")
    conn.commit()
    print(f"Linked {player['name']} ({pid}) -> {athlete_uuid}; {n} pitches attached.")


def create_player(conn, pid: str) -> None:
    """A held player is a different person from the suggested match: create a new athlete (origin trackman)."""
    from python.common import athlete_manager as am
    with conn.cursor() as cur:
        cur.execute("SELECT name, date_of_birth::text FROM pitch_intel.trackman_players WHERE player_id = %s", (pid,))
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"No TrackMan player {pid}; load a pull first")
    existing = am.find_existing_athlete_by_name_or_email(conn, am.normalize_name_for_matching(athlete_name(row[0])), date_of_birth=row[1])
    if existing:
        raise SystemExit(f"{row[0]} already matches {existing['name']} ({existing['athlete_uuid']}) under the 90% rule; use --link instead")
    uuid, created = am.get_or_create_athlete(name=athlete_name(row[0]), date_of_birth=row[1], source_system=SOURCE_SYSTEM, source_athlete_id=pid)
    print(f"{'Created' if created else 'Found'} athlete {row[0]} ({uuid}), origin trackman")
    link_player(conn, pid, uuid)


def report(conn) -> None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""SELECT p.player_id, p.name, p.date_of_birth::text AS dob, p.match_status, p.match_note, p.throws,
                              count(t.*) AS pitches
                         FROM pitch_intel.trackman_players p
                         JOIN pitch_intel.trackman_pitches t ON t.tm_player_id = p.player_id
                        WHERE p.match_status IN ('conflict', 'matched_fuzzy', 'unmatched') OR p.throws IS NULL
                        GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY p.match_status, p.name""")
        rows = cur.fetchall()
    if not rows:
        print("Nothing to review.")
    for r in rows:
        print(f"{r['match_status']:<14} {r['player_id']:<11} {r['name']:<26} dob={r['dob'] or '-':<10} throws={r['throws'] or '?'} "
              f"pitches={r['pitches']:<4} {r['match_note'] or ''}")


def main() -> int:
    # Names can contain emoji (e.g. "Jimmy 🦴 Morgan"); a Windows console or a
    # redirected log defaults to cp1252 and would crash on them.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default="trackman_out", help="trackman_pull.py output folder")
    ap.add_argument("--dry-run", action="store_true", help="match and count, write nothing")
    ap.add_argument("--relink", action="store_true", help="re-run matching for players without an athlete")
    ap.add_argument("--link", nargs=2, metavar=("PLAYER_ID", "ATHLETE_UUID"), help="link one TrackMan player by hand")
    ap.add_argument("--create", metavar="PLAYER_ID", help="held player is a new person: create the athlete (origin trackman)")
    ap.add_argument("--report", action="store_true", help="list players that need a look")
    args = ap.parse_args()

    from python.common.athlete_manager import get_warehouse_connection
    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('pitch_intel.trackman_players')")
            if cur.fetchone()[0] is None:
                print("pitch_intel.trackman_players doesn't exist yet. Run `npm run pi:setup` first.")
                return 2
        if args.link:
            link_player(conn, *args.link)
            return 0
        if args.create:
            create_player(conn, args.create)
            return 0
        if args.report:
            report(conn)
            return 0
        if args.relink:
            # Clear unresolved statuses and reload pitches already in the warehouse through the matcher.
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT DISTINCT tm_player_id FROM pitch_intel.trackman_pitches WHERE data_source = 'portal' AND athlete_uuid IS NULL")
                pids = [r["tm_player_id"] for r in cur.fetchall()]
                cur.execute("""SELECT raw FROM pitch_intel.trackman_pitches WHERE data_source = 'portal' AND tm_player_id = ANY(%s)""", (pids,))
                raws = [r["raw"] for r in cur.fetchall()]
                cur.execute("""SELECT player_id, name, date_of_birth::text AS dob, id_source, raw, portal_id, foreign_ids,
                                      CASE WHEN throws_source = 'portal' OR throws_source = 'manual' THEN throws END AS throws
                                 FROM pitch_intel.trackman_players WHERE player_id = ANY(%s)""", (pids,))
                pls = cur.fetchall()
                cur.execute("""SELECT session_id, session_type AS type, local_date::text, local_datetime, utc_datetime::text, radar_serial, player_count, plays, raw
                                 FROM pitch_intel.trackman_sessions WHERE session_id IN (SELECT DISTINCT tm_session_id FROM pitch_intel.trackman_pitches WHERE tm_player_id = ANY(%s))""", (pids,))
                sess = cur.fetchall()
            if not pids:
                print("No unlinked players.")
                return 0
            tmp = Path(args.dir) / "_relink"
            tmp.mkdir(parents=True, exist_ok=True)
            (tmp / "sessions.json").write_text(json.dumps([dict(s) for s in sess], default=str))
            (tmp / "roster.json").write_text(json.dumps([dict(p) for p in pls], default=str))
            (tmp / "pitches.jsonl").write_text("".join(json.dumps(r) + "\n" for r in raws))
            with conn.cursor() as cur:
                cur.execute("UPDATE pitch_intel.trackman_players SET match_status = 'unmatched' WHERE player_id = ANY(%s) AND athlete_uuid IS NULL", (pids,))
            conn.commit()
            args.dir = str(tmp)
        summary = load(conn, Path(args.dir), args.dry_run)
    finally:
        conn.close()

    print(json.dumps({k: v for k, v in summary.items() if k != "review"}, indent=1, default=str))
    if summary["review"]:
        print(f"\nNeeds a look ({len(summary['review'])}):")
        for r in summary["review"]:
            print(f"  {r['status']:<14} {r['player_id']:<11} {r['name']:<26} dob={r['dob'] or '-':<10} throws={r['throws']:<6} "
                  f"pitches={r['pitches']:<4} {r['note']}")
    if args.dry_run:
        print("\nDry run: nothing was written.")
    else:
        try:  # read by run_trackman.py
            (Path(args.dir) / "load_summary.json").write_text(json.dumps(summary, indent=1, default=str))
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
