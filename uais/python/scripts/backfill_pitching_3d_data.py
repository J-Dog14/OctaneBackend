#!/usr/bin/env python3
"""
backfill_pitching_3d_data.py

For every trial in f_pitching_trials that has no row in f_pitching_time_data,
find the -3d-data.json file and insert into all 5 current time-series tables:

    f_pitching_time_data        — scalar metadata (frame_rate, start/end time, etc.)
    f_pitching_marker_data      — per-frame marker positions  (JSONB)
    f_pitching_segment_pos_data — per-frame segment positions (JSONB)
    f_pitching_segment_rot_data — per-frame segment rotations (JSONB)
    f_pitching_force_data       — per-frame force plate data  (JSONB)

All inserts use ON CONFLICT DO UPDATE — safe to re-run.
f_pitching_force_metrics is excluded (use backfill_force_metrics.R for that).

Usage (run from the uais/ directory):
    python python/scripts/backfill_pitching_3d_data.py --dry-run
    python python/scripts/backfill_pitching_3d_data.py
    python python/scripts/backfill_pitching_3d_data.py --athlete-uuid <uuid>
    python python/scripts/backfill_pitching_3d_data.py --pitching-root "H:/Pitching/Data"
    python python/scripts/backfill_pitching_3d_data.py --limit 10

--pitching-root remaps stored session_xml_path values to a different drive root
while preserving the athlete/session sub-folder structure beneath it.
"""

import argparse
import json
import sys
from pathlib import Path

# ── project imports ──────────────────────────────────────────────────────────
_uais_root = Path(__file__).resolve().parent.parent.parent  # .../uais/
sys.path.insert(0, str(_uais_root))
from python.common.athlete_manager import get_warehouse_connection  # noqa: E402


# ── SQL ───────────────────────────────────────────────────────────────────────

FIND_MISSING = """
    SELECT
        pt.athlete_uuid,
        pt.name,
        pt.session_date,
        pt.source_system,
        pt.source_athlete_id,
        pt.owner_filename,
        pt.handedness,
        pt.trial_index,
        pt.velocity_mph,
        pt.score,
        pt.age_at_collection,
        pt.age_group,
        pt.height,
        pt.weight,
        pt.session_xml_path,
        pt.session_data_xml_path
    FROM public.f_pitching_trials pt
    LEFT JOIN public.f_pitching_time_data td
        ON  pt.athlete_uuid = td.athlete_uuid
        AND pt.session_date = td.session_date
        AND pt.trial_index  = td.trial_index
    WHERE td.id IS NULL
      AND pt.session_xml_path IS NOT NULL
      AND pt.owner_filename   IS NOT NULL
"""

UPSERT_TIME_DATA = """
    INSERT INTO public.f_pitching_time_data
        (athlete_uuid, name, session_date, source_system, source_athlete_id,
         owner_filename, handedness, trial_index, velocity_mph, score,
         age_at_collection, age_group, height, weight,
         frame_rate, start_time, end_time, uncropped_length,
         session_xml_path, session_data_xml_path)
    VALUES
        (%s, %s, %s, %s, %s,
         %s, %s, %s, %s, %s,
         %s, %s, %s, %s,
         %s, %s, %s, %s,
         %s, %s)
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        name                  = COALESCE(EXCLUDED.name,              f_pitching_time_data.name),
        owner_filename        = EXCLUDED.owner_filename,
        handedness            = COALESCE(EXCLUDED.handedness,        f_pitching_time_data.handedness),
        source_athlete_id     = COALESCE(EXCLUDED.source_athlete_id, f_pitching_time_data.source_athlete_id),
        velocity_mph          = EXCLUDED.velocity_mph,
        score                 = EXCLUDED.score,
        age_at_collection     = EXCLUDED.age_at_collection,
        age_group             = EXCLUDED.age_group,
        height                = COALESCE(EXCLUDED.height, f_pitching_time_data.height),
        weight                = COALESCE(EXCLUDED.weight, f_pitching_time_data.weight),
        frame_rate            = EXCLUDED.frame_rate,
        start_time            = EXCLUDED.start_time,
        end_time              = EXCLUDED.end_time,
        uncropped_length      = EXCLUDED.uncropped_length,
        session_xml_path      = EXCLUDED.session_xml_path,
        session_data_xml_path = EXCLUDED.session_data_xml_path,
        created_at            = NOW()
"""

UPSERT_MARKER_DATA = """
    INSERT INTO public.f_pitching_marker_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, label_names, data)
    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        label_names = EXCLUDED.label_names,
        data        = EXCLUDED.data,
        created_at  = NOW()
"""

UPSERT_SEG_POS = """
    INSERT INTO public.f_pitching_segment_pos_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, segment_names, data)
    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        segment_names = EXCLUDED.segment_names,
        data          = EXCLUDED.data,
        created_at    = NOW()
"""

UPSERT_SEG_ROT = """
    INSERT INTO public.f_pitching_segment_rot_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, segment_names, data)
    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        segment_names = EXCLUDED.segment_names,
        data          = EXCLUDED.data,
        created_at    = NOW()
"""

UPSERT_FORCE_DATA = """
    INSERT INTO public.f_pitching_force_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, data)
    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
        data       = EXCLUDED.data,
        created_at = NOW()
"""


# ── helpers ───────────────────────────────────────────────────────────────────

def build_json_path(session_xml_path: str, owner_filename: str,
                    pitching_root: Path | None = None) -> Path:
    """Construct expected -3d-data.json path for a trial.

    If pitching_root is supplied, the stored drive/root prefix is replaced
    while the athlete/session sub-folder structure is preserved.
    """
    xml_dir = Path(session_xml_path).parent
    if pitching_root is not None:
        stored_parts = xml_dir.parts
        root_parts   = pitching_root.parts
        n = len(root_parts)
        xml_dir = pitching_root / Path(*stored_parts[n:]) if len(stored_parts) > n else pitching_root
    stem = Path(owner_filename).stem
    return xml_dir / f"{stem}-3d-data.json"


def _common_params(row, cols):
    """Return common insert parameters shared across all 5 tables."""
    return (
        row[cols.index("athlete_uuid")],
        row[cols.index("session_date")],
        row[cols.index("source_system")] or "pitching",
        row[cols.index("source_athlete_id")],
        row[cols.index("owner_filename")],
        row[cols.index("trial_index")],
    )


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill pitching time-series tables from f_pitching_trials + JSON files"
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be processed; write nothing")
    parser.add_argument("--athlete-uuid",
                        help="Limit to a single athlete UUID")
    parser.add_argument("--pitching-root",
                        help="Local root of the pitching data tree (remaps stored paths)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process at most N trials (0 = all)")
    args = parser.parse_args()

    pitching_root = Path(args.pitching_root) if args.pitching_root else None

    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET client_min_messages = WARNING")

        # ── find missing trials ────────────────────────────────────────────
        query = FIND_MISSING
        params: list = []
        if args.athlete_uuid:
            query += " AND pt.athlete_uuid = %s"
            params.append(args.athlete_uuid)
        query += " ORDER BY pt.session_date DESC, pt.athlete_uuid, pt.trial_index"
        if args.limit > 0:
            query += f" LIMIT {args.limit}"

        with conn.cursor() as cur:
            cur.execute(query, params or None)
            rows = cur.fetchall()
            cols = [d.name for d in cur.description]

        n_total = len(rows)
        if n_total == 0:
            print("Nothing to do — all trials already have time-series data.")
            return 0

        print(f"Found {n_total} trial(s) missing time-series data.\n")

        if args.dry_run:
            seen: dict = {}
            for row in rows:
                key = (row[cols.index("name")] or row[cols.index("athlete_uuid")],
                       str(row[cols.index("session_date")]))
                seen[key] = seen.get(key, 0) + 1
            print("Trials to backfill by athlete / session:")
            for (name, date), count in sorted(seen.items(), key=lambda x: x[0][1], reverse=True):
                print(f"  {name}  {date}  — {count} trial(s)")
            return 0

        # ── per-trial processing ───────────────────────────────────────────
        ct_time = ct_markers = ct_seg_pos = ct_seg_rot = ct_force = 0
        n_ok = n_skip = n_err = 0

        for i, row in enumerate(rows, 1):
            fn_str       = row[cols.index("owner_filename")]
            date_val     = row[cols.index("session_date")]
            xml_path_str = row[cols.index("session_xml_path")]

            json_path = build_json_path(xml_path_str, fn_str, pitching_root)
            if not json_path.exists():
                print(f"[SKIP] {fn_str} / trial {row[cols.index('trial_index')]} — JSON not found:")
                print(f"       {json_path}")
                n_skip += 1
                continue

            try:
                jd = json.loads(json_path.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[ERR]  {fn_str} — parse error: {e}")
                n_err += 1
                continue

            frames   = jd.get("frames")   or []
            labels   = jd.get("labels")   or []
            segments = jd.get("segments") or []

            td_st = mk_st = sp_st = sr_st = fd_st = "--"

            # ── f_pitching_time_data ────────────────────────────────────────
            try:
                with conn.cursor() as cur:
                    cur.execute(UPSERT_TIME_DATA, (
                        row[cols.index("athlete_uuid")],
                        row[cols.index("name")],
                        date_val,
                        row[cols.index("source_system")] or "pitching",
                        row[cols.index("source_athlete_id")],
                        fn_str,
                        row[cols.index("handedness")] or None,
                        row[cols.index("trial_index")],
                        row[cols.index("velocity_mph")],
                        row[cols.index("score")],
                        row[cols.index("age_at_collection")],
                        row[cols.index("age_group")],
                        row[cols.index("height")],
                        row[cols.index("weight")],
                        jd.get("frameRate"),
                        jd.get("startTime"),
                        jd.get("endTime"),
                        jd.get("uncroppedLength"),
                        row[cols.index("session_xml_path")],
                        row[cols.index("session_data_xml_path")],
                    ))
                conn.commit()
                td_st = "OK"; ct_time += 1
            except Exception as e:
                conn.rollback()
                print(f"  [WARNING] time_data: {e}")
                td_st = "ERR"; n_err += 1

            if frames:
                uuid     = row[cols.index("athlete_uuid")]
                sa_id    = row[cols.index("source_athlete_id")]
                src      = row[cols.index("source_system")] or "pitching"
                trial_i  = row[cols.index("trial_index")]

                label_names = json.dumps([l["name"] for l in labels if "name" in l])
                seg_names   = json.dumps([s["name"] for s in segments if "name" in s])
                marker_json = json.dumps([f.get("markers") or [] for f in frames])
                seg_pos_json = json.dumps([f.get("segmentPos") or [] for f in frames])
                seg_rot_json = json.dumps([f.get("segmentRot") or [] for f in frames])
                force_list   = [f.get("force") or [] for f in frames]
                force_json   = json.dumps(force_list)
                has_force    = any(bool(fl) for fl in force_list)

                # ── f_pitching_marker_data ───────────────────────────────────
                try:
                    with conn.cursor() as cur:
                        cur.execute(UPSERT_MARKER_DATA,
                                    (uuid, date_val, src, sa_id, fn_str, trial_i,
                                     label_names, marker_json))
                    conn.commit()
                    mk_st = "OK"; ct_markers += 1
                except Exception as e:
                    conn.rollback()
                    print(f"  [WARNING] marker_data: {e}")
                    mk_st = "ERR"

                # ── f_pitching_segment_pos_data ──────────────────────────────
                try:
                    with conn.cursor() as cur:
                        cur.execute(UPSERT_SEG_POS,
                                    (uuid, date_val, src, sa_id, fn_str, trial_i,
                                     seg_names, seg_pos_json))
                    conn.commit()
                    sp_st = "OK"; ct_seg_pos += 1
                except Exception as e:
                    conn.rollback()
                    print(f"  [WARNING] seg_pos_data: {e}")
                    sp_st = "ERR"

                # ── f_pitching_segment_rot_data ──────────────────────────────
                try:
                    with conn.cursor() as cur:
                        cur.execute(UPSERT_SEG_ROT,
                                    (uuid, date_val, src, sa_id, fn_str, trial_i,
                                     seg_names, seg_rot_json))
                    conn.commit()
                    sr_st = "OK"; ct_seg_rot += 1
                except Exception as e:
                    conn.rollback()
                    print(f"  [WARNING] seg_rot_data: {e}")
                    sr_st = "ERR"

                # ── f_pitching_force_data (only when plates present) ─────────
                if has_force:
                    try:
                        with conn.cursor() as cur:
                            cur.execute(UPSERT_FORCE_DATA,
                                        (uuid, date_val, src, sa_id, fn_str, trial_i,
                                         force_json))
                        conn.commit()
                        fd_st = "OK"; ct_force += 1
                    except Exception as e:
                        conn.rollback()
                        print(f"  [WARNING] force_data: {e}")
                        fd_st = "ERR"

            if td_st == "OK":
                n_ok += 1

            print(f"[trial {i}/{n_total}] {fn_str}  ({date_val})")
            print(f"  time={td_st}  markers={mk_st}  seg_pos={sp_st}  seg_rot={sr_st}  force={fd_st}")
            sys.stdout.flush()

        # ── summary ────────────────────────────────────────────────────────
        print(f"\n[DONE] {n_ok}/{n_total} trials processed | "
              f"time={ct_time} markers={ct_markers} seg_pos={ct_seg_pos} "
              f"seg_rot={ct_seg_rot} force={ct_force} | "
              f"skipped={n_skip} errors={n_err}")
        return 0 if n_err == 0 else 1

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
