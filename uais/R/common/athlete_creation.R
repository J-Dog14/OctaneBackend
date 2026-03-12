# Interactive athlete creation for R scripts
# Handles prompting for demographic info when new athletes are detected

#' Prompt user for athlete demographic information
#' @param source_athlete_id The source athlete ID that was not found
#' @param source_system The source system name
#' @return List with athlete information, or NULL if cancelled
prompt_for_athlete_info <- function(source_athlete_id, source_system) {
  cat("\n", rep("=", 60), "\n", sep = "")
  cat("NEW ATHLETE DETECTED\n")
  cat(rep("=", 60), "\n")
  cat("Source System:", source_system, "\n")
  cat("Source Athlete ID:", source_athlete_id, "\n")
  cat("\nPlease provide demographic information for this athlete.\n")
  cat("(Press Enter to skip optional fields, type 'cancel' to skip this athlete)\n\n")
  
  name <- readline("Full Name (required): ")
  if (tolower(trimws(name)) == "cancel" || nchar(trimws(name)) == 0) {
    cat("Skipping athlete creation.\n")
    return(NULL)
  }
  
  athlete_info <- list(
    source_athlete_id = source_athlete_id,
    source_system = source_system,
    name = trimws(name)
  )
  
  dob <- readline("Date of Birth (YYYY-MM-DD, optional): ")
  if (nchar(trimws(dob)) > 0) {
    athlete_info$date_of_birth <- trimws(dob)
  }
  
  gender <- readline("Gender (M/F/Other, optional): ")
  if (nchar(trimws(gender)) > 0) {
    athlete_info$gender <- toupper(trimws(gender))
  }
  
  height <- readline("Height (inches or cm, optional): ")
  if (nchar(trimws(height)) > 0) {
    athlete_info$height <- as.numeric(trimws(height))
  }
  
  weight <- readline("Weight (lbs or kg, optional): ")
  if (nchar(trimws(weight)) > 0) {
    athlete_info$weight <- as.numeric(trimws(weight))
  }
  
  email <- readline("Email (optional): ")
  if (nchar(trimws(email)) > 0) {
    athlete_info$email <- trimws(email)
  }
  
  phone <- readline("Phone (optional): ")
  if (nchar(trimws(phone)) > 0) {
    athlete_info$phone <- trimws(phone)
  }
  
  notes <- readline("Notes (optional): ")
  if (nchar(trimws(notes)) > 0) {
    athlete_info$notes <- trimws(notes)
  }
  
  cat("\nAthlete information collected for:", athlete_info$name, "\n")
  confirm <- readline("Create this athlete? (y/n): ")
  
  if (tolower(trimws(confirm)) != "y") {
    cat("Cancelled athlete creation.\n")
    return(NULL)
  }
  
  return(athlete_info)
}

#' Create a new athlete in the app database
#' @param athlete_info List with athlete information
#' @param conn Optional database connection (defaults to app connection)
#' @return athlete_uuid string
create_athlete_in_app_db <- function(athlete_info, conn = NULL) {
  if (is.null(conn)) {
    conn <- get_app_connection()
    on.exit(dbDisconnect(conn))
  }
  
  # Generate UUID
  if (!requireNamespace("uuid", quietly = TRUE)) {
    stop("uuid package required. Install with: install.packages('uuid')")
  }
  athlete_uuid <- uuid::UUIDgenerate()
  
  # Prepare athlete record
  athlete_record <- data.frame(
    athlete_uuid = athlete_uuid,
    name = athlete_info$name,
    date_of_birth = if (!is.null(athlete_info$date_of_birth)) athlete_info$date_of_birth else NA,
    gender = if (!is.null(athlete_info$gender)) athlete_info$gender else NA,
    height = if (!is.null(athlete_info$height)) athlete_info$height else NA,
    weight = if (!is.null(athlete_info$weight)) athlete_info$weight else NA,
    email = if (!is.null(athlete_info$email)) athlete_info$email else NA,
    phone = if (!is.null(athlete_info$phone)) athlete_info$phone else NA,
    notes = if (!is.null(athlete_info$notes)) athlete_info$notes else NA,
    created_at = Sys.time(),
    updated_at = Sys.time(),
    stringsAsFactors = FALSE
  )
  
  # Ensure athletes table exists
  if (!table_exists(conn, "athletes")) {
    dbExecute(conn, "
      CREATE TABLE IF NOT EXISTS athletes (
        athlete_uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        date_of_birth TEXT,
        gender TEXT,
        height REAL,
        weight REAL,
        email TEXT,
        phone TEXT,
        notes TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
      )
    ")
  }
  
  # Insert athlete
  dbWriteTable(conn, "athletes", athlete_record, append = TRUE, row.names = FALSE)
  
  cat("Created athlete in app database:", athlete_info$name, "(", athlete_uuid, ")\n")
  
  return(athlete_uuid)
}

#' Create source_athlete_map entry
#' @param source_athlete_id Source athlete ID
#' @param athlete_uuid Athlete UUID
#' @param source_system Source system name
#' @param conn Optional database connection
create_source_mapping <- function(source_athlete_id, athlete_uuid, source_system, conn = NULL) {
  if (is.null(conn)) {
    conn <- get_app_connection()
    on.exit(dbDisconnect(conn))
  }
  
  # Ensure source_athlete_map table exists
  if (!table_exists(conn, "source_athlete_map")) {
    dbExecute(conn, "
      CREATE TABLE IF NOT EXISTS source_athlete_map (
        source_system TEXT NOT NULL,
        source_athlete_id TEXT NOT NULL,
        athlete_uuid TEXT NOT NULL,
        created_at TIMESTAMP,
        PRIMARY KEY (source_system, source_athlete_id)
      )
    ")
  }
  
  # Check if mapping already exists
  existing_map <- read_table(conn, "source_athlete_map")
  if (nrow(existing_map) > 0) {
    existing <- existing_map %>%
      filter(.data$source_system == source_system & 
             .data$source_athlete_id == as.character(source_athlete_id))
    if (nrow(existing) > 0) {
      cat("Mapping already exists:", source_system, "/", source_athlete_id, "\n")
      return()
    }
  }
  
  # Insert mapping
  mapping_record <- data.frame(
    source_system = source_system,
    source_athlete_id = as.character(source_athlete_id),
    athlete_uuid = athlete_uuid,
    created_at = Sys.time(),
    stringsAsFactors = FALSE
  )
  
  dbWriteTable(conn, "source_athlete_map", mapping_record, append = TRUE, row.names = FALSE)
  
  cat("Created mapping:", source_system, "/", source_athlete_id, "->", athlete_uuid, "\n")
}

#' Handle unmapped athletes interactively
#' @param df Data frame with unmapped athletes (athlete_uuid is NA)
#' @param source_system Source system name
#' @param source_id_column Column name containing source athlete IDs
#' @param conn Optional database connection
#' @param interactive If TRUE, prompt for info. If FALSE, skip silently.
#' @return Data frame with athlete_uuid filled in for newly created athletes
handle_unmapped_athletes_interactive <- function(df, source_system, 
                                                  source_id_column = "source_athlete_id",
                                                  conn = NULL, interactive = TRUE) {
  if (nrow(df) == 0 || !source_id_column %in% names(df)) {
    return(df)
  }
  
  unmapped <- df %>% 
    filter(is.na(athlete_uuid) & !is.na(!!sym(source_id_column)))
  
  if (nrow(unmapped) == 0) {
    return(df)
  }
  
  unique_unmapped <- unique(unmapped[[source_id_column]])
  
  if (!interactive) {
    cat("Found", length(unique_unmapped), "unmapped athletes. Run with interactive=TRUE to create them.\n")
    return(df)
  }
  
  if (is.null(conn)) {
    conn <- get_app_connection()
    on.exit(dbDisconnect(conn))
  }
  
  # Process each unmapped athlete
  created_mappings <- list()
  
  for (source_id in unique_unmapped) {
    if (source_id %in% names(created_mappings)) {
      next
    }
    
    # Prompt for athlete info
    athlete_info <- prompt_for_athlete_info(as.character(source_id), source_system)
    
    if (is.null(athlete_info)) {
      cat("Skipping athlete:", source_id, "\n")
      next
    }
    
    # Create athlete in app database
    tryCatch({
      athlete_uuid <- create_athlete_in_app_db(athlete_info, conn)
      
      # Create source mapping
      create_source_mapping(source_id, athlete_uuid, source_system, conn)
      
      # Store mapping for this session
      created_mappings[[as.character(source_id)]] <- athlete_uuid
      
    }, error = function(e) {
      cat("Error creating athlete", source_id, ":", conditionMessage(e), "\n")
    })
  }
  
  # Update data frame with new UUIDs
  if (length(created_mappings) > 0) {
    for (source_id in names(created_mappings)) {
      mask <- df[[source_id_column]] == source_id & is.na(df$athlete_uuid)
      df$athlete_uuid[mask] <- created_mappings[[source_id]]
    }
  }
  
  return(df)
}

