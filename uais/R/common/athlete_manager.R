# Athlete Manager for R
# Wrapper around Python athlete_manager module
# Provides R functions to interact with centralized athlete database

#' Get or create athlete UUID
#'
#' This function calls the Python athlete_manager module to get or create
#' an athlete UUID in the warehouse database.
#'
#' @param name Full name (e.g., "Weiss, Ryan 11-25")
#' @param date_of_birth Date of birth (YYYY-MM-DD), optional
#' @param age Age, optional
#' @param age_at_collection Age at time of data collection, optional
#' @param gender Gender, optional
#' @param height Height, optional
#' @param weight Weight, optional
#' @param email Email, optional
#' @param phone Phone, optional
#' @param notes Notes, optional
#' @param source_system Source system (e.g., "pitching", "hitting"), optional
#' @param source_athlete_id Original ID from source system, optional
#' @param check_app_db Whether to check app database for UUID (default: TRUE)
#'
#' @return athlete_uuid (character string)
#'
#' @examples
#' uuid <- get_or_create_athlete(
#'   name = "Weiss, Ryan 11-25",
#'   date_of_birth = "1996-12-10",
#'   age = 28,
#'   source_system = "pitching"
#' )
get_or_create_athlete <- function(
  name,
  date_of_birth = NULL,
  age = NULL,
  age_at_collection = NULL,
  gender = NULL,
  height = NULL,
  weight = NULL,
  email = NULL,
  phone = NULL,
  notes = NULL,
  source_system = NULL,
  source_athlete_id = NULL,
  check_app_db = TRUE
) {
  # Check if jsonlite is available
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("jsonlite package is required. Install with: install.packages('jsonlite')")
  }
  
  # Find project root (assume we're in R/ subdirectory or project root)
  project_root <- if (file.exists("python/common/athlete_manager.py")) {
    getwd()
  } else if (file.exists("../python/common/athlete_manager.py")) {
    normalizePath("..")
  } else if (file.exists("../../python/common/athlete_manager.py")) {
    normalizePath("../..")
  } else {
    stop("Could not find python/common/athlete_manager.py. Please run from project root or R/ subdirectory.")
  }
  
  # Build Python command arguments
  args <- list(
    name = name,
    date_of_birth = date_of_birth,
    age = age,
    age_at_collection = age_at_collection,
    gender = gender,
    height = height,
    weight = weight,
    email = email,
    phone = phone,
    notes = notes,
    source_system = source_system,
    source_athlete_id = source_athlete_id,
    check_app_db = check_app_db
  )
  
  # Remove NULL values
  args <- args[!sapply(args, is.null)]
  
  # Convert to JSON for Python
  json_args <- jsonlite::toJSON(args, auto_unbox = TRUE)
  
  # Create temporary Python script
  temp_script <- tempfile(fileext = ".py")
  python_code <- sprintf('
import sys
import json
from pathlib import Path

# Add project root to path
project_root = Path(r"%s")
sys.path.insert(0, str(project_root))

import logging
# Redirect logging to stderr so it does not interfere with stdout
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%%(levelname)s:%%(name)s:%%(message)s")

from python.common.athlete_manager import get_or_create_athlete

args = json.loads(r"""%s""")
try:
    uuid = get_or_create_athlete(**args)
    # Print only the UUID to stdout (no log messages)
    print(uuid)
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
', project_root, json_args)
  
  writeLines(python_code, temp_script)
  
  # Execute Python script
  result <- tryCatch({
    system2(
      "python",
      args = c(temp_script),
      stdout = TRUE,
      stderr = TRUE
    )
  }, finally = {
    # Clean up temp file
    if (file.exists(temp_script)) {
      unlink(temp_script)
    }
  })
  
  # Check for errors
  if (any(grepl("ERROR:", result))) {
    stop(paste(result, collapse = "\n"))
  }
  
  # Filter out log messages and extract UUID
  # UUID format: 8-4-4-4-12 hex digits (e.g., "f1aa4ceb-1745-46eb-9aa4-42af1fd28d47")
  uuid_pattern <- "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
  
  # Find lines that contain UUIDs
  uuid_lines <- grep(uuid_pattern, result, ignore.case = TRUE, value = TRUE)
  
  if (length(uuid_lines) > 0) {
    # Extract UUID from the last line (should be the actual print(uuid) output)
    # Look for standalone UUID or UUID in parentheses
    last_line <- uuid_lines[length(uuid_lines)]
    
    # Try to extract UUID from the line
    uuid_match <- regmatches(last_line, regexpr(uuid_pattern, last_line, ignore.case = TRUE))
    
    if (length(uuid_match) > 0) {
      return(trimws(uuid_match[1]))
    }
  }
  
  # Fallback: look for any line that's just a UUID (no other text)
  for (line in rev(result)) {
    trimmed <- trimws(line)
    if (grepl(paste0("^", uuid_pattern, "$"), trimmed, ignore.case = TRUE)) {
      return(trimmed)
    }
  }
  
  # If we still can't find it, return error
  stop("Failed to extract athlete UUID from Python output. Output: ", paste(result, collapse = "\n"))
}

#' Normalize name for matching
#'
#' Converts "LAST, FIRST" to "FIRST LAST", removes dates, converts to uppercase.
#'
#' @param name Original name
#'
#' @return Normalized name
normalize_name_for_matching <- function(name) {
  if (is.na(name) || name == "") return(NA_character_)
  
  # Remove dates (various formats)
  # Full dates: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, etc.
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}", "", name)
  name <- gsub("\\s*\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}", "", name)
  # Month-day only: MM-DD, MM/DD (e.g., "11-25", "10-24")
  # Match pattern that ends with word boundary or end of string
  name <- gsub("\\s*\\d{1,2}[/-]\\d{1,2}(?=\\s|$)", "", name, perl = TRUE)
  # Standalone years
  name <- gsub("\\s*\\d{4}", "", name)
  name <- trimws(name)
  
  # Convert "LAST, FIRST" or "LAST. FIRST" (typo) to "FIRST LAST"
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
  
  # Normalize whitespace and convert to uppercase
  name <- toupper(gsub("\\s+", " ", trimws(name)))
  
  return(name)
}

#' Check for duplicate athletes and prompt to merge
#'
#' This function calls the Python duplicate_detector module to check for
#' similar athlete names and prompt to merge them interactively.
#'
#' @param athlete_uuids Optional list of athlete UUIDs to check (if NULL, checks all)
#' @param min_similarity Minimum similarity score (0.0 to 1.0) to consider a match (default: 0.80)
#' @param auto_skip If TRUE, skip all matches automatically (useful for non-interactive mode)
#'
#' @return List with summary statistics (matches_found, merged, skipped)
#'
#' @examples
#' # Check specific athletes
#' result <- check_and_merge_duplicates(athlete_uuids = c("uuid1", "uuid2"))
#'
#' # Check all athletes
#' result <- check_and_merge_duplicates()
check_and_merge_duplicates <- function(
  athlete_uuids = NULL,
  min_similarity = 0.80,
  auto_skip = FALSE
) {
  # Find project root (assume we're in R/ subdirectory or project root)
  project_root <- if (file.exists("python/common/duplicate_detector.py")) {
    getwd()
  } else if (file.exists("../python/common/duplicate_detector.py")) {
    normalizePath("..")
  } else if (file.exists("../../python/common/duplicate_detector.py")) {
    normalizePath("../..")
  } else {
    stop("Could not find python/common/duplicate_detector.py. Please run from project root or R/ subdirectory.")
  }
  
  # Build Python command arguments
  args_list <- list(
    min_similarity = min_similarity,
    auto_skip = auto_skip
  )
  
  # Add athlete_uuids if provided
  if (!is.null(athlete_uuids) && length(athlete_uuids) > 0) {
    args_list$athlete_uuids <- athlete_uuids
  }
  
  # Convert to JSON for Python
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("jsonlite package is required. Install with: install.packages('jsonlite')")
  }
  json_args <- jsonlite::toJSON(args_list, auto_unbox = TRUE)
  
  # Create temporary Python script
  temp_script <- tempfile(fileext = ".py")
  python_code <- sprintf('
import sys
import json
from pathlib import Path

# Add project root to path
project_root = Path(r"%s")
sys.path.insert(0, str(project_root))

import logging
# Redirect logging to stderr so it does not interfere with stdout
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%%(levelname)s:%%(name)s:%%(message)s")

from python.common.duplicate_detector import check_and_merge_duplicates
from python.common.athlete_manager import get_warehouse_connection

args = json.loads(r"""%s""")
try:
    conn = get_warehouse_connection()
    result = check_and_merge_duplicates(conn=conn, **args)
    conn.close()
    # Print result as JSON to stdout
    print(json.dumps(result))
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
', project_root, json_args)
  
  writeLines(python_code, temp_script)
  
  # Execute Python script
  result <- tryCatch({
    system2(
      "python",
      args = c(temp_script),
      stdout = TRUE,
      stderr = TRUE
    )
  }, finally = {
    # Clean up temp file
    if (file.exists(temp_script)) {
      unlink(temp_script)
    }
  })
  
  # Check for errors
  if (any(grepl("ERROR:", result))) {
    warning(paste(result, collapse = "\n"))
    return(list(
      matches_found = 0,
      merged = 0,
      skipped = 0,
      error = TRUE
    ))
  }
  
  # Try to parse JSON result from stdout
  # Filter out log messages (they go to stderr, but sometimes appear in stdout)
  json_lines <- grep("^\\{", result, value = TRUE)
  if (length(json_lines) > 0) {
    tryCatch({
      result_json <- jsonlite::fromJSON(json_lines[length(json_lines)])
      return(result_json)
    }, error = function(e) {
      # If JSON parsing fails, return default structure
      return(list(
        matches_found = 0,
        merged = 0,
        skipped = 0,
        error = TRUE
      ))
    })
  }
  
  # If no JSON found, return default structure
  return(list(
    matches_found = 0,
    merged = 0,
    skipped = 0,
    error = FALSE
  ))
}

