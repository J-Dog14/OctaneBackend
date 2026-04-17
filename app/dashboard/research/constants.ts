export const TABLE_OPTIONS = [
  { value: "pitching",              label: "Pitching (Trials)" },
  { value: "hitting",               label: "Hitting (Trials)" },
  { value: "athletic_screen_cmj",   label: "Athletic Screen — CMJ" },
  { value: "athletic_screen_dj",    label: "Athletic Screen — Drop Jump" },
  { value: "athletic_screen_slv",   label: "Athletic Screen — Single Leg Vert" },
  { value: "athletic_screen_nmt",   label: "Athletic Screen — Neuromuscular" },
  { value: "athletic_screen_ppu",   label: "Athletic Screen — Push-up Power" },
  { value: "mobility",              label: "Mobility" },
  { value: "pro_sup",               label: "Pro-Sup" },
  { value: "proteus",               label: "Proteus" },
  { value: "readiness_screen_cmj",  label: "Readiness Screen — CMJ" },
  { value: "readiness_screen_i",    label: "Readiness Screen — I" },
  { value: "readiness_screen_ir90", label: "Readiness Screen — IR90" },
  { value: "readiness_screen_ppu",  label: "Readiness Screen — PPU" },
  { value: "readiness_screen_t",    label: "Readiness Screen — T" },
  { value: "readiness_screen_y",    label: "Readiness Screen — Y" },
];

export const TS_TABLE_OPTIONS = [
  { value: "pitching_force",       label: "Pitching — Force Data"        },
  { value: "pitching_markers",     label: "Pitching — Marker Positions"  },
  { value: "pitching_segment_pos", label: "Pitching — Segment Positions" },
  { value: "pitching_segment_rot", label: "Pitching — Segment Rotations" },
  { value: "hitting_markers",      label: "Hitting — Marker Positions"   },
  { value: "hitting_segment_pos",  label: "Hitting — Segment Positions"  },
  { value: "hitting_segment_rot",  label: "Hitting — Segment Rotations"  },
];

export const TS_TABLE_LABEL: Record<string, string> = Object.fromEntries(
  TS_TABLE_OPTIONS.map((o) => [o.value, o.label]),
);

export const GROUP_CHECKBOXES = [
  { value: "pro",         label: "Pro" },
  { value: "college",     label: "College" },
  { value: "high_school", label: "High School" },
  { value: "softball",    label: "Softball" },
];

export const GROUP_OPTIONS = [
  { value: "all",         label: "All Groups" },
  { value: "pro",         label: "Pro" },
  { value: "college",     label: "College" },
  { value: "high_school", label: "High School" },
  { value: "softball",    label: "Softball" },
];
