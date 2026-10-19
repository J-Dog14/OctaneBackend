"""One-off cleanup of the 2026 backfill review list (Oct 2026).

Dry run (default) prints the plan and writes nothing:
    uais\\venv\\Scripts\\python.exe uais\\python\\trackman\\fix_review.py
Then apply it:
    uais\\venv\\Scripts\\python.exe uais\\python\\trackman\\fix_review.py --apply

Edit the lists below for each batch, dry run, then --apply:
1. LINK_NAMES: links held / DOB-conflict TrackMan players to the athlete named in their match note.
2. KEEP_DOB_YEAR: the athlete record takes the birth date from whichever side has that year.
3. CREATE_NAMES: held players who are a different kid get their own athlete.
4. MERGE_UUIDS: loader-created athletes that duplicate an existing Octane athlete are merged into it
   (same last name, first name a prefix of the other). Garbled (cp1252) names are repaired the same way.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent))
import load_trackman_pull as L  # noqa: E402  (also puts uais/ and uais/python on sys.path)
from psycopg2 import sql  # noqa: E402
from psycopg2.extras import RealDictCursor  # noqa: E402

# Batch 2 (2026 rescan). Batch 1 (Cash Grimsley, Leon Hunter, Kenan Alridge, ... Declan Smith,
# Ja'heim Brown merge) was applied 2026-10-17.
LINK_NAMES = ["Bodie Thigpen", "Kade Durnin", "Kellen Blanchette", "Ryan Scavone", "Teagan Bright",
              "Thomas Greer", "John Nelson Mclamb", "Max Schrock"]
# The athlete record takes the birth date from whichever side has this year
# (Octane had 2026 for these two: entered as the current year by mistake).
KEEP_DOB_YEAR = {"Bodie Thigpen": "2013", "Kade Durnin": "2005"}
# Held players who are a different kid from the suggested match.
CREATE_NAMES = ["Chase Davidson", "Dylan Ellis", "Ethan Williams", "Jacob Fearns", "Jacob Kearns",
                "Jacob Shepard", "Luke Humes"]
# Athletes the loader created that duplicate an existing Octane athlete.
MERGE_UUIDS: list[str] = []
NOTE_UUID = re.compile(r"\(([^,()\s]+)[,)]")


def norm(am, name: str) -> str:
    return am.normalize_name_for_matching(L.athlete_name(name or ""))


def repair(text: str) -> str:
    try:
        return text.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def letters(text: str) -> str:
    return re.sub(r"[^A-Z]", "", text.upper())


def garbled(text: str | None) -> bool:
    return bool(text) and ("â€" in text or "Ã" in text) and repair(text) != text


def athlete(cur, uuid):
    cur.execute("SELECT athlete_uuid, name, date_of_birth::text AS dob FROM analytics.d_athletes WHERE athlete_uuid = %s", (uuid,))
    return cur.fetchone()


def plan_links(cur, am):
    cur.execute("""SELECT player_id, name, date_of_birth::text AS dob, match_status, match_note, athlete_uuid
                     FROM pitch_intel.trackman_players
                    WHERE athlete_uuid IS NULL OR match_status IN ('conflict', 'unmatched', 'matched_fuzzy')""")
    open_players = cur.fetchall()
    plan = []
    for want in LINK_NAMES:
        hits = [p for p in open_players if norm(am, p["name"]) == norm(am, want)]
        if len(hits) != 1:
            print(f"SKIP  {want}: {len(hits)} open TrackMan players with that name {[h['player_id'] for h in hits]}")
            continue
        p = hits[0]
        m = NOTE_UUID.search(p["match_note"] or "")
        target = athlete(cur, m.group(1)) if m else None
        if not target:
            print(f"SKIP  {want} ({p['player_id']}): no suggested athlete in note: {p['match_note']!r}")
            continue
        print(f"LINK  {p['name']} ({p['player_id']}, dob {p['dob']})  ->  {target['name']} ({target['athlete_uuid']}, dob {target['dob']})")
        year = KEEP_DOB_YEAR.get(want)
        if year:
            good = next((d for d in (target["dob"], p["dob"]) if d and d.startswith(year)), None)
            if good and target["dob"] != good:
                print(f"DOB   {target['name']}: {target['dob']} -> {good}")
            elif not good:
                print(f"NOTE  {want}: neither record has a {year} birth date; DOB left alone")
            plan.append((p, target, good if good and target["dob"] != good else None))
        else:
            plan.append((p, target, None))
    for want in CREATE_NAMES:
        hits = [p for p in open_players if norm(am, p["name"]) == norm(am, want)]
        if len(hits) != 1:
            print(f"SKIP  create {want}: {len(hits)} open TrackMan players with that name")
            continue
        print(f"CREATE {hits[0]['name']} ({hits[0]['player_id']}, dob {hits[0]['dob']}) as a new athlete")
        plan.append((hits[0], None, None))
    return plan


def plan_placeholder_dobs(cur):
    """Linked athletes whose Octane birth date is a placeholder (this year or later): take TrackMan's."""
    cur.execute("""SELECT DISTINCT ON (a.athlete_uuid) a.athlete_uuid, a.name, a.date_of_birth::text AS dob, p.date_of_birth::text AS tm_dob
                     FROM analytics.d_athletes a
                     JOIN pitch_intel.trackman_players p ON p.athlete_uuid = a.athlete_uuid
                    WHERE a.date_of_birth IS NOT NULL AND p.date_of_birth IS NOT NULL
                    ORDER BY a.athlete_uuid, p.updated_at DESC NULLS LAST""")
    plan = []
    for r in cur.fetchall():
        if L.placeholder_dob(r["dob"]) and not L.placeholder_dob(r["tm_dob"]) and r["dob"] != r["tm_dob"]:
            print(f"DOB   {r['name']}: {r['dob']} -> {r['tm_dob']} (TrackMan)")
            plan.append(r)
    return plan


def plan_names(cur, am):
    cur.execute("SELECT athlete_uuid, name, normalized_name FROM analytics.d_athletes")
    everyone = cur.fetchall()
    plan = []
    for a in (x for x in everyone if garbled(x["name"]) or x["athlete_uuid"] in MERGE_UUIDS):
        fixed = repair(a["name"])
        n = norm(am, fixed).split()
        same = []
        for b in everyone:
            if b["athlete_uuid"] in (a["athlete_uuid"], *MERGE_UUIDS) or garbled(b["name"]):
                continue
            m = (b["normalized_name"] or norm(am, b["name"])).split()
            f1, f2 = letters(" ".join(n[:-1])), letters(" ".join(m[:-1]))
            if n and m and n[-1] == m[-1] and f1 and f2 and (f1.startswith(f2) or f2.startswith(f1)):
                same.append(b)
        if len(same) == 1:
            print(f"MERGE {a['name']!r} ({a['athlete_uuid']})  into  {same[0]['name']!r} ({same[0]['athlete_uuid']})")
            plan.append(("merge", a, same[0], fixed))
        elif not same and fixed == a["name"]:
            print(f"SKIP  {a['name']!r} ({a['athlete_uuid']}): no existing look-alike athlete found")
        elif not same:
            print(f"RENAME {a['name']!r} -> {fixed!r} ({a['athlete_uuid']})")
            plan.append(("rename", a, None, fixed))
        else:
            print(f"SKIP  {a['name']!r}: several possible matches {[(b['name'], b['athlete_uuid']) for b in same]}")
    cur.execute("SELECT player_id, name FROM pitch_intel.trackman_players")
    for p in cur.fetchall():
        if garbled(p["name"]):
            print(f"RENAME TrackMan player {p['player_id']}: {p['name']!r} -> {repair(p['name'])!r}")
            plan.append(("tm_rename", p, None, repair(p["name"])))
    return plan


def move_athlete(cur, src: str, dst: str):
    cur.execute("""SELECT c.table_schema, c.table_name
                     FROM information_schema.columns c
                     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
                    WHERE c.column_name = 'athlete_uuid' AND t.table_type = 'BASE TABLE'
                      AND c.table_schema IN ('public', 'analytics', 'pitch_intel')
                      AND NOT (c.table_schema = 'analytics' AND c.table_name = 'd_athletes')""")
    for schema, table in cur.fetchall():
        cur.execute(sql.SQL("UPDATE {}.{} SET athlete_uuid = %s WHERE athlete_uuid = %s").format(sql.Identifier(schema), sql.Identifier(table)), (dst, src))
        if cur.rowcount:
            print(f"      moved {cur.rowcount} row(s) in {schema}.{table}")
    cur.execute("DELETE FROM analytics.d_athletes WHERE athlete_uuid = %s", (src,))


def main() -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = ap.parse_args()

    from python.common import athlete_manager as am
    from python.common.age_utils import calculate_age, parse_date
    conn = am.get_warehouse_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            links = plan_links(cur, am)
            names = plan_names(cur, am)
            dobs = plan_placeholder_dobs(cur)
        conn.rollback()
        if not args.apply:
            print("\nDry run, nothing written. Re-run with --apply.")
            return 0

        print("\nApplying...")
        failed = []
        for p, target, new_dob in links:
            try:
                if target is None:
                    L.create_player(conn, p["player_id"])  # commits
                    continue
                L.link_player(conn, p["player_id"], target["athlete_uuid"])  # commits
            except (Exception, SystemExit) as e:  # noqa: BLE001  keep going; report at the end
                conn.rollback()
                failed.append(f"{p['name']} ({p['player_id']}): {e}")
                print(f"FAILED {p['name']} ({p['player_id']}): {e}")
                continue
            if new_dob:
                with conn.cursor() as cur:
                    cur.execute("UPDATE analytics.d_athletes SET date_of_birth = %s, age = %s WHERE athlete_uuid = %s",
                                (new_dob, calculate_age(parse_date(new_dob)), target["athlete_uuid"]))
                conn.commit()
                print(f"Set {target['name']} DOB to {new_dob}")

        # After the links, so athletes linked just now are included.
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            dobs = plan_placeholder_dobs(cur)
        for r in dobs:
            L.set_athlete_dob(conn, r["athlete_uuid"], r["tm_dob"])
        conn.commit()

        with conn.cursor() as cur:
            for kind, a, b, fixed in names:
                if kind == "merge":
                    move_athlete(cur, a["athlete_uuid"], b["athlete_uuid"])
                    print(f"Merged {a['athlete_uuid']} into {b['name']} ({b['athlete_uuid']})")
                elif kind == "rename":
                    cur.execute("UPDATE analytics.d_athletes SET name = %s, normalized_name = %s WHERE athlete_uuid = %s",
                                (fixed, norm(am, fixed), a["athlete_uuid"]))
                    print(f"Renamed {a['athlete_uuid']} to {fixed}")
                else:
                    cur.execute("UPDATE pitch_intel.trackman_players SET name = %s, updated_at = NOW() WHERE player_id = %s", (fixed, a["player_id"]))
                    cur.execute("UPDATE pitch_intel.athlete_source_links SET source_player_name = %s WHERE source = 'trackman' AND source_player_id = %s",
                                (fixed, a["player_id"]))
        conn.commit()
        if failed:
            print("\nNot done (send these to Claude):\n  " + "\n  ".join(failed))
        print("Done. `load_trackman_pull.py --report` should now show only what's left.")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
