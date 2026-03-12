#!/usr/bin/env python3
"""
Rebuild pitching data into a new trial-level table with JSONB metrics.

Creates/uses:
  public.f_pitching_trials

Each row = one trial (owner) from session_data.xml, matched to velocity from session.xml.

Why:
  - The existing long table (f_kinematics_pitching) cannot represent multiple trials per session
    because it is unique on (athlete_uuid, session_date, metric_name, frame).
  - Storing per-trial data with JSONB keeps the schema small while preserving all metrics.

By default, this only processes sessions with Creation_date >= 2024-10-01 to keep runs small.

Usage:
  python python/scripts/rebuild_pitching_trials_jsonb.py --pitching-root "H:/Pitching/Data" --dry-run
  python python/scripts/rebuild_pitching_trials_jsonb.py --pitching-root "H:/Pitching/Data" --start-date 2024-10-01
"""

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.age_utils import calculate_age_at_collection, calculate_age_group
from python.common.path_resolution import resolve_pitching_data_path
from python.common.session_duplicate_prompt import session_exists, prompt_duplicate_session
from python.common.units import meters_to_inches, kg_to_lbs


EXCLUDED_VARIABLE_PATTERNS = [
    "Back_Foot_wrt_Lab",
    "Back_Ankle_Angle",
    "Lead_Ankle_Angle",
    "Back_Hip_Angle",
    "Glove_Elbow_Angle",
    "Glove_Shoulder_Angle",
    "Lead_Hip_Angle",
    "Back_Knee_Ang_Vel",
    "COM wrt Lead Heel_vel",
    "Combined COP wrt Lead Heel",
]


def normalize_name_for_matching(name: str) -> str:
    """LAST, FIRST or LAST, FIRST DATE -> FIRST LAST (uppercase)."""
    if not name or not isinstance(name, str):
        return ""
    s = name.strip().upper()
    s = re.sub(r"\s+\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?\s*$", "", s).strip()
    if "," in s:
        last, first = [p.strip() for p in s.split(",", 1)]
        if first and last:
            return f"{first} {last}"
    return s


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16", errors="replace")
    else:
        text = raw.decode("utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    return text


def _parse_date(s: str) -> Optional[date]:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_session_xml(path: Path) -> Optional[Tuple[str, Optional[str], date, Dict[str, float], Optional[float], Optional[float]]]:
    """
    Returns (subject_name, subject_id, session_date, velocity_map, height, weight).
    velocity_map keys include filename variants (same matching strategy as R).
    height/weight from Subject/Fields (meters, kg); None if missing.
    """
    try:
        root = ET.fromstring(_read_text_file(path))
    except Exception:
        return None

    root_tag = root.tag.split("}")[-1]
    if root_tag != "Subject":
        return None

    subject_name = None
    subject_id = None
    session_date = None
    height: Optional[float] = None
    weight: Optional[float] = None

    fields = root.find("Fields")
    if fields is not None:
        id_el = fields.find("ID")
        if id_el is not None and id_el.text:
            subject_id = id_el.text.strip()
        name_el = fields.find("Name")
        if name_el is not None and name_el.text:
            subject_name = name_el.text.strip()
        cd_el = fields.find("Creation_date")
        if cd_el is not None and cd_el.text:
            session_date = _parse_date(cd_el.text)
        h_el = fields.find("Height")
        if h_el is not None and h_el.text:
            try:
                height = float(h_el.text.strip())
            except ValueError:
                pass
        w_el = fields.find("Weight")
        if w_el is not None and w_el.text:
            try:
                weight = float(w_el.text.strip())
            except ValueError:
                pass

    if not subject_name or not session_date:
        return None

    velocity_map: Dict[str, float] = {}
    for meas in root.iter():
        if meas.tag.split("}")[-1] != "Measurement":
            continue
        meas_filename = meas.get("Filename")
        if not meas_filename:
            continue
        meas_filename = meas_filename.strip()

        v = None
        meas_fields = meas.find("Fields")
        if meas_fields is not None:
            comments = meas_fields.find("Comments")
            if comments is not None and comments.text:
                try:
                    vv = float(comments.text.strip())
                    if vv > 0:
                        v = vv
                except ValueError:
                    v = None
        if v is None:
            continue

        # Match variants (mirrors R logic)
        velocity_map[meas_filename] = v
        meas_no_ext = Path(meas_filename).stem
        velocity_map[meas_no_ext] = v
        meas_c3d = re.sub(r"\.qtm$", ".c3d", meas_filename, flags=re.IGNORECASE)
        if meas_c3d != meas_filename:
            velocity_map[meas_c3d] = v
            velocity_map[Path(meas_c3d).stem] = v

    return (subject_name, subject_id, session_date, velocity_map, height, weight)


def parse_number_series(data: str) -> List[Optional[float]]:
    """
    Parse numeric series from QTM/v3d component data.
    Handles comma and/or whitespace separated values, with possible 'NA'.
    """
    if data is None:
        return []
    s = str(data).strip()
    if not s:
        return []
    parts = re.split(r"[\s,]+", s)
    out: List[Optional[float]] = []
    for p in parts:
        if not p:
            continue
        if p.upper() in {"NA", "NAN", "NULL"}:
            out.append(None)
            continue
        try:
            out.append(float(p))
        except ValueError:
            # Some files embed non-numeric tokens; skip
            continue
    return out


def extract_owner_metrics(owner_el: ET.Element) -> Dict[str, Any]:
    """
    Extract all METRIC folder/name/component series into a flat dict:
      key = "{folder}.{metric_name}.{component}"
      value = list[float|null] (length = frames if frames attribute exists; else parsed length)
    """
    metrics: Dict[str, Any] = {}

    for type_el in owner_el.findall("./type"):
        if (type_el.get("value") or "").upper() != "METRIC":
            continue

        for folder_el in type_el.findall("./folder"):
            folder_val = folder_el.get("value") or ""
            if folder_val == "AT_EVENT":
                continue

            for name_el in folder_el.findall("./name"):
                metric_name = name_el.get("value") or ""
                if not metric_name:
                    continue

                if any(re.search(pat, metric_name, flags=re.IGNORECASE) for pat in EXCLUDED_VARIABLE_PATTERNS):
                    continue

                for comp_el in name_el.findall("./component"):
                    comp_val = comp_el.get("value") or ""
                    frames_attr = comp_el.get("frames") or ""

                    data_attr = comp_el.get("data")
                    data_text = data_attr if data_attr is not None else (comp_el.text or "")
                    values = parse_number_series(data_text)
                    if not values:
                        continue

                    frames = None
                    if frames_attr:
                        try:
                            frames = int(frames_attr)
                        except ValueError:
                            frames = None

                    if frames is not None:
                        if len(values) > frames:
                            values = values[:frames]
                        elif len(values) < frames:
                            values = values + [None] * (frames - len(values))

                    key = f"{folder_val}.{metric_name}" if folder_val else metric_name
                    if comp_val:
                        key = f"{key}.{comp_val}"
                    metrics[key] = values

    return metrics


def parse_session_data_xml(path: Path) -> Optional[List[Tuple[str, Dict[str, Any]]]]:
    """
    Returns list of (owner_filename, metrics_dict) in document order.
    """
    try:
        root = ET.fromstring(_read_text_file(path))
    except Exception:
        return None
    if root.tag.split("}")[-1] != "v3d":
        return None

    out: List[Tuple[str, Dict[str, Any]]] = []
    for owner_el in root.findall("./owner"):
        owner_name = owner_el.get("value")
        if not owner_name:
            continue
        metrics = extract_owner_metrics(owner_el)
        out.append((owner_name, metrics))
    return out


def is_static_owner(owner_filename: str) -> bool:
    """
    Filter out Static trials.
    In many exports, Static appears either as 'Static' or as a file-like name 'Static 1.c3d'.
    """
    if not owner_filename:
        return False
    s = owner_filename.strip().upper()
    return s == "STATIC" or s.startswith("STATIC ")


def match_velocity(owner_filename: str, velocity_map: Dict[str, float]) -> Optional[float]:
    """
    Match owner filename to velocity map using the same fallbacks as R:
      exact, basename, no-ext, add .qtm, add .c3d
    """
    if not owner_filename:
        return None
    owner_name = owner_filename
    owner_base = Path(owner_name).name
    owner_no_ext = Path(owner_base).stem

    if owner_name in velocity_map:
        return float(velocity_map[owner_name])
    if owner_base in velocity_map:
        return float(velocity_map[owner_base])
    if owner_no_ext in velocity_map:
        return float(velocity_map[owner_no_ext])

    owner_qtm = owner_no_ext + ".qtm"
    if owner_qtm in velocity_map:
        return float(velocity_map[owner_qtm])

    owner_c3d = owner_no_ext + ".c3d"
    if owner_c3d in velocity_map:
        return float(velocity_map[owner_c3d])

    return None


# Score = velo_part + metric_sum (no offset, no cap). Velo = 2.78 * MPH.
# Metric part = raw sum of (coefficient * variable); no scaling so elite mechanics can exceed 250 (e.g. 264). ~500 = top 1%, scores can go slightly above (e.g. 512).
VELO_MULT = 2.78
# Default weight when NULL (e.g. Dylan Wagnon) so lead_leg normalization doesn't blow up score
DEFAULT_WEIGHT_KG = 180 / 2.2046226  # 180 lbs in kg


def _get_metric_first(metrics: Dict[str, Any], metric_name: str, component: str) -> Optional[float]:
    """
    Get first numeric value for a metric from JSONB-style metrics dict.
    Keys may be 'folder.metric.component' (Python) or 'folder.metric' (R, no component). Returns None if not found.
    """
    if not metrics:
        return None
    # Prefer key with component (Python export)
    for key, vals in metrics.items():
        if not isinstance(vals, list):
            continue
        if key.endswith(f".{metric_name}.{component}") or key == f"{metric_name}.{component}":
            for v in vals:
                if v is not None and isinstance(v, (int, float)):
                    return float(v)
            return None
    # Fallback: key without component (R export: folder.variable, one component per metric)
    for key, vals in metrics.items():
        if not isinstance(vals, list):
            continue
        if key.endswith(f".{metric_name}") or key == metric_name:
            for v in vals:
                if v is not None and isinstance(v, (int, float)):
                    return float(v)
            return None
    return None


def calculate_pitching_score_from_metrics(
    metrics: Dict[str, Any], velocity_mph: Optional[float], weight_kg: Optional[float] = None
) -> Optional[float]:
    """
    Compute pitching score from metrics dict + velocity (same formula as R).
    score = velo_part + metric_sum. Velo = 2.78 * MPH. Metric sum = raw sum (no scale); elite mechanics can push metric part above 250.
    """
    def get(m: str, c: str) -> Optional[float]:
        return _get_metric_first(metrics, m, c)

    linear_pelvis_speed = get("MaxPelvisLinearVel_MPH", "Y")
    lead_leg_midpoint = get("Lead_Leg_GRF_mag_Midpoint_FS_Release", "X")
    horizontal_abduction = get("Pitching_Shoulder_Angle@Footstrike", "X")
    torso_ang_velo = get("Thorax_Ang_Vel_max", "X")
    trunk_ang_fp = get("Trunk_Angle@Footstrike", "Z")
    pelvis_ang_fp = get("Pelvis_Angle@Footstrike", "Z")
    shld_er_max = get("Pitching_Shoulder_Angle_Max", "Z")
    pelvis_ang_velo = get("Pelvis_Ang_Vel_max", "X")
    lead_knee_fp_x = get("Lead_Knee_Angle@Footstrike", "X")
    lead_knee_rel_x = get("Lead_Knee_Angle@Release", "X")
    pelvis_ang_fp_y = get("Pelvis_Angle@Footstrike", "Y")
    pelvis_ang_rel_y = get("Pelvis_Angle@Release", "Y")
    lead_knee_fp_y = get("Lead_Knee_Angle@Footstrike", "Y")
    lead_knee_rel_y = get("Lead_Knee_Angle@Release", "Y")

    front_leg_brace = (lead_knee_fp_x - lead_knee_rel_x) if (lead_knee_fp_x is not None and lead_knee_rel_x is not None) else None
    pelvis_obl = (pelvis_ang_rel_y - pelvis_ang_fp_y) if (pelvis_ang_rel_y is not None and pelvis_ang_fp_y is not None) else None
    front_leg_var_val = (lead_knee_fp_y - lead_knee_rel_y) if (lead_knee_fp_y is not None and lead_knee_rel_y is not None) else None

    # Default weight when NULL so score scaling isn't thrown off (e.g. missing athlete demographics)
    weight_kg_use = (weight_kg if weight_kg is not None and weight_kg > 0 else None) or DEFAULT_WEIGHT_KG

    if lead_leg_midpoint is not None:
        lead_leg_midpoint = abs(lead_leg_midpoint)
        # If > 10, value is raw Newtons (not BW-normalized); convert to BW multiples
        if lead_leg_midpoint > 10:
            lead_leg_midpoint = lead_leg_midpoint / (weight_kg_use * 9.81)
    if horizontal_abduction is not None:
        horizontal_abduction = abs(horizontal_abduction)
    if shld_er_max is not None:
        shld_er_max = abs(shld_er_max)

    velo_part = VELO_MULT * (velocity_mph or 0.0)
    # Per-variable coefficients: lead_leg_midpoint=18 base, then +15% on all metrics
    metric_sum_raw = (
        (0.2415 * (shld_er_max or 0)) +
        (20.7 * (lead_leg_midpoint or 0)) +
        (0.7245 * (horizontal_abduction or 0)) +
        (0.0181125 * (torso_ang_velo or 0)) -
        (0.2415 * (pelvis_ang_fp or 0)) +
        (0.422625 * (front_leg_brace or 0)) +
        (0.301875 * (trunk_ang_fp or 0)) -
        (0.2415 * (abs(front_leg_var_val) if front_leg_var_val is not None else 0)) +
        (1.2075 * (linear_pelvis_speed or 0)) -
        (0.181125 * (abs(pelvis_obl) if pelvis_obl is not None else 0)) +
        (0.0483 * (pelvis_ang_velo or 0))
    )
    metric_sum = metric_sum_raw  # no scaling; sliding scale so elite performers aren't capped
    score = velo_part + metric_sum
    if (
        linear_pelvis_speed is None and front_leg_brace is None and lead_leg_midpoint is None
        and horizontal_abduction is None and torso_ang_velo is None and pelvis_obl is None
        and trunk_ang_fp is None and pelvis_ang_fp is None and shld_er_max is None
        and front_leg_var_val is None and pelvis_ang_velo is None and velocity_mph is None
    ):
        return None
    return round(score, 4)


def ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS public.f_pitching_trials (
              id SERIAL PRIMARY KEY,
              athlete_uuid VARCHAR(36) NOT NULL,
              session_date DATE NOT NULL,
              source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
              source_athlete_id VARCHAR(100),
              owner_filename TEXT,
              trial_index INTEGER NOT NULL,
              velocity_mph NUMERIC,
              score NUMERIC,
              age_at_collection NUMERIC,
              age_group TEXT,
              height NUMERIC,
              weight NUMERIC,
              metrics JSONB NOT NULL,
              session_xml_path TEXT,
              session_data_xml_path TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CONSTRAINT f_pitching_trials_athlete_uuid_fkey
                FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE
            );
            """
        )
        # Add columns if table already existed without them
        for col, typ in (
            ("age_at_collection", "NUMERIC"),
            ("age_group", "TEXT"),
            ("height", "NUMERIC"),
            ("weight", "NUMERIC"),
        ):
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'f_pitching_trials' AND column_name = %s
                """,
                (col,),
            )
            if cur.fetchone() is None:
                cur.execute(f"ALTER TABLE public.f_pitching_trials ADD COLUMN {col} {typ}")
        # Ensure d_athletes has new pitching trial columns
        for col, typ in (("has_pitching_trial_data", "BOOLEAN DEFAULT FALSE"), ("pitching_trial_count", "INTEGER DEFAULT 0")):
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'analytics' AND table_name = 'd_athletes' AND column_name = %s
                """,
                (col,),
            )
            if cur.fetchone() is None:
                cur.execute(f"ALTER TABLE analytics.d_athletes ADD COLUMN {col} {typ}")
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_f_pitching_trials_unique
              ON public.f_pitching_trials(athlete_uuid, session_date, trial_index);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_f_pitching_trials_owner
              ON public.f_pitching_trials(owner_filename);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_f_pitching_trials_date
              ON public.f_pitching_trials(session_date);
            """
        )
    conn.commit()


def find_session_folders(pitching_root: Path) -> List[Tuple[Path, Path]]:
    """
    Return list of (session_xml_path, session_data_xml_path) pairs.
    Assumes both files exist in the same folder.
    """
    pairs: List[Tuple[Path, Path]] = []
    for sx in pitching_root.rglob("session.xml"):
        sdx = sx.parent / "session_data.xml"
        if sdx.exists():
            pairs.append((sx, sdx))
    return pairs


def load_athlete_lookup(conn) -> Tuple[Dict[str, str], Dict[str, Optional[date]]]:
    """Returns (normalized_name -> athlete_uuid, athlete_uuid -> date_of_birth)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT athlete_uuid, name, normalized_name, date_of_birth FROM analytics.d_athletes"
        )
        rows = cur.fetchall()
    name_to_uuid: Dict[str, str] = {}
    uuid_to_dob: Dict[str, Optional[date]] = {}
    for athlete_uuid, name, normalized_name, date_of_birth in rows:
        key = (normalized_name or "").strip().upper()
        if not key and name:
            key = normalize_name_for_matching(name)
        if key and key not in name_to_uuid:
            name_to_uuid[key] = athlete_uuid
        if date_of_birth is not None:
            uuid_to_dob[athlete_uuid] = date_of_birth.date() if hasattr(date_of_birth, "date") else date_of_birth
        else:
            uuid_to_dob[athlete_uuid] = None
    return (name_to_uuid, uuid_to_dob)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild pitching trials into JSONB table")
    parser.add_argument(
        "--pitching-root",
        type=str,
        default=os.environ.get("PITCHING_DATA_DIR", "H:/Pitching/Data"),
        help="Root directory containing pitching session folders",
    )
    parser.add_argument("--start-date", type=str, default="2024-10-01", help="Include sessions on/after this date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, default="", help="Optional end date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to DB")
    parser.add_argument("--max-sessions", type=int, default=0, help="Optional cap for debugging (0 = no cap)")
    parser.add_argument("--backfill-scores", action="store_true", help="Only update score from existing metrics + velocity_mph (no file scan)")
    parser.add_argument("--backfill-height-weight", action="store_true", help="Only update height/weight from analytics.d_athletes (no file scan)")
    parser.add_argument("--athlete-name", type=str, default="", help="Process only this athlete (resolve path from name; New Athlete flow)")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    try:
        ensure_table(conn)

        if args.backfill_scores:
            # Update score for existing rows from metrics JSONB + velocity_mph + weight (for lead_leg_midpoint normalization)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, metrics, velocity_mph, weight FROM public.f_pitching_trials WHERE metrics IS NOT NULL AND jsonb_typeof(metrics) = 'object'"
                )
                rows = cur.fetchall()
            updated = 0
            for row in rows:
                row_id, metrics_json, velocity_mph, weight = row[0], row[1], row[2], row[3]
                metrics = json.loads(metrics_json) if isinstance(metrics_json, str) else metrics_json
                if not isinstance(metrics, dict):
                    continue
                v = float(velocity_mph) if velocity_mph is not None else None
                weight_kg = float(weight) if weight is not None else None
                score = calculate_pitching_score_from_metrics(metrics, v, weight_kg)
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE public.f_pitching_trials SET score = %s WHERE id = %s",
                        (score, row_id),
                    )
                updated += 1
            if not args.dry_run:
                conn.commit()
            print(f"Backfill scores: updated {updated} row(s)")
            return 0

        if args.backfill_height_weight:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.f_pitching_trials t
                    SET height = a.height, weight = a.weight
                    FROM analytics.d_athletes a
                    WHERE t.athlete_uuid = a.athlete_uuid
                      AND (a.height IS NOT NULL OR a.weight IS NOT NULL)
                    """
                )
                updated = cur.rowcount
            if not args.dry_run:
                conn.commit()
            print(f"Backfill height/weight: updated {updated} row(s) from analytics.d_athletes")
            return 0

        pitching_root = Path(args.pitching_root)
        if not pitching_root.is_dir():
            print(f"Pitching root not found: {pitching_root}")
            return 1

        start_date = _parse_date(args.start_date.replace("-", "/")) if "-" in args.start_date else _parse_date(args.start_date)
        if start_date is None:
            start_date = date(2024, 10, 1)
        end_date = None
        if args.end_date:
            end_date = _parse_date(args.end_date.replace("-", "/")) if "-" in args.end_date else _parse_date(args.end_date)

        athlete_lookup, uuid_to_dob = load_athlete_lookup(conn)

        pairs = find_session_folders(pitching_root)
        if getattr(args, "athlete_name", None) and args.athlete_name.strip():
            resolved = resolve_pitching_data_path(pitching_root, args.athlete_name.strip())
            if resolved:
                pairs = [(sx, sdx) for sx, sdx in pairs if sx.parent == resolved]
            else:
                pairs = []
        if args.max_sessions and args.max_sessions > 0:
            pairs = pairs[: args.max_sessions]

        # Stats (for actionable output)
        total_pairs = len(pairs)
        sessions_total_with_dates = 0
        sessions_in_range = 0
        sessions_loaded = 0
        sessions_no_owners = 0
        sessions_xml_parse_failed = 0
        sessions_data_parse_failed = 0
        sessions_skipped_by_date = 0
        sessions_skipped_by_end_date = 0
        sessions_unmatched_athlete = 0

        trials_total = 0
        trials_with_velocity = 0
        trials_missing_velocity = 0

        unmatched_examples: List[Tuple[str, str, str]] = []  # (norm_name, session_date, session_xml_path)

        for session_xml_path, session_data_xml_path in pairs:
            parsed_sx = parse_session_xml(session_xml_path)
            if parsed_sx is None:
                sessions_xml_parse_failed += 1
                continue
            subject_name, subject_id, session_date, velocity_map, session_height, session_weight = parsed_sx
            # Session XML height/weight are meters and kg; convert to inches and lbs for storage
            height_in = meters_to_inches(session_height)
            weight_lb = kg_to_lbs(session_weight)
            sessions_total_with_dates += 1

            if session_date < start_date:
                sessions_skipped_by_date += 1
                continue
            if end_date is not None and session_date > end_date:
                sessions_skipped_by_end_date += 1
                continue
            sessions_in_range += 1

            norm_name = normalize_name_for_matching(subject_name)
            athlete_uuid = athlete_lookup.get(norm_name)
            if not athlete_uuid:
                sessions_unmatched_athlete += 1
                if len(unmatched_examples) < 25:
                    unmatched_examples.append((norm_name, session_date.isoformat(), str(session_xml_path)))
                continue

            owners = parse_session_data_xml(session_data_xml_path)
            if owners is None:
                sessions_data_parse_failed += 1
                continue
            if not owners:
                sessions_no_owners += 1
                continue
            sessions_loaded += 1

            # Safeguard 4 (Existing Athlete): prompt before overwriting existing session
            athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
            if athlete_uuid_env and athlete_uuid == athlete_uuid_env:
                if session_exists(conn, "f_pitching_trials", athlete_uuid, session_date.isoformat()[:10]):
                    if not prompt_duplicate_session(session_date.isoformat()[:10]):
                        continue

            # Insert each owner (trial) in document order, using trial_index
            for trial_index, (owner_filename, metrics) in enumerate(owners):
                if is_static_owner(owner_filename):
                    # Skip Static trials entirely
                    continue
                v = match_velocity(owner_filename, velocity_map)
                trials_total += 1
                if v is None:
                    trials_missing_velocity += 1
                else:
                    trials_with_velocity += 1

                dob = uuid_to_dob.get(athlete_uuid)
                age_at_collection = calculate_age_at_collection(session_date, dob)
                age_group = calculate_age_group(age_at_collection) if age_at_collection is not None else None

                # Score formula expects weight in kg
                score = calculate_pitching_score_from_metrics(metrics, v, session_weight)
                row = {
                    "athlete_uuid": athlete_uuid,
                    "session_date": session_date.isoformat(),
                    "source_system": "pitching",
                    # Usually comes from session.xml Fields/ID (often short like "SM")
                    "source_athlete_id": subject_id,
                    "owner_filename": owner_filename,
                    "trial_index": trial_index,
                    "velocity_mph": v,
                    "score": score,
                    "age_at_collection": float(age_at_collection) if age_at_collection is not None else None,
                    "age_group": age_group,
                    "height": height_in,
                    "weight": weight_lb,
                    "metrics": metrics,
                    "session_xml_path": str(session_xml_path),
                    "session_data_xml_path": str(session_data_xml_path),
                }

                if args.dry_run:
                    if trials_total <= 3:
                        print(
                            f"[DRY RUN] {row['session_date']} {norm_name} trial={trial_index} "
                            f"owner={owner_filename} velo={v} metrics_keys={len(metrics)}"
                        )
                    continue

                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.f_pitching_trials
                          (athlete_uuid, session_date, source_system, source_athlete_id,
                           owner_filename, trial_index, velocity_mph, score, age_at_collection, age_group,
                           height, weight, metrics, session_xml_path, session_data_xml_path)
                        VALUES
                          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                        ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE
                          SET owner_filename = EXCLUDED.owner_filename,
                              source_athlete_id = COALESCE(EXCLUDED.source_athlete_id, f_pitching_trials.source_athlete_id),
                              velocity_mph = EXCLUDED.velocity_mph,
                              score = EXCLUDED.score,
                              age_at_collection = EXCLUDED.age_at_collection,
                              age_group = EXCLUDED.age_group,
                              height = COALESCE(EXCLUDED.height, f_pitching_trials.height),
                              weight = COALESCE(EXCLUDED.weight, f_pitching_trials.weight),
                              metrics = EXCLUDED.metrics,
                              session_xml_path = EXCLUDED.session_xml_path,
                              session_data_xml_path = EXCLUDED.session_data_xml_path,
                              created_at = NOW()
                        """,
                        (
                            row["athlete_uuid"],
                            row["session_date"],
                            row["source_system"],
                            row["source_athlete_id"],
                            row["owner_filename"],
                            row["trial_index"],
                            row["velocity_mph"],
                            row["score"],
                            row["age_at_collection"],
                            row["age_group"],
                            row["height"],
                            row["weight"],
                            json.dumps(row["metrics"]),
                            row["session_xml_path"],
                            row["session_data_xml_path"],
                        ),
                    )

        if not args.dry_run:
            conn.commit()
            # Sync d_athletes: has_pitching_trial_data and pitching_trial_count from f_pitching_trials
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE analytics.d_athletes a
                    SET
                        has_pitching_trial_data = EXISTS (
                            SELECT 1 FROM public.f_pitching_trials t WHERE t.athlete_uuid = a.athlete_uuid
                        ),
                        pitching_trial_count = (
                            SELECT COUNT(DISTINCT t.session_date)::INTEGER FROM public.f_pitching_trials t WHERE t.athlete_uuid = a.athlete_uuid
                        ),
                        updated_at = NOW()
                    """
                )
            conn.commit()

        # Actionable summary
        mode = "DRY RUN (no DB writes)" if args.dry_run else "WRITE MODE (DB updated)"
        print("")
        print("=== Pitching trials rebuild summary ===")
        print(f"Mode: {mode}")
        print(f"Root: {pitching_root}")
        print(f"Session folders found (session.xml + session_data.xml): {total_pairs}")
        print(f"Session.xml parsed (has name+date): {sessions_total_with_dates}")
        print(f"Sessions in date range: {sessions_in_range} (start={start_date.isoformat()}" + (f", end={end_date.isoformat()})" if end_date else ")"))
        print(f"Sessions loaded (matched athlete + parsed owners): {sessions_loaded}")
        print(f"Trials processed: {trials_total}")
        if trials_total:
            pct = (trials_with_velocity / trials_total) * 100.0
            print(f"Velocity matched: {trials_with_velocity}/{trials_total} ({pct:.1f}%)")
        print("")
        print("Skipped / issues:")
        print(f"- session.xml parse failed: {sessions_xml_parse_failed}")
        print(f"- session_data.xml parse failed: {sessions_data_parse_failed}")
        print(f"- no owners in session_data.xml: {sessions_no_owners}")
        print(f"- skipped by start-date: {sessions_skipped_by_date}")
        print(f"- skipped by end-date: {sessions_skipped_by_end_date}")
        print(f"- unmatched athlete name->uuid: {sessions_unmatched_athlete}")
        if unmatched_examples:
            print("")
            print("First unmatched athlete examples (normalized name, session_date, session.xml):")
            for norm_name, sdate, p in unmatched_examples[:10]:
                print(f"- {norm_name} | {sdate} | {p}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

