import type { PitchingSection, HittingSection, AthleticVariableDetail } from "./types";

export const SERIES_COLORS = ["#2c99d4", "#d62728", "#9467bd", "#2ca02c", "#e6c200", "#ff7f0e"];

export const PITCHING_RADAR_ALLOWLIST = new Set([
  "HIP_SHOULDER_SEPARATION|MAX_ER",
  "ABDUCTION|FOOT_PLANT",
  "SUBJECT_METRICS|SCORE",
  "TRACKMAN_METRICS|VELOCITY",
  "KINEMATIC_SEQUENCE|PELVIS",
  "KINEMATIC_SEQUENCE|TORSO",
  "KINEMATIC_SEQUENCE|ARM",
  "SHOULDER_EXTERNAL_ROTATION|MAX",
  "GRF|MID_POINT",
]);

export const HITTING_RADAR_ALLOWLIST = new Set([
  "PROCESSED|Max_Bat_Ang_Vel",
  "PROCESSED|Max_Pelvis_Ang_Vel",
  "PROCESSED|Max_Thorax_Ang_Vel",
  "PROCESSED|Max_Lead_Hand_Ang_Vel",
  "PROCESSED|Max_Lead_Forearm_Ang_Vel",
  "PROCESSED|Pelvis_Shoulders_Separation@Lead_Foot_Down",
  "PROCESSED|Max_RPV_CGPos_VLab_Linear_Vel",
  "PROCESSED|Max_RTA_CGPos_VLab_Linear_Vel",
]);

export const HIGHLIGHTS_EXCLUDE_KEYS = new Set([
  "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS",
  "ABDUCTION_PROGRESS|GAIN_OR_LOSS",
]);

export const PITCHING_TABLE_SECTIONS: PitchingSection[] = [
  {
    id: "velocity",
    title: "Velocity / Score",
    description:
      "Trackman velocity and overall pitching score. Velocity is the primary output metric; score aggregates key kinematic contributors.",
    items: [
      { kind: "metric", key: "TRACKMAN_METRICS|VELOCITY", label: "Velocity" },
      { kind: "metric", key: "SUBJECT_METRICS|SCORE", label: "Score" },
    ],
  },
  {
    id: "lead-leg-grf",
    title: "Lead Leg Block & Ground Reaction Force",
    description:
      "An efficient lead leg block occurs when the front leg is positioned and strong enough to stop forward momentum and redirect force back up the body at ball release. A stronger, more stable block improves energy transfer. Ground reaction force mid-point reflects when peak vertical GRF occurs during the stride — earlier midpoint values generally indicate better energy transfer.",
    items: [
      { kind: "metric", key: "GRF|MID_POINT", label: "GRF Mid-Point" },
      { kind: "metric", key: "FRONT_LEG|EXTENSION", label: "Lead Leg Block" },
      { kind: "metric", key: "FRONT_LEG|FOOT_PLANT", label: "Knee Flexion @ Footplant" },
      { kind: "metric", key: "FRONT_LEG|RELEASE", label: "Knee Flexion @ Release" },
    ],
    insightKeys: ["GRF|MID_POINT", "FRONT_LEG|EXTENSION"],
  },
  {
    id: "pelvis",
    title: "Pelvis Rotation",
    description:
      "The pelvis is a primary driver of velocity. As it rotates toward home plate, it allows the lower half to clear while the upper half stays back. More open at foot contact generally allows better energy transfer up the chain.",
    items: [
      { kind: "metric", key: "PELVIS_ROTATION|FOOT_PLANT", label: "Pelvis @ Footplant" },
      { kind: "metric", key: "PELVIC_OBLIQUITY|TOTAL", label: "Pelvic Obliquity (FP to Release)" },
    ],
    insightKeys: ["PELVIS_ROTATION|FOOT_PLANT"],
  },
  {
    id: "hip-shoulder-separation",
    title: "Hip-Shoulder Separation",
    description:
      "Hip-shoulder separation occurs when the pelvis rotates toward home while the torso remains closed at and shortly after foot contact. This creates stretch across large trunk muscles, allowing stored elastic energy to transfer into the throw.",
    items: [
      { kind: "metric", key: "HIP_SHOULDER_SEPARATION|FOOT_PLANT", label: "HSS @ Footplant" },
      { kind: "derived", derivedId: "MAX_HSS", label: "Max HSS" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS", label: "Gain or Loss" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK", label: "Diff FP to Peak" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", label: "Time to Peak" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE", label: "Rate of Loss" },
    ],
    insightKeys: ["HIP_SHOULDER_SEPARATION|FOOT_PLANT", "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS"],
  },
  {
    id: "torso",
    title: "Torso Position",
    description:
      "The torso connects the lower half to the arm. Staying closed at and shortly after foot contact allows energy to transfer efficiently while reducing stress on the shoulder and elbow.",
    items: [
      { kind: "metric", key: "TRUNK_POSITION|FOOT_PLANT", label: "Torso @ Footplant" },
      { kind: "metric", key: "TOTAL_TRUNK_FLEXION|TOTAL", label: "Total Torso Flexion (FP to Release)" },
      { kind: "metric", key: "LATERAL_TILT|RELEASE", label: "Lateral Tilt @ Release" },
    ],
    insightKeys: ["TRUNK_POSITION|FOOT_PLANT", "LATERAL_TILT|RELEASE"],
  },
  {
    id: "horizontal-abduction",
    title: "Horizontal Abduction (Scap Load)",
    description:
      "Often called \"scap load,\" horizontal abduction allows the arm to properly trail the body down the mound. The key is maintaining sufficient abduction at and shortly after foot contact - this ensures the arm stays synced with the lower half and allows efficient energy transfer. The more scap load maintained through this window, the better.",
    items: [
      { kind: "metric", key: "ABDUCTION|FOOT_PLANT", label: "Abduction @ Footplant" },
      { kind: "metric", key: "ABDUCTION|MAX", label: "Max Abduction" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|GAIN_OR_LOSS", label: "Gain or Loss" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK", label: "Diff FP to Peak" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", label: "Time to Peak" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE", label: "Rate of Loss" },
    ],
    insightKeys: ["ABDUCTION|FOOT_PLANT"],
  },
  {
    id: "shoulder-external-rotation",
    title: "Shoulder External Rotation",
    description:
      "Arm position at foot contact reflects timing. 33-77 degrees = On time; below 33 degrees = Late; above 77 degrees = Early. Being on time allows the arm to sync with the body and reduces stress on the shoulder and elbow. Max external rotation, or layback, reflects mobility and proper sequencing. Ideally >=180 degrees. Adequate layback allows for better velocity while reducing shoulder stress.",
    items: [
      { kind: "metric", key: "SHOULDER_ER|FOOT_PLANT", label: "Shoulder ER @ Footplant" },
      { kind: "derived", derivedId: "ARM_TIMING_FLAG", label: "Arm Timing Flag" },
      { kind: "metric", key: "SHOULDER_EXTERNAL_ROTATION|MAX", label: "Max External Rotation (Layback)" },
    ],
    insightKeys: ["SHOULDER_EXTERNAL_ROTATION|MAX", "SHOULDER_ER|FOOT_PLANT"],
  },
  {
    id: "kinematic-sequence",
    title: "Kinematic Sequence",
    description:
      "Kinematic sequence refers to the order and timing of how body segments accelerate during the throw. Ideally, energy flows from the ground -> hips -> torso -> arm -> ball in a smooth, progressive pattern. Proper sequencing maximizes velocity while minimizing stress.",
    items: [
      { kind: "metric", key: "KINEMATIC_SEQUENCE|PELVIS", label: "Pelvis Ang Velo" },
      { kind: "metric", key: "KINEMATIC_SEQUENCE|TORSO", label: "Torso Ang Velo" },
      { kind: "metric", key: "KINEMATIC_SEQUENCE|ARM", label: "Arm Ang Velo" },
      { kind: "metric", key: "KINEMATIC_SEQUENCE|HAND", label: "Hand Ang Velo" },
    ],
    insightKeys: ["KINEMATIC_SEQUENCE|TORSO"],
  },
];

export const HITTING_TABLE_SECTIONS: HittingSection[] = [
  {
    id: "kinematic-sequence",
    title: "Kinematic Sequence",
    description:
      "Kinematic sequence tracks the order and peak magnitude of segment angular velocities through the swing.",
    items: [
      { key: "PROCESSED|Max_Pelvis_Ang_Vel", label: "Pelvis Velo" },
      { key: "PROCESSED|Max_Thorax_Ang_Vel", label: "Trunk Velo" },
      { key: "PROCESSED|Max_Lead_Forearm_Ang_Vel", label: "Arm Velo" },
      { key: "PROCESSED|Max_Lead_Hand_Ang_Vel", label: "Hand Velo" },
      { key: "PROCESSED|Max_Bat_Ang_Vel", label: "Bat Velo" },
    ],
  },
  {
    id: "bat-attack-and-distance",
    title: "Bat Attack Angles",
    description:
      "Attack angles and travelled distance describe the path and coverage of the bat through contact.",
    items: [
      { key: "PLANE|Horizontal_attack_angle", label: "Horizontal Attack Angle" },
      { key: "PLANE|Vertical_attack_angle", label: "Vertical Attack Angle" },
      { key: "PROCESSED|Bat_travelled_distance_max", label: "Bat Travelled Distance" },
    ],
  },
  {
    id: "bat-contact-angles",
    title: "Bat Angles @ Contact",
    description:
      "Bat orientation at contact captures how the barrel is presented in frontal, sagittal, and transversal planes.",
    items: [
      { key: "PLANE|Bat_Angle_Frontal@Contact", label: "Frontal @ Contact" },
      { key: "PLANE|Bat_Angle_Sagittal@Contact", label: "Sagittal @ Contact" },
      { key: "PLANE|Bat_Angle_Transversal@Contact", label: "Transversal @ Contact" },
    ],
  },
  {
    id: "lead-knee-block",
    title: "Lead Knee Block",
    description:
      "Lead-leg extension captures block quality, followed by lead-knee position at foot contact and at ball contact.",
    items: [
      { key: "PROCESSED|Lead_Knee_Extension", label: "Lead Knee Extension" },
      { key: "PROCESSED|Lead_Knee_Angle@Lead_Foot_Down", label: "Lead Knee Angle @ FC" },
      { key: "PROCESSED|Lead_Knee_Angle@Contact", label: "Lead Knee Angle @ Contact" },
    ],
  },
  {
    id: "pelvis",
    title: "Pelvis",
    description:
      "Pelvis positioning at lead foot down and contact, plus total pelvis rotation across that window.",
    items: [
      { key: "PROCESSED|Pelvis_Angle@Lead_Foot_Down", label: "Pelvis @ Lead Foot Down" },
      { key: "PROCESSED|Pelvis_Angle@Contact", label: "Pelvis @ Contact" },
      { key: "PROCESSED|Pelvis_Total_Rotation", label: "Total Pelvis Rotation" },
    ],
  },
  {
    id: "hip-shoulder-separation",
    title: "Hip-Shoulder Separation",
    description:
      "Separation values across key swing events show how the pelvis and trunk load/unload through the motion.",
    items: [
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Setup", label: "Separation @ Setup" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Lead_Foot_Down", label: "Separation @ Lead Foot Down" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Downswing", label: "Separation @ Downswing" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel", label: "Separation @ Max Bat Velo" },
      {
        key: "PROCESSED|Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel",
        label: "Separation @ Max Hand Velo",
      },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Contact", label: "Separation @ Contact" },
    ],
  },
  {
    id: "trunk",
    title: "Trunk",
    description:
      "Trunk positioning at lead foot down and contact, plus total trunk rotation across that window.",
    items: [
      { key: "PROCESSED|Trunk_Angle@Lead_Foot_Down", label: "Trunk @ Lead Foot Down" },
      { key: "PROCESSED|Trunk_Angle@Contact", label: "Trunk @ Contact" },
      { key: "PROCESSED|Trunk_Total_Rotation", label: "Total Trunk Rotation" },
    ],
  },
  {
    id: "stride-width",
    title: "Stride Width",
    description:
      "Stride width at lead foot down helps contextualize lower-half positioning and base stability.",
    items: [
      { key: "PROCESSED|Stride_Width@Lead_Foot_Down", label: "Stride Width @ Lead Foot Down" },
    ],
  },
];

// ── Athletic Screen ───────────────────────────────────────────────────────────

export const ATHLETIC_SCREEN_MOVEMENT_ORDER = ["DJ", "PPU", "CMJ", "SLV"] as const;

export const ATHLETIC_SCREEN_VARIABLE_ORDER = [
  "JH", "PP", "Work (AUC)", "Kurtosis", "Max RPD", "Time to Max RPD", "RSI", "CT",
] as const;

export const ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS: Record<string, string> = {
  JH: "Jump height; higher generally indicates better explosive output.",
  PP: "Peak power; maximum power generated during the movement.",
  "Work (AUC)": "Total mechanical energy produced during the movement.",
  Kurtosis: "Shape descriptor of the power-time curve.",
  "Max RPD": "Peak slope of the power-time curve from 10–90% of peak power.",
  "Time to Max RPD": "Time elapsed from movement start to peak rate of power development.",
  RSI: "Reactive Strength Index; jump outcome relative to contact time.",
  CT: "Contact time during the drop jump.",
};

export const ATHLETIC_SCREEN_VARIABLE_DETAIL: Partial<Record<string, AthleticVariableDetail>> = {
  "Work (AUC)": {
    formula: "Time integral of the power curve (Joules) — area under the power-time trace.",
    what: "Captures both how much power was produced and how long it was sustained. Two athletes can share the same peak power but differ wildly in AUC if one sustains output and the other spikes then drops. Higher AUC means more total mechanical energy delivered to the system.",
    benchmarks: "Values are movement-specific and not directly comparable across DJ, CMJ, PPU, and SLV. Rising AUC across sessions for the same movement indicates improved power endurance or better force application timing. In the DJ the contact phase is brief so AUC reflects explosive efficiency under constraint; in the CMJ the longer propulsion window typically yields higher AUC.",
    characterizes: "Total energy output quality — the interaction of amplitude and duration. Pair with Max RPD: high RPD + high AUC = explosive and sustained; high RPD + low AUC = explosive but brief. Low AUC relative to PP suggests the athlete peaks early and decays quickly.",
  },
  Kurtosis: {
    formula: "Fourth standardized moment of the power-time distribution. Measures the 'peakedness' vs flatness of the curve.",
    what: "High kurtosis → the power curve has a sharp, narrow spike; power is concentrated at one specific moment. Low kurtosis → power is spread more evenly across the movement. Neither is inherently better — it depends on the movement and what you are training.",
    benchmarks: "DJ and SLV tend to naturally produce higher kurtosis due to the short, reactive nature of the effort. CMJ typically has lower kurtosis as the longer amortization phase spreads power across more time. PPU kurtosis reflects upper-body explosive strategy. Sudden unexplained drops in kurtosis for a given movement may indicate fatigue-driven changes in motor strategy.",
    characterizes: "The shape and concentration of force application. When paired with Max RPD it reveals whether explosive capacity is channeled into a single high-intensity spike (DJ/sprint-like) or distributed across a broader propulsion window (CMJ/strength-dominant). Useful for profiling sport-specific force strategies and detecting session-to-session motor pattern shifts.",
  },
  "Max RPD": {
    formula: "Peak slope of the power-time curve, calculated between 10% and 90% of peak power (W/s).",
    what: "Measures how fast the athlete ramps up power — the steepness of the rising edge of the power curve. It is primarily a neural quality: motor unit recruitment speed, synchronization, and rate coding. High peak power with low RPD means the athlete gets there eventually but too slowly for reactive sport demands.",
    benchmarks: "RPD values differ substantially across movements — DJ and SLV produce the steepest ramps due to the reactive constraint; CMJ allows a slower build; PPU reflects upper-body neural drive. Always compare within the same movement across sessions. Consistent improvement in DJ Max RPD is one of the strongest indicators of plyometric development.",
    characterizes: "Neural drive and explosive onset. RPD ≈ 'How fast can you turn power on?' Directly relevant to DJ and SLV where the ground contact window leaves no time for a slow ramp. An athlete can have elite PP and AUC but underperform in reactive tasks if RPD is low.",
  },
  "Time to Max RPD": {
    formula: "Milliseconds from movement initiation to the instant of peak rate of power development.",
    what: "Shorter time means the explosive peak arrives sooner. This reflects how quickly the nervous system can coordinate peak motor unit recruitment. It is particularly meaningful in the DJ and SLV where the entire contact phase may last only 150–250 ms.",
    benchmarks: "In the DJ, Time to Max RPD must be very short to occur within the contact window — values that exceed contact time indicate the athlete is not producing their explosive peak on the ground at all. In CMJ and PPU, somewhat longer times are expected and appropriate. Shorter Time to Max RPD combined with high Max RPD = elite explosive profile.",
    characterizes: "The accessibility and immediacy of explosive output. Complements Max RPD: the RPD value is the ceiling, Time to Max RPD is how fast you reach it. An athlete with high RPD but long Time to Max RPD has the capacity but cannot access it reactively — a gap that shows up in DJ performance and sport-specific acceleration tasks.",
  },
  RSI: {
    formula: "RSI = Jump Height ÷ Contact Time. Reported on a 0–5 scale (values are multiplied by 2 to amplify resolution).",
    what: "Combines jump outcome with ground contact efficiency into a single ratio. Quantifies the stretch-shortening cycle (SSC) — the ability to store elastic energy on impact and release it as propulsive force. Higher RSI means more output achieved in less time on the ground. Because values are scaled ×2, the displayed number is twice the raw ratio.",
    benchmarks: "On this scaled 0–5 system: ~3.0 represents a solid competitive athlete baseline; values above 4.0 are typically elite-level reactive capacity; values below 2.0 may indicate SSC deficits or elevated fatigue. RSI applies primarily to DJ and SLV where a reactive constraint is present. CMJ and PPU RSI should be interpreted with caution as the movement is not reactive.",
    characterizes: "Tendon stiffness, elastic energy utilization, and reactive neuromuscular efficiency. RSI is distinct from peak power — an athlete can be very powerful (high PP, high AUC) but have poor RSI if they are slow off the ground. It is the most direct measure of plyometric and reactive capacity in this screen, and often the most sensitive to fatigue.",
  },
};

export const ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER = [
  "DJ", "CMJ", "PPU", "SLV_Left", "SLV_Right",
] as const;

export const ATHLETIC_SCREEN_CATEGORY_LABELS: Record<string, string> = {
  CMJ: "CMJ", DJ: "DJ", PPU: "PPU", SLV_Left: "SLV Left", SLV_Right: "SLV Right",
};
