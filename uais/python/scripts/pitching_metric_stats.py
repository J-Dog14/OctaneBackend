#!/usr/bin/env python3
"""
Compute min, avg, max (and count) for each pitching score variable across all trials.
Uses same extraction as score equation (lead_leg_midpoint BW-normalized when > 10 N).
Ignores NULLs.

Usage: python python/scripts/pitching_metric_stats.py
"""

import json
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.scripts.rebuild_pitching_trials_jsonb import (
    DEFAULT_WEIGHT_KG,
    _get_metric_first,
)
from python.common.athlete_manager import get_warehouse_connection


def extract_variables_for_trial(metrics, weight_kg):
    """Extract all 11 variables for one trial (same logic as score equation). Returns dict of name -> value or None."""
    if not metrics or not isinstance(metrics, dict):
        return {}
    weight_kg_use = (weight_kg if weight_kg is not None and weight_kg > 0 else None) or DEFAULT_WEIGHT_KG

    def get(m, c):
        return _get_metric_first(metrics, m, c)

    linear_pelvis_speed = get("MaxPelvisLinearVel_MPH", "Y")
    lead_leg_midpoint = get("Lead_Leg_GRF_mag_Midpoint_FS_Release", "X")
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

    if lead_leg_midpoint is not None:
        lead_leg_midpoint = abs(lead_leg_midpoint)
        if lead_leg_midpoint > 10:
            lead_leg_midpoint = lead_leg_midpoint / (weight_kg_use * 9.81)
    if horizontal_abduction is not None:
        horizontal_abduction = abs(horizontal_abduction)
    if shld_er_max is not None:
        shld_er_max = abs(shld_er_max)

    return {
        "shld_er_max": shld_er_max,
        "lead_leg_midpoint": lead_leg_midpoint,
        "horizontal_abduction": horizontal_abduction,
        "torso_ang_velo": torso_ang_velo,
        "pelvis_ang_fp": pelvis_ang_fp,
        "front_leg_brace": front_leg_brace,
        "trunk_ang_fp": trunk_ang_fp,
        "front_leg_var_val": front_leg_var_val,
        "linear_pelvis_speed": linear_pelvis_speed,
        "pelvis_obl": pelvis_obl,
        "pelvis_ang_velo": pelvis_ang_velo,
    }


def main():
    conn = get_warehouse_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, metrics, weight
            FROM public.f_pitching_trials
            WHERE metrics IS NOT NULL AND jsonb_typeof(metrics) = 'object'
            """
        )
        rows = cur.fetchall()
    conn.close()

    # Collect values per variable (ignore NULLs)
    var_names = [
        "shld_er_max", "lead_leg_midpoint", "horizontal_abduction", "torso_ang_velo",
        "pelvis_ang_fp", "front_leg_brace", "trunk_ang_fp", "front_leg_var_val",
        "linear_pelvis_speed", "pelvis_obl", "pelvis_ang_velo",
    ]
    by_var = {name: [] for name in var_names}
    for row in rows:
        trial_id, metrics, weight = row[0], row[1], float(row[2]) if row[2] is not None else None
        if isinstance(metrics, str):
            metrics = json.loads(metrics) if metrics else {}
        vals = extract_variables_for_trial(metrics, weight)
        for name, v in vals.items():
            if v is not None:
                by_var[name].append(v)

    print(f"Trials with metrics: {len(rows)}")
    print()
    print(f"{'Variable':<22} {'Count':>6} {'Min':>10} {'Avg':>10} {'Max':>10}")
    print("-" * 62)
    for name in var_names:
        arr = by_var[name]
        if not arr:
            print(f"{name:<22} {0:>6} {'N/A':>10} {'N/A':>10} {'N/A':>10}")
            continue
        mn, mx = min(arr), max(arr)
        avg = sum(arr) / len(arr)
        print(f"{name:<22} {len(arr):>6} {mn:>10.4f} {avg:>10.4f} {mx:>10.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
