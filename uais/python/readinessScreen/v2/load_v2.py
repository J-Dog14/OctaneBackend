#!/usr/bin/env python3
"""
Readiness Screen v2 - Phase B: match athletes and load the scan into NEW tables.

Reads the Phase A output (tmp/readiness_v2). Writes ONLY public.f_readiness_screen_v2_*.
Never writes d_athletes, the old f_readiness_screen_* tables or the App DB.

Athlete matching (read-only), first agreeing set of hits wins, disagreements -> review:
  override        match_overrides.csv (athlete_folder,athlete_uuid)
  screen_v2       f_athletic_screen_v2_* rows whose source_athlete_id is this athlete folder
                  (same QTM folder naming, already matched when the screen was rebuilt)
  old_readiness   an old f_readiness_screen_* row on the same date whose athlete name matches
  email           session.xml email = d_athletes.email
  name_exact      normalized folder name = d_athletes.normalized_name
Unmatched / conflicting sessions are written to match_review.csv and not loaded.

Same athlete + date found in both roots (Athletic Screen 2.0 and Readiness Screen 3): the AS2
copy is kept. Two folders on one date in the same root become one session (trials renumbered).

    python uais/python/readinessScreen/v2/load_v2.py            # dry run
    python uais/python/readinessScreen/v2/load_v2.py --apply    # create tables + upsert
"""
import argparse
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
REPO = PY.parents[1]
sys.path.insert(0, str(PY))

from readinessScreen.v2 import schema                                         # noqa: E402
from common.athlete_manager import (get_warehouse_connection,                 # noqa: E402
                                    normalize_name_for_matching, normalize_email)
from common.age_utils import calculate_age_group                              # noqa: E402

OLD_TABLES = ["f_readiness_screen", "f_readiness_screen_cmj", "f_readiness_screen_ppu", "f_readiness_screen_i",
              "f_readiness_screen_y", "f_readiness_screen_t", "f_readiness_screen_ir90"]
ISO_CODES = ("I", "Y", "T", "IR90")


def q(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def sim(a, b):
    return SequenceMatcher(None, a or "", b or "").ratio()


def match_athletes(conn, sessions, overrides):
    ath = q(conn, "SELECT athlete_uuid, name, normalized_name, email FROM analytics.d_athletes")
    ath["email_n"] = ath.email.map(lambda e: normalize_email(e) if e else None)
    norm = dict(zip(ath.athlete_uuid, ath.normalized_name))
    sv2 = pd.concat([q(conn, f"SELECT DISTINCT source_athlete_id, athlete_uuid FROM public.f_athletic_screen_v2_{m}")
                     for m in ("cmj", "dj", "ppu", "slv")]).drop_duplicates()
    old = pd.concat([q(conn, f"SELECT DISTINCT athlete_uuid, session_date FROM public.{t} "
                             f"WHERE source_system IS DISTINCT FROM 'athletic_screen_v2'") for t in OLD_TABLES])
    old = old.drop_duplicates()
    old["session_date"] = old.session_date.astype(str)
    old["name_n"] = old.athlete_uuid.map(norm)

    rows = []
    for _, s in sessions.iterrows():
        name_n = normalize_name_for_matching(s.athlete_name or "")
        xml_n = normalize_name_for_matching(s.xml_name) if isinstance(s.xml_name, str) else ""
        names = {n for n in (name_n, xml_n) if n}
        hits = {}
        if s.athlete_folder in overrides:
            hits["override"] = overrides[s.athlete_folder]
        u = sv2.loc[sv2.source_athlete_id == s.athlete_folder, "athlete_uuid"].unique()
        if len(u) == 1:
            hits["screen_v2"] = u[0]
        same_day = old[old.session_date == str(s.session_date)]
        if len(same_day) and names:
            sc = same_day.assign(s=same_day.name_n.map(lambda n: max(sim(n or "", x) for x in names)))
            top = sc[sc.s >= 0.85].athlete_uuid.unique()
            if len(top) == 1:
                hits["old_readiness"] = top[0]
        em = normalize_email(s.email) if isinstance(s.email, str) and s.email else None
        if em:
            u = ath.loc[ath.email_n == em, "athlete_uuid"].unique()
            if len(u) == 1:
                hits["email"] = u[0]
        u = ath.loc[ath.normalized_name.isin(names), "athlete_uuid"].unique()
        if len(u) == 1:
            hits["name_exact"] = u[0]
        best = ath.assign(s=ath.normalized_name.map(lambda n: sim(n, name_n))).nlargest(1, "s")
        if "override" in hits:
            uuid, method = hits["override"], "override"
        else:
            uuids = set(hits.values())
            if len(uuids) == 1:
                uuid, method = uuids.pop(), "+".join(hits)
            elif len(uuids) > 1:
                uuid, method = None, "conflict: " + json.dumps(hits)
            else:
                uuid, method = None, "no confident match"
        rows.append(dict(source_root=s.source_root, athlete_folder=s.athlete_folder, session_folder=s.session_folder,
                         session_date=s.session_date, athlete_name=s.athlete_name, xml_name=s.xml_name,
                         email=s.email, athlete_uuid=uuid, match_method=method,
                         best_fuzzy_name=f"{best.iloc[0]['name']} ({best.iloc[0]['s']:.2f})" if len(best) else None,
                         best_fuzzy_uuid=best.iloc[0]["athlete_uuid"] if len(best) else None))
    return pd.DataFrame(rows)


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return float(v) if np.isfinite(v) else None
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def upsert(conn, table, df, cols, key):
    from psycopg2.extras import execute_values
    if df.empty:
        return 0
    names = [c for c, _ in cols]
    data = [tuple(_clean(r.get(c)) for c in names) for r in df.to_dict("records")]
    upd = ", ".join(f"{c}=EXCLUDED.{c}" for c in names if c not in key)
    extra = ", updated_at=now()" if "curve" not in table else ""
    sql = (f"INSERT INTO {table} ({', '.join(names)}) VALUES %s "
           f"ON CONFLICT ({', '.join(key)}) DO UPDATE SET {upd}{extra}")
    with conn.cursor() as cur:
        execute_values(cur, sql, data, page_size=200)
    return len(data)


def pick_root(df):
    """Same athlete + date in both roots -> keep AS2 (the current project)."""
    roots = df.groupby(["athlete_uuid", "session_date"]).source_root.transform("nunique")
    drop = (roots > 1) & (df.source_root != "AS2")
    return df[~drop], df[drop]


def merge_same_day(df):
    """Two folders for one athlete on one date (same root) become one session filed under the first
    folder; the later folder's trials are numbered after the earlier ones (CMJ1-2 + CMJ1-2 -> CMJ1-4)."""
    df = df.copy()
    df["orig_session_folder"] = df.session_folder
    df["orig_trial_name"] = df.trial_name
    merged = []
    for _, g in df.groupby(["athlete_uuid", "session_date"]):
        folders = sorted(g.session_folder.unique())
        if len(folders) < 2:
            continue
        merged.append(f"{g.athlete_folder.iloc[0]} {g.session_date.iloc[0]}: {' + '.join(folders)}")
        offset = {}
        for f in folders:
            part = g[g.session_folder == f]
            for i, r in part.iterrows():
                n = int(r.trial_number) + offset.get(r.movement, 0)
                df.at[i, "trial_number"] = n
                df.at[i, "trial_name"] = f"{r.movement}{n}" if r.movement in ("CMJ", "PPU") else f"{r.movement}_{n}"
                df.at[i, "session_folder"] = folders[0]
            for mv, mx in part.groupby("movement").trial_number.max().items():
                offset[mv] = offset.get(mv, 0) + int(mx)
    return df, merged


def prepare(scan, name, key):
    f = scan / f"trials_{name}.csv"
    if not f.exists() or f.stat().st_size < 5:
        return pd.DataFrame()
    df = pd.read_csv(f)
    if df.empty:
        return df
    df["session_date"] = df.session_date.astype(str)
    df = df.merge(key, on=["source_root", "athlete_folder", "session_folder", "session_date"], how="inner")
    df["source_athlete_id"] = df.athlete_folder
    df["source_system"] = "readiness_screen_v2"
    df["age_group"] = df.age_at_collection.map(lambda a: calculate_age_group(a) if pd.notna(a) else None)
    df["qc_flags"] = df.qc_flags.fillna("").map(lambda s: [x for x in str(s).split(";") if x])
    return df


def curve_records(scan, df, movement_col=None):
    recs = []
    for r in df.to_dict("records"):
        p = scan / "curves" / f"{r['source_root']}__{r['athlete_folder']}__{r['orig_session_folder']}__{r['orig_trial_name']}.npz"
        if not p.exists():
            continue
        z = np.load(p)
        ix = lambda k: int(z[k]) if k in z and int(z[k]) >= 0 else None
        recs.append(dict(athlete_uuid=r["athlete_uuid"], session_date=r["session_date"],
                         session_folder=r["session_folder"], movement=r["movement"], trial_name=r["trial_name"],
                         fs_hz=float(z["fs_hz"]), fz_n=[round(float(x), 2) for x in z["fz_n"]],
                         bw_n=float(z["bw_n"]) if np.isfinite(z["bw_n"]) else None,
                         plate_offset_n=float(z["plate_offset_n"]), first_frame=int(z["first_frame"]),
                         takeoff_idx=ix("takeoff_idx"), landing_idx=ix("landing_idx"),
                         contact_start_idx=ix("contact_start_idx"), concentric_start_idx=ix("concentric_start_idx"),
                         movement_onset_idx=ix("movement_onset_idx"), max_idx=ix("max_idx"),
                         processor_version=r["processor_version"]))
    return pd.DataFrame(recs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", default=str(REPO / "tmp" / "readiness_v2"))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--no-curves", action="store_true")
    ap.add_argument("--include-test", action="store_true", help="also load Test*/Sample folders")
    args = ap.parse_args()
    scan = Path(args.scan)

    sessions = pd.read_csv(scan / "sessions.csv")
    sessions = sessions[sessions.status.astype(str).str.startswith("ok")]
    if not args.include_test:
        is_test = sessions.athlete_folder.str.contains(r"^\s*(?:test|sample)", case=False, regex=True)
        if is_test.any():
            print(f"Skipping {int(is_test.sum())} test/sample sessions: {sorted(sessions.loc[is_test, 'athlete_folder'].unique())}")
        sessions = sessions[~is_test]
    ov_path = scan / "match_overrides.csv"
    overrides = dict(pd.read_csv(ov_path).values) if ov_path.exists() else {}

    conn = get_warehouse_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT current_database(), inet_server_addr()::text")
        print("Warehouse: db=%s host=%s" % cur.fetchone())

    m = match_athletes(conn, sessions, overrides)
    m.to_csv(scan / "athlete_matches.csv", index=False)
    review = m[m.athlete_uuid.isna()]
    review.to_csv(scan / "match_review.csv", index=False)
    print(f"Sessions: {len(m)}  matched: {m.athlete_uuid.notna().sum()}  need review: {len(review)}")
    print(m.match_method.str.split(":").str[0].value_counts().to_string())

    key = m.dropna(subset=["athlete_uuid"])[["source_root", "athlete_folder", "session_folder", "session_date",
                                             "athlete_uuid"]].drop_duplicates()
    key["session_date"] = key.session_date.astype(str)
    frames = {}
    for name in ("cmj", "ppu", "iso"):
        df = prepare(scan, name, key)
        if df.empty:
            continue
        df, dropped = pick_root(df)
        if len(dropped):
            dropped[["source_root", "athlete_folder", "session_folder", "session_date", "trial_name"]].to_csv(
                scan / f"dropped_duplicate_root_{name}.csv", index=False)
            print(f"  {name}: {len(dropped)} trials also present in AS2 - RS3 copy dropped")
        df, merged = merge_same_day(df)
        for line in merged:
            print(f"  {name}: merged same-day folders -> {line}")
        frames[name] = df
        print(f"  {name}: {len(df)} trials ready")

    if not args.apply:
        print("\nDry run - nothing written. Review match_review.csv, then rerun with --apply.")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(schema.create_sql())
        for name, df in frames.items():
            if name == "iso":
                table, cols = schema.ISO_TABLE, schema.iso_columns()
            else:
                table, cols = schema.TABLE.format(name), schema.jump_columns(name)
            print(f"  upserted {upsert(conn, table, df, cols, schema.UNIQUE_KEY)} -> {table}")
            if not args.no_curves:
                n = upsert(conn, schema.CURVE_TABLE, curve_records(scan, df), schema.CURVE_COLS, schema.UNIQUE_KEY)
                print(f"  upserted {n} curves")
        conn.commit()
        print("Committed.")
    except Exception:
        conn.rollback()
        print("Rolled back - nothing written.")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
