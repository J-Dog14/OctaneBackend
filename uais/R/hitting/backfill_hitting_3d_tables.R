# backfill_hitting_3d_tables.R
#
# Migration: replaces the row-per-frame typed tables with one-row-per-trial
# tables where each data type (markers, segment positions, segment rotations,
# force) is stored as a single JSONB cell.
#
# Source: f_hitting_trials rows where owner_filename ILIKE '%3d-data%'
#         (the full JSON is stored in the metrics JSONB column)
#
# Tables affected:
#   f_hitting_marker_data      - dropped + recreated (one row per trial)
#   f_hitting_segment_pos_data - dropped + recreated
#   f_hitting_segment_rot_data - dropped + recreated
#   f_hitting_force_data       - dropped + recreated
#   f_hitting_3d_trials        - dropped + recreated (metadata header)
#
# Run ONCE. Safe to re-run (all inserts use ON CONFLICT DO NOTHING).

suppressPackageStartupMessages({
  library(DBI)
  library(RPostgres)
})

# ---------- connection ----------
find_and_source_common <- function() {
  possible_config_paths <- c(
    file.path(getwd(), "R", "common", "config.R"),
    file.path(getwd(), "..", "R", "common", "config.R"),
    file.path("..", "common", "config.R"),
    file.path("..", "..", "R", "common", "config.R"),
    file.path(dirname(getwd()), "R", "common", "config.R")
  )
  config_path <- NULL
  for (path in possible_config_paths) {
    if (file.exists(path)) { config_path <- normalizePath(path); break }
  }
  if (is.null(config_path)) stop("Could not find R/common/config.R")
  source(config_path)
  db_utils_path <- file.path(dirname(config_path), "db_utils.R")
  if (file.exists(db_utils_path)) source(db_utils_path)
}
find_and_source_common()

con <- get_warehouse_connection()
cat("Connected to warehouse.\n")

# ---------- check if source data exists ----------
n_rows <- tryCatch(
  DBI::dbGetQuery(con, "
    SELECT COUNT(*) AS n FROM public.f_hitting_trials
    WHERE owner_filename ILIKE '%3d-data%' AND metrics IS NOT NULL
  ")$n,
  error = function(e) { cat("f_hitting_trials not found or inaccessible.\n"); 0L }
)
cat("Found", n_rows, "3D row(s) in f_hitting_trials to migrate.\n")

# ---------- drop old typed tables ----------
cat("Dropping old typed tables...\n")
for (tbl in c("f_hitting_marker_data", "f_hitting_segment_pos_data",
               "f_hitting_segment_rot_data", "f_hitting_force_data",
               "f_hitting_3d_trials")) {
  tryCatch(
    DBI::dbExecute(con, paste0("DROP TABLE IF EXISTS public.", tbl, " CASCADE")),
    error = function(e) cat("  [WARNING] Could not drop", tbl, ":", conditionMessage(e), "\n")
  )
  cat("  Dropped (if existed):", tbl, "\n")
}

# ---------- create new tables ----------
cat("Creating new tables (one row per trial)...\n")

DBI::dbExecute(con, "
  CREATE TABLE public.f_hitting_3d_trials (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    name VARCHAR(255),
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'hitting',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    age_at_collection NUMERIC,
    age_group TEXT,
    height NUMERIC,
    weight NUMERIC,
    frame_rate NUMERIC,
    start_time NUMERIC,
    end_time NUMERIC,
    session_xml_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_hitting_3d_trials_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_hitting_3d_trials_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_hitting_marker_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'hitting',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    label_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_hitting_marker_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_hitting_marker_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_hitting_segment_pos_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'hitting',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    segment_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_hitting_segment_pos_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_hitting_segment_pos_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_hitting_segment_rot_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'hitting',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    segment_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_hitting_segment_rot_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_hitting_segment_rot_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_hitting_force_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'hitting',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_hitting_force_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_hitting_force_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")
cat("Tables created.\n")

if (n_rows == 0) {
  cat("No 3D rows to migrate. Tables ready for new data.\n")
  DBI::dbDisconnect(con)
  quit(save = "no")
}

# ---------- migrate metadata into f_hitting_3d_trials ----------
cat("Migrating metadata into f_hitting_3d_trials...\n")
n_trials <- tryCatch(DBI::dbExecute(con, "
  INSERT INTO public.f_hitting_3d_trials
    (athlete_uuid, name, session_date, source_system, source_athlete_id,
     owner_filename, trial_index, age_at_collection, age_group,
     height, weight, frame_rate, start_time, end_time, session_xml_path)
  SELECT
    ht.athlete_uuid,
    da.name,
    ht.session_date,
    'hitting',
    ht.source_athlete_id,
    ht.owner_filename,
    ht.trial_index,
    ht.age_at_collection,
    ht.age_group,
    ht.height,
    ht.weight,
    (ht.metrics->>'frameRate')::numeric,
    (ht.metrics->>'startTime')::numeric,
    (ht.metrics->>'endTime')::numeric,
    ht.session_xml_path
  FROM public.f_hitting_trials ht
  LEFT JOIN analytics.d_athletes da ON da.athlete_uuid = ht.athlete_uuid
  WHERE ht.owner_filename ILIKE '%3d-data%' AND ht.metrics IS NOT NULL
  ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
"), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
cat("  Inserted", n_trials, "trial metadata rows.\n")

# ---------- migrate marker data ----------
cat("Migrating marker data...\n")
n_marker <- tryCatch(DBI::dbExecute(con, "
  INSERT INTO public.f_hitting_marker_data
    (athlete_uuid, session_date, source_system, source_athlete_id,
     owner_filename, trial_index, label_names, data)
  SELECT
    athlete_uuid, session_date, 'hitting', source_athlete_id,
    owner_filename, trial_index,
    jsonb_path_query_array(metrics, '$.labels[*].name'),
    jsonb_path_query_array(metrics, '$.frames[*].markers')
  FROM public.f_hitting_trials
  WHERE owner_filename ILIKE '%3d-data%'
    AND metrics IS NOT NULL
    AND metrics->'labels' IS NOT NULL
  ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
"), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
cat("  Inserted", n_marker, "marker data rows.\n")

# ---------- migrate segment position data ----------
cat("Migrating segment position data...\n")
n_seg_pos <- tryCatch(DBI::dbExecute(con, "
  INSERT INTO public.f_hitting_segment_pos_data
    (athlete_uuid, session_date, source_system, source_athlete_id,
     owner_filename, trial_index, segment_names, data)
  SELECT
    athlete_uuid, session_date, 'hitting', source_athlete_id,
    owner_filename, trial_index,
    jsonb_path_query_array(metrics, '$.segments[*].name'),
    jsonb_path_query_array(metrics, '$.frames[*].segmentPos')
  FROM public.f_hitting_trials
  WHERE owner_filename ILIKE '%3d-data%'
    AND metrics IS NOT NULL
    AND metrics->'segments' IS NOT NULL
  ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
"), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
cat("  Inserted", n_seg_pos, "segment position rows.\n")

# ---------- migrate segment rotation data ----------
cat("Migrating segment rotation data...\n")
n_seg_rot <- tryCatch(DBI::dbExecute(con, "
  INSERT INTO public.f_hitting_segment_rot_data
    (athlete_uuid, session_date, source_system, source_athlete_id,
     owner_filename, trial_index, segment_names, data)
  SELECT
    athlete_uuid, session_date, 'hitting', source_athlete_id,
    owner_filename, trial_index,
    jsonb_path_query_array(metrics, '$.segments[*].name'),
    jsonb_path_query_array(metrics, '$.frames[*].segmentRot')
  FROM public.f_hitting_trials
  WHERE owner_filename ILIKE '%3d-data%'
    AND metrics IS NOT NULL
    AND metrics->'segments' IS NOT NULL
  ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
"), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
cat("  Inserted", n_seg_rot, "segment rotation rows.\n")

# ---------- migrate force data ----------
cat("Migrating force data...\n")
tryCatch({
  n_force <- DBI::dbExecute(con, "
    INSERT INTO public.f_hitting_force_data
      (athlete_uuid, session_date, source_system, source_athlete_id,
       owner_filename, trial_index, data)
    SELECT
      athlete_uuid, session_date, 'hitting', source_athlete_id,
      owner_filename, trial_index,
      jsonb_path_query_array(metrics, '$.frames[*].force')
    FROM public.f_hitting_trials
    WHERE owner_filename ILIKE '%3d-data%'
      AND metrics IS NOT NULL
      AND jsonb_typeof(metrics->'frames') = 'array'
      AND jsonb_array_length(metrics->'frames') > 0
      AND (metrics->'frames'->0)->'force' IS NOT NULL
      AND jsonb_array_length((metrics->'frames'->0)->'force') > 0
    ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
  ")
  cat("  Inserted", n_force, "force data rows.\n")
}, error = function(e) {
  cat("  [WARNING] Force data migration skipped:", conditionMessage(e), "\n")
})

DBI::dbDisconnect(con)
cat("Migration complete.\n")
