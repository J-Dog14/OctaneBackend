/**
 * Clean metric/category names for display in tables and charts.
 * Strips prefixes (PROCESSED., PLANE., etc.), replaces underscores with spaces,
 * and converts to title case (not all caps).
 */

const PREFIXES_TO_STRIP = [
  "PROCESSED.",
  "PLANE.",
  "TRACKMAN_METRICS.",
  "SUBJECT_METRICS.",
  "KINEMATIC_SEQUENCE.",
];

/** Hitting: raw metric name (after prefix strip) or full name -> display label for radar/table */
const HITTING_DISPLAY_OVERRIDES: Record<string, string> = {
  "Max_Pelvis_Ang_Vel": "Pelvis Ang Velo",
  "Max_Thorax_Ang_Vel": "Thorax Ang Velo",
  "Max_Lead_Forearm_Ang_Vel": "Lead Forearm Ang Velo",
  "Max_Lead_Hand_Ang_Vel": "Lead Hand Ang Velo",
  "Max_Bat_Ang_Vel": "Bat Ang Velo",
  "Max_RPV_CGPos_VLab_Linear_Vel": "Max Pelvis Linear Speed",
  "Max_RTA_CGPos_VLab_Linear_Vel": "Max Trunk Linear Speed",
  Bat_travelled_distance_max: "Bat Travelled Distance",
  Horizontal_attack_angle: "Horizontal Attack Angle",
  Vertical_attack_angle: "Vertical Attack Angle",
  "Pelvis_Shoulders_Separation@Setup": "Separation @ Setup",
  "Pelvis_Shoulders_Separation@Lead_Foot_Down": "Separation @ Lead Foot Down",
  "Pelvis_Shoulders_Separation@Downswing": "Separation @ Downswing",
  "Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel": "Separation @ Max Bat Velo",
  "Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel": "Separation @ Max Hand Velo",
  "Pelvis_Shoulders_Separation@Contact": "Separation @ Contact",
  "Lead_Knee_Angle@Lead_Foot_Down": "Lead Knee Angle @ FC",
  "Lead_Knee_Angle@Contact": "Lead Knee Angle @ Contact",
  Lead_Knee_Extension: "Lead Knee Extension",
  "Pelvis_Angle@Lead_Foot_Down": "Pelvis @ Lead Foot Down",
  "Pelvis_Angle@Contact": "Pelvis @ Contact",
  Pelvis_Total_Rotation: "Total Pelvis Rotation",
  "Trunk_Angle@Lead_Foot_Down": "Trunk @ Lead Foot Down",
  "Trunk_Angle@Contact": "Trunk @ Contact",
  Trunk_Total_Rotation: "Total Trunk Rotation",
  "Stride_Width@Lead_Foot_Down": "Stride Width @ Lead Foot Down",
  "Bat_Angle_Frontal@Contact": "Bat Angle Frontal @ Contact",
  "Bat_Angle_Sagittal@Contact": "Bat Angle Sagittal @ Contact",
  "Bat_Angle_Transversal@Contact": "Bat Angle Transversal @ Contact",
};

/** Pitching: full display names for (category, name) so tables/charts show full metric names. Key = "category|name". */
const PITCHING_DISPLAY_OVERRIDES: Record<string, string> = {
  "SUBJECT_METRICS|SCORE": "Octane Biomechanics Score",
  "SUBJECT_METRICS|WEIGHT": "Weight",
  "TRACKMAN_METRICS|VELOCITY": "Ball Release Speed (Velocity)",
  "PELVIS_ROTATION|FOOT_PLANT": "Pelvis Angle @ Footstrike",
  "TRUNK_POSITION|FOOT_PLANT": "Trunk Angle @ Footstrike",
  "HIP_SHOULDER_SEPARATION|FOOT_PLANT": "Hip-Shoulder Separation @ Footstrike",
  "FRONT_LEG|FOOT_PLANT": "Lead Knee Angle @ Footstrike",
  "FRONT_LEG|RELEASE": "Lead Knee Angle @ Release",
  "FRONT_LEG|EXTENSION": "Lead Leg Block",
  "SHOULDER_ER|FOOT_PLANT": "Pitching Shoulder Angle @ Footstrike",
  "SHOULDER_ER|MAX": "Pitching Shoulder Angle Max",
  "ABDUCTION|FOOT_PLANT": "Pitching Shoulder Angle @ Footstrike (Abduction)",
  "ABDUCTION|MAX": "Pitching Shoulder Angle Max (Abduction)",
  "ABDUCTION|TIME_TO_MAX_HOR_ANGLE_MS": "Time To Max Horizontal Abduction (ms)",
  "PELVIC_OBLIQUITY|TOTAL": "Pelvic Obliquity Total",
  "TOTAL_TRUNK_FLEXION|TOTAL": "Total Trunk Flexion",
  "ABDUCTION_PROGRESS|GAIN_OR_LOSS": "Abduction Gain/Loss Flag",
  "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK": "Abduction Amount To Peak",
  "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS": "Abduction Peak After Footstrike (ms)",
  "ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE": "Abduction Post-Peak Loss Rate",
  "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS": "Hip-Shoulder Gain/Loss Flag",
  "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK": "Hip-Shoulder Amount To Peak",
  "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS": "Hip-Shoulder Peak After Footstrike (ms)",
  "HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE": "Hip-Shoulder Post-Peak Loss Rate",
  "KINEMATIC_SEQUENCE|PELVIS": "Pelvis Ang Vel Max",
  "KINEMATIC_SEQUENCE|TORSO": "Thorax Ang Vel Max",
  "KINEMATIC_SEQUENCE|ARM": "Pitching Humerus Ang Vel Max",
  "KINEMATIC_SEQUENCE|HAND": "Pitching Hand Ang Vel Max",
  "LATERAL_TILT|RELEASE": "Lateral Tilt @ Release",
  "SHOULDER_EXTERNAL_ROTATION|MAX": "Max External Rotation",
  "LINEAR_VELOCITY|MAX": "Max Pelvis Linear Vel",
  "GRF|MID_POINT": "Lead Leg GRF Mag Midpoint (FS–Release)",
  "GRF|GRF_MAG_MAX": "Lead Leg GRF Mag Max",
  "GRF|Y_DIR": "GRF Y Dir",
  "GRF|Z_DIR": "GRF Z Dir",
};

export function formatMetricDisplayName(
  name: string,
  category?: string,
  domainId?: string
): string {
  if (domainId === "pitching" && category) {
    const key = `${category}|${name}`;
    if (PITCHING_DISPLAY_OVERRIDES[key]) return PITCHING_DISPLAY_OVERRIDES[key];
  }
  if (domainId === "hitting" && HITTING_DISPLAY_OVERRIDES[name]) {
    return HITTING_DISPLAY_OVERRIDES[name];
  }
  let s = name;
  for (const prefix of PREFIXES_TO_STRIP) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  if (domainId === "hitting" && HITTING_DISPLAY_OVERRIDES[s]) {
    return HITTING_DISPLAY_OVERRIDES[s];
  }
  s = s.replace(/_/g, " ");
  return toTitleCase(s);
}

function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Human-readable unit label; do not show "NUMBER". */
const UNIT_LABELS: Record<string, string> = {
  DEGREES_PER_SECOND: "°/s",
  DEGREES: "°",
  MPH: "mph",
  NUMBER: "",
  IN: "in",
  W: "W",
  W_PER_KG: "W/kg",
  S: "s",
  J: "J",
  N_BW: "N/BW",
  LBS: "lbs",
};

/**
 * Format value + unit for table display. Returns { valuePart, unitPart } so the number can be bolded.
 * valuePart is the numeric part (bold); unitPart is " / max" or " °", etc. NUMBER yields no unitPart.
 */
export function formatValueWithUnit(
  value: number | null,
  valueUnit: string,
  max?: number | null
): { valuePart: string; unitPart: string } {
  if (value == null || !Number.isFinite(value)) {
    return { valuePart: "—", unitPart: "" };
  }
  if (max != null && max > 0) {
    return { valuePart: Number(value).toFixed(0), unitPart: ` / ${max}` };
  }
  const valuePart = Number(value).toFixed(2);
  const unitKey = String(valueUnit).toUpperCase().trim();
  const unitLabel = unitKey === "NUMBER" || unitKey === "" ? "" : (UNIT_LABELS[unitKey] ?? toTitleCase(String(valueUnit).replace(/_/g, " ")));
  return { valuePart, unitPart: unitLabel ? ` ${unitLabel}` : "" };
}
