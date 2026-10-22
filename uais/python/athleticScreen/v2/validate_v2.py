#!/usr/bin/env python3
"""
Athletic Screen v2 - Phase C: compare v2 tables against the old ones (read-only).

Checks, per movement, on trials present in both (athlete_uuid, session_date, trial_name):
  - jump height: should match the old V3D value (same flight-time method) within ~0.2 in
  - DJ contact time and RSI (old RSI = 2 x standard; compared against rsi_legacy)
  - power: old vs corrected, so you can see how far off each trial was
Also lists sessions/trials that exist in only one of the two.

    python uais/python/athleticScreen/v2/validate_v2.py      -> tmp/screen_v2/validation/
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
UAIS = HERE.parents[2]
REPO = UAIS.parent
sys.path.insert(0, str(UAIS))
from python.common.athlete_manager import get_warehouse_connection  # noqa: E402

KEY = ["athlete_uuid", "session_date", "trial_name"]


def q(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def main():
    out = REPO / "tmp" / "screen_v2" / "validation"
    out.mkdir(parents=True, exist_ok=True)
    conn = get_warehouse_connection()
    conn.set_session(readonly=True)
    L = ["# Athletic Screen v2 vs old tables\n"]
    for mv in ["cmj", "dj", "ppu", "slv"]:
        extra_old = ", ct, rsi" if mv == "dj" else ""
        extra_new = ", ct_s, rsi, rsi_legacy, implied_drop_cm" if mv == "dj" else ""
        old = q(conn, f"SELECT athlete_uuid, session_date, trial_name, jh_in, pp_forceplate, pp_w_per_kg, "
                      f"vel_at_pp, force_at_pp{extra_old} FROM public.f_athletic_screen_{mv}")
        new = q(conn, f"SELECT athlete_uuid, session_date, trial_name, jh_in, peak_power_w, pp_w_per_kg, "
                      f"vel_at_pp_m_s, force_at_pp_n, takeoff_velocity_m_s, bw_source, qc_flags{extra_new} "
                      f"FROM public.f_athletic_screen_v2_{mv}")
        for d in (old, new):
            d["session_date"] = d.session_date.astype(str)
            for c in d.columns:
                if c not in KEY + ["bw_source", "qc_flags"]:
                    d[c] = pd.to_numeric(d[c], errors="coerce")
        m = old.merge(new, on=KEY, how="outer", suffixes=("_old", "_new"), indicator=True)
        m.to_csv(out / f"{mv}_old_vs_v2.csv", index=False)
        both = m[m._merge == "both"]
        L.append(f"\n## {mv.upper()}")
        L.append(f"- old trials {len(old)}, v2 trials {len(new)}, in both {len(both)}, "
                 f"old only {int((m._merge == 'left_only').sum())}, v2 only {int((m._merge == 'right_only').sum())}")
        if len(both):
            dj = (both.jh_in_new - both.jh_in_old).abs()
            L.append(f"- JH |v2-old|: median {dj.median():.2f} in, within 0.2 in: {100 * (dj <= 0.2).mean():.0f}%, "
                     f"> 0.5 in: {(dj > 0.5).sum()} trials")
            L.append(f"- peak power old/v2: median {(both.pp_forceplate / both.peak_power_w).median():.2f}; "
                     f"W/kg old median {both.pp_w_per_kg_old.median():.1f} -> v2 {both.pp_w_per_kg_new.median():.1f}")
            L.append(f"- v2 vel@PP / takeoff velocity: median "
                     f"{(both.vel_at_pp_m_s / both.takeoff_velocity_m_s).median():.2f}")
            if mv == "dj":
                L.append(f"- CT |v2-old| median {(both.ct_s - both.ct).abs().median():.3f} s; "
                         f"RSI old vs v2 rsi_legacy |diff| median {(both.rsi_old - both.rsi_legacy).abs().median():.3f}")
                L.append(f"- implied drop height median {both.implied_drop_cm.median():.0f} cm")
            big = both[dj > 0.5]
            if len(big):
                big[KEY + ["jh_in_old", "jh_in_new"]].to_csv(out / f"{mv}_jh_mismatch.csv", index=False)
                L.append(f"  - JH mismatches listed in {mv}_jh_mismatch.csv")
    (out / "validation.md").write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
