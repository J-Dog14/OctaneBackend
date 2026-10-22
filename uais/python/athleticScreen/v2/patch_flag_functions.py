#!/usr/bin/env python3
"""
Make the d_athletes flag machinery see the v2 athletic screen tables.

The warehouse functions update_athlete_data_flags() and trigger_update_athlete_flags() decide
has_athletic_screen_data / athletic_screen_session_count from the OLD f_athletic_screen_* tables
only. Athletes ingested by v2 would show as having no athletic screen data. This script:
  1. reads the LIVE definition of each function (pg_get_functiondef - so nothing that was changed
     in the database but not in uais/sql/ gets lost),
  2. adds the four v2 tables next to every f_athletic_screen_ppu reference (EXISTS + session UNION),
  3. adds AFTER INSERT/UPDATE/DELETE triggers on the v2 trial tables (same as the old tables),
  4. refreshes all flags once.
Also patches uais/sql/update_athlete_data_flags.sql the same way so the repo copy matches.

    python uais/python/athleticScreen/v2/patch_flag_functions.py            # dry run: show changes
    python uais/python/athleticScreen/v2/patch_flag_functions.py --apply
"""
import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UAIS = HERE.parents[2]
sys.path.insert(0, str(UAIS))
from python.common.athlete_manager import get_warehouse_connection  # noqa: E402

V2 = ["f_athletic_screen_v2_cmj", "f_athletic_screen_v2_dj", "f_athletic_screen_v2_ppu", "f_athletic_screen_v2_slv"]
FUNCS = ["update_athlete_data_flags", "trigger_update_athlete_flags"]


def patch_text(src: str) -> str:
    if "f_athletic_screen_v2_cmj" in src:
        return src
    out = []
    for line in src.splitlines(keepends=True):
        out.append(line)
        if re.search(r"\bpublic\.f_athletic_screen_ppu\b", line) and ("EXISTS" in line or "SELECT session_date" in line):
            indent = re.match(r"\s*", line).group(0)
            body = line.strip()
            for t in V2:
                new = body.replace("public.f_athletic_screen_ppu", f"public.{t}")
                if "EXISTS" in body:
                    # '...ppu s WHERE ...)' possibly followed by nothing; make sure it is OR-joined
                    new = new if new.startswith("OR ") else "OR " + new
                    out.append(f"{indent}{new}\n")
                else:
                    out.append(f"{indent}UNION\n{indent}{new}\n")
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    conn = get_warehouse_connection()
    defs = {}
    with conn.cursor() as cur:
        for fn in FUNCS:
            cur.execute("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                        "WHERE p.proname=%s", (fn,))
            r = cur.fetchall()
            if len(r) != 1:
                print(f"ERROR: expected exactly one function {fn}, found {len(r)}")
                sys.exit(2)
            defs[fn] = r[0][0]
    patched = {fn: patch_text(d) for fn, d in defs.items()}
    for fn in FUNCS:
        added = patched[fn].count("f_athletic_screen_v2_") - defs[fn].count("f_athletic_screen_v2_")
        print(f"{fn}: {added} v2 reference(s) added" + (" (already patched)" if added == 0 else ""))
        if added == 0 and "f_athletic_screen_v2_cmj" not in defs[fn]:
            print(f"  WARNING: no f_athletic_screen_ppu line found to anchor on in {fn} - inspect it by hand")
    triggers = "\n".join(
        f"DROP TRIGGER IF EXISTS trg_update_flags_{t} ON public.{t};\n"
        f"CREATE TRIGGER trg_update_flags_{t} AFTER INSERT OR UPDATE OR DELETE ON public.{t} "
        f"FOR EACH ROW EXECUTE FUNCTION trigger_update_athlete_flags();" for t in V2)

    sql_file = UAIS / "sql" / "update_athlete_data_flags.sql"
    file_src = sql_file.read_text(encoding="utf-8")
    file_new = patch_text(file_src)
    if "trg_update_flags_f_athletic_screen_v2_cmj" not in file_new:
        file_new += "\n-- Athletic Screen v2 tables\n" + triggers + "\n"

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
