# ============================================================
# ARCHIVED — Pitching Score FORMULA v1
# Archived 2026-09-09, superseded by the 8ctane Delivery Score v2
# (1000 pts: Velocity 500 | Mechanics 400 | Arm Health 100),
# implemented in pitching_processing.R.
#
# v1 was a flat linear sum, ~500 = top 1%, no cap:
#   score = 2.78*velocity_mph
#         + 0.2415*|shld_er_max| + 20.7*lead_leg_midpoint
#         + 0.7245*|horizontal_abduction| + 0.0181125*torso_ang_velo
#         - 0.2415*pelvis_ang_fp + 0.422625*front_leg_brace
#         + 0.301875*trunk_ang_fp - 0.2415*|front_leg_var_val|
#         + 1.2075*linear_pelvis_speed - 0.181125*|pelvis_obl|
#         + 0.0483*pelvis_ang_velo
#
# Kept verbatim for reproducing historic f_pitching_* score values.
# Do not call from new code.
# ============================================================

# ---------- Calculate score from metric data ----------
#' Calculate pitching score from XML document by extracting required metrics
#' @param doc XML document (session_data.xml)
#' @param owner_name Owner name to extract metrics for
#' @param velocity_mph Velocity in MPH (already extracted)
#' @param weight_kg Body weight in kg (from session.xml); if lead_leg_midpoint > 10, divide by (weight_kg*9.81) to normalize from raw N
#' @return Numeric score value or NA if insufficient data
calculate_pitching_score <- function(doc, owner_name, velocity_mph = NA_real_, weight_kg = NA_real_) {
  if (is.null(doc)) return(NA_real_)
  
  root <- xml_root(doc)
  if (!identical(xml_name(root), "v3d")) return(NA_real_)
  
  # Helper function to extract metric value from XML by variable name and component
  extract_metric_from_xml <- function(var_name, component = NULL) {
    # Find the owner
    owners <- xml_find_all(root, paste0("./owner[@value='", owner_name, "']"))
    if (length(owners) == 0) return(NA_real_)
    
    # Try original name first, then try with @Foot_Contact as alias for @Footstrike
    var_names_to_try <- c(var_name)
    if (grepl("@Footstrike", var_name)) {
      var_names_to_try <- c(var_name, sub("@Footstrike", "@Foot_Contact", var_name))
    }
    
    # Find metric types
    for (own in owners) {
      metric_types <- xml_find_all(own, "./type[@value='METRIC']")
      for (mt in metric_types) {
        folders <- xml_find_all(mt, "./folder")
        for (fol in folders) {
          names <- xml_find_all(fol, "./name[@value]")
          for (nm in names) {
            metric_name <- xml_attr(nm, "value")
            if (is.na(metric_name) || !metric_name %in% var_names_to_try) next
            
            # Find component
            comps <- xml_find_all(nm, "./component")
            for (comp in comps) {
              comp_val <- xml_attr(comp, "value")
              if (!is.null(component) && comp_val != component) next
              
              # Get data (first value for event-based metrics)
              data_attr <- xml_attr(comp, "data") %||% xml_text(comp)
              if (is.na(data_attr) || data_attr == "") next
              
              # Parse first value
              vals <- parse_comma_data(data_attr)
              if (length(vals) > 0 && !is.na(vals[1])) {
                return(as.numeric(vals[1]))
              }
            }
          }
        }
      }
    }
    return(NA_real_)
  }
  
  # Extract direct variables with component specifications
  linear_pelvis_speed <- extract_metric_from_xml("MaxPelvisLinearVel_MPH", "Y")
  lead_leg_midpoint <- extract_metric_from_xml("Lead_Leg_GRF_mag_Midpoint_FS_Release", "X")
  horizontal_abduction <- extract_metric_from_xml("Pitching_Shoulder_Angle@Footstrike", "X")
  torso_ang_velo <- extract_metric_from_xml("Thorax_Ang_Vel_max", "X")
  trunk_ang_fp <- extract_metric_from_xml("Trunk_Angle@Footstrike", "Z")
  pelvis_ang_fp <- extract_metric_from_xml("Pelvis_Angle@Footstrike", "Z")
  shld_er_max <- extract_metric_from_xml("Pitching_Shoulder_Angle_Max", "Z")
  pelvis_ang_velo <- extract_metric_from_xml("Pelvis_Ang_Vel_max", "X")
  
  # Extract variables for calculated metrics
  lead_knee_ang_fp_x <- extract_metric_from_xml("Lead_Knee_Angle@Footstrike", "X")
  lead_knee_ang_rel_x <- extract_metric_from_xml("Lead_Knee_Angle@Release", "X")
  pelvis_ang_fp_y <- extract_metric_from_xml("Pelvis_Angle@Footstrike", "Y")
  pelvis_ang_rel_y <- extract_metric_from_xml("Pelvis_Angle@Release", "Y")
  lead_knee_ang_fp_y <- extract_metric_from_xml("Lead_Knee_Angle@Footstrike", "Y")
  lead_knee_ang_rel_y <- extract_metric_from_xml("Lead_Knee_Angle@Release", "Y")
  
  # Calculate derived variables
  front_leg_brace <- NA_real_
  if (!is.na(lead_knee_ang_fp_x) && !is.na(lead_knee_ang_rel_x)) {
    front_leg_brace <- lead_knee_ang_fp_x - lead_knee_ang_rel_x
  }
  
  pelvis_obl <- NA_real_
  if (!is.na(pelvis_ang_rel_y) && !is.na(pelvis_ang_fp_y)) {
    pelvis_obl <- pelvis_ang_rel_y - pelvis_ang_fp_y
  }
  
  front_leg_var_val <- NA_real_
  if (!is.na(lead_knee_ang_fp_y) && !is.na(lead_knee_ang_rel_y)) {
    front_leg_var_val <- lead_knee_ang_fp_y - lead_knee_ang_rel_y
  }
  
  # Default weight when NULL so score scaling isn't thrown off (e.g. missing athlete demographics)
  weight_kg_use <- if (!is.na(weight_kg) && weight_kg > 0) weight_kg else (180 / 2.2046226)  # 180 lbs -> kg
  
  # Apply absolute values where needed
  if (!is.na(lead_leg_midpoint)) {
    lead_leg_midpoint <- abs(lead_leg_midpoint)
    # If > 10, value is raw Newtons (not BW-normalized); convert to BW multiples
    if (lead_leg_midpoint > 10) {
      lead_leg_midpoint <- lead_leg_midpoint / (weight_kg_use * 9.81)
    }
  }
  if (!is.na(horizontal_abduction)) {
    horizontal_abduction <- abs(horizontal_abduction)
  }
  if (!is.na(shld_er_max)) {
    shld_er_max <- abs(shld_er_max)
  }
  
  # score = velo_part + metric_sum (no offset, no cap). Velo = 2.78 * MPH. Metric part = raw sum; elite mechanics can exceed 250 (e.g. 264). ~500 = top 1%, scores can go slightly above (e.g. 512).
  VELO_MULT <- 2.78
  velo_part <- ifelse(!is.na(velocity_mph), VELO_MULT * velocity_mph, 0)
  # Per-variable coefficients: lead_leg_midpoint=18 base, then +15% on all metrics
  metric_sum_raw <-
    ifelse(!is.na(shld_er_max), 0.2415 * shld_er_max, 0) +
    ifelse(!is.na(lead_leg_midpoint), 20.7 * lead_leg_midpoint, 0) +
    ifelse(!is.na(horizontal_abduction), 0.7245 * horizontal_abduction, 0) +
    ifelse(!is.na(torso_ang_velo), 0.0181125 * torso_ang_velo, 0) -
    ifelse(!is.na(pelvis_ang_fp), 0.2415 * pelvis_ang_fp, 0) +
    ifelse(!is.na(front_leg_brace), 0.422625 * front_leg_brace, 0) +
    ifelse(!is.na(trunk_ang_fp), 0.301875 * trunk_ang_fp, 0) -
    ifelse(!is.na(front_leg_var_val), 0.2415 * abs(front_leg_var_val), 0) +
    ifelse(!is.na(linear_pelvis_speed), 1.2075 * linear_pelvis_speed, 0) -
    ifelse(!is.na(pelvis_obl), 0.181125 * abs(pelvis_obl), 0) +
    ifelse(!is.na(pelvis_ang_velo), 0.0483 * pelvis_ang_velo, 0)
  metric_sum <- metric_sum_raw  # no scaling; sliding scale so elite performers aren't capped
  score <- velo_part + metric_sum
  
  # Return NA if we couldn't calculate a meaningful score (all inputs were NA)
  if (is.na(linear_pelvis_speed) && is.na(front_leg_brace) && is.na(lead_leg_midpoint) &&
      is.na(horizontal_abduction) && is.na(torso_ang_velo) && is.na(pelvis_obl) &&
      is.na(trunk_ang_fp) && is.na(pelvis_ang_fp) && is.na(shld_er_max) &&
      is.na(front_leg_var_val) && is.na(pelvis_ang_velo) && is.na(velocity_mph)) {
    return(NA_real_)
  }
  
  return(score)
}
