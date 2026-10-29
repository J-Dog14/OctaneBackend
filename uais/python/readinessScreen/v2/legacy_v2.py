#!/usr/bin/env python3
"""
Readiness Screen v2 - Phase D: carry over readiness sessions that have no c3d.

Some readiness sessions (mostly Jan-Sep 2024, before the first c3d in either Data folder) only
exist in the old f_readiness_screen_* tables. Their power is wrong and can't be recomputed, but
jump height and the isometrics are fine (validated: JH within 0.2 in on 96 % of rebuilt CMJ trials,
isometric max/avg within ~1 %). Joey's call (2026-10-28): keep those, power stays NULL.

Copied, for (athlete, date) pairs that have NO c3d-rebuilt v2 row in any readiness table:
  CMJ / PPU   jump height only           -> f_readiness_screen_v2_cmj / _ppu
  I/Y/T/IR90  max, avg, time to max,
              norms (typed-in mass)      -> f_readiness_screen_v2_iso
Rows get source_root='legacy', session_folder='legacy', source_system='readiness_screen_legacy',
qc_flags {legacy_no_c3d}. Only old rows with source_system='readiness_screen' are used - the athletic
screen cross-inserts ('athletic_screen', 'athletic_screen_v2') are not readiness sessions.
Re-runnable: it deletes and re-inserts the legacy rows only.

    python uais/python/readinessScreen/v2/legacy_v2.py           # dry run: counts
    python uais/python/readinessScreen/v2/legacy_v2.py --apply
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from readinessScreen.v2 import schema                              # noqa: E402
from common.athlete_manager import get_warehouse_connection         # noqa: E402

V2_SESSIONS = """
  SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_cmj WHERE source_root <> 'legacy'
  UNION SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_ppu WHERE source_root <> 'legacy'
  UNION SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_iso WHERE source_root <> 'legacy'
"""
META = "'legacy', 'readiness_screen_legacy', 'legacy', ARRAY['legacy_no_c3d']::text[]"
# The same person can exist twice in d_athletes (old row under one uuid, c3d session under another).
# Never carry over a session when a c3d-rebuilt session exists that day for an athlete with the same name.
SAME_NAME_GUARD = f"""AND NOT EXISTS (
      SELECT 1 FROM ({V2_SESSIONS}) v
      JOIN analytics.d_athletes dv ON dv.athlete_uuid = v.athlete_uuid
      JOIN analytics.d_athletes dold ON dold.athlete_uuid = o.athlete_uuid
      WHERE v.session_date = o.session_date AND dv.normalized_name = dold.normalized_name)"""


def jump_sql(mv):
    code = mv.upper()
    return f"""
INSERT INTO public.f_readiness_screen_v2_{mv}
  (athlete_uuid, session_date, trial_name, trial_number, session_folder, source_system, source_root, qc_flags,
   source_athlete_id, age_at_collection, age_group, jh_in, jh_m, flight_time_s, processor_version)
SELECT athlete_uuid, session_date, '{code}' || n, n, {META},
       source_athlete_id, age_at_collection, age_group,
       jump_height, jump_height * 0.0254, sqrt(8 * jump_height * 0.0254 / 9.81), 'legacy'
FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.athlete_uuid, o.session_date
                                 ORDER BY o.trial_id NULLS LAST, o.id) AS n
  FROM public.f_readiness_screen_{mv} o
  WHERE o.source_system = 'readiness_screen' AND o.jump_height IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ({V2_SESSIONS}) v
                    WHERE v.athlete_uuid = o.athlete_uuid AND v.session_date = o.session_date)
    {SAME_NAME_GUARD}
) s"""


def iso_sql(mv):
    return f"""
INSERT INTO public.f_readiness_screen_v2_iso
  (athlete_uuid, session_date, trial_name, trial_number, movement, session_folder, source_system, source_root,
   qc_flags, source_athlete_id, age_at_collection, age_group, mass_source,
   max_force_n, avg_force_n, time_to_max_s, max_force_raw_n, avg_force_raw_n, time_to_max_raw_s,
   max_force_n_per_kg, avg_force_n_per_kg, processor_version)
SELECT athlete_uuid, session_date, '{mv}_' || n, n, '{mv}', {META},
       source_athlete_id, age_at_collection, age_group, 'legacy_typed_mass',
       max_force, avg_force, time_to_max, max_force, avg_force, time_to_max,
       max_force_norm, avg_force_norm, 'legacy'
FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.athlete_uuid, o.session_date
                                 ORDER BY o.trial_id NULLS LAST, o.id) AS n
  FROM public.f_readiness_screen_{mv.lower()} o
  WHERE o.source_system = 'readiness_screen' AND o.max_force IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ({V2_SESSIONS}) v
                    WHERE v.athlete_uuid = o.athlete_uuid AND v.session_date = o.session_date)
    {SAME_NAME_GUARD}
) s"""


def write_review(cur):
    """Legacy sessions on/after the first c3d date (2024-09-24) deserve a look: a c3d session may exist under a
    differently spelled / duplicate athlete. Lists each with the most similar athlete that has a c3d session that day."""
    from difflib import SequenceMatcher
    import csv
    cur.execute(f"""
        WITH leg AS (
          SELECT DISTINCT athlete_uuid, session_date FROM public.f_readiness_screen_v2_cmj WHERE source_root='legacy'
          UNION SELECT DISTINCT athlete_uuid, session_date FROM public.f_readiness_screen_v2_ppu WHERE source_root='legacy'
          UNION SELECT DISTINCT athlete_uuid, session_date FROM public.f_readiness_screen_v2_iso WHERE source_root='legacy')
        SELECT l.athlete_uuid, a.name, l.session_date,
               (SELECT string_agg(DISTINCT d2.name || ' | ' || v.athlete_uuid, ' ; ')
                  FROM ({V2_SESSIONS}) v JOIN analytics.d_athletes d2 ON d2.athlete_uuid = v.athlete_uuid
                 WHERE v.session_date = l.session_date) AS c3d_athletes_that_day
        FROM leg l JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
        WHERE l.session_date >= DATE '2024-09-24' ORDER BY l.session_date""")
    rows = cur.fetchall()
    out = Path(__file__).resolve().parents[4] / "tmp" / "readiness_v2" / "legacy_review.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    flagged = 0
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["athlete_uuid", "name", "session_date", "best_c3d_match_that_day", "similarity", "c3d_athletes_that_day"])
        for uuid, name, d, others in rows:
            best, score = "", 0.0
            for o in (others or "").split(" ; "):
                if o:
                    sc = SequenceMatcher(None, (name or "").lower(), o.split(" | ")[0].lower()).ratio()
                    if sc > score:
                        best, score = o, sc
            flagged += score >= 0.75
            w.writerow([uuid, name, d, best, round(score, 2), others or ""])
    print(f"  legacy sessions on/after 2024-09-24: {len(rows)} ({flagged} with a similar-named c3d athlete that day) "
          f"-> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--drop", action="store_true", help="delete all legacy rows and stop (no carry-over)")
    args = ap.parse_args()
    conn = get_warehouse_connection()
    if args.drop:
        with conn.cursor() as cur:
            for t in ("f_readiness_screen_v2_cmj", "f_readiness_screen_v2_ppu", "f_readiness_screen_v2_iso"):
                cur.execute(f"DELETE FROM public.{t} WHERE source_root = 'legacy'")
                print(f"  {t}: {cur.rowcount} legacy rows deleted")
        conn.commit()
        conn.close()
        print("Legacy carry-over dropped - readiness history is c3d sessions only.")
        return
    try:
        with conn.cursor() as cur:
            for t in ("cmj", "ppu", "i", "y", "t", "ir90"):
                cur.execute(f"SELECT source_system, COUNT(*) FROM public.f_readiness_screen_{t} GROUP BY 1 ORDER BY 2 DESC")
                print(f"  old f_readiness_screen_{t} by source_system: {dict(cur.fetchall())}")
            cur.execute(schema.create_sql())
            for t in ("f_readiness_screen_v2_cmj", "f_readiness_screen_v2_ppu", "f_readiness_screen_v2_iso"):
                cur.execute(f"DELETE FROM public.{t} WHERE source_root = 'legacy'")
            for mv in ("cmj", "ppu"):
                cur.execute(jump_sql(mv))
                print(f"  {mv}: {cur.rowcount} legacy trials (JH only)")
            for mv in ("I", "Y", "T", "IR90"):
                cur.execute(iso_sql(mv))
                print(f"  {mv}: {cur.rowcount} legacy rows")
            cur.execute("""SELECT MIN(session_date), MAX(session_date), COUNT(DISTINCT (athlete_uuid, session_date))
                           FROM (SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_cmj WHERE source_root='legacy'
                                 UNION SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_ppu WHERE source_root='legacy'
                                 UNION SELECT athlete_uuid, session_date FROM public.f_readiness_screen_v2_iso WHERE source_root='legacy') x""")
            lo, hi, n = cur.fetchone()
            print(f"  legacy sessions: {n} ({lo} -> {hi})")
            write_review(cur)
        if args.apply:
            conn.commit()
            print("Committed.")
        else:
            conn.rollback()
            print("Dry run - rolled back. Rerun with --apply.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
