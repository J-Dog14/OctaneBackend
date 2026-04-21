# Main entry point for Hitting Data Processing
# Always shows a folder selection dialog so the user picks the exact session
# subfolder. HITTING_DATA_DIR (if set) is used as the dialog starting point,
# never as an automatic bypass.

if (!requireNamespace("tcltk", quietly = TRUE)) {
  stop("tcltk package is required for folder selection. Please install it.")
}
library(tcltk)

# Source the processing script
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
  stop(paste(
    "Could not find hitting_processing.R.",
    "Please run from R/hitting directory or project root."
  ))
}

# Set flag so hitting_processing.R does not auto-run when sourced
assign("MAIN_R_SOURCING", TRUE, envir = .GlobalEnv)
source(processing_script)

# Determine the dialog starting directory:
#   1. HITTING_DATA_DIR env var (if set and exists)
#   2. DATA_ROOT loaded from the processing script
#   3. Fallback to cwd
env_dir <- Sys.getenv("HITTING_DATA_DIR", unset = NA)
default_data_root <- if (!is.na(env_dir) && dir.exists(env_dir)) {
  env_dir
} else if (exists("DATA_ROOT") && !is.null(DATA_ROOT)) {
  DATA_ROOT
} else {
  Sys.getenv("HITTING_DATA_DIR", unset = "D:/Hitting/Data")
}

initial_dir <- default_data_root
if (!dir.exists(initial_dir)) {
  parent_dir <- dirname(initial_dir)
  initial_dir <- if (dir.exists(parent_dir)) parent_dir else getwd()
}

cat("HITTING DATA PROCESSING\n")
cat("Select the session folder to process.\n")

# Always show dialog — user must pick the specific session subfolder
selected_folder <- tryCatch({
  tcltk::tk_choose.dir(
    default = initial_dir,
    caption = "Select Hitting Session Folder"
  )
}, error = function(e) {
  cat("Error opening folder dialog:", conditionMessage(e), "\n")
  NULL
})

if (is.null(selected_folder) ||
    length(selected_folder) == 0 ||
    is.na(selected_folder) ||
    selected_folder == "") {
  cat("No folder selected. Exiting.\n")
  quit(save = "no", status = 0)
}

selected_folder <- normalizePath(selected_folder, winslash = "/",
                                 mustWork = FALSE)

if (!dir.exists(selected_folder)) {
  stop("Selected folder does not exist: ", selected_folder)
}

cat("Selected folder:", selected_folder, "\n")

start_time <- Sys.time()

tryCatch({
  process_all_files(data_root = selected_folder)

  duration <- difftime(Sys.time(), start_time, units = "secs")
  cat("Processing complete:", round(duration, 1), "seconds\n")

}, error = function(e) {
  duration <- difftime(Sys.time(), start_time, units = "secs")
  cat("ERROR after", round(duration, 1), "seconds:", conditionMessage(e), "\n")
  stop("Processing failed")
})
