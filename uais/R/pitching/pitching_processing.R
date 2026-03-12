# Runs all Pitching Data
# This file processes all pitching data from a specified directory.
# For interactive folder selection, use main.R instead.

# ==== Minimal deps ====
library(xml2)
library(purrr)
library(dplyr)
library(readr)
library(stringr)
library(tibble)
library(tidyr)
library(DBI)
library(RSQLite)
# Try to load RPostgres, fall back to RPostgreSQL if not available
if (!requireNamespace("RPostgres", quietly = TRUE)) {
  if (requireNamespace("RPostgreSQL", quietly = TRUE)) {
    library(RPostgreSQL)
    # RPostgreSQL uses different connection function, we'll handle this in get_warehouse_connection
  } else {
    warning("Neither RPostgres nor RPostgreSQL is installed. Install with: install.packages('RPostgres')")
  }
} else {
  library(RPostgres)
}
library(uuid)
library(tools)
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  warning("jsonlite not installed - f_pitching_trials will not be written. Install with: install.packages('jsonlite')")
} else {
  library(jsonlite)
}

# Load common utilities
# Try multiple paths to find the common utilities
find_and_source_common <- function() {
  # Try paths relative to current working directory
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
  
  # Source config.R
  source(config_path)
  
  # Find and source db_utils.R and units.R in the same directory
  db_utils_path <- file.path(dirname(config_path), "db_utils.R")
  if (file.exists(db_utils_path)) {
    source(db_utils_path)
  } else {
    warning("Could not find db_utils.R at: ", db_utils_path)
  }
  units_path <- file.path(dirname(config_path), "units.R")
  if (file.exists(units_path)) {
    source(units_path)
  }
}

find_and_source_common()

# ---------- Helpers ----------
# Progress logging: when PITCHING_VERBOSE is FALSE, only [ERROR] and [WARNING] messages are printed.
log_progress <- function(...) {
  args <- list(...)
  args <- args[names(args) != "sep"]
  message <- do.call(paste0, args)
  # Collapse to length 1 so grepl() and if() get logical(1) (avoids "length = 60 in coercion to logical(1)" when e.g. rep("=", 60) is passed)
  if (length(message) > 1) message <- paste(message, collapse = "")
  if (isTRUE(PITCHING_VERBOSE || grepl("\\[ERROR\\]|\\[WARNING\\]", message))) {
    cat(message, "\n", sep = "")
    flush.console()
  }
}

# Quiet mode: set PITCHING_VERBOSE=1 for full progress output
PITCHING_VERBOSE <- identical(Sys.getenv("PITCHING_VERBOSE", ""), "1")

`%||%` <- function(a, b) if (!is.null(a)) a else b
nzchr <- function(x) ifelse(is.na(x) | x == "", NA_character_, x)
nznum <- function(x) suppressWarnings(readr::parse_number(x))

# Parse Creation_date values found in session.xml
parse_creation_date_safe <- function(x) {
  if (is.na(x) || x == "") return(as.Date(NA))
  d <- suppressWarnings(as.Date(x, format = "%m/%d/%Y"))
  if (is.na(d)) d <- suppressWarnings(as.Date(x, format = "%Y-%m-%d"))
  d
}

# Load athlete manager
athlete_manager_paths <- c(
  file.path("..", "common", "athlete_manager.R"),
  file.path(getwd(), "R", "common", "athlete_manager.R"),
  file.path("R", "common", "athlete_manager.R"),
  file.path(dirname(getwd()), "R", "common", "athlete_manager.R")
)
athlete_manager_loaded <- FALSE
for (path in athlete_manager_paths) {
  if (file.exists(path)) {
    source(path)
    athlete_manager_loaded <- TRUE
    if (PITCHING_VERBOSE) cat("Loaded athlete_manager.R from:", path, "\n", sep = "")
    break
  }
}
if (!athlete_manager_loaded) {
  warning("Could not find athlete_manager.R - warehouse integration will be limited")
}

# ---------- Configuration ----------
DATA_ROOT <- Sys.getenv("PITCHING_DATA_DIR", unset = "H:/Pitching/Data")  # Set to your pitching data directory path, NULL for testing with local files
USE_WAREHOUSE <- TRUE  # Set to TRUE to write to PostgreSQL warehouse, FALSE for local SQLite
DB_FILE <- "pitching_data.db"  # Only used if USE_WAREHOUSE = FALSE
TRUNCATE_BEFORE_INSERT <- FALSE  # Set to TRUE to clear table before inserting (prevents duplicates on re-run)

# ---------- Age group calculation ----------
#' Calculate age group from age_at_collection (vectorized)
#' Matches Python age_utils.calculate_age_group() logic (YOUTH < 14, HIGH SCHOOL 14-18, COLLEGE 18-22, PRO > 22)
#' @param age_at_collection Age(s) at time of data collection (numeric vector)
#' @return Age group string(s): "YOUTH", "HIGH SCHOOL", "COLLEGE", "PRO", or NA
calculate_age_group_from_age <- function(age_at_collection) {
  out <- rep(NA_character_, length(age_at_collection))
  not_na <- !is.na(age_at_collection)
  a <- age_at_collection[not_na]
  out[not_na] <- dplyr::case_when(
    a < 14 ~ "YOUTH",
    a >= 14 & a <= 18 ~ "HIGH SCHOOL",
    a > 18 & a <= 22 ~ "COLLEGE",
    TRUE ~ "PRO"
  )
  out
}

# ---------- Name normalization and UUID matching ----------
#' Normalize name for matching: convert LAST, FIRST to FIRST LAST and remove dates
#' @param name Name string (can be "LAST, FIRST" or "LAST, FIRST DATE")
#' @return Normalized name string "FIRST LAST" (uppercase, trimmed)
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

#' Fetch athletes from app database and create name-to-UUID mapping
#' @param conn Optional database connection (defaults to app connection)
#' @return Named list mapping normalized names to UUIDs
fetch_athlete_uuid_map <- function(conn = NULL) {
  log_progress("=== fetch_athlete_uuid_map START ===")
  
  if (is.null(conn)) {
    log_progress("No connection provided, attempting to get app connection...")
    conn <- tryCatch({
      log_progress("Calling get_app_connection()...")
      app_conn <- get_app_connection()
      log_progress("SUCCESS: Got app connection")
      app_conn
    }, error = function(e) {
      log_progress("ERROR: Could not connect to app database!")
      log_progress("Error message:", conditionMessage(e))
      log_progress("Will generate new UUIDs for athletes")
      return(NULL)
    })
    if (!is.null(conn)) {
      on.exit({
        log_progress("Disconnecting from app database...")
        tryCatch(DBI::dbDisconnect(conn), error = function(e) NULL)
      })
    }
  }
  
  if (is.null(conn)) {
    log_progress("Connection is NULL, returning empty map")
    return(list())
  }
  
  log_progress("Connection established, proceeding to query...")
  
  # Try to fetch from athletes table first, then try User table
  athletes_df <- NULL
  
  # Try athletes table
  if (table_exists(conn, "athletes")) {
    tryCatch({
      athletes_df <- read_table(conn, "athletes")
      log_progress("Loaded", nrow(athletes_df), "athletes from 'athletes' table")
    }, error = function(e) {
      log_progress("Could not read from 'athletes' table:", conditionMessage(e))
    })
  }
  
  # Try User table (Postgres schema) - use direct SQL query with quoted identifier
  log_progress("Checking if athletes_df is null or empty...")
  log_progress("athletes_df is null:", is.null(athletes_df))
  if (!is.null(athletes_df)) {
    log_progress("athletes_df has", nrow(athletes_df), "rows")
  }
  
  if (is.null(athletes_df) || nrow(athletes_df) == 0) {
    log_progress("=== ATTEMPTING TO QUERY USER TABLE ===")
    log_progress("Connection class:", class(conn))
    log_progress("Connection valid:", !is.null(conn))
    
    tryCatch({
      # Try querying public."User" table directly (quoted identifier for reserved word)
      query <- 'SELECT uuid AS athlete_uuid, name FROM public."User"'
      log_progress("QUERY 1: Trying:", query)
      athletes_df <- DBI::dbGetQuery(conn, query)
      log_progress("QUERY 1 RESULT: Got", nrow(athletes_df), "rows")
      if (nrow(athletes_df) > 0) {
        log_progress("*** SUCCESS: Loaded", nrow(athletes_df), "athletes from public.\"User\" table ***")
        log_progress("Sample names:", paste(head(athletes_df$name, 5), collapse = ", "))
        log_progress("Sample UUIDs:", paste(head(athletes_df$athlete_uuid, 5), collapse = ", "))
      } else {
        log_progress("QUERY 1: Query succeeded but returned 0 rows")
      }
    }, error = function(e) {
      log_progress("*** QUERY 1 ERROR:", conditionMessage(e), "***")
      # Try without schema prefix
      tryCatch({
        query <- 'SELECT uuid AS athlete_uuid, name FROM "User"'
        log_progress("QUERY 2: Trying:", query)
        athletes_df <- DBI::dbGetQuery(conn, query)
        log_progress("QUERY 2 RESULT: Got", nrow(athletes_df), "rows")
        if (nrow(athletes_df) > 0) {
          log_progress("*** SUCCESS: Loaded", nrow(athletes_df), "athletes from \"User\" table ***")
          log_progress("Sample names:", paste(head(athletes_df$name, 5), collapse = ", "))
          log_progress("Sample UUIDs:", paste(head(athletes_df$athlete_uuid, 5), collapse = ", "))
        } else {
          log_progress("QUERY 2: Query succeeded but returned 0 rows")
        }
      }, error = function(e2) {
        log_progress("*** QUERY 2 ERROR:", conditionMessage(e2), "***")
        log_progress("*** CRITICAL: Could not read from 'User' table - UUID matching will fail ***")
      })
    })
  } else {
    log_progress("athletes_df already has data, skipping User table query")
  }
  
  if (is.null(athletes_df) || nrow(athletes_df) == 0) {
    log_progress("*** CRITICAL: No athletes found in app database - returning empty map ***")
    return(list())
  }
  
  log_progress("*** Processing", nrow(athletes_df), "athletes from database ***")
  
  # Create mapping: normalized_name -> UUID
  uuid_map <- list()
  for (i in seq_len(nrow(athletes_df))) {
    athlete_name <- athletes_df$name[i]
    athlete_uuid <- athletes_df$athlete_uuid[i]
    
    if (!is.na(athlete_name) && !is.na(athlete_uuid)) {
      normalized <- normalize_name_for_matching(athlete_name)
      if (!is.na(normalized)) {
        # If multiple athletes have same normalized name, keep the first one
        # (could be improved with DOB matching later)
        if (!normalized %in% names(uuid_map)) {
          uuid_map[[normalized]] <- as.character(athlete_uuid)
        } else {
          log_progress("  [WARNING] Duplicate normalized name:", normalized, "- keeping first UUID")
        }
      } else {
        log_progress("  [WARNING] Could not normalize name:", athlete_name)
      }
    } else {
      log_progress("  [WARNING] Skipping athlete with missing name or UUID")
    }
  }
  
  log_progress("*** Created UUID mapping for", length(uuid_map), "unique normalized names ***")
  # Debug: show a few examples
  if (length(uuid_map) > 0) {
    example_names <- head(names(uuid_map), min(10, length(uuid_map)))
    log_progress("  Example mappings:")
    for (nm in example_names) {
      log_progress("    '", nm, "' -> '", uuid_map[[nm]], "'")
    }
  } else {
    log_progress("  *** WARNING: UUID map is EMPTY! ***")
  }
  
  log_progress("=== fetch_athlete_uuid_map END ===")
  return(uuid_map)
}

#' Get UUID for an athlete by matching normalized name
#' @param name Athlete name (can be "LAST, FIRST" format)
#' @param uuid_map Named list mapping normalized names to UUIDs
#' @return UUID string or NA if not found
get_uuid_by_name <- function(name, uuid_map) {
  if (length(uuid_map) == 0) return(NA_character_)
  
  normalized <- normalize_name_for_matching(name)
  if (is.na(normalized)) return(NA_character_)
  
  if (normalized %in% names(uuid_map)) {
    return(uuid_map[[normalized]])
  }
  
  return(NA_character_)
}
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
        # Try v3d root
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

# ---------- Extract athlete info from session.xml ----------
extract_athlete_info <- function(path) {
  doc <- tryCatch(read_xml_robust(path), error = function(e) NULL)
  if (is.null(doc)) return(NULL)
  
  root <- xml_root(doc)
  if (!identical(xml_name(root), "Subject")) return(NULL)
  
  # Extract subject fields
  fields <- xml_find_first(root, "./Fields")
  if (inherits(fields, "xml_missing")) return(NULL)
  
  # Core fields (Pitching/Hitting: Sex first, then Gender per session.xml)
  id <- nzchr(xml_text(xml_find_first(fields, "./ID")))
  name <- nzchr(xml_text(xml_find_first(fields, "./Name")))
  dob <- nzchr(xml_text(xml_find_first(fields, "./Date_of_birth")))
  sex <- nzchr(xml_text(xml_find_first(fields, "./Sex")))
  gender_raw <- nzchr(xml_text(xml_find_first(fields, "./Gender")))
  # Use Sex first, then Gender; normalize: only "female"/"f" -> "Female", else "Male"
  raw_val <- if (is.na(sex) || sex == "") gender_raw else sex
  gender <- if (!is.na(raw_val) && tolower(trimws(raw_val)) %in% c("female", "f")) "Female" else "Male"
  height <- nzchr(xml_text(xml_find_first(fields, "./Height")))
  weight <- nzchr(xml_text(xml_find_first(fields, "./Weight")))
  creation_date <- nzchr(xml_text(xml_find_first(fields, "./Creation_date")))
  creation_time <- nzchr(xml_text(xml_find_first(fields, "./Creation_time")))
  
  # Extract all other fields (excluding core fields to avoid duplicates)
  core_field_names <- c("ID", "Name", "Date_of_birth", "Sex", "Gender", "Height", "Weight", 
                        "Creation_date", "Creation_time")
  all_fields <- xml_children(fields)
  field_list <- list()
  for (f in all_fields) {
    fname <- xml_name(f)
    # Skip core fields that we've already extracted
    if (fname %in% core_field_names) next
    fval <- nzchr(trimws(xml_text(f)))
    if (!is.na(fval) && fval != "") {
      field_list[[fname]] <- fval
    }
  }
  
  # Calculate age if DOB available (current age)
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
  
  # Calculate age_at_collection based on creation_date
  age_at_collection <- NA_real_
  if (!is.na(creation_date) && creation_date != "" && !is.na(dob_date)) {
    tryCatch({
      # Try to parse creation_date (format might vary)
      collection_date <- as.Date(creation_date, format = "%m/%d/%Y")
      if (is.na(collection_date)) {
        # Try alternative format
        collection_date <- as.Date(creation_date, format = "%Y-%m-%d")
      }
      if (!is.na(collection_date) && !is.na(dob_date)) {
        age_at_collection <- as.numeric(difftime(collection_date, dob_date, units = "days")) / 365.25
        # Log for debugging if age seems wrong
        if (!is.na(age_at_collection) && (age_at_collection < 10 || age_at_collection > 50)) {
          log_progress("  [WARNING] Calculated age_at_collection seems unusual:", round(age_at_collection, 2))
          log_progress("    DOB:", dob, "| Creation date:", creation_date, "| Calculated age:", round(age_at_collection, 2))
        }
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
    age = age,
    age_at_collection = age_at_collection,
    gender = gender,
    height = meters_to_inches(h_m),
    weight = kg_to_lbs(w_kg),
    creation_date = creation_date,
    creation_time = creation_time,
    source_file = basename(path),
    source_path = path,
    !!!field_list
  )
}

# ---------- Extract velocity mappings from session.xml ----------
#' Extract velocity (MPH) from Comments field in Measurement elements
#' @param path Path to session.xml file
#' @return Named list mapping measurement filenames to velocity values (MPH)
extract_velocity_mappings <- function(path) {
  doc <- tryCatch(read_xml_robust(path), error = function(e) NULL)
  if (is.null(doc)) return(list())
  
  root <- xml_root(doc)
  if (!identical(xml_name(root), "Subject")) return(list())
  
  velocity_map <- list()
  
  # Find all Measurement elements
  measurements <- xml_find_all(root, ".//Measurement")
  
  for (meas in measurements) {
    # Get Filename attribute
    meas_filename <- xml_attr(meas, "Filename")
    if (is.na(meas_filename) || meas_filename == "") next
    
    # Get Comments field value (velocity in MPH)
    fields <- xml_find_first(meas, "./Fields")
    if (!inherits(fields, "xml_missing")) {
      comments_elem <- xml_find_first(fields, "./Comments")
      if (!inherits(comments_elem, "xml_missing")) {
        comments_text <- trimws(xml_text(comments_elem))
        if (!is.na(comments_text) && comments_text != "") {
          # Try to parse as numeric (MPH)
          velocity <- suppressWarnings(as.numeric(comments_text))
          if (!is.na(velocity) && velocity > 0) {
            # Map both with and without extension
            velocity_map[[meas_filename]] <- velocity
            meas_no_ext <- tools::file_path_sans_ext(meas_filename)
            velocity_map[[meas_no_ext]] <- velocity
            # Also map with .c3d extension (in case owner names use .c3d)
            meas_c3d <- sub("\\.qtm$", ".c3d", meas_filename, ignore.case = TRUE)
            if (meas_c3d != meas_filename) {
              velocity_map[[meas_c3d]] <- velocity
              meas_c3d_no_ext <- tools::file_path_sans_ext(meas_c3d)
              velocity_map[[meas_c3d_no_ext]] <- velocity
            }
          }
        }
      }
    }
  }
  
  return(velocity_map)
}

# ---------- Extract session-level date mappings from session.xml ----------
# Returns named list keyed by "<normalized_dir>||<normalized_measurement_name>" and "<normalized_dir>||__dir__"
extract_session_date_mappings <- function(path) {
  doc <- tryCatch(read_xml_robust(path), error = function(e) NULL)
  if (is.null(doc)) return(list())

  root <- xml_root(doc)
  if (!identical(xml_name(root), "Subject")) return(list())

  dir_key <- normalizePath(dirname(path), winslash = "/", mustWork = FALSE)
  if (is.na(dir_key) || !nzchar(dir_key)) return(list())

  normalize_measurement_key <- function(x) {
    tolower(trimws(as.character(x)))
  }

  add_variants <- function(out, filename, date_val) {
    if (is.na(filename) || !nzchar(filename) || is.na(date_val)) return(out)
    base <- normalize_measurement_key(filename)
    no_ext <- normalize_measurement_key(tools::file_path_sans_ext(filename))
    c3d <- normalize_measurement_key(sub("\\.qtm$", ".c3d", filename, ignore.case = TRUE))
    qtm <- normalize_measurement_key(sub("\\.c3d$", ".qtm", filename, ignore.case = TRUE))
    variants <- unique(c(base, no_ext, c3d, normalize_measurement_key(tools::file_path_sans_ext(c3d)), qtm, normalize_measurement_key(tools::file_path_sans_ext(qtm))))
    for (v in variants) {
      if (is.na(v) || !nzchar(v)) next
      out[[paste0(dir_key, "||", v)]] <- date_val
    }
    out
  }

  out <- list()
  sessions <- xml_find_all(root, ".//Session")
  for (sess in sessions) {
    sess_fields <- xml_find_first(sess, "./Fields")
    if (inherits(sess_fields, "xml_missing")) next
    sess_creation_date <- nzchr(xml_text(xml_find_first(sess_fields, "./Creation_date")))
    sess_date <- parse_creation_date_safe(sess_creation_date)
    if (is.na(sess_date)) next

    # Directory-level fallback for this session.xml path
    out[[paste0(dir_key, "||__dir__")]] <- sess_date

    measurements <- xml_find_all(sess, "./Measurement")
    if (length(measurements) == 0) next
    for (meas in measurements) {
      meas_filename <- xml_attr(meas, "Filename")
      out <- add_variants(out, meas_filename, sess_date)
    }
  }

  out
}

# ---------- Calculate score from metric data ----------
#' Calculate pitching score from XML document by extracting required metrics
#' @param doc XML document (session_data.xml)
#' @param owner_name Owner name to extract metrics for
#' @param velocity_mph Velocity in MPH (already extracted)
#' @param weight_kg Body weight in kg (from session.xml); if lead_leg_midpoint > 10, divide by (weight_kg*9.81) to normalize from raw N
#' @return Numeric score value or NA if insufficient data
calculate_pitching_score <- function(doc, owner_name, velocity_mph = NA_real_, weight_kg = NA_real_) {
  if (is.null(doc)) return(NA_real_)
  
  root <- xml_root(doc)
  if (!identical(xml_name(root), "v3d")) return(NA_real_)
  
  # Helper function to extract metric value from XML by variable name and component
  extract_metric_from_xml <- function(var_name, component = NULL) {
    # Find the owner
    owners <- xml_find_all(root, paste0("./owner[@value='", owner_name, "']"))
    if (length(owners) == 0) return(NA_real_)
    
    # Try original name first, then try with @Foot_Contact as alias for @Footstrike
    var_names_to_try <- c(var_name)
    if (grepl("@Footstrike", var_name)) {
      var_names_to_try <- c(var_name, sub("@Footstrike", "@Foot_Contact", var_name))
    }
    
    # Find metric types
    for (own in owners) {
      metric_types <- xml_find_all(own, "./type[@value='METRIC']")
      for (mt in metric_types) {
        folders <- xml_find_all(mt, "./folder")
        for (fol in folders) {
          names <- xml_find_all(fol, "./name[@value]")
          for (nm in names) {
            metric_name <- xml_attr(nm, "value")
            if (is.na(metric_name) || !metric_name %in% var_names_to_try) next
            
            # Find component
            comps <- xml_find_all(nm, "./component")
            for (comp in comps) {
              comp_val <- xml_attr(comp, "value")
              if (!is.null(component) && comp_val != component) next
              
              # Get data (first value for event-based metrics)
              data_attr <- xml_attr(comp, "data") %||% xml_text(comp)
              if (is.na(data_attr) || data_attr == "") next
              
              # Parse first value
              vals <- parse_comma_data(data_attr)
              if (length(vals) > 0 && !is.na(vals[1])) {
                return(as.numeric(vals[1]))
              }
            }
          }
        }
      }
    }
    return(NA_real_)
  }
  
  # Extract direct variables with component specifications
  linear_pelvis_speed <- extract_metric_from_xml("MaxPelvisLinearVel_MPH", "Y")
  lead_leg_midpoint <- extract_metric_from_xml("Lead_Leg_GRF_mag_Midpoint_FS_Release", "X")
  horizontal_abduction <- extract_metric_from_xml("Pitching_Shoulder_Angle@Footstrike", "X")
  torso_ang_velo <- extract_metric_from_xml("Thorax_Ang_Vel_max", "X")
  trunk_ang_fp <- extract_metric_from_xml("Trunk_Angle@Footstrike", "Z")
  pelvis_ang_fp <- extract_metric_from_xml("Pelvis_Angle@Footstrike", "Z")
  shld_er_max <- extract_metric_from_xml("Pitching_Shoulder_Angle_Max", "Z")
  pelvis_ang_velo <- extract_metric_from_xml("Pelvis_Ang_Vel_max", "X")
  
  # Extract variables for calculated metrics
  lead_knee_ang_fp_x <- extract_metric_from_xml("Lead_Knee_Angle@Footstrike", "X")
  lead_knee_ang_rel_x <- extract_metric_from_xml("Lead_Knee_Angle@Release", "X")
  pelvis_ang_fp_y <- extract_metric_from_xml("Pelvis_Angle@Footstrike", "Y")
  pelvis_ang_rel_y <- extract_metric_from_xml("Pelvis_Angle@Release", "Y")
  lead_knee_ang_fp_y <- extract_metric_from_xml("Lead_Knee_Angle@Footstrike", "Y")
  lead_knee_ang_rel_y <- extract_metric_from_xml("Lead_Knee_Angle@Release", "Y")
  
  # Calculate derived variables
  front_leg_brace <- NA_real_
  if (!is.na(lead_knee_ang_fp_x) && !is.na(lead_knee_ang_rel_x)) {
    front_leg_brace <- lead_knee_ang_fp_x - lead_knee_ang_rel_x
  }
  
  pelvis_obl <- NA_real_
  if (!is.na(pelvis_ang_rel_y) && !is.na(pelvis_ang_fp_y)) {
    pelvis_obl <- pelvis_ang_rel_y - pelvis_ang_fp_y
  }
  
  front_leg_var_val <- NA_real_
  if (!is.na(lead_knee_ang_fp_y) && !is.na(lead_knee_ang_rel_y)) {
    front_leg_var_val <- lead_knee_ang_fp_y - lead_knee_ang_rel_y
  }
  
  # Default weight when NULL so score scaling isn't thrown off (e.g. missing athlete demographics)
  weight_kg_use <- if (!is.na(weight_kg) && weight_kg > 0) weight_kg else (180 / 2.2046226)  # 180 lbs -> kg
  
  # Apply absolute values where needed
  if (!is.na(lead_leg_midpoint)) {
    lead_leg_midpoint <- abs(lead_leg_midpoint)
    # If > 10, value is raw Newtons (not BW-normalized); convert to BW multiples
    if (lead_leg_midpoint > 10) {
      lead_leg_midpoint <- lead_leg_midpoint / (weight_kg_use * 9.81)
    }
  }
  if (!is.na(horizontal_abduction)) {
    horizontal_abduction <- abs(horizontal_abduction)
  }
  if (!is.na(shld_er_max)) {
    shld_er_max <- abs(shld_er_max)
  }
  
  # score = velo_part + metric_sum (no offset, no cap). Velo = 2.78 * MPH. Metric part = raw sum; elite mechanics can exceed 250 (e.g. 264). ~500 = top 1%, scores can go slightly above (e.g. 512).
  VELO_MULT <- 2.78
  velo_part <- ifelse(!is.na(velocity_mph), VELO_MULT * velocity_mph, 0)
  # Per-variable coefficients: lead_leg_midpoint=18 base, then +15% on all metrics
  metric_sum_raw <-
    ifelse(!is.na(shld_er_max), 0.2415 * shld_er_max, 0) +
    ifelse(!is.na(lead_leg_midpoint), 20.7 * lead_leg_midpoint, 0) +
    ifelse(!is.na(horizontal_abduction), 0.7245 * horizontal_abduction, 0) +
    ifelse(!is.na(torso_ang_velo), 0.0181125 * torso_ang_velo, 0) -
    ifelse(!is.na(pelvis_ang_fp), 0.2415 * pelvis_ang_fp, 0) +
    ifelse(!is.na(front_leg_brace), 0.422625 * front_leg_brace, 0) +
    ifelse(!is.na(trunk_ang_fp), 0.301875 * trunk_ang_fp, 0) -
    ifelse(!is.na(front_leg_var_val), 0.2415 * abs(front_leg_var_val), 0) +
    ifelse(!is.na(linear_pelvis_speed), 1.2075 * linear_pelvis_speed, 0) -
    ifelse(!is.na(pelvis_obl), 0.181125 * abs(pelvis_obl), 0) +
    ifelse(!is.na(pelvis_ang_velo), 0.0483 * pelvis_ang_velo, 0)
  metric_sum <- metric_sum_raw  # no scaling; sliding scale so elite performers aren't capped
  score <- velo_part + metric_sum
  
  # Return NA if we couldn't calculate a meaningful score (all inputs were NA)
  if (is.na(linear_pelvis_speed) && is.na(front_leg_brace) && is.na(lead_leg_midpoint) &&
      is.na(horizontal_abduction) && is.na(torso_ang_velo) && is.na(pelvis_obl) &&
      is.na(trunk_ang_fp) && is.na(pelvis_ang_fp) && is.na(shld_er_max) &&
      is.na(front_leg_var_val) && is.na(pelvis_ang_velo) && is.na(velocity_mph)) {
    return(NA_real_)
  }
  
  return(score)
}

# ---------- Extract time series data from session_data.xml ----------
parse_comma_data <- function(data_str) {
  if (is.na(data_str) || data_str == "") return(numeric(0))
  vals <- strsplit(data_str, ",", fixed = TRUE)[[1]]
  suppressWarnings(as.numeric(trimws(vals)))
}

# ---------- Extract ALL metric variables from session_data.xml ----------
extract_metric_data <- function(doc, owner_name) {
  root <- xml_root(doc)
  if (!identical(xml_name(root), "v3d")) {
    return(tibble())
  }
  
  owners <- xml_find_all(root, "./owner")
  if (!length(owners)) {
    return(tibble())
  }
  
  all_data <- list()
  folders_seen <- character()
  fastball_folders_found <- 0
  skipped_folders <- character()
  
  for (own in owners) {
    own_val <- xml_attr(own, "value")
    if (own_val != owner_name) next
    
    metric_types <- xml_find_all(own, "./type[@value='METRIC']")
    if (!length(metric_types)) next
    
    for (mt in metric_types) {
      folders <- xml_find_all(mt, "./folder")
      for (fol in folders) {
        folder_val <- xml_attr(fol, "value")
        
        # Track all folders we see
        if (!is.na(folder_val)) {
          folders_seen <- c(folders_seen, folder_val)
        }
        
        # Skip AT_EVENT folder
        if (!is.na(folder_val) && folder_val == "AT_EVENT") {
          next
        }
        
        # NOTE: We no longer filter by folder name - folders are metric categories (PROCESSED, BALLSPEED, etc.)
        # Trial type filtering is done at the owner level (Fastball vs Static)
        # Just skip AT_EVENT folder as before
        if (!is.na(folder_val) && folder_val == "AT_EVENT") {
          next
        }
        
        # Track folders for debugging
        if (!is.na(folder_val)) {
          folders_seen <- c(folders_seen, folder_val)
        }
        
        names <- xml_find_all(fol, "./name")
        
        for (nm in names) {
          metric_name <- xml_attr(nm, "value")
          
          # Skip variables containing excluded strings
          excluded_patterns <- c(
            "Back_Foot_wrt_Lab",
            "Back_Ankle_Angle",
            "Lead_Ankle_Angle",
            "Back_Hip_Angle",
            "Glove_Elbow_Angle",
            "Glove_Shoulder_Angle",
            "Lead_Hip_Angle",
            "Back_Knee_Ang_Vel",
            "COM wrt Lead Heel_vel",
            "Combined COP wrt Lead Heel"
          )
          
          skip_variable <- FALSE
          for (pattern in excluded_patterns) {
            if (grepl(pattern, metric_name, ignore.case = TRUE)) {
              skip_variable <- TRUE
              break
            }
          }
          
          if (skip_variable) {
            next
          }
          
          # Extract metrics (filtered)
          
          comps <- xml_find_all(nm, "./component")
          for (comp in comps) {
            comp_val <- xml_attr(comp, "value")
            frames_attr <- xml_attr(comp, "frames")
            data_attr <- xml_attr(comp, "data") %||% xml_text(comp)
            
            if (is.na(frames_attr) || frames_attr == "") next
            
            frames <- suppressWarnings(as.integer(frames_attr))
            if (is.na(frames)) next
            
            # Handle both single values and time series
            values <- parse_comma_data(data_attr)
            if (length(values) == 0) next
            
            # Ensure lengths match
            n_vals <- length(values)
            if (n_vals != frames) {
              if (n_vals > frames) {
                values <- values[1:frames]
              } else {
                values <- c(values, rep(NA_real_, frames - n_vals))
              }
            }
            
            # Store time series data as separate columns (one per frame)
            # Create column names for values
            value_cols <- paste0("value_", 1:frames)
            
            # Create a list with all the data
            row_data <- list(
              owner = own_val,
              folder = folder_val,
              variable = metric_name,
              component = comp_val
            )
            
            # Add value columns
            for (i in 1:frames) {
              row_data[[value_cols[i]]] <- values[i]
            }
            
            all_data[[length(all_data) + 1]] <- as_tibble(row_data)
          }
        }
      }
    }
  }
  
  if (length(all_data) == 0) {
    return(tibble())
  }
  return(bind_rows(all_data))
}

# ---------- Main processing function ----------
process_all_files <- function(data_root = NULL) {
  if (!PITCHING_VERBOSE) cat("Pitching processing started.\n")
  # Determine root directory
  # If data_root parameter is provided, use it; otherwise use DATA_ROOT global variable
  root_dir <- if (!is.null(data_root)) {
    data_root
  } else if (is.null(DATA_ROOT)) {
    # Default to Pitching folder in current directory
    pitching_dir <- file.path(getwd(), "Pitching")
    if (isTRUE(dir.exists(pitching_dir))) {
      pitching_dir
    } else {
      getwd()
    }
  } else {
    DATA_ROOT
  }
  
  # Ensure root_dir is valid (avoid "missing value where TRUE/FALSE needed": nzchar(NA) returns NA)
  ok_root <- (length(root_dir) == 1L && is.character(root_dir) && !any(is.na(root_dir)) &&
             nzchar(trimws(root_dir)[1L]))
  if (!isTRUE(ok_root)) {
    stop("Invalid data root: path is missing, NA, or empty. Please select a valid folder.")
  }
  
  # Validate that the directory exists and is accessible
  if (isTRUE(!is.null(data_root) || !is.null(DATA_ROOT))) {
    if (!isTRUE(dir.exists(root_dir))) {
      stop("Data directory does not exist or is not accessible: ", root_dir, 
           "\nPlease check:\n",
           "  1. The path is correct\n",
           "  2. The drive is mapped (if it's a network drive)\n",
           "  3. You have permission to access the directory")
    }
    
    # Try to list files to verify access
    test_list <- tryCatch({
      list.files(root_dir, recursive = FALSE, full.names = FALSE)
    }, error = function(e) {
      stop("Cannot access directory: ", root_dir, 
           "\nError: ", conditionMessage(e),
           "\nThis might be a network drive issue. Try:\n",
           "  1. Checking if the network drive is mapped\n",
           "  2. Reconnecting to the network drive\n",
           "  3. Using a local path instead")
    })
    
    if (length(test_list) == 0) {
      log_progress("  [WARNING] Directory exists but appears to be empty")
    } else {
      log_progress("  Directory accessible, found", length(test_list), "items")
    }
  }
  
  log_progress("Scanning for XML files in:", root_dir)
  
  # Find all session.xml and session_data.xml files (including .gz)
  log_progress("Searching for session.xml files...")
  session_files <- tryCatch({
    list.files(root_dir, pattern = "(?i)session\\.xml$", recursive = TRUE, full.names = TRUE)
  }, error = function(e) {
    log_progress("  [ERROR] Failed to search for session.xml files:", conditionMessage(e))
    log_progress("  This might be a network drive issue. Trying non-recursive search...")
    tryCatch({
      list.files(root_dir, pattern = "(?i)session\\.xml$", recursive = FALSE, full.names = TRUE)
    }, error = function(e2) {
      stop("Cannot access directory: ", root_dir, "\nError: ", conditionMessage(e2))
    })
  })
  
  log_progress("Searching for session_data.xml files...")
  session_data_files <- tryCatch({
    list.files(root_dir, pattern = "(?i)session_data\\.xml$", recursive = TRUE, full.names = TRUE)
  }, error = function(e) {
    log_progress("  [ERROR] Failed to search for session_data.xml files:", conditionMessage(e))
    log_progress("  Trying non-recursive search...")
    tryCatch({
      list.files(root_dir, pattern = "(?i)session_data\\.xml$", recursive = FALSE, full.names = TRUE)
    }, error = function(e2) {
      stop("Cannot access directory: ", root_dir, "\nError: ", conditionMessage(e2))
    })
  })
  
  # Also check for .gz files
  log_progress("Searching for compressed .gz files...")
  session_files_gz <- tryCatch({
    list.files(root_dir, pattern = "(?i)session\\.xml\\.gz$", recursive = TRUE, full.names = TRUE)
  }, error = function(e) {
    log_progress("  [WARNING] Could not search for .gz files:", conditionMessage(e))
    character(0)
  })
  session_files <- c(session_files, session_files_gz)
  
  session_data_files_gz <- tryCatch({
    list.files(root_dir, pattern = "(?i)session_data\\.xml\\.gz$", recursive = TRUE, full.names = TRUE)
  }, error = function(e) {
    log_progress("  [WARNING] Could not search for .gz files:", conditionMessage(e))
    character(0)
  })
  session_data_files <- c(session_data_files, session_data_files_gz)
  
  log_progress("Found", length(session_files), "session.xml files")
  log_progress("Found", length(session_data_files), "session_data.xml files")
  n_sessions <- length(session_files) + length(session_data_files)
  if (!PITCHING_VERBOSE) cat("Processing", n_sessions, "sessions.\n")
  
  if (length(session_files) == 0 && length(session_data_files) == 0) {
    log_progress("ERROR: No XML files found in", root_dir)
    log_progress("Trying alternative search...")
    # Try without recursive
    session_files <- list.files(root_dir, pattern = "(?i)session\\.xml$", recursive = FALSE, full.names = TRUE)
    session_data_files <- list.files(root_dir, pattern = "(?i)session_data\\.xml$", recursive = FALSE, full.names = TRUE)
    log_progress("Found (non-recursive):", length(session_files), "session.xml,", length(session_data_files), "session_data.xml")
    
    if (length(session_files) == 0 && length(session_data_files) == 0) {
      stop("No XML files found in ", root_dir)
    }
  }
  
  # Create database connection
  # Use local variable to track warehouse usage (can't modify global from function)
  use_warehouse <- USE_WAREHOUSE
  
  if (isTRUE(use_warehouse)) {
    log_progress("Connecting to PostgreSQL warehouse database...")
    if (PITCHING_VERBOSE) {
      cat("\n*** ATTEMPTING WAREHOUSE CONNECTION ***\n")
      cat("USE_WAREHOUSE is set to: TRUE\n")
      flush.console()
    }
    
    con <- tryCatch({
      warehouse_conn <- get_warehouse_connection()
      test_query <- tryCatch({
        DBI::dbGetQuery(warehouse_conn, "SELECT 1 as test")
        TRUE
      }, error = function(e) {
        log_progress("  [WARNING] Connection test failed:", conditionMessage(e))
        FALSE
      })
      
      if (!isTRUE(test_query)) {
        log_progress("  [ERROR] Warehouse connection test failed")
        DBI::dbDisconnect(warehouse_conn)
        NULL
      } else {
        if (!PITCHING_VERBOSE) cat("Connected to warehouse.\n")
        warehouse_conn
      }
    }, error = function(e) {
      if (PITCHING_VERBOSE) {
        cat("\n*** WAREHOUSE CONNECTION FAILED ***\n")
        cat("ERROR:", conditionMessage(e), "\n")
      cat("This means data will be written to LOCAL SQLite database instead of Neon!\n")
      cat("File:", DB_FILE, "\n")
      cat("\nTo fix this, check:\n")
      cat("  1. Database connection settings in R/common/config.R\n")
      cat("  2. Environment variables for database credentials\n")
      cat("  3. Network connectivity to Neon database\n")
      cat("\n")
      flush.console()
      }
      log_progress("ERROR: Could not connect to warehouse database:", conditionMessage(e))
      log_progress("Falling back to local SQLite database")
      use_warehouse <<- FALSE
      NULL
    })
    
    if (is.null(con)) {
      if (PITCHING_VERBOSE) {
        cat("\n*** USING LOCAL SQLITE DATABASE (FALLBACK) ***\n")
        cat("WARNING: Data will NOT be written to Neon warehouse!\n")
        cat("Local database file:", DB_FILE, "\n")
        cat("\n")
        flush.console()
      }
      use_warehouse <<- FALSE
      con <- DBI::dbConnect(RSQLite::SQLite(), DB_FILE)
      log_progress("Using local SQLite database as fallback")
    } else {
      if (PITCHING_VERBOSE) {
        cat("\n*** SUCCESSFULLY CONNECTED TO WAREHOUSE DATABASE ***\n")
        cat("Data will be written to Neon PostgreSQL warehouse\n")
        cat("\n")
        flush.console()
      }
      log_progress("Connected to warehouse database")
    }
  } else {
    # Use local SQLite database
    log_progress("Using local SQLite database:", DB_FILE)
  # Close any existing connections first
  tryCatch({
    if (file.exists(DB_FILE)) {
      # Try to disconnect any existing connections
      tryCatch({
        existing_con <- dbConnect(RSQLite::SQLite(), DB_FILE)
        dbDisconnect(existing_con)
      }, error = function(e) NULL)
      
      # Now try to remove
      Sys.sleep(0.1)  # Brief pause
      if (file.exists(DB_FILE)) {
        file.remove(DB_FILE)
          log_progress("Removed existing database file")
      }
    }
  }, error = function(e) {
      log_progress("Warning: Could not remove existing database file:", conditionMessage(e))
      log_progress("Will try to overwrite instead...")
  })
  con <- DBI::dbConnect(RSQLite::SQLite(), DB_FILE)
  }
  
  # Fetch athlete UUID mapping from warehouse database (not app database)
  # This is just for pre-populating the cache - athlete_manager will handle actual matching
  cat("\n*** STEP 1: FETCHING UUIDs FROM WAREHOUSE DATABASE (optional pre-cache) ***\n")
  log_progress("Fetching athlete UUIDs from warehouse database for pre-caching...")
  
  uuid_map <- list()  # Start empty - athlete_manager will handle matching
  if (isTRUE(use_warehouse) && !is.null(con)) {
    tryCatch({
      # Try to get UUIDs from warehouse d_athletes table for pre-caching
      warehouse_uuids <- DBI::dbGetQuery(con, "
        SELECT athlete_uuid, normalized_name, name
        FROM analytics.d_athletes
        LIMIT 10000
      ")
      if (nrow(warehouse_uuids) > 0) {
        # Build a simple map from normalized_name to UUID for pre-caching
        for (i in seq_len(nrow(warehouse_uuids))) {
          uuid_map[[warehouse_uuids$normalized_name[i]]] <- warehouse_uuids$athlete_uuid[i]
        }
        log_progress("Pre-cached", length(uuid_map), "UUIDs from warehouse")
      }
    }, error = function(e) {
      log_progress("Could not pre-cache UUIDs from warehouse (non-critical):", conditionMessage(e))
    })
  }
  
  cat("*** UUID MAP RESULT: Contains", length(uuid_map), "entries (pre-cache) ***\n")
  log_progress("UUID map contains", length(uuid_map), "entries")
  if (length(uuid_map) > 0) {
    cat("*** FIRST 5 UUID MAPPINGS (pre-cache) ***\n")
    log_progress("First few UUID mappings:")
    for (i in seq_len(min(5, length(uuid_map)))) {
      cat("  '", names(uuid_map)[i], "' -> '", uuid_map[[i]], "'\n", sep = "")
      log_progress("  ", names(uuid_map)[i], " -> ", uuid_map[[i]])
    }
  } else {
    cat("*** NOTE: UUID MAP IS EMPTY (pre-cache) - this is OK! ***\n")
    cat("*** athlete_manager will handle UUID matching when creating athletes ***\n")
    log_progress("NOTE: UUID pre-cache is empty - athlete_manager will handle matching")
  }
  cat("\n")
  
  # Process session.xml files to get athlete info
  athlete_list <- list()
  owner_mapping <- list()  # Map owner names to athlete IDs
  velocity_mapping <- list()  # Map measurement filenames to velocity (MPH) from Comments field
  session_date_mapping <- list()  # Map "<dir>||<measurement>" -> session-level Creation_date
  
  total_session_files <- length(session_files)
  log_progress("=", rep("=", 60), sep = "")
  log_progress("PHASE 1: Processing", total_session_files, "session.xml files for athlete info and velocity")
  log_progress("=", rep("=", 60), sep = "")
  
  for (i in seq_along(session_files)) {
    sf <- session_files[i]
    log_progress("[", i, "/", total_session_files, "] Processing athlete info from:", basename(sf))
    doc_athlete <- tryCatch(read_xml_robust(sf), error = function(e) NULL)
    if (is.null(doc_athlete)) {
      log_progress("  [WARNING] Could not read file")
      next
    }
    
    athlete_info <- extract_athlete_info(sf)
    if (!is.null(athlete_info) && nrow(athlete_info) > 0) {
      # Use athlete_manager to get or create athlete in warehouse
      athlete_name <- athlete_info$name[1]
      
      # Convert date format for athlete_manager (expects YYYY-MM-DD)
      dob_for_manager <- NULL
      if (!is.na(athlete_info$date_of_birth[1]) && athlete_info$date_of_birth[1] != "") {
        dob_date <- tryCatch({
          as.Date(athlete_info$date_of_birth[1], format = "%m/%d/%Y")
        }, error = function(e) NULL)
        if (!is.na(dob_date)) {
          dob_for_manager <- format(dob_date, "%Y-%m-%d")
        }
      }
      
      # Get or create athlete UUID using athlete_manager
      # This checks warehouse database first, then app database, then creates new
      if (exists("get_or_create_athlete")) {
        tryCatch({
          log_progress("  [WAREHOUSE] Calling get_or_create_athlete for:", athlete_name)
          log_progress("    DOB:", dob_for_manager, "| Age:", athlete_info$age[1], "| Age at collection:", athlete_info$age_at_collection[1])
          athlete_uuid <- get_or_create_athlete(
            name = athlete_name,
            date_of_birth = dob_for_manager,
            age = athlete_info$age[1],
            age_at_collection = athlete_info$age_at_collection[1],
            gender = athlete_info$gender[1],
            height = athlete_info$height[1],
            weight = athlete_info$weight[1],
            source_system = "pitching",
            source_athlete_id = athlete_info$athlete_id[1],
            check_app_db = TRUE
          )
          athlete_info$uid <- athlete_uuid
          log_progress("  [WAREHOUSE] Got/created athlete UUID for", athlete_name, ":", athlete_uuid)
        }, error = function(e) {
          err_msg <- conditionMessage(e)
          log_progress("  [WARNING] Failed to get UUID from warehouse:", err_msg)
          cat("  [ERROR] get_or_create_athlete (Python) failed:\n", err_msg, "\n", sep = "")
          cat("  Falling back to local UUID. No data will be written for this athlete until the error above is fixed and you re-run.\n")
          flush.console()
          athlete_info$uid <- uuid::UUIDgenerate()
        })
      } else {
        # Fallback: Try to get UUID from app database by matching name
        normalized_name <- normalize_name_for_matching(athlete_name)
        matched_uuid <- get_uuid_by_name(athlete_name, uuid_map)
        
        if (!is.na(matched_uuid)) {
          athlete_info$uid <- matched_uuid
          log_progress("  [MATCHED] Found existing UUID for", athlete_name)
        } else {
          # Generate new UUID if no match found
          athlete_info$uid <- uuid::UUIDgenerate()
          log_progress("  [NEW] Generated new UUID for", athlete_name)
        }
      }
      
      # Safety check: ensure uid was set
      if (!"uid" %in% names(athlete_info) || is.na(athlete_info$uid[1])) {
        log_progress("  [ERROR] uid was not set for athlete", athlete_name, "- generating now")
        athlete_info$uid <- uuid::UUIDgenerate()
      }
      
      dir_path <- dirname(sf)
      athlete_list[[length(athlete_list) + 1]] <- athlete_info
      
      # Map by directory path - this will be used to match session_data.xml files
      dir_path_normalized <- normalizePath(dir_path, winslash = "/", mustWork = FALSE)
      owner_mapping[[dir_path_normalized]] <- athlete_info$uid[1]
      
      # Also try to extract measurement filenames from session.xml to map owners
      # Look for Measurement elements with Filename attributes
      root_athlete <- xml_root(doc_athlete)
      measurements <- xml_find_all(root_athlete, ".//Measurement")
      if (length(measurements) > 0) {
        for (meas in measurements) {
          meas_filename <- xml_attr(meas, "Filename")
          if (!is.na(meas_filename) && meas_filename != "") {
            owner_mapping[[meas_filename]] <- athlete_info$uid[1]
            # Also map without extension
            meas_no_ext <- tools::file_path_sans_ext(meas_filename)
            owner_mapping[[meas_no_ext]] <- athlete_info$uid[1]
            log_progress("    Mapped measurement:", meas_filename)
          }
        }
      }
      
      # Extract velocity mappings from session.xml (Comments field -> velocity in MPH)
      velocity_map_from_file <- extract_velocity_mappings(sf)
      if (length(velocity_map_from_file) > 0) {
        # Merge into global velocity_mapping
        for (key in names(velocity_map_from_file)) {
          velocity_mapping[[key]] <- velocity_map_from_file[[key]]
        }
        log_progress("  [VELOCITY] Extracted", length(velocity_map_from_file), "velocity mappings from", basename(sf))
        if (i <= 3) {
          # Show first few mappings for debugging
          example_keys <- head(names(velocity_map_from_file), min(3, length(velocity_map_from_file)))
          for (key in example_keys) {
            log_progress("    ", key, "->", velocity_map_from_file[[key]], "MPH")
          }
        }
      }

      # Extract session-level date mappings from session.xml (Session/Fields/Creation_date)
      session_date_map_from_file <- extract_session_date_mappings(sf)
      if (length(session_date_map_from_file) > 0) {
        for (key in names(session_date_map_from_file)) {
          session_date_mapping[[key]] <- session_date_map_from_file[[key]]
        }
        if (i <= 3) {
          log_progress("  [SESSION DATE] Extracted", length(session_date_map_from_file), "session-date mappings from", basename(sf))
        }
      }
      
      log_progress("  [SUCCESS] Mapped athlete", athlete_info$name[1], "to UID:", athlete_info$uid[1])
      log_progress("  Directory:", dir_path_normalized)
    }
  }
  
  # Note: Athletes are now stored in analytics.d_athletes via athlete_manager
  # We still keep a local athletes table for reference if using SQLite
  if (isFALSE(use_warehouse)) {
  if (length(athlete_list) > 0) {
    athletes_df <- bind_rows(athlete_list)
      log_progress("Writing athletes table to local database...")
    DBI::dbWriteTable(con, "athletes", athletes_df, overwrite = TRUE)
      log_progress("[SUCCESS] Created athletes table with", nrow(athletes_df), "rows")
  } else {
      # Create empty athletes table with age_at_collection column
    athletes_df <- tibble(
      uid = character(),
      athlete_id = character(),
      name = character(),
      date_of_birth = character(),
      age = numeric(),
        age_at_collection = numeric(),
      gender = character(),
      height = numeric(),
      weight = numeric(),
      creation_date = character(),
      creation_time = character(),
      source_file = character(),
      source_path = character()
    )
    DBI::dbWriteTable(con, "athletes", athletes_df, overwrite = TRUE)
    }
  } else {
    log_progress("Note: Athletes are stored in analytics.d_athletes (via athlete_manager)")
    log_progress("Skipping local athletes table creation for warehouse mode")
  }
  
  # Create uid -> athlete_id mapping for adding to metrics
  uid_to_athlete_id <- list()
  if (length(athlete_list) > 0) {
    for (athlete_info in athlete_list) {
      if (nrow(athlete_info) > 0 && "uid" %in% names(athlete_info) && "athlete_id" %in% names(athlete_info)) {
        uid_to_athlete_id[[athlete_info$uid[1]]] <- athlete_info$athlete_id[1]
      }
    }
  }
  
  # Process session_data.xml files
  metric_data_list <- list()
  
  total_data_files <- length(session_data_files)
  total_owners_processed <- 0
  total_owners_matched <- 0
  total_owners_skipped <- 0
  total_rows_extracted <- 0
  
  log_progress("")
  log_progress("PHASE 2: Processing", total_data_files, "session_data.xml files for metric data")
  log_progress("")
  
  # Force output immediately
  cat("\n*** PHASE 2 STARTING ***\n")
  cat("Total session_data.xml files:", total_data_files, "\n")
  flush.console()
  
  for (i in seq_along(session_data_files)) {
    sdf <- session_data_files[i]
    if (i <= 3 || i %% 10 == 0) {  # Log first 3 files and every 10th file
      log_progress("[", i, "/", total_data_files, "] Processing:", basename(sdf))
      cat("Processing file", i, "of", total_data_files, ":", basename(sdf), "\n")
      flush.console()
    }
    doc <- tryCatch(read_xml_robust(sdf), error = function(e) {
      if (i <= 3) {
        log_progress("  [ERROR] Error reading file:", conditionMessage(e))
        cat("ERROR reading file:", conditionMessage(e), "\n")
        flush.console()
      }
      NULL
    })
    if (is.null(doc)) {
      if (i <= 3) {
        cat("  File", i, "failed to load, skipping\n")
        flush.console()
      }
      next
    }
    
    # Try to find owner names
    root <- xml_root(doc)
    if (identical(xml_name(root), "v3d")) {
      owners <- xml_find_all(root, "./owner")
      owner_names <- xml_attr(owners, "value")
      
      if (i <= 3) {
        log_progress("  Found", length(owner_names), "owners:", paste(owner_names, collapse = ", "))
        cat("  Found", length(owner_names), "owners in file", i, "\n")
        flush.console()
      }
      
      # Try to match owner to athlete
      dir_path <- dirname(sdf)
      
      # Look for matching athlete based on directory structure
      matched_uid <- NA_character_
      
      for (owner_name in owner_names) {
        total_owners_processed <- total_owners_processed + 1
        matched_uid <- NA_character_
        best_match <- NULL
        best_match_score <- 0
        
        # PRIORITY: Match by finding session.xml in the same directory as session_data.xml
        # This is the most reliable method since each session_data.xml is in a specific athlete's directory
        dir_path_normalized <- normalizePath(dir_path, winslash = "/", mustWork = FALSE)
        
        # First check if we already mapped this directory (from a previous owner in same file)
        if (dir_path_normalized %in% names(owner_mapping)) {
          matched_uid <- owner_mapping[[dir_path_normalized]]
          if (i <= 3) {
            cat("    [MATCH-CACHED] Owner", owner_name, "-> Directory already mapped to UID:", matched_uid, "\n")
            flush.console()
          }
        } else {
          # Find session.xml in same directory (most reliable)
          session_xml <- file.path(dir_path, "session.xml")
          if (file.exists(session_xml)) {
            if (i <= 3) {
              flush.console()
            }
            # Look up this session.xml in athlete_list (from Phase 1) to get the correct UUID
            session_xml_normalized <- normalizePath(session_xml, winslash = "/", mustWork = FALSE)
            found_athlete <- NULL
            for (athlete_info in athlete_list) {
              if (nrow(athlete_info) > 0) {
                athlete_path_normalized <- normalizePath(athlete_info$source_path[1], winslash = "/", mustWork = FALSE)
                if (identical(athlete_path_normalized, session_xml_normalized)) {
                  found_athlete <- athlete_info
                  break
                }
              }
            }
            
            if (!is.null(found_athlete) && nrow(found_athlete) > 0 && "uid" %in% names(found_athlete) && !is.na(found_athlete$uid[1])) {
              matched_uid <- found_athlete$uid[1]
              best_match <- found_athlete
              # Cache this mapping for future owners in same directory
              owner_mapping[[dir_path_normalized]] <- matched_uid
              if (i <= 3) {
                cat("    [MATCH-SESSION] Owner", owner_name, "matched via session.xml in same directory\n")
                cat("      Athlete:", found_athlete$name[1], "| UID:", matched_uid, "\n")
                flush.console()
              }
            } else {
              if (i <= 3) {
                cat("    [WARNING] session.xml found but not in athlete_list:", session_xml, "\n")
                flush.console()
              }
            }
          } else {
            # Try parent directory
            parent_dir <- dirname(dir_path)
            session_xml <- file.path(parent_dir, "session.xml")
            if (file.exists(session_xml)) {
              if (i <= 3) {
                flush.console()
              }
              # Look up this session.xml in athlete_list
              session_xml_normalized <- normalizePath(session_xml, winslash = "/", mustWork = FALSE)
              found_athlete <- NULL
              for (athlete_info in athlete_list) {
                if (nrow(athlete_info) > 0) {
                  athlete_path_normalized <- normalizePath(athlete_info$source_path[1], winslash = "/", mustWork = FALSE)
                  if (identical(athlete_path_normalized, session_xml_normalized)) {
                    found_athlete <- athlete_info
                    break
                  }
                }
              }
              
              if (!is.null(found_athlete) && nrow(found_athlete) > 0 && "uid" %in% names(found_athlete) && !is.na(found_athlete$uid[1])) {
                matched_uid <- found_athlete$uid[1]
                best_match <- found_athlete
                owner_mapping[[dir_path_normalized]] <- matched_uid
                if (i <= 3) {
                  cat("    [MATCH-SESSION] Owner", owner_name, "matched via session.xml in parent directory\n")
                  cat("      Athlete:", found_athlete$name[1], "| UID:", matched_uid, "\n")
                  flush.console()
                }
              } else {
                if (i <= 3) {
                  cat("    [WARNING] session.xml in parent found but not in athlete_list:", session_xml, "\n")
                  flush.console()
                }
              }
            } else {
              if (i <= 3) {
                cat("    [WARNING] No session.xml found in", dir_path, "or parent\n")
                flush.console()
              }
            }
          }
        }
        
        # Fallback: Try direct match by owner name (less reliable)
        if (is.na(matched_uid)) {
        owner_base <- basename(owner_name)
        owner_no_ext <- tools::file_path_sans_ext(owner_base)
        
        if (owner_base %in% names(owner_mapping)) {
          matched_uid <- owner_mapping[[owner_base]]
            if (i <= 3) {
              cat("    [MATCH-NAME] Owner", owner_name, "matched via direct name match\n")
              flush.console()
            }
        } else if (owner_no_ext %in% names(owner_mapping)) {
          matched_uid <- owner_mapping[[owner_no_ext]]
            if (i <= 3) {
              cat("    [MATCH-NAME] Owner", owner_name, "matched via base name match\n")
              flush.console()
            }
          }
        }
        
        # Last resort: Try to match by directory similarity (only if session.xml not found)
        # This should rarely be needed if session.xml files are in the right places
        if (is.na(matched_uid) && length(athlete_list) > 0) {
          dir_path_normalized <- normalizePath(dir_path, winslash = "/", mustWork = FALSE)
          
          # Check all athletes to see if any match this directory
          best_match <- NULL
          best_match_score <- 0
          
          for (athlete_info in athlete_list) {
            if (nrow(athlete_info) > 0) {
              athlete_dir <- dirname(athlete_info$source_path[1])
              athlete_dir_normalized <- normalizePath(athlete_dir, winslash = "/", mustWork = FALSE)
              
              # Calculate match score - exact match gets highest score (use identical() to avoid if(NA))
              match_score <- 0
              if (identical(dir_path_normalized, athlete_dir_normalized)) {
                match_score <- 100  # Exact match
              } else if (!is.na(athlete_dir_normalized) && !is.na(dir_path_normalized) &&
                         grepl(paste0("^", gsub("([^/])$", "\\1/", athlete_dir_normalized)), dir_path_normalized)) {
                match_score <- 50  # session_data.xml is in athlete's directory
          } else {
                # Check if they share a common parent directory
                dir_parts <- strsplit(dir_path_normalized, "/")[[1]]
                athlete_parts <- strsplit(athlete_dir_normalized, "/")[[1]]
                common_parts <- min(length(dir_parts), length(athlete_parts))
                for (j in 1:common_parts) {
                  if (dir_parts[j] == athlete_parts[j]) {
                    match_score <- match_score + 1
                  } else {
                  break
                }
              }
            }
              
              if (match_score > best_match_score) {
                best_match_score <- match_score
                best_match <- athlete_info
              }
            }
          }
          
          # Only use match if score is high enough (at least 2 common directory parts to avoid false matches)
          if (!is.null(best_match) && best_match_score >= 2 && "uid" %in% names(best_match) && !is.na(best_match$uid[1])) {
            matched_uid <- best_match$uid[1]
            if (i <= 3) {
              cat("    [MATCH] Owner", owner_name, "matched via directory similarity (score:", best_match_score, ")\n")
              cat("      Athlete:", best_match$name[1], "| UID:", matched_uid, "\n")
              flush.console()
            }
          }
        }
        
        if (is.na(matched_uid)) {
          total_owners_skipped <- total_owners_skipped + 1
          if (i <= 3 || total_owners_skipped <= 5) {
            log_progress("    [SKIPPED] Could not match owner", owner_name, "- skipping")
            log_progress("    Directory:", dir_path)
          }
          next  # Skip this owner instead of using wrong UUID
        }
        
        # Filter: Only process Fastball trials, skip Static and other trial types
        # Check owner name (not folder name) for trial type
        owner_name_lower <- tolower(owner_name)
        is_static <- grepl("static", owner_name_lower)
        is_fastball <- grepl("fastball", owner_name_lower)
        
        if (is_static) {
          if (i <= 3) {
            cat("    [SKIP] Static trial owner:", owner_name, "\n")
            flush.console()
          }
          next  # Skip static trials
        }
        
        if (!is_fastball) {
          if (i <= 3) {
            cat("    [SKIP] Non-Fastball trial owner:", owner_name, "\n")
            flush.console()
          }
          next  # Skip non-Fastball trials
        }
        
        total_owners_matched <- total_owners_matched + 1
        
        # Extract ALL metric data for this owner
        if (i <= 3) {
          log_progress("    [MATCHED] Owner:", owner_name, "-> UID:", matched_uid)
          cat("    [PROCESSING] Fastball owner:", owner_name, "\n")
          flush.console()
        }
        
        # Call extract_metric_data and get detailed feedback
        if (i <= 3) {
          cat("    Calling extract_metric_data for owner:", owner_name, "\n")
          flush.console()
        }
        metric_data <- extract_metric_data(doc, owner_name)
        
        if (i <= 3) {
          cat("    extract_metric_data returned", nrow(metric_data), "rows\n")
          flush.console()
        }
        
        if (nrow(metric_data) > 0) {
          total_rows_extracted <- total_rows_extracted + nrow(metric_data)
          if (i <= 3) {
            log_progress("      Extracted", nrow(metric_data), "rows of METRIC data")
            cat("    [SUCCESS] Extracted", nrow(metric_data), "rows for owner", owner_name, "\n")
            flush.console()
          }
          metric_data$uid <- matched_uid
          # Add athlete_id if we have a mapping
          if (!is.na(matched_uid) && matched_uid %in% names(uid_to_athlete_id)) {
            metric_data$athlete_id <- uid_to_athlete_id[[matched_uid]]
          } else {
            metric_data$athlete_id <- NA_character_
          }
          
          # Match velocity from session.xml Comments field
          # Try to match owner_name to velocity_mapping (with and without extension, with .c3d)
          velocity_mph <- NA_real_
          owner_base <- basename(owner_name)
          owner_no_ext <- tools::file_path_sans_ext(owner_base)
          
          # Try multiple matching strategies
          if (owner_name %in% names(velocity_mapping)) {
            velocity_mph <- velocity_mapping[[owner_name]]
          } else if (owner_base %in% names(velocity_mapping)) {
            velocity_mph <- velocity_mapping[[owner_base]]
          } else if (owner_no_ext %in% names(velocity_mapping)) {
            velocity_mph <- velocity_mapping[[owner_no_ext]]
          } else {
            # Try with .qtm extension
            owner_qtm <- paste0(owner_no_ext, ".qtm")
            if (owner_qtm %in% names(velocity_mapping)) {
              velocity_mph <- velocity_mapping[[owner_qtm]]
            } else {
              # Try with .c3d extension
              owner_c3d <- paste0(owner_no_ext, ".c3d")
              if (owner_c3d %in% names(velocity_mapping)) {
                velocity_mph <- velocity_mapping[[owner_c3d]]
              }
            }
          }
          
          # Add velocity_mph column to all rows (same value for all rows of this pitch)
          metric_data$velocity_mph <- velocity_mph

          # Resolve session_date from session.xml Session/Fields/Creation_date using source dir + owner name
          source_dir_normalized <- normalizePath(dirname(sdf), winslash = "/", mustWork = FALSE)
          owner_base <- basename(owner_name)
          owner_no_ext <- tools::file_path_sans_ext(owner_base)
          owner_c3d <- paste0(owner_no_ext, ".c3d")
          owner_qtm <- paste0(owner_no_ext, ".qtm")
          owner_candidates <- unique(tolower(trimws(c(owner_name, owner_base, owner_no_ext, owner_c3d, owner_qtm))))

          session_date_for_owner <- as.Date(NA)
          if (!is.na(source_dir_normalized) && nzchar(source_dir_normalized)) {
            for (cand in owner_candidates) {
              map_key <- paste0(source_dir_normalized, "||", cand)
              if (map_key %in% names(session_date_mapping)) {
                session_date_for_owner <- session_date_mapping[[map_key]]
                break
              }
            }
            if (is.na(session_date_for_owner)) {
              dir_key <- paste0(source_dir_normalized, "||__dir__")
              if (dir_key %in% names(session_date_mapping)) {
                session_date_for_owner <- session_date_mapping[[dir_key]]
              }
            }
          }
          metric_data$session_date <- session_date_for_owner
          
          if (i <= 3 && !is.na(velocity_mph)) {
            log_progress("      [VELOCITY] Matched velocity for", owner_name, ":", velocity_mph, "MPH")
            cat("    [VELOCITY] Matched:", velocity_mph, "MPH for owner", owner_name, "\n")
            flush.console()
          } else if (i <= 3 && is.na(velocity_mph)) {
            log_progress("      [WARNING] No velocity found for", owner_name)
            cat("    [WARNING] No velocity mapping found for owner:", owner_name, "\n")
            flush.console()
          }
          
          # Calculate score for this pitch; formula expects weight in kg (athlete_info$weight is stored in lbs)
          weight_lb <- if (!is.null(best_match) && "weight" %in% names(best_match) && !is.na(best_match$weight[1])) as.numeric(best_match$weight[1]) else NA_real_
          weight_kg <- lbs_to_kg(weight_lb)
          pitch_score <- calculate_pitching_score(doc, owner_name, velocity_mph, weight_kg)
          metric_data$score <- pitch_score
          
          if (i <= 3 && !is.na(pitch_score)) {
            log_progress("      [SCORE] Calculated score for", owner_name, ":", round(pitch_score, 2))
            cat("    [SCORE] Calculated:", round(pitch_score, 2), "for owner", owner_name, "\n")
            flush.console()
          } else if (i <= 3 && is.na(pitch_score)) {
            log_progress("      [WARNING] Could not calculate score for", owner_name, "- missing required variables")
            cat("    [WARNING] Could not calculate score for owner:", owner_name, "\n")
            flush.console()
          }
          
          metric_data$source_file <- basename(sdf)
          metric_data$source_path <- sdf
          metric_data_list[[length(metric_data_list) + 1]] <- metric_data
        } else {
          if (i <= 3) {
            log_progress("      [WARNING] No METRIC data extracted for", owner_name)
            cat("    [WARNING] No data extracted for owner:", owner_name, "\n")
            flush.console()
          }
        }
        
        # Periodic progress update every 10 files
        if (i %% 10 == 0) {
          log_progress("  [PROGRESS] Processed", i, "/", total_data_files, "files")
          log_progress("    Owners matched:", total_owners_matched, "| Skipped:", total_owners_skipped, "| Rows extracted:", total_rows_extracted)
        }
      }
    }
  }
  
  # Summary of Phase 2
  log_progress("")
  log_progress("PHASE 2 SUMMARY:")
  log_progress("  Total owners processed:", total_owners_processed)
  log_progress("  Owners matched:", total_owners_matched)
  log_progress("  Owners skipped:", total_owners_skipped)
  log_progress("  Total metric rows extracted:", total_rows_extracted)
  log_progress("  Metric data lists created:", length(metric_data_list))
  
  # Force output with cat
  cat("\n*** PHASE 2 SUMMARY ***\n")
  cat("Total owners processed:", total_owners_processed, "\n")
  cat("Owners matched:", total_owners_matched, "\n")
  cat("Owners skipped:", total_owners_skipped, "\n")
  cat("Total metric rows extracted:", total_rows_extracted, "\n")
  cat("Metric data lists created:", length(metric_data_list), "\n")
  flush.console()
  
  # Combine and write to database
  # For time series data, we need to ensure all rows have the same columns
  # First, find maximum frame count across all data before binding
  
  if (length(metric_data_list) > 0) {
    log_progress("")
    log_progress("PHASE 3: Consolidating metric data and writing to database...")
    # Find max frames before binding
    max_frames <- 0
    log_progress("  Finding maximum frame count across all data...")
    for (df in metric_data_list) {
      if (nrow(df) > 0) {
        # Find the maximum value column index
        value_cols <- grep("^value_\\d+$", names(df), value = TRUE)
        if (length(value_cols) > 0) {
          # Extract numbers from column names
          frame_nums <- suppressWarnings(as.integer(gsub("value_", "", value_cols)))
          frame_nums <- frame_nums[!is.na(frame_nums)]
          if (length(frame_nums) > 0) {
            max_frames <- max(max_frames, max(frame_nums), na.rm = TRUE)
          }
        }
      }
    }
    log_progress("  Maximum frames in METRIC data:", max_frames)
    
    # Pad each dataframe to max_frames before binding
    log_progress("  Padding dataframes to", max_frames, "frames...")
    meta_cols <- c("uid", "athlete_id", "owner", "folder", "variable", "component", "source_file", "source_path", "session_date", "velocity_mph", "score")
    value_cols <- paste0("value_", 1:max_frames)
    
    padded_list <- list()
    for (idx in seq_along(metric_data_list)) {
      df <- metric_data_list[[idx]]
      if (idx %% 50 == 0) {
        log_progress("    Padding dataframe", idx, "of", length(metric_data_list))
      }
      # Add missing columns with NA
      for (j in 1:max_frames) {
        value_col <- paste0("value_", j)
        if (!value_col %in% names(df)) {
          df[[value_col]] <- NA_real_
        }
      }
      
      # Reorder columns
      df <- df %>% select(any_of(c(meta_cols, value_cols)))
      padded_list[[length(padded_list) + 1]] <- df
    }
    
    log_progress("  Binding all dataframes together...")
    log_progress("  Number of dataframes to bind:", length(padded_list))
    if (length(padded_list) > 0) {
      log_progress("  First dataframe dimensions:", nrow(padded_list[[1]]), "rows,", ncol(padded_list[[1]]), "columns")
      log_progress("  First dataframe columns:", paste(names(padded_list[[1]]), collapse = ", "))
    }
    cat("  [PROGRESS] Binding", length(padded_list), "dataframes (this may take a while)...\n")
    flush.console()
    metric_df <- bind_rows(padded_list)
    log_progress("  metric_df after binding:", nrow(metric_df), "rows,", ncol(metric_df), "columns")
    cat("  [SUCCESS] Binding complete!\n")
    flush.console()
    
    if (isTRUE(use_warehouse)) {
      # Write to PostgreSQL warehouse f_kinematics_pitching table
      log_progress("  Writing metrics to warehouse f_kinematics_pitching table...")
      if (nrow(metric_df) == 0) {
        log_progress("  [WARNING] metric_df is EMPTY - no data was extracted!")
        log_progress("  This could mean:")
        log_progress("    1. No Fastball trials were found")
        log_progress("    2. No metric data was extracted from session_data.xml files")
        log_progress("    3. All data was filtered out")
        log_progress("  Check the Phase 2 summary above for owners matched/skipped")
      }
      
      # Ensure session_date is set from Session/Fields/Creation_date (already attached per owner in Phase 2)
      log_progress("  Setting session_date for", nrow(metric_df), "rows...")
      cat("  [PROGRESS] Creating session_date mapping (optimized)...\n")
      flush.console()

      default_date <- Sys.Date()
      if (!"session_date" %in% names(metric_df)) {
        metric_df$session_date <- as.Date(NA)
      } else {
        metric_df$session_date <- as.Date(metric_df$session_date)
      }

      # Build directory fallback map from session_date_mapping entries ending in ||__dir__
      path_to_date_map <- list()
      for (k in names(session_date_mapping)) {
        if (grepl("\\|\\|__dir__$", k)) {
          dir_key <- sub("\\|\\|__dir__$", "", k)
          path_to_date_map[[dir_key]] <- as.Date(session_date_mapping[[k]])
        }
      }

      # Fill only missing session_date values using source_path directory lookup
      missing_idx <- which(is.na(metric_df$session_date))
      if (length(missing_idx) > 0) {
        for (idx_missing in missing_idx) {
          path_val <- metric_df$source_path[idx_missing]
          if (is.na(path_val) || path_val == "") next
          path_dir <- normalizePath(dirname(path_val), winslash = "/", mustWork = FALSE)
          if (!is.na(path_dir) && path_dir %in% names(path_to_date_map)) {
            metric_df$session_date[idx_missing] <- path_to_date_map[[path_dir]]
          }
        }
      }

      # Final fallback: today, only when session date still missing
      metric_df$session_date[is.na(metric_df$session_date)] <- default_date

      cat("  [SUCCESS] Session dates assigned!\n")
      flush.console()
      
      # Create mapping from athlete_uuid to age_at_collection, height, weight
      log_progress("  Creating age/height/weight mapping from athlete_list...")
      uuid_to_age_df <- tibble(
        uid = character(),
        age_at_collection = numeric(),
        height = numeric(),
        weight = numeric()
      )
      for (athlete_info in athlete_list) {
        if (nrow(athlete_info) > 0 && "uid" %in% names(athlete_info) && !is.na(athlete_info$uid[1])) {
          athlete_uuid <- athlete_info$uid[1]
          age_at_collection <- athlete_info$age_at_collection[1]
          height <- if ("height" %in% names(athlete_info)) athlete_info$height[1] else NA_real_
          weight <- if ("weight" %in% names(athlete_info)) athlete_info$weight[1] else NA_real_
          uuid_to_age_df <- bind_rows(
            uuid_to_age_df,
            tibble(
              uid = athlete_uuid,
              age_at_collection = if (!is.na(age_at_collection)) as.numeric(age_at_collection) else NA_real_,
              height = as.numeric(height),
              weight = as.numeric(weight)
            )
          )
        }
      }
      log_progress("  Mapped", nrow(uuid_to_age_df), "athletes with age/height/weight")
      
      # ---------- Build trial-level rows for f_pitching_trials ----------
      if (requireNamespace("jsonlite", quietly = TRUE) && length(metric_data_list) > 0) {
        log_progress("  Building trial-level rows for f_pitching_trials...")
        default_date <- Sys.Date()
        trial_rows <- list()
        for (idx in seq_along(metric_data_list)) {
          df <- metric_data_list[[idx]]
          if (nrow(df) == 0) next
          path_dir <- normalizePath(dirname(df$source_path[1]), winslash = "/", mustWork = FALSE)
          session_date <- if ("session_date" %in% names(df)) as.Date(df$session_date[1]) else as.Date(NA)
          if (is.na(session_date)) session_date <- path_to_date_map[[path_dir]]
          if (is.null(session_date) || is.na(session_date)) session_date <- default_date
          uid <- df$uid[1]
          age_row <- uuid_to_age_df %>% filter(.data$uid == !!uid)
          age_at_collection <- if (nrow(age_row) > 0) age_row$age_at_collection[1] else NA_real_
          age_group <- if (!is.na(age_at_collection)) calculate_age_group_from_age(age_at_collection) else NA_character_
          height <- if (nrow(age_row) > 0) age_row$height[1] else NA_real_
          weight <- if (nrow(age_row) > 0) age_row$weight[1] else NA_real_
          # Build metrics as named list: "folder.variable" -> numeric vector of values
          value_cols <- grep("^value_\\d+$", names(df), value = TRUE)
          metrics_list <- list()
          for (r in seq_len(nrow(df))) {
            component_val <- if ("component" %in% names(df)) as.character(df$component[r]) else NA_character_
            metric_name <- as.character(df$variable[r])
            key_base <- paste(df$folder[r], metric_name, sep = ".")
            key <- if (!is.na(component_val) && nzchar(component_val)) {
              paste0(key_base, ".", component_val)
            } else {
              key_base
            }
            metrics_list[[key]] <- as.numeric(df[r, value_cols])
          }
          metrics_json <- jsonlite::toJSON(metrics_list, auto_unbox = TRUE, digits = 8)
          # Coerce to plain character so bind_rows() doesn't fail on mixed "json" class
          metrics_json <- as.character(metrics_json)
          session_xml_path <- normalizePath(file.path(dirname(df$source_path[1]), "session.xml"), winslash = "/", mustWork = FALSE)
          session_data_xml_path <- normalizePath(df$source_path[1], winslash = "/", mustWork = FALSE)
          owner_fname <- df$owner[1]
          handedness <- if (grepl("RH", owner_fname, ignore.case = TRUE)) "Right" else if (grepl("LH", owner_fname, ignore.case = TRUE)) "Left" else NA_character_
          trial_rows[[length(trial_rows) + 1]] <- tibble(
            idx = idx,
            athlete_uuid = uid,
            session_date = session_date,
            source_athlete_id = df$athlete_id[1],
            owner_filename = owner_fname,
            handedness = handedness,
            velocity_mph = df$velocity_mph[1],
            score = df$score[1],
            age_at_collection = age_at_collection,
            age_group = age_group,
            height = height,
            weight = weight,
            metrics_json = metrics_json,
            session_xml_path = session_xml_path,
            session_data_xml_path = session_data_xml_path
          )
        }
        if (length(trial_rows) > 0) {
          trials_df <- bind_rows(trial_rows) %>%
            group_by(.data$athlete_uuid, .data$session_date) %>%
            arrange(.data$idx) %>%
            mutate(trial_index = row_number() - 1L) %>%
            ungroup() %>%
            select(athlete_uuid, session_date, source_athlete_id, owner_filename, handedness, trial_index,
                   velocity_mph, score, age_at_collection, age_group, height, weight, metrics_json,
                   session_xml_path, session_data_xml_path)
          log_progress("  Built", nrow(trials_df), "trial rows for f_pitching_trials")
          # Ensure f_pitching_trials table exists
          trials_table_exists <- DBI::dbExistsTable(con, DBI::Id(schema = "public", table = "f_pitching_trials"))
          if (!trials_table_exists) {
            log_progress("  Creating f_pitching_trials table...")
            DBI::dbExecute(con, "
              CREATE TABLE IF NOT EXISTS public.f_pitching_trials (
                id SERIAL PRIMARY KEY,
                athlete_uuid VARCHAR(36) NOT NULL,
                name VARCHAR(255),
                session_date DATE NOT NULL,
                source_system VARCHAR(50) NOT NULL DEFAULT 'pitching',
                source_athlete_id VARCHAR(100),
                owner_filename TEXT,
                handedness VARCHAR(20),
                trial_index INTEGER NOT NULL,
                velocity_mph NUMERIC,
                score NUMERIC,
                age_at_collection NUMERIC,
                age_group TEXT,
                height NUMERIC,
                weight NUMERIC,
                metrics JSONB NOT NULL,
                session_xml_path TEXT,
                session_data_xml_path TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT f_pitching_trials_athlete_uuid_fkey
                  FOREIGN KEY (athlete_uuid) REFERENCES analytics.d_athletes(athlete_uuid) ON DELETE CASCADE
              )
            ")
            DBI::dbExecute(con, "
              CREATE UNIQUE INDEX IF NOT EXISTS idx_f_pitching_trials_unique
                ON public.f_pitching_trials(athlete_uuid, session_date, trial_index)
            ")
            DBI::dbExecute(con, "
              CREATE INDEX IF NOT EXISTS idx_f_pitching_trials_owner ON public.f_pitching_trials(owner_filename)
            ")
            DBI::dbExecute(con, "
              CREATE INDEX IF NOT EXISTS idx_f_pitching_trials_date ON public.f_pitching_trials(session_date)
            ")
            log_progress("  [SUCCESS] Created f_pitching_trials table")
          } else {
            # Add age columns if missing
            trials_cols <- DBI::dbGetQuery(con, "
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'f_pitching_trials'
            ")$column_name
            if (!"age_at_collection" %in% trials_cols) {
              DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN age_at_collection NUMERIC")
              log_progress("  Added age_at_collection to f_pitching_trials")
            }
            if (!"age_group" %in% trials_cols) {
              DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN age_group TEXT")
              log_progress("  Added age_group to f_pitching_trials")
            }
            if (!"height" %in% trials_cols) {
              DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN height NUMERIC")
              log_progress("  Added height to f_pitching_trials")
            }
            if (!"weight" %in% trials_cols) {
              DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN weight NUMERIC")
              log_progress("  Added weight to f_pitching_trials")
            }
            if (!"handedness" %in% trials_cols) {
              tryCatch({
                DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN handedness \"Handedness\"")
                log_progress("  Added handedness to f_pitching_trials")
              }, error = function(e) {
                DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN handedness VARCHAR(20)")
                log_progress("  Added handedness (VARCHAR) to f_pitching_trials")
              })
            }
            if (!"name" %in% trials_cols) {
              DBI::dbExecute(con, "ALTER TABLE public.f_pitching_trials ADD COLUMN name VARCHAR(255)")
              log_progress("  Added name to f_pitching_trials")
            }
          }
          # Safeguard 4 (Existing Athlete): prompt before overwriting existing session
          skip_this_session <- FALSE
          athlete_uuid_env <- trimws(Sys.getenv("ATHLETE_UUID", ""))
          if (nzchar(athlete_uuid_env)) {
            au <- as.character(trials_df$athlete_uuid[1])
            sd <- trials_df$session_date[1]
            if (au == athlete_uuid_env) {
              existing <- DBI::dbGetQuery(con,
                "SELECT 1 FROM public.f_pitching_trials WHERE athlete_uuid = $1 AND session_date = $2 LIMIT 1",
                params = list(au, sd))
              if (nrow(existing) > 0) {
                date_str <- format(sd, "%Y-%m-%d")
                cat("DUPLICATE_SESSION:", date_str, "\n", sep = "")
                cat("It looks like you already ran this data for the following date: ", date_str, ". Reply 'yes' to continue or 'no' to abort.\n", sep = "")
                flush.console()
                response_raw <- tryCatch(readLines(stdin(), n = 1), error = function(e) "no")
                response <- trimws(tolower(response_raw))
                should_continue <- response %in% c("yes", "y")
                if (!should_continue) {
                  skip_this_session <- TRUE
                  log_progress("  User response: '", response, "'. Skipping this session.")
                  cat("  [INFO] Duplicate-session response: ", response, " -> skip session\n", sep = "")
                  flush.console()
                } else {
                  log_progress("  User response: '", response, "'. Continuing and overwriting session rows.")
                  cat("  [INFO] Duplicate-session response: ", response, " -> continue session\n", sep = "")
                  flush.console()
                }
              }
            }
          }
          if (!skip_this_session) {
          # Ensure all athlete_uuids exist in analytics.d_athletes (avoid FK violation if get_or_create_athlete failed in Phase 1)
          unique_uuids_trials <- unique(as.character(trials_df$athlete_uuid))
          uuid_check_trials <- tryCatch({
            if (length(unique_uuids_trials) > 0) {
              DBI::dbGetQuery(con, paste0("
                SELECT athlete_uuid FROM analytics.d_athletes WHERE athlete_uuid IN ('", paste(unique_uuids_trials, collapse = "','"), "')
              "))
            } else {
              data.frame(athlete_uuid = character(0))
            }
          }, error = function(e) {
            log_progress("  [WARNING] Could not check d_athletes for trial insert:", conditionMessage(e))
            data.frame(athlete_uuid = character(0))
          })
          missing_trials_uuids <- setdiff(unique_uuids_trials, uuid_check_trials$athlete_uuid)
          if (length(missing_trials_uuids) > 0) {
            log_progress("  [WARNING] Skipping f_pitching_trials rows for athlete_uuids not in analytics.d_athletes (FK):", paste(missing_trials_uuids, collapse = ", "))
            cat("  [WARNING] Skipping trial rows for", length(missing_trials_uuids), "athlete UUID(s) not in d_athletes:", paste(missing_trials_uuids, collapse = ", "), "\n")
            flush.console()
            trials_df <- trials_df %>% filter(.data$athlete_uuid %in% uuid_check_trials$athlete_uuid)
          }
          if (nrow(trials_df) > 0) {
          # Lookup athlete names from d_athletes for name column
          unique_uuids_final <- unique(as.character(trials_df$athlete_uuid))
          names_df <- tryCatch({
            if (length(unique_uuids_final) > 0) {
              DBI::dbGetQuery(con, paste0("
                SELECT athlete_uuid, name FROM analytics.d_athletes WHERE athlete_uuid IN ('", paste(unique_uuids_final, collapse = "','"), "')
              "))
            } else {
              data.frame(athlete_uuid = character(0), name = character(0))
            }
          }, error = function(e) {
            data.frame(athlete_uuid = character(0), name = character(0))
          })
          if (nrow(names_df) > 0 && "name" %in% names(names_df)) {
            trials_df <- trials_df %>% left_join(names_df, by = "athlete_uuid")
          }
          if (!"name" %in% names(trials_df)) {
            trials_df$name <- NA_character_
          }
          trials_df$source_system <- "pitching"
          for (r in seq_len(nrow(trials_df))) {
            row <- trials_df[r, ]
            DBI::dbExecute(con, "
              INSERT INTO public.f_pitching_trials
                (athlete_uuid, name, session_date, source_system, source_athlete_id, owner_filename, handedness, trial_index,
                 velocity_mph, score, age_at_collection, age_group, height, weight, metrics, session_xml_path, session_data_xml_path)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)
              ON CONFLICT (athlete_uuid, session_date, trial_index) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, f_pitching_trials.name),
                owner_filename = EXCLUDED.owner_filename,
                handedness = COALESCE(EXCLUDED.handedness, f_pitching_trials.handedness),
                source_athlete_id = COALESCE(EXCLUDED.source_athlete_id, f_pitching_trials.source_athlete_id),
                velocity_mph = EXCLUDED.velocity_mph,
                score = EXCLUDED.score,
                age_at_collection = EXCLUDED.age_at_collection,
                age_group = EXCLUDED.age_group,
                height = COALESCE(EXCLUDED.height, f_pitching_trials.height),
                weight = COALESCE(EXCLUDED.weight, f_pitching_trials.weight),
                metrics = EXCLUDED.metrics,
                session_xml_path = EXCLUDED.session_xml_path,
                session_data_xml_path = EXCLUDED.session_data_xml_path,
                created_at = NOW()
            ", params = list(
              row$athlete_uuid, if (is.na(row$name) || row$name == "") NULL else as.character(row$name), row$session_date, row$source_system, row$source_athlete_id,
              row$owner_filename, if (is.na(row$handedness) || row$handedness == "") NULL else row$handedness, row$trial_index,
              row$velocity_mph, row$score,
              row$age_at_collection, row$age_group, row$height, row$weight, row$metrics_json,
              row$session_xml_path, row$session_data_xml_path
            ))
          }
          log_progress("  [SUCCESS] Wrote", nrow(trials_df), "rows to f_pitching_trials")
          } else {
            log_progress("  [WARNING] No trial rows remaining after filtering for existing athletes; skipping f_pitching_trials insert.")
          }
          }
        }
      }
      
      # Prepare data for warehouse - pivot to long format
      log_progress("  Transforming data for warehouse format...")
      cat("  [PROGRESS] Pivoting to long format (this may take a while with", nrow(metric_df), "rows)...\n")
      flush.console()
      
      # Get all value columns
      value_cols <- grep("^value_\\d+$", names(metric_df), value = TRUE)
      log_progress("  Found", length(value_cols), "value columns to pivot")
      
      # Pivot to long format and join age_at_collection, then calculate age_group
      warehouse_df <- metric_df %>%
        select(uid, athlete_id, owner, folder, variable, source_file, source_path, session_date, velocity_mph, score, all_of(value_cols)) %>%
        pivot_longer(
          cols = all_of(value_cols),
          names_to = "frame",
          values_to = "value",
          names_prefix = "value_"
        ) %>%
        filter(!is.na(value)) %>%  # Remove NA values
        # Join age_at_collection from mapping
        left_join(uuid_to_age_df, by = "uid") %>%
        mutate(
          frame = as.integer(frame),
          metric_name = paste(folder, variable, sep = "."),
          source_system = "pitching",
          created_at = Sys.time(),
          # Calculate age_group from age_at_collection
          age_group = ifelse(!is.na(age_at_collection),
                             calculate_age_group_from_age(age_at_collection),
                             NA_character_)
        ) %>%
        select(
          athlete_uuid = uid,
          session_date,
          source_system,
          source_athlete_id = athlete_id,
          metric_name,
          frame,
          value,
          velocity_mph,
          score,
          age_at_collection,
          age_group,
          created_at
        )
      
      log_progress("  Pivot complete! warehouse_df has", nrow(warehouse_df), "rows")
      cat("  [SUCCESS] Pivot complete! Final row count:", nrow(warehouse_df), "\n")
      flush.console()
      
      # Filter out rows whose athlete_uuid is not in analytics.d_athletes (avoid FK violation if get_or_create_athlete failed in Phase 1)
      if (nrow(warehouse_df) > 0) {
        unique_uuids_warehouse <- unique(as.character(warehouse_df$athlete_uuid))
        uuid_check_warehouse <- tryCatch({
          DBI::dbGetQuery(con, paste0("
            SELECT athlete_uuid FROM analytics.d_athletes WHERE athlete_uuid IN ('", paste(unique_uuids_warehouse, collapse = "','"), "')
          "))
        }, error = function(e) {
          log_progress("  [WARNING] Could not check d_athletes for f_kinematics_pitching:", conditionMessage(e))
          data.frame(athlete_uuid = character(0))
        })
        missing_warehouse_uuids <- setdiff(unique_uuids_warehouse, uuid_check_warehouse$athlete_uuid)
        if (length(missing_warehouse_uuids) > 0) {
          log_progress("  [WARNING] Skipping f_kinematics_pitching rows for athlete_uuids not in analytics.d_athletes (FK):", paste(missing_warehouse_uuids, collapse = ", "))
          cat("  [WARNING] Skipping kinematics rows for", length(missing_warehouse_uuids), "athlete UUID(s) not in d_athletes:", paste(missing_warehouse_uuids, collapse = ", "), "\n")
          flush.console()
          warehouse_df <- warehouse_df %>% filter(.data$athlete_uuid %in% uuid_check_warehouse$athlete_uuid)
          if (nrow(warehouse_df) == 0) {
            stop("No data was written: athlete(s) were not in analytics.d_athletes because get_or_create_athlete (Python) failed in Phase 1. Fix the Python/warehouse error shown above and re-run.")
          }
        }
      }
      
      # Write to warehouse
      log_progress("  ===== STARTING DATABASE WRITE =====")
      log_progress("  Writing", nrow(warehouse_df), "rows to f_kinematics_pitching...")
      cat("  [INFO] Starting database write operation...\n")
      flush.console()
      
      # Check if table exists, create if not
      log_progress("  Checking if table exists...")
      table_exists <- tryCatch({
        DBI::dbExistsTable(con, Id(schema = "public", table = "f_kinematics_pitching"))
      }, error = function(e) {
        log_progress("  [ERROR] Failed to check if table exists:", conditionMessage(e))
        stop("Cannot check table existence: ", conditionMessage(e))
      })
      log_progress("  Table exists:", table_exists)
      
      if (!table_exists) {
        log_progress("  Creating f_kinematics_pitching table...")
        # Create table with long format structure (one row per metric per frame)
        DBI::dbExecute(con, '
          CREATE TABLE IF NOT EXISTS f_kinematics_pitching (
            id SERIAL PRIMARY KEY,
            athlete_uuid VARCHAR(36) NOT NULL,
            session_date DATE NOT NULL,
            source_system VARCHAR(50) NOT NULL,
            source_athlete_id VARCHAR(100),
            metric_name TEXT NOT NULL,
            frame INTEGER NOT NULL,
            value NUMERIC,
            velocity_mph NUMERIC,
            score NUMERIC,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT idx_f_pitching_unique UNIQUE (athlete_uuid, session_date, metric_name, frame)
          )
        ')
        
        # Create indexes
        DBI::dbExecute(con, 'CREATE INDEX IF NOT EXISTS idx_f_pitching_uuid ON f_kinematics_pitching(athlete_uuid)')
        DBI::dbExecute(con, 'CREATE INDEX IF NOT EXISTS idx_f_pitching_date ON f_kinematics_pitching(session_date)')
        DBI::dbExecute(con, 'CREATE INDEX IF NOT EXISTS idx_f_pitching_metric ON f_kinematics_pitching(metric_name)')
        log_progress("  [SUCCESS] Created f_kinematics_pitching table")
      } else {
        # Check if table has the right structure
        log_progress("  Table exists, checking structure...")
        table_info <- DBI::dbGetQuery(con, "
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'f_kinematics_pitching'
          ORDER BY ordinal_position
        ")
        log_progress("  Current columns:", paste(table_info$column_name, collapse = ", "))
        
        # Check if metric_name column exists
        if (!"metric_name" %in% table_info$column_name) {
          log_progress("  [WARNING] Table exists but has wrong structure!")
          log_progress("  Table needs metric_name, frame, and value columns")
          log_progress("  You may need to drop and recreate the table, or use a different table name")
          stop("f_kinematics_pitching table exists but has incompatible structure. Please drop and recreate it.")
        }
        
        # Check if velocity_mph column exists, add if missing
        if (!"velocity_mph" %in% table_info$column_name) {
          log_progress("  velocity_mph column missing, adding it...")
          tryCatch({
            DBI::dbExecute(con, "
              ALTER TABLE public.f_kinematics_pitching
              ADD COLUMN velocity_mph NUMERIC
            ")
            log_progress("  [SUCCESS] Added velocity_mph column")
          }, error = function(e) {
            log_progress("  [WARNING] Could not add velocity_mph column:", conditionMessage(e))
            log_progress("  Velocity data will not be stored. You may need to manually add the column.")
          })
        } else {
          log_progress("  velocity_mph column exists")
        }
        
        # Check if score column exists, add if missing
        if (!"score" %in% table_info$column_name) {
          log_progress("  score column missing, adding it...")
          tryCatch({
            DBI::dbExecute(con, "
              ALTER TABLE public.f_kinematics_pitching
              ADD COLUMN score NUMERIC
            ")
            log_progress("  [SUCCESS] Added score column")
          }, error = function(e) {
            log_progress("  [WARNING] Could not add score column:", conditionMessage(e))
            log_progress("  Score data will not be stored. You may need to manually add the column.")
          })
        } else {
          log_progress("  score column exists")
        }
        
        # Check if unique constraint exists
        constraint_check <- DBI::dbGetQuery(con, "
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_schema = 'public'
          AND table_name = 'f_kinematics_pitching'
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'idx_f_pitching_unique'
        ")
        
        if (nrow(constraint_check) == 0) {
          log_progress("  Unique constraint missing, adding it...")
          tryCatch({
            DBI::dbExecute(con, "
              ALTER TABLE public.f_kinematics_pitching
              ADD CONSTRAINT idx_f_pitching_unique UNIQUE (athlete_uuid, session_date, metric_name, frame)
            ")
            log_progress("  [SUCCESS] Added unique constraint")
          }, error = function(e) {
            log_progress("  [WARNING] Could not add unique constraint:", conditionMessage(e))
            log_progress("  This may cause issues with ON CONFLICT. You may need to manually add the constraint.")
          })
        } else {
          log_progress("  Unique constraint exists")
        }
      }
      
      # Write data (append mode for warehouse)
      log_progress("  Attempting to write data...")
      log_progress("  warehouse_df dimensions:", nrow(warehouse_df), "rows,", ncol(warehouse_df), "columns")
      log_progress("  warehouse_df columns:", paste(names(warehouse_df), collapse = ", "))
      if (nrow(warehouse_df) > 0) {
        log_progress("  First few rows sample:")
        print(head(warehouse_df, 3))
      } else {
        log_progress("  [WARNING] warehouse_df is EMPTY - no data to write!")
        log_progress("  This means no metric data was extracted from the XML files")
        log_progress("  Check if metric_data_list has data before transformation")
      }
      
      if (nrow(warehouse_df) > 0) {
        tryCatch({
          # OPTIMIZED: Skip all pre-checks - ON CONFLICT handles duplicates efficiently
          # This removes expensive SELECT DISTINCT queries on large tables
          log_progress("  Inserting", nrow(warehouse_df), "rows to f_kinematics_pitching...")
          
          # Handle TRUNCATE if requested (rarely needed)
          if (TRUNCATE_BEFORE_INSERT) {
            log_progress("  Truncating existing data before inserting new data...")
            DBI::dbExecute(con, "TRUNCATE TABLE f_kinematics_pitching")
            log_progress("  [SUCCESS] Table truncated")
          }
          
          # Ensure data types match Prisma schema
          warehouse_df$athlete_uuid <- as.character(warehouse_df$athlete_uuid)
          warehouse_df$session_date <- as.Date(warehouse_df$session_date)
          warehouse_df$source_system <- as.character(warehouse_df$source_system)
          if (!is.null(warehouse_df$source_athlete_id)) {
            warehouse_df$source_athlete_id <- as.character(warehouse_df$source_athlete_id)
          }
          warehouse_df$metric_name <- as.character(warehouse_df$metric_name)
          warehouse_df$frame <- as.integer(warehouse_df$frame)
          warehouse_df$value <- as.numeric(warehouse_df$value)
          if (!is.null(warehouse_df$velocity_mph)) {
            warehouse_df$velocity_mph <- as.numeric(warehouse_df$velocity_mph)
          }
          if (!is.null(warehouse_df$score)) {
            warehouse_df$score <- as.numeric(warehouse_df$score)
          }
          # Age columns
          if (!is.null(warehouse_df$age_at_collection)) {
            warehouse_df$age_at_collection <- as.numeric(warehouse_df$age_at_collection)
          }
          if (!is.null(warehouse_df$age_group)) {
            warehouse_df$age_group <- as.character(warehouse_df$age_group)
          }
          warehouse_df$created_at <- as.POSIXct(warehouse_df$created_at)
          
          # OPTIMIZED: Use temp table + single COPY + INSERT for maximum speed
          log_progress("  Using optimized bulk insert (temp table + COPY + ON CONFLICT)...")
          cat("  [INFO] Writing data to database (this may take a moment)...\n")
          flush.console()
          
          rows_inserted <- tryCatch({
            # Create a temporary table with the same structure
            temp_table_name <- "temp_pitching_insert"
            
            log_progress("  Creating temporary table...")
            DBI::dbExecute(con, paste0("
              CREATE TEMP TABLE ", temp_table_name, " (
                athlete_uuid VARCHAR(36) NOT NULL,
                session_date DATE NOT NULL,
                source_system VARCHAR(50) NOT NULL,
                source_athlete_id VARCHAR(100),
                metric_name TEXT NOT NULL,
                frame INTEGER NOT NULL,
                value NUMERIC,
                velocity_mph NUMERIC,
                score NUMERIC,
                age_at_collection NUMERIC,
                age_group TEXT,
                created_at TIMESTAMP
              )
            "))
            
            # OPTIMIZED: Write ALL data to temp table in ONE operation (uses COPY internally)
            # This is much faster than batching - dbWriteTable uses COPY protocol
            log_progress("  Writing", nrow(warehouse_df), "rows to temp table (single COPY operation)...")
            DBI::dbWriteTable(con, temp_table_name, warehouse_df, append = TRUE, row.names = FALSE)
            
            # OPTIMIZED: Single INSERT with ON CONFLICT - PostgreSQL handles duplicates efficiently
            log_progress("  Inserting from temp table to f_kinematics_pitching (ON CONFLICT handles duplicates)...")
            result <- DBI::dbExecute(con, paste0("
              INSERT INTO public.f_kinematics_pitching 
              (athlete_uuid, session_date, source_system, source_athlete_id, metric_name, frame, value, velocity_mph, score, age_at_collection, age_group, created_at)
              SELECT athlete_uuid, session_date, source_system, source_athlete_id, metric_name, frame, value, velocity_mph, score, age_at_collection, age_group, created_at
              FROM ", temp_table_name, "
              ON CONFLICT (athlete_uuid, session_date, metric_name, frame) DO NOTHING
            "))
            
            # Drop temp table
            DBI::dbExecute(con, paste0("DROP TABLE IF EXISTS ", temp_table_name))
            
            log_progress("  [SUCCESS] Inserted", result, "new rows (skipped", nrow(warehouse_df) - result, "duplicates)")
            cat("  [SUCCESS] Insert complete!\n")
            flush.console()
            
            result
            }, error = function(e) {
              error_msg <- conditionMessage(e)
              log_progress("  [ERROR] Insert failed:", error_msg)
              cat("  [ERROR] Insert failed:", error_msg, "\n")
              flush.console()
              
              # Clean up temp table if it exists
              tryCatch({
                DBI::dbExecute(con, "DROP TABLE IF EXISTS temp_pitching_insert")
              }, error = function(e) NULL)
              
              # Check if it's a foreign key violation
              if (grepl("foreign key|violates foreign key|insert or update on table.*violates foreign key constraint", error_msg, ignore.case = TRUE)) {
                log_progress("  [ERROR] FOREIGN KEY VIOLATION - athlete_uuid not found in analytics.d_athletes!")
                log_progress("  Checking which UUIDs are missing...")
                
                unique_uuids <- unique(warehouse_df$athlete_uuid)
                log_progress("  Attempting to insert", length(unique_uuids), "unique athlete UUIDs")
                
                uuid_check <- DBI::dbGetQuery(con, paste0("
                  SELECT athlete_uuid 
                  FROM analytics.d_athletes 
                  WHERE athlete_uuid IN ('", paste(unique_uuids, collapse = "','"), "')
                "))
                
                missing_uuids <- setdiff(unique_uuids, uuid_check$athlete_uuid)
                if (length(missing_uuids) > 0) {
                  log_progress("  [ERROR] Missing", length(missing_uuids), "UUIDs in d_athletes:")
                  log_progress("  First 5 missing:", paste(head(missing_uuids, 5), collapse = ", "))
                  stop("Foreign key violation: ", length(missing_uuids), " athlete UUIDs not found in analytics.d_athletes")
                }
              }
              
              stop("Insert failed: ", error_msg)
            })
            
            if (rows_inserted > 0) {
              log_progress("[SUCCESS] Inserted", rows_inserted, "new rows to f_kinematics_pitching table")
            } else {
              log_progress("  [INFO] No new rows inserted (all were duplicates)")
            }
          
          # OPTIMIZED: Skip expensive verification queries - they're not needed for normal operation
          # Only verify if explicitly requested (can add a flag later if needed)
          log_progress("  Insert completed successfully")
          
          # Update athlete data flags and session counts
          log_progress("")
          log_progress("Updating athlete data flags and session counts...")
          tryCatch({
            update_result <- update_athlete_flags(con, verbose = TRUE)
            if (update_result$success) {
              log_progress("  [SUCCESS] Athlete flags updated successfully")
            } else {
              log_progress("  [WARNING] Failed to update athlete flags:", update_result$message)
            }
          }, error = function(e) {
            log_progress("  [WARNING] Error updating athlete flags:", conditionMessage(e))
            log_progress("  You can manually update flags by running: SELECT update_athlete_data_flags();")
          })
          
          # Check for duplicate athletes and prompt to merge
          log_progress("")
          log_progress("=", rep("=", 60), sep = "")
          log_progress("CHECKING FOR DUPLICATE ATHLETES")
          log_progress("=", rep("=", 60), sep = "")
          tryCatch({
            # Get list of processed athlete UUIDs
            processed_uuids <- sapply(athlete_list, function(a) {
              if (nrow(a) > 0 && "uid" %in% names(a) && !is.na(a$uid[1])) {
                return(a$uid[1])
              }
              return(NULL)
            })
            processed_uuids <- unique(unlist(processed_uuids))
            processed_uuids <- processed_uuids[!is.null(processed_uuids)]
            
            log_progress("  Checking", length(processed_uuids), "processed athlete UUID(s) for duplicates...")
            if (length(processed_uuids) > 0) {
              log_progress("  Athlete UUIDs to check:", paste(processed_uuids, collapse = ", "))
            }
            
            if (length(processed_uuids) > 0 && exists("check_and_merge_duplicates")) {
              log_progress("  Calling check_and_merge_duplicates()...")
              duplicate_result <- check_and_merge_duplicates(
                athlete_uuids = processed_uuids,
                min_similarity = 0.80
              )
              log_progress("  Duplicate check completed")
              if (!is.null(duplicate_result)) {
                log_progress("  Result:", paste(names(duplicate_result), "=", duplicate_result, collapse = ", "))
                if (!is.null(duplicate_result$matches_found)) {
                  log_progress("  [DUPLICATE CHECK] Found", duplicate_result$matches_found, "potential matches")
                  log_progress("  [DUPLICATE CHECK] Merged:", duplicate_result$merged, "| Skipped:", duplicate_result$skipped)
                }
              } else {
                log_progress("  [WARNING] Duplicate check returned NULL result")
              }
            } else if (length(processed_uuids) > 0) {
              log_progress("  [WARNING] check_and_merge_duplicates function not found - skipping duplicate check")
              log_progress("  Processed", length(processed_uuids), "athlete UUIDs")
              log_progress("  Function exists check:", exists("check_and_merge_duplicates"))
            } else {
              log_progress("  [INFO] No athlete UUIDs to check (athlete_list is empty)")
            }
            log_progress("=", rep("=", 60), sep = "")
          }, error = function(e) {
            log_progress("  [ERROR] Could not check for duplicates:", conditionMessage(e))
            log_progress("  Error details:", toString(e))
            traceback()
          })
        }, error = function(e) {
          log_progress("[ERROR] Failed to write data:", conditionMessage(e))
          log_progress("  Error details:", toString(e))
          log_progress("  warehouse_df structure:")
          print(str(warehouse_df))
          stop("Failed to write to warehouse: ", conditionMessage(e))
        })
      } else {
        log_progress("  [SKIPPED] No data to write - warehouse_df is empty")
      }
      
    } else {
      # Write to local SQLite database
      log_progress("  Writing metrics table to local database (this may take a while)...")
    DBI::dbWriteTable(con, "metrics", metric_df, overwrite = TRUE)
      log_progress("[SUCCESS] Created metrics table with", nrow(metric_df), "rows and", ncol(metric_df), "columns")
    
    # Create indexes for faster queries
      log_progress("  Creating indexes for faster queries...")
    tryCatch({
        log_progress("    Creating index on uid...")
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_metrics_uid ON metrics(uid)")
        log_progress("    Creating index on variable...")
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_metrics_variable ON metrics(variable)")
        log_progress("    Creating index on folder...")
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_metrics_folder ON metrics(folder)")
        log_progress("    Creating composite index on (uid, variable)...")
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_metrics_uid_variable ON metrics(uid, variable)")
        log_progress("  [SUCCESS] Created indexes on uid, variable, folder, and (uid, variable)")
    }, error = function(e) {
        log_progress("  [WARNING] Could not create all indexes:", conditionMessage(e))
    })
    }
  } else {
    if (isFALSE(use_warehouse)) {
    metric_df <- tibble(
      uid = character(),
        athlete_id = character(),
      owner = character(),
      folder = character(),
      variable = character(),
      source_file = character(),
      source_path = character()
    )
    DBI::dbWriteTable(con, "metrics", metric_df, overwrite = TRUE)
      log_progress("Created empty metrics table")
    } else {
      warehouse_df <- tibble(
        athlete_uuid = character(),
        session_date = as.Date(character()),
        source_system = character(),
        source_athlete_id = character(),
        metric_name = character(),
        frame = integer(),
        value = numeric(),
        created_at = as.POSIXct(character())
      )
    }
  }
  
  # Create index on athletes table (local SQLite only)
  if (isFALSE(use_warehouse) && length(athlete_list) > 0) {
    log_progress("  Creating indexes on athletes table...")
    tryCatch({
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_athletes_uid ON athletes(uid)")
      DBI::dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_athletes_name ON athletes(name)")
      log_progress("  [SUCCESS] Created indexes on athletes table")
    }, error = function(e) {
      log_progress("  [WARNING] Could not create athlete indexes:", conditionMessage(e))
    })
  }
  
  # Close database connection
  log_progress("")
  log_progress("=", rep("=", 60), sep = "")
  log_progress("FINALIZING: Closing database connection...")
  DBI::dbDisconnect(con)
  
  # Get final database info
  use_warehouse_final <- use_warehouse
  
  if (isTRUE(use_warehouse_final)) {
    if (PITCHING_VERBOSE) {
      cat("\n")
      cat("=", rep("=", 80), "\n", sep = "")
      cat("PROCESSING COMPLETE!\n")
      cat("=", rep("=", 80), "\n", sep = "")
      cat("✓ Database: PostgreSQL warehouse (Neon)\n")
      cat("✓ Athletes stored in: analytics.d_athletes\n")
      cat("✓ Metrics stored in: f_kinematics_pitching\n")
      cat("✓ Total athletes processed:", length(athlete_list), "\n")
      if (exists("warehouse_df") && !is.null(warehouse_df) && nrow(warehouse_df) > 0) {
        cat("✓ Total metric records:", nrow(warehouse_df), "\n")
      } else {
        cat("⚠ Total metric records: 0\n")
      }
      cat("=", rep("=", 80), "\n", sep = "")
    }
    log_progress("")
    log_progress("PROCESSING COMPLETE!")
    log_progress("Total athletes processed:", length(athlete_list))
    if (exists("warehouse_df") && !is.null(warehouse_df) && nrow(warehouse_df) > 0) {
      log_progress("Total metric records:", nrow(warehouse_df))
    } else {
      log_progress("Total metric records: 0")
    }
  } else {
    db_size <- if (file.exists(DB_FILE)) file.info(DB_FILE)$size else 0
    if (PITCHING_VERBOSE) {
      cat("\n")
      cat("=", rep("=", 80), "\n", sep = "")
      cat("⚠ PROCESSING COMPLETE - BUT DATA WENT TO LOCAL DATABASE! ⚠\n")
      cat("=", rep("=", 80), "\n", sep = "")
      cat("⚠ Database: LOCAL SQLite (NOT Neon warehouse!)\n")
      cat("⚠ Database file:", DB_FILE, "\n")
      cat("⚠ Total athletes:", length(athlete_list), "\n")
      if (exists("metric_df") && !is.null(metric_df) && nrow(metric_df) > 0) {
        cat("⚠ Total metric records:", nrow(metric_df), "\n")
      }
      cat("=", rep("=", 80), "\n", sep = "")
    }
    log_progress("PROCESSING COMPLETE (local SQLite)")
    log_progress("Total athletes:", length(athlete_list))
    if (exists("metric_df") && !is.null(metric_df) && nrow(metric_df) > 0) {
      log_progress("Total metric records:", nrow(metric_df))
    } else {
      log_progress("Total metric records: 0")
    }
  }
  rows_uploaded <- 0L
  if (isTRUE(use_warehouse_final) && exists("warehouse_df") && !is.null(warehouse_df) && nrow(warehouse_df) > 0)
    rows_uploaded <- nrow(warehouse_df)
  if (isFALSE(use_warehouse_final) && exists("metric_df") && !is.null(metric_df) && nrow(metric_df) > 0)
    rows_uploaded <- nrow(metric_df)
  return(invisible(list(rows_uploaded = rows_uploaded)))
}

# ---------- Auto-run (only if not sourced from main.R) ----------
# Check if this script is being run directly (not sourced)
if (!exists("MAIN_R_SOURCING", envir = .GlobalEnv)) {
  cat("\n")
  cat("=", rep("=", 80), "\n", sep = "")
  cat("*** VERSION 2.0 - UUID MATCHING ENABLED ***\n")
  cat("=", rep("=", 80), "\n", sep = "")
  cat("\n")
  
  log_progress("=", rep("=", 60), sep = "")
  log_progress("STARTING PITCHING DATA EXTRACTION - VERSION WITH UUID MATCHING")
  log_progress("=", rep("=", 60), sep = "")
  log_progress("Database file:", DB_FILE)
  log_progress("Data root:", if (is.null(DATA_ROOT)) "Current directory (Pitching folder)" else DATA_ROOT)
  log_progress("Working directory:", getwd())
  log_progress("")
  
  start_time <- Sys.time()
  
  tryCatch({
    process_all_files()
    end_time <- Sys.time()
    duration <- difftime(end_time, start_time, units = "secs")
    log_progress("")
    log_progress("=", rep("=", 60), sep = "")
    log_progress("TOTAL PROCESSING TIME:", round(duration, 2), "seconds (", round(duration / 60, 2), "minutes)")
    log_progress("=", rep("=", 60), sep = "")
  }, error = function(e) {
    end_time <- Sys.time()
    duration <- difftime(end_time, start_time, units = "secs")
    log_progress("")
    log_progress("=", rep("=", 60), sep = "")
    log_progress("ERROR during processing (after", round(duration, 2), "seconds):")
    log_progress(conditionMessage(e))
    log_progress("=", rep("=", 60), sep = "")
    traceback()
  })
}

