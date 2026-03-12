# Direct database insert script to backfill athletes
# Bypasses Python athlete_manager and directly inserts into analytics.d_athletes

# ==== Minimal deps ====
library(xml2)
library(dplyr)
library(tibble)
library(stringr)
library(readr)
library(DBI)

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
  units_path <- file.path(dirname(config_path), "units.R")
  if (file.exists(units_path)) {
    source(units_path)
  }
}

find_and_source_common()

# ---------- Helpers ----------
log_progress <- function(...) {
  args <- list(...)
  args <- args[names(args) != "sep"]
  message <- do.call(paste0, args)
  cat(message, "\n", sep = "")
  flush.console()
}

`%||%` <- function(a, b) if (!is.null(a)) a else b
nzchr <- function(x) ifelse(is.na(x) | x == "", NA_character_, x)
nznum <- function(x) suppressWarnings(readr::parse_number(x))

# Robust XML reading
read_xml_robust <- function(path) {
  tryCatch(
    {
      if (grepl("\\.gz$", path, ignore.case = TRUE)) {
        txt <- paste(readLines(gzfile(path), warn = FALSE), collapse = "\n")
        read_xml(txt)
      } else {
        read_xml(path)
      }
    },
    error = function(e) {
      txt <- if (grepl("\\.gz$", path, ignore.case = TRUE)) {
        paste(readLines(gzfile(path), warn = FALSE), collapse = "\n")
      } else {
        readr::read_file(path)
      }
      end_tag <- "</Subject>"
      m <- regexpr(end_tag, txt, fixed = TRUE)
      if (m > 0) {
        trimmed <- substr(txt, 1, m + nchar(end_tag) - 1)
        read_xml(trimmed)
      } else {
        end_tag <- "</v3d>"
        m <- regexpr(end_tag, txt, fixed = TRUE)
        if (m > 0) {
          trimmed <- substr(txt, 1, m + nchar(end_tag) - 1)
          read_xml(trimmed)
        } else stop(e)
      }
    }
  )
}

# Normalize name for matching - EXACT COPY from pitching_processing.R
normalize_name_for_matching <- function(name) {
  if (is.na(name) || name == "") return(NA_character_)
  
  # Remove dates (patterns like "2024-01-15", "1/15/2024", "01-15-2024", etc.)
  # Remove 4-digit years and date patterns
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}", "", name)  # Dates like 1/15/2024 or 01-15-2024
  name <- gsub("\\s*\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}", "", name)  # Dates like 2024-01-15
  name <- gsub("\\s*\\d{4}", "", name)  # Standalone 4-digit years
  
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
  
  # Convert to uppercase and remove extra spaces for consistent matching
  name <- toupper(gsub("\\s+", " ", trimws(name)))
  
  return(name)
}

# Normalize name for display - removes dates and converts to First Last format
normalize_name_for_display <- function(name) {
  if (is.na(name) || name == "") return(NA_character_)
  
  # Remove dates FIRST (before handling comma format)
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}", "", name)
  name <- gsub("\\s*\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}", "", name)
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
  
  # Capitalize properly (First Last format)
  words <- strsplit(name, "\\s+")[[1]]
  words <- paste(toupper(substring(words, 1, 1)), tolower(substring(words, 2)), sep = "", collapse = " ")
  trimws(words)
}

# Extract athlete info from session.xml
extract_athlete_info <- function(path) {
  doc <- tryCatch(read_xml_robust(path), error = function(e) NULL)
  if (is.null(doc)) return(NULL)
  
  root <- xml_root(doc)
  if (!identical(xml_name(root), "Subject")) return(NULL)
  
  fields <- xml_find_first(root, "./Fields")
  if (inherits(fields, "xml_missing")) return(NULL)
  
  id <- nzchr(xml_text(xml_find_first(fields, "./ID")))
  name <- nzchr(xml_text(xml_find_first(fields, "./Name")))
  dob <- nzchr(xml_text(xml_find_first(fields, "./Date_of_birth")))
  sex <- nzchr(xml_text(xml_find_first(fields, "./Sex")))
  gender_raw <- nzchr(xml_text(xml_find_first(fields, "./Gender")))
  raw_val <- if (is.na(sex) || sex == "") gender_raw else sex
  gender <- if (!is.na(raw_val) && tolower(trimws(raw_val)) %in% c("female", "f")) "Female" else "Male"
  height <- nzchr(xml_text(xml_find_first(fields, "./Height")))
  weight <- nzchr(xml_text(xml_find_first(fields, "./Weight")))
  creation_date <- nzchr(xml_text(xml_find_first(fields, "./Creation_date")))
  
  # Calculate age if DOB available
  age <- NA_real_
  dob_date <- NA
  if (!is.na(dob) && dob != "") {
    tryCatch({
      dob_date <- as.Date(dob, format = "%m/%d/%Y")
      if (!is.na(dob_date)) {
        age <- as.numeric(difftime(Sys.Date(), dob_date, units = "days")) / 365.25
      }
    }, error = function(e) NULL)
  }
  
  # Calculate age_at_collection
  age_at_collection <- NA_real_
  if (!is.na(creation_date) && creation_date != "" && !is.na(dob_date)) {
    tryCatch({
      collection_date <- as.Date(creation_date, format = "%m/%d/%Y")
      if (is.na(collection_date)) {
        collection_date <- as.Date(creation_date, format = "%Y-%m-%d")
      }
      if (!is.na(collection_date) && !is.na(dob_date)) {
        age_at_collection <- as.numeric(difftime(collection_date, dob_date, units = "days")) / 365.25
      }
    }, error = function(e) NULL)
  }
  
  # Session XML height/weight are meters and kg; convert to inches and lbs for storage
  h_m <- nznum(height)
  w_kg <- nznum(weight)
  tibble(
    athlete_id = id,
    name = name,
    date_of_birth = dob,
    dob_date = dob_date,
    age = age,
    age_at_collection = age_at_collection,
    gender = gender,
    height = meters_to_inches(h_m),
    weight = kg_to_lbs(w_kg),
    creation_date = creation_date,
    source_file = basename(path),
    source_path = path
  )
}

# ---------- Configuration ----------
DATA_ROOT <- Sys.getenv("PITCHING_DATA_DIR", unset = "H:/Pitching/Data")

# ---------- Main processing ----------
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** DIRECT ATHLETE BACKFILL SCRIPT ***\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("\n")

# Connect to warehouse
log_progress("Connecting to warehouse database...")
con <- tryCatch({
  conn <- get_warehouse_connection()
  # Test the connection
  DBI::dbGetQuery(conn, "SELECT 1")
  log_progress("Connection successful")
  conn
}, error = function(e) {
  stop("Failed to connect to warehouse: ", conditionMessage(e))
})

# Get unique athlete UUIDs from kinematics table
log_progress("Getting unique athlete UUIDs from f_kinematics_pitching...")
existing_uuids <- DBI::dbGetQuery(con, "
  SELECT DISTINCT athlete_uuid 
  FROM public.f_kinematics_pitching
")$athlete_uuid

log_progress("Found", length(existing_uuids), "unique athlete UUIDs in kinematics table")

# Get existing athletes from warehouse
log_progress("Checking existing athletes in analytics.d_athletes...")
existing_athletes <- DBI::dbGetQuery(con, "
  SELECT athlete_uuid, normalized_name
  FROM analytics.d_athletes
")

existing_uuid_set <- setdiff(existing_uuids, existing_athletes$athlete_uuid)
log_progress("Found", length(existing_uuid_set), "UUIDs missing from d_athletes")

if (length(existing_uuid_set) == 0) {
  log_progress("All athletes already exist in d_athletes!")
  DBI::dbDisconnect(con)
  stop("No athletes to backfill - all UUIDs already exist in d_athletes")
}

# Find all session.xml files
log_progress("Scanning for session.xml files in:", DATA_ROOT)
session_files <- tryCatch({
  list.files(DATA_ROOT, pattern = "(?i)session\\.xml$", recursive = TRUE, full.names = TRUE)
}, error = function(e) {
  stop("Cannot access directory: ", DATA_ROOT, "\nError: ", conditionMessage(e))
})

session_files_gz <- tryCatch({
  list.files(DATA_ROOT, pattern = "(?i)session\\.xml\\.gz$", recursive = TRUE, full.names = TRUE)
}, error = function(e) {
  character(0)
})

session_files <- c(session_files, session_files_gz)
log_progress("Found", length(session_files), "session.xml files")

# Process files and build athlete map
log_progress("Processing session.xml files to extract athlete info...")
athlete_map_by_id <- list()  # Maps source_athlete_id to athlete info

for (i in seq_along(session_files)) {
  sf <- session_files[i]
  
  if (i %% 50 == 0 || i <= 5) {
    log_progress("[", i, "/", length(session_files), "] Processing:", basename(sf))
  }
  
  athlete_info <- extract_athlete_info(sf)
  
  if (is.null(athlete_info) || nrow(athlete_info) == 0) {
    next
  }
  
  athlete_name <- athlete_info$name[1]
  normalized_name <- normalize_name_for_matching(athlete_name)
  display_name <- normalize_name_for_display(athlete_name)
  source_id <- athlete_info$athlete_id[1]
  
  # Store by source_athlete_id for easy lookup
  if (!is.na(source_id) && source_id != "") {
    athlete_map_by_id[[source_id]] <- list(
      info = athlete_info,
      display_name = display_name,
      normalized_name = normalized_name
    )
  }
}

log_progress("Extracted info for", length(athlete_map_by_id), "unique athletes")

# Now we need to match UUIDs to athletes
# Strategy: Get UUIDs from kinematics table and try to match by directory structure
# For now, let's create minimal athlete records for missing UUIDs

log_progress("Creating missing athlete records...")
inserted_count <- 0
updated_count <- 0

for (uuid in existing_uuid_set) {
  # Try to find athlete info by checking if any session.xml path contains this UUID's data
  # For now, create minimal record
  normalized_name <- paste0("UNKNOWN_", uuid)
  display_name <- paste0("Unknown Athlete (", substr(uuid, 1, 8), ")")
  
  # Check if we can find better info by querying kinematics table for source_athlete_id
  source_info <- DBI::dbGetQuery(con, paste0("
    SELECT DISTINCT source_athlete_id
    FROM public.f_kinematics_pitching
    WHERE athlete_uuid = '", uuid, "'
    LIMIT 1
  "))
  
  if (nrow(source_info) > 0 && !is.na(source_info$source_athlete_id[1])) {
    # Try to find athlete by source_athlete_id
    source_id <- source_info$source_athlete_id[1]
    found <- FALSE
    if (source_id %in% names(athlete_map_by_id)) {
      display_name <- athlete_map_by_id[[source_id]]$display_name
      normalized_name <- athlete_map_by_id[[source_id]]$normalized_name
      athlete_info <- athlete_map_by_id[[source_id]]$info
      found <- TRUE
    }
    
    if (found) {
      # Insert with full info
      dob_str <- NULL
      if (!is.na(athlete_info$dob_date) && !is.na(athlete_info$dob_date[1])) {
        dob_str <- format(athlete_info$dob_date[1], "%Y-%m-%d")
      }
      
      # Build SQL with proper escaping
      dob_sql <- if (!is.null(dob_str)) paste0("'", gsub("'", "''", dob_str), "'") else "NULL"
      age_sql <- if (!is.na(athlete_info$age[1])) athlete_info$age[1] else "NULL"
      age_at_collection_sql <- if (!is.na(athlete_info$age_at_collection[1])) athlete_info$age_at_collection[1] else "NULL"
      gender_sql <- if (!is.na(athlete_info$gender[1])) paste0("'", gsub("'", "''", athlete_info$gender[1]), "'") else "NULL"
      height_sql <- if (!is.na(athlete_info$height[1])) athlete_info$height[1] else "NULL"
      weight_sql <- if (!is.na(athlete_info$weight[1])) athlete_info$weight[1] else "NULL"
      source_athlete_id_sql <- if (!is.na(athlete_info$athlete_id[1])) paste0("'", gsub("'", "''", athlete_info$athlete_id[1]), "'") else "NULL"
      
      tryCatch({
        sql <- paste0("
          INSERT INTO analytics.d_athletes (
            athlete_uuid, name, normalized_name, date_of_birth, age, age_at_collection,
            gender, height, weight, source_system, source_athlete_id, created_at, updated_at
          ) VALUES (
            '", uuid, "',
            '", gsub("'", "''", display_name), "',
            '", gsub("'", "''", normalized_name), "',
            ", dob_sql, ",
            ", age_sql, ",
            ", age_at_collection_sql, ",
            ", gender_sql, ",
            ", height_sql, ",
            ", weight_sql, ",
            'pitching',
            ", source_athlete_id_sql, ",
            NOW(), NOW()
          )
          ON CONFLICT (athlete_uuid) DO UPDATE SET
            name = EXCLUDED.name,
            normalized_name = EXCLUDED.normalized_name,
            date_of_birth = COALESCE(EXCLUDED.date_of_birth, analytics.d_athletes.date_of_birth),
            age = COALESCE(EXCLUDED.age, analytics.d_athletes.age),
            age_at_collection = COALESCE(EXCLUDED.age_at_collection, analytics.d_athletes.age_at_collection),
            gender = COALESCE(EXCLUDED.gender, analytics.d_athletes.gender),
            height = COALESCE(EXCLUDED.height, analytics.d_athletes.height),
            weight = COALESCE(EXCLUDED.weight, analytics.d_athletes.weight),
            updated_at = NOW()
        ")
        DBI::dbExecute(con, sql)
        inserted_count <- inserted_count + 1
      }, error = function(e) {
        log_progress("  [ERROR] Failed to insert", uuid, ":", conditionMessage(e))
      })
    } else {
      # Insert minimal record
      tryCatch({
        sql <- paste0("
          INSERT INTO analytics.d_athletes (
            athlete_uuid, name, normalized_name, source_system, created_at, updated_at
          ) VALUES (
            '", uuid, "',
            '", gsub("'", "''", display_name), "',
            '", gsub("'", "''", normalized_name), "',
            'pitching',
            NOW(), NOW()
          )
          ON CONFLICT (athlete_uuid) DO NOTHING
        ")
        DBI::dbExecute(con, sql)
        inserted_count <- inserted_count + 1
      }, error = function(e) {
        log_progress("  [ERROR] Failed to insert", uuid, ":", conditionMessage(e))
      })
    }
  } else {
    # Insert minimal record
    tryCatch({
      sql <- paste0("
        INSERT INTO analytics.d_athletes (
          athlete_uuid, name, normalized_name, source_system, created_at, updated_at
        ) VALUES (
          '", uuid, "',
          '", gsub("'", "''", display_name), "',
          '", gsub("'", "''", normalized_name), "',
          'pitching',
          NOW(), NOW()
        )
        ON CONFLICT (athlete_uuid) DO NOTHING
      ")
      DBI::dbExecute(con, sql)
      inserted_count <- inserted_count + 1
    }, error = function(e) {
      log_progress("  [ERROR] Failed to insert", uuid, ":", conditionMessage(e))
    })
  }
  
  if (inserted_count %% 10 == 0) {
    log_progress("  Inserted", inserted_count, "athletes so far...")
  }
}

# Update athlete flags
log_progress("Updating athlete data flags...")
tryCatch({
  if (exists("update_athlete_flags")) {
    update_result <- update_athlete_flags(con, verbose = TRUE)
    if (update_result$success) {
      log_progress("  [SUCCESS] Athlete flags updated successfully")
    } else {
      log_progress("  [WARNING] Failed to update athlete flags:", update_result$message)
    }
  } else {
    log_progress("  [WARNING] update_athlete_flags function not found - flags not updated")
    log_progress("  You can manually update flags by running: SELECT update_athlete_data_flags();")
  }
}, error = function(e) {
  log_progress("  [WARNING] Error updating athlete flags:", conditionMessage(e))
})

# Summary
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** BACKFILL COMPLETE ***\n")
cat("=", rep("=", 80), "\n", sep = "")
log_progress("Total UUIDs processed:", length(existing_uuid_set))
log_progress("Athletes inserted/updated:", inserted_count)
cat("\n")

# Close connection
tryCatch({
  DBI::dbDisconnect(con)
  log_progress("Database connection closed")
}, error = function(e) {
  # Connection might already be closed, ignore
})

