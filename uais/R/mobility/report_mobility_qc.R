# Mobility Quality Control Report
# Basic validation and summary output

library(tidyverse)
source("../common/config.R")
source("../common/db_utils.R")

generate_mobility_qc_report <- function() {
  cat("Generating Mobility QC Report...\n")
  
  warehouse_conn <- get_warehouse_connection()
  
  # Load mobility fact table
  if (!table_exists(warehouse_conn, "f_mobility")) {
    cat("f_mobility table does not exist. Skipping QC report.\n")
    dbDisconnect(warehouse_conn)
    return()
  }
  
  mobility_data <- read_table(warehouse_conn, "f_mobility")
  
  cat("\n=== Mobility Data Summary ===\n")
  cat(paste("Total rows:", nrow(mobility_data), "\n"))
  cat(paste("Unique athletes:", n_distinct(mobility_data$athlete_uuid), "\n"))
  cat(paste("Date range:", min(mobility_data$session_date, na.rm = TRUE), 
            "to", max(mobility_data$session_date, na.rm = TRUE), "\n"))
  
  # Check for missing athlete_uuid
  missing_uuid <- sum(is.na(mobility_data$athlete_uuid))
  if (missing_uuid > 0) {
    cat(paste("\nWARNING:", missing_uuid, "rows with missing athlete_uuid\n"))
  }
  
  # Check for missing session_date
  missing_date <- sum(is.na(mobility_data$session_date))
  if (missing_date > 0) {
    cat(paste("WARNING:", missing_date, "rows with missing session_date\n"))
  }
  
  dbDisconnect(warehouse_conn)
  
  cat("\nQC Report Complete\n")
}

if (!interactive()) {
  generate_mobility_qc_report()
}

