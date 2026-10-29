# Exercise the actual resolution branch from each importer without sourcing its
# database setup or running the ingestion pipeline.
find_resolution <- function(expr) {
  if (missing(expr)) return(NULL)
  if (!is.call(expr) && !is.expression(expr)) return(NULL)
  if (is.call(expr) && identical(expr[[1]], as.name("if")) &&
      identical(paste(deparse(expr[[2]]), collapse = ""), 'exists("get_or_create_athlete")')) return(expr)
  for (child in as.list(expr)) {
    result <- find_resolution(child)
    if (!is.null(result)) return(result)
  }
  NULL
}

for (file in c("uais/R/hitting/hitting_processing.R", "uais/R/pitching/pitching_processing.R")) {
  tree <- parse(file)
  branch <- find_resolution(tree)
  stopifnot(!is.null(branch))
  env <- new.env(parent = globalenv())
  env$USE_WAREHOUSE <- TRUE
  env$athlete_info <- data.frame(age=15, age_at_collection=15, gender="Male", height=70, weight=160, athlete_id="CM")
  env$athlete_name <- "Calvin, Madenspacher"
  env$dob_for_manager <- "2011-05-27"
  env$log_progress <- function(...) NULL
  env$get_or_create_athlete <- function(...) stop("IDENTITY_REVIEW: test conflict")
  failure <- try(eval(branch, envir=env), silent=TRUE)
  stopifnot(inherits(failure, "try-error"), grepl("no fallback identity", as.character(failure)),
            !"uid" %in% names(env$athlete_info))
  env$get_or_create_athlete <- function(...) "existing-canonical-uuid"
  eval(branch, envir=env)
  stopifnot(identical(env$athlete_info$uid, "existing-canonical-uuid"))
  rm("get_or_create_athlete", envir=env)
  failure <- try(eval(branch, envir=env), silent=TRUE)
  stopifnot(inherits(failure, "try-error"), grepl("requires the shared athlete manager", as.character(failure)))
  cat(file, ": failed resolution stops; successful resolution reuses canonical UUID; missing manager stops\n")
}
