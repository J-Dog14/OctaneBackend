"""
Parsing functions for reading and processing data files.
"""

import pandas as pd


def parse_events(events_path, capture_rate=300):
    """
    Parse events file to extract foot contact and release frames for each pitch.
    
    Args:
        events_path: Path to the events.txt file
        capture_rate: Frames per second (default: 300)
    
    Returns:
        Dictionary mapping pitch filenames to their foot_contact_frame and release_frame
    """
    with open(events_path, "r", encoding="utf-8") as f:
        line1 = next(f).rstrip("\n").split("\t")
        for _ in range(4):
            next(f)
        times_line = next(f).rstrip("\n").split("\t")

        line1 = line1[1:]
        times_line = times_line[1:]

        pitch_filenames = line1[::2]
        num_pitches = len(pitch_filenames)
        num_time_pairs = len(times_line) // 2

        if num_time_pairs < num_pitches:
            print(f"WARNING: Adjusting pitches from {num_pitches} to {num_time_pairs}")
            num_pitches = num_time_pairs

        while len(times_line) < 2 * num_pitches:
            times_line.append("0.000")

        events_dict = {}
        for i, fp in enumerate(pitch_filenames[:num_pitches]):
            foot_t = float(times_line[2 * i])
            rel_t = float(times_line[2 * i + 1])
            foot_fr = int(round(foot_t * capture_rate))
            rel_fr = int(round(rel_t * capture_rate))
            events_dict[fp] = {
                "foot_contact_frame": foot_fr,
                "release_frame": rel_fr
            }
        return events_dict


def parse_link_model_based_long(filepath):
    """
    Parse link model based data file (wrist angles).
    
    Args:
        filepath: Path to the link_model_based.txt file
    
    Returns:
        DataFrame with frame column and x_p1, y_p1, z_p1, x_p2, y_p2, z_p2, etc. columns
    """
    with open(filepath, "r", encoding="utf-8") as f:
        for _ in range(5):
            next(f)
        df = pd.read_csv(f, sep="\t", header=None, engine="python")

    num_cols = df.shape[1]
    num_pitches = (num_cols - 1) // 3

    col_names = ["frame"]
    for i in range(num_pitches):
        col_names.extend([f"x_p{i + 1}", f"y_p{i + 1}", f"z_p{i + 1}"])

    df.columns = col_names
    df["frame"] = pd.to_numeric(df["frame"], errors="coerce")
    return df


def parse_accel_long(filepath):
    """
    Parse acceleration data file.
    
    Args:
        filepath: Path to the accel_data.txt file
    
    Returns:
        DataFrame with frame column and ax_p1, ay_p1, az_p1, ax_p2, ay_p2, az_p2, etc. columns
    """
    with open(filepath, "r", encoding="utf-8") as f:
        for _ in range(5):
            next(f)
        df = pd.read_csv(f, sep="\t", header=None, engine="python")

    num_cols = df.shape[1]
    num_pitches = (num_cols - 1) // 3

    col_names = ["frame"]
    for i in range(num_pitches):
        col_names.extend([f"ax_p{i + 1}", f"ay_p{i + 1}", f"az_p{i + 1}"])

    df.columns = col_names
    df["frame"] = pd.to_numeric(df["frame"], errors="coerce")
    return df

