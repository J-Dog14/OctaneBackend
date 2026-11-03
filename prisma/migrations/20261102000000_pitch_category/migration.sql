-- Pitch category for pitching 3D captures (2026-11-02).
--
-- Captures now include non-fastball trials. QTM names them by measurement type:
--   "Fastball ..."      -> fastball
--   "Breaking Ball ..." -> breaking_ball
--   "Off Speed ..."     -> off_speed
--   "Pitch ..."         -> pitch   (non-fastball, type not set in QTM)
--
-- Rule: everything outside the coach hub (Octane app payloads, percentiles,
-- the 8-cylinder cohort, research tools, AI layer) reads fastballs only.
-- f_pitching_trials is the source of truth (written by the R ingest). The
-- per-trial child tables get the same column; 20261103000000_pitch_category_keys
-- makes it part of every table's key and fills it from owner_filename.
-- f_kinematics_pitching stays fastball-only by construction (ingest).
--
-- Idempotent. Existing rows were all fastballs (the ingest skipped anything
-- else), so the 'fastball' default is correct for them.
-- Run with: npm run pitchtype:setup
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('pitch_category_setup'));

ALTER TABLE public.f_pitching_trials
  ADD COLUMN IF NOT EXISTS pitch_category text NOT NULL DEFAULT 'fastball',
  ADD COLUMN IF NOT EXISTS qtm_pitch_type text,
  ADD COLUMN IF NOT EXISTS capture_time timestamp;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'f_pitching_trials_pitch_category_check') THEN
    ALTER TABLE public.f_pitching_trials
      ADD CONSTRAINT f_pitching_trials_pitch_category_check
      CHECK (pitch_category IN ('fastball', 'breaking_ball', 'off_speed', 'pitch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_f_pitching_trials_category
  ON public.f_pitching_trials (athlete_uuid, session_date, pitch_category);

COMMENT ON COLUMN public.f_pitching_trials.pitch_category IS
  'fastball | breaking_ball | off_speed | pitch (from the QTM measurement type). Only fastball leaves the coach hub.';
COMMENT ON COLUMN public.f_pitching_trials.qtm_pitch_type IS
  'session.xml Measurement Pitch_type / Pitch_subtype as typed in QTM (often "Fastball"/"Unspecified").';
COMMENT ON COLUMN public.f_pitching_trials.capture_time IS
  'session.xml Measurement Creation_date + Creation_time (QTM PC local clock, 1 s). Used to sync with TrackMan.';

-- Child tables: same column, filled from f_pitching_trials.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['f_pitching_time_data', 'f_pitching_force_metrics', 'f_pitching_force_data',
                             'f_pitching_marker_data', 'f_pitching_segment_pos_data', 'f_pitching_segment_rot_data'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS pitch_category text NOT NULL DEFAULT ''fastball''', tbl);
    END IF;
  END LOOP;
END $$;

-- (2026-11-03) The trial_index-based sync triggers that were here are gone: trial numbers
-- now count within each category, so the category is part of the key and comes from
-- owner_filename instead. See 20261103000000_pitch_category_keys (npm run pitchtype:keys).

-- Fastball-only view for generic readers (research tools) that take a table name.
CREATE OR REPLACE VIEW public.v_pitching_trials_fastball AS
  SELECT * FROM public.f_pitching_trials WHERE pitch_category = 'fastball';

COMMIT;
