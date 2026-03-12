# Main entry point for Hitting Data Processing
# Prompts user to select a folder and processes all data within that folder

# Load tcltk for folder selection dialog (only when running interactively)
.use_gui <- is.na(Sys.getenv("HITTING_DATA_DIR", unset = NA))
if (.use_gui) {
  if (!requireNamespace("tcltk", quietly = TRUE)) {
    stop("tcltk package is required for interactive mode. Set HITTING_DATA_DIR env var to skip the dialog.")
  }
  library(tcltk)
}

# Source the processing script
# Try multiple paths to find hitting_processing.R
processing_script_paths <- c(
  file.path(getwd(), "hitting_processing.R"),
  file.path(getwd(), "R", "hitting", "hitting_processing.R"),
  file.path("..", "hitting", "hitting_processing.R"),
  file.path(dirname(getwd()), "R", "hitting", "hitting_processing.R")
)

processing_script <- NULL
for (path in processing_script_paths) {
  if (file.exists(path)) {
    processing_script <- normalizePath(path)
    break
  }
}

if (is.null(processing_script)) {
  stop("Could not find hitting_processing.R. Please run from R/hitting directory or project root.")
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
  Sys.getenv("HITTING_DATA_DIR", unset = "D:/Hitting/Data")
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
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("HITTING DATA PROCESSING\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("\n")
cat("Please select a folder containing hitting data to process.\n")
cat("Default folder:", default_data_root, "\n")
cat("\n")

# Use HITTING_DATA_DIR env var (cloud/headless) or tcltk dialog (interactive)
env_dir <- Sys.getenv("HITTING_DATA_DIR", unset = NA)
if (!is.na(env_dir) && dir.exists(env_dir)) {
  cat("Using data directory from HITTING_DATA_DIR:", env_dir, "\n")
  selected_folder <- env_dir
} else if (!is.na(env_dir)) {
  stop("HITTING_DATA_DIR is set but directory does not exist: ", env_dir)
} else {
  selected_folder <- tryCatch({
    tcltk::tk_choose.dir(
      default = initial_dir,
      caption = "Select Hitting Data Folder"
    )
  }, error = function(e) {
    cat("Error opening folder dialog:", conditionMessage(e), "\n")
    cat("Falling back to default folder:", default_data_root, "\n")
    if (dir.exists(default_data_root)) {
      return(default_data_root)
    } else {
      stop("Could not select folder and default folder does not exist.")
    }
  })
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

# Verify folder exists and is accessible
if (!dir.exists(selected_folder)) {
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
# Note: The processing script will search recursively within this folder
# but will only process files within the selected folder and its subfolders
cat("\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("Starting processing...\n")
cat("=", rep("=", 80), "\n", sep = "")
cat("\n")

start_time <- Sys.time()

tryCatch({
  # Call process_all_files with the selected folder
  # This will process all data within the selected folder (recursively)
  process_all_files(data_root = selected_folder)
  
  end_time <- Sys.time()
  duration <- difftime(end_time, start_time, units = "secs")
  
  cat("\n")
  cat("=", rep("=", 80), "\n", sep = "")
  cat("PROCESSING COMPLETE!\n")
  cat("=", rep("=", 80), "\n", sep = "")
  cat("Total processing time:", round(duration, 2), "seconds (", round(duration / 60, 2), "minutes)\n")
  cat("=", rep("=", 80), "\n", sep = "")
  
}, error = function(e) {
  end_time <- Sys.time()
  duration <- difftime(end_time, start_time, units = "secs")
  
  cat("\n")
  cat("=", rep("=", 80), "\n", sep = "")
  cat("ERROR during processing (after", round(duration, 2), "seconds):\n")
  cat(conditionMessage(e), "\n")
  cat("=", rep("=", 80), "\n", sep = "")
  traceback()
  stop("Processing failed")
})

