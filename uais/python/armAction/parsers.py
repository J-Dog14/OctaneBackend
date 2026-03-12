"""
Data parsing functions for Action Plus analysis.
"""

import os


def clean_line(line):
    """Helper to remove leading empty element if present."""
    return line[1:] if line and line[0] == "" else line


def parse_file_info(full_path):
    """
    Parse participant_name, test_date, movement_type from c3d path.
    
    Args:
        full_path: Full file path to the c3d file
        
    Returns:
        tuple: (participant_name, test_date, movement_type)
    """
    path = full_path.replace("\\", "/")
    parts = path.split("/")
    # Remove any empty strings at the start
    parts = [p for p in parts if p.strip() != ""]
    
    participant_name = "UnknownName"
    test_date = "UnknownDate"
    movement_type = "Unknown"

    if len(parts) >= 3:
        participant_name = parts[-3].replace("_KA", "").replace("_", " ").strip()
    if len(parts) >= 2:
        test_date = parts[-2].rstrip("_")

    fn_lower = parts[-1].lower()
    if "fastball" in fn_lower or "pitch" in fn_lower:
        movement_type = "Pitch"
    elif "shortstop" in fn_lower:
        movement_type = "Shortstop"
    elif "catchers" in fn_lower:
        movement_type = "Catchers"
    elif "crow" in fn_lower and "hop" in fn_lower:
        movement_type = "Crow Hop"
    elif "knees" in fn_lower or "from knees" in fn_lower:
        movement_type = "From Knees"

    return participant_name, test_date, movement_type


def parse_events_from_aPlus(events_path, capture_rate=300):
    """
    Parse aPlus_events.txt => foot_contact_frame, release_frame.
    Process in chunks of 3; if the last chunk is partial, use what's available.
    
    Args:
        events_path: Path to the events file
        capture_rate: Frame rate (default 300)
        
    Returns:
        dict: Dictionary mapping filename to events dict with foot_contact_frame and release_frame
    """
    if not os.path.isfile(events_path):
        print(f"Missing events file: {events_path}")
        return {}
    with open(events_path, "r", encoding="utf-8") as f:
        lines = [clean_line(line.rstrip("\n").split("\t")) for line in f]
    if len(lines) < 2:
        print(f"Not enough lines in {events_path}")
        return {}
    filenames_line = lines[0]
    # Find the first numeric data row (assumed to be after header rows)
    data_line = None
    for row in lines[2:]:
        if row and row[0].isdigit():
            data_line = row
            break
    if not data_line:
        print(f"Could not find numeric data in {events_path}")
        return {}
    # If the first cell is a row index, skip it:
    data_vals = data_line[1:] if data_line[0].isdigit() else data_line
    events_dict = {}
    use_len = min(len(filenames_line), len(data_vals))
    col_idx = 0
    while col_idx < use_len:
        fn = filenames_line[col_idx].strip()
        # For each chunk, attempt to get up to 3 values:
        foot_str = data_vals[col_idx].strip() if col_idx < use_len else ""
        max_er_str = data_vals[col_idx+1].strip() if (col_idx+1) < use_len else ""
        rel_str = data_vals[col_idx+2].strip() if (col_idx+2) < use_len else ""
        try:
            fc = float(foot_str) if foot_str != "" else None
        except:
            fc = None
        try:
            rel = float(rel_str) if rel_str != "" else None
        except:
            rel = None
        fc_fr = int(round(fc * capture_rate)) if fc is not None else None
        rel_fr = int(round(rel * capture_rate)) if rel is not None else None
        events_dict[fn] = {
            "foot_contact_frame": fc_fr,
            "release_frame": rel_fr
        }
        col_idx += 3
    return events_dict


def parse_aplus_kinematics(txt_path):
    """
    Parse APlusData.txt => kinematics in chunks of 7 columns.
    
    Columns per trial:
    - Arm_Abduction@Footplant
    - Max_Abduction
    - Shoulder_Angle@Footplant
    - Max_ER
    - Arm_Velo
    - Max_Torso_Rot_Velo
    - Torso_Angle@Footplant
    
    Args:
        txt_path: Path to the APlusData.txt file
        
    Returns:
        list: List of dictionaries, each containing trial data
    """
    if not os.path.isfile(txt_path):
        print(f"APlusData file not found: {txt_path}")
        return []
    with open(txt_path, "r", encoding="utf-8") as f:
        lines = [clean_line(line.rstrip("\n").split("\t")) for line in f]
    if len(lines) < 2:
        print(f"Not enough lines in {txt_path}")
        return []
    filenames_line = lines[0]
    varnames_line = lines[1]
    # Find the first numeric data row
    data_line = None
    for row in lines[2:]:
        if row and row[0].isdigit():
            data_line = row
            break
    if not data_line:
        print(f"Could not find numeric row in {txt_path}")
        return []

    # If the first cell is a row index, skip it:
    data_vals = data_line[1:] if data_line[0].isdigit() else data_line

    # We now have 7 columns per trial
    chunk_size = 7

    use_len = min(len(filenames_line), len(varnames_line), len(data_vals))
    n_trials = use_len // chunk_size

    results = []
    for t in range(n_trials):
        start = t * chunk_size
        end = start + chunk_size
        sub_vars = varnames_line[start:end]
        sub_vals = data_vals[start:end]
        if not sub_vars or not sub_vals:
            continue
        trial_dict = {}
        for i in range(len(sub_vars)):
            var_name = sub_vars[i].strip()
            val_str = sub_vals[i].strip()
            try:
                val = float(val_str)
            except:
                val = None
            trial_dict[var_name] = val
        
        # Use the corresponding filename
        fn = filenames_line[start].strip() if start < len(filenames_line) else f"Unknown_File_{t}"
        trial_dict["filename"] = fn

        # Only append if we have a valid filename & some data
        if fn != "" and any(trial_dict.get(k) is not None for k in trial_dict if k != "filename"):
            results.append(trial_dict)
    return results

