# Score Calculation Variable Mapping

This document maps the equation variables to the actual database variable names for validation.

## Score scale (~500 = “top 1%”, no cap)

- **Velocity**: contributes `2.78 x velocity_mph`.
- **Metrics**: raw sum of (coefficient x variable) for each metric; **no scaling**. Coefficients reflect tier priority. Elite mechanics can push the metric part above 250 (e.g. 264); we do not retract points.
- **Score**: `score = velo_part + metric_sum` (no offset, no cap). Only ~1% hit 500, but scores can go slightly above (e.g. 512) if someone is exceptional; not likely to see 550.
- **lead_leg_midpoint**: if value **> 10** (raw Newtons), divide by `(bodyweight_kg x 9.81)` before scoring.
- **Weight NULL**: use **180 lbs** (as kg) so lead_leg normalization and score scaling aren't thrown off.

## Full equation (algebraic)

**0. Weight and lead_leg_midpoint normalization**

- `weight_kg_use = weight_kg` if present and > 0, else `180 / 2.2046226` (180 lbs in kg).
- If `lead_leg_midpoint > 10` (raw Newtons): `lead_leg_midpoint := lead_leg_midpoint / (weight_kg_use × 9.81)`.
- Then take absolute value: `lead_leg_midpoint := |lead_leg_midpoint|`, and same for `horizontal_abduction`, `shld_er_max`.

**1. Metric sum (first value from each metric; per-variable coefficients, no scaling)**

- `metric_sum = 0.2415*shld_er_max + 20.7*lead_leg_midpoint + 0.7245*horizontal_abduction + 0.0181125*torso_ang_velo - 0.2415*pelvis_ang_fp + 0.422625*front_leg_brace + 0.301875*trunk_ang_fp - 0.2415*|front_leg_var_val| + 1.2075*linear_pelvis_speed - 0.181125*|pelvis_obl| + 0.0483*pelvis_ang_velo` (lead_leg_midpoint base 18, then +15% on all metrics)

(Calculated: `front_leg_brace = Lead_Knee@Footstrike_X - Lead_Knee@Release_X`, `pelvis_obl = Pelvis_Angle@Release_Y - Pelvis_Angle@Footstrike_Y`, `front_leg_var_val = Lead_Knee@Footstrike_Y - Lead_Knee@Release_Y`.)

**2. Final score (no offset, no cap)**

- `velo_part = 2.78 * velocity_mph`
- **`score = velo_part + metric_sum`**

To see a worked example with real data from your DB, run:
`python python/scripts/score_equation_example.py`  
(or pass `--athlete "Dylan Wagnon"` / `--trial-id 123` to pick a specific trial).

To recompute min/avg/max per variable (with lead_leg_midpoint BW-normalized), run:
`python python/scripts/pitching_metric_stats.py`

## Equation Variables and Proposed Database Mappings

### 1. `linear_pelvis_speed` (1.2075 * value)
- **Database Variable**: `MaxPelvisLinearVel_MPH` 
- **Component**: Y
- **Notes**: From notebook line 268-269

### 2. `front_leg_brace` (0.422625 * value)
- **Calculation**: `Lead_Knee_Angle@Footstrike` (X component) - `Lead_Knee_Angle@Release` (X component)
- **Database Variables Needed**:
  - `Lead_Knee_Angle@Footstrike` (X)
  - `Lead_Knee_Angle@Release` (X)
- **Notes**: From notebook line 296 - calculated difference

### 3. `lead_leg_midpoint` (20.7 * value, after BW normalization if needed)
- **Database Variable**: `Lead_Leg_GRF_mag_Midpoint_FS_Release`
- **Component**: X
- **Notes**: Base coefficient 18, then +15% on all metrics. If value **> 10** (raw Newtons), divide by `(bodyweight_kg x 9.81)` before applying.

### 4. `horizontal_abduction` (0.7245 * value)
- **Database Variable**: `Pitching_Shoulder_Angle@Footstrike`
- **Component**: X
- **Notes**: From notebook line 325-327, uses absolute value

### 5. `torso_ang_velo` (0.0181125 * value)
- **Database Variable**: `Thorax_Ang_Vel_max`
- **Component**: X
- **Notes**: From notebook line 340

### 6. `pelvis_obl` (-0.181125 * |value|)
- **Calculation**: `Pelvis_Angle@Release` (Y component) - `Pelvis_Angle@Footstrike` (Y component); use **abs** and **subtract** (closer to zero better)
- **Database Variables Needed**:
  - `Pelvis_Angle@Footstrike` (Y)
  - `Pelvis_Angle@Release` (Y)
- **Notes**: From notebook line 305-312 - calculated difference; subtracted so smaller magnitude = higher score

### 7. `trunk_ang_fp` (0.301875 * value)
- **Database Variable**: `Trunk_Angle@Footstrike`
- **Component**: Z
- **Notes**: From notebook line 284-285, "fp" = Footstrike/Foot_Contact

### 8. `pelvis_ang_fp` (-0.2415 * value)
- **Database Variable**: `Pelvis_Angle@Footstrike`
- **Component**: Z
- **Notes**: Less is better; subtracted. Softer penalty so 80 not over-penalized; elite ~30. Avg in data ~46.

### 9. `shld_er_max` (0.2415 * value)
- **Database Variable**: `Pitching_Shoulder_Angle_Max`
- **Component**: Z
- **Notes**: From notebook line 331-332, uses absolute value; tier 1

### 10. `front_leg_var_val` (-0.2415 * |value|)
- **Calculation**: `Lead_Knee_Angle@Footstrike` (Y component) - `Lead_Knee_Angle@Release` (Y component); use **abs** and **subtract** (closer to zero better)
- **Database Variables Needed**:
  - `Lead_Knee_Angle@Footstrike` (Y)
  - `Lead_Knee_Angle@Release` (Y)
- **Notes**: From notebook line 303-304 - calculated difference; subtracted so smaller magnitude = higher score

### 11. `pelvis_ang_velo` (0.0483 * value)
- **Database Variable**: `Pelvis_Ang_Vel_max`
- **Component**: X
- **Notes**: From notebook line 337-338

### 12. `velocity_mph` (2.78 * value)
- **Already Extracted**: `velocity_mph` column
- **Source**: From `session.xml` Comments field
- **Notes**: 2.78× velocity; score = velo_part + metric_sum, ~500 = top 1%, can go slightly above (e.g. 512)

## Summary of Database Variable Names Needed

### Direct Variables (single metric_name lookup):
1. `MaxPelvisLinearVel_MPH` (Y component)
2. `Lead_Leg_GRF_mag_Midpoint_FS_Release` (X component, abs)
3. `Pitching_Shoulder_Angle@Footstrike` (X component, abs)
4. `Thorax_Ang_Vel_max` (X component)
5. `Trunk_Angle@Footstrike` (Z component)
6. `Pelvis_Angle@Footstrike` (Z component)
7. `Pitching_Shoulder_Angle_Max` (Z component, abs)
8. `Pelvis_Ang_Vel_max` (X component)

### Calculated Variables (need multiple metric_name lookups):
1. `front_leg_brace` = `Lead_Knee_Angle@Footstrike` (X) - `Lead_Knee_Angle@Release` (X)
2. `pelvis_obl` = `Pelvis_Angle@Release` (Y) - `Pelvis_Angle@Footstrike` (Y)
3. `front_leg_var_val` = `Lead_Knee_Angle@Footstrike` (Y) - `Lead_Knee_Angle@Release` (Y)

## Questions for Validation:

1. Are the variable names correct? (e.g., `MaxPelvisLinearVel_MPH`, `Lead_Knee_Angle@Footstrike`, etc.)
2. Are the component selections correct? (X, Y, Z)
3. For calculated variables, are the formulas correct?
4. Should we use absolute values for any other variables besides the ones noted?
5. What folder names should we expect? (e.g., "PROCESSED", "BALLSPEED", etc.)
6. For variables with "@Footstrike", should we also check "@Foot_Contact" as an alias?
