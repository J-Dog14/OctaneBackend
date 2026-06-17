ALTER TABLE analytics.d_athletes
  ADD COLUMN IF NOT EXISTS app_db_last_sent_sessions JSONB;
