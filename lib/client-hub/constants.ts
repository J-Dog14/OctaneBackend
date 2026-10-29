// Every threshold the Client Hub uses, in one place.

/** "Today" is a calendar day in the gym's timezone. Railway runs in UTC, so never use the server's local date. */
export const HUB_TIMEZONE = 'America/New_York';

/** Plyos / lifts / delivery updated more than this many days ago → "Updates due" (red). */
export const UPDATE_STALE_DAYS = 42;
/** …and more than this many days ago → amber. */
export const UPDATE_WARN_DAYS = 28;
/** Contract end within this many days (or already past) → "Contract ending". */
export const CONTRACT_WARN_DAYS = 30;
/** Last scheduled day within this many days (or already past) → "Program running out". */
export const PROGRAMMING_WARN_DAYS = 7;
/** Program period ending within this many days → "Program ending". */
export const PERIOD_ENDING_DAYS = 14;
/** No assessment of any kind for this long while active → "Assessment due" (unless a due date is set). */
export const ASSESSMENT_STALE_DAYS = 90;
/** Onboarding auto-ticks count sessions from this many days before the current period started. */
export const ONBOARDING_LOOKBACK_DAYS = 30;

/** The list re-syncs from the snapshot when the last sync is older than this. */
export const SYNC_MAX_AGE_HOURS = 6;
/** Calendar window read per client: today-41 … today+7 (six weeks back, one week ahead). */
export const CALENDAR_LOOKBACK_DAYS = 41;
export const CALENDAR_LOOKAHEAD_DAYS = 7;

/** "New session" detection: ignore the first week of the window (no history to compare against)… */
export const CHANGE_WARMUP_DAYS = 7;
/** …and call a session new if its name wasn't scheduled in the 21 days before it. */
export const CHANGE_LOOKBACK_DAYS = 21;

/** Profile check-off strip length. */
export const STRIP_DAYS = 14;
/** Profile "Next N days" list length. */
export const UPCOMING_DAYS = 7;

/** nameScore (0-100, lib/pitch-intel/match.ts) at or above which a new d_athletes row is NOT created; a coach links instead. 88 = same last name + first initial. */
export const NEAR_DUPLICATE_SCORE = 88;

export const PHASES = [
  'Onboarding',
  'Off-season build',
  'Velo block',
  'Pre-season ramp',
  'In-season',
  'Deload / recovery',
  'Return to throw',
] as const;

export const PROGRAM_TYPES = ['REMOTE', 'HYBRID', 'IN_HOUSE'] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];
export const PROGRAM_TYPE_LABEL: Record<ProgramType, string> = { REMOTE: 'Remote', HYBRID: 'Hybrid', IN_HOUSE: 'In house' };

export const STATUSES = ['active', 'paused', 'expired'] as const;
export type ClientStatus = (typeof STATUSES)[number];

/** Which calendar activity kind moves which "updated" date. */
export const UPDATE_KINDS = {
  updPlyos: 'plyo',
  updLifts: 'lift',
  updDelivery: 'throwing',
} as const;
export type UpdateField = keyof typeof UPDATE_KINDS;
export const UPDATE_FIELDS = Object.keys(UPDATE_KINDS) as UpdateField[];

export const ACTIVITY_LABELS: Record<string, string> = {
  lift: 'Lift',
  plyo: 'Plyo',
  throwing: 'Throw',
  prep: 'Prep',
  bulletproofing: 'Arm care',
  movement: 'Movement',
};

/** Assessment kinds, in the order the hub shows them. `auto` = read from the warehouse. */
export const ASSESSMENT_KINDS = [
  { id: 'athletic_screen', label: 'Athletic screen', auto: true },
  { id: 'mobility', label: 'Mobility', auto: true },
  { id: 'pitching_3d', label: 'Pitching 3D', auto: true },
  { id: 'hitting_3d', label: 'Hitting 3D', auto: true },
  { id: 'arm_action', label: 'Arm action', auto: true },
  { id: 'pro_sup', label: 'Pro/Sup', auto: true },
  { id: 'proteus', label: 'Proteus', auto: true },
  { id: 'readiness', label: 'Readiness', auto: true },
  { id: 'curveball', label: 'Curveball', auto: true },
  { id: 'other', label: 'Other', auto: false },
] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number]['id'];
export const ASSESSMENT_KIND_IDS = ASSESSMENT_KINDS.map((k) => k.id) as AssessmentKind[];

/** Onboarding "Assessment" ticks itself from these kinds, "3D" from these. */
export const ONBOARDING_ASSESSMENT_KINDS: AssessmentKind[] = ['athletic_screen', 'mobility'];
export const ONBOARDING_3D_KINDS: AssessmentKind[] = ['pitching_3d', 'hitting_3d'];
