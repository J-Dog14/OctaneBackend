#!/usr/bin/env python3
"""
Kurtosis study - READ-ONLY export from the warehouse (never writes to any DB).

Run from the repo root on the ThinkPad:
    uais\\venv\\Scripts\\python uais\\python\\research\\kurtosis\\export_kurtosis_data.py
Options:
    --skip-curves   skip the per-trial lead-leg force curve pass (fast)
    --limit N       only process N pitching trials in the curve pass (smoke test)

Writes to tmp/kurtosis_study/:
    screen_cmj.csv, screen_dj.csv, screen_ppu.csv, screen_slv.csv
    pitching_trials.csv          f_pitching_trials + f_pitching_force_metrics (velo + GRF metrics)
    pitching_lead_shape.csv      shape metrics (incl. both kurtosis definitions) of the
                                 lead-leg Fz / braking / resultant curves, per trial & window
"""
import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
UAIS = HERE.parents[2]
REPO = UAIS.parent
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(HERE))

from python.common.athlete_manager import get_warehouse_connection  # noqa: E402
from python.scripts.backfill_pitching_force_metrics import (  # noqa: E402
    identify_plates, apply_butter_filter, _parse_json)
from shape import curve_shape  # noqa: E402

OUT = REPO / "tmp" / "kurtosis_study"


def read_sql(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=cols)
    return df.loc[:, ~df.columns.duplicated()]


def export_screens(conn):
    for mv in ["cmj", "dj", "ppu", "slv"]:
        df = read_sql(conn, f"""
            SELECT s.*, a.gender, a.height AS athlete_height, a.weight AS athlete_weight
            FROM public.f_athletic_screen_{mv} s
            LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = s.athlete_uuid""")
        df.to_csv(OUT / f"screen_{mv}.csv", index=False)
        print(f"  screen_{mv}.csv  rows={len(df)}  athletes={df.athlete_uuid.nunique()}")


def export_pitching(conn):
    df = read_sql(conn, """
        SELECT t.athlete_uuid, t.session_date, t.trial_index, t.velocity_mph, t.score,
               t.age_at_collection, t.age_group, t.height, t.weight, t.handedness AS trial_handedness,
               a.gender, m.*
        FROM public.f_pitching_trials t
        LEFT JOIN public.f_pitching_force_metrics m
               ON m.athlete_uuid = t.athlete_uuid AND m.session_date = t.session_date
              AND m.trial_index = t.trial_index
        LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid""")
    df = df.drop(columns=[c for c in ["id", "qa_warnings_json"] if c in df.columns])
    df.to_csv(OUT / "pitching_trials.csv", index=False)
    print(f"  pitching_trials.csv  rows={len(df)}  with_force_metrics={df['fc_frame'].notna().sum()}")


def export_lead_shapes(conn, limit=None):
    keys = read_sql(conn, """
        SELECT m.athlete_uuid, m.session_date, m.trial_index, m.fc_frame, m.br_frame, m.mer_frame,
               m.initial_contact_frame, m.braking_sign, m.body_weight_n, td.frame_rate
        FROM public.f_pitching_force_metrics m
        LEFT JOIN public.f_pitching_time_data td
               ON td.athlete_uuid = m.athlete_uuid AND td.session_date = m.session_date
              AND td.trial_index = m.trial_index
        WHERE m.fc_frame IS NOT NULL AND m.br_frame IS NOT NULL
        ORDER BY m.session_date, m.athlete_uuid, m.trial_index""")
    if limit:
        keys = keys.head(limit)
    rows, t0 = [], time.time()
    for i, r in enumerate(keys.itertuples(index=False), 1):
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM public.f_pitching_force_data "
                            "WHERE athlete_uuid=%s AND session_date=%s AND trial_index=%s",
                            (r.athlete_uuid, r.session_date, r.trial_index))
                fd = cur.fetchone()
            data = _parse_json(fd[0]) if fd else None
            if not data:
                continue
            fs = float(r.frame_rate or 300.0)
            dt = 1.0 / fs
            lead = identify_plates(data)["lead_mat"]
            lead = np.column_stack([apply_butter_filter(lead[:, k], dt)[0] for k in range(3)])
            bw = float(r.body_weight_n) if r.body_weight_n else np.nan
            fz = lead[:, 2] / bw
            fb = (float(r.braking_sign or -1) * lead[:, 1]) / bw
            fr = np.sqrt((lead ** 2).sum(axis=1)) / bw
            fc, br = int(r.fc_frame), int(r.br_frame)
            mer = int(r.mer_frame) if pd.notna(r.mer_frame) else None
            # stance end: first frame after BR where Fz drops below 10% of its FC->BR peak
            pk = np.nanmax(fz[fc:br + 1])
            after = np.where(fz[br:] < 0.10 * pk)[0]
            stance_end = br + int(after[0]) if after.size else len(fz) - 1
            row = dict(athlete_uuid=r.athlete_uuid, session_date=r.session_date,
                       trial_index=r.trial_index, fs_hz=fs, n_frames=len(fz),
                       stance_end_frame=stance_end, stance_cropped=bool(after.size == 0))
            windows = {"fcbr": (fc, br), "stance": (fc, stance_end)}
            if mer is not None and mer > fc:
                windows["fcmer"] = (fc, mer)
            for wname, (a, b) in windows.items():
                for sname, sig in (("fz", fz), ("brk", fb), ("res", fr)):
                    row.update(curve_shape(sig, fs, a, b, prefix=f"{sname}_{wname}_"))
            rows.append(row)
        except Exception as e:  # keep going, report at the end
            rows.append(dict(athlete_uuid=r.athlete_uuid, session_date=r.session_date,
                             trial_index=r.trial_index, error=str(e)[:200]))
        if i % 100 == 0:
            print(f"    {i}/{len(keys)} trials  ({time.time() - t0:.0f}s)")
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "pitching_lead_shape.csv", index=False)
    n_err = df["error"].notna().sum() if "error" in df else 0
    print(f"  pitching_lead_shape.csv  rows={len(df)}  errors={n_err}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-curves", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    conn = get_warehouse_connection()
    conn.set_session(readonly=True)
    try:
        print("Exporting athletic screens..."); export_screens(conn)
        print("Exporting pitching trials..."); export_pitching(conn)
        if not args.skip_curves:
            print("Computing lead-leg curve shapes (slow - one trial at a time)...")
            export_lead_shapes(conn, args.limit)
    finally:
        conn.close()
    print(f"Done -> {OUT}")


if __name__ == "__main__":
    main()
