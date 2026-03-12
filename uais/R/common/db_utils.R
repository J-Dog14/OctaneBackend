# Database utility functions for UAIS R scripts

library(DBI)
library(dplyr)

#' Read a database table as a tibble
#' @param conn DBI connection object
#' @param table_name Name of the table
#' @param schema Optional schema name (for Postgres)
#' @return Tibble containing table data
read_table <- function(conn, table_name, schema = NULL) {
  if (!is.null(schema)) {
    full_table <- paste(schema, table_name, sep = ".")
  } else {
    full_table <- table_name
  }
  
  return(tbl(conn, full_table) %>% collect())
}

#' Write a data frame to a database table
#' @param df Data frame or tibble to write
#' @param conn DBI connection object
#' @param table_name Target table name
#' @param if_exists Behavior if table exists ('fail', 'replace', 'append')
write_table <- function(df, conn, table_name, if_exists = "append") {
  if (if_exists == "replace") {
    if (dbExistsTable(conn, table_name)) {
      dbRemoveTable(conn, table_name)
    }
  }
  
  dbWriteTable(conn, table_name, df, append = (if_exists == "append"))
}

#' Execute a SQL query and return results
#' @param conn DBI connection object
#' @param query SQL query string
#' @return Tibble with query results
execute_query <- function(conn, query) {
  result <- dbGetQuery(conn, query)
  return(as_tibble(result))
}

#' Check if a table exists
#' @param conn DBI connection object
#' @param table_name Name of the table
#' @return Logical indicating if table exists
table_exists <- function(conn, table_name) {
  return(dbExistsTable(conn, table_name))
}

#' Update athlete data flags and session counts
#' 
#' This function calls the PostgreSQL function to update all athlete data presence
#' flags and session counts based on data in fact tables. Should be called after
#' bulk data inserts to ensure flags are accurate.
#' 
#' @param conn DBI connection object (warehouse connection)
#' @param verbose Logical, whether to print summary statistics (default: TRUE)
#' @return List with summary statistics
#' @examples
#' \dontrun{
#' conn <- get_warehouse_connection()
#' update_athlete_flags(conn)
#' }
update_athlete_flags <- function(conn, verbose = TRUE) {
  if (is.null(conn)) {
    stop("Connection cannot be NULL")
  }
  
  # Call the PostgreSQL function
  tryCatch({
    DBI::dbExecute(conn, "SELECT update_athlete_data_flags()")
    
    if (verbose) {
      # Get summary statistics
      stats <- DBI::dbGetQuery(conn, "
        SELECT 
          COUNT(*) as total_athletes,
          COUNT(*) FILTER (WHERE has_pitching_data) as with_pitching,
          COUNT(*) FILTER (WHERE has_athletic_screen_data) as with_athletic_screen,
          COUNT(*) FILTER (WHERE has_pro_sup_data) as with_pro_sup,
          COUNT(*) FILTER (WHERE has_readiness_screen_data) as with_readiness,
          COUNT(*) FILTER (WHERE has_mobility_data) as with_mobility,
          COUNT(*) FILTER (WHERE has_proteus_data) as with_proteus,
          COUNT(*) FILTER (WHERE has_hitting_data) as with_hitting,
          COUNT(*) FILTER (WHERE has_hitting_trial_data) as with_hitting_trials
        FROM analytics.d_athletes
      ")
      
      # Coerce to integer so integer64/bigint from DB don't print as tiny floats
      n_total <- as.integer(stats$total_athletes)
      n_pitching <- as.integer(stats$with_pitching)
      n_athletic <- as.integer(stats$with_athletic_screen)
      n_pro_sup <- as.integer(stats$with_pro_sup)
      n_readiness <- as.integer(stats$with_readiness)
      n_mobility <- as.integer(stats$with_mobility)
      n_proteus <- as.integer(stats$with_proteus)
      n_hitting <- as.integer(stats$with_hitting)
      n_hitting_trials <- as.integer(stats$with_hitting_trials)
      cat("=", rep("=", 78), "\n", sep = "")
      cat("ATHLETE DATA FLAGS UPDATED\n")
      cat("=", rep("=", 78), "\n", sep = "")
      cat("Total athletes:", n_total, "\n")
      cat("\n")
      cat("Athletes with data in each system:\n")
      cat("  Pitching:", n_pitching, "\n")
      cat("  Athletic Screen:", n_athletic, "\n")
      cat("  Pro-Sup:", n_pro_sup, "\n")
      cat("  Readiness Screen:", n_readiness, "\n")
      cat("  Mobility:", n_mobility, "\n")
      cat("  Proteus:", n_proteus, "\n")
      cat("  Hitting:", n_hitting, "\n")
      cat("  Hitting trials:", n_hitting_trials, "\n")
      cat("=", rep("=", 78), "\n", sep = "")
    }
    
    # Return summary as list
    return(list(
      success = TRUE,
      message = "Athlete flags updated successfully"
    ))
  }, error = function(e) {
    error_msg <- conditionMessage(e)
    warning("Failed to update athlete flags: ", error_msg)
    return(list(
      success = FALSE,
      message = error_msg
    ))
  })
}

