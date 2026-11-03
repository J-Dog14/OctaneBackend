# ---- Rebuild a trial's 3d-data JSON from the warehouse ----
#
# Ingest stores each trial's per-frame plate forces (f_pitching_force_data.data = frames[[i]]$force),
# segment rotations (f_pitching_segment_rot_data) and timing (f_pitching_time_data). That is everything
# process_force_metrics_for_trial() reads from the JSON, so a reprocess does not need the original
# -3d-data.json files on disk.
force_json_from_parts <- function(force_txt, frame_rate, start_time = 0,
                                  seg_names_txt = NA, seg_rot_txt = NA) {
  force <- jsonlite::parse_json(force_txt, simplifyVector = FALSE)
  rot   <- if (!is.na(seg_rot_txt) && nzchar(seg_rot_txt)) jsonlite::parse_json(seg_rot_txt, simplifyVector = FALSE) else NULL
  segs  <- if (!is.na(seg_names_txt) && nzchar(seg_names_txt)) unlist(jsonlite::parse_json(seg_names_txt)) else character(0)
  frames <- lapply(seq_along(force), function(i) {
    list(force = force[[i]],
         segmentRot = if (!is.null(rot) && i <= length(rot)) rot[[i]] else NULL)
  })
  list(frameRate = as.numeric(frame_rate %||% 300), startTime = as.numeric(start_time %||% 0),
       frames = frames, segments = lapply(segs, function(n) list(name = n)))
}

force_json_from_db <- function(con, athlete_uuid, session_date, trial_index) {
  p <- list(as.character(athlete_uuid), as.character(session_date), as.integer(trial_index))
  fd <- DBI::dbGetQuery(con, "SELECT data::text AS d FROM public.f_pitching_force_data
                               WHERE athlete_uuid=$1 AND session_date=$2 AND trial_index=$3", params = p)
  if (nrow(fd) == 0 || is.na(fd$d[1])) return(NULL)
  td <- DBI::dbGetQuery(con, "SELECT frame_rate, start_time FROM public.f_pitching_time_data
                               WHERE athlete_uuid=$1 AND session_date=$2 AND trial_index=$3", params = p)
  sr <- tryCatch(DBI::dbGetQuery(con, "SELECT segment_names::text AS n, data::text AS d
                               FROM public.f_pitching_segment_rot_data
                               WHERE athlete_uuid=$1 AND session_date=$2 AND trial_index=$3", params = p),
                 error = function(e) data.frame())
  force_json_from_parts(fd$d[1],
                        frame_rate = if (nrow(td)) td$frame_rate[1] else NULL,
                        start_time = if (nrow(td)) td$start_time[1] else 0,
                        seg_names_txt = if (nrow(sr)) sr$n[1] else NA,
                        seg_rot_txt   = if (nrow(sr)) sr$d[1] else NA)
}

