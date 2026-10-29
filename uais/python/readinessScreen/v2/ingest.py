#!/usr/bin/env python3
"""
Readiness Screen ingest (v2) - what runs when you hit Ingest for the readiness-screen runner.

Replaces the legacy flow (Visual3D -> Readiness Output Files txt -> main.py -> f_readiness_screen_*).
Reads c3d + session.xml directly and writes ONLY the v2 tables:
    public.f_readiness_screen_v2_{cmj,ppu,iso}, public.f_readiness_screen_v2_force_curve
then scores each new session (f_readiness_screen_score) from the v_readiness_screen_* views.

Where the data comes from (READINESS_SCREEN_DATA_DIR, i.e. Settings -> uais_data_dir_readiness_screen):
  * the Data root, D:\\Athletic Screen 2.0\\Data: every folder whose session.xml says
    Session Type="Readiness Screen" and that is not in the v2 tables yet. With an athlete selected
    (ATHLETE_UUID) only that athlete's folders; if none are new you're asked whether to re-ingest
    the latest one.
  * a single session folder, or an upload/agent temp dir with c3d + session.xml at its root.

Per athlete, in one transaction:
  1. process c3d (CMJ/PPU kinetics, I/Y/T/IR90 isometrics) + QC flags
  2. resolve the athlete: selected UUID (name guard) | athlete already in readiness v2 or athletic
     screen v2 under this folder | get_or_create_athlete (prints NEW_ATHLETE / MISSING_DOB signals)
  3. fill missing DOB / gender / email from session.xml
  4. age_at_collection + age_group
  5. replace this session's v2 rows (delete + insert) and curves
  6. has_readiness_screen_data flag
Then: duplicate-athlete check, readiness score per new session.

    python readinessScreen/v2/ingest.py [--dry-run] [--offline] [--reprocess] [--session PATH]
"""
import argparse
import os
import re
import sys
import tempfile
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]                      # uais/python
for p in (str(PY), str(PY / "readinessScreen")):
    if p not in sys.path:
        sys.path.insert(0, p)

from readinessScreen.v2 import schema, PROCESSOR_VERSION                          # noqa: E402
from readinessScreen.v2.scan_sessions import process_session, athlete_from_folder, ISO   # noqa: E402
from readinessScreen.v2.load_v2 import upsert, merge_same_day                     # noqa: E402

DEFAULT_DATA_ROOT = r"D:\Athletic Screen 2.0\Data"
TEST_RE = re.compile(r"^\s*(?:test|sample)", re.I)
FRAMES = ("cmj", "ppu", "iso")


def log(msg=""):
    print(msg, flush=True)


def sim(a, b):
    return SequenceMatcher(None, a or "", b or "").ratio()


def q(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def resolve_data_dir(arg_session):
    if arg_session:
        return Path(arg_session)
    d = os.environ.get("READINESS_SCREEN_DATA_DIR", "").strip() or DEFAULT_DATA_ROOT
    p = Path(d)
    if "output files" in str(p).lower():
        log(f"ERROR: READINESS_SCREEN_DATA_DIR points at '{p}'. The Visual3D Output Files step is retired - "
            f"set Settings -> uais_data_dir_readiness_screen to the Data folder ({DEFAULT_DATA_ROOT}).")
        sys.exit(2)
    if not p.exists():
        log(f"ERROR: data folder not found: {p}")
        sys.exit(2)
    return p


def find_session_folders(data_dir):
    return sorted(Path(dp) for dp, _, fns in os.walk(data_dir, followlinks=True) if "session.xml" in fns)


def athlete_row(conn, uuid):
    r = q(conn, "SELECT athlete_uuid, name, email, date_of_birth, gender FROM analytics.d_athletes "
                "WHERE athlete_uuid = %s", (uuid,))
    return r.iloc[0].to_dict() if len(r) else None


def history(conn):
    """Folder -> athlete links already known: readiness v2 (non-legacy) and athletic screen v2."""
    rs = " UNION ".join(f"SELECT DISTINCT source_athlete_id, session_folder, athlete_uuid, session_date, 'rs' AS src "
                        f"FROM public.f_readiness_screen_v2_{t} WHERE source_root <> 'legacy'" for t in FRAMES)
    as_ = " UNION ".join(f"SELECT DISTINCT source_athlete_id, session_folder, athlete_uuid, session_date, 'as' AS src "
                         f"FROM public.f_athletic_screen_v2_{t}" for t in ("cmj", "dj", "ppu", "slv"))
    return q(conn, f"{rs} UNION {as_}")


def resolve_athlete(conn, srow, selected_uuid, hist, dry_run):
    from common.athlete_manager import get_or_create_athlete, normalize_email, normalize_name_for_matching as nn
    from common.athlete_utils import extract_source_athlete_id
    from common.session_xml import normalize_gender

    name = srow["athlete_name"]
    names = {nn(x) for x in (name, srow.get("xml_name")) if isinstance(x, str) and x}
    if selected_uuid:
        a = athlete_row(conn, selected_uuid)
        if a is None:
            raise ValueError(f"selected ATHLETE_UUID {selected_uuid} not found")
        s = max(sim(nn(a["name"]), n) for n in names)
        known = hist[(hist.source_athlete_id == srow["athlete_folder"]) & (hist.athlete_uuid == selected_uuid)]
        if s < 0.70 and known.empty:
            raise ValueError(f"NAME_MISMATCH_ERROR: folder '{srow['athlete_folder']}' vs selected athlete "
                             f"'{a['name']}' (similarity {s:.0%})")
        if s < 0.90 and known.empty:
            log(f"NAME_MISMATCH_WARNING: folder '{srow['athlete_folder']}' vs selected athlete '{a['name']}' "
                f"(similarity {s:.0%}). Proceeding - verify this is correct.")
        return selected_uuid, "selected"
    for src, label in (("rs", "readiness_v2_history"), ("as", "screen_v2_history")):
        prior = hist[(hist.src == src) & (hist.source_athlete_id == srow["athlete_folder"])].athlete_uuid.unique()
        if len(prior) == 1:
            return prior[0], label
    if dry_run:
        return None, "would get_or_create (dry run)"
    email = srow.get("email")
    uuid, created = get_or_create_athlete(
        name=name, date_of_birth=srow.get("dob") or None,
        email=normalize_email(email) if isinstance(email, str) and email else None,
        gender=normalize_gender(srow.get("gender")),
        source_system="readiness_screen", source_athlete_id=extract_source_athlete_id(name))
    return uuid, ("created" if created else "matched")


def fill_profile(conn, uuid, srow):
    from common.athlete_manager import update_athlete_in_warehouse
    from common.session_xml import normalize_gender
    a = athlete_row(conn, uuid) or {}
    upd = {}
    if srow.get("dob") and not a.get("date_of_birth"):
        upd["date_of_birth"] = srow["dob"]
    g = normalize_gender(srow.get("gender"))
    if g and not a.get("gender"):
        upd["gender"] = g
    if upd:
        update_athlete_in_warehouse(uuid, conn=conn, **upd)
        log(f"  profile filled from session.xml: {', '.join(upd)}")
    try:
        from athleticScreen.v2.profile_emails import fill_missing_emails
        filled, review = fill_missing_emails(conn, [dict(athlete_uuid=uuid, email=srow.get("email"))])
        if filled:
            log("  profile email filled from session.xml")
        if review:
            log(f"  EMAIL_REVIEW: conflicting session email for {uuid}")
    except ImportError:
        pass


def age_fields(conn, uuid, session_date, fallback_dob):
    from common.age_utils import calculate_age_at_collection, calculate_age_group, parse_date
    a = athlete_row(conn, uuid) if conn is not None and uuid else None
    dob = (a or {}).get("date_of_birth") or fallback_dob
    if not dob:
        return None, None
    d0 = dob if hasattr(dob, "year") else parse_date(str(dob))
    d1 = datetime.strptime(str(session_date), "%Y-%m-%d").date()
    age = calculate_age_at_collection(d1, d0) if d0 else None
    if age is None or age < 0 or age > 120:
        return None, None
    return round(float(age), 2), calculate_age_group(age)


def curve_rows(df, uuid):
    out = []
    for r in df.to_dict("records"):
        p = r["_curve"]
        if not Path(p).exists():
            continue
        z = np.load(p)
        ix = lambda k: int(z[k]) if k in z and int(z[k]) >= 0 else None
        out.append(dict(athlete_uuid=uuid, session_date=r["session_date"], session_folder=r["session_folder"],
                        movement=r["movement"], trial_name=r["trial_name"], fs_hz=float(z["fs_hz"]),
                        fz_n=[round(float(x), 2) for x in z["fz_n"]],
                        bw_n=float(z["bw_n"]) if np.isfinite(z["bw_n"]) else None,
                        plate_offset_n=float(z["plate_offset_n"]), first_frame=int(z["first_frame"]),
                        takeoff_idx=ix("takeoff_idx"), landing_idx=ix("landing_idx"),
                        contact_start_idx=ix("contact_start_idx"), concentric_start_idx=ix("concentric_start_idx"),
                        movement_onset_idx=ix("movement_onset_idx"), max_idx=ix("max_idx"),
                        processor_version=PROCESSOR_VERSION))
    return pd.DataFrame(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--offline", action="store_true", help="no database access at all")
    ap.add_argument("--reprocess", action="store_true", help="re-ingest sessions already in v2")
    ap.add_argument("--session", help="ingest just this session folder")
    ap.add_argument("--no-score", action="store_true", help="skip readiness scoring")
    args, _ = ap.parse_known_args()

    data_dir = resolve_data_dir(args.session)
    selected = os.environ.get("ATHLETE_UUID", "").strip() or None
    log(f"Readiness Screen ingest v2 (processor {PROCESSOR_VERSION})" + (" [DRY RUN]" if args.dry_run else "")
        + (" [OFFLINE]" if args.offline else ""))
    log(f"Data: {data_dir}" + (f"   Selected athlete: {selected}" if selected else ""))

    conn = None
    hist = pd.DataFrame(columns=["source_athlete_id", "session_folder", "athlete_uuid", "session_date", "src"])
    if not args.offline:
        from common.athlete_manager import get_warehouse_connection
        conn = get_warehouse_connection()
        if args.dry_run:
            conn.set_session(readonly=True)
        if q(conn, "SELECT to_regclass('public.f_readiness_screen_v2_cmj') IS NULL AS missing").missing.iloc[0]:
            log("ERROR: readiness v2 tables missing - run readinessScreen/v2/load_v2.py --apply once to create them.")
            return 2
        hist = history(conn)
        if selected and athlete_row(conn, selected) is None:
            log(f"ERROR: selected athlete {selected} not found in d_athletes")
            return 1

    folders = find_session_folders(data_dir)
    is_upload = len(folders) == 1 and folders[0] == data_dir and data_dir.name.startswith("uais-")
    data_root = data_dir if not (len(folders) == 1 and folders[0] == data_dir) else data_dir.parent
    if not is_upload:
        folders = [f for f in folders if not TEST_RE.match(f.parent.name)]
    log(f"{len(folders)} session folder(s) found")

    rs_hist = hist[hist.src == "rs"]
    done = set(zip(rs_hist.source_athlete_id, rs_hist.session_folder))
    sel_name = sel_folders = None
    if selected and conn is not None:
        from common.athlete_manager import normalize_name_for_matching as nn
        sel_name = nn(athlete_row(conn, selected)["name"])
        sel_folders = set(hist[hist.athlete_uuid == selected].source_athlete_id)

    work_dir = Path(tempfile.mkdtemp(prefix="rs_v2_ingest_"))
    (work_dir / "curves").mkdir()
    sessions, skipped_done = [], []
    for f in folders:
        ath_folder = f.parent.name
        if selected and sel_name is not None and not is_upload:
            from common.athlete_manager import normalize_name_for_matching as nn
            nm, _ = athlete_from_folder(ath_folder)
            if ath_folder not in sel_folders and sim(nn(nm), sel_name) < 0.85:
                continue
        if (ath_folder, f.name) in done and not args.reprocess and not is_upload:
            skipped_done.append(f)
            continue
        srow, rows, errs = process_session(f, data_root, work_dir)
        status = str(srow.get("status", ""))
        if not status.startswith("ok"):
            if "no Readiness Screen session" not in status:
                log(f"  skip {f.relative_to(data_root) if f != data_root else f.name}: {status}")
            continue
        if is_upload:
            xml_folder = f"{srow['xml_name']}_{srow.get('athlete_id') or ''}".strip("_")
            for r in rows:
                r["athlete_folder"], r["athlete_name"], r["session_folder"] = xml_folder, srow["xml_name"], f"{srow['session_date']}_"
            srow["athlete_folder"], srow["athlete_name"] = xml_folder, srow["xml_name"]
        for r in rows:
            r["_curve"] = work_dir / "curves" / f"{srow['source_root']}__{f.parent.name}__{f.name}__{r['trial_name']}.npz"
        sessions.append((srow, rows, errs))
        log(f"  new: {f.relative_to(data_root) if f != data_root else f.name}  ({status})")

    if selected and not sessions and skipped_done and conn is not None:
        mine = [f for f in skipped_done if f.parent.name in sel_folders]
        if mine:
            from common.session_duplicate_prompt import prompt_duplicate_session
            latest = max(mine, key=lambda p: p.name)
            log(f"No new readiness sessions for this athlete; latest already ingested: {latest.relative_to(data_root)}")
            if not args.dry_run and prompt_duplicate_session(latest.name[:10]):
                srow, rows, errs = process_session(latest, data_root, work_dir)
                if str(srow.get("status", "")).startswith("ok"):
                    for r in rows:
                        r["_curve"] = work_dir / "curves" / f"{srow['source_root']}__{latest.parent.name}__{latest.name}__{r['trial_name']}.npz"
                    sessions.append((srow, rows, errs))

    if not sessions:
        log("Nothing new to ingest.")
        if conn is not None:
            conn.close()
        return 0

    from common.athlete_matcher import update_athlete_data_flag
    from common.athlete_manager import update_athlete_age_group_from_insert
    all_errors, n_rows, scored = [], {k: 0 for k in FRAMES}, []
    for srow, rows, errs in sessions:
        all_errors += [f"{e['athlete_folder']} {e['session_date']} {e['trial_name']}: {e['error']}" for e in errs]

    by_athlete = {}
    for srow, rows, errs in sessions:
        by_athlete.setdefault(srow["athlete_folder"], []).append((srow, rows))

    processed = []
    for ath_folder, items in by_athlete.items():
        srow0 = items[0][0]
        try:
            uuid, how = (None, "offline") if conn is None else resolve_athlete(conn, srow0, selected, hist, args.dry_run)
        except ValueError as e:
            log(str(e))
            all_errors.append(f"{ath_folder}: {e}")
            continue
        log(f"\nAthlete: {srow0['athlete_name']}  ->  {uuid or '(new)'}  [{how}]")
        frames = {k: [] for k in FRAMES}
        for srow, rows in items:
            for r in rows:
                r = dict(r)
                r.update(athlete_uuid=uuid or "00000000-0000-0000-0000-000000000000",
                         session_date=str(r["session_date"]), source_athlete_id=ath_folder,
                         source_system="readiness_screen_v2")
                frames["iso" if r["movement"] in ISO else r["movement"].lower()].append(r)
        try:
            write = conn is not None and uuid and not args.dry_run
            if write:
                for srow, _ in items:
                    fill_profile(conn, uuid, srow)
            dates = set()
            for k in FRAMES:
                if not frames[k]:
                    continue
                df, merged = merge_same_day(pd.DataFrame(frames[k]))
                for line in merged:
                    log(f"  merged same-day folders -> {line}")
                ages = {d: age_fields(conn, uuid, d, srow0.get("dob")) for d in df.session_date.unique()}
                df["age_at_collection"] = df.session_date.map(lambda d: ages[d][0])
                df["age_group"] = df.session_date.map(lambda d: ages[d][1])
                df["qc_flags"] = df.qc_flags.fillna("").map(lambda s: [x for x in str(s).split(";") if x])
                n_rows[k] += len(df)
                flags = sorted({x for fl in df.qc_flags for x in fl})
                desc = ", ".join(f"{m} {n}" for m, n in df.movement.value_counts().items())
                log(f"  {desc}" + (f"  QC: {', '.join(flags)}" if flags else ""))
                dates |= set(df.session_date)
                if not write:
                    continue
                table = schema.ISO_TABLE if k == "iso" else schema.TABLE.format(k)
                cols = schema.iso_columns() if k == "iso" else schema.jump_columns(k)
                mvs = sorted(df.movement.unique())
                with conn.cursor() as cur:      # replace this session's rows so dropped trials don't linger
                    for sd, sf in set(zip(df.session_date, df.session_folder)):
                        cur.execute(f"DELETE FROM {table} WHERE athlete_uuid=%s AND session_date=%s AND session_folder=%s",
                                    (uuid, sd, sf))
                        cur.execute(f"DELETE FROM {schema.CURVE_TABLE} WHERE athlete_uuid=%s AND session_date=%s "
                                    f"AND session_folder=%s AND movement = ANY(%s)", (uuid, sd, sf, mvs))
                        # a c3d session supersedes any legacy carry-over for that date
                        cur.execute(f"DELETE FROM {table} WHERE athlete_uuid=%s AND session_date=%s AND source_root='legacy'",
                                    (uuid, sd))
                upsert(conn, table, df, cols, schema.UNIQUE_KEY)
                upsert(conn, schema.CURVE_TABLE, curve_rows(df, uuid), schema.CURVE_COLS, schema.UNIQUE_KEY)
                ag = df.age_group.dropna()
                if len(ag):
                    update_athlete_age_group_from_insert(uuid, ag.iloc[-1], conn=conn)
            if write:
                update_athlete_data_flag(conn, uuid, "readiness_screen", has_data=True)
                conn.commit()
                processed.append(uuid)
                scored += [(uuid, d) for d in sorted(dates)]
                log("  committed")
        except Exception as e:
            if conn is not None:
                conn.rollback()
            log(f"  ERROR - rolled back this athlete: {type(e).__name__}: {e}")
            all_errors.append(f"{ath_folder}: {type(e).__name__}: {e}")

    if processed and conn is not None:
        try:
            from common.duplicate_detector import check_and_merge_duplicates
            check_and_merge_duplicates(conn=conn, athlete_uuids=list(set(processed)))
        except Exception as e:
            log(f"Warning: duplicate check failed: {e}")

    if scored and not args.no_score:
        from readinessScreen.scoring import compute_and_upsert_score
        for uuid, d in scored:
            try:
                compute_and_upsert_score(uuid, datetime.strptime(d, "%Y-%m-%d").date())
                log(f"Scored: {uuid} {d}")
            except Exception as e:
                log(f"Warning: scoring failed for {uuid} {d}: {e}")

    log(f"\nRows {'that would be ' if args.dry_run or conn is None else ''}written: "
        + ", ".join(f"{k.upper()} {n}" for k, n in n_rows.items()))
    for e in all_errors:
        log(f"Error: {e}")
    if processed:
        log("Successful run and upload.")
    if conn is not None:
        conn.close()
    return 1 if all_errors and not processed else 0


if __name__ == "__main__":
    sys.exit(main())
