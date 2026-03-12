# Pitching Kinematics Data Preparation
# Parses raw Qualisys/Visual3D XML or CSV files and creates tidy tibble with athlete_uuid

library(tidyverse)
library(xml2)
library(DBI)
source("../common/config.R")
source("../common/db_utils.R")

#' Load raw pitching kinematics data
#' @param raw_dir Directory containing raw pitching files
#' @return Tibble with raw pitching data
load_raw_pitching <- function(raw_dir = NULL) {
  if (is.null(raw_dir)) {
    paths <- get_raw_paths()
    raw_dir <- paths$pitching
  }
  
  if (is.null(raw_dir)) {
    stop("Pitching raw data path not configured")
  }
  
  # Find XML files (Qualisys/Visual3D)
  xml_files <- list.files(raw_dir, pattern = "\\.xml$", recursive = TRUE, full.names = TRUE)
  
  if (length(xml_files) == 0) {
    # Try CSV files
    csv_files <- list.files(raw_dir, pattern = "\\.csv$", recursive = TRUE, full.names = TRUE)
    if (length(csv_files) == 0) {
      stop(paste("No pitching data files found in", raw_dir))
    }
    return(read_csv(csv_files, id = "source_file"))
  }
  
  # TODO: Parse XML files (Qualisys/Visual3D format)
  # For now, return empty tibble
  return(tibble())
}

#' Clean and normalize pitching kinematics data
#' @param df Raw pitching data tibble
#' @return Cleaned tibble with athlete_uuid attached
clean_pitching <- function(df) {
  if (nrow(df) == 0) {
    return(df)
  }
  
  clean_df <- df %>%
    # Normalize column names
    rename_all(~str_to_lower(str_replace_all(., " ", "_"))) %>%
    # Extract athlete identifier
    mutate(
      source_athlete_id = coalesce(name, athlete_name, athlete_id, subject_id),
      session_date = as.Date(coalesce(date, test_date, session_date))
    )
  
  # Attach athlete_uuid using source_athlete_map
  app_conn <- get_app_connection()
  source_map <- read_table(app_conn, "source_athlete_map") %>%
    filter(source_system == "pitching")
  
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
    source_system = "pitching",
    source_id_column = "source_athlete_id",
    interactive = TRUE
  )
  
  # TODO: Add pitching-specific cleaning:
  # - Extract kinematics metrics (velocities, angles, forces)
  # - Normalize units
  # - Handle missing values
  
  return(clean_df)
}

# Main execution
if (!interactive()) {
  raw_data <- load_raw_pitching()
  clean_data <- clean_pitching(raw_data)
  print(paste("Prepared", nrow(clean_data), "rows of pitching kinematics data"))
}

