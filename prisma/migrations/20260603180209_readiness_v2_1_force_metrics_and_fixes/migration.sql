-- V2.1 incremental schema changes for Readiness Screen force-file integration.
-- All statements are idempotent / safe to re-run.

-- 1. Widen band column so "INSUFFICIENT_HISTORY" (20 chars) is not truncated
ALTER TABLE public.f_readiness_screen_score
    ALTER COLUMN band TYPE VARCHAR(32);

-- 2. trial_id — tracks which numbered trial a row represents within a session
ALTER TABLE public.f_readiness_screen_cmj
    ADD COLUMN IF NOT EXISTS trial_id INTEGER;

ALTER TABLE public.f_readiness_screen_ppu
    ADD COLUMN IF NOT EXISTS trial_id INTEGER;

-- 3. Force-derived metrics — computed from full-trial vertical GRF (*_Force.txt files)
ALTER TABLE public.f_readiness_screen_cmj
    ADD COLUMN IF NOT EXISTS peak_grf_n            DECIMAL,
    ADD COLUMN IF NOT EXISTS peak_grf_bw_ratio     DECIMAL,
    ADD COLUMN IF NOT EXISTS rfd_0_100ms           DECIMAL,
    ADD COLUMN IF NOT EXISTS concentric_impulse_ns DECIMAL;

ALTER TABLE public.f_readiness_screen_ppu
    ADD COLUMN IF NOT EXISTS peak_grf_n            DECIMAL,
    ADD COLUMN IF NOT EXISTS peak_grf_bw_ratio     DECIMAL,
    ADD COLUMN IF NOT EXISTS rfd_0_100ms           DECIMAL,
    ADD COLUMN IF NOT EXISTS concentric_impulse_ns DECIMAL;
