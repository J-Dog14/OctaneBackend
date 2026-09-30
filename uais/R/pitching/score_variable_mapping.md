# 8ctane Delivery Score — Variable Mapping (v2)

**Version 2.0.0 — 2026-09-09.** Supersedes the v1 linear-coefficient score.
v1 is archived at `archive/pitching_score_v1_2026-09-09.R` (formula) and
`archive/score_variable_mapping_v1.md` (this document's previous edition).

Implemented in `pitching_processing.R`:

| function | role |
|---|---|
| `pw_interp(x, anchors)` | piecewise-linear anchor interpolation, clamps both ends |
| `DELIVERY_ANCHORS` | anchor tables (metric value → fraction of points) |
| `velo_score(velo_mph, age)` | 500-pt velocity block |
| `delivery_score_from_metrics(m, age)` | pure math on a named list |
| `extract_delivery_metrics(doc, owner, weight_kg)` | `session_data.xml` → named list |
| `calculate_delivery_score(...)` | extract + score, returns full breakdown |
| `calculate_pitching_score(...)` | back-compatible scalar wrapper (returns `total`) |

## Score structure — 1000 pts

```
total = velocity (500) + mechanics (400, clamped) + arm_health (100, clamped)
```

- **Velocity 500** — age-banded. `AGE_BANDS[age] = (floor, ceiling)`, linear to 500.
  Age is **truncated**, not rounded (`trunc(age)`, matching `int(age)`): a 20.77-year-old
  scores on the 20 band (70–95), not the 21 band (72–97). That distinction is worth 40 pts.
  `age = NA` → absolute 70 mph = 0, 95 mph = 500 (20 pts/mph).
- **Mechanics 400** — Cylinders 1,2,3,4,5,6,8 summed, clamped to [0, 400].
- **Arm Health 100** — Cylinder 7, clamped to [0, 100].
- `efficiency_gap = (mechanics + arm_health) − velocity`. Negative = velocity outruns mechanics.
- Grade: ≥850 Elite, ≥750 Advanced, ≥650 Solid, ≥550 Developing, else Foundational.

## Event frames — READ THIS BEFORE TOUCHING CYLINDER 4

Frames come from the **`EVENT_LABEL`** folder, not the `TIMING` metric folder:

```
local_frame = round(EVENT_LABEL_time_s × Frame_rate) + 1
```

`TIMING.*Time` values are **SETUP-relative** (`TIMING = EVENT_LABEL − SETUP`), and `SETUP`
varies per trial (0.027–0.153 s in the Durnin 2026-09-07 session — 8 to 46 frames).
Using `TIMING` puts FC and BR 8–46 frames early, which is what `force/force_events.R`
currently does. See "Known issues" below.

Validation of this rule on `Fastball RH 2.c3d`: `Pitching_Shoulder_Angle` sampled at the
derived frames reproduces V3D's own `@Footstrike` / `@Max_Shoulder_Rot` / `@Release` metric
values exactly (X = −51.63084 / 2.765148 / 3.261821, Z = 31.58770 / 188.8476 / 102.3633).

Cross-check on the reconstructed lead-plate series, all 5 trials:

| check | V3D metric | computed here |
|---|---|---|
| peak resultant | `Lead_Leg_GRF_mag_max` 2.339572 | 2.340767 (0.05%) |
| FC→midpoint resultant impulse | `Lead_Leg_GRF_mag_impulse_Midpoint_FS_Release` 0.1066369 | 0.106547 (0.08%) |

## Variable mapping

All lookups take the **first value** of the named component. `@Footstrike` falls back to
`@Foot_Contact`. Body weight: `weight_kg` if > 0, else 180 lb; `BW_n = kg × 9.81`.

### Cylinder 1 — Down-the-Mound Engine (70)

| metric | pts | source | component |
|---|---|---|---|
| `stride_pct_height` | 35 | `STRIDE_LENGTH_MEAN_PERCENT` | X |
| `back_grf_peak_bw` | 35 | `Back_Leg_GRF_mag_max` | X |

### Cylinder 2 — Hip-Shoulder Separation (60)

| metric | pts | source | component |
|---|---|---|---|
| `hss_fs_deg` | 60 | `Hip Shoulders Sep@Footstrike` | Z |

`Trunk Rot wrt Pelvis Rot@Footstrike` [X] is an equivalent alternative (49.3–54.1 vs
51.2–54.1 across this session); Z of `Hip Shoulders Sep` is used.

### Cylinder 3 — Trunk Velocity Product (60)

| metric | pts | source | component |
|---|---|---|---|
| `trunk_vel_product` | 60 | `trunk_lin_vel_y × fwd_flex_rel_deg` | — |
| ` ├ trunk_lin_vel_y` | | `MaxTrunkLinearVel_MPH` | Y |
| ` └ fwd_flex_rel_deg` | | `Trunk_Angle@Release` | X |

### Cylinder 4 — Front Leg Block (100), full force-plate path

| metric | pts | source | component |
|---|---|---|---|
| `into_ball_impulse` | 40 | `Lead_Leg_GRF_mag_Midpoint_FS_Release` | X |
| `peak_resultant_bw` | 25 | max resultant of `Lead_GRF`, FC+20ms → BR, ÷ BW_n | X,Y,Z |
| `peak_pct_fc_br` | 15 | frame of that peak as % of FC→BR | — |
| `peak_lag_ms` | 10 | (peak-vertical frame − peak-braking frame) × dt × 1000 | — |
| `impulse_peak_count` | 10 | prominent peaks in `Lead_GRF` Z, FC+20ms → BR | Z |

**`into_ball_impulse` is not an impulse.** It is the *instantaneous resultant lead-leg GRF
magnitude at the midpoint of FC→BR*, in bodyweight multiples — V3D's
`Lead_Leg_GRF_mag_Midpoint_FS_Release`. The name is retained so the anchor key matches the
reference implementation. Anchors were rescaled accordingly (see below).

`DELIVERY_TRANSIENT_SKIP_MS = 20` — the first 20 ms after FC is excluded from all peak and
peak-count searches, because heel-strike impact transients otherwise dominate. On this
session that exclusion moves `peak_pct_fc_br` from 2.8–5.9% to 52.9–83.3% on trials 3/4/8
and collapses `impulse_peak_count` from 2 to 1 on every trial.

`Lead_GRF` [X,Y,Z] (DERIVED/PROCESSED, Newtons) is present for every trial, so the full path
runs without the `-3d-data.json` file. Braking sign is resolved per trial by comparing mean
negative vs mean positive Fy over FC→BR.

### Cylinder 4 — snapshot fallback (used only when `into_ball_impulse` is missing)

| metric | pts | source |
|---|---|---|
| `lead_knee_ext_deg` | 50 | `Lead_Knee_Angle@Footstrike`[X] − `Lead_Knee_Angle@Release`[X] |
| `lead_grf_rel_bw` | 50 | resultant `Lead_GRF` at BR ÷ BW_n |

### Cylinder 5 — Pelvis Stability & Obliquity (30) — PROVISIONAL

| metric | pts | source | component |
|---|---|---|---|
| `pelvis_obliq_swing` | 15 | `abs(Pelvis_Angle@Release − Pelvis_Angle@Footstrike)` | Y |
| `pelvis_stop_deg` | 15 | `Pelvis_Angle@PelvisRot_Stop` | Z |
| `pelvis_ang_vel_release` | −5 if < 0 | `Pelvis_Ang_Vel@Release` | X |

### Cylinder 6 — Horizontal Abduction / Arm Trail (50)

| metric | pts | source | component |
|---|---|---|---|
| `hzabd_vel_max` | 30 | `abs(Pitching_Shoulder_AngVel_HzShldAbd_Max)` | X |
| `hzabd_fs_deg` | 20 | `abs(Pitching_Shoulder_Angle@Footstrike)` | X |

**`hzabd_vel_max` replaces `hzabd_dwell_ms`.** The original spec named a dwell time in ms
that has no definition anywhere in the repo and no source variable. It is reinterpreted as
the rate the arm leaves max horizontal abduction (deg/s). Anchors are **provisional and
uncalibrated** — see below.

### Cylinder 8 — Posture at Release (30)

| metric | pts | source | component |
|---|---|---|---|
| `fwd_flex_rel_deg` | 15 | `Trunk_Angle@Release` | X |
| `lat_tilt_rel_deg` | 15 | `Trunk_Angle@Release` | Y |

### Cylinder 7 — Arm Health (100)

| metric | pts | source | component |
|---|---|---|---|
| `er_fs_deg` | 35 | `Pitching_Shoulder_Angle@Footstrike` | Z |
| `elbow_torque_nm` | 30 | `Max_Elbow_Varus_Torque_Nm` | X |
| `stress_per_mph` | 25 | `elbow_torque_nm ÷ velo_mph` | — |
| `mer_deg` | 10 | `Pitching_Shoulder_Angle_Max` | Z |

`velo_mph` is passed in from `session.xml` `Measurement/Fields/Comments`.

## Anchor changes from the original spec

Two tables did not fit their source variable and were rescaled. Both keep the
0 / .50 / .80 / 1.0 shape.

| key | original | v2 | why |
|---|---|---|---|
| `into_ball_impulse` | 0.030 / 0.045 / 0.060 / 0.080 BW·s | 1.4 / 1.9 / 2.3 / 2.7 BW | metric is an instantaneous BW magnitude (2.07–2.48 here), not an impulse; every trial pinned at 1.0 under the old table |
| `hzabd_vel_max` (was `hzabd_dwell_ms`) | 10 / 25 / 40 / 60 ms | 250 / 350 / 450 / 550 deg/s | units changed with the redefinition |

**Both rescales are uncalibrated.** They were chosen to be domain-plausible and to make the
component discriminate on the one session available; they are **not** fitted to a
population. A single athlete's five trials cannot calibrate an anchor table. Treat
`into_ball_impulse`, `hzabd_vel_max` and all of Cylinder 5 as provisional until they are
re-anchored against a real distribution. The `peak_resultant_bw` ceiling (2.5 BW) is also
worth revisiting — this athlete reaches 2.34–2.55, i.e. at or above the 1.0 anchor.

## Known issues in adjacent code (not fixed here)

1. **`force/force_events.R` reads the wrong event source.** It takes `footstrike_s` /
   `release_s` from `TIMING.*Time` (SETUP-relative) and computes `round(t × fr)` with no
   `+1`. Both FC and BR land 8–46 frames early depending on the trial's `SETUP` value.
   Anything in `f_pitching_force_metrics` derived from those frames is shifted.
2. **`force/force_events.R` `.detect_mer()` locks onto a Euler wrap.** It takes
   `which.min(rotZ)` of the arm segment, but `rotZ` wraps at ±180° mid-rotation. On
   `Fastball RH 2` it returns frame 390 (the −178.9° → +175.7° discontinuity) instead of the
   true MER at 417. That shrinks the `into_ball` window from ~107 ms to ~57 ms and roughly
   halves every `*_into_ball_*` impulse. Fix: unwrap the angle, or read
   `EVENT_LABEL/Max_Shoulder_Rot` directly (which is what v2 does).
3. **The reference Python `delivery_score()` crashes as written.** `out["c4_mode"] =
   "full_grf"` is a string in the same dict the mechanics roll-up sums, and `"c4_mode"`
   matches the `"c4_"` prefix filter → `TypeError: unsupported operand type(s) for +:
   'float' and 'str'`. Hits both the full_grf and snapshot paths. The R port keeps
   `c4_mode` out of the component list. Guard the sum with `isinstance(v, (int, float))` if
   the Python is kept in use.
4. **Truthiness guards in the Python fallbacks** (`if prod is None and
   m.get("trunk_lin_vel_y") and ...`) treat a legitimate `0.0` as missing. The R port
   checks `is.na()` instead.

## Validation — Durnin, Kaden, 2026-09-07

5 trials marked `Used=True`. 227.0 lb / 102.965 kg → BW 1010.09 N. Age 20.77 → band 70–95.
All 22 metrics resolved on all 5 trials; **zero missing**, `c4_mode = full_grf` throughout.
R implementation reproduces the (bug-fixed) reference Python to **0.0000** on every
component and every block.

| | FB2 | FB3 | FB4 | FB7 | FB8 |
|---|---|---|---|---|---|
| velocity | 446.0 | 454.0 | 458.0 | 460.0 | 462.0 |
| mechanics | 334.5 | 366.3 | 365.5 | 359.4 | 357.8 |
| arm_health | 78.2 | 73.6 | 65.6 | 67.9 | 66.3 |
| **total** | **858.8** | **893.9** | **889.1** | **887.3** | **886.1** |
| grade | Elite | Elite | Elite | Elite | Elite |
| efficiency_gap | −33.2 | −14.1 | −26.9 | −32.7 | −37.9 |

Session mean 883.0, sd 13.9. Every trial grades Elite, and `efficiency_gap` is negative on
all five — with the current anchors, a 92–93 mph 20-year-old banks 446–462 of the 500
velocity points, which no realistic mechanics score offsets. Reconsider the age-band
ceilings if "Elite" is meant to be rarer than this.

To reproduce: `calculate_delivery_score(doc, "Fastball RH 2.c3d", 92.3, 102.964927673, 20.77)`
