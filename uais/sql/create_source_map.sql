-- UAIS Source Athlete Map Schema
-- Maps legacy source system IDs to athlete_uuid

CREATE TABLE IF NOT EXISTS source_athlete_map (
    source_system TEXT NOT NULL,
    source_athlete_id TEXT NOT NULL,
    athlete_uuid TEXT NOT NULL,
    created_at TIMESTAMP,
    PRIMARY KEY (source_system, source_athlete_id),
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

CREATE INDEX IF NOT EXISTS idx_source_map_uuid ON source_athlete_map(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_source_map_system ON source_athlete_map(source_system);
CREATE INDEX IF NOT EXISTS idx_source_map_source_id ON source_athlete_map(source_athlete_id);

