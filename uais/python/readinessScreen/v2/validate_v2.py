#!/usr/bin/env python3
"""
Readiness Screen v2 - Phase C: compare v2 tables against the old ones (read-only).

  CMJ / PPU  matched on athlete + date + trial number. Jump height should agree within ~0.2 in
             (same flight-time method); power will not - that is the bug being fixed.
  I/Y/T/IR90 old tables hold one row per athlete/date; compared with the v2 trial whose raw max is
             closest. Max force and time to max should agree within a few %.
Only old rows with source_system='readiness_screen' count; the athletic screen cross-inserts
('athletic_screen', 'athletic_screen_v2') are not readiness sessions. Legacy carry-over rows are ignored.

    python uais/python/readinessScreen/v2/validate_v2.py      -> tmp/readiness_v2/validation/
"""
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
REPO = PY.parents[1]
sys.path.insert(0, str(PY))
from common.athlete_manager import get_warehouse_connection  # noqa: E402

ISO_OLD = {"I": "f_readiness_screen_i", "Y": "f_readiness_screen_y", "T": "f_readiness_screen_t",
           "IR90": "f_readiness_screen_ir90"}


def q(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        df = pd.DataFrame(cur.fetchall(), columns=cols)
    if "session_date" in df:
        df["session_date"] = df.session_date.astype(str)
    for c in df.columns:
        if c not in ("athlete_uuid", "session_date", "trial_name", "movement", "qc_flags", "source_root", "bw_source"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def main():
    out = REPO / "tmp" / "readiness_v2" / "validation"
    out.mkdir(parents=True, exist_ok=True)
    conn = get_warehouse_connection()
    conn.set_session(readonly=True)
    L = ["# Readiness Screen v2 vs old tables\n"]

    for mv in ("cmj", "ppu"):
        old = q(conn, f"SELECT athlete_uuid, session_date, COALESCE(trial_id, 1) AS trial_number, jump_height, "
                      f"pp_forceplate, pp_w_per_kg, vel_at_pp, force_at_pp FROM public.f_readiness_screen_{mv} "
                      f"WHERE source_system = 'readiness_screen'")
        new = q(conn, f"SELECT athlete_uuid, session_date, trial_number, source_root, jh_in, peak_power_w, pp_w_per_kg, "
                      f"vel_at_pp_m_s, force_at_pp_n, takeoff_velocity_m_s, bw_source "
                      f"FROM public.f_readiness_screen_v2_{mv} WHERE source_root <> 'legacy'")
        k = ["athlete_uuid", "session_date", "trial_number"]
        m = old.merge(new, on=k, how="outer", suffixes=("_old", "_new"), indicator=True)
        m.to_csv(out / f"{mv}_old_vs_v2.csv", index=False)
        both = m[m._merge == "both"]
        L.append(f"\n## {mv.upper()}")
        L.append(f"- old trials {len(old)}, v2 trials {len(new)}, both {len(both)}, "
                 f"old only {int((m._merge == 'left_only').sum())}, v2 only {int((m._merge == 'right_only').sum())}")
        L.append(f"- v2 by source root: {new.source_root.value_counts().to_dict()}")
        if len(both):
            d = (both.jh_in - both.jump_height).abs()
            L.append(f"- JH |v2-old| median {d.median():.2f} in; within 0.2 in {100 * (d <= 0.2).mean():.0f}%; "
                     f"> 0.5 in: {(d > 0.5).sum()} trials")
            L.append(f"- W/kg old median {both.pp_w_per_kg_old.median():.1f} -> v2 {both.pp_w_per_kg_new.median():.1f}; "
                     f"peak power old/v2 median {(both.pp_forceplate / both.peak_power_w).median():.2f}")
            if mv == "cmj":
                L.append(f"- v2 vel@PP / takeoff velocity median {(both.vel_at_pp_m_s / both.takeoff_velocity_m_s).median():.2f}")
            big = both[d > 0.5]
            if len(big):
                big[k + ["source_root", "jump_height", "jh_in"]].to_csv(out / f"{mv}_jh_mismatch.csv", index=False)
                L.append(f"  - JH mismatches in {mv}_jh_mismatch.csv")

    new = q(conn, "SELECT athlete_uuid, session_date, movement, trial_name, source_root, max_force_n, max_force_raw_n, "
                  "avg_force_raw_n, time_to_max_raw_s, max_force_n_per_kg, mass_kg FROM public.f_readiness_screen_v2_iso "
                  "WHERE source_root <> 'legacy'")
    L.append("\n## Isometrics (old row vs closest v2 trial)")
    for mv, t in ISO_OLD.items():
        old = q(conn, f"SELECT athlete_uuid, session_date, max_force, avg_force, time_to_max, max_force_norm "
                      f"FROM public.{t} WHERE source_system = 'readiness_screen'")
        n = new[new.movement == mv]
        m = old.merge(n, on=["athlete_uuid", "session_date"], how="inner")
        if m.empty:
            L.append(f"- {mv}: old {len(old)}, v2 {len(n)}, no overlap")
            continue
        m["d"] = (m.max_force_raw_n - m.max_force).abs()
        m = m.sort_values("d").drop_duplicates(["athlete_uuid", "session_date"])
        m.to_csv(out / f"iso_{mv.lower()}_old_vs_v2.csv", index=False)
        pct = 100 * m.d / m.max_force
        L.append(f"- {mv}: old {len(old)}, v2 trials {len(n)}, sessions in both {len(m)}; "
                 f"max |raw-old| median {pct.median():.1f}% (>5%: {(pct > 5).sum()}); "
                 f"avg |raw-old| median {(100 * (m.avg_force_raw_n - m.avg_force).abs() / m.avg_force).median():.1f}%; "
                 f"time to max |diff| median {(m.time_to_max_raw_s - m.time_to_max).abs().median():.2f} s; "
                 f"norm old {m.max_force_norm.median():.2f} vs v2 {m.max_force_n_per_kg.median():.2f} N/kg")
    (out / "validation.md").write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
