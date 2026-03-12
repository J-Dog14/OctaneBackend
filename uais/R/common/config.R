# UAIS Configuration Management for R
# Loads YAML config and provides database connections

library(yaml)
library(DBI)

# Helper function for default values
`%||%` <- function(a, b) if (!is.null(a)) a else b

#' Load configuration from db_connections.yaml
#' @return List containing database connections and raw data paths
load_config <- function() {
  # Try multiple possible paths to find config file
  # First, try relative path from R/common/
  config_path <- file.path("..", "..", "config", "db_connections.yaml")
  
  # If not found, try from project root (if script is run from R/ subdirectory)
  if (!file.exists(config_path)) {
    config_path <- file.path("config", "db_connections.yaml")
  }
  
  # If still not found, try from current working directory
  if (!file.exists(config_path)) {
    # Try to find config relative to current working directory
    # This works if script is run from project root
    possible_paths <- c(
      file.path(getwd(), "config", "db_connections.yaml"),
      file.path(getwd(), "..", "config", "db_connections.yaml")
    )
    for (path in possible_paths) {
      if (file.exists(path)) {
        config_path <- path
        break
      }
    }
  }
  
  if (!file.exists(config_path)) {
    stop(paste("Config file not found. Tried:", 
               paste(c(file.path("..", "..", "config", "db_connections.yaml"),
                      file.path("config", "db_connections.yaml"),
                      config_path), collapse = ", "),
               "\nCopy db_connections.example.yaml to db_connections.yaml and configure"))
  }
  
  config <- yaml::read_yaml(config_path)
  return(config)
}

#' Get database connection for app database
#' @return DBI connection object
get_app_connection <- function() {
  config <- load_config()
  app_config <- config$databases$app
  
  if (!is.null(app_config$sqlite)) {
    return(DBI::dbConnect(RSQLite::SQLite(), app_config$sqlite))
  } else if (!is.null(app_config$postgres)) {
    pg <- app_config$postgres
    return(DBI::dbConnect(
      RPostgres::Postgres(),
      host = pg$host,
      port = pg$port,
      dbname = pg$database,
      user = pg$user,
      password = pg$password
    ))
  } else {
    stop("No app database configuration found")
  }
}

#' Parse PostgreSQL connection string
#' @param conn_str Connection string (e.g., "postgresql://user:pass@host:port/db?params")
#' @return List with host, port, dbname, user, password, sslmode
parse_connection_string <- function(conn_str) {
  if (!grepl("^postgresql://", conn_str)) {
    stop("Connection string must start with postgresql://")
  }
  
  # Remove postgresql:// prefix
  conn_str <- sub("^postgresql://", "", conn_str)
  
  # Split on @ to separate credentials from host
  parts <- strsplit(conn_str, "@")[[1]]
  if (length(parts) != 2) {
    stop("Invalid connection string format")
  }
  
  creds <- parts[1]
  host_part <- parts[2]
  
  # Extract user and password (handle passwords with : in them)
  cred_parts <- strsplit(creds, ":")[[1]]
  if (length(cred_parts) < 2) {
    stop("Connection string missing user or password")
  }
  user <- cred_parts[1]
  password <- paste(cred_parts[-1], collapse = ":")
  
  # Extract host, port, and database
  # Format: host:port/database?params
  host_db <- strsplit(host_part, "/")[[1]]
  if (length(host_db) < 2) {
    stop("Connection string missing database name")
  }
  
  host_port <- strsplit(host_db[1], ":")[[1]]
  host <- host_port[1]
  port <- if (length(host_port) > 1) as.integer(host_port[2]) else 5432
  
  db_params <- strsplit(host_db[2], "\\?")[[1]]
  database <- db_params[1]
  
  # Extract sslmode from params if present
  sslmode <- "require"
  if (length(db_params) > 1) {
    params <- strsplit(db_params[2], "&")[[1]]
    for (param in params) {
      if (grepl("^sslmode=", param)) {
        sslmode <- sub("^sslmode=", "", param)
      }
    }
  }
  
  return(list(
    host = host,
    port = port,
    dbname = database,
    user = user,
    password = password,
    sslmode = sslmode
  ))
}

#' Get database connection for warehouse database
#' @return DBI connection object
get_warehouse_connection <- function() {
  config <- load_config()
  warehouse_config <- config$databases$warehouse
  
  if (!is.null(warehouse_config$sqlite)) {
    return(DBI::dbConnect(RSQLite::SQLite(), warehouse_config$sqlite))
  } else if (!is.null(warehouse_config$postgres)) {
    pg <- warehouse_config$postgres
    
    # Check for connection_string first (for Neon/cloud databases)
    if (!is.null(pg$connection_string)) {
      tryCatch({
        conn_params <- parse_connection_string(pg$connection_string)
        return(DBI::dbConnect(
          RPostgres::Postgres(),
          host = conn_params$host,
          port = conn_params$port,
          dbname = conn_params$dbname,
          user = conn_params$user,
          password = conn_params$password,
          sslmode = conn_params$sslmode,
          keepalives = 1L,
          keepalives_idle = 60L,
          keepalives_interval = 15L,
          keepalives_count = 5L
        ))
      }, error = function(e) {
        warning("Failed to parse connection_string, falling back to individual fields: ", conditionMessage(e))
        # Fall through to individual fields
      })
    }
    
    # Use individual fields (local database or fallback)
    # Handle case where connection_string exists but individual fields are commented out
    if (is.null(pg$host) || is.null(pg$user) || is.null(pg$password)) {
      stop("Warehouse postgres config missing required fields (host, user, password). ",
           "Either provide connection_string or individual fields.")
    }
    
    return(DBI::dbConnect(
      RPostgres::Postgres(),
      host = pg$host,
      port = pg$port %||% 5432,
      dbname = pg$database %||% "uais_warehouse",
      user = pg$user,
      password = pg$password,
      keepalives = 1L,
      keepalives_idle = 60L,
      keepalives_interval = 15L,
      keepalives_count = 5L
    ))
  } else {
    stop("No warehouse database configuration found")
  }
}

#' Get raw data paths
#' @return Named list of raw data directory paths
get_raw_paths <- function() {
  config <- load_config()
  return(config$raw_data_paths)
}

