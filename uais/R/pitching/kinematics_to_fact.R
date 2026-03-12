# Write pitching kinematics data to warehouse fact table

library(tidyverse)
source("../common/config.R")
source("../common/db_utils.R")
source("kinematics_prep.R")

#' ETL function for pitching kinematics
etl_pitching <- function() {
  cat("Starting Pitching Kinematics ETL...\n")
  
  # Load and clean data
  raw_data <- load_raw_pitching()
  clean_data <- clean_pitching(raw_data)
  
  if (nrow(clean_data) == 0) {
    cat("No data to load. Skipping.\n")
    return()
  }
  
  # Add metadata
  clean_data <- clean_data %>%
    mutate(
      source_system = "pitching",
      created_at = Sys.time()
    )
  
  # Ensure required columns
  required_cols <- c("athlete_uuid", "session_date", "source_system", "created_at")
  missing_cols <- setdiff(required_cols, names(clean_data))
  if (length(missing_cols) > 0) {
    stop(paste("Missing required columns:", paste(missing_cols, collapse = ", ")))
  }
  
  # Write to warehouse
  warehouse_conn <- get_warehouse_connection()
  write_table(clean_data, warehouse_conn, "f_kinematics_pitching", if_exists = "append")
  dbDisconnect(warehouse_conn)
  
  cat(paste("Successfully loaded", nrow(clean_data), "rows to f_kinematics_pitching\n"))
}

# Main execution
if (!interactive()) {
  etl_pitching()
}

