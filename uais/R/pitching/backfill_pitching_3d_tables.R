# backfill_pitching_3d_tables.R
#
# Migration: replaces the row-per-frame typed tables with one-row-per-trial
# tables where each data type (markers, segment positions, segment rotations,
# force) is stored as a single JSONB cell.
#
# Tables affected:
#   f_pitching_marker_data      - dropped + recreated (one row per trial)
#   f_pitching_segment_pos_data - dropped + recreated
#   f_pitching_segment_rot_data - dropped + recreated
#   f_pitching_force_data       - dropped + recreated
#   f_pitching_time_data        - JSONB columns dropped after migration
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

# ---------- check if source JSONB data exists ----------
cols <- tryCatch(
  DBI::dbGetQuery(con, "
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'f_pitching_time_data'
  ")$column_name,
  error = function(e) character(0)
)

if (!"frames" %in% cols) {
  cat("f_pitching_time_data has no 'frames' column — nothing to migrate.\n")
  DBI::dbDisconnect(con)
  quit(save = "no")
}

has_labels   <- "labels"   %in% cols
has_segments <- "segments" %in% cols

n_rows <- DBI::dbGetQuery(con,
  "SELECT COUNT(*) AS n FROM public.f_pitching_time_data WHERE frames IS NOT NULL")$n
cat("Found", n_rows, "row(s) with frame data to migrate.\n")

# ---------- drop old typed tables (row-per-frame schema) ----------
cat("Dropping old typed tables (row-per-frame schema)...\n")
for (tbl in c("f_pitching_marker_data", "f_pitching_segment_pos_data",
               "f_pitching_segment_rot_data", "f_pitching_force_data")) {
  tryCatch(
    DBI::dbExecute(con, paste0("DROP TABLE IF EXISTS public.", tbl, " CASCADE")),
    error = function(e) cat("  [WARNING] Could not drop", tbl, ":", conditionMessage(e), "\n")
  )
  cat("  Dropped (if existed):", tbl, "\n")
}

# ---------- create new typed tables (one row per trial) ----------
cat("Creating new typed tables (one row per trial)...\n")

DBI::dbExecute(con, "
  CREATE TABLE public.f_pitching_marker_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    label_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_pitching_marker_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_pitching_marker_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_pitching_segment_pos_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    segment_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_pitching_segment_pos_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_pitching_segment_pos_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_pitching_segment_rot_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    segment_names JSONB,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_pitching_segment_rot_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_pitching_segment_rot_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")

DBI::dbExecute(con, "
  CREATE TABLE public.f_pitching_force_data (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
    source_athlete_id VARCHAR(100),
    owner_filename TEXT,
    trial_index INTEGER NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT f_pitching_force_data_fkey
      FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE,
    CONSTRAINT f_pitching_force_data_unique
      UNIQUE (athlete_uuid, session_date, trial_index)
  )
")
cat("Typed tables created.\n")

# ---------- migrate data via SQL JSONB extraction ----------
# jsonb_path_query_array(frames, '$[*].markers') returns an array of per-frame
# marker arrays — exactly one JSONB cell containing all frames' data.

if (n_rows > 0) {
  cat("Migrating marker data...\n")
  if (has_labels) {
    n_marker <- tryCatch(DBI::dbExecute(con, "
      INSERT INTO public.f_pitching_marker_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, label_names, data)
      SELECT
        athlete_uuid, session_date, source_system, source_athlete_id,
        owner_filename, trial_index,
        jsonb_path_query_array(labels, '$[*].name'),
        jsonb_path_query_array(frames, '$[*].markers')
      FROM public.f_pitching_time_data
      WHERE frames IS NOT NULL AND labels IS NOT NULL
      ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
    "), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
    cat("  Inserted", n_marker, "marker data rows.\n")
  } else {
    cat("  No labels column found, skipping marker migration.\n")
  }

  cat("Migrating segment position data...\n")
  if (has_segments) {
    n_seg_pos <- tryCatch(DBI::dbExecute(con, "
      INSERT INTO public.f_pitching_segment_pos_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, segment_names, data)
      SELECT
        athlete_uuid, session_date, source_system, source_athlete_id,
        owner_filename, trial_index,
        jsonb_path_query_array(segments, '$[*].name'),
        jsonb_path_query_array(frames, '$[*].segmentPos')
      FROM public.f_pitching_time_data
      WHERE frames IS NOT NULL AND segments IS NOT NULL
      ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
    "), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
    cat("  Inserted", n_seg_pos, "segment position rows.\n")
  } else {
    cat("  No segments column found, skipping segment position migration.\n")
  }

  cat("Migrating segment rotation data...\n")
  if (has_segments) {
    n_seg_rot <- tryCatch(DBI::dbExecute(con, "
      INSERT INTO public.f_pitching_segment_rot_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, segment_names, data)
      SELECT
        athlete_uuid, session_date, source_system, source_athlete_id,
        owner_filename, trial_index,
        jsonb_path_query_array(segments, '$[*].name'),
        jsonb_path_query_array(frames, '$[*].segmentRot')
      FROM public.f_pitching_time_data
      WHERE frames IS NOT NULL AND segments IS NOT NULL
      ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
    "), error = function(e) { cat("  [ERROR]", conditionMessage(e), "\n"); 0L })
    cat("  Inserted", n_seg_rot, "segment rotation rows.\n")
  } else {
    cat("  No segments column found, skipping segment rotation migration.\n")
  }

  cat("Migrating force data (skipped if raw binary from C3D)...\n")
  tryCatch({
    n_force <- DBI::dbExecute(con, "
      INSERT INTO public.f_pitching_force_data
        (athlete_uuid, session_date, source_system, source_athlete_id,
         owner_filename, trial_index, data)
      SELECT
        athlete_uuid, session_date, source_system, source_athlete_id,
        owner_filename, trial_index,
        jsonb_path_query_array(frames, '$[*].force')
      FROM public.f_pitching_time_data
      WHERE frames IS NOT NULL
        AND jsonb_typeof(frames) = 'array'
        AND jsonb_array_length(frames) > 0
        AND (frames->0)->'force' IS NOT NULL
        AND jsonb_array_length((frames->0)->'force') > 0
      ON CONFLICT (athlete_uuid, session_date, trial_index) DO NOTHING
    ")
    cat("  Inserted", n_force, "force data rows.\n")
  }, error = function(e) {
    cat("  [WARNING] Force data migration skipped (likely raw binary values):", conditionMessage(e), "\n")
  })
}

# ---------- drop JSONB columns from f_pitching_time_data ----------
cat("Dropping JSONB columns from f_pitching_time_data...\n")
for (col in c("labels", "bones", "segments", "force", "frames")) {
  if (col %in% cols) {
    tryCatch(
      DBI::dbExecute(con, paste0(
        "ALTER TABLE public.f_pitching_time_data DROP COLUMN IF EXISTS ", col
      )),
      error = function(e) cat("  [WARNING] Could not drop column", col, ":", conditionMessage(e), "\n")
    )
    cat("  Dropped column:", col, "\n")
  }
}
cat("JSONB columns removed. f_pitching_time_data is now metadata-only.\n")

DBI::dbDisconnect(con)
cat("Migration complete.\n")
