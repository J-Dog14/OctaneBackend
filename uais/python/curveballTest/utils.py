"""
Utility functions for computing stability scores and parsing file information.
"""

import numpy as np


def compute_rms(signal):
    """Compute Root Mean Square of a signal."""
    signal = np.array(signal)
    return np.sqrt(np.mean(signal ** 2))


def compute_moving_average(signal, window_size=5):
    """Compute moving average of a signal."""
    if len(signal) < window_size:
        return np.mean(signal)
    return np.convolve(signal, np.ones(window_size) / window_size, mode="valid")


def compute_pitch_stability_score(row_dict):
    """
    Compute pitch stability score based on x, y, z angles and acceleration data.
    
    Args:
        row_dict: Dictionary containing pitch data with x_, y_, z_, ay_ columns for offsets
    
    Returns:
        Stability score (float, rounded to 2 decimal places)
    """
    pitch_type = row_dict.get("pitch_type", "").lower()
    frames = list(range(-10, 11))
    x_array, y_array, z_array, a_array = [], [], [], []
    for f in frames:
        lbl = f"neg{abs(f)}" if f < 0 else f"pos{f}"
        x_array.append(row_dict.get(f"x_{lbl}", 0.0))
        y_array.append(row_dict.get(f"y_{lbl}", 0.0))
        z_array.append(row_dict.get(f"z_{lbl}", 0.0))
        a_array.append(row_dict.get(f"ay_{lbl}", 0.0))

    if len(x_array) < 20:
        return 0.0

    # Widened window: use ±13 frames around release
    # This gives us more frames to assess stability, especially for ulnar deviation
    release_idx = len(x_array) - 20
    ws = max(release_idx - 13, 0)
    we = min(release_idx + 13, len(x_array))

    x_slice = x_array[ws:we]
    y_slice = y_array[ws:we]
    z_slice = z_array[ws:we]
    a_smoothed = compute_moving_average(a_array[ws:we])

    if pitch_type == "curve":
        x_max_angle, y_max_angle, z_max_angle = 55, 85, 80
        x_max_std, y_max_std, z_max_std = 18, 28, 22
    else:
        x_max_angle, y_max_angle, z_max_angle = 40, 80, 70
        x_max_std, y_max_std, z_max_std = 20, 30, 25

    def angle_score(val, mx):
        return max(0, 100 - (abs(val) / mx) * 100)

    def var_score(stdv, mxs):
        return max(0, 100 - (stdv / mxs) * 100)

    x_scores = [angle_score(v, x_max_angle) for v in x_slice]
    y_scores = [angle_score(v, y_max_angle) for v in y_slice]
    z_scores = [angle_score(v, z_max_angle) for v in z_slice]

    x_mag, y_mag, z_mag = np.mean(x_scores), np.mean(y_scores), np.mean(z_scores)
    x_std, y_std, z_std = np.std(x_slice), np.std(y_slice), np.std(z_slice)

    x_var = var_score(x_std, x_max_std)
    y_var = var_score(y_std, y_max_std)
    z_var = var_score(z_std, z_max_std)

    x_final = 0.6 * x_mag + 0.4 * x_var
    y_final = 0.6 * y_mag + 0.4 * y_var
    z_final = 0.6 * z_mag + 0.4 * z_var

    a_rms = np.sqrt(np.mean(a_smoothed ** 2)) if len(a_smoothed) else 0.0
    scaled_accel = np.log1p(a_rms) * 5 if a_rms > 0 else 0
    a_score = max(20, 100 - scaled_accel)

    if pitch_type == "curve":
        w_x, w_y, w_z, w_a = 0.15, 0.50, 0.25, 0.10
    else:
        w_x, w_y, w_z, w_a = 0.05, 0.55, 0.12, 0.28

    final_score = (w_x * x_final) + (w_y * y_final) + (w_z * z_final) + (w_a * a_score)
    filename = row_dict.get("filename", "Unknown")
    print(f"Stability Score for {filename}: {final_score:.2f}")
    return round(final_score, 2)


def parse_file_info(filepath_str):
    """
    Extract participant name, date, and pitch type from file path.
    
    Args:
        filepath_str: Full file path string
    
    Returns:
        Tuple of (participant_name, pitch_date, pitch_type)
    """
    pstr = filepath_str.replace("\\", "/")
    parts = pstr.split("/")
    pitch_type = "Unknown"
    pitch_date = "UnknownDate"
    participant_name = "UnknownName"

    if parts:
        fn_lower = parts[-1].lower()
        if "fast" in fn_lower:
            pitch_type = "Fastball"
        elif "curve" in fn_lower:
            pitch_type = "Curve"
        elif "slider" in fn_lower:
            pitch_type = "Slider"
        elif "change" in fn_lower:
            pitch_type = "Changeup"

        if len(parts) > 1:
            pitch_date = parts[-2].rstrip("_")
        if len(parts) > 2:
            folder_name = parts[-3].replace("_KA", "").replace("_", " ")
            participant_name = folder_name.strip()

    return participant_name, pitch_date, pitch_type


def build_upsert_sql(table_name):
    """
    Build SQL INSERT ... ON CONFLICT UPDATE statement for a given table.
    
    Args:
        table_name: Name of the table
    
    Returns:
        Tuple of (sql_string, column_names_list)
    """
    offsets = range(-20, 31)
    col_names = [
        "filename", "participant_name", "pitch_date", "pitch_type",
        "foot_contact_frame", "release_frame", "pitch_stability_score"
    ]
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        col_names += [f"x_{lbl}", f"y_{lbl}", f"z_{lbl}", f"ax_{lbl}", f"ay_{lbl}", f"az_{lbl}"]

    placeholders = ",".join(["?"] * len(col_names))
    update_pairs = [f"{c}=excluded.{c}" for c in col_names if c != "filename"]

    sql = f"""
    INSERT INTO {table_name} ({",".join(col_names)})
    VALUES ({placeholders})
    ON CONFLICT(filename) DO UPDATE SET
      {", ".join(update_pairs)}
    """
    return sql, col_names

