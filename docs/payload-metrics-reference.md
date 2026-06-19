# Payload Metrics Reference
All metrics as they appear in the source tables. Generated from payload source files.

---

## PITCHING  (source: f_pitching_trials.metrics JSON)

### Direct pulls

BALLSPEED.BALL_RELEASE_SPEED

PROCESSED.Pelvis_Angle@Footstrike.Z
PROCESSED.Trunk_Angle@Footstrike.Z
PROCESSED.Hip Shoulders Sep@Footstrike.Z

PROCESSED.Lead_Knee_Angle@Footstrike.X
PROCESSED.Lead_Knee_Angle@Release.X

PROCESSED.Pitching_Shoulder_Angle@Footstrike.Z      <- arm timing (ER at footstrike)
PROCESSED.Pitching_Shoulder_Angle_Max_Z             <- shoulder ER max (simple)
PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot.Z  <- shoulder ER max (XYZ method, preferred)

PROCESSED.Pitching_Shoulder_Angle@Footstrike.X      <- horizontal abduction at footstrike
PROCESSED.Pitching_Shoulder_Angle_Min               <- peak horizontal abduction (min X across motion)

KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max.X
KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max.X
KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max.X
KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max.X

TIMING.MaxPelvisVelTime.X
TIMING.MaxThoraxVelTime.X
TIMING.MaxHumerusVelTime.X
TIMING.MaxHandVelTime.X

PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X
PROCESSED.Lead_Leg_GRF_mag_max.X
PROCESSED.Lead_Leg_GRF_min_Y                        <- payload takes abs(value)
PROCESSED.Lead_Leg_GRF_max.Z

PROCESSED.Trunk_Angle@Release.X                     <- lateral tilt at release
PROCESSED.MaxPelvisLinearVel_MPH

TIMING.MaxShoulderHorAngleTime_X                    <- used for time-to-max-abduction calc
TIMING.FootstrikeTime_X                             <- used for time-to-max-abduction calc

### Computed metrics

FRONT_LEG EXTENSION
  = PROCESSED.Lead_Knee_Angle@Footstrike.X  -  PROCESSED.Lead_Knee_Angle@Release.X

PELVIC OBLIQUITY TOTAL
  = PROCESSED.Pelvis_Angle@Release.Y  -  PROCESSED.Pelvis_Angle@Footstrike.Y

TOTAL TRUNK FLEXION
  = PROCESSED.Trunk_Angle@Release.X  -  PROCESSED.Trunk_Angle@Footstrike.X

TIME TO MAX HORIZONTAL ABDUCTION (ms)
  = (TIMING.MaxShoulderHorAngleTime_X  -  TIMING.FootstrikeTime_X) * 1000

---

### ABDUCTION PROGRESSION (Horizontal Abduction Gain/Loss after Footstrike)

Anchor (value at footstrike):
  PROCESSED.Pitching_Shoulder_Angle@Footstrike.X

Increments (10ms steps, 10ms through 110ms after footstrike):
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_10ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_20ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_30ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_40ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_50ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_60ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_70ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_80ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_90ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_100ms.X
  INCREMENT.Pitching_Shoulder_Angle@Footstrike_110ms.X

Logic (lower X = more abduction, so lower is a GAIN):
  peak = time point with the MINIMUM .X value across anchor + all increments
  GAIN_OR_LOSS      = +1 if peak < anchor, -1 if peak > anchor, 0 if equal
  AMOUNT_TO_PEAK    = anchor.X - peak.X              (positive = gained abduction)
  PEAK_AFTER_FOOTSTRIKE_MS = ms timestamp of peak (null if peak was at footstrike itself)
  POST_PEAK_LOSS_RATE = (last_point.X - peak.X) / (last_ms - peak_ms)   (deg per ms)

---

### HIP SHOULDER SEPARATION PROGRESSION

Anchor (value at footstrike):
  PROCESSED.Hip Shoulders Sep@Footstrike.Z

Increments (10ms steps, 10ms through 110ms after footstrike):
  INCREMENT.Hip Shoulders Sep@Footstrike_10ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_20ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_30ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_40ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_50ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_60ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_70ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_80ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_90ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_100ms.Z
  INCREMENT.Hip Shoulders Sep@Footstrike_110ms.Z

Logic (higher Z = more separation, so higher is a GAIN):
  peak = time point with the MAXIMUM .Z value across anchor + all increments
  GAIN_OR_LOSS      = +1 if peak > anchor, -1 if peak < anchor, 0 if equal
  AMOUNT_TO_PEAK    = peak.Z - anchor.Z              (positive = gained separation)
  PEAK_AFTER_FOOTSTRIKE_MS = ms timestamp of peak (null if peak was at footstrike itself)
  POST_PEAK_LOSS_RATE = (peak.Z - last_point.Z) / (last_ms - peak_ms)   (deg per ms)

---

## HITTING  (source: f_hitting_trials.metrics JSON)

### Direct pulls (tries non-MEAN first, falls back to _MEAN)

PROCESSED.Max_Pelvis_Ang_Vel
PROCESSED.Max_Pelvis_Ang_Vel_MEAN

PROCESSED.Max_Thorax_Ang_Vel
PROCESSED.Max_Thorax_Ang_Vel_MEAN

PROCESSED.Max_Lead_Forearm_Ang_Vel
PROCESSED.Max_Lead_Forearm_Ang_Vel_MEAN

PROCESSED.Max_Lead_Hand_Ang_Vel
PROCESSED.Max_Lead_Hand_Ang_Vel_MEAN

PROCESSED.Max_Bat_Ang_Vel
PROCESSED.Max_Bat_Ang_Vel_MEAN

PLANE.Horizontal_attack_angle
PLANE.Vertical_attack_angle

PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel
PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel_MEAN

PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel
PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel_MEAN

PROCESSED.Bat_travelled_distance_max

PLANE.Bat_Angle_Frontal@Contact
PLANE.Bat_Angle_Sagittal@Contact
PLANE.Bat_Angle_Transversal@Contact

PROCESSED.Lead_Knee_Angle@Lead_Foot_Down
PROCESSED.Lead_Knee_Angle@Lead_Foot_Down_MEAN
PROCESSED.Lead_Knee_Angle@Contact
PROCESSED.Lead_Knee_Angle@Contact_MEAN

PROCESSED.Lead_Knee_Ang_Vel_ext_max
PROCESSED.Lead_Knee_Ang_Vel_ext_max_MEAN

PROCESSED.Pelvis_Angle@Lead_Foot_Down
PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN
PROCESSED.Pelvis_Angle@Contact

PROCESSED.Pelvis_Shoulders_Separation@Setup
PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down
PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN
PROCESSED.Pelvis_Shoulders_Separation@Downswing
PROCESSED.Pelvis_Shoulders_Separation@Downswing_MEAN
PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel
PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel_MEAN
PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel
PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel_MEAN
PROCESSED.Pelvis_Shoulders_Separation@Contact
PROCESSED.Pelvis_Shoulders_Separation@Contact_MEAN

PROCESSED.Trunk_Angle@Lead_Foot_Down
PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN
PROCESSED.Trunk_Angle@Contact

PROCESSED.Stride_Width@Lead_Foot_Down
PROCESSED.Stride_Width@Lead_Foot_Down_MEAN

### Computed metrics

LEAD KNEE EXTENSION
  = PROCESSED.Lead_Knee_Angle@Contact  -  PROCESSED.Lead_Knee_Angle@Lead_Foot_Down

PELVIS TOTAL ROTATION
  = PROCESSED.Pelvis_Angle@Contact  -  PROCESSED.Pelvis_Angle@Lead_Foot_Down

TRUNK TOTAL ROTATION
  = PROCESSED.Trunk_Angle@Contact  -  PROCESSED.Trunk_Angle@Lead_Foot_Down

---

## MOBILITY  (source: f_mobility columns)

### Cervical
cervical_rotation_r_rom
cervical_rotation_l_rom
cervical_flexion_rom
cervical_extension_rom
cervical_lateral_flexion_r_rom
cervical_lateral_flexion_l_rom

### Shoulder Mobility
horizontal_abduction_rom
back_to_wall_shoulder_flexion
dominant_shoulder_ir
dominant_shoulder_er
non_dominant_shoulder_ir
non_dominant_shoulder_er
young_stretch_passive

### Shoulder Stability
hawkins_kennedy_test
shoulder_stability_flexion_mmt
shoulder_stability_abduction_mmt
shoulder_stability_er_at_0_deg_horiz_abduction_mmt
shoulder_stability_ir_at_0_deg_horiz_abduction_mmt
mid_trap_mmt
low_trap_mmt
scap_winging

### Elbow
elbow_extension_rom
elbow_flexion_rom
elbow_pronation_rom
elbow_supination_rom
radial_nerve_glide
ulnar_nerve_glide

### Spine / Core
pelvic_tilt_against_wall
backbend
sittiing_t_spine_pvc_r          <- "sittiing" typo matches DB column name exactly
sittiing_t_spine_pvc_l
slump_test
isa_rom

### Hip Mobility
thomas_test_hip_flexor_r
thomas_test_hip_flexor_l
r_hamstring_stretch_rom
l_hamstring_stretch_rom
r_hip_abduction_rom
l_hip_abduction_rom
hip_pinch
r_hip_flexion_rom
l_hip_flexion_rom
r_prone_hip_ir
r_prone_hip_er
l_prone_hip_ir
l_prone_hip_er

### Hip Stability
seated_r_hip_ir_mmt
seated_l_hip_ir_mmt
seated_r_hip_er_mmt
seated_l_hip_er_mmt
r_prone_hamstring_raise_mmt
l_prone_hamstring_raise_mmt
r_prone_glute_raise_mmt
l_prone_glute_raise_mmt
r_hip_abduction_mmt
l_hip_adduction_mmt
r_hip_adduction_mmt
l_hip_abduction_mmt

### Ankle
r_ankle_dorsiflexion_to_wall_rom
l_ankle_dorsiflexion_to_wall_rom
r_ankle_dorsiflexion_mmt
r_ankle_inversion_mmt
r_ankle_eversion_mmt
l_ankle_dorsiflexion_mmt
l_ankle_inversion_mmt
l_ankle_eversion_mmt

### Grip Strength
grip_strength_r
gs_l
grip_strength_r_at_90
gs_l_at_90

---

## ATHLETIC SCREEN

### f_athletic_screen_cmj  (CMJ)
jh_in
pp_w_per_kg
auc_j
kurtosis
rpd_max_w_per_s
time_to_rpd_max_s

### f_athletic_screen_dj  (DJ)
jh_in
pp_w_per_kg
auc_j
kurtosis
rpd_max_w_per_s
time_to_rpd_max_s
rsi
ct

### f_athletic_screen_ppu  (PPU)
jh_in
pp_w_per_kg
auc_j
kurtosis
rpd_max_w_per_s
time_to_rpd_max_s

### f_athletic_screen_slv  (SLV — split by side column into SLV_Left / SLV_Right)
jh_in
pp_w_per_kg
auc_j
kurtosis
rpd_max_w_per_s
time_to_rpd_max_s
