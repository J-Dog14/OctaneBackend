-- Add scoring_tier column to track which scoring method was used for a readiness session.
-- Valid values: FIRST_RUN (0 prior sessions), A_TO_B (1 prior session), READINESS (2+ prior sessions).
-- NULL on historical rows; treated as READINESS by the dashboard.

ALTER TABLE public.f_readiness_screen_score
    ADD COLUMN IF NOT EXISTS scoring_tier VARCHAR(16);
