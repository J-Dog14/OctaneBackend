# Pitching Report: Complete Data & Logic Reference

**Purpose:** Blueprint for replicating the pitching report in the front-end app repo.
This document covers every metric, where it comes from, how it is computed, and how it is displayed.

---

## 1. Data Origin

Raw data comes from **Visual3D / Qualisys XML exports**:
- `session.xml` — athlete demographics (name, DOB, height, weight), creation date, ball velocity (in the Comments field)
- `session_data.xml` — per-trial kinematic metrics organized by owner/folder/metric

Python script `uais/python/scripts/rebuild_pitching_trials_jsonb.py` parses these files, calculates scores, and writes one row per trial to **`f_pitching_trials`** in Neon (PostgreSQL).

Force plate data is processed separately by R scripts in `uais/R/pitching/force/` and stored in **`f_pitching_force_metrics`**.

---

## 2. Database Tables

### `f_pitching_trials` (primary table)
| Column | Type | Description |
|---|---|---|
| `athlete_uuid` | VARCHAR(36) | FK to `d_athletes` |
| `session_date` | DATE | From `session.xml` Creation_date |
| `trial_index` | INTEGER | 0-based order in the session |
| `velocity_mph` | NUMERIC | Ball release speed from Comments field |
| `score` | NUMERIC | Calculated pitching score |
| `metrics` | JSONB | All extracted kinematic metrics (see §4) |
| `handedness` | VARCHAR | "Left" or "Right" |
| `height` | NUMERIC | Inches |
| `weight` | NUMERIC | Lbs |
| `age_at_collection` | NUMERIC | Calculated from DOB |
| `age_group` | TEXT | "YOUTH" / "HIGH SCHOOL" / "COLLEGE" / "PRO" |
| `owner_filename` | TEXT | Trial name from XML |

### `f_pitching_force_metrics` (GRF data)
One row per trial. Contains 40+ computed GRF metrics. Key fields:
- **Event frame indices:** `fc_frame`, `br_frame`, `mer_frame`, `initial_contact_frame`
- **Event times (seconds):** `fc_time_s`, `br_time_s`, `mer_time_s`
- **Lead leg peaks:** `lead_peak_vertical_bw`, `lead_peak_braking_bw`, `lead_peak_resultant_bw`
- **Impulses (N·s):** `lead_impulse_v_fc_to_br_ns`, `lead_impulse_v_fc_to_mer_ns`, `lead_impulse_v_into_ball_ns`
- **Midpoint forces:** `lead_fz_at_midpoint_bw`, `lead_fy_at_midpoint_bw`, `lead_resultant_at_midpoint_bw`
- **RFD:** Rate of force development (20%–80% rise from FC to peak)
- **Timing flags:** `peaks_synced_flag`, `single_impulse_flag`, `peaks_before_mer_flag`
- **QA flags:** `qa_flags` array (e.g. `plate_clipping`, `late_peaks`, `virtual_plate_mismatch`)

---

## 3. Score Calculation

**Formula** (in `uais/python/scripts/rebuild_pitching_trials_jsonb.py` lines 318–419 and `uais/R/pitching/pitching_processing.R` lines 618–757):

```
score = velocity_part + metric_sum

velocity_part = 2.78 × velocity_mph

metric_sum =
  0.2415 × shld_er_max                      (Pitching_Shoulder_Angle_Max Z)
+ 20.7   × lead_leg_midpoint                (Lead_Leg_GRF_mag_Midpoint_FS_Release X, normalized to BW)
+ 0.7245 × horizontal_abduction             (Pitching_Shoulder_Angle@Footstrike X, abs value)
+ 0.0181125 × torso_ang_velo               (Thorax_Ang_Vel_max X)
- 0.2415 × pelvis_ang_fp                   (Pelvis_Angle@Footstrike Z)
+ 0.422625 × front_leg_brace               (Lead_Knee@Footstrike.X − Lead_Knee@Release.X)
+ 0.301875 × trunk_ang_fp                  (Trunk_Angle@Footstrike Z)
- 0.2415 × |front_leg_variability|         (|Lead_Knee@Footstrike.Y − Lead_Knee@Release.Y|)
+ 1.2075 × linear_pelvis_speed             (MaxPelvisLinearVel_MPH Y)
- 0.181125 × |pelvis_obliquity|            (|Pelvis@Release.Y − Pelvis@Footstrike.Y|)
+ 0.0483 × pelvis_ang_velo                 (Pelvis_Ang_Vel_max X)
```

- `lead_leg_midpoint` is normalized: if raw value > 10 N → divide by `weight_kg × 9.81`. Default weight fallback: 80 kg.
- No hard cap on score. Typical elite range: 400–512+.
- **Fallback** (used if DB score is missing): `velocity_mph × 3.125` (in `lib/octane/pitchingPayload.ts` line 141).

---

## 4. Metrics JSONB Structure

The `f_pitching_trials.metrics` JSONB column stores flat key-value pairs where values are single-element arrays:
```json
{
  "PROCESSED.Pelvis_Angle@Footstrike.Z": [-51.08],
  "PROCESSED.Lead_Knee_Angle@Footstrike_X": [142.3],
  "KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max.X": [487.2],
  "BALLSPEED.BALL_RELEASE_SPEED": [91.4],
  "TIMING.FootstrikeTime_X": [0.341],
  "INCREMENT.Pitching_Shoulder_Angle@Footstrike_10ms_X": [-58.2],
  ...
}
```

**Key naming conventions:**
- `FOLDER.MetricName.Component` — dot-separated (e.g. `PROCESSED.Pelvis_Angle@Footstrike.Z`)
- `FOLDER.MetricName_Component` — underscore-separated (e.g. `PROCESSED.Lead_Knee_Angle@Footstrike_X`)
- Both forms are aliased at parse time in `parseTrialMetricsJson()` so either works in lookup

**Increment keys** track metric progression from footstrike at 10ms intervals:
```
INCREMENT.Pitching_Shoulder_Angle@Footstrike_10ms_X
INCREMENT.Pitching_Shoulder_Angle@Footstrike_20ms_X
...
INCREMENT.Pitching_Shoulder_Angle@Footstrike_110ms_X
```
Same pattern exists for `INCREMENT.Hip Shoulders Sep@Footstrike_*ms_Z`.

---

## 5. Payload Building (`lib/octane/pitchingPayload.ts`)

**Function:** `buildPitchingPayloadFromTrials(athleteUuid, sessionDate?)`
1. Queries `f_pitching_trials` for the most recent session (or the specified date)
2. Averages all metric values across trials in that session
3. Calls `buildMetricsFromValueMap()` which iterates over `PITCHING_METRIC_SPECS`

**Fallback:** `buildPitchingPayloadFromKinematics()` reads from `f_kinematics_pitching` (long-form table) if trial data is unavailable.

**Output type:**
```typescript
type PitchingPayload = {
  athleteUuid: string;
  level: string;          // Derived from age_group (e.g. "COLLEGE", "PRO")
  score: number | null;
  metrics: PitchingPayloadMetric[];
  sessionDate?: string | null;
}

type PitchingPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: "NUMBER" | "MPH" | "DEGREES" | "DEGREES_PER_SECOND" | "N_BW" | "LBS";
  orientation: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | null;
}
```

---

## 6. Complete Metric Specs

All 38 metrics in `PITCHING_METRIC_SPECS` (`lib/octane/pitchingPayload.ts` lines 132–491):

| Category | Name | Unit | Orientation | Source |
|---|---|---|---|---|
| SUBJECT_METRICS | SCORE | NUMBER | HIGHER | `velocity_mph × 3.125` (or DB score) |
| SUBJECT_METRICS | WEIGHT | LBS | HIGHER | `d_athletes.weight` |
| TRACKMAN_METRICS | VELOCITY | MPH | HIGHER | `BALLSPEED.BALL_RELEASE_SPEED` |
| PELVIS_ROTATION | FOOT_PLANT | DEGREES | LOWER | `PROCESSED.Pelvis_Angle@Footstrike.Z` |
| TRUNK_POSITION | FOOT_PLANT | DEGREES | HIGHER | `PROCESSED.Trunk_Angle@Footstrike.Z` |
| HIP_SHOULDER_SEPARATION | FOOT_PLANT | DEGREES | HIGHER | `PROCESSED.Hip Shoulders Sep@Footstrike.Z` |
| FRONT_LEG | FOOT_PLANT | DEGREES | HIGHER | `PROCESSED.Lead_Knee_Angle@Footstrike.X` |
| FRONT_LEG | RELEASE | DEGREES | HIGHER | `PROCESSED.Lead_Knee_Angle@Release.X` |
| FRONT_LEG | EXTENSION | DEGREES | HIGHER | `Lead_Knee@Footstrike.X − Lead_Knee@Release.X` (computed) |
| SHOULDER_ER | FOOT_PLANT | DEGREES | HIGHER | `PROCESSED.Pitching_Shoulder_Angle@Footstrike_Z` |
| SHOULDER_ER | MAX | DEGREES | HIGHER | `PROCESSED.Pitching_Shoulder_Angle_Max_Z` |
| ABDUCTION | FOOT_PLANT | DEGREES | LOWER | `PROCESSED.Pitching_Shoulder_Angle@Footstrike.X` |
| ABDUCTION | MAX | DEGREES | LOWER | `PROCESSED.Pitching_Shoulder_Angle_Min` |
| ABDUCTION | TIME_TO_MAX_HOR_ANGLE_MS | NUMBER | LOWER | `(MaxShoulderHorAngleTime − FootstrikeTime) × 1000` |
| ABDUCTION_PROGRESS | GAIN_OR_LOSS | NUMBER | HIGHER | Progression summary on Shoulder X axis (see §7) |
| ABDUCTION_PROGRESS | AMOUNT_TO_PEAK | DEGREES | HIGHER | Progression summary — amount gained to peak |
| ABDUCTION_PROGRESS | PEAK_AFTER_FOOTSTRIKE_MS | NUMBER | LOWER | Progression summary — ms when peak occurs |
| ABDUCTION_PROGRESS | POST_PEAK_LOSS_RATE | NUMBER | LOWER | Progression summary — deg/ms loss after peak |
| HIP_SHOULDER_PROGRESS | GAIN_OR_LOSS | NUMBER | HIGHER | Progression summary on HSS Z axis (see §7) |
| HIP_SHOULDER_PROGRESS | AMOUNT_TO_PEAK | DEGREES | HIGHER | Progression summary |
| HIP_SHOULDER_PROGRESS | PEAK_AFTER_FOOTSTRIKE_MS | NUMBER | LOWER | Progression summary |
| HIP_SHOULDER_PROGRESS | POST_PEAK_LOSS_RATE | NUMBER | LOWER | Progression summary |
| KINEMATIC_SEQUENCE | PELVIS | DEG/S | HIGHER | `KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max.X` |
| KINEMATIC_SEQUENCE | TORSO | DEG/S | HIGHER | `KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max.X` |
| KINEMATIC_SEQUENCE | ARM | DEG/S | HIGHER | `KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max.X` |
| KINEMATIC_SEQUENCE | HAND | DEG/S | HIGHER | `KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max.X` |
| KINEMATIC_SEQUENCE | PELVIS_TIME | NUMBER | null | `TIMING.MaxPelvisVelTime.X` |
| KINEMATIC_SEQUENCE | TORSO_TIME | NUMBER | null | `TIMING.MaxThoraxVelTime.X` |
| KINEMATIC_SEQUENCE | ARM_TIME | NUMBER | null | `TIMING.MaxHumerusVelTime.X` |
| KINEMATIC_SEQUENCE | HAND_TIME | NUMBER | null | `TIMING.MaxHandVelTime.X` |
| GRF | MID_POINT | N_BW | HIGHER | `PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X` |
| GRF | GRF_MAG_MAX | N_BW | HIGHER | `PROCESSED.Lead_Leg_GRF_mag_max.X` |
| GRF | Y_DIR | N_BW | HIGHER | `abs(PROCESSED.Lead_Leg_GRF_min_Y)` (computed) |
| GRF | Z_DIR | N_BW | HIGHER | `PROCESSED.Lead_Leg_GRF_max.Z` |
| LATERAL_TILT | RELEASE | DEGREES | LOWER | `PROCESSED.Trunk_Angle@Release.X` |
| LINEAR_VELOCITY | MAX | MPH | HIGHER | `PROCESSED.MaxPelvisLinearVel_MPH` |
| SHOULDER_EXTERNAL_ROTATION | MAX | DEGREES | HIGHER | `PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot.Z` |
| PELVIC_OBLIQUITY | TOTAL | DEGREES | LOWER | `Pelvis@Release.Y − Pelvis@Footstrike.Y` (computed) |
| TOTAL_TRUNK_FLEXION | TOTAL | DEGREES | HIGHER | `Trunk@Release.X − Trunk@Footstrike.X` (computed) |

---

## 7. Progression Summary Calculations (`computeProgressionSummary`)

Used for both **Abduction** and **Hip-Shoulder Separation** progress metrics.

**Algorithm** (`lib/octane/pitchingPayload.ts` lines 70–128):
1. Start with the footstrike value at t=0
2. Sample the metric at 10, 20, 30, ..., 110 ms after footstrike using `INCREMENT.*` keys
3. Find the peak point (min for abduction since `lowerIsGain=true`; max for HSS since `lowerIsGain=false`)
4. Compute outputs:

```
gainOrLoss      = +1 if amountToPeak > 0, -1 if < 0, 0 if equal
amountToPeak    = |footstrike − peak| (always positive)
peakAfterFootstrikeMs = peak.ms (null if peak is at t=0)
postPeakLossRate = (last.value − peak.value) / (last.ms − peak.ms)  [deg/ms]
```

**Abduction** uses `INCREMENT.Pitching_Shoulder_Angle@Footstrike_*ms_X` (X axis, lower = gain).
**HSS** uses `INCREMENT.Hip Shoulders Sep@Footstrike_*ms_Z` (Z axis, higher = gain).

---

## 8. Derived Metrics (front-end only)

These are not in the payload — they are computed in the report UI:

### ARM_TIMING_FLAG
Derived from `SHOULDER_ER|FOOT_PLANT` value:
- `< 33°` → **"LATE"** (arm behind at footstrike)
- `33–77°` → **"ON_TIME"** (ideal window)
- `> 77°` → **"EARLY"** (arm ahead at footstrike)

### MAX_HSS
Derived from `HIP_SHOULDER_SEPARATION|FOOT_PLANT` + `HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK`:
```
MAX_HSS = FOOT_PLANT + AMOUNT_TO_PEAK
```

---

## 9. Report Sections (`app/dashboard/athlete-tracking/constants.ts`)

Eight sections rendered in `PITCHING_TABLE_SECTIONS`:

### 1. Velocity / Score
> Trackman velocity and overall pitching score.
- `TRACKMAN_METRICS|VELOCITY` — Velocity
- `SUBJECT_METRICS|SCORE` — Score

### 2. Lead Leg Block & Ground Reaction Force
> Efficient lead leg block stops forward momentum and redirects force. Earlier GRF midpoint = better energy transfer.
- `GRF|MID_POINT` — GRF Mid-Point *(has insight)*
- `FRONT_LEG|EXTENSION` — Lead Leg Block *(has insight)*
- `FRONT_LEG|FOOT_PLANT` — Knee Flexion @ Footplant
- `FRONT_LEG|RELEASE` — Knee Flexion @ Release

### 3. Pelvis Rotation
> Pelvis is a primary velocity driver. More open at foot contact = better energy transfer up the chain.
- `PELVIS_ROTATION|FOOT_PLANT` — Pelvis @ Footplant *(has insight)*
- `PELVIC_OBLIQUITY|TOTAL` — Pelvic Obliquity (FP to Release)

### 4. Hip-Shoulder Separation
> Pelvis rotates while torso stays closed — creates elastic stretch across trunk muscles.
- `HIP_SHOULDER_SEPARATION|FOOT_PLANT` — HSS @ Footplant *(has insight)*
- `[derived] MAX_HSS` — Max HSS
- `HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS` — Gain or Loss *(has insight)*
- `HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK` — Diff FP to Peak
- `HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS` — Time to Peak
- `HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE` — Rate of Loss

### 5. Torso Position
> Torso connects lower half to arm. Staying closed at footstrike allows efficient energy transfer.
- `TRUNK_POSITION|FOOT_PLANT` — Torso @ Footplant *(has insight)*
- `TOTAL_TRUNK_FLEXION|TOTAL` — Total Torso Flexion (FP to Release)
- `LATERAL_TILT|RELEASE` — Lateral Tilt @ Release *(has insight)*

### 6. Horizontal Abduction (Scap Load)
> Arm trails body down the mound. Maintaining abduction at footstrike keeps arm synced with lower half.
- `ABDUCTION|FOOT_PLANT` — Abduction @ Footplant *(has insight)*
- `ABDUCTION|MAX` — Max Abduction
- `ABDUCTION_PROGRESS|GAIN_OR_LOSS` — Gain or Loss
- `ABDUCTION_PROGRESS|AMOUNT_TO_PEAK` — Diff FP to Peak
- `ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS` — Time to Peak
- `ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE` — Rate of Loss

### 7. Shoulder External Rotation
> Arm timing at footstrike (33–77° = on time). Max layback ideally ≥180°.
- `SHOULDER_ER|FOOT_PLANT` — Shoulder ER @ Footplant *(has insight)*
- `[derived] ARM_TIMING_FLAG` — Arm Timing Flag
- `SHOULDER_EXTERNAL_ROTATION|MAX` — Max External Rotation (Layback) *(has insight)*

### 8. Kinematic Sequence
> Ideal energy flow: ground → hips → torso → arm → ball.
- `KINEMATIC_SEQUENCE|PELVIS` — Pelvis Ang Velo
- `KINEMATIC_SEQUENCE|TORSO` — Torso Ang Velo *(has insight)*
- `KINEMATIC_SEQUENCE|ARM` — Arm Ang Velo
- `KINEMATIC_SEQUENCE|HAND` — Hand Ang Velo

---

## 10. Insight Thresholds (`app/dashboard/athlete-tracking/domainHelpers.ts`)

Text insights shown in the report table for specific metrics. All thresholds are percentile-based from internal benchmarks:

| Metric Key | Elite | Above Avg | Average | Developing | Needs Improvement |
|---|---|---|---|---|---|
| `GRF\|MID_POINT` | > 2.41 | > 2.14 | > 2.02 | > 1.69 | ≤ 1.69 |
| `FRONT_LEG\|EXTENSION` | > 29.27° | > 19.00° | > 12.79° | > 4.05° | ≤ 4.05° |
| `PELVIS_ROTATION\|FOOT_PLANT` | > 60.42° | > 49.56° | > 42.11° | > 31.10° | ≤ 31.10° |
| `KINEMATIC_SEQUENCE\|TORSO` | > 1207.66 | > 1132.72 | > 1070.21 | > 985.71 | ≤ 985.71 |
| `HIP_SHOULDER_SEPARATION\|FOOT_PLANT` | > 59.10° | > 51.46° | > 45.87° | > 38.78° | ≤ 38.78° |
| `HIP_SHOULDER_PROGRESS\|GAIN_OR_LOSS` | ≥ 1 → "Gain" | — | — | — | < 1 → "Loss" |
| `TRUNK_POSITION\|FOOT_PLANT` | > 108.89° | > 96.95° | > 90.91° | > 82.66° | ≤ 82.66° |
| `LATERAL_TILT\|RELEASE` | > 48.69° | > 40.67° | > 34.37° | > 27.43° | ≤ 27.43° |
| `ABDUCTION\|FOOT_PLANT` | < -59.06° | < -48.48° | < -42.03° | < -30.72° | ≥ -30.72° |
| `SHOULDER_EXTERNAL_ROTATION\|MAX` | > 226.17° | > 174.92° | > 152.54° | > 66.47° | ≤ 66.47° |
| `SHOULDER_ER\|FOOT_PLANT` | 33–77° → "On Time" | — | < 33° → "Late" | > 77° → "Early" | — |

---

## 11. Percentile Color Coding

Applied to every metric's percentile value:

| Percentile | Color |
|---|---|
| > 85 | Green (`#16a34a`) |
| 60–85 | Light green (`#4ade80`) |
| 40–60 | Default text |
| 15–40 | Amber (`#f59e0b`) |
| < 15 | Red (accent secondary) |

Percentile is stored on the `MetricWithPercentile.percentile` field and comes from the report API.

---

## 12. Radar Chart Metrics

Displayed in the spider/radar chart for the pitching domain (`PITCHING_RADAR_ALLOWLIST` in `constants.ts`):

```
HIP_SHOULDER_SEPARATION|MAX_ER
ABDUCTION|FOOT_PLANT
SUBJECT_METRICS|SCORE
TRACKMAN_METRICS|VELOCITY
KINEMATIC_SEQUENCE|PELVIS
KINEMATIC_SEQUENCE|TORSO
KINEMATIC_SEQUENCE|ARM
SHOULDER_EXTERNAL_ROTATION|MAX
GRF|MID_POINT
```

Values are plotted as **percentile (0–100)** on the radial axis. Up to 6 color-coded series (sessions or athletes) can be overlaid.

---

## 13. Timeline Chart Metrics

Shown in the trend-over-time line chart (`getTimelineMetricKeys("pitching")` in `domainHelpers.ts`):

```
TRACKMAN_METRICS|VELOCITY
SUBJECT_METRICS|SCORE
HIP_SHOULDER_SEPARATION|FOOT_PLANT
ABDUCTION|FOOT_PLANT
KINEMATIC_SEQUENCE|PELVIS
KINEMATIC_SEQUENCE|TORSO
KINEMATIC_SEQUENCE|ARM
GRF|MID_POINT
```

---

## 14. Report API

**Endpoint:** `GET /api/dashboard/athlete-tracking/report?athleteUuid={uuid}`

Returns `AthleteTrackingReport` containing all domains. The pitching domain includes:
- All `MetricWithPercentile[]` entries — each metric has: `category`, `name`, `value`, `valueUnit`, `orientation`, `percentile`
- Percentiles are computed server-side by comparing the athlete's value against age-group peer data

**Debug endpoint:** `GET /api/dashboard/athlete-tracking/pitching-payload-debug?athleteUuid={uuid}`
Returns the raw payload + all resolved keys from the metrics JSONB.

---

## 15. Key Files Summary

| File | Role |
|---|---|
| `lib/octane/pitchingPayload.ts` | All 38 metric specs + payload builder |
| `app/dashboard/athlete-tracking/constants.ts` | Section definitions, radar allowlist, timeline keys |
| `app/dashboard/athlete-tracking/domainHelpers.ts` | Insight thresholds, radar/timeline helpers, percentile color |
| `app/dashboard/athlete-tracking/AthleteTrackingContent.tsx` | Main report rendering (1,584 lines) |
| `app/dashboard/athlete-tracking/PitchingDiagram.tsx` | Anatomy diagram images per section |
| `app/dashboard/athlete-tracking/MetricRadarChart.tsx` | Recharts radar chart component |
| `app/dashboard/athlete-tracking/MetricLineChart.tsx` | Recharts timeline chart component |
| `app/dashboard/athlete-tracking/types.ts` | TypeScript type definitions |
| `app/dashboard/athlete-tracking/displayBuilders.ts` | Cell formatting logic |
| `app/api/dashboard/athlete-tracking/report/route.ts` | Report data API endpoint |
| `prisma/schema.prisma` | `f_pitching_trials`, `f_pitching_force_metrics` table definitions |
| `uais/python/scripts/rebuild_pitching_trials_jsonb.py` | Ingestion + score calculation |
| `uais/R/pitching/force/force_metrics.R` | GRF metric computation |

---

## 16. Replication Checklist

To replicate this report in a new front-end app:

1. **Data source:** Read from `f_pitching_trials` (JSONB metrics + velocity_mph + score) and `f_pitching_force_metrics` via the existing API or a new endpoint that returns `PitchingPayload`
2. **Metric resolution:** Implement `parseTrialMetricsJson()` key aliasing and the `PITCHING_METRIC_SPECS` lookup order (metricNameCandidates → computeFromMap → compute → fromAthlete)
3. **Progression calculations:** Implement `computeProgressionSummary()` for ABDUCTION_PROGRESS and HIP_SHOULDER_PROGRESS using the INCREMENT keys at 10ms intervals
4. **Derived metrics:** ARM_TIMING_FLAG and MAX_HSS are front-end computed — no API call needed
5. **Sections:** 8 sections as defined in §9, with descriptions and insight keys
6. **Insights:** Threshold ladder from §10 per metric key
7. **Percentile colors:** 5-tier system from §11
8. **Radar chart:** 9 metrics from §12, values = percentiles, multi-series overlay
9. **Timeline chart:** 8 metrics from §13, one point per session date
10. **Diagram images:** Sourced from `/public/biomech/` — one anatomy image per section
