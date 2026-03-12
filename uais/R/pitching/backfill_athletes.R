# Quick script to backfill athletes from session.xml files
# This only processes athlete info, not metric data, so it's much faster

# ==== Minimal deps ====
library(xml2)
library(dplyr)
library(tibble)
library(stringr)
library(readr)

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
    cat("Loaded athlete_manager.R from:", path, "\n")
    break
  }
}
if (!athlete_manager_loaded) {
  stop("Could not find athlete_manager.R")
}

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
DATA_ROOT <- Sys.getenv("PITCHING_DATA_DIR", unset = "H:/Pitching/Data")  # Set to your pitching data directory path

# ---------- Main processing ----------
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** ATHLETE BACKFILL SCRIPT ***\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("\n")

log_progress("Scanning for session.xml files in:", DATA_ROOT)

# Find all session.xml files
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
cat("\n")

# Process each file
total_files <- length(session_files)
success_count <- 0
error_count <- 0
skipped_count <- 0

for (i in seq_along(session_files)) {
  sf <- session_files[i]
  
  if (i %% 10 == 0 || i <= 5) {
    log_progress("[", i, "/", total_files, "] Processing:", basename(sf))
  }
  
  athlete_info <- extract_athlete_info(sf)
  
  if (is.null(athlete_info) || nrow(athlete_info) == 0) {
    skipped_count <- skipped_count + 1
    if (i <= 5) {
      log_progress("  [SKIPPED] Could not extract athlete info")
    }
    next
  }
  
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
  if (exists("get_or_create_athlete")) {
    tryCatch({
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
      success_count <- success_count + 1
      if (i <= 5 || i %% 50 == 0) {
        log_progress("  [SUCCESS] Got/created athlete UUID for", athlete_name, ":", athlete_uuid)
      }
    }, error = function(e) {
      error_count <- error_count + 1
      if (i <= 5 || error_count <= 10) {
        log_progress("  [ERROR] Failed to get/create athlete for", athlete_name, ":", conditionMessage(e))
      }
    })
  } else {
    stop("get_or_create_athlete function not found!")
  }
}

# Summary
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("*** BACKFILL COMPLETE ***\n")
cat("=", rep("=", 80), "\n", sep = "")
log_progress("Total files processed:", total_files)
log_progress("Successfully created/updated:", success_count)
log_progress("Errors:", error_count)
log_progress("Skipped (no data):", skipped_count)
cat("\n")

