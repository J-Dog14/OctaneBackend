-- V3D EVENT_LABEL times per pitching trial: seconds from the start of the cropped capture
-- (= marker / force frame index / frame rate), e.g.
--   {"Release": 2.0733, "Max_Shoulder_Rot": 2.04, "Footstrike": 1.9633, "MaxKneeHeight": 1.19, "SETUP": 0.5333, ...}
-- The TIMING.*Time values in f_pitching_trials.metrics are measured from V3D's SETUP event, not from
-- the start of the capture, so they can't place events in the frame data on their own.
-- Written by the R ingest (pitching_processing.R) from now on; existing trials:
--   python python/scripts/backfill_pitching_events.py   (from uais/)
-- Run with: npm run pitchtype:events  (safe to re-run)
ALTER TABLE public.f_pitching_trials ADD COLUMN IF NOT EXISTS events JSONB;
COMMENT ON COLUMN public.f_pitching_trials.events IS 'V3D EVENT_LABEL times (s from start of cropped capture = frame / frame rate). TIMING.*Time metrics are relative to SETUP instead.';
