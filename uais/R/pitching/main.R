# Main entry point for Pitching Data Processing
# Prompts user to select a folder and processes all data within that folder

# Load tcltk for folder selection dialog (only when running interactively)
.use_gui <- is.na(Sys.getenv("PITCHING_DATA_DIR", unset = NA))
if (.use_gui) {
  if (!requireNamespace("tcltk", quietly = TRUE)) {
    stop("tcltk package is required for interactive mode. Set PITCHING_DATA_DIR env var to skip the dialog.")
  }
  library(tcltk)
}

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

# Prompt user to select a folder
cat("\nPITCHING DATA PROCESSING\n\n")
cat("Please select a folder containing pitching data to process.\n")
cat("Default folder:", default_data_root, "\n")
cat("\n")

# Use PITCHING_DATA_DIR env var (cloud/headless) or tcltk dialog (interactive)
env_dir <- Sys.getenv("PITCHING_DATA_DIR", unset = NA)
if (!is.na(env_dir) && dir.exists(env_dir)) {
  cat("Using data directory from PITCHING_DATA_DIR:", env_dir, "\n")
  selected_folder <- env_dir
} else if (!is.na(env_dir)) {
  stop("PITCHING_DATA_DIR is set but directory does not exist: ", env_dir)
} else {
  # Interactive mode: use tcltk to open folder selection dialog
  tryCatch({
    tcltk::tcl("wm", "attributes", ".", "-topmost", 1)
  }, error = function(e) {
    # Root may not exist yet; one tcltk call creates it
    tt <- tcltk::tktoplevel()
    tcltk::tkdestroy(tt)
    tcltk::tcl("wm", "attributes", ".", "-topmost", 1)
  })
  selected_folder <- tryCatch({
    tcltk::tk_choose.dir(
      default = initial_dir,
      caption = "Select Pitching Data Folder"
    )
  }, error = function(e) {
    tcltk::tcl("wm", "attributes", ".", "-topmost", 0)
    cat("Error opening folder dialog:", conditionMessage(e), "\n")
    cat("Falling back to default folder:", default_data_root, "\n")
    if (dir.exists(default_data_root)) {
      return(default_data_root)
    } else {
      stop("Could not select folder and default folder does not exist.")
    }
  })
  # Clear topmost so the R process doesn't stay on top after dialog closes
  tryCatch({ tcltk::tcl("wm", "attributes", ".", "-topmost", 0) }, error = function(e) { invisible(NULL) })
}

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

