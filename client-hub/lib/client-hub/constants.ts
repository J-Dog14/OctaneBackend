// Every threshold the original Client Hub used, in one place.

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

/** 8ctane's programming alerts only look this far ahead. No alert = programmed beyond it. */
export const COVERAGE_HORIZON_DAYS = 30;
/** Sentinel days value for "programmed past the horizon". */
export const COVERAGE_BEYOND_HORIZON = 999;
/** Sentinel days value for "program exists but nothing is scheduled". */
export const NOTHING_SCHEDULED = -1;
/** Sort weight for clients with no coverage number (unlinked, no program). */
export const NO_COVERAGE_SORT = 500;

/** A linked, active client is re-read from 8ctane at most this often. */
export const SYNC_MAX_AGE_HOURS = 6;
/** Calendar reads in flight at once during a sync. */
export const SYNC_CONCURRENCY = 2;
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

export const PHASES = [
  'Onboarding',
  'Off-season build',
  'Velo block',
  'Pre-season ramp',
  'In-season',
  'Deload / recovery',
  'Return to throw',
] as const;

/** Which 8ctane activity kind moves which "updated" date. */
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
  hitting: 'Hit',
  prep: 'Prep',
  bulletProofing: 'Arm care',
  movementEnhancement: 'Movement',
};
