# Hitting Kinematics Data Preparation
# Similar structure to pitching

library(tidyverse)
source("../common/config.R")
source("../common/db_utils.R")

load_raw_hitting <- function(raw_dir = NULL) {
  if (is.null(raw_dir)) {
    paths <- get_raw_paths()
    raw_dir <- paths$hitting
  }
  
  if (is.null(raw_dir)) {
    stop("Hitting raw data path not configured")
  }
  
  csv_files <- list.files(raw_dir, pattern = "\\.csv$", recursive = TRUE, full.names = TRUE)
  xml_files <- list.files(raw_dir, pattern = "\\.xml$", recursive = TRUE, full.names = TRUE)
  
  if (length(xml_files) > 0) {
    # TODO: Parse XML files
    return(tibble())
  } else if (length(csv_files) > 0) {
    return(read_csv(csv_files, id = "source_file"))
  } else {
    stop(paste("No hitting data files found in", raw_dir))
  }
}

clean_hitting <- function(df) {
  if (nrow(df) == 0) {
    return(df)
  }
  
  clean_df <- df %>%
    rename_all(~str_to_lower(str_replace_all(., " ", "_"))) %>%
    mutate(
      source_athlete_id = coalesce(name, athlete_name, athlete_id),
      session_date = as.Date(coalesce(date, test_date, session_date))
    )
  
  # Attach athlete_uuid using source_athlete_map
  app_conn <- get_app_connection()
  source_map <- read_table(app_conn, "source_athlete_map") %>%
    filter(source_system == "hitting")
  
  clean_df <- clean_df %>%
    left_join(
      source_map,
      by = c("source_athlete_id" = "source_athlete_id")
    ) %>%
    select(-source_system)
  
  dbDisconnect(app_conn)
  
  # Handle unmapped athletes interactively
  source("../common/athlete_creation.R")
  clean_df <- handle_unmapped_athletes_interactive(
    clean_df, 
    source_system = "hitting",
    source_id_column = "source_athlete_id",
    interactive = TRUE
  )
  
  return(clean_df)
}

if (!interactive()) {
  raw_data <- load_raw_hitting()
  clean_data <- clean_hitting(raw_data)
  print(paste("Prepared", nrow(clean_data), "rows of hitting kinematics data"))
}

