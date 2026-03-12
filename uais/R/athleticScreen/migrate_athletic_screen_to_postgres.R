# Migrate Athletic Screen data from SQLite to PostgreSQL
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

# Normalize name for matching - EXACT COPY from pitching_processing.R
normalize_name_for_matching <- function(name) {
  if (is.na(name) || name == "") return(NA_character_)
  
  # Remove dates (patterns like "2024-01-15", "1/15/2024", "01-15-2024", etc.)
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}", "", name)
  name <- gsub("\\s*\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}", "", name)
  name <- gsub("\\s*\\d{4}", "", name)
  
  # Trim whitespace
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
  
  tryCatch({
    session_dt <- as.Date(session_date)
    dob_dt <- as.Date(date_of_birth)
    
    if (is.na(session_dt) || is.na(dob_dt)) {
      return(NA_character_)
    }
    
    age <- as.numeric(difftime(session_dt, dob_dt, units = "days")) / 365.25
    
    if (is.na(age)) {
      return(NA_character_)
    }
    
    # Age groups:
    # High School: 14-18
    # College: 18-23
    # Pro: 23+
    if (age < 14) {
      return("Youth")
    } else if (age < 18) {
      return("High School")
    } else if (age < 22) {
      return("College")
    } else {
      return("Pro")
    }
  }, error = function(e) {
    return(NA_character_)
  })
}

# Calculate age at collection
calculate_age_at_collection <- function(session_date, date_of_birth) {
  if (is.na(session_date) || is.na(date_of_birth)) {
    return(NA_real_)
  }
  
  tryCatch({
    session_dt <- as.Date(session_date)
    dob_dt <- as.Date(date_of_birth)
    
    if (is.na(session_dt) || is.na(dob_dt)) {
      return(NA_real_)
    }
    
    age <- as.numeric(difftime(session_dt, dob_dt, units = "days")) / 365.25
    return(age)
  }, error = function(e) {
    return(NA_real_)
  })
}

# Helper function to find column by case-insensitive matching
find_column <- function(df, possible_names) {
  if (is.null(df) || nrow(df) == 0) return(NULL)
  
  col_names <- names(df)
  for (name in possible_names) {
    # Exact match
    if (name %in% col_names) {
      return(name)
    }
    # Case-insensitive match
    matches <- which(tolower(col_names) == tolower(name))
    if (length(matches) > 0) {
      return(col_names[matches[1]])
    }
    # Partial match (contains)
    matches <- which(grepl(name, col_names, ignore.case = TRUE))
    if (length(matches) > 0) {
      return(col_names[matches[1]])
    }
  }
  return(NULL)
}

# Helper to get column value or NA vector
get_col_value <- function(df, possible_names) {
  if (is.null(df) || nrow(df) == 0) {
    return(NA)
  }
  col_name <- find_column(df, possible_names)
  if (!is.null(col_name)) {
    return(df[[col_name]])
  }
  # Return vector of NAs with same length as dataframe
  return(rep(NA, nrow(df)))
}

# ---------- Configuration ----------
SQLITE_DB_PATH <- file.path("python", "athleticScreen", "Athletic_Screen_All_data_v2.db")

# ---------- Main Processing ----------
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** ATHLETIC SCREEN MIGRATION TO POSTGRESQL ***\n")
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

# Process each table
table_mapping <- list(
  "CMJ" = "f_athletic_screen_cmj",
  "DJ" = "f_athletic_screen_dj",
  "SLV" = "f_athletic_screen_slv",
  "NMT" = "f_athletic_screen_nmt",
  "PPU" = "f_athletic_screen_ppu",
  "Athletic_Screen" = "f_athletic_screen"  # Main table if it exists
)

total_inserted <- 0
total_skipped <- 0
total_rows_read <- 0
unmatched_athletes <- list()

# Process tables in order: main table first, then movement tables
tables_to_process <- intersect(names(table_mapping), tables)
if (length(tables_to_process) == 0) {
  stop("No matching tables found in SQLite database!")
}

for (table_name in tables_to_process) {
  
  log_progress("\nProcessing table:", table_name, "->", table_mapping[[table_name]])
  
  # Read data from SQLite
  log_progress("  Reading data from SQLite...")
  data <- DBI::dbGetQuery(sqlite_conn, paste0("SELECT * FROM ", table_name))
  
  if (nrow(data) == 0) {
    log_progress("  No data in table, skipping...")
    next
  }
  
  total_rows_read <- total_rows_read + nrow(data)
  log_progress("  Found", nrow(data), "rows")
  log_progress("  ALL COLUMNS IN SQLITE TABLE:")
  for (col in names(data)) {
    log_progress("    -", col)
  }
  
  # Show sample values for first row
  if (nrow(data) > 0) {
    log_progress("  Sample values from first row:")
    for (col in names(data)[1:min(10, length(names(data)))]) {
      val <- data[[col]][1]
      if (is.na(val)) val <- "NA"
      if (nchar(as.character(val)) > 50) val <- paste0(substr(as.character(val), 1, 50), "...")
      log_progress("    ", col, "=", val)
    }
  }
  
  # Check for name column (could be name, Name, Athlete_Name, etc.)
  # Prioritize lowercase "name" since that's what SQLite actually has
  name_col <- NULL
  for (col in c("name", "Name", "athlete_name", "Athlete_Name", "Athlete", "athlete")) {
    if (col %in% names(data)) {
      name_col <- col
      break
    }
  }
  
  # Check for date column (could be date, Date, Session_Date, session_date, etc.)
  # Prioritize lowercase "date" since that's what SQLite actually has
  date_col <- NULL
  for (col in c("date", "Date", "session_date", "Session_Date", "SessionDate", "sessionDate")) {
    if (col %in% names(data)) {
      date_col <- col
      break
    }
  }
  
  if (is.null(name_col) || is.null(date_col)) {
    log_progress("  [ERROR] Could not find name or date column")
    log_progress("  Available columns:", paste(names(data), collapse = ", "))
    log_progress("  Looking for name column in:", paste(c("Name", "name", "Athlete_Name", "athlete_name"), collapse = ", "))
    log_progress("  Looking for date column in:", paste(c("Session_Date", "session_date", "Date", "date"), collapse = ", "))
    next
  }
  
  log_progress("  Using name column:", name_col, "and date column:", date_col)
  
  # Debug: Show which columns we're looking for and what we find
  if (table_name == "CMJ") {
    log_progress("  Testing column matching for CMJ table:")
    test_cols <- list(
      "trial_name" = c("trial_name", "Trial_Name", "TrialName"),
      "JH_IN" = c("JH_IN", "JH_in", "jh_in"),
      "PP_FORCEPLATE" = c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate"),
      "peak_power_w" = c("peak_power_w", "Peak_Power_W", "PeakPowerW"),
      "time_to_peak_s" = c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS"),
      "rpd_max_w_per_s" = c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS")
    )
    for (expected_name in names(test_cols)) {
      found <- find_column(data, test_cols[[expected_name]])
      if (!is.null(found)) {
        log_progress("    Found", expected_name, "->", found)
      } else {
        log_progress("    NOT FOUND:", expected_name)
      }
    }
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
        # Use PostgreSQL's gen_random_uuid() function
        insert_sql <- "
          INSERT INTO analytics.d_athletes (
            athlete_uuid, name, normalized_name, source_system, source_athlete_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            'athletic_screen',
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
      log_progress("  Unmatched names:", paste(unique_unmatched, collapse = ", "))
    } else {
      print("  Sample unmatched normalized names (first 20):")
      for (i in 1:min(20, length(unique_unmatched))) {
        orig_name <- unique_unmatched_original_names[i]
        norm_name <- unique_unmatched[i]
        print(paste("    ", orig_name, "->", norm_name))
      }
      log_progress("  Unmatched names (showing first 10):", paste(unique_unmatched[1:min(10, length(unique_unmatched))], collapse = ", "))
    }
    
    # Show sample of matched names for comparison
    if (matched_count > 0) {
      matched_normalized <- unique(data$normalized_name[!unmatched])
      print(paste("  Sample matched normalized names (first 5):"))
      for (i in 1:min(5, length(matched_normalized))) {
        print(paste("    ", matched_normalized[i]))
      }
    }
  }
  
  # Get DOB for matched athletes
  matched_indices <- which(!unmatched)
  matched_data <- data[matched_indices, ]
  log_progress("  Matched", nrow(matched_data), "rows to athletes")
  
  if (nrow(matched_data) > 0) {
    # Extract column values from ORIGINAL data BEFORE merge (to preserve all columns)
    # Helper to safely get column from original data with case-insensitive matching
    safe_get_col <- function(possible_names) {
      # Use find_column to find the actual column name (case-insensitive)
      actual_col <- find_column(data, possible_names)
      if (!is.null(actual_col) && actual_col %in% names(data)) {
        return(data[[actual_col]][matched_indices])
      }
      return(rep(NA, length(matched_indices)))
    }
    
    # TEST safe_get_col immediately after definition
    if (table_name == "CMJ" && length(matched_indices) > 0) {
      print("=== TESTING safe_get_col function ===")
      test_result <- safe_get_col(c("JH_IN", "JH_in", "jh_in"))
      print(paste("safe_get_col for jh_in returned", length(test_result), "values"))
      print(paste("Non-NA count:", sum(!is.na(test_result))))
      if (sum(!is.na(test_result)) > 0) {
        print(paste("First non-NA value:", test_result[!is.na(test_result)][1]))
      }
      
      # Also test what find_column returns
      test_col <- find_column(data, c("JH_IN", "JH_in", "jh_in"))
      print(paste("find_column returned:", ifelse(is.null(test_col), "NULL", test_col)))
      if (!is.null(test_col)) {
        print(paste("Column exists in data:", test_col %in% names(data)))
        if (length(matched_indices) > 0) {
          print(paste("Sample value from data:", data[[test_col]][matched_indices[1]]))
        }
      }
    }
    
    # Join with athletes to get DOB
    matched_data <- merge(matched_data, athletes_df[, c("athlete_uuid", "date_of_birth")], 
                         by = "athlete_uuid", all.x = TRUE)
    
    # Calculate age_group and age_at_collection using the dynamically found date column
    matched_data$age_at_collection <- mapply(calculate_age_at_collection, 
                                             matched_data[[date_col]], 
                                             matched_data$date_of_birth)
    matched_data$age_group <- mapply(calculate_age_group, 
                                     matched_data[[date_col]], 
                                     matched_data$date_of_birth)
    
    # Prepare data for insertion
    # Use safe_get_col which gets values from original data, filtered to matched rows
    
    # Debug: Test column extraction for ALL tables
    if (nrow(matched_data) > 0) {
      log_progress("  [DEBUG] Testing column extraction for", table_name, ":")
      # Test a comprehensive set of columns
      test_cols <- list(
        "trial_name" = c("trial_name", "Trial_Name", "TrialName"),
        "JH_IN" = c("JH_IN", "JH_in", "jh_in"),
        "Peak_Power" = c("Peak_Power", "peak_power", "PeakPower"),
        "PP_FORCEPLATE" = c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate"),
        "Force_at_PP" = c("Force_at_PP", "force_at_pp", "ForceAtPP"),
        "Vel_at_PP" = c("Vel_at_PP", "vel_at_pp", "VelAtPP"),
        "PP_W_per_kg" = c("PP_W_per_kg", "pp_w_per_kg", "PPWPerKg"),
        "peak_power_w" = c("peak_power_w", "Peak_Power_W", "PeakPowerW"),
        "time_to_peak_s" = c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS"),
        "rpd_max_w_per_s" = c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS"),
        "time_to_rpd_max_s" = c("time_to_rpd_max_s", "Time_to_RPD_Max_s", "TimeToRPDMaxS"),
        "rise_time_10_90_s" = c("rise_time_10_90_s", "Rise_Time_10_90_s", "RiseTime10_90S"),
        "fwhm_s" = c("fwhm_s", "FWHM_s", "FwhmS"),
        "auc_j" = c("auc_j", "AUC_j", "AucJ"),
        "work_early_pct" = c("work_early_pct", "Work_Early_Pct", "WorkEarlyPct"),
        "decay_90_10_s" = c("decay_90_10_s", "Decay_90_10_s", "Decay90_10S"),
        "t_com_norm_0to1" = c("t_com_norm_0to1", "T_Com_Norm_0to1", "TComNorm0to1"),
        "skewness" = c("skewness", "Skewness", "SKEWNESS"),
        "kurtosis" = c("kurtosis", "Kurtosis", "KURTOSIS"),
        "spectral_centroid_hz" = c("spectral_centroid_hz", "Spectral_Centroid_Hz", "SpectralCentroidHz"),
        "demographic" = c("demographic", "Demographic", "DEMOGRAPHIC")
      )
      
      # Add table-specific columns
      if (table_name == "DJ") {
        test_cols[["CT"]] <- c("CT", "ct", "Ct")
        test_cols[["RSI"]] <- c("RSI", "rsi", "Rsi")
      }
      if (table_name == "SLV") {
        test_cols[["side"]] <- c("side", "Side", "SIDE")
      }
      
      found_count <- 0
      not_found <- c()
      for (expected_name in names(test_cols)) {
        found_col <- find_column(data, test_cols[[expected_name]])
        if (!is.null(found_col)) {
          vals <- data[[found_col]][matched_indices]
          non_na <- sum(!is.na(vals))
          found_count <- found_count + 1
          log_progress("    ✓", expected_name, "->", found_col, ":", non_na, "non-NA /", length(vals), "total")
          if (non_na > 0 && non_na <= 3) {
            log_progress("      Sample values:", paste(vals[!is.na(vals)][1:min(3, non_na)], collapse = ", "))
          }
        } else {
          not_found <- c(not_found, expected_name)
          log_progress("    ✗", expected_name, ": NOT FOUND")
        }
      }
      log_progress("  [DEBUG] Summary: Found", found_count, "columns,", length(not_found), "not found")
      if (length(not_found) > 0) {
        log_progress("  [DEBUG] Not found columns:", paste(not_found, collapse = ", "))
      }
    }
    
    if (table_name == "CMJ") {
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        trial_name = safe_get_col(c("trial_name", "Trial_Name", "TrialName", "trialName")),
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        jh_in = safe_get_col(c("JH_IN", "JH_in", "jh_in", "Jump_Height", "JumpHeight", "JH", "jh")),
        peak_power = safe_get_col(c("Peak_Power", "peak_power", "PeakPower", "peakPower", "PEAK_POWER")),
        pp_forceplate = safe_get_col(c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate", "PPForceplate", "ppForceplate")),
        force_at_pp = safe_get_col(c("Force_at_PP", "force_at_pp", "ForceAtPP", "forceAtPP", "FORCE_AT_PP")),
        vel_at_pp = safe_get_col(c("Vel_at_PP", "vel_at_pp", "VelAtPP", "velAtPP", "VEL_AT_PP")),
        pp_w_per_kg = safe_get_col(c("PP_W_per_kg", "pp_w_per_kg", "PPWPerKg", "ppWPerKg", "PP_W_PER_KG")),
        peak_power_w = safe_get_col(c("peak_power_w", "Peak_Power_W", "PeakPowerW", "peakPowerW", "PEAK_POWER_W")),
        time_to_peak_s = safe_get_col(c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS", "timeToPeakS", "TIME_TO_PEAK_S")),
        rpd_max_w_per_s = safe_get_col(c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS", "rpdMaxWPerS", "RPD_MAX_W_PER_S")),
        time_to_rpd_max_s = safe_get_col(c("time_to_rpd_max_s", "Time_to_RPD_Max_s", "TimeToRPDMaxS", "timeToRPDMaxS", "TIME_TO_RPD_MAX_S")),
        rise_time_10_90_s = safe_get_col(c("rise_time_10_90_s", "Rise_Time_10_90_s", "RiseTime10_90S", "riseTime10_90S", "RISE_TIME_10_90_S")),
        fwhm_s = safe_get_col(c("fwhm_s", "FWHM_s", "FwhmS", "fwhmS", "FWHM_S")),
        auc_j = safe_get_col(c("auc_j", "AUC_j", "AucJ", "aucJ", "AUC_J")),
        work_early_pct = safe_get_col(c("work_early_pct", "Work_Early_Pct", "WorkEarlyPct", "workEarlyPct", "WORK_EARLY_PCT")),
        decay_90_10_s = safe_get_col(c("decay_90_10_s", "Decay_90_10_s", "Decay90_10S", "decay90_10S", "DECAY_90_10_S")),
        t_com_norm_0to1 = safe_get_col(c("t_com_norm_0to1", "T_Com_Norm_0to1", "TComNorm0to1", "tComNorm0to1", "T_COM_NORM_0TO1")),
        skewness = safe_get_col(c("skewness", "Skewness", "SKEWNESS")),
        kurtosis = safe_get_col(c("kurtosis", "Kurtosis", "KURTOSIS")),
        spectral_centroid_hz = safe_get_col(c("spectral_centroid_hz", "Spectral_Centroid_Hz", "SpectralCentroidHz", "spectralCentroidHz", "SPECTRAL_CENTROID_HZ")),
        demographic = safe_get_col(c("demographic", "Demographic", "DEMOGRAPHIC")),
        stringsAsFactors = FALSE
      )
    } else if (table_name == "DJ") {
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        trial_name = safe_get_col(c("trial_name", "Trial_Name", "TrialName", "trialName")),
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        jh_in = safe_get_col(c("JH_IN", "JH_in", "jh_in", "Jump_Height", "JumpHeight", "JH", "jh")),
        peak_power = safe_get_col(c("Peak_Power", "peak_power", "PeakPower", "peakPower", "PEAK_POWER")),
        pp_forceplate = safe_get_col(c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate", "PPForceplate", "ppForceplate")),
        force_at_pp = safe_get_col(c("Force_at_PP", "force_at_pp", "ForceAtPP", "forceAtPP", "FORCE_AT_PP")),
        vel_at_pp = safe_get_col(c("Vel_at_PP", "vel_at_pp", "VelAtPP", "velAtPP", "VEL_AT_PP")),
        pp_w_per_kg = safe_get_col(c("PP_W_per_kg", "pp_w_per_kg", "PPWPerKg", "ppWPerKg", "PP_W_PER_KG")),
        ct = safe_get_col(c("CT", "ct", "Ct")),
        rsi = safe_get_col(c("RSI", "rsi", "Rsi")),
        peak_power_w = safe_get_col(c("peak_power_w", "Peak_Power_W", "PeakPowerW", "peakPowerW", "PEAK_POWER_W")),
        time_to_peak_s = safe_get_col(c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS", "timeToPeakS", "TIME_TO_PEAK_S")),
        rpd_max_w_per_s = safe_get_col(c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS", "rpdMaxWPerS", "RPD_MAX_W_PER_S")),
        time_to_rpd_max_s = safe_get_col(c("time_to_rpd_max_s", "Time_to_RPD_Max_s", "TimeToRPDMaxS", "timeToRPDMaxS", "TIME_TO_RPD_MAX_S")),
        rise_time_10_90_s = safe_get_col(c("rise_time_10_90_s", "Rise_Time_10_90_s", "RiseTime10_90S", "riseTime10_90S", "RISE_TIME_10_90_S")),
        fwhm_s = safe_get_col(c("fwhm_s", "FWHM_s", "FwhmS", "fwhmS", "FWHM_S")),
        auc_j = safe_get_col(c("auc_j", "AUC_j", "AucJ", "aucJ", "AUC_J")),
        work_early_pct = safe_get_col(c("work_early_pct", "Work_Early_Pct", "WorkEarlyPct", "workEarlyPct", "WORK_EARLY_PCT")),
        decay_90_10_s = safe_get_col(c("decay_90_10_s", "Decay_90_10_s", "Decay90_10S", "decay90_10S", "DECAY_90_10_S")),
        t_com_norm_0to1 = safe_get_col(c("t_com_norm_0to1", "T_Com_Norm_0to1", "TComNorm0to1", "tComNorm0to1", "T_COM_NORM_0TO1")),
        skewness = safe_get_col(c("skewness", "Skewness", "SKEWNESS")),
        kurtosis = safe_get_col(c("kurtosis", "Kurtosis", "KURTOSIS")),
        spectral_centroid_hz = safe_get_col(c("spectral_centroid_hz", "Spectral_Centroid_Hz", "SpectralCentroidHz", "spectralCentroidHz", "SPECTRAL_CENTROID_HZ")),
        demographic = safe_get_col(c("demographic", "Demographic", "DEMOGRAPHIC")),
        stringsAsFactors = FALSE
      )
    } else if (table_name == "SLV") {
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        trial_name = safe_get_col(c("trial_name", "Trial_Name", "TrialName", "trialName")),
        side = safe_get_col(c("side", "Side", "SIDE")),
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        jh_in = safe_get_col(c("JH_IN", "JH_in", "jh_in", "Jump_Height", "JumpHeight", "JH", "jh")),
        pp_forceplate = safe_get_col(c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate", "PPForceplate", "ppForceplate")),
        force_at_pp = safe_get_col(c("Force_at_PP", "force_at_pp", "ForceAtPP", "forceAtPP", "FORCE_AT_PP")),
        vel_at_pp = safe_get_col(c("Vel_at_PP", "vel_at_pp", "VelAtPP", "velAtPP", "VEL_AT_PP")),
        pp_w_per_kg = safe_get_col(c("PP_W_per_kg", "pp_w_per_kg", "PPWPerKg", "ppWPerKg", "PP_W_PER_KG")),
        peak_power_w = safe_get_col(c("peak_power_w", "Peak_Power_W", "PeakPowerW", "peakPowerW", "PEAK_POWER_W")),
        time_to_peak_s = safe_get_col(c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS", "timeToPeakS", "TIME_TO_PEAK_S")),
        rpd_max_w_per_s = safe_get_col(c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS", "rpdMaxWPerS", "RPD_MAX_W_PER_S")),
        time_to_rpd_max_s = safe_get_col(c("time_to_rpd_max_s", "Time_to_RPD_Max_s", "TimeToRPDMaxS", "timeToRPDMaxS", "TIME_TO_RPD_MAX_S")),
        rise_time_10_90_s = safe_get_col(c("rise_time_10_90_s", "Rise_Time_10_90_s", "RiseTime10_90S", "riseTime10_90S", "RISE_TIME_10_90_S")),
        fwhm_s = safe_get_col(c("fwhm_s", "FWHM_s", "FwhmS", "fwhmS", "FWHM_S")),
        auc_j = safe_get_col(c("auc_j", "AUC_j", "AucJ", "aucJ", "AUC_J")),
        work_early_pct = safe_get_col(c("work_early_pct", "Work_Early_Pct", "WorkEarlyPct", "workEarlyPct", "WORK_EARLY_PCT")),
        decay_90_10_s = safe_get_col(c("decay_90_10_s", "Decay_90_10_s", "Decay90_10S", "decay90_10S", "DECAY_90_10_S")),
        t_com_norm_0to1 = safe_get_col(c("t_com_norm_0to1", "T_Com_Norm_0to1", "TComNorm0to1", "tComNorm0to1", "T_COM_NORM_0TO1")),
        skewness = safe_get_col(c("skewness", "Skewness", "SKEWNESS")),
        kurtosis = safe_get_col(c("kurtosis", "Kurtosis", "KURTOSIS")),
        spectral_centroid_hz = safe_get_col(c("spectral_centroid_hz", "Spectral_Centroid_Hz", "SpectralCentroidHz", "spectralCentroidHz", "SPECTRAL_CENTROID_HZ")),
        demographic = safe_get_col(c("demographic", "Demographic", "DEMOGRAPHIC")),
        stringsAsFactors = FALSE
      )
    } else if (table_name == "NMT") {
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        trial_name = safe_get_col(c("trial_name", "Trial_Name", "TrialName", "trialName")),
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        num_taps_10s = safe_get_col(c("NUM_TAPS_10s", "Num_Taps_10s", "num_taps_10s", "NumTaps10s", "numTaps10s")),
        num_taps_20s = safe_get_col(c("NUM_TAPS_20s", "Num_Taps_20s", "num_taps_20s", "NumTaps20s", "numTaps20s")),
        num_taps_30s = safe_get_col(c("NUM_TAPS_30s", "Num_Taps_30s", "num_taps_30s", "NumTaps30s", "numTaps30s")),
        num_taps = safe_get_col(c("NUM_TAPS", "Num_Taps", "num_taps", "NumTaps", "numTaps")),
        demographic = safe_get_col(c("demographic", "Demographic", "DEMOGRAPHIC", "Demographic")),
        stringsAsFactors = FALSE
      )
    } else if (table_name == "PPU") {
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        trial_name = safe_get_col(c("trial_name", "Trial_Name", "TrialName", "trialName")),
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        jh_in = safe_get_col(c("JH_IN", "JH_in", "jh_in", "Jump_Height", "JumpHeight", "JH", "jh")),
        peak_power = safe_get_col(c("Peak_Power", "peak_power", "PeakPower", "peakPower", "PEAK_POWER")),
        pp_forceplate = safe_get_col(c("PP_FORCEPLATE", "PP_Forceplate", "pp_forceplate", "PPForceplate", "ppForceplate")),
        force_at_pp = safe_get_col(c("Force_at_PP", "force_at_pp", "ForceAtPP", "forceAtPP", "FORCE_AT_PP")),
        vel_at_pp = safe_get_col(c("Vel_at_PP", "vel_at_pp", "VelAtPP", "velAtPP", "VEL_AT_PP")),
        pp_w_per_kg = safe_get_col(c("PP_W_per_kg", "pp_w_per_kg", "PPWPerKg", "ppWPerKg", "PP_W_PER_KG")),
        peak_power_w = safe_get_col(c("peak_power_w", "Peak_Power_W", "PeakPowerW", "peakPowerW", "PEAK_POWER_W")),
        time_to_peak_s = safe_get_col(c("time_to_peak_s", "Time_to_Peak_s", "TimeToPeakS", "timeToPeakS", "TIME_TO_PEAK_S")),
        rpd_max_w_per_s = safe_get_col(c("rpd_max_w_per_s", "RPD_Max_W_per_s", "RPDMaxWPerS", "rpdMaxWPerS", "RPD_MAX_W_PER_S")),
        time_to_rpd_max_s = safe_get_col(c("time_to_rpd_max_s", "Time_to_RPD_Max_s", "TimeToRPDMaxS", "timeToRPDMaxS", "TIME_TO_RPD_MAX_S")),
        rise_time_10_90_s = safe_get_col(c("rise_time_10_90_s", "Rise_Time_10_90_s", "RiseTime10_90S", "riseTime10_90S", "RISE_TIME_10_90_S")),
        fwhm_s = safe_get_col(c("fwhm_s", "FWHM_s", "FwhmS", "fwhmS", "FWHM_S")),
        auc_j = safe_get_col(c("auc_j", "AUC_j", "AucJ", "aucJ", "AUC_J")),
        work_early_pct = safe_get_col(c("work_early_pct", "Work_Early_Pct", "WorkEarlyPct", "workEarlyPct", "WORK_EARLY_PCT")),
        decay_90_10_s = safe_get_col(c("decay_90_10_s", "Decay_90_10_s", "Decay90_10S", "decay90_10S", "DECAY_90_10_S")),
        t_com_norm_0to1 = safe_get_col(c("t_com_norm_0to1", "T_Com_Norm_0to1", "TComNorm0to1", "tComNorm0to1", "T_COM_NORM_0TO1")),
        skewness = safe_get_col(c("skewness", "Skewness", "SKEWNESS")),
        kurtosis = safe_get_col(c("kurtosis", "Kurtosis", "KURTOSIS")),
        spectral_centroid_hz = safe_get_col(c("spectral_centroid_hz", "Spectral_Centroid_Hz", "SpectralCentroidHz", "spectralCentroidHz", "SPECTRAL_CENTROID_HZ")),
        demographic = safe_get_col(c("demographic", "Demographic", "DEMOGRAPHIC")),
        stringsAsFactors = FALSE
      )
    } else if (table_name == "Athletic_Screen") {
      # Main athletic screen table - just basic session info
      insert_df <- data.frame(
        athlete_uuid = matched_data$athlete_uuid,
        session_date = as.Date(matched_data[[date_col]]),
        source_system = "athletic_screen",
        source_athlete_id = matched_data[[name_col]],
        age_at_collection = matched_data$age_at_collection,
        age_group = matched_data$age_group,
        stringsAsFactors = FALSE
      )
    }
  
    # Debug: Show what's in insert_df for ALL tables
    print(paste("=== DEBUG: About to check insert_df for", table_name, "==="))
    print(paste("insert_df has", nrow(insert_df), "rows"))
    if (nrow(insert_df) > 0) {
      log_progress("  [DEBUG] insert_df summary for", table_name, ":")
      log_progress("    Rows:", nrow(insert_df))
      log_progress("    Columns:", paste(names(insert_df), collapse = ", "))
      log_progress("    Non-NA counts for key columns:")
      print("=== Checking key columns for non-NA values ===")
      key_cols <- c("jh_in", "peak_power", "pp_forceplate", "force_at_pp", "vel_at_pp", 
                    "pp_w_per_kg", "peak_power_w", "time_to_peak_s", "rpd_max_w_per_s",
                    "time_to_rpd_max_s", "rise_time_10_90_s", "fwhm_s", "auc_j", 
                    "work_early_pct", "decay_90_10_s", "t_com_norm_0to1", "skewness", 
                    "kurtosis", "spectral_centroid_hz", "demographic", "ct", "rsi", "side")
      for (col in key_cols) {
        if (col %in% names(insert_df)) {
          non_na <- sum(!is.na(insert_df[[col]]))
          total <- nrow(insert_df)
          msg <- paste("  ", col, ":", non_na, "non-NA out of", total)
          print(msg)
          if (non_na > 0) {
            log_progress("      ", col, ":", non_na, "non-NA out of", total, "(", round(100*non_na/total, 1), "%)")
            if (non_na <= 3) {
              vals_str <- paste(insert_df[[col]][!is.na(insert_df[[col]])], collapse = ", ")
              print(paste("    Values:", vals_str))
              log_progress("        Values:", vals_str)
            }
          } else {
            log_progress("      ", col, ": ALL NULL")
          }
        }
      }
      log_progress("    Sample row 1 values (first 15 columns):")
      for (col in names(insert_df)[1:min(15, length(names(insert_df)))]) {
        val <- insert_df[[col]][1]
        if (is.na(val)) val <- "NA"
        if (is.character(val) && nchar(val) > 50) val <- paste0(substr(val, 1, 50), "...")
        log_progress("      ", col, "=", val)
      }
    } else {
      log_progress("  [WARNING] insert_df is empty - no data to insert")
    }
  
    # Insert into PostgreSQL
    log_progress("  Inserting", nrow(insert_df), "rows into PostgreSQL...")
    
    # Remove NA values and convert to proper types
    insert_df <- insert_df[complete.cases(insert_df[, c("athlete_uuid", "session_date")]), ]
    
    if (nrow(insert_df) == 0) {
      log_progress("  No valid rows to insert after filtering")
      next
    }
    
    # Build column list for INSERT and UPDATE
    all_cols <- names(insert_df)
    # Exclude id and created_at from updates (they're auto-generated)
    update_cols <- all_cols[!all_cols %in% c("id", "created_at")]
    
    # Process each row individually - simpler and more reliable
    updated_count <- 0
    inserted_count <- 0
    
    print(paste("=== Starting to process", nrow(insert_df), "rows for", table_name, "==="))
    log_progress("  Processing", nrow(insert_df), "rows...")
    
    for (i in 1:nrow(insert_df)) {
      row <- insert_df[i, ]
      
      # Build WHERE clause for checking/updating
      where_parts <- c("athlete_uuid = $1", "session_date = $2")
      where_params <- list(row$athlete_uuid, as.character(row$session_date))
      param_num <- 3
      
      if ("trial_name" %in% all_cols) {
        where_parts <- c(where_parts, paste0("COALESCE(trial_name, '') = COALESCE($", param_num, ", '')"))
        where_params <- c(where_params, list(ifelse(is.na(row$trial_name), "", as.character(row$trial_name))))
        param_num <- param_num + 1
      }
      if ("side" %in% all_cols) {
        where_parts <- c(where_parts, paste0("COALESCE(side, '') = COALESCE($", param_num, ", '')"))
        where_params <- c(where_params, list(ifelse(is.na(row$side), "", as.character(row$side))))
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
      
      if (i == 1 && table_name == "CMJ") {
        print(paste("  First row exists check:", row_exists))
        print(paste("  Check SQL:", check_sql))
        print(paste("  Where params:", paste(where_params, collapse = ", ")))
      }
      
      if (row_exists) {
        # Update existing row
        # Don't update columns that are in the WHERE clause (athlete_uuid, session_date, trial_name, side)
        where_cols <- c("athlete_uuid", "session_date")
        if ("trial_name" %in% all_cols) where_cols <- c(where_cols, "trial_name")
        if ("side" %in% all_cols) where_cols <- c(where_cols, "side")
        
        # Only update columns that aren't in WHERE clause
        cols_to_update <- update_cols[!update_cols %in% where_cols]
        
        update_parts <- character()
        update_params <- where_params
        param_num <- length(where_params) + 1
        for (col in cols_to_update) {
          update_parts <- c(update_parts, paste0(col, " = $", param_num))
          update_params <- c(update_params, list(row[[col]]))
          param_num <- param_num + 1
        }
        
        update_sql <- paste0("
          UPDATE public.", table_mapping[[table_name]], "
          SET ", paste(update_parts, collapse = ", "), "
          WHERE ", paste(where_parts, collapse = " AND ")
        )
        
        tryCatch({
          if (i == 1 && table_name == "CMJ") {
            print(paste("  Executing UPDATE for first row"))
            print(paste("  Columns to update:", paste(cols_to_update, collapse = ", ")))
            print(paste("  Update SQL:", substr(update_sql, 1, 300)))
            print(paste("  Update params count:", length(update_params)))
            print(paste("  Sample update values - jh_in:", row$jh_in, "peak_power:", row$peak_power, "time_to_rpd_max_s:", row$time_to_rpd_max_s))
          }
          update_result <- DBI::dbExecute(pg_conn, update_sql, params = update_params)
          if (update_result > 0) {
            updated_count <- updated_count + 1
            if (i == 1 && table_name == "CMJ") {
              print(paste("  UPDATE succeeded, affected rows:", update_result))
              # Verify the update worked by querying back
              verify_sql <- paste0("
                SELECT jh_in, peak_power, time_to_rpd_max_s, rise_time_10_90_s 
                FROM public.", table_mapping[[table_name]], "
                WHERE ", paste(where_parts, collapse = " AND "), "
                LIMIT 1
              ")
              verify_result <- DBI::dbGetQuery(pg_conn, verify_sql, params = where_params)
              print(paste("  Verification - jh_in:", verify_result$jh_in, "peak_power:", verify_result$peak_power, "time_to_rpd_max_s:", verify_result$time_to_rpd_max_s))
            }
          } else {
            if (i == 1 && table_name == "CMJ") {
              print(paste("  UPDATE returned 0 affected rows"))
            }
          }
        }, error = function(e) {
          print(paste("  [ERROR] Update failed for row", i, ":", conditionMessage(e)))
          log_progress("  [WARNING] Update failed for row", i, ":", conditionMessage(e))
        })
      } else {
        # Insert new row
        insert_cols <- paste(all_cols, collapse = ", ")
        insert_placeholders <- paste0("$", 1:length(all_cols), collapse = ", ")
        insert_params <- lapply(all_cols, function(col) row[[col]])
        
        insert_sql <- paste0("
          INSERT INTO public.", table_mapping[[table_name]], " (", insert_cols, ")
          VALUES (", insert_placeholders, ")
        ")
        
        tryCatch({
          if (i == 1 && table_name == "CMJ") {
            print(paste("  Executing INSERT for first row"))
            print(paste("  Insert SQL:", substr(insert_sql, 1, 200), "..."))
            print(paste("  Insert params count:", length(insert_params)))
            print(paste("  First few param values:", paste(head(insert_params, 3), collapse = ", ")))
          }
          insert_result <- DBI::dbExecute(pg_conn, insert_sql, params = insert_params)
          inserted_count <- inserted_count + 1
          if (i == 1 && table_name == "CMJ") {
            print(paste("  INSERT succeeded"))
          }
        }, error = function(e) {
          print(paste("  [ERROR] Insert failed for row", i, ":", conditionMessage(e)))
          # If insert fails, try update instead (might be a race condition)
          update_parts <- character()
          update_params <- where_params
          param_num <- length(where_params) + 1
          for (col in update_cols) {
            update_parts <- c(update_parts, paste0(col, " = $", param_num))
            update_params <- c(update_params, list(row[[col]]))
            param_num <- param_num + 1
          }
          
          update_sql <- paste0("
            UPDATE public.", table_mapping[[table_name]], "
            SET ", paste(update_parts, collapse = ", "), "
            WHERE ", paste(where_parts, collapse = " AND ")
          )
          
          tryCatch({
            DBI::dbExecute(pg_conn, update_sql, params = update_params)
            updated_count <<- updated_count + 1
          }, error = function(e2) {
            log_progress("  [WARNING] Both insert and update failed for row", i)
          })
        })
      }
      
      # Progress indicator
      if (i %% 50 == 0) {
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
  }
  
  total_skipped <- total_skipped + sum(unmatched)
}

# Update athlete flags
log_progress("\nUpdating athlete data flags...")
tryCatch({
  if (exists("update_athlete_flags")) {
    update_result <- update_athlete_flags(pg_conn, verbose = TRUE)
    if (update_result$success) {
      log_progress("  [SUCCESS] Athlete flags updated")
    } else {
      log_progress("  [WARNING] Failed to update flags:", update_result$message)
    }
  }
}, error = function(e) {
  log_progress("  [WARNING] Error updating flags:", conditionMessage(e))
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

