# Write hitting kinematics data to warehouse fact table

library(tidyverse)
source("../common/config.R")
source("../common/db_utils.R")
source("kinematics_prep.R")

etl_hitting <- function() {
  cat("Starting Hitting Kinematics ETL...\n")
  
  raw_data <- load_raw_hitting()
  clean_data <- clean_hitting(raw_data)
  
  if (nrow(clean_data) == 0) {
    cat("No data to load. Skipping.\n")
    return()
  }
  
  clean_data <- clean_data %>%
    mutate(
      source_system = "hitting",
      created_at = Sys.time()
    )
  
  warehouse_conn <- get_warehouse_connection()
  write_table(clean_data, warehouse_conn, "f_kinematics_hitting", if_exists = "append")
  dbDisconnect(warehouse_conn)
  
  cat(paste("Successfully loaded", nrow(clean_data), "rows to f_kinematics_hitting\n"))
}

if (!interactive()) {
  etl_hitting()
}

