# Migrate Pro-Sup Test data from SQLite to PostgreSQL
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

# Helper to convert text/numeric values to numeric (handles TEXT columns that should be DECIMAL)
convert_to_numeric <- function(val) {
  if (is.na(val) || val == "" || val == "NULL" || val == "null") return(NA_real_)
  if (is.numeric(val)) return(as.numeric(val))
  if (is.character(val)) {
    # Remove any non-numeric characters except decimal point and minus sign
    cleaned <- gsub("[^0-9.\\-]", "", val)
    if (cleaned == "" || cleaned == "-" || cleaned == ".") return(NA_real_)
    num_val <- tryCatch(as.numeric(cleaned), warning = function(e) NA_real_, error = function(e) NA_real_)
    return(num_val)
  }
  return(NA_real_)
}

# Parse test_date - might be Excel serial date or date string
parse_test_date <- function(date_val) {
  if (is.na(date_val) || date_val == "") return(NA)
  
  # If it's already a Date object, return it
  if (inherits(date_val, "Date")) {
    return(date_val)
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
  # Only treat as Excel serial if it's clearly a serial number (large numbers)
  if (grepl("^\\d+$", date_str)) {
    serial_num <- as.numeric(date_str)
    # Excel serial dates: days since 1900-01-01
    # Valid Excel serial dates are typically > 1 and < 100000 (covers dates up to ~2174)
    # But dates like 20342 would be around 1955, which is wrong for 2025 dates
    # So we need to check: if the number is > 40000, it's likely a date after 2009
    # Excel serial for 2000-01-01 is 36526, for 2025-01-01 is around 45658
    if (serial_num >= 1 && serial_num < 100000) {
      tryCatch({
        # Excel dates: serial number represents days since 1900-01-01
        # Excel incorrectly counts 1900 as leap year, so we adjust
        date_obj <- as.Date(serial_num - 1, origin = "1899-12-30")
        # Only accept if it's a reasonable date (after 2000)
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

# ---------- Configuration ----------
SQLITE_DB_PATH <- file.path("python", "proSupTest", "pro-sup_data.sqlite")

# ---------- Main Processing ----------
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** PRO-SUP TEST MIGRATION TO POSTGRESQL ***\n")
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

# Process pro_sup_data table
table_name <- "pro_sup_data"
pg_table_name <- "f_pro_sup"

total_inserted <- 0
total_skipped <- 0
total_rows_read <- 0
unmatched_athletes <- list()

if (!table_name %in% tables) {
  stop("Table '", table_name, "' not found in SQLite database!")
}

log_progress("\nProcessing table:", table_name, "->", pg_table_name)

# Create table if it doesn't exist
log_progress("  Ensuring PostgreSQL table exists...")
create_table_sql <- paste0("
CREATE TABLE IF NOT EXISTS public.", pg_table_name, " (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    age DECIMAL,
    height DECIMAL,
    weight DECIMAL,
    injury_history TEXT,
    season_phase VARCHAR(50),
    dynomometer_score VARCHAR(50),
    comments TEXT,
    forearm_rom_0to10 DECIMAL,
    forearm_rom_10to20 DECIMAL,
    forearm_rom_20to30 DECIMAL,
    forearm_rom DECIMAL,
    tot_rom_0to10 DECIMAL,
    tot_rom_10to20 DECIMAL,
    tot_rom_20to30 DECIMAL,
    tot_rom DECIMAL,
    num_of_flips_0_10 DECIMAL,
    num_of_flips_10_20 DECIMAL,
    num_of_flips_20_30 DECIMAL,
    num_of_flips DECIMAL,
    avg_velo_0_10 DECIMAL,
    avg_velo_10_20 DECIMAL,
    avg_velo_20_30 DECIMAL,
    avg_velo DECIMAL,
    fatigue_index_10 DECIMAL,
    fatigue_index_20 DECIMAL,
    fatigue_index_30 DECIMAL,
    total_fatigue_score DECIMAL,
    consistency_penalty DECIMAL,
    total_score DECIMAL,
    cumulative_rom DECIMAL,
    raw_total_score DECIMAL,
    age_at_collection DECIMAL,
    age_group TEXT
)
")

tryCatch({
  DBI::dbExecute(pg_conn, create_table_sql)
  log_progress("  Table created or already exists")
}, error = function(e) {
  log_progress("  [WARNING] Could not create table (may already exist):", conditionMessage(e))
})

# Add missing columns if table exists but is missing some columns
log_progress("  Checking for missing columns...")
missing_columns <- list(
  list(name = "cumulative_rom", type = "DECIMAL"),
  list(name = "raw_total_score", type = "DECIMAL"),
  list(name = "age_at_collection", type = "DECIMAL"),
  list(name = "age_group", type = "TEXT")
)

for (col_info in missing_columns) {
  col_name <- col_info$name
  col_type <- col_info$type
  
  # Check if column exists
  check_col_sql <- paste0("
    SELECT COUNT(*) as cnt
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '", pg_table_name, "'
      AND column_name = '", col_name, "'
  ")
  
  col_exists <- tryCatch({
    result <- DBI::dbGetQuery(pg_conn, check_col_sql)
    result$cnt[1] > 0
  }, error = function(e) FALSE)
  
  if (!col_exists) {
    add_col_sql <- paste0("
      ALTER TABLE public.", pg_table_name, "
      ADD COLUMN ", col_name, " ", col_type, "
    ")
    tryCatch({
      DBI::dbExecute(pg_conn, add_col_sql)
      log_progress("  Added missing column:", col_name)
    }, error = function(e) {
      log_progress("  [WARNING] Could not add column ", col_name, ":", conditionMessage(e))
    })
  }
}

# Read data from SQLite
log_progress("  Reading data from SQLite...")
data <- DBI::dbGetQuery(sqlite_conn, paste0("SELECT * FROM ", table_name))

if (nrow(data) == 0) {
  stop("No data in table!")
}

total_rows_read <- total_rows_read + nrow(data)
log_progress("  Found", nrow(data), "rows")

# Check for name column
name_col <- if ("name" %in% names(data)) "name" else NULL
if (is.null(name_col)) {
  stop("No 'name' column found in SQLite table!")
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
          'pro_sup',
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
  stop("No matched athletes!")
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

# Parse test_date to get session_date
# The dates might be stored as strings "2025-09-11" or as numbers
# If they're numbers like 20342, they might be days since a different epoch
# We need to check the actual values and convert appropriately

# Use lapply instead of sapply to preserve Date objects
matched_data$session_date <- do.call("c", lapply(matched_data$test_date, function(date_val) {
  # If it's already a Date, return it
  if (inherits(date_val, "Date")) {
    return(date_val)
  }
  
  # Convert to character first
  date_str <- as.character(date_val)
  
  # Priority 1: If it's a string that looks like a date (YYYY-MM-DD), parse it directly
  # This should handle most cases where dates are stored as strings
  if (grepl("^\\d{4}-\\d{2}-\\d{2}$", date_str)) {
    date_obj <- tryCatch({
      as.Date(date_str, format = "%Y-%m-%d")
    }, error = function(e) NA, warning = function(w) NA)
    
    if (!is.na(date_obj) && inherits(date_obj, "Date") && 
        date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
      return(date_obj)
    }
  }
  
  # Priority 2: If it's numeric, try to determine what it represents
  if (is.numeric(date_val) && !is.na(date_val)) {
    # If the number is very large (>= 36526), it's likely an Excel serial date
    # Excel serial for 2000-01-01 is 36526, for 2025-01-01 is ~45658
    if (date_val >= 36526 && date_val < 100000) {
      tryCatch({
        date_obj <- as.Date(date_val - 1, origin = "1899-12-30")
        if (!is.na(date_obj) && date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
          return(date_obj)
        }
      }, error = function(e) NULL)
    }
    
    # If the number is smaller (like 20000-30000), it might need special handling
    # Dates like 20342 when converted as Excel serial give 1955, but should be 2025
    # The difference is approximately 70 years = ~25,550 days
    # So if converting gives a date before 2000, try adding the offset
    if (date_val >= 10000 && date_val < 36526) {
      # First, try converting as-is to see what we get
      test_date <- tryCatch({
        as.Date(date_val - 1, origin = "1899-12-30")
      }, error = function(e) NA)
      
      # If the result is before 2000, it's likely wrong - try adding offset
      if (!is.na(test_date) && test_date < as.Date("2000-01-01")) {
        # Add approximately 70 years (25,550 days) to get to 2025 range
        # Actually, let's calculate: 2025-09-11 Excel serial is ~45658
        # 20342 + 25316 = 45658, so the offset is 25316
        adjusted_num <- date_val + 25316
        date_obj <- tryCatch({
          as.Date(adjusted_num - 1, origin = "1899-12-30")
        }, error = function(e) NA)
        if (!is.na(date_obj) && date_obj > as.Date("2020-01-01") && date_obj < as.Date("2030-01-01")) {
          return(date_obj)
        }
      }
      
      # Also try as Unix timestamp (days since 1970-01-01) as a fallback
      date_obj <- tryCatch({
        as.Date(date_val, origin = "1970-01-01")
      }, error = function(e) NA)
      if (!is.na(date_obj) && date_obj > as.Date("2000-01-01") && date_obj < as.Date("2100-01-01")) {
        return(date_obj)
      }
    }
  }
  
  # Priority 3: Try the general parse_test_date function
  result <- parse_test_date(date_val)
  # Ensure we return a Date object, not a number
  if (!is.na(result) && inherits(result, "Date")) {
    return(result)
  }
  
  # If all parsing failed, return NA as Date
  return(as.Date(NA_character_))
}))

# Ensure session_date is a Date vector
# Check what we actually got
print(paste("  session_date class after parsing:", class(matched_data$session_date[1])))
print(paste("  Sample session_date values:", paste(head(matched_data$session_date, 3), collapse = ", ")))

if (!inherits(matched_data$session_date, "Date")) {
  # If it's numeric, try to convert back to Date
  if (is.numeric(matched_data$session_date)) {
    print("  WARNING: session_date is numeric, attempting to convert...")
    # The numbers might be days since 1970-01-01 or Excel serial dates
    # Try both conversions
    tryCatch({
      # Try as days since 1970
      matched_data$session_date <- as.Date(matched_data$session_date, origin = "1970-01-01")
      if (any(matched_data$session_date > as.Date("2100-01-01"), na.rm = TRUE)) {
        # If dates are too far in future, try Excel serial conversion
        matched_data$session_date <- as.Date(matched_data$session_date - 1, origin = "1899-12-30")
      }
    }, error = function(e) {
      print(paste("  ERROR converting numeric dates:", conditionMessage(e)))
    })
  } else {
    # Try to parse as character dates
    matched_data$session_date <- as.Date(matched_data$session_date)
  }
}

# Debug: show some date conversions
if (nrow(matched_data) > 0) {
  sample_dates <- head(matched_data[!is.na(matched_data$test_date), c("test_date", "session_date")], 10)
  if (nrow(sample_dates) > 0) {
    print("Sample date conversions:")
    for (i in 1:nrow(sample_dates)) {
      orig_val <- sample_dates$test_date[i]
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
  stop("No rows with valid session dates after parsing!")
}

# Calculate age_at_collection and age_group
matched_data$date_of_birth <- dob_lookup[matched_data$athlete_uuid]
matched_data$age_at_collection <- mapply(function(sd, dob) {
  if (is.na(sd) || is.na(dob)) return(NA)
  as.numeric(difftime(sd, dob, units = "days")) / 365.25
}, matched_data$session_date, matched_data$date_of_birth)

matched_data$age_group <- mapply(calculate_age_group, matched_data$session_date, matched_data$date_of_birth)

# Convert session_date to character string BEFORE creating dataframe
# session_date should already be Date objects from the parsing above
# But handle the case where they might be numbers or other types
session_date_str <- sapply(matched_data$session_date, function(x) {
  if (is.na(x)) return(NA_character_)
  
  # If it's a Date object, format it
  if (inherits(x, "Date")) {
    return(format(x, "%Y-%m-%d"))
  }
  
  # If it's numeric, it shouldn't be - but try to convert it
  if (is.numeric(x)) {
    # This shouldn't happen if parsing worked correctly
    # But if it does, try to parse it again
    parsed <- parse_test_date(x)
    if (!is.na(parsed) && inherits(parsed, "Date")) {
      return(format(parsed, "%Y-%m-%d"))
    }
    return(NA_character_)
  }
  
  # Try as character
  date_str <- as.character(x)
  if (grepl("^\\d{4}-\\d{2}-\\d{2}$", date_str)) {
    return(date_str)
  }
  
  return(NA_character_)
})

# Build insert dataframe - convert TEXT columns to numeric where needed
insert_df <- data.frame(
  athlete_uuid = matched_data$athlete_uuid,
  session_date = session_date_str,
  source_system = "pro_sup",
  source_athlete_id = matched_data[[name_col]],
  age_at_collection = matched_data$age_at_collection,
  age_group = matched_data$age_group,
  age = sapply(safe_get_col(c("age", "Age")), convert_to_numeric),
  height = sapply(safe_get_col(c("height", "Height")), convert_to_numeric),
  weight = sapply(safe_get_col(c("weight", "Weight")), convert_to_numeric),
  injury_history = safe_get_col(c("injury_history", "Injury_History")),
  season_phase = safe_get_col(c("season_phase", "Season_Phase")),
  dynomometer_score = safe_get_col(c("dynomometer_score", "Dynomometer_Score")),
  comments = safe_get_col(c("Comments", "comments")),
  forearm_rom_0to10 = sapply(safe_get_col(c("forearm_rom_0to10", "Forearm_ROM_0to10")), convert_to_numeric),
  forearm_rom_10to20 = sapply(safe_get_col(c("forearm_rom_10to20", "Forearm_ROM_10to20")), convert_to_numeric),
  forearm_rom_20to30 = sapply(safe_get_col(c("forearm_rom_20to30", "Forearm_ROM_20to30")), convert_to_numeric),
  forearm_rom = sapply(safe_get_col(c("forearm_rom", "Forearm_ROM")), convert_to_numeric),
  tot_rom_0to10 = sapply(safe_get_col(c("tot_rom_0to10", "Tot_ROM_0to10")), convert_to_numeric),
  tot_rom_10to20 = sapply(safe_get_col(c("tot_rom_10to20", "Tot_ROM_10to20")), convert_to_numeric),
  tot_rom_20to30 = sapply(safe_get_col(c("tot_rom_20to30", "Tot_ROM_20to30")), convert_to_numeric),
  tot_rom = sapply(safe_get_col(c("tot_rom", "Tot_ROM")), convert_to_numeric),
  num_of_flips_0_10 = sapply(safe_get_col(c("num_of_flips_0_10", "Num_of_Flips_0_10")), convert_to_numeric),
  num_of_flips_10_20 = sapply(safe_get_col(c("num_of_flips_10_20", "Num_of_Flips_10_20")), convert_to_numeric),
  num_of_flips_20_30 = sapply(safe_get_col(c("num_of_flips_20_30", "Num_of_Flips_20_30")), convert_to_numeric),
  num_of_flips = sapply(safe_get_col(c("num_of_flips", "Num_of_Flips")), convert_to_numeric),
  avg_velo_0_10 = sapply(safe_get_col(c("avg_velo_0_10", "Avg_Velo_0_10")), convert_to_numeric),
  avg_velo_10_20 = sapply(safe_get_col(c("avg_velo_10_20", "Avg_Velo_10_20")), convert_to_numeric),
  avg_velo_20_30 = sapply(safe_get_col(c("avg_velo_20_30", "Avg_Velo_20_30")), convert_to_numeric),
  avg_velo = sapply(safe_get_col(c("avg_velo", "Avg_Velo")), convert_to_numeric),
  fatigue_index_10 = sapply(safe_get_col(c("fatigue_index_10", "Fatigue_Index_10")), convert_to_numeric),
  fatigue_index_20 = sapply(safe_get_col(c("fatigue_index_20", "Fatigue_Index_20")), convert_to_numeric),
  fatigue_index_30 = sapply(safe_get_col(c("fatigue_index_30", "Fatigue_Index_30")), convert_to_numeric),
  total_fatigue_score = sapply(safe_get_col(c("total_fatigue_score", "Total_Fatigue_Score")), convert_to_numeric),
  consistency_penalty = sapply(safe_get_col(c("consistency_penalty", "Consistency_Penalty")), convert_to_numeric),
  total_score = sapply(safe_get_col(c("total_score", "Total_Score")), convert_to_numeric),
  cumulative_rom = sapply(safe_get_col(c("cumulative_rom", "Cumulative_ROM")), convert_to_numeric),
  raw_total_score = sapply(safe_get_col(c("raw_total_score", "Raw_Total_Score")), convert_to_numeric),
  stringsAsFactors = FALSE
)

# Remove any rows that still have invalid dates (numeric or NA)
if (nrow(insert_df) > 0) {
  # Filter out rows where session_date is NA, "NA", or doesn't match date format
  valid_date_mask <- !is.na(insert_df$session_date) & 
                     insert_df$session_date != "NA" & 
                     !grepl("^\\d+$", insert_df$session_date) &
                     grepl("^\\d{4}-\\d{2}-\\d{2}$", insert_df$session_date)
  
  if (sum(valid_date_mask) < nrow(insert_df)) {
    print(paste("  Filtering out", sum(!valid_date_mask), "rows with invalid dates"))
    print(paste("  Sample invalid dates:", paste(head(insert_df$session_date[!valid_date_mask], 5), collapse = ", ")))
  }
  
  insert_df <- insert_df[valid_date_mask, ]
}

if (nrow(insert_df) == 0) {
  stop("No rows with valid session dates after final check!")
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
  
  # Build column list for INSERT and UPDATE
  all_cols <- names(insert_df)
  # Exclude id and created_at from updates (they're auto-generated)
  update_cols <- all_cols[!all_cols %in% c("id", "created_at")]
  # Exclude key columns from update_cols as they are in the WHERE clause
  key_cols_for_update_exclusion <- c("athlete_uuid", "session_date")
  update_cols <- update_cols[!update_cols %in% key_cols_for_update_exclusion]
  
  # Build WHERE clause for checking/updating
  where_params <- list(row$athlete_uuid, session_date_str)
  
  # Check if row exists
  check_sql <- paste0("
    SELECT COUNT(*) as cnt FROM public.", pg_table_name, "
    WHERE athlete_uuid = $1 AND session_date = $2
  ")
  
  exists_result <- tryCatch({
    DBI::dbGetQuery(pg_conn, check_sql, params = where_params)
  }, error = function(e) {
    print(paste("  [ERROR] Check query failed for row", i, ":", conditionMessage(e)))
    log_progress("  [ERROR] Check query failed:", conditionMessage(e))
    return(data.frame(cnt = 0))
  })
  
  row_exists <- exists_result$cnt[1] > 0
  
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
    
    # WHERE clause parameters need to be numbered after SET parameters
    num_set_params <- length(update_params_for_set)
    where_param_1 <- num_set_params + 1
    where_param_2 <- num_set_params + 2
    where_parts <- c(
      paste0("athlete_uuid = $", where_param_1),
      paste0("session_date = $", where_param_2)
    )
    
    # Combine SET parameters with WHERE parameters
    final_update_params <- c(update_params_for_set, where_params)
    
    update_sql <- paste0("
      UPDATE public.", pg_table_name, "
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
      return(val)
    })
    
    insert_sql <- paste0("
      INSERT INTO public.", pg_table_name, " (", insert_cols, ")
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
      
      # WHERE clause parameters need to be numbered after SET parameters
      num_set_params <- length(update_params_for_set)
      where_param_1 <- num_set_params + 1
      where_param_2 <- num_set_params + 2
      fallback_where_parts <- c(
        paste0("athlete_uuid = $", where_param_1),
        paste0("session_date = $", where_param_2)
      )
      
      final_update_params <- c(update_params_for_set, where_params)
      
      update_sql <- paste0("
        UPDATE public.", pg_table_name, "
        SET ", paste(update_parts, collapse = ", "), "
        WHERE ", paste(fallback_where_parts, collapse = " AND ")
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

