# Main entry point for Pitching Data Processing
# Prompts user to select a folder and processes all data within that folder

# Load tcltk for folder selection dialog
if (!requireNamespace("tcltk", quietly = TRUE)) {
  stop("tcltk package is required. Install with: install.packages('tcltk')")
}
library(tcltk)

# Source the processing script
# Try multiple paths to find pitching_processing.R
processing_script_paths <- c(
  file.path(getwd(), "pitching_processing.R"),
  file.path(getwd(), "R", "pitching", "pitching_processing.R"),
  file.path("..", "pitching", "pitching_processing.R"),
  file.path(dirname(getwd()), "R", "pitching", "pitching_processing.R")
)

processing_script <- NULL
for (path in processing_script_paths) {
  if (file.exists(path)) {
    processing_script <- normalizePath(path)
    break
  }
}

if (is.null(processing_script)) {
  stop("Could not find pitching_processing.R. Please run from R/pitching directory or project root.")
}

# Set flag to indicate we're sourcing from main.R (prevents auto-run)
assign("MAIN_R_SOURCING", TRUE, envir = .GlobalEnv)

# Source the processing script (this loads all functions and sets up configuration)
source(processing_script)

# Get the default DATA_ROOT from the sourced script
default_data_root <- if (exists("DATA_ROOT") && !is.null(DATA_ROOT)) {
  DATA_ROOT
} else {
  # Fallback to common default from environment variable
  Sys.getenv("PITCHING_DATA_DIR", unset = "H:/Pitching/Data")
}

# Check if default directory exists, if not use parent or current directory
initial_dir <- default_data_root
if (!dir.exists(initial_dir)) {
  # Try parent directory
  parent_dir <- dirname(initial_dir)
  if (dir.exists(parent_dir)) {
    initial_dir <- parent_dir
  } else {
    initial_dir <- getwd()
  }
}

# Use PITCHING_DATA_DIR (from env or settings) as the starting directory for the dialog
env_dir <- Sys.getenv("PITCHING_DATA_DIR", unset = NA)
if (!is.na(env_dir) && dir.exists(env_dir)) {
  initial_dir <- env_dir
}

# Always prompt via tcltk dialog
cat("\nPITCHING DATA PROCESSING\n\n")
cat("Please select a folder containing pitching data to process.\n")
cat("Starting at:", initial_dir, "\n\n")

tryCatch({
  invisible(tcltk::tcl("wm", "attributes", ".", "-topmost", 1))
}, error = function(e) {
  tt <- tcltk::tktoplevel()
  tcltk::tkdestroy(tt)
  invisible(tcltk::tcl("wm", "attributes", ".", "-topmost", 1))
})
selected_folder <- tryCatch({
  tcltk::tk_choose.dir(
    default = initial_dir,
    caption = "Select Pitching Data Folder"
  )
}, error = function(e) {
  tcltk::tcl("wm", "attributes", ".", "-topmost", 0)
  cat("Error opening folder dialog:", conditionMessage(e), "\n")
  cat("Falling back to:", initial_dir, "\n")
  if (dir.exists(initial_dir)) {
    return(initial_dir)
  } else {
    stop("Could not open folder dialog and starting directory does not exist.")
  }
})
tryCatch({ tcltk::tcl("wm", "attributes", ".", "-topmost", 0) }, error = function(e) { invisible(NULL) })

# Check if user cancelled
if (length(selected_folder) == 0 || is.na(selected_folder) || selected_folder == "") {
  cat("\nNo folder selected. Exiting.\n")
  quit(save = "no", status = 0)
}

# Normalize the path
selected_folder <- normalizePath(selected_folder, winslash = "/", mustWork = FALSE)

cat("\n")
cat("Selected folder:", selected_folder, "\n")
cat("\n")

# Verify folder exists and is accessible (isTRUE avoids "missing value where TRUE/FALSE needed" if dir.exists returns NA)
if (!isTRUE(dir.exists(selected_folder))) {
  stop("Selected folder does not exist or is not accessible: ", selected_folder)
}

# Verify folder contains some files
test_files <- tryCatch({
  list.files(selected_folder, recursive = FALSE, full.names = FALSE)
}, error = function(e) {
  stop("Cannot access folder: ", selected_folder, "\nError: ", conditionMessage(e))
})

if (length(test_files) == 0) {
  warning("Selected folder appears to be empty: ", selected_folder)
  response <- readline("Continue anyway? (y/n): ")
  if (tolower(substr(trimws(response), 1, 1)) != "y") {
    cat("Exiting.\n")
    quit(save = "no", status = 0)
  }
}

# Process the selected folder
cat("\nStarting processing...\n\n")
start_time <- Sys.time()

tryCatch({
  result <- process_all_files(data_root = selected_folder)
  end_time <- Sys.time()
  duration <- difftime(end_time, start_time, units = "secs")
  rows_uploaded <- if (is.list(result) && !is.null(result$rows_uploaded)) result$rows_uploaded else 0L
  if (rows_uploaded > 0) {
    cat("Successful run and upload.\n")
  }
  cat("Processing complete. Time:", round(duration, 2), "sec\n")
}, error = function(e) {
  end_time <- Sys.time()
  duration <- difftime(end_time, start_time, units = "secs")
  cat("\nERROR during processing (after", round(duration, 2), "seconds):\n")
  cat(conditionMessage(e), "\n")
  traceback()
  stop("Processing failed")
})

