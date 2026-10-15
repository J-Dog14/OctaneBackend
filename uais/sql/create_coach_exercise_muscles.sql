-- Coach overrides for the Program tab's body heat map (lib/coach/programMuscles.ts).
-- The 8ctane app's Exercise table has no muscle data; the backend maps exercises to
-- muscles by name rules, and a row here (keyed by the exercise name) replaces that.
-- Muscle ids: neck traps front_delts rear_delts rotator_cuff chest biceps triceps
-- forearms abs obliques lats upper_back lower_back glutes abductors adductors
-- hip_flexors quads hamstrings calves
CREATE SCHEMA IF NOT EXISTS coach;

CREATE TABLE IF NOT EXISTS coach.exercise_muscles (
    exercise_name     TEXT PRIMARY KEY,       -- matched case/punctuation-insensitively
    primary_muscles   TEXT[] NOT NULL DEFAULT '{}',
    secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
    notes             TEXT,
    updated_by        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Example:
-- INSERT INTO coach.exercise_muscles (exercise_name, primary_muscles, secondary_muscles)
-- VALUES ('Banded Hip Airplane', '{glutes,abductors}', '{obliques}')
-- ON CONFLICT (exercise_name) DO UPDATE SET primary_muscles = EXCLUDED.primary_muscles,
--   secondary_muscles = EXCLUDED.secondary_muscles, updated_at = now();
