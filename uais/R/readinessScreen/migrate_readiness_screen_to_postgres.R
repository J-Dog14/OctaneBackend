# Migrate Readiness Screen data from SQLite to PostgreSQL
# Matches athletes by name and calculates age groups

# ==== Dependencies ====
library(DBI)
library(RSQLite)
library(dplyr)
library(stringr)

# Load common utilities
find_and_source_common <- function() {
  possible_config_paths <- c(
    file.path(getwd(), "R", "common", "config.R"),
    file.path(getwd(), "..", "R", "common", "config.R"),
    file.path("..", "common", "config.R"),
    file.path("..", "..", "R", "common", "config.R"),
    file.path(dirname(getwd()), "R", "common", "config.R")
  )
  
  config_path <- NULL
  for (path in possible_config_paths) {
    if (file.exists(path)) {
      config_path <- normalizePath(path)
      break
    }
  }
  
  if (is.null(config_path)) {
    stop("Could not find R/common/config.R. Current working directory: ", getwd())
  }
  
  source(config_path)
  
  db_utils_path <- file.path(dirname(config_path), "db_utils.R")
  if (file.exists(db_utils_path)) {
    source(db_utils_path)
  }
  
  # Also try to source athlete_manager if available
  athlete_manager_path <- file.path(dirname(config_path), "athlete_manager.R")
  if (file.exists(athlete_manager_path)) {
    source(athlete_manager_path)
  }
}

find_and_source_common()

# Try to load RPostgres
if (!requireNamespace("RPostgres", quietly = TRUE)) {
  if (requireNamespace("RPostgreSQL", quietly = TRUE)) {
    library(RPostgreSQL)
  } else {
    stop("Neither RPostgres nor RPostgreSQL is installed. Install with: install.packages('RPostgres')")
  }
} else {
  library(RPostgres)
}

# ---------- Helpers ----------
log_progress <- function(...) {
  args <- list(...)
  args <- args[names(args) != "sep"]
  message <- do.call(paste0, args)
  cat(message, "\n", sep = "")
  flush.console()
}

# Normalize name for matching
normalize_name_for_matching <- function(name) {
  if (is.na(name) || name == "") return(NA_character_)
  
  # Remove dates (patterns like "2024-01-15", "1/15/2024", "01-15-2024", etc.)
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}", "", name)
  name <- gsub("\\s*\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}", "", name)
  # Month-day only: MM-DD, MM/DD (e.g., "11-25", "10-24")
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}(?=\\s|$)", "", name, perl = TRUE)
  # Standalone years
  name <- gsub("\\s*\\d{4}", "", name)
  name <- trimws(name)
  
  # Handle "LAST, FIRST" or "LAST. FIRST" (typo) - convert to "FIRST LAST"
  if (grepl(",", name)) {
    parts <- strsplit(name, ",")[[1]]
    if (length(parts) == 2) {
      last <- trimws(parts[1])
      first <- trimws(parts[2])
      name <- paste(first, last)
    }
  } else if (grepl(".", name, fixed = TRUE)) {
    parts <- strsplit(name, ".", fixed = TRUE)[[1]]
    if (length(parts) == 2 && nzchar(trimws(parts[1])) && nzchar(trimws(parts[2]))) {
      last <- trimws(parts[1])
      first <- trimws(parts[2])
      name <- paste(first, last)
    }
  }
  
  # Convert to uppercase and remove extra spaces
  name <- toupper(gsub("\\s+", " ", trimws(name)))
  
  return(name)
}

# Calculate age group based on session_date and DOB
calculate_age_group <- function(session_date, date_of_birth) {
  if (is.na(session_date) || is.na(date_of_birth)) {
    return(NA_character_)
  }
  
  # Convert to Date objects if they're strings
  if (is.character(session_date)) {
    session_date <- as.Date(session_date)
  }
  if (is.character(date_of_birth)) {
    date_of_birth <- as.Date(date_of_birth)
  }
  
  # Calculate age
  age <- as.numeric(difftime(session_date, date_of_birth, units = "days")) / 365.25
  
  if (is.na(age) || age < 0) {
    return(NA_character_)
  }
  
  # Age groups
  if (age < 13) return("U13")
  if (age < 15) return("U15")
  if (age < 17) return("U17")
  if (age < 19) return("U19")
  if (age < 23) return("U23")
  return("23+")
}

# Helper to find column with case-insensitive matching
find_column <- function(df, possible_names) {
  for (name in possible_names) {
    # Try exact match first
    if (name %in% names(df)) {
      return(name)
    }
    # Try case-insensitive match
    matches <- grep(paste0("^", name, "$"), names(df), ignore.case = TRUE, value = TRUE)
    if (length(matches) > 0) {
      return(matches[1])
    }
  }
  return(NULL)
}

# Helper to safely get column from original data with case-insensitive matching
safe_get_col <- function(possible_names) {
  actual_col <- find_column(data, possible_names)
  if (!is.null(actual_col) && actual_col %in% names(data)) {
    return(data[[actual_col]][matched_indices])
  }
  return(rep(NA, length(matched_indices)))
}

# ---------- Configuration ----------
SQLITE_DB_PATH <- file.path("python", "readinessScreen", "Readiness_Screen_Data_v2.db")

# ---------- Main Processing ----------
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** READINESS SCREEN MIGRATION TO POSTGRESQL ***\n")
cat("=", rep("=", 80), "\n", sep = "")

# Connect to SQLite
log_progress("Connecting to SQLite database:", SQLITE_DB_PATH)
if (!file.exists(SQLITE_DB_PATH)) {
  stop("SQLite database not found at: ", SQLITE_DB_PATH)
}

sqlite_conn <- DBI::dbConnect(RSQLite::SQLite(), SQLITE_DB_PATH)

# Connect to PostgreSQL
log_progress("Connecting to PostgreSQL warehouse...")
pg_conn <- tryCatch({
  conn <- get_warehouse_connection()
  DBI::dbGetQuery(conn, "SELECT 1")
  log_progress("Connection successful")
  conn
}, error = function(e) {
  stop("Failed to connect to warehouse: ", conditionMessage(e))
})

# Get athlete mapping from PostgreSQL
log_progress("Loading athlete UUID mapping from PostgreSQL...")
athletes_df <- DBI::dbGetQuery(pg_conn, "
  SELECT athlete_uuid, name, normalized_name, date_of_birth
  FROM analytics.d_athletes
")

# Create normalized name to UUID mapping
name_to_uuid <- setNames(athletes_df$athlete_uuid, athletes_df$normalized_name)

log_progress("Found", nrow(athletes_df), "athletes in PostgreSQL")
print(paste("=== ATHLETE MATCHING INFO ==="))
print(paste("Athletes in PostgreSQL:", nrow(athletes_df)))
if (nrow(athletes_df) > 0) {
  print("Sample normalized names in PostgreSQL (first 10):")
  for (i in 1:min(10, nrow(athletes_df))) {
    print(paste("  ", athletes_df$normalized_name[i], "->", athletes_df$name[i]))
  }
}

# Get all tables from SQLite
log_progress("Scanning SQLite database for tables...")
tables <- DBI::dbListTables(sqlite_conn)
log_progress("Found tables:", paste(tables, collapse = ", "))

# Process each movement table
table_mapping <- list(
  "I" = "f_readiness_screen_i",
  "Y" = "f_readiness_screen_y",
  "T" = "f_readiness_screen_t",
  "IR90" = "f_readiness_screen_ir90",
  "CMJ" = "f_readiness_screen_cmj",
  "PPU" = "f_readiness_screen_ppu"
)

# Main readiness screen table (for athlete flags)
main_table <- "f_readiness_screen"

# Function to create table if it doesn't exist
create_table_if_not_exists <- function(pg_conn, table_name) {
  log_progress("  Ensuring PostgreSQL table exists:", table_name)
  
  if (table_name %in% c("f_readiness_screen_i", "f_readiness_screen_y", "f_readiness_screen_t", "f_readiness_screen_ir90")) {
    # Isometric test tables (I, Y, T, IR90)
    create_table_sql <- paste0("
      CREATE TABLE IF NOT EXISTS public.", table_name, " (
        id SERIAL PRIMARY KEY,
        athlete_uuid VARCHAR(36) NOT NULL,
        session_date DATE NOT NULL,
        source_system VARCHAR(50) NOT NULL DEFAULT 'readiness_screen',
        source_athlete_id VARCHAR(100),
        trial_id INTEGER,
        age_at_collection DECIMAL,
        age_group TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        avg_force DECIMAL,
        avg_force_norm DECIMAL,
        max_force DECIMAL,
        max_force_norm DECIMAL,
        time_to_max DECIMAL
      )
    ")
  } else if (table_name %in% c("f_readiness_screen_cmj", "f_readiness_screen_ppu")) {
    # Jump test tables (CMJ, PPU)
    create_table_sql <- paste0("
      CREATE TABLE IF NOT EXISTS public.", table_name, " (
        id SERIAL PRIMARY KEY,
        athlete_uuid VARCHAR(36) NOT NULL,
        session_date DATE NOT NULL,
        source_system VARCHAR(50) NOT NULL DEFAULT 'readiness_screen',
        source_athlete_id VARCHAR(100),
        trial_id INTEGER,
        age_at_collection DECIMAL,
        age_group TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        jump_height DECIMAL,
        peak_power DECIMAL,
        peak_force DECIMAL,
        pp_w_per_kg DECIMAL,
        pp_forceplate DECIMAL,
        force_at_pp DECIMAL,
        vel_at_pp DECIMAL
      )
    ")
  } else {
    log_progress("  [WARNING] Unknown table name:", table_name)
    return(FALSE)
  }
  
  tryCatch({
    DBI::dbExecute(pg_conn, create_table_sql)
    log_progress("  Table created or already exists:", table_name)
    return(TRUE)
  }, error = function(e) {
    log_progress("  [WARNING] Could not create table ", table_name, ":", conditionMessage(e))
    return(FALSE)
  })
}

# Create main readiness screen table if it doesn't exist
log_progress("Ensuring main readiness screen table exists...")
create_main_table_sql <- paste0("
  CREATE TABLE IF NOT EXISTS public.", main_table, " (
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'readiness_screen',
    source_athlete_id VARCHAR(100),
    age_at_collection DECIMAL,
    age_group TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (athlete_uuid, session_date)
  )
")

tryCatch({
  DBI::dbExecute(pg_conn, create_main_table_sql)
  log_progress("Main table created or already exists")
}, error = function(e) {
  log_progress("  [WARNING] Could not create main table:", conditionMessage(e))
})

total_inserted <- 0
total_skipped <- 0
total_rows_read <- 0
unmatched_athletes <- list()

# Process each movement table
for (table_name in names(table_mapping)) {
  if (!table_name %in% tables) {
    log_progress("  Table", table_name, "not found in SQLite, skipping...")
    next
  }
  
  log_progress("\nProcessing table:", table_name, "->", table_mapping[[table_name]])
  
  # Create PostgreSQL table if it doesn't exist
  pg_table_name <- table_mapping[[table_name]]
  create_table_if_not_exists(pg_conn, pg_table_name)
  
  # Read data from SQLite - join with Participant table to get athlete name
  log_progress("  Reading data from SQLite...")
  
  # Build query to join with Participant table
  query <- paste0("
    SELECT 
      t.*,
      p.Name as Participant_Name,
      p.Height,
      p.Weight,
      p.Plyo_Day,
      p.Creation_Date as Participant_Creation_Date
    FROM ", table_name, " t
    LEFT JOIN Participant p ON t.Participant_ID = p.Participant_ID
  ")
  
  data <- DBI::dbGetQuery(sqlite_conn, query)
  
  if (nrow(data) == 0) {
    log_progress("  No data in table, skipping...")
    next
  }
  
  total_rows_read <- total_rows_read + nrow(data)
  log_progress("  Found", nrow(data), "rows")
  
  # Use Name from the movement table, or fall back to Participant_Name
  name_col <- if ("Name" %in% names(data)) "Name" else "Participant_Name"
  
  if (!name_col %in% names(data)) {
    log_progress("  [ERROR] No name column found, skipping...")
    next
  }
  
  # Normalize names and match to UUIDs
  log_progress("  Matching athletes by name...")
  print(paste("  Total rows in SQLite table:", nrow(data)))
  print(paste("  Unique names in SQLite:", length(unique(data[[name_col]]))))
  
  data$normalized_name <- sapply(data[[name_col]], normalize_name_for_matching)
  data$athlete_uuid <- name_to_uuid[data$normalized_name]
  
  # Track unmatched
  unmatched <- is.na(data$athlete_uuid)
  matched_count <- sum(!unmatched)
  unmatched_count <- sum(unmatched)
  
  print(paste("  Initial match - Matched:", matched_count, "rows, Unmatched:", unmatched_count, "rows"))
  
  # Try to create missing athletes automatically
  if (sum(unmatched) > 0) {
    log_progress("  Attempting to create missing athletes automatically...")
    unique_unmatched <- unique(data$normalized_name[unmatched])
    unique_unmatched_original <- unique(data[[name_col]][unmatched])
    
    created_count <- 0
    failed_count <- 0
    
    for (i in 1:length(unique_unmatched)) {
      orig_name <- unique_unmatched_original[i]
      norm_name <- unique_unmatched[i]
      
      tryCatch({
        # Create athlete directly in SQL (without email/phone columns)
        insert_sql <- "
          INSERT INTO analytics.d_athletes (
            athlete_uuid, name, normalized_name, source_system, source_athlete_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            'readiness_screen',
            $3,
            NOW(),
            NOW()
          )
          ON CONFLICT (normalized_name) DO UPDATE SET
            updated_at = NOW()
          RETURNING athlete_uuid
        "
        
        result <- DBI::dbGetQuery(pg_conn, insert_sql, params = list(
          orig_name,
          norm_name,
          orig_name
        ))
        
        if (nrow(result) > 0) {
          # Get the UUID (either new or existing)
          final_uuid <- result$athlete_uuid[1]
          name_to_uuid[norm_name] <- final_uuid
          created_count <- created_count + 1
          
          if (created_count <= 5) {
            print(paste("  Created/found athlete:", orig_name, "->", final_uuid))
          }
        }
      }, error = function(e) {
        failed_count <<- failed_count + 1
        if (failed_count <= 5) {
          print(paste("  Failed to create athlete:", orig_name, "-", conditionMessage(e)))
        }
      })
    }
    
    print(paste("  Created/found", created_count, "new athletes,", failed_count, "failed"))
    
    # Reload athletes from PostgreSQL to get newly created ones
    if (created_count > 0) {
      log_progress("  Reloading athlete mapping from PostgreSQL...")
      athletes_df <- DBI::dbGetQuery(pg_conn, "
        SELECT athlete_uuid, name, normalized_name, date_of_birth
        FROM analytics.d_athletes
      ")
      name_to_uuid <- setNames(athletes_df$athlete_uuid, athletes_df$normalized_name)
      log_progress("  Found", nrow(athletes_df), "athletes in PostgreSQL (after creating new ones)")
    }
    
    # Retry matching with updated mapping
    data$athlete_uuid <- name_to_uuid[data$normalized_name]
    unmatched <- is.na(data$athlete_uuid)
    matched_count <- sum(!unmatched)
    unmatched_count <- sum(unmatched)
    
    print(paste("  After creating athletes - Matched:", matched_count, "rows, Unmatched:", unmatched_count, "rows"))
  }
  
  if (sum(unmatched) > 0) {
    unique_unmatched <- unique(data$normalized_name[unmatched])
    unique_unmatched_original_names <- unique(data[[name_col]][unmatched])
    unmatched_athletes[[table_name]] <- unique_unmatched
    log_progress("  [WARNING]", sum(unmatched), "rows with unmatched athletes (", length(unique_unmatched), "unique names)")
    
    # Show sample of unmatched names
    if (length(unique_unmatched) <= 20) {
      print("  All unmatched normalized names:")
      for (i in 1:length(unique_unmatched)) {
        orig_name <- unique_unmatched_original_names[i]
        norm_name <- unique_unmatched[i]
        print(paste("    ", orig_name, "->", norm_name))
      }
    } else {
      print("  Sample unmatched normalized names (first 20):")
      for (i in 1:min(20, length(unique_unmatched))) {
        orig_name <- unique_unmatched_original_names[i]
        norm_name <- unique_unmatched[i]
        print(paste("    ", orig_name, "->", norm_name))
      }
    }
  }
  
  # Get DOB for matched athletes
  matched_indices <- which(!unmatched)
  matched_data <- data[matched_indices, ]
  
  if (nrow(matched_data) == 0) {
    log_progress("  No matched athletes, skipping...")
    total_skipped <- total_skipped + sum(unmatched)
    next
  }
  
  # Get DOB from PostgreSQL for matched athletes
  matched_uuids <- unique(matched_data$athlete_uuid)
  dob_query <- paste0("
    SELECT athlete_uuid, date_of_birth
    FROM analytics.d_athletes
    WHERE athlete_uuid IN (", paste0("'", matched_uuids, "'", collapse = ","), ")
  ")
  dob_df <- DBI::dbGetQuery(pg_conn, dob_query)
  dob_lookup <- setNames(dob_df$date_of_birth, dob_df$athlete_uuid)
  
  # Parse Creation_Date to get session_date
  # Creation_Date might be in various formats, including Excel serial dates.
  # Session dates in 1955 are usually wrong: Excel serial misinterpreted or DB returned Date in wrong century.
  parse_creation_date <- function(date_val) {
    if (is.na(date_val) || date_val == "") return(NA)
    
    # If it's already a Date object (e.g. from SQLite), check for wrong-century (1955 instead of 2025)
    if (inherits(date_val, "Date")) {
      if (!is.na(date_val) && date_val < as.Date("1980-01-01")) {
        date_val <- date_val + 25567  # ~70 years so 1955 -> 2025
      }
      if (!is.na(date_val) && date_val >= as.Date("2000-01-01") && date_val < as.Date("2100-01-01")) {
        return(date_val)
      }
      if (!is.na(date_val) && date_val >= as.Date("1980-01-01") && date_val < as.Date("2100-01-01")) {
        return(date_val)
      }
      return(NA)
    }
    
    # Convert to character if needed
    date_str <- as.character(date_val)
    
    # First, try parsing as date string (YYYY-MM-DD format is most common)
    # This should be tried BEFORE Excel serial date conversion
    formats <- c("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y")
    for (fmt in formats) {
      tryCatch({
        date_obj <- as.Date(date_str, format = fmt)
        if (!is.na(date_obj) && date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
          return(date_obj)
        }
      }, error = function(e) NULL)
    }
    
    # If string parsing failed, check if it's a numeric value (Excel serial date)
    if (grepl("^\\d+$", date_str)) {
      serial_num <- as.numeric(date_str)
      # Excel serial: days since 1899-12-30. Valid range typically 1..100000.
      if (serial_num >= 1 && serial_num < 100000) {
        tryCatch({
          date_obj <- as.Date(serial_num - 1, origin = "1899-12-30")
          # Wrong century: result in 1950s when serial is in 10k–50k (should be 2020s)
          if (!is.na(date_obj) && date_obj < as.Date("2000-01-01") && serial_num > 10000 && serial_num < 50000) {
            date_obj <- date_obj + 25567  # ~70 years
          }
          if (!is.na(date_obj) && date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
            return(date_obj)
          }
        }, error = function(e) NULL)
      }
    }
    
    # If all fail, try as.Date with default parsing
    tryCatch({
      date_obj <- as.Date(date_str)
      if (!is.na(date_obj) && date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
        return(date_obj)
      }
    }, error = function(e) NULL)
    
    return(NA)
  }
  
  # Use Creation_Date from movement table, fall back to Participant_Creation_Date
  date_col <- if ("Creation_Date" %in% names(matched_data)) "Creation_Date" else "Participant_Creation_Date"
  matched_data$session_date <- sapply(matched_data[[date_col]], parse_creation_date)
  
  # Debug: show some date conversions
  if (nrow(matched_data) > 0 && date_col %in% names(matched_data)) {
    sample_dates <- head(matched_data[!is.na(matched_data[[date_col]]), c(date_col, "session_date")], 10)
    if (nrow(sample_dates) > 0) {
      print("Sample date conversions:")
      for (i in 1:nrow(sample_dates)) {
        orig_val <- sample_dates[[date_col]][i]
        parsed_date <- sample_dates$session_date[i]
        date_str <- if (inherits(parsed_date, "Date")) {
          format(parsed_date, "%Y-%m-%d")
        } else {
          as.character(parsed_date)
        }
        print(paste("  ", orig_val, "->", date_str, "(", class(parsed_date), ")"))
      }
    }
    
    # Count how many dates were successfully parsed
    valid_dates <- sum(!is.na(matched_data$session_date))
    print(paste("  Successfully parsed", valid_dates, "out of", nrow(matched_data), "dates"))
  }
  
  # Remove rows with invalid dates BEFORE calculating age
  matched_data <- matched_data[!is.na(matched_data$session_date), ]
  
  if (nrow(matched_data) == 0) {
    log_progress("  No rows with valid session dates after parsing, skipping...")
    total_skipped <- total_skipped + sum(unmatched)
    next
  }
  
  # Calculate age_at_collection and age_group
  matched_data$date_of_birth <- dob_lookup[matched_data$athlete_uuid]
  matched_data$age_at_collection <- mapply(function(sd, dob) {
    if (is.na(sd) || is.na(dob)) return(NA)
    as.numeric(difftime(sd, dob, units = "days")) / 365.25
  }, matched_data$session_date, matched_data$date_of_birth)
  
  matched_data$age_group <- mapply(calculate_age_group, matched_data$session_date, matched_data$date_of_birth)
  
  # Convert session_date to character string BEFORE creating dataframe
  # This prevents data.frame() from converting Date objects to numeric
  session_date_str <- if (inherits(matched_data$session_date, "Date")) {
    format(matched_data$session_date, "%Y-%m-%d")
  } else {
    # If it's not a Date, try to parse it
    sapply(matched_data$session_date, function(x) {
      if (is.na(x)) return(NA_character_)
      parsed <- parse_creation_date(x)
      if (!is.na(parsed)) {
        format(parsed, "%Y-%m-%d")
      } else {
        NA_character_
      }
    })
  }
  
  # Build insert dataframe based on table type
  if (table_name %in% c("I", "Y", "T", "IR90")) {
    # Isometric tests
    insert_df <- data.frame(
      athlete_uuid = matched_data$athlete_uuid,
      session_date = session_date_str,  # Use pre-converted character string
      source_system = "readiness_screen",
      source_athlete_id = matched_data[[name_col]],
      trial_id = safe_get_col(c("Trial_ID", "trial_id")),
      age_at_collection = matched_data$age_at_collection,
      age_group = matched_data$age_group,
      avg_force = safe_get_col(c("Avg_Force", "avg_force")),
      avg_force_norm = safe_get_col(c("Avg_Force_Norm", "avg_force_norm", "Avg_Force_Normalized")),
      max_force = safe_get_col(c("Max_Force", "max_force")),
      max_force_norm = safe_get_col(c("Max_Force_Norm", "max_force_norm", "Max_Force_Normalized")),
      time_to_max = safe_get_col(c("Time_to_Max", "time_to_max", "Time_To_Max")),
      stringsAsFactors = FALSE
    )
  } else if (table_name %in% c("CMJ", "PPU")) {
    # Jump tests
    insert_df <- data.frame(
      athlete_uuid = matched_data$athlete_uuid,
      session_date = session_date_str,  # Use pre-converted character string
      source_system = "readiness_screen",
      source_athlete_id = matched_data[[name_col]],
      trial_id = safe_get_col(c("Trial_ID", "trial_id")),
      age_at_collection = matched_data$age_at_collection,
      age_group = matched_data$age_group,
      jump_height = safe_get_col(c("Jump_Height", "jump_height", "JH_IN")),
      peak_power = safe_get_col(c("Peak_Power", "peak_power")),
      peak_force = safe_get_col(c("Peak_Force", "peak_force")),
      pp_w_per_kg = safe_get_col(c("PP_W_per_kg", "pp_w_per_kg")),
      pp_forceplate = safe_get_col(c("PP_FORCEPLATE", "pp_forceplate")),
      force_at_pp = safe_get_col(c("Force_at_PP", "force_at_pp")),
      vel_at_pp = safe_get_col(c("Vel_at_PP", "vel_at_pp")),
      stringsAsFactors = FALSE
    )
  } else {
    log_progress("  [ERROR] Unknown table type:", table_name)
    next
  }
  
  # Remove any rows that still have invalid dates (numeric or NA)
  if (nrow(insert_df) > 0) {
    # Filter out rows where session_date is NA, "NA", or just digits (Excel serial number)
    insert_df <- insert_df[!is.na(insert_df$session_date) & 
                           insert_df$session_date != "NA" & 
                           !grepl("^\\d+$", insert_df$session_date) &
                           grepl("^\\d{4}-\\d{2}-\\d{2}$", insert_df$session_date), ]
  }
  
  if (nrow(insert_df) == 0) {
    log_progress("  No rows with valid session dates after final check, skipping...")
    total_skipped <- total_skipped + sum(unmatched)
    next
  }
  
  log_progress("  Prepared", nrow(insert_df), "rows for insertion")
  
  # Process each row individually with UPSERT logic
  updated_count <- 0
  inserted_count <- 0
  
  print(paste("=== Starting to process", nrow(insert_df), "rows for", table_name, "==="))
  log_progress("  Processing", nrow(insert_df), "rows...")
  
  for (i in 1:nrow(insert_df)) {
    row <- insert_df[i, ]
    
    # Build WHERE clause for checking/updating
    # session_date should already be a character string in YYYY-MM-DD format
    session_date_str <- as.character(row$session_date)
    
    # Validate the date string format - must be YYYY-MM-DD
    if (is.na(session_date_str) || session_date_str == "NA" || !grepl("^\\d{4}-\\d{2}-\\d{2}$", session_date_str)) {
      print(paste("  [WARNING] Skipping row", i, "- invalid date format:", session_date_str))
      next
    }
    
    where_parts <- c("athlete_uuid = $1", "session_date = $2")
    where_params <- list(row$athlete_uuid, session_date_str)
    param_num <- 3
    
    if ("trial_id" %in% names(insert_df) && !is.na(row$trial_id)) {
      where_parts <- c(where_parts, paste0("COALESCE(trial_id, -1) = COALESCE($", param_num, ", -1)"))
      where_params <- c(where_params, list(ifelse(is.na(row$trial_id), -1, as.integer(row$trial_id))))
      param_num <- param_num + 1
    }
    
    # Check if row exists
    check_sql <- paste0("
      SELECT COUNT(*) as cnt FROM public.", table_mapping[[table_name]], "
      WHERE ", paste(where_parts, collapse = " AND ")
    )
    
    exists_result <- tryCatch({
      DBI::dbGetQuery(pg_conn, check_sql, params = where_params)
    }, error = function(e) {
      print(paste("  [ERROR] Check query failed for row", i, ":", conditionMessage(e)))
      log_progress("  [ERROR] Check query failed:", conditionMessage(e))
      return(data.frame(cnt = 0))
    })
    
    row_exists <- exists_result$cnt[1] > 0
    
    # Build column list for INSERT and UPDATE
    all_cols <- names(insert_df)
    # Exclude id and created_at from updates (they're auto-generated)
    update_cols <- all_cols[!all_cols %in% c("id", "created_at")]
    # Exclude key columns from update_cols as they are in the WHERE clause
    key_cols_for_update_exclusion <- c("athlete_uuid", "session_date")
    if ("trial_id" %in% all_cols) key_cols_for_update_exclusion <- c(key_cols_for_update_exclusion, "trial_id")
    update_cols <- update_cols[!update_cols %in% key_cols_for_update_exclusion]
    
    if (row_exists) {
      # Update existing row
      update_parts <- character()
      update_params_for_set <- list()
      current_param_idx_for_set <- 1
      
      for (col in update_cols) {
        update_parts <- c(update_parts, paste0(col, " = $", current_param_idx_for_set))
        update_params_for_set <- c(update_params_for_set, list(row[[col]]))
        current_param_idx_for_set <- current_param_idx_for_set + 1
      }
      
      # Combine SET parameters with WHERE parameters
      final_update_params <- c(update_params_for_set, where_params)
      
      update_sql <- paste0("
        UPDATE public.", table_mapping[[table_name]], "
        SET ", paste(update_parts, collapse = ", "), "
        WHERE ", paste(where_parts, collapse = " AND ")
      )
      
      tryCatch({
        update_result <- DBI::dbExecute(pg_conn, update_sql, params = final_update_params)
        if (update_result > 0) {
          updated_count <- updated_count + 1
        }
      }, error = function(e) {
        print(paste("  [ERROR] Update failed for row", i, ":", conditionMessage(e)))
        log_progress("  [WARNING] Update failed for row", i, ":", conditionMessage(e))
      })
    } else {
      # Insert new row
      insert_cols <- paste(all_cols, collapse = ", ")
      insert_placeholders <- paste0("$", 1:length(all_cols), collapse = ", ")
      insert_params <- lapply(all_cols, function(col) {
        val <- row[[col]]
        # session_date should already be a character string in YYYY-MM-DD format
        # Just return it as-is (it's already converted)
        return(val)
      })
      
      insert_sql <- paste0("
        INSERT INTO public.", table_mapping[[table_name]], " (", insert_cols, ")
        VALUES (", insert_placeholders, ")
      ")
      
      tryCatch({
        insert_result <- DBI::dbExecute(pg_conn, insert_sql, params = insert_params)
        inserted_count <- inserted_count + 1
      }, error = function(e) {
        print(paste("  [ERROR] Insert failed for row", i, ":", conditionMessage(e)))
        # If insert fails, try update instead (might be a race condition)
        update_parts <- character()
        update_params_for_set <- list()
        current_param_idx_for_set <- 1
        for (col in update_cols) {
          update_parts <- c(update_parts, paste0(col, " = $", current_param_idx_for_set))
          update_params_for_set <- c(update_params_for_set, list(row[[col]]))
          current_param_idx_for_set <- current_param_idx_for_set + 1
        }
        final_update_params <- c(update_params_for_set, where_params)
        
        update_sql <- paste0("
          UPDATE public.", table_mapping[[table_name]], "
          SET ", paste(update_parts, collapse = ", "), "
          WHERE ", paste(where_parts, collapse = " AND ")
        )
        
        tryCatch({
          DBI::dbExecute(pg_conn, update_sql, params = final_update_params)
          updated_count <<- updated_count + 1
        }, error = function(e2) {
          print(paste("  [WARNING] Both insert and update failed for row", i, ":", conditionMessage(e2)))
        })
      })
    }
    
    # Progress indicator
    if (i %% 50 == 0 || i == nrow(insert_df)) {
      print(paste("  Processed", i, "of", nrow(insert_df), "rows..."))
      log_progress("  Processed", i, "of", nrow(insert_df), "rows...")
    }
  }
  
  result <- updated_count + inserted_count
  total_inserted <- total_inserted + result
  print(paste("=== FINAL RESULTS for", table_name, "==="))
  print(paste("  Updated:", updated_count, "rows"))
  print(paste("  Inserted:", inserted_count, "rows"))
  print(paste("  Total processed:", result, "rows"))
  log_progress("  [SUCCESS] Processed", result, "rows (", updated_count, "updated,", inserted_count, "inserted)")
  
  total_skipped <- total_skipped + sum(unmatched)
  
  # Also insert into main f_readiness_screen table for athlete flags
  unique_sessions <- unique(insert_df[, c("athlete_uuid", "session_date")])
  if (nrow(unique_sessions) > 0) {
    for (j in 1:nrow(unique_sessions)) {
      session_row <- unique_sessions[j, ]
      main_insert_sql <- "
        INSERT INTO public.f_readiness_screen (athlete_uuid, session_date, source_system, source_athlete_id, age_at_collection, age_group)
        VALUES ($1, $2, 'readiness_screen', $3, $4, $5)
        ON CONFLICT DO NOTHING
      "
      tryCatch({
        # Get age info from first matching row
        age_info <- insert_df[insert_df$athlete_uuid == session_row$athlete_uuid & 
                              insert_df$session_date == session_row$session_date, ][1, ]
        DBI::dbExecute(pg_conn, main_insert_sql, params = list(
          session_row$athlete_uuid,
          as.character(session_row$session_date),
          age_info$source_athlete_id,
          age_info$age_at_collection,
          age_info$age_group
        ))
      }, error = function(e) {
        # Ignore errors for main table (might already exist)
      })
    }
  }
}

# Update athlete flags
log_progress("\nUpdating athlete data flags...")
tryCatch({
  DBI::dbExecute(pg_conn, "SELECT update_athlete_data_flags()")
  log_progress("Athlete flags updated successfully")
}, error = function(e) {
  log_progress("Warning: Could not update athlete flags:", conditionMessage(e))
})

# Summary
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** MIGRATION COMPLETE ***\n")
cat("=", rep("=", 80), "\n", sep = "")
print("=== MIGRATION SUMMARY ===")
print(paste("Total rows read from SQLite:", total_rows_read))
print(paste("Total rows inserted/updated:", total_inserted))
print(paste("Total rows skipped (unmatched athletes):", total_skipped))
if (total_rows_read > 0) {
  match_rate <- round(100 * total_inserted / total_rows_read, 1)
  print(paste("Match rate:", match_rate, "%"))
}
log_progress("Total rows inserted:", total_inserted)
log_progress("Total rows skipped (unmatched):", total_skipped)

if (length(unmatched_athletes) > 0) {
  log_progress("\nUnmatched athletes by table:")
  print("=== UNMATCHED ATHLETES SUMMARY ===")
  for (table in names(unmatched_athletes)) {
    count <- length(unmatched_athletes[[table]])
    print(paste("  ", table, ":", count, "unique unmatched names"))
    log_progress("  ", table, ":", count, "unique names")
    
    # Show all unmatched names for this table
    if (count <= 50) {
      print(paste("    Unmatched names in", table, ":"))
      for (name in unmatched_athletes[[table]]) {
        print(paste("      -", name))
      }
    } else {
      print(paste("    Showing first 50 of", count, "unmatched names in", table, ":"))
      for (name in unmatched_athletes[[table]][1:50]) {
        print(paste("      -", name))
      }
    }
  }
  
  # Get all unique unmatched names across all tables
  all_unmatched <- unique(unlist(unmatched_athletes))
  print(paste("\n  Total unique unmatched athletes across all tables:", length(all_unmatched)))
  print("  These athletes need to be added to analytics.d_athletes first")
} else {
  print("=== ALL ATHLETES MATCHED SUCCESSFULLY ===")
}

# Close connections
DBI::dbDisconnect(sqlite_conn)
DBI::dbDisconnect(pg_conn)

cat("\n")
log_progress("Migration complete!")

