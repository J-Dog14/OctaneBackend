# Proteus Quality Control Report

library(tidyverse)
source("../common/config.R")
source("../common/db_utils.R")

generate_proteus_qc_report <- function() {
  cat("Generating Proteus QC Report...\n")
  
  warehouse_conn <- get_warehouse_connection()
  
  if (!table_exists(warehouse_conn, "f_proteus")) {
    cat("f_proteus table does not exist. Skipping QC report.\n")
    dbDisconnect(warehouse_conn)
    return()
  }
  
  proteus_data <- read_table(warehouse_conn, "f_proteus")
  
  cat("\n=== Proteus Data Summary ===\n")
  cat(paste("Total rows:", nrow(proteus_data), "\n"))
  cat(paste("Unique athletes:", n_distinct(proteus_data$athlete_uuid), "\n"))
  
  missing_uuid <- sum(is.na(proteus_data$athlete_uuid))
  if (missing_uuid > 0) {
    cat(paste("\nWARNING:", missing_uuid, "rows with missing athlete_uuid\n"))
  }
  
  dbDisconnect(warehouse_conn)
  
  cat("\nQC Report Complete\n")
}

if (!interactive()) {
  generate_proteus_qc_report()
}

