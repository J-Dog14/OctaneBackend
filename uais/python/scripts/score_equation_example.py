#!/usr/bin/env python3
"""
Print the pitching score equation step-by-step using real data from one trial in the DB.

Usage:
  python python/scripts/score_equation_example.py
  python python/scripts/score_equation_example.py --athlete "Dylan Wagnon"
  python python/scripts/score_equation_example.py --trial-id 123
"""

import argparse
import json
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.scripts.rebuild_pitching_trials_jsonb import (
    DEFAULT_WEIGHT_KG,
    VELO_MULT,
    _get_metric_first,
    calculate_pitching_score_from_metrics,
)
from python.common.athlete_manager import get_warehouse_connection


def get_one_trial(conn, athlete_name=None, trial_id=None):
    """Fetch one row from f_pitching_trials (by athlete name or trial id)."""
    with conn.cursor() as cur:
        if trial_id is not None:
            cur.execute(
                """
                SELECT t.id, t.athlete_uuid, t.session_date, t.owner_filename, t.velocity_mph, t.score, t.weight, t.metrics,
                       a.name AS athlete_name
                FROM public.f_pitching_trials t
                JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                WHERE t.id = %s
                """,
                (trial_id,),
            )
        elif athlete_name:
            cur.execute(
                """
                SELECT t.id, t.athlete_uuid, t.session_date, t.owner_filename, t.velocity_mph, t.score, t.weight, t.metrics,
                       a.name AS athlete_name
                FROM public.f_pitching_trials t
                JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                WHERE a.name ILIKE %s
                ORDER BY t.session_date DESC, t.trial_index
                LIMIT 1
                """,
                (f"%{athlete_name}%",),
            )
        else:
            cur.execute(
                """
                SELECT t.id, t.athlete_uuid, t.session_date, t.owner_filename, t.velocity_mph, t.score, t.weight, t.metrics,
                       a.name AS athlete_name
                FROM public.f_pitching_trials t
                JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                WHERE t.metrics IS NOT NULL AND jsonb_typeof(t.metrics) = 'object'
                ORDER BY t.score DESC NULLS LAST
                LIMIT 1
                """
            )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "athlete_uuid": row[1],
        "session_date": row[2],
        "owner_filename": row[3],
        "velocity_mph": float(row[4]) if row[4] is not None else None,
        "score_stored": float(row[5]) if row[5] is not None else None,
        "weight": float(row[6]) if row[6] is not None else None,
        "metrics": row[7] if isinstance(row[7], dict) else json.loads(row[7]) if row[7] else {},
        "athlete_name": row[8],
    }


def first_val(metrics, name, comp):
    v = _get_metric_first(metrics, name, comp)
    return v if v is not None else "—"


def main():
    parser = argparse.ArgumentParser(description="Print score equation with real trial data")
    parser.add_argument("--athlete", type=str, help="Filter by athlete name (partial match)")
    parser.add_argument("--trial-id", type=int, help="Use specific trial id")
    args = parser.parse_args()

    conn = get_warehouse_connection()
    trial = get_one_trial(conn, athlete_name=args.athlete, trial_id=args.trial_id)
    conn.close()

    if not trial or not trial["metrics"]:
        print("No trial found with metrics.")
        if args.athlete:
            print(f"  (athlete filter: {args.athlete})")
        return 1

    metrics = trial["metrics"]
    velocity_mph = trial["velocity_mph"]
    weight_kg = trial["weight"]
    weight_kg_use = (weight_kg if weight_kg is not None and weight_kg > 0 else None) or DEFAULT_WEIGHT_KG

    def get(m, c):
        return _get_metric_first(metrics, m, c)

    # Extract raw values
    linear_pelvis_speed = get("MaxPelvisLinearVel_MPH", "Y")
    lead_leg_midpoint_raw = get("Lead_Leg_GRF_mag_Midpoint_FS_Release", "X")
    horizontal_abduction = get("Pitching_Shoulder_Angle@Footstrike", "X")
    torso_ang_velo = get("Thorax_Ang_Vel_max", "X")
    trunk_ang_fp = get("Trunk_Angle@Footstrike", "Z")
    pelvis_ang_fp = get("Pelvis_Angle@Footstrike", "Z")
    shld_er_max = get("Pitching_Shoulder_Angle_Max", "Z")
    pelvis_ang_velo = get("Pelvis_Ang_Vel_max", "X")
    lk_fs_x = get("Lead_Knee_Angle@Footstrike", "X")
    lk_rel_x = get("Lead_Knee_Angle@Release", "X")
    pelvis_fs_y = get("Pelvis_Angle@Footstrike", "Y")
    pelvis_rel_y = get("Pelvis_Angle@Release", "Y")
    lk_fs_y = get("Lead_Knee_Angle@Footstrike", "Y")
    lk_rel_y = get("Lead_Knee_Angle@Release", "Y")

    front_leg_brace = (lk_fs_x - lk_rel_x) if (lk_fs_x is not None and lk_rel_x is not None) else None
    pelvis_obl = (pelvis_rel_y - pelvis_fs_y) if (pelvis_rel_y is not None and pelvis_fs_y is not None) else None
    front_leg_var_val = (lk_fs_y - lk_rel_y) if (lk_fs_y is not None and lk_rel_y is not None) else None

    lead_leg_midpoint = lead_leg_midpoint_raw
    if lead_leg_midpoint is not None:
        lead_leg_midpoint = abs(lead_leg_midpoint)
        if lead_leg_midpoint > 10:
            lead_leg_midpoint = lead_leg_midpoint / (weight_kg_use * 9.81)
    if horizontal_abduction is not None:
        horizontal_abduction = abs(horizontal_abduction)
    if shld_er_max is not None:
        shld_er_max = abs(shld_er_max)
    # pelvis_obl and front_leg_var_val: closer to zero better, so we use abs and subtract
    pelvis_obl_abs = abs(pelvis_obl) if pelvis_obl is not None else 0
    front_leg_var_val_abs = abs(front_leg_var_val) if front_leg_var_val is not None else 0

    # Per-variable contributions: lead_leg_midpoint=18 base, then +15% on all metrics
    metric_sum_raw = (
        (0.2415 * (shld_er_max or 0)) +
        (20.7 * (lead_leg_midpoint or 0)) +
        (0.7245 * (horizontal_abduction or 0)) +
        (0.0181125 * (torso_ang_velo or 0)) -
        (0.2415 * (pelvis_ang_fp or 0)) +
        (0.422625 * (front_leg_brace or 0)) +
        (0.301875 * (trunk_ang_fp or 0)) -
        (0.2415 * front_leg_var_val_abs) +
        (1.2075 * (linear_pelvis_speed or 0)) -
        (0.181125 * pelvis_obl_abs) +
        (0.0483 * (pelvis_ang_velo or 0))
    )
    metric_sum = metric_sum_raw  # no scaling; sliding scale
    velo_part = VELO_MULT * (velocity_mph or 0)
    score_computed = velo_part + metric_sum

    # Print
    print("=" * 60)
    print("PITCHING SCORE EQUATION - worked example (one trial)")
    print("=" * 60)
    print(f"Athlete: {trial['athlete_name']}")
    print(f"Trial id: {trial['id']}  session_date: {trial['session_date']}  owner: {trial['owner_filename']}")
    print(f"velocity_mph: {trial['velocity_mph']}  weight (kg): {trial['weight']} (used: {weight_kg_use:.2f})")
    print()
    print("Step 0 - Lead leg midpoint (BW normalize if > 10 N)")
    print(f"  lead_leg_midpoint (raw): {lead_leg_midpoint_raw}")
    if lead_leg_midpoint_raw is not None and abs(lead_leg_midpoint_raw) > 10:
        print(f"  -> |raw| / (weight_kg_use * 9.81) = {abs(lead_leg_midpoint_raw):.2f} / {weight_kg_use * 9.81:.2f} = {lead_leg_midpoint:.4f}")
    else:
        print(f"  -> used as-is (after abs): {lead_leg_midpoint}")
    print()
    print("Step 1 - Per-variable contributions (each var * its coefficient)")
    print(f"  metric_sum_raw = 0.2415*shld_er_max + 20.7*lead_leg_midpoint + 0.7245*horizontal_abduction")
    print(f"    + 0.0181125*torso_ang_velo - 0.2415*pelvis_ang_fp + 0.422625*front_leg_brace + 0.301875*trunk_ang_fp")
    print(f"    - 0.2415*|front_leg_var_val| + 1.2075*linear_pelvis_speed - 0.181125*|pelvis_obl| + 0.0483*pelvis_ang_velo")
    print(f"     = {metric_sum_raw:.4f}")
    print(f"  metric_sum = metric_sum_raw (no scaling; sliding scale) = {metric_sum:.4f}")
    print()
    print("Step 2 - Score (no offset, no cap)")
    print(f"  velo_part = {VELO_MULT} * velocity_mph = {VELO_MULT} * {velocity_mph or 0} = {velo_part:.4f}")
    print(f"  score = velo_part + metric_sum = {velo_part:.4f} + {metric_sum:.4f} = {score_computed:.4f}")
    print()
    print(f"  Score in DB for this trial: {trial['score_stored']}")
    print(f"  Score recomputed here:      {score_computed:.4f}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
