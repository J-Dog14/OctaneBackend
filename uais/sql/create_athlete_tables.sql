-- UAIS App Database Schema
-- Source of truth for athlete identity

-- Athletes Table
CREATE TABLE IF NOT EXISTS athletes (
    athlete_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date_of_birth TEXT,
    gender TEXT,
    height REAL,
    weight REAL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_athletes_name ON athletes(name);
CREATE INDEX IF NOT EXISTS idx_athletes_email ON athletes(email);

-- Source Athlete Map Table
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

