# ============================================
# Extract raw ID/Name/DOB/Height/Weight + ALL single-frame metrics,
# then collapse to ONE ROW PER ATHLETE by combining duplicates.
# No conversions; values are kept exactly as in XML.
#
# Set your working directory first, e.g.:
# setwd("~/Desktop/Fall 2025 8ctane Internship/Hitting Data/xml Data")
# ============================================

#installing and library packages

library(xml2)
library(purrr)
library(dplyr)
library(readr)
library(stringr)
library(tibble)

#We first need to find all the xml files and get the paths so we can set up for looping.

#getwd is the function to get the value of the working directory that is the xml data. 
#Root is now the value of the working directory.
root <- getwd()
#checking if directory exists. Should always be true, otherwise stop
stopifnot(dir.exists(root))

#Building a list of every XML file under the root folder. 
#This is so we can collect the paths of all of the folders.
all_xmls <- list.files(
  #root is the working directory
  root,
  #This ignores case sensitivity with xml and collects all xml files (including .xml.gz).
  pattern   = "(?i)\\.xml(\\.gz)?$",
  #recursive walks through every subfolder
  recursive = TRUE,
  #This controls the path we get back (TRUE = full path, FALSE = just filename)
  full.names = TRUE
)

#This counts how many files we have. 
#For hitting data it says there are 114 xml files. 
#The cat prints the code to text so it says "Found 114 xml files."
cat("Found", length(all_xmls), "XML files\n")
#if statement that sees if the length is 0 and stops running if it is 0. 
if (!length(all_xmls)) stop("No XML files found. Check your working directory and folder names.")

#Creates a new function that looks at doc which is the XML document, 
#xpath which is the path to the file.
xtext <- function(doc, xpath, ns = NULL) {
  #this finds the first xml node that matches the xpath
  node <- xml_find_first(doc, xpath, ns = ns)
  #if there are no matches it returns NA 
  if (length(node) == 0) return(NA_character_)
  #returns the text content of the node
  xml_text(node)
}

# Safe attribute extractor (same spirit as xtext)
#Creates a new function that looks at doc which is the XML document,
#xpath which is the path to the node, and attr which is the attribute name.
xattr <- function(doc, xpath, attr, ns = NULL) {
  node <- xml_find_first(doc, xpath, ns = ns)
  if (length(node) == 0) return(NA_character_)
  val <- xml_attr(node, attr)
  if (is.na(val)) NA_character_ else val
}

# player folder name = first directory after ".../xml Data/"
get_player_raw <- function(path) {
  m <- regexec(".*/[Xx][Mm][Ll][ ]+[Dd]ata/([^/]+)/", path)
  hit <- regmatches(path, m)
  if (length(hit) && length(hit[[1]]) >= 2) hit[[1]][2] else NA_character_
}

#This removes trailing date-like suffixes and extra spaces from player folder names.
clean_player <- function(s) {
  ifelse(
    is.na(s),
    NA_character_,
    stringr::str_squish(stringr::str_replace(s, "[ ]?\\d{2}[–-]\\d{2}$", ""))
  )
}

#This helper function takes a full file path and removes the root prefix from it. This is better for traceability
#defines a function called relpath_of. Takes inputs of path and root
relpath_of <- function(path, root) {
  #Coverts root to a clean path with forward slashes
  sub(paste0("^", normalizePath(root, winslash = "/", mustWork = TRUE), "/?"),
      "",
      normalizePath(path, winslash = "/", mustWork = FALSE))
}

# Helper: safe default operator for NULLs
`%||%` <- function(a, b) if (!is.null(a)) a else b

# Make safe column names from metric labels (e.g., "Pelvis_Angle@Setup" -> "Pelvis_Angle_at_Setup")
safe_metric_name <- function(s) {
  s %>%
    stringr::str_replace_all("@", "_at_") %>%
    stringr::str_replace_all("[^A-Za-z0-9]+", "_") %>%
    stringr::str_replace_all("^_+|_+$", "")
}

# Extract ALL metrics where component frames="1" (skip long time series)
# We keep the raw @data string exactly as-is.
extract_metrics <- function(doc) {
  out <- list()
  # find every <name value="..."> node anywhere
  nm_nodes <- xml_find_all(doc, ".//name[@value]")
  if (length(nm_nodes) == 0) return(out)
  
  for (nd in nm_nodes) {
    base <- xml_attr(nd, "value")
    if (is.na(base) || !nzchar(base)) next
    base_clean <- safe_metric_name(base)
    
    comps <- xml_find_all(nd, "./component")
    if (length(comps) == 0) next
    
    # for each axis component (X/Y/Z or VAL), keep the FIRST frames=1 value we see
    for (cp in comps) {
      frames <- xml_attr(cp, "frames")
      if (!is.na(frames) && frames != "1") next  # skip long series
      axis <- xml_attr(cp, "value")
      if (is.na(axis) || !nzchar(axis)) axis <- "VAL"
      key <- paste0(base_clean, "_", toupper(axis))
      if (is.null(out[[key]]) || is.na(out[[key]])) {
        out[[key]] <- xml_attr(cp, "data") %||% NA_character_
      }
    }
  }
  out
}

# ---- Core builder function ----
#We want a function that looks through every folder and extracts the necessary values
#and builds a dataset matching all of them for us.
#
# 'fields' is a named list describing what to extract. Each element can be either:
#  1) a character XPath (extracts node text), e.g. ".//Game/Date"
#  2) a list(xpath = "...", attr = "name") to extract an attribute instead of text
build_hitting_dataset <- function(root = getwd(),
                                  only_in_bhs = TRUE,
                                  fields,
                                  out_csv = NULL) {
  #checking if directory exists. Should always be true, otherwise stop
  stopifnot(dir.exists(root))
  
  #Building a list of every XML file under the root folder.
  #This is so we can collect the paths of all of the folders.
  all_xmls <- list.files(
    #root is the working directory
    root,
    #This ignores case sensitivity with xml and collects all xml files (including .xml.gz).
    pattern   = "(?i)\\.xml(\\.gz)?$",
    #recursive walks through every subfolder
    recursive = TRUE,
    #This controls the path we get back (TRUE = full path, FALSE = just filename)
    full.names = TRUE
  )
  
  # Option to keep only files inside ".../Baseball Hitting Sports/" folders
  files <- if (isTRUE(only_in_bhs)) {
    all_xmls[stringr::str_detect(all_xmls, "(?i)/Baseball Hitting Sports/")]
  } else {
    all_xmls
  }
  
  #This counts how many files we have.
  #The cat prints the code to text so it says "Found X xml files."
  cat("Found", length(files), "XML files\n")
  #if statement that sees if the length is 0 and stops running if it is 0.
  if (!length(files)) stop("No XML files found. Check your working directory and folder names.")
  
  #Creates an inner function that reads one XML and extracts requested fields.
  extract_one <- function(path) {
    # doc is the XML document we parse from the file path.
    doc <- xml2::read_xml(path)
    # Namespaces if your XML uses prefixes (passed into xtext/xattr via ns)
    ns  <- tryCatch(xml2::xml_ns(doc), error = function(e) NULL)
    
    # Build a named list of extracted values following 'fields' spec
    vals <- lapply(fields, function(spec) {
      if (is.character(spec)) {
        # Node text via XPath
        xtext(doc, spec, ns = ns)
      } else if (is.list(spec) && !is.null(spec$xpath) && !is.null(spec$attr)) {
        # Attribute value via XPath + attr
        xattr(doc, spec$xpath, spec$attr, ns = ns)
      } else {
        NA_character_
      }
    })
    names(vals) <- names(fields)
    
    # Pull ALL single-frame metrics (raw strings)
    metrics <- extract_metrics(doc)
    
    # player folder name = first directory after ".../xml Data/"
    player_raw <- get_player_raw(path)
    
    # Return a tidy row for this file
    tibble(
      player_raw = player_raw,
      player     = clean_player(player_raw),
      file       = basename(path),
      relpath    = relpath_of(path, root),
      !!!vals,
      !!!metrics
    )
  }
  
  # Map over every XML file and row-bind results into a dataset
  result <- purrr::map_dfr(files, extract_one)
  
  # Optionally save to CSV
  if (!is.null(out_csv)) {
    readr::write_csv(result, out_csv)
    cat("Wrote", nrow(result), "rows to", out_csv, "\n")
  }
  
  # Return the dataset to the caller
  result
}

# ---- Example fields spec for your desired tag values ----
#This is where you define exactly which values you want from each XML file.
#We target direct tags and keep series fallbacks. No parsing or unit conversion.

# Fields: use direct tags; include raw series fallbacks (no parsing)
fields_spec <- list(
  id_tag            = ".//ID[1]",
  name_tag          = ".//Name[1]",
  date_of_birth_tag = ".//Date_of_birth[1]",
  height_tag        = ".//Height[1]",
  weight_tag        = ".//Weight[1]",
  
  # Fallbacks (raw strings) if tags are absent
  id_owner      = list(xpath = ".//owner[1]",  attr = "value"),
  height_series = list(xpath = "//*[translate(@value,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='height']/following::component[1]",
                       attr  = "data"),
  weight_series = list(xpath = "//*[translate(@value,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='weight']/following::component[1]",
                       attr  = "data")
)

#Then build your dataset (and optionally write it to CSV):
ds_raw <- build_hitting_dataset(
  root = root,                 # uses your current working directory you set earlier
  only_in_bhs = TRUE,          # set to FALSE to include all XMLs under xml Data
  fields = fields_spec,
  out_csv = NULL               # or "extracted_values.csv" to save
)

# Final table: choose raw tag text first, else raw series text (no conversions)
ds <- ds_raw %>%
  mutate(
    id            = coalesce(id_tag, id_owner),
    name          = name_tag,
    date_of_birth = date_of_birth_tag,
    height        = coalesce(height_tag,  height_series),
    weight        = coalesce(weight_tag,  weight_series)
  ) %>%
  # drop intermediate tag/fallback columns; keep raw metrics and context
  select(
    player_raw, player, id, name, date_of_birth, height, weight, file, relpath,
    -all_of(c("id_tag","name_tag","date_of_birth_tag","height_tag","weight_tag",
              "id_owner","height_series","weight_series")),
    everything()
  )

# --- Collapse to ONE ROW PER ATHLETE (combine duplicates) ---
# Prefer core fields from session.xml; prefer metrics from session_data.xml
pick_from <- function(x, file, prefer_file) {
  pr  <- ifelse(file == prefer_file, 0, 1)
  ord <- order(pr, is.na(x))
  xo  <- x[ord]
  idx <- which(!is.na(xo))
  if (length(idx)) xo[idx[1]] else NA
}

# Define which columns are "core" vs "metrics"
core_cols   <- intersect(c("id","name","date_of_birth","height","weight"), names(ds))
drop_cols   <- c("player_raw","file","relpath", core_cols)
metric_cols <- setdiff(names(ds), c("player", drop_cols))

# Build one row per athlete (group by cleaned player name)
athletes_one_row <- ds %>%
  group_by(player) %>%
  summarise(
    # Core fields: prefer values from session.xml
    across(all_of(core_cols),   ~ pick_from(.x, file, "session.xml")),
    # Metrics: prefer values from session_data.xml
    across(all_of(metric_cols), ~ pick_from(.x, file, "session_data.xml")),
    .groups = "drop"
  )

# Print results
print(ds, n = 50, width = Inf)
cat("\n---- ONE ROW PER ATHLETE (merged) ----\n")
print(athletes_one_row, n = Inf, width = Inf)

# Optional: write CSVs
readr::write_csv(athletes_one_row, "athlete_mapping.csv")
# readr::write_csv(athletes_one_row, "players_one_row_merged_raw.csv")
