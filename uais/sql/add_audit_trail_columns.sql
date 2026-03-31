-- Migration: Add audit trail columns to all warehouse fact tables
-- Run once against the live warehouse database.
-- source_file:      the original uploaded filename (or local path) that generated this row
-- upload_batch_id:  the UPLOAD_BATCH_ID env var injected by runJob.ts for this pipeline run
--                   format: ISO-timestamp-uuid (e.g. 2026-03-31T12-00-00-000Z-<uuid>)
-- Both columns default to NULL; existing rows stay NULL until the backfill script is run.

-- Athletic Screen sub-tables
ALTER TABLE public.f_athletic_screen_cmj  ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_athletic_screen_cmj  ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_athletic_screen_dj   ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_athletic_screen_dj   ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_athletic_screen_ppu  ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_athletic_screen_ppu  ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_athletic_screen_slv  ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_athletic_screen_slv  ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_athletic_screen_nmt  ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_athletic_screen_nmt  ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Readiness Screen
ALTER TABLE public.f_readiness_screen     ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen     ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_readiness_screen_i   ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen_i   ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_readiness_screen_y   ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen_y   ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_readiness_screen_t   ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen_t   ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_readiness_screen_ir90 ADD COLUMN IF NOT EXISTS source_file     TEXT;
ALTER TABLE public.f_readiness_screen_ir90 ADD COLUMN IF NOT EXISTS upload_batch_id TEXT;

ALTER TABLE public.f_readiness_screen_cmj ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen_cmj ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_readiness_screen_ppu ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_readiness_screen_ppu ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Pro-Sup Test
ALTER TABLE public.f_pro_sup              ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_pro_sup              ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Arm Action
ALTER TABLE public.f_arm_action           ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_arm_action           ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Curveball Test
ALTER TABLE public.f_curveball_test       ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_curveball_test       ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Mobility
ALTER TABLE public.f_mobility             ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_mobility             ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Proteus
ALTER TABLE public.f_proteus              ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_proteus              ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

-- Pitching / Hitting
ALTER TABLE public.f_pitching_trials      ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_pitching_trials      ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_hitting_trials       ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_hitting_trials       ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_kinematics_pitching  ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_kinematics_pitching  ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;

ALTER TABLE public.f_kinematics_hitting   ADD COLUMN IF NOT EXISTS source_file      TEXT;
ALTER TABLE public.f_kinematics_hitting   ADD COLUMN IF NOT EXISTS upload_batch_id  TEXT;
