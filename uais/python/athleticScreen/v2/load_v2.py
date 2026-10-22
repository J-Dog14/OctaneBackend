#!/usr/bin/env python3
"""
Athletic Screen v2 - Phase B: match athletes and load the scan into NEW tables.

Reads the Phase A output (tmp/screen_v2 by default). Writes ONLY to
public.f_athletic_screen_v2_* and public.f_athletic_screen_v2_force_curve.
Never writes d_athletes or the old f_athletic_screen_* tables, never touches the App DB.

Athlete matching (read-only lookups), first hit wins, disagreements -> review:
  1. existing_session  old screen rows on the same date whose source_athlete_id
                       is the same name (normalized) -> that athlete_uuid
  2. email             session.xml email = d_athletes.email
  3. name_exact        normalized folder name = d_athletes.normalized_name
  Fuzzy-only / ambiguous / conflicting matches are NOT loaded; they go to
  match_review.csv so you can resolve them (add a row to match_overrides.csv:
  athlete_folder,athlete_uuid and rerun).

Usage (repo root, uais venv):
    python uais/python/athleticScreen/v2/load_v2.py              # dry run: matching report only
    python uais/python/athleticScreen/v2/load_v2.py --apply      # create v2 tables + upsert
"""
import argparse
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
UAIS = HERE.parents[2]
REPO = UAIS.parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(UAIS))

from v2 import schema                                                       # noqa: E402
from python.common.athlete_manager import (get_warehouse_connection,       # noqa: E402
                                           normalize_name_for_matching, normalize_email)
from python.common.age_utils import calculate_age_group                    # noqa: E402


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
    old = []
    for mv in schema.MOVEMENTS:
        old.append(q(conn, f"SELECT DISTINCT athlete_uuid, session_date, source_athlete_id "
                           f"FROM public.f_athletic_screen_{mv}"))
    old = pd.concat(old).drop_duplicates()
    old["session_date"] = old.session_date.astype(str)
    old["name_n"] = old.source_athlete_id.map(lambda s: normalize_name_for_matching(s or ""))

    rows = []
    for _, s in sessions.iterrows():
        name_n = normalize_name_for_matching(s.athlete_name or "")
        xml_n = normalize_name_for_matching(s.xml_name) if isinstance(s.xml_name, str) else ""
        names = {n for n in (name_n, xml_n) if n}
        hits = {}
        if s.athlete_folder in overrides:
            hits["override"] = overrides[s.athlete_folder]
        same_day = old[old.session_date == str(s.session_date)]
        u = same_day.loc[same_day.name_n.isin(names), "athlete_uuid"].unique()
        if len(u) == 1:
            hits["existing_session"] = u[0]
        elif len(u) == 0 and len(same_day):
            # same date + clearly similar name (typos like 'Jjosh') is still the same session
            sc = same_day.assign(s=same_day.name_n.map(lambda n: max(sim(n, x) for x in names) if names else 0))
            top = sc[sc.s >= 0.85].athlete_uuid.unique()
            if len(top) == 1:
                hits["existing_session_fuzzy"] = top[0]
        em = normalize_email(s.email) if isinstance(s.email, str) and s.email else None
        if em:
            u = ath.loc[ath.email_n == em, "athlete_uuid"].unique()
            if len(u) == 1:
                hits["email"] = u[0]
        u = ath.loc[ath.normalized_name.isin(names), "athlete_uuid"].unique()
        if len(u) == 1:
            hits["name_exact"] = u[0]
        best = ath.assign(s=ath.normalized_name.map(lambda n: sim(n, name_n))).nlargest(2, "s")
        fuzzy = f"{best.iloc[0]['name']} ({best.iloc[0]['s']:.2f})" if len(best) else None
        fuzzy_uuid = best.iloc[0]["athlete_uuid"] if len(best) else None

        if "override" in hits:
            uuid, method = hits["override"], "override"
        else:
            uuids = set(hits.values())
            if len(uuids) == 1:
                uuid, method = uuids.pop(), "+".join(hits.keys())
            elif len(uuids) > 1:
                uuid, method = None, "conflict: " + json.dumps(hits)
            else:
                uuid, method = None, "no confident match"
        rows.append(dict(athlete_folder=s.athlete_folder, session_date=s.session_date, athlete_name=s.athlete_name,
                         xml_name=s.xml_name, email=s.email, athlete_uuid=uuid, match_method=method,
                         best_fuzzy_name=fuzzy, best_fuzzy_uuid=fuzzy_uuid))
    return pd.DataFrame(rows)


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and not np.isfinite(v):
        return None
    if isinstance(v, (np.floating,)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
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


def merge_same_day(df):
    """Two athletic-screen folders for the same athlete on the same date (e.g. '2025-10-24_' and
    '2025-10-24__2') become one session: everything is filed under the first folder and the later
    folder's trials are renumbered after the earlier ones (CMJ1-2 + CMJ1-2 -> CMJ1-4)."""
    df = df.copy()
    df["orig_session_folder"] = df.session_folder
    df["orig_trial_name"] = df.trial_name
    df["_code"] = df.trial_name.str.extract(r"^([A-Z]+)")[0]
    merged = []
    for (_, _), g in df.groupby(["athlete_uuid", "session_date"]):
        folders = sorted(g.session_folder.unique())
        if len(folders) < 2:
            continue
        merged.append(f"{g.athlete_folder.iloc[0]} {g.session_date.iloc[0]}: {' + '.join(folders)}")
        offset = {}
        for f in folders:
            part = g[g.session_folder == f]
            for i, r in part.iterrows():
                n = int(r.trial_number) + offset.get(r._code, 0)
                df.at[i, "trial_number"] = n
                df.at[i, "trial_name"] = f"{r._code}{n}"
                df.at[i, "session_folder"] = folders[0]
            for c, mx in part.groupby("_code").trial_number.max().items():
                offset[c] = offset.get(c, 0) + int(mx)
    return df.drop(columns="_code"), merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", default=str(REPO / "tmp" / "screen_v2"))
    ap.add_argument("--apply", action="store_true", help="create the v2 tables and write rows")
    ap.add_argument("--no-curves", action="store_true")
    ap.add_argument("--include-test", action="store_true", help="also load Test*/Sample Report folders")
    ap.add_argument("--include-generic", action="store_true",
                    help="also load old generic 'Session'-type folders that contain DJ/SLV trials")
    args = ap.parse_args()
    scan = Path(args.scan)

    sessions = pd.read_csv(scan / "sessions.csv")
    sessions = sessions[sessions.status.astype(str).str.startswith("ok")]
    if not args.include_generic and "screen_kind" in sessions:
        sessions = sessions[sessions.screen_kind == "athletic_screen"]
    if not args.include_test:
        is_test = sessions.athlete_folder.str.contains(r"^\s*(?:test|sample report)", case=False, regex=True)
        if is_test.any():
            print(f"Skipping {int(is_test.sum())} test/sample sessions: "
                  f"{sorted(sessions.loc[is_test, 'athlete_folder'].unique())}")
        sessions = sessions[~is_test]
    ov_path = scan / "match_overrides.csv"
    overrides = dict(pd.read_csv(ov_path).values) if ov_path.exists() else {}

    conn = get_warehouse_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT current_database(), inet_server_addr()::text")
        db, host = cur.fetchone()
    print(f"Warehouse: db={db} host={host}")

    m = match_athletes(conn, sessions, overrides)
    m.to_csv(scan / "athlete_matches.csv", index=False)
    review = m[m.athlete_uuid.isna()]
    review.to_csv(scan / "match_review.csv", index=False)
    print(f"Sessions: {len(m)}  matched: {m.athlete_uuid.notna().sum()}  need review: {len(review)}")
    print(m.match_method.str.split(":").str[0].value_counts().to_string())

    key = m.dropna(subset=["athlete_uuid"])[["athlete_folder", "session_date", "athlete_uuid"]].drop_duplicates()
    key["session_date"] = key.session_date.astype(str)
    frames = {}
    for mv in schema.MOVEMENTS:
        f = scan / f"trials_{mv}.csv"
        if not f.exists() or f.stat().st_size < 5:
            continue
        df = pd.read_csv(f)
        if df.empty:
            continue
        df["session_date"] = df.session_date.astype(str)
        df = df.merge(key, on=["athlete_folder", "session_date"], how="inner")
        df["source_athlete_id"] = df.athlete_folder
        df["source_system"] = "athletic_screen_v2"     # explicit: a NULL in the insert overrides the column default
        df["age_group"] = df.age_at_collection.map(lambda a: calculate_age_group(a) if pd.notna(a) else None)
        df["qc_flags"] = df.qc_flags.fillna("").map(lambda s: [x for x in s.split(";") if x])
        df, merged = merge_same_day(df)
        for line in merged:
            print(f"  {mv}: merged same-day folders -> {line}")
        frames[mv] = df
        print(f"  {mv}: {len(df)} trials ready")

    if not args.apply:
        print("\nDry run - nothing written. Review match_review.csv, then rerun with --apply.")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(schema.create_sql())
        for mv, df in frames.items():
            n = upsert(conn, schema.TABLE.format(mv), df, schema.trial_columns(mv), schema.UNIQUE_KEY)
            print(f"  upserted {n} -> {schema.TABLE.format(mv)}")
            if not args.no_curves:
                recs = []
                for r in df.to_dict("records"):
                    p = scan / "curves" / f"{r['athlete_folder']}__{r['orig_session_folder']}__{r['orig_trial_name']}.npz"
                    if not p.exists():
                        continue
                    z = np.load(p)
                    recs.append(dict(athlete_uuid=r["athlete_uuid"], session_date=r["session_date"],
                                     session_folder=r["session_folder"],
                                     movement=mv.upper(), trial_name=r["trial_name"], fs_hz=float(z["fs_hz"]),
                                     fz_n=[round(float(x), 2) for x in z["fz_n"]], bw_n=float(z["bw_n"]),
                                     plate_offset_n=float(z["plate_offset_n"]), first_frame=int(z["first_frame"]),
                                     takeoff_idx=int(z["takeoff_idx"]), landing_idx=int(z["landing_idx"]),
                                     contact_start_idx=int(z["contact_start_idx"]),
                                     concentric_start_idx=int(z["concentric_start_idx"]),
                                     movement_onset_idx=int(z["movement_onset_idx"]),
                                     processor_version=r["processor_version"]))
                n = upsert(conn, schema.CURVE_TABLE, pd.DataFrame(recs), schema.CURVE_COLS, schema.UNIQUE_KEY)
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
