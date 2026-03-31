suppressPackageStartupMessages({ library(DBI); library(RPostgres) })

find_and_source_common <- function() {
  for (path in c(
    file.path(getwd(), "R", "common", "config.R"),
    file.path(getwd(), "..", "R", "common", "config.R"),
    file.path("..", "common", "config.R")
  )) {
    if (file.exists(path)) { source(normalizePath(path)); return() }
  }
  stop("config not found")
}
find_and_source_common()
con <- get_warehouse_connection()

cat("=== ROW COUNTS ===\n")
for (tbl in c("f_pitching_marker_data", "f_pitching_segment_pos_data",
              "f_pitching_segment_rot_data", "f_pitching_force_data",
              "f_hitting_marker_data", "f_hitting_segment_pos_data",
              "f_hitting_segment_rot_data", "f_hitting_3d_trials")) {
  n <- tryCatch(
    DBI::dbGetQuery(con, paste0("SELECT COUNT(*) AS n FROM public.", tbl))$n,
    error = function(e) paste("ERROR:", conditionMessage(e))
  )
  cat(sprintf("  %-40s %s rows\n", tbl, n))
}

cat("\n=== PITCHING MARKER SAMPLE (first 3 trials) ===\n")
r <- DBI::dbGetQuery(con, "
  SELECT
    id,
    owner_filename,
    trial_index,
    jsonb_array_length(label_names) AS num_markers,
    jsonb_array_length(data)        AS num_frames,
    label_names->0                  AS first_marker_name,
    label_names->1                  AS second_marker_name,
    data->0->0                      AS frame0_marker0_xyz,
    data->0->1                      AS frame0_marker1_xyz
  FROM public.f_pitching_marker_data
  ORDER BY id LIMIT 3
")
print(r)

cat("\n=== PITCHING SEGMENT ROT SAMPLE ===\n")
r2 <- DBI::dbGetQuery(con, "
  SELECT
    id,
    owner_filename,
    trial_index,
    jsonb_array_length(segment_names) AS num_segments,
    jsonb_array_length(data)          AS num_frames,
    segment_names->0                  AS first_segment,
    data->0->0                        AS frame0_seg0_rot_xyz
  FROM public.f_pitching_segment_rot_data
  ORDER BY id LIMIT 3
")
print(r2)

cat("\n=== HITTING MARKER SAMPLE (first 3 trials) ===\n")
r3 <- DBI::dbGetQuery(con, "
  SELECT
    id,
    owner_filename,
    trial_index,
    jsonb_array_length(label_names) AS num_markers,
    jsonb_array_length(data)        AS num_frames,
    label_names->0                  AS first_marker_name,
    data->0->0                      AS frame0_marker0_xyz
  FROM public.f_hitting_marker_data
  ORDER BY id LIMIT 3
")
print(r3)

DBI::dbDisconnect(con)
cat("\nValidation complete.\n")
