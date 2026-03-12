#!/usr/bin/env Rscript
# Install all R packages required by UAIS scripts.
# Run during Docker build: Rscript install_packages.R

options(repos = c(CRAN = "https://cloud.r-project.org"))

packages <- c(
  # Core tidyverse (includes dplyr, readr, stringr, tibble, tidyr, purrr)
  "tidyverse",
  # Database
  "DBI",
  "RSQLite",
  "RPostgres",
  # Utilities
  "fs",
  "tools",
  "uuid",
  "xml2",
  "yaml"
  # Note: tcltk is part of base R, no install needed
)

installed <- rownames(installed.packages())
to_install <- packages[!packages %in% installed]

if (length(to_install) > 0) {
  cat("Installing packages:", paste(to_install, collapse = ", "), "\n")
  install.packages(to_install, dependencies = TRUE)
} else {
  cat("All packages already installed.\n")
}

# Verify
missing <- packages[!packages %in% rownames(installed.packages())]
if (length(missing) > 0) {
  stop("Failed to install: ", paste(missing, collapse = ", "))
}
cat("All R packages installed successfully.\n")
