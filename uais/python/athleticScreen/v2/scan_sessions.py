#!/usr/bin/env python3
"""
Athletic Screen v2 - Phase A: reprocess every Athletic Screen session from c3d.

No database access. Walks the Data folder, keeps sessions whose session.xml
says <Session Type="Athletic Screen">, reads FP3 from each CMJ/DJ/PPU/SLVL/SLVR
c3d, computes metrics with kinetics.py and writes:

    <out>/sessions.csv            one row per session folder (incl. skipped ones + why)
    <out>/trials_{cmj,dj,ppu,slv}.csv
    <out>/curves/<athlete>__<date>__<trial>.npz   offset-corrected Fz + events
    <out>/errors.csv              trials that failed, with the reason
    <out>/qc_report.md

Usage (from the repo root):
    python uais/python/athleticScreen/v2/scan_sessions.py --data "D:/Athletic Screen 2.0/Data"
    ... --athlete "Josh Sborz"     only folders whose athlete name contains this
    ... --out tmp/screen_v2        (default)
"""
import argparse
import os
import re
import sys
import traceback
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))           # .../athleticScreen  -> import v2.*

from v2 import PROCESSOR_VERSION                      # noqa: E402
from v2.c3d_reader import read_screen_fz, read_total_fz, C3DReadError   # noqa: E402
from v2.kinetics import process_trial, trial_quiet_bw, quiet_window, _prep, TrialError, G   # noqa: E402
from v2.session_meta import parse_session_xml          # noqa: E402

REPO = HERE.parents[3]
TRIAL_RE = re.compile(r"^(CMJ|DJ|PPU|SLVL|SLVR)\s*(\d+)\.c3d$", re.I)
SCALAR_SKIP = {"qc_flags"}


def athlete_from_folder(folder_name):
    """'Josh Sborz_JS' -> ('Josh Sborz', 'JS')."""
    if "_" in folder_name:
        name, _, sid = folder_name.rpartition("_")
        return name.strip(), sid.strip()
    return folder_name.strip(), None


def session_date_of(folder, meta):
    m = re.match(r"(\d{4}-\d{2}-\d{2})", folder.name)
    if m:
        return m.group(1)
    return meta.get("creation_date")


def age_at(dob, sdate):
    try:
        d0 = datetime.strptime(dob, "%Y-%m-%d").date()
        d1 = datetime.strptime(sdate, "%Y-%m-%d").date()
        return round((d1 - d0).days / 365.25, 2)
    except Exception:
        return None


def session_body_weight(folder, trials, loaded, entered_mass_kg=None):
    """Plate-measured body weight for the session, best source first:
       1. quiet stance in this session's CMJ/SLV trials (before the jump or after landing), DJ after landing
       2. a Static*.c3d standing trial in the folder (all plates summed)
       3. CMJ quiet stance in another folder of the same athlete on the same date (e.g. the readiness '__2')
       4. impulse from the start of SLV/CMJ trials that begin standing (first 150 ms within 10% of the
          entered weight, CV < 5%): BW = integral(F) / (T + v_takeoff/g), i.e. v = 0 at the first sample and
          v = v_takeoff at takeoff. Checked against sessions that do have quiet stance: |error| median
          0.5-0.9% (p90 1.3-2.3%), vs 1.7% (p90 7%) for the typed-in mass.
    Returns (bw_n or None, source, [values])."""
    qbw = []
    for t in trials:
        if t["trial_name"] in loaded and t["movement"] in ("CMJ", "SLV", "DJ"):
            fz, fs, _ = loaded[t["trial_name"]]
            q = trial_quiet_bw(fz, fs, t["movement"])
            if q:
                qbw.append(q["bw_n"])
    if qbw:
        return float(np.median(qbw)), "session_trials_quiet", qbw
    for f in sorted(folder.glob("Static*.c3d")):
        try:
            fz, fs, _ = read_total_fz(f)
        except C3DReadError:
            continue
        q = quiet_window(fz, fs, 0, len(fz), 0.02, win_s=0.5)
        if q:
            qbw.append(q["bw_n"])
    if qbw:
        return float(np.median(qbw)), "static_trial", qbw
    prefix = folder.name[:10]
    for sib in sorted(folder.parent.iterdir()):
        if sib == folder or not sib.is_dir() or not sib.name.startswith(prefix):
            continue
        for f in sorted(sib.glob("CMJ*.c3d")):
            try:
                fz, fs, _ = read_screen_fz(f)
            except C3DReadError:
                continue
            q = trial_quiet_bw(fz, fs, "CMJ")
            if q:
                qbw.append(q["bw_n"])
    if qbw:
        return float(np.median(qbw)), "same_day_other_session", qbw
    if entered_mass_kg:
        ent = entered_mass_kg * G
        for t in trials:
            if t["trial_name"] not in loaded or t["movement"] not in ("SLV", "CMJ"):
                continue
            fz, fs, _ = loaded[t["trial_name"]]
            try:
                p = _prep(fz, fs, t["movement"])
            except TrialError:
                continue
            f, to, ld = p["fz"], p["to"], p["ld"]
            head = f[:int(0.15 * fs)]
            if p["starts_unloaded"] or abs(head.mean() / ent - 1) > 0.10 or head.std() / head.mean() > 0.05:
                continue
            v_to = G * (ld - to) / fs / 2.0
            qbw.append(float(f[:to].sum() / fs / (to / fs + v_to / G)))
    if qbw:
        return float(np.median(qbw)), "impulse_from_start", qbw
    return None, None, []


def process_session(folder, data_root, out, box_height_cm=None, since=None):
    meta = parse_session_xml(folder / "session.xml")
    ath_folder = folder.parent.name
    ath_name, ath_id = athlete_from_folder(ath_folder)
    sdate = session_date_of(folder, meta)
    srow = dict(athlete_folder=ath_folder, session_folder=folder.name, athlete_name=ath_name, athlete_id=ath_id,
                session_date=sdate, session_type=meta["session_type"],
                session_path=str(folder.relative_to(data_root)), xml_name=meta["subject_name"],
                weight_kg=meta["weight_kg"], height_m=meta["height_m"], dob=meta["dob"],
                gender=meta["gender"], email=meta["email"],
                age_at_collection=age_at(meta["dob"], sdate) if meta["dob"] and sdate else None)
    if since and sdate and sdate < since:
        srow["status"] = f"skipped: before {since}"
        return srow, [], []
    c3ds = sorted(f for f in folder.iterdir() if TRIAL_RE.match(f.name))
    srow["screen_c3d_files"] = ";".join(f.name for f in c3ds)
    srow["xml_session_types"] = ";".join(meta["session_types"])
    srow["xml_measurements"] = ";".join(meta["measurements"])
    types = {t.lower() for t in meta["session_types"]}
    mtype = meta["measurement_session_type"]
    codes = {TRIAL_RE.match(f.name).group(1).upper() for f in c3ds}
    if "athletic screen" in types:
        srow["screen_kind"] = "athletic_screen"
    elif types <= {"session", ""} and codes & {"DJ", "SLVL", "SLVR"}:
        # old generic QTM template: treat as an athletic screen candidate if it has DJ/SLV
        # (readiness screens never include those) - loaded only with --include-generic
        srow["screen_kind"] = "generic_session_candidate"
    else:
        srow["status"] = "skipped: no Athletic Screen session in session.xml"
        return srow, [], []

    trials = []
    for f in c3ds:
        m = TRIAL_RE.match(f.name)
        stem = f.name.rsplit(".", 1)[0].strip().upper()
        owner = mtype.get(stem)
        if srow["screen_kind"] == "athletic_screen" and owner is not None and owner.lower() != "athletic screen":
            continue            # this c3d belongs to another session in the same folder (e.g. readiness)
        if m:
            code, num = m.group(1).upper(), int(m.group(2))
            mv = "SLV" if code.startswith("SLV") else code
            trials.append(dict(path=f, code=code, num=num, movement=mv,
                               trial_name=f"{code}{num}", side={"SLVL": "Left", "SLVR": "Right"}.get(code)))
    if not trials:
        srow["status"] = "skipped: no screen c3d files"
        return srow, [], []

    # pass 1: read + session body weight from CMJ/SLV quiet stance
    loaded, errors = {}, []
    for t in trials:
        try:
            loaded[t["trial_name"]] = read_screen_fz(t["path"])
        except C3DReadError as e:
            errors.append(dict(athlete_folder=ath_folder, session_date=sdate, trial_name=t["trial_name"],
                               file=str(t["path"].relative_to(data_root)), error=str(e)))
    # rule: screens are collected on FP3 only - a session where any trial landed on other plates
    # (older drop jumps on FP1+FP2) is skipped as a whole
    off_fp3 = sorted(f"{k} ({v[2]['plate_used']})" for k, v in loaded.items() if v[2]["plate_used"] != "FP3")
    if off_fp3:
        srow["status"] = "skipped: trials not on FP3 - " + ", ".join(off_fp3)
        return srow, [], errors
    session_bw, sbw_src, qbw = session_body_weight(folder, trials, loaded, meta["weight_kg"])
    srow.update(session_bw_n=session_bw, session_bw_source=sbw_src, n_quiet_windows=len(qbw),
                session_bw_vs_entered_pct=(100 * (session_bw / 9.81 / meta["weight_kg"] - 1)
                                           if session_bw and meta["weight_kg"] else None))

    rows = []
    for t in trials:
        if t["trial_name"] not in loaded:
            continue
        fz, fs, cmeta = loaded[t["trial_name"]]
        try:
            res, arr = process_trial(fz, fs, t["movement"], session_bw_n=session_bw,
                                     entered_mass_kg=meta["weight_kg"], box_height_cm=box_height_cm)
        except (TrialError, Exception) as e:
            errors.append(dict(athlete_folder=ath_folder, session_date=sdate, trial_name=t["trial_name"],
                               file=str(t["path"].relative_to(data_root)), error=f"{type(e).__name__}: {e}"))
            continue
        row = dict(athlete_folder=ath_folder, athlete_name=ath_name, session_date=sdate,
                   session_folder=folder.name, screen_kind=srow["screen_kind"],
                   in_session_xml=mtype.get(t["path"].name.rsplit(".", 1)[0].strip().upper()) is not None,
                   trial_name=t["trial_name"], trial_number=t["num"], side=t["side"],
                   source_c3d=str(t["path"].relative_to(data_root)),
                   age_at_collection=srow["age_at_collection"], processor_version=PROCESSOR_VERSION,
                   c3d_first_frame=cmeta["first_frame"], c3d_nan_trimmed=cmeta["nan_trimmed"],
                   fz_channel_how=cmeta["fz_channel_how"], plate_used=cmeta["plate_used"],
                   session_bw_source=srow.get("session_bw_source"))
        row.update({k: v for k, v in res.items() if k not in SCALAR_SKIP})
        row["qc_flags"] = ";".join(res["qc_flags"])
        rows.append(row)
        key = f"{ath_folder}__{folder.name}__{t['trial_name']}"
        np.savez_compressed(out / "curves" / f"{key}.npz", fz_n=arr["fz"].astype(np.float32), fs_hz=fs,
                            bw_n=res["bw_n"], takeoff_idx=res["takeoff_idx"], landing_idx=res["landing_idx"],
                            contact_start_idx=res["contact_start_idx"],
                            concentric_start_idx=res["concentric_start_idx"],
                            movement_onset_idx=res.get("movement_onset_idx", -1),
                            first_frame=cmeta["first_frame"], plate_offset_n=res["plate_offset_n"])
    # session consistency: a trial far from the athlete's other trials of the same test usually means bad events
    groups = {}
    for r in rows:
        groups.setdefault((r["movement"], r.get("side")), []).append(r)
    for (mv, _), g in groups.items():
        if mv == "PPU" or len(g) < 3:
            continue
        for r in g:
            others = [o["jh_in"] for o in g if o is not r]
            med = float(np.median(others))
            if med > 0 and not (0.65 <= r["jh_in"] / med <= 1.40):
                r["qc_flags"] = ";".join([x for x in r["qc_flags"].split(";") if x] + ["jh_outlier_in_session"])
    srow["status"] = f"ok: {len(rows)} trials, {len(errors)} errors ({srow['screen_kind']})"
    for mv in ("CMJ", "DJ", "PPU", "SLV"):
        srow[f"n_{mv.lower()}"] = sum(1 for r in rows if r["movement"] == mv)
    return srow, rows, errors


def _md(df):
    try:
        return df.to_markdown()
    except ImportError:          # tabulate not installed
        return "```\n" + df.to_string() + "\n```"


def qc_report(out, sessions, trials, errors):
    L = [f"# Athletic Screen v2 scan - {datetime.now():%Y-%m-%d %H:%M}\n"]
    s = pd.DataFrame(sessions)
    L.append(f"Session folders found: {len(s)}")
    if len(s):
        L.append("\n" + _md(s["status"].str.split(":").str[0].value_counts().to_frame("sessions")))
    for mv, df in trials.items():
        if df.empty:
            continue
        L.append(f"\n## {mv}: {len(df)} trials, {df.athlete_folder.nunique()} athletes")
        L.append(f"- body weight source: {df.bw_source.value_counts().to_dict()}")
        flags = df.qc_flags.fillna("").str.split(";").explode()
        flags = flags[flags != ""]
        L.append(f"- QC flags: {flags.value_counts().to_dict() if len(flags) else 'none'}")
        if mv != "PPU" and "vel_at_pp_m_s" in df:
            r = (df.vel_at_pp_m_s / df.takeoff_velocity_m_s)
            L.append(f"- vel@PP / takeoff velocity: median {r.median():.2f} (should be ~0.9-0.97)")
        L.append(f"- PP W/kg median {df.pp_w_per_kg.median():.1f}  (IQR {df.pp_w_per_kg.quantile(.25):.1f}-{df.pp_w_per_kg.quantile(.75):.1f})")
        if "v_quiet_resid_m_s" in df and df.v_quiet_resid_m_s.notna().any():
            L.append(f"- quiet-start velocity residual |median| {df.v_quiet_resid_m_s.abs().median():.3f} m/s (n={df.v_quiet_resid_m_s.notna().sum()})")
        if mv == "DJ":
            L.append(f"- implied drop height median {df.implied_drop_cm.median():.0f} cm (IQR {df.implied_drop_cm.quantile(.25):.0f}-{df.implied_drop_cm.quantile(.75):.0f})")
    if len(s) and "session_bw_vs_entered_pct" in s:
        L.append(f"\nPlate BW vs entered mass: median {s.session_bw_vs_entered_pct.median():+.1f}%, "
                 f">5% off in {(s.session_bw_vs_entered_pct.abs() > 5).sum()} sessions")
    L.append(f"\nTrial errors: {len(errors)}")
    if errors:
        L.append("\n" + _md(pd.DataFrame(errors).error.str[:60].value_counts().head(15).to_frame("n")))
    (out / "qc_report.md").write_text("\n".join(L), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help=r'e.g. "D:\Athletic Screen 2.0\Data"')
    ap.add_argument("--out", default=str(REPO / "tmp" / "screen_v2"))
    ap.add_argument("--athlete", help="only athlete folders containing this text")
    ap.add_argument("--since", default="2025-07-01", help="skip sessions before this date (default 2025-07-01)")
    ap.add_argument("--box-height-cm", type=float, default=30.5, help="DJ box height (default 12 in = 30.5 cm)")
    args = ap.parse_args()
    data_root, out = Path(args.data), Path(args.out)
    (out / "curves").mkdir(parents=True, exist_ok=True)
    if not args.athlete:                       # full run: drop curves left over from earlier scans
        for old in (out / "curves").glob("*.npz"):
            old.unlink()

    xmls = sorted(Path(dp) / "session.xml" for dp, _, fns in os.walk(data_root, followlinks=True)
                  if "session.xml" in fns)
    if args.athlete:
        xmls = [x for x in xmls if args.athlete.lower() in x.parent.parent.name.lower()]
    print(f"{len(xmls)} session folders under {data_root}")
    sessions, trials, errors = [], {k: [] for k in ("CMJ", "DJ", "PPU", "SLV")}, []
    for i, x in enumerate(xmls, 1):
        try:
            srow, rows, errs = process_session(x.parent, data_root, out, args.box_height_cm, args.since)
        except Exception as e:
            srow, rows, errs = dict(session_path=str(x.parent.relative_to(data_root)),
                                    status=f"error: {type(e).__name__}: {e}"), [], []
            traceback.print_exc()
        sessions.append(srow)
        errors += errs
        for r in rows:
            trials[r["movement"]].append(r)
        print(f"  [{i}/{len(xmls)}] {srow.get('session_path')}: {srow.get('status')}", flush=True)

    pd.DataFrame(sessions).to_csv(out / "sessions.csv", index=False)
    pd.DataFrame(errors).to_csv(out / "errors.csv", index=False)
    dfs = {}
    for mv, rows in trials.items():
        dfs[mv] = pd.DataFrame(rows)
        dfs[mv].to_csv(out / f"trials_{mv.lower()}.csv", index=False)
    qc_report(out, sessions, dfs, errors)
    print(f"Done -> {out}  (see qc_report.md)")


if __name__ == "__main__":
    main()
