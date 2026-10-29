#!/usr/bin/env python3
"""
Make the d_athletes readiness flags read Readiness Screen v2.

update_athlete_data_flags() and trigger_update_athlete_flags() set has_readiness_screen_data /
readiness_screen_session_count from the OLD public.f_readiness_screen session table. This script:
  1. reads the LIVE definition of each function (pg_get_functiondef),
  2. points every 'public.f_readiness_screen rs' at public.v_readiness_screen_sessions,
  3. adds AFTER INSERT/UPDATE/DELETE triggers on the v2 readiness tables,
  4. refreshes all flags once,
and patches uais/sql/update_athlete_data_flags.sql the same way.
Run AFTER uais/sql/create_readiness_screen_v2_compat_views.sql (the view must exist).

    python uais/python/readinessScreen/v2/patch_flag_functions.py            # dry run
    python uais/python/readinessScreen/v2/patch_flag_functions.py --apply
"""
import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from common.athlete_manager import get_warehouse_connection  # noqa: E402

V2 = ["f_readiness_screen_v2_cmj", "f_readiness_screen_v2_ppu", "f_readiness_screen_v2_iso"]
FUNCS = ["update_athlete_data_flags", "trigger_update_athlete_flags"]
OLD = re.compile(r"\bpublic\.f_readiness_screen(\s+rs\b)")


def patch_text(src):
    return OLD.sub(r"public.v_readiness_screen_sessions\1", src)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    conn = get_warehouse_connection()
    defs = {}
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.v_readiness_screen_sessions')")
        if cur.fetchone()[0] is None:
            print("ERROR: public.v_readiness_screen_sessions does not exist - run the compat-view SQL first.")
            sys.exit(2)
        for fn in FUNCS:
            cur.execute("SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname=%s", (fn,))
            r = cur.fetchall()
            if len(r) != 1:
                print(f"ERROR: expected exactly one function {fn}, found {len(r)}")
                sys.exit(2)
            defs[fn] = r[0][0]
    patched = {fn: patch_text(d) for fn, d in defs.items()}
    for fn in FUNCS:
        n = len(OLD.findall(defs[fn]))
        print(f"{fn}: {n} f_readiness_screen reference(s) -> v_readiness_screen_sessions"
              + (" (already patched)" if n == 0 and "v_readiness_screen_sessions" in defs[fn] else ""))
    triggers = "\n".join(
        f"DROP TRIGGER IF EXISTS trg_update_flags_{t} ON public.{t};\n"
        f"CREATE TRIGGER trg_update_flags_{t} AFTER INSERT OR UPDATE OR DELETE ON public.{t} "
        f"FOR EACH ROW EXECUTE FUNCTION trigger_update_athlete_flags();" for t in V2)
    sql_file = PY.parent / "sql" / "update_athlete_data_flags.sql"
    file_new = patch_text(sql_file.read_text(encoding="utf-8"))
    if "trg_update_flags_f_readiness_screen_v2_cmj" not in file_new:
        file_new += "\n-- Readiness Screen v2 tables\n" + triggers + "\n"
    if not args.apply:
        print("\nDry run - nothing changed. Rerun with --apply.")
        return
    try:
        with conn.cursor() as cur:
            for fn in FUNCS:
                if patched[fn] != defs[fn]:
                    cur.execute(patched[fn])
            cur.execute(triggers)
            cur.execute("SELECT update_athlete_data_flags()")
        conn.commit()
        sql_file.write_text(file_new, encoding="utf-8")
        print("Applied: functions patched, v2 triggers created, flags refreshed; uais/sql copy updated.")
    except Exception:
        conn.rollback()
        print("Rolled back.")
        raise


if __name__ == "__main__":
    main()
