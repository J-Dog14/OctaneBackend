# Height/weight unit conversion for UAIS warehouse
# All stored height/weight in d_athletes and fact tables are in inches and pounds.
# Octane Pitching/Hitting session XML provides meters and kg; convert at ingestion.

METERS_TO_INCHES <- 39.3701
KG_TO_LBS <- 2.2046226

#' Convert height from meters to inches
#' @param h_m Height in meters (numeric or NA)
#' @return Height in inches, or NA_real_ if input is NA or <= 0
meters_to_inches <- function(h_m) {
  if (is.na(h_m) || h_m <= 0) return(NA_real_)
  h_m * METERS_TO_INCHES
}

#' Convert weight from kg to pounds
#' @param w_kg Weight in kg (numeric or NA)
#' @return Weight in pounds, or NA_real_ if input is NA or <= 0
kg_to_lbs <- function(w_kg) {
  if (is.na(w_kg) || w_kg <= 0) return(NA_real_)
  w_kg * KG_TO_LBS
}

#' Convert weight from pounds to kg (e.g. for scoring formulas that expect kg)
#' @param w_lb Weight in pounds
#' @return Weight in kg, or NA_real_ if input is NA or <= 0
lbs_to_kg <- function(w_lb) {
  if (is.na(w_lb) || w_lb <= 0) return(NA_real_)
  w_lb / KG_TO_LBS
}

#' Convert height and weight from m/kg to in/lb (for session XML)
#' @param height_m Height in meters
#' @param weight_kg Weight in kg
#' @return list with height_in, weight_lb (both may be NA_real_)
session_height_weight_to_in_lb <- function(height_m, weight_kg) {
  list(
    height_in = meters_to_inches(height_m),
    weight_lb = kg_to_lbs(weight_kg)
  )
}
