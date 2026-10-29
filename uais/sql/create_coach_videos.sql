-- Video Hub (coach suite → Video Hub, /coach/videos, and each athlete's Videos tab).
--
-- Metadata only. The video files live in R2 under videos/<athlete_uuid>/<id>.<ext>;
-- Neon never stores video bytes.
--
-- Rules the app enforces (lib/videos/rules.ts) and this file backs up:
--   * At most coach.athlete_video_limit() ready videos per athlete (5).
--   * The athlete's oldest clip (by recorded date) is the baseline and is never rotated out.
--     When a 6th clip is saved, the oldest non-baseline clip is rotated out, so an athlete
--     always has: baseline + the 4 most recent.
--   * Coaches can upload, edit and delete VIDEOS. Nothing here can delete an athlete:
--     the FK is ON DELETE RESTRICT, and deleting a video is a soft delete of this row
--     plus removal of its R2 object.
--
-- Additive and idempotent: safe to run more than once, before or after a deploy.
--   npm run videos:setup
--   (= npx prisma db execute --file uais/sql/create_coach_videos.sql --schema prisma/schema.prisma)
-- Not a Prisma migration: don't run `prisma migrate dev` (the coach schema would look like drift).

CREATE SCHEMA IF NOT EXISTS coach;

CREATE OR REPLACE FUNCTION coach.athlete_video_limit() RETURNS INT
    LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE TABLE IF NOT EXISTS coach.athlete_videos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_uuid      VARCHAR(36) NOT NULL
                          REFERENCES analytics.d_athletes (athlete_uuid)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
    category          TEXT NOT NULL CHECK (category IN ('Pitching', 'Hitting')),
    title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    notes             TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
    recorded_date     DATE NOT NULL,

    -- The original file, kept byte-for-byte (no transcoding).
    filename          TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
    mime              TEXT NOT NULL CHECK (mime IN ('video/mp4', 'video/quicktime', 'video/webm')),
    size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0),
    object_key        TEXT NOT NULL UNIQUE,

    -- pending: row made, browser is uploading to R2. ready: verified and visible.
    -- deleted: removed by a coach, rotated out by the cap, or an upload that never finished.
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')),
    client_key        UUID NOT NULL UNIQUE,     -- idempotency key from the browser (retries never duplicate)
    replace_targets   UUID[] NOT NULL DEFAULT '{}', -- clips the coach agreed to rotate out when this one saves

    uploaded_by       TEXT NOT NULL,            -- Clerk user id
    uploaded_by_name  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at          TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT,
    deleted_at        TIMESTAMPTZ,
    deleted_by        TEXT,
    deleted_by_name   TEXT,
    delete_reason     TEXT CHECK (delete_reason IN ('coach', 'rotated', 'abandoned')),
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_athlete_videos_ready
    ON coach.athlete_videos (athlete_uuid, recorded_date, created_at) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_athlete_videos_pending
    ON coach.athlete_videos (created_at) WHERE status = 'pending';

-- Audit log: who uploaded, edited, rotated or deleted what.
CREATE TABLE IF NOT EXISTS coach.athlete_video_events (
    id            BIGSERIAL PRIMARY KEY,
    video_id      UUID NOT NULL REFERENCES coach.athlete_videos (id) ON DELETE CASCADE,
    athlete_uuid  VARCHAR(36) NOT NULL,
    action        TEXT NOT NULL,            -- upload | edit | delete | rotate | abandon
    actor         TEXT NOT NULL,
    actor_name    TEXT,
    detail        JSONB,
    at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_athlete_video_events_video ON coach.athlete_video_events (video_id);

-- Backstop for the cap: a clip can only become ready while the athlete has room.
-- The app rotates the old clip out (status -> deleted) earlier in the same transaction.
CREATE OR REPLACE FUNCTION coach.athlete_videos_enforce_limit() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    n INT;
BEGIN
    IF NEW.status = 'ready' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ready') THEN
        PERFORM pg_advisory_xact_lock(hashtext('coach.athlete_videos:' || NEW.athlete_uuid));
        SELECT count(*) INTO n FROM coach.athlete_videos
         WHERE athlete_uuid = NEW.athlete_uuid AND status = 'ready' AND id <> NEW.id;
        IF n >= coach.athlete_video_limit() THEN
            RAISE EXCEPTION 'athlete % already has % videos (limit %)', NEW.athlete_uuid, n, coach.athlete_video_limit()
                USING ERRCODE = 'check_violation', CONSTRAINT = 'athlete_videos_limit';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_athlete_videos_limit ON coach.athlete_videos;
CREATE TRIGGER trg_athlete_videos_limit
    BEFORE INSERT OR UPDATE OF status ON coach.athlete_videos
    FOR EACH ROW EXECUTE FUNCTION coach.athlete_videos_enforce_limit();
