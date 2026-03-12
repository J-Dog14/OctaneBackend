import os
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "pitch_kinematics.db"
EVENTS_PATH = r"D:\Youth Pitch Design\Exports\events.txt"
LINK_MODEL_BASED_PATH = r"D:\Youth Pitch Design\Exports\link_model_based.txt"
ACCEL_DATA_PATH = r"D:\Youth Pitch Design\Exports\accel_data.txt"
REF_EVENTS_PATH = r"D:\Youth Pitch Design\Exports\reference_events.txt"
REF_LINK_MODEL_BASED_PATH = r"D:\Youth Pitch Design\Exports\reference_link_model_based.txt"
REF_ACCEL_DATA_PATH = r"D:\Youth Pitch Design\Exports\reference_accel_data.txt"


# 0. Clear pitch_data table (called at start of each run)
def clear_pitch_data():
    """
    Clear all data from the pitch_data table.
    
    NOTE: This does NOT affect reference_data, which remains untouched.
    This function is called at the start of each analysis run to ensure
    fresh data processing.
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("DELETE FROM pitch_data")
    conn.commit()
    
    c.execute("SELECT COUNT(*) FROM pitch_data")
    count = c.fetchone()[0]
    
    conn.close()
    print(f"Cleared pitch_data table. Remaining records: {count}")


# 1. Create the pitch_data table
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    offsets = range(-20, 31)
    angle_cols = []
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        angle_cols.extend([
            f"x_{lbl} REAL",
            f"y_{lbl} REAL",
            f"z_{lbl} REAL",
            f"ax_{lbl} REAL",
            f"ay_{lbl} REAL",
            f"az_{lbl} REAL"
        ])

    create_sql = f"""
    CREATE TABLE IF NOT EXISTS pitch_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE,
        participant_name TEXT,
        pitch_date TEXT,
        pitch_type TEXT,
        foot_contact_frame INTEGER,
        release_frame INTEGER,
        pitch_stability_score REAL,
        {", ".join(angle_cols)}
    )
    """
    c.execute(create_sql)
    conn.commit()
    conn.close()


# 2. Create the reference_data table
def init_reference_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    offsets = range(-20, 31)
    angle_cols = []
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        angle_cols.extend([
            f"x_{lbl} REAL",
            f"y_{lbl} REAL",
            f"z_{lbl} REAL",
            f"ax_{lbl} REAL",
            f"ay_{lbl} REAL",
            f"az_{lbl} REAL"
        ])

    create_sql = f"""
    CREATE TABLE IF NOT EXISTS reference_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE,
        participant_name TEXT,
        pitch_date TEXT,
        pitch_type TEXT,
        foot_contact_frame INTEGER,
        release_frame INTEGER,
        pitch_stability_score REAL,
        {", ".join(angle_cols)}
    )
    """
    c.execute(create_sql)
    conn.commit()
    conn.close()


# 3. Ingest reference data
# NOTE: This function is only called by updateReferenceData.py.
# The main execution block does NOT modify reference_data to ensure it remains
# untouched for comparison purposes in reports.
def ingest_reference_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    events_dict = parse_events(REF_EVENTS_PATH)
    df_angles = parse_link_model_based_long(REF_LINK_MODEL_BASED_PATH)
    df_accel = parse_accel_long(REF_ACCEL_DATA_PATH)
    df_merged = pd.merge(df_angles, df_accel, on="frame", how="inner")

    offsets = list(range(-20, 31))
    col_names = [
        "filename",
        "participant_name",
        "pitch_date",
        "pitch_type",
        "foot_contact_frame",
        "release_frame",
        "pitch_stability_score"
    ]
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        col_names.extend([f"x_{lbl}", f"y_{lbl}", f"z_{lbl}", f"ax_{lbl}", f"ay_{lbl}", f"az_{lbl}"])

    placeholders = ",".join(["?"] * len(col_names))
    insert_sql = f"""
    INSERT INTO reference_data ({",".join(col_names)})
    VALUES ({placeholders})
    ON CONFLICT(filename) DO UPDATE SET
        participant_name=excluded.participant_name,
        pitch_date=excluded.pitch_date,
        pitch_type=excluded.pitch_type,
        foot_contact_frame=excluded.foot_contact_frame,
        release_frame=excluded.release_frame,
        pitch_stability_score=excluded.pitch_stability_score
    """

    print(f"Processing {len(events_dict)} reference pitches")
    for pitch_idx, pitch_fp in enumerate(events_dict.keys()):
        foot_fr = events_dict[pitch_fp]["foot_contact_frame"]
        release_fr = events_dict[pitch_fp]["release_frame"]
        pitch_num = pitch_idx + 1

        x_col = f"x_p{pitch_num}"
        y_col = f"y_p{pitch_num}"
        z_col = f"z_p{pitch_num}"
        ax_col = f"ax_p{pitch_num}"
        ay_col = f"ay_p{pitch_num}"
        az_col = f"az_p{pitch_num}"

        if x_col not in df_merged.columns:
            print(f"WARNING: Skipping reference file {pitch_fp}, missing {x_col}")
            continue

        start_fr = release_fr - 20
        end_fr = release_fr + 30
        slice_df = df_merged[(df_merged["frame"] >= start_fr) & (df_merged["frame"] <= end_fr)]

        row_dict = {
            "filename": pitch_fp,
            "participant_name": parse_file_info(pitch_fp)[0],
            "pitch_date": parse_file_info(pitch_fp)[1],
            "pitch_type": parse_file_info(pitch_fp)[2],
            "foot_contact_frame": foot_fr,
            "release_frame": release_fr
        }

        for off in offsets:
            lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
            actual_fr = release_fr + off
            match = slice_df[slice_df["frame"] == actual_fr]
            if not match.empty:
                row_dict[f"x_{lbl}"] = match.iloc[0][x_col]
                row_dict[f"y_{lbl}"] = match.iloc[0][y_col]
                row_dict[f"z_{lbl}"] = match.iloc[0][z_col]
                row_dict[f"ax_{lbl}"] = match.iloc[0][ax_col]
                row_dict[f"ay_{lbl}"] = match.iloc[0][ay_col]
                row_dict[f"az_{lbl}"] = match.iloc[0][az_col]
            else:
                row_dict[f"x_{lbl}"] = None
                row_dict[f"y_{lbl}"] = None
                row_dict[f"z_{lbl}"] = None
                row_dict[f"ax_{lbl}"] = None
                row_dict[f"ay_{lbl}"] = None
                row_dict[f"az_{lbl}"] = None

        row_dict["pitch_stability_score"] = compute_pitch_stability_score(row_dict)
        values = [row_dict[col] for col in col_names]
        c.execute(insert_sql, values)

    conn.commit()
    conn.close()


# 4. Parse events file (used by both ingestion routines)
def parse_events(events_path, capture_rate=300):
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


# 5. Parse link model based data
def parse_link_model_based_long(filepath):
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


# 6. Parse acceleration data
def parse_accel_long(filepath):
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


# 7. Utility functions for computing stability
def compute_rms(signal):
    signal = np.array(signal)
    return np.sqrt(np.mean(signal ** 2))


def compute_moving_average(signal, window_size=5):
    if len(signal) < window_size:
        return np.mean(signal)
    return np.convolve(signal, np.ones(window_size) / window_size, mode="valid")


def compute_pitch_stability_score(row_dict):
    import numpy as np

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

    release_idx = len(x_array) - 20
    ws = max(release_idx - 5, 0)
    we = min(release_idx + 5, len(x_array))

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


# 8. Extract participant name, date, and pitch type from the file path
def parse_file_info(filepath_str):
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
    offsets = range(-20, 31)
    col_names = [
        "filename","participant_name","pitch_date","pitch_type",
        "foot_contact_frame","release_frame","pitch_stability_score"
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

# 9. Ingest new pitch data into the pitch_data table using events_dict
def ingest_pitches_with_events(events_dict):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    df_angles = parse_link_model_based_long(LINK_MODEL_BASED_PATH)
    df_accel = parse_accel_long(ACCEL_DATA_PATH)
    df_merged = pd.merge(df_angles, df_accel, on="frame", how="inner", suffixes=("_ang", "_acc"))

    offsets = list(range(-20, 31))
    col_names = [
        "filename",
        "participant_name",
        "pitch_date",
        "pitch_type",
        "foot_contact_frame",
        "release_frame",
        "pitch_stability_score"
    ]
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        col_names.extend([f"x_{lbl}", f"y_{lbl}", f"z_{lbl}", f"ax_{lbl}", f"ay_{lbl}", f"az_{lbl}"])

    placeholders = ",".join(["?"] * len(col_names))
    insert_sql = f"""
    INSERT INTO pitch_data ({",".join(col_names)})
    VALUES ({placeholders})
    ON CONFLICT(filename) DO UPDATE SET
        participant_name=excluded.participant_name,
        pitch_date=excluded.pitch_date,
        pitch_type=excluded.pitch_type,
        foot_contact_frame=excluded.foot_contact_frame,
        release_frame=excluded.release_frame,
        pitch_stability_score=excluded.pitch_stability_score
    """

    print(f"Processing {len(events_dict)} regular pitches")
    for pitch_idx, pitch_fp in enumerate(events_dict.keys()):
        foot_fr = events_dict[pitch_fp]["foot_contact_frame"]
        release_fr = events_dict[pitch_fp]["release_frame"]
        pitch_num = pitch_idx + 1

        x_col = f"x_p{pitch_num}"
        y_col = f"y_p{pitch_num}"
        z_col = f"z_p{pitch_num}"
        ax_col = f"ax_p{pitch_num}"
        ay_col = f"ay_p{pitch_num}"
        az_col = f"az_p{pitch_num}"

        if x_col not in df_merged.columns:
            print(f"WARNING: Skipping {pitch_fp}, missing {x_col}")
            continue

        start_fr = release_fr - 20
        end_fr = release_fr + 30
        slice_df = df_merged[(df_merged["frame"] >= start_fr) & (df_merged["frame"] <= end_fr)]

        row_dict = {
            "filename": pitch_fp,
            "participant_name": parse_file_info(pitch_fp)[0],
            "pitch_date": parse_file_info(pitch_fp)[1],
            "pitch_type": parse_file_info(pitch_fp)[2],
            "foot_contact_frame": foot_fr,
            "release_frame": release_fr
        }

        for off in offsets:
            lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
            actual_fr = release_fr + off
            match = slice_df[slice_df["frame"] == actual_fr]
            if not match.empty:
                row_dict[f"x_{lbl}"] = match.iloc[0][x_col]
                row_dict[f"y_{lbl}"] = match.iloc[0][y_col]
                row_dict[f"z_{lbl}"] = match.iloc[0][z_col]
                row_dict[f"ax_{lbl}"] = match.iloc[0][ax_col]
                row_dict[f"ay_{lbl}"] = match.iloc[0][ay_col]
                row_dict[f"az_{lbl}"] = match.iloc[0][az_col]
            else:
                row_dict[f"x_{lbl}"] = None
                row_dict[f"y_{lbl}"] = None
                row_dict[f"z_{lbl}"] = None
                row_dict[f"ax_{lbl}"] = None
                row_dict[f"ay_{lbl}"] = None
                row_dict[f"az_{lbl}"] = None

        row_dict["pitch_stability_score"] = compute_pitch_stability_score(row_dict)
        values = [row_dict[col] for col in col_names]
        c.execute(insert_sql, values)

    conn.commit()
    conn.close()


##############################################
# Report section
##############################################
import os
import base64
import sqlite3
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4  # We'll define a custom bigger page in code
from reportlab.platypus import Table, TableStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

DB_PATH = "pitch_kinematics.db"
OUTPUT_DIR = r"D:\Youth Pitch Design\Reports"
LOGO_PATH = r"C:\Users\q\PycharmProjects\Youth Pitch Design\8ctane - Faded 8 to Blue.png"


def generate_curve_report():
    """
    Creates a dark-themed PDF with table+score at top, plus 4 large time-series graphs
    with foot contact = 0 and a gold dashed line at release.

    Also uses brand colors:
    - Light Blue #2c99d4
    - Dusty Red #d62728
    - #1f1f1f background for "cards"
    - #4887a8 for brand border
    """
    # -------------------------------------------
    # 1) GATHER DATA FROM THE DB
    # -------------------------------------------
    conn = sqlite3.connect(DB_PATH)
    df_last = pd.read_sql_query(
        "SELECT participant_name, pitch_date FROM pitch_data ORDER BY id DESC LIMIT 1",
        conn
    )
    if df_last.empty:
        raise ValueError("No data found in DB!")

    participant_name = df_last.iloc[0]["participant_name"]
    test_date = df_last.iloc[0]["pitch_date"]

    # All curve pitches for that participant/date
    df_curves = pd.read_sql_query(f"""
        SELECT * FROM pitch_data
        WHERE participant_name='{participant_name}'
          AND pitch_date='{test_date}'
          AND pitch_type='Curve'
    """, conn)
    if df_curves.empty:
        raise ValueError(f"No Curve data for {participant_name} on {test_date}.")

    # Average stability
    df_avg = pd.read_sql_query(f"""
        SELECT AVG(pitch_stability_score) AS avg_score
        FROM pitch_data
        WHERE participant_name='{participant_name}'
          AND pitch_date='{test_date}'
          AND pitch_type='Curve'
    """, conn)
    conn.close()

    stability_score = df_avg.iloc[0, 0] if not df_avg.empty else 0.0

    # Let's build a small comparison table for y_, z_ offsets
    offsets = [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10]
    table_df = pd.DataFrame(index=["Avg Ulnar Dev", "Avg Sup/Pronation"], columns=offsets, dtype=float)

    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        y_col, z_col = f"y_{lbl}", f"z_{lbl}"
        table_df.loc["Avg Ulnar Dev", off] = df_curves[y_col].mean() if y_col in df_curves else None
        table_df.loc["Avg Sup/Pronation", off] = df_curves[z_col].mean() if z_col in df_curves else None

    # 2a) Grab reference_data for "Curve"
    conn = sqlite3.connect(DB_PATH)
    df_ref_curves = pd.read_sql_query("""
        SELECT * FROM reference_data WHERE pitch_type='Curve'
    """, conn)
    conn.close()

    # 2b) Extend table_df to hold two more rows:
    table_df.loc["Ref Ulnar Dev"] = np.nan
    table_df.loc["Ref Sup/Pronation"] = np.nan

    # 2c) Fill from reference_data means
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        y_col = f"y_{lbl}"
        z_col = f"z_{lbl}"
        table_df.loc["Ref Ulnar Dev", off] = df_ref_curves[y_col].mean() if not df_ref_curves.empty else None
        table_df.loc["Ref Sup/Pronation", off] = df_ref_curves[z_col].mean() if not df_ref_curves.empty else None

    # -------------------------------------------
    # 2) BUILD PLOTLY FIGS
    # -------------------------------------------
    # We'll do three "time series" figs (ulnar/pronation/flexion) that rebase foot contact=0 for each pitch,
    # and an acceleration fig with only 2 legend entries.

    # Now pass df_ref_curves into your figure builders:
    fig_ulnar = build_time_series_figure(
        df_curves, "Ulnar Deviation Time Series", prefix="y_", color="#2c99d4",
        df_reference=df_ref_curves, force_axis_start_at_zero=True
    )
    fig_pronation = build_time_series_figure(
        df_curves, "Pronation Time Series", prefix="z_", color="#ffffff",
        df_reference=df_ref_curves, force_axis_start_at_zero=True
    )
    fig_flexion = build_time_series_figure(
        df_curves, "Flexion Time Series", prefix="x_", color="#2c99d4",
        df_reference=df_ref_curves, force_axis_start_at_zero=True
    )
    fig_accel = build_acceleration_figure(
        df_curves, df_ref_curves, force_axis_start_at_zero=True
    )

    # Save them as PNG
    fig_ulnar.write_image("ulnar_dev.png")
    fig_pronation.write_image("pronation.png")
    fig_flexion.write_image("flexion.png")
    fig_accel.write_image("accel.png")

    # -------------------------------------------
    # 3) CREATE PDF (WITH A BIGGER PAGE)
    # -------------------------------------------
    # Generate filename, adding a number suffix if file already exists
    base_filename = f"{participant_name} {test_date} Curve Ball Report.pdf"
    pdf_path = os.path.join(OUTPUT_DIR, base_filename)
    
    # If file exists, add a number suffix (e.g., "Report (1).pdf", "Report (2).pdf")
    counter = 1
    while os.path.exists(pdf_path):
        name_without_ext = base_filename.replace(".pdf", "")
        pdf_path = os.path.join(OUTPUT_DIR, f"{name_without_ext} ({counter}).pdf")
        counter += 1
    
    # We'll define a custom page ~ 1600×1200 px for extra space
    page_width, page_height = 2000, 2000
    c = canvas.Canvas(pdf_path, pagesize=(page_width, page_height))

    # Fill entire background black
    c.setFillColorRGB(0, 0, 0)
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    # Colors from your custom dash theme
    brand_border = colors.HexColor("#4887a8")
    card_bg = colors.HexColor("#1f1f1f")
    text_color = colors.HexColor("#ffffff")
    lime_color = colors.HexColor("#32CD32")

    # --- HEADER ---
    c.setFont("Helvetica-BoldOblique", 50)
    c.setFillColor(text_color)
    c.drawString(30, page_height - 60, "Pitch Analysis Dashboard")

    c.setFont("Helvetica-Oblique", 30)
    c.drawString(30, page_height - 110, f"Athlete: {participant_name}")
    c.drawString(30, page_height - 160, f"Date: {test_date}")

    c.setStrokeColor(brand_border)
    c.setLineWidth(3)
    c.line(20, page_height - 175, page_width - 20, page_height - 175)

    # Attempt to load logo
    print("LOGO PATH =>", LOGO_PATH)
    if os.path.exists(LOGO_PATH):
        c.drawImage(
            LOGO_PATH, page_width - 500, page_height - 180,
            width=398.06, height=160.03, preserveAspectRatio=True, mask='auto'
        )

    # --- TABLE + SCORE (Stretch wide, short, move up) ---
    table_card_x = 20
    table_card_y = page_height - 490
    table_card_w = page_width - 480  # full width except margins
    table_card_h = 280               # short

    c.setFillColor(card_bg)
    c.setStrokeColor(brand_border)
    c.roundRect(table_card_x, table_card_y, table_card_w, table_card_h, 10, fill=1)

    c.setFillColor(text_color)
    c.setFont("Helvetica-BoldOblique", 30)
    c.drawString(table_card_x + 15, table_card_y + table_card_h - 32, "Comparison Table (Ulnar & Sup/Pro)")

    # Build table data quickly
    col_list = table_df.columns.tolist()
    # Reorder the rows as desired
    new_index = ["Avg Ulnar Dev", "Ref Ulnar Dev", "Avg Sup/Pronation", "Ref Sup/Pronation"]
    table_df = table_df.reindex(new_index)
    row_list = table_df.index.tolist()

    table_data = []
    header_row = [""] + [str(c) for c in col_list]
    table_data.append(header_row)

    for idx in row_list:
        row_vals = [idx]
        for ccc in col_list:
            val = table_df.loc[idx, ccc]
            row_vals.append(f"{val:.1f}" if pd.notna(val) else "")
        table_data.append(row_vals)

    from reportlab.platypus import Table, TableStyle

    # Adjust column widths and row heights
    t = Table(table_data, colWidths=[230] + [112] * len(col_list), rowHeights=42)

    # Define the table style, including font size adjustments
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#333333")),  # Header background
        ('TEXTCOLOR', (0, 0), (-1, 0), text_color),                   # Header text color
        ('FONTNAME', (0, 0), (-1, 0), "Helvetica-Bold"),              # Header font
        ('FONTSIZE', (0, 0), (-1, 0), 26),                            # **Increase Header Font Size**
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#444444")),
        ('BACKGROUND', (0, 1), (-1, -1), colors.black),               # Table body background
        ('TEXTCOLOR', (0, 1), (-1, -1), text_color),                  # Table text color
        ('FONTNAME', (0, 1), (-1, -1), "Helvetica"),                  # **Set Body Font**
        ('FONTSIZE', (0, 1), (-1, -1), 24),                           # **Increase Cell Text Size**
    ]))

    tw, th = t.wrapOn(c, table_card_w - 20, table_card_h - 20)
    t.drawOn(c, table_card_x + 25, table_card_y + table_card_h - 48 - th)

    # --- STABILITY SCORE BOX ---
    score_w = 340
    score_h = 280
    score_x = page_width - score_w - 80
    score_y = page_height - 490  # Move it down

    c.setFillColor(card_bg)
    c.setStrokeColor(brand_border)
    c.roundRect(score_x, score_y, score_w, score_h, 10, fill=1)

    c.setFillColor(text_color)
    c.setFont("Helvetica-Oblique", 24)
    c.drawString(score_x + 10, score_y + 20, "Higher = Better Wrist Stability")

    c.setFont("Helvetica-BoldOblique", 46)
    c.drawString(score_x + 10, score_y + 230, "Stability Score")

    c.setFont("Helvetica-BoldOblique", 95)  # Make the score much bigger
    c.setFillColor(lime_color)
    c.drawString(score_x + 40, score_y + 100, f"{stability_score:.2f}")

    # # 4 Graphs, each is bigger by ~12%. We'll place them in a 2×2 grid:
    # row1 y ~ page_height-600, each ~ (720 wide, 330 tall)
    # row2 y ~ page_height-1000, same size
    # graph_w = 950
    graph_w = 950
    graph_h = 730

    # Wraps text for blurbs below graphs
    def draw_wrapped_text(c, text, x, y, max_width, font_name="Helvetica", font_size=16, leading=2):
        """
        Splits text into lines that fit within max_width and draws them starting at (x,y) using the canvas c.
        """
        words = text.split()
        lines = []
        current_line = ""
        for word in words:
            test_line = f"{current_line} {word}".strip()
            if c.stringWidth(test_line, font_name, font_size) <= max_width:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = word
        if current_line:
            lines.append(current_line)

        for i, line in enumerate(lines):
            c.drawString(x, y - i * (font_size + leading), line)

    def draw_card_with_image(x, y, w, h, png_path, title, blurb=None):
        c.setFillColor(card_bg)
        c.setStrokeColor(brand_border)
        c.roundRect(x - 10, y, w, h, 8, fill=1)  # Draw card background

        c.setFillColor(text_color)
        c.setFont("Helvetica-Bold", 28)
        c.drawString(x - 1, y + h - 35, title)  # Draw the title

        c.drawImage(png_path, x + 30, y + 70, width=w - 70, height=h - 120,
                    preserveAspectRatio=True, mask='auto')

        # If a blurb is provided, draw it wrapped below the card.
        if blurb:
            c.setFont("Helvetica", 20)
            max_width = w - 220  # Adjust as needed (padding from left/right)
            # Adjust the starting position for the blurb as desired (e.g., below the card)
            draw_wrapped_text(c, blurb, x, y + 40, max_width, font_name="Helvetica", font_size=16)

    # Adjust row placements
    row1_y = page_height - 1250
    row2_y = page_height - 2000

    draw_card_with_image(
        30, row1_y, graph_w, graph_h, "ulnar_dev.png", "Ulnar Deviation Time Series",
        "Ulnar deviation measures how much the wrist flexes toward the ulnar side of the forearm or 'flicks'"
        " as we release the ball. Moving in the negative (-) direction represents ulnar deviation."
    )

    # Top right graph (Acceleration) with its blurb
    draw_card_with_image(
        1000, row1_y, graph_w, graph_h, "accel.png", "Acceleration: Transverse & Frontal",
        "Acceleration in the transverse and frontal planes shows how rapidly the wrist angles are changing "
        "around release, which can correlate with injury risk. Ideally, it's kept minimal to reduce stress during throwing."
    )

    # Bottom Left: Pronation/Supination
    draw_card_with_image(
        30, row2_y, graph_w, graph_h, "pronation.png", "Pronation Time Series",
        "Pronation and Supination measure how much you 'twist' the wrist. Supination through ball release is "
        "associated with the same 'flick' motion we are trying to avoid. Negative (-) values correspond with supination."
    )

    # Bottom Right: Flexion
    draw_card_with_image(
        1000, row2_y, graph_w, graph_h, "flexion.png", "Flexion Time Series",
        "Flexion at the wrist can be associated with the same 'flick' that occurs with excessive ulnar "
        "deviation. Negative (-) values correspond with flexion."
    )

    c.showPage()
    c.save()
    print(f"PDF saved to: {pdf_path}")


def build_time_series_figure(df_curves, title, prefix, color, df_reference=None, force_axis_start_at_zero=True):
    fig = go.Figure()
    fig.update_layout(
        template="plotly_dark",
        margin=dict(l=10, r=20, t=30, b=20),  # shift graph right if desired
        legend=dict(
            x=0.15, y=0.99, xanchor='right', yanchor='top', bgcolor='rgba(0,0,0,0)'
        )
    )

    # (A) Plot the highest-scored reference pitch (optional)
    if df_reference is not None and not df_reference.empty:
        ref_row = df_reference.iloc[0]
        foot_fr_ref = ref_row["foot_contact_frame"]
        release_fr_ref = ref_row["release_frame"]
        end_fr_ref = release_fr_ref + 30
        span_ref = max(end_fr_ref - foot_fr_ref, 1)

        x_ref = np.arange(foot_fr_ref, end_fr_ref + 1)
        x_percent_ref = 100 * (x_ref - foot_fr_ref) / span_ref

        ref_y_vals = []
        for actual_fr in x_ref:
            offset = actual_fr - release_fr_ref
            lbl = f"neg{abs(offset)}" if offset < 0 else f"pos{offset}"
            col = f"{prefix}{lbl}"
            val = ref_row.get(col, None)
            ref_y_vals.append(val if pd.notna(val) else None)

        fig.add_trace(go.Scatter(
            x=x_percent_ref, y=ref_y_vals, mode='lines',
            line=dict(color='grey', width=22),
            fill='tonexty', fillcolor='rgba(200,200,200,0.3)',
            opacity=0.4, name='Reference'
        ))

    # (B) Plot all other pitches (NO release line here)
    for _, row in df_curves.iterrows():
        foot_fr = row["foot_contact_frame"]
        release_fr = row["release_frame"]
        end_fr = release_fr + 30
        span = max(end_fr - foot_fr, 1)
        x = np.arange(foot_fr, end_fr + 1)
        x_percent = 100 * (x - foot_fr) / span

        y_vals = []
        for actual_fr in x:
            offset = actual_fr - release_fr
            lbl = f"neg{abs(offset)}" if offset < 0 else f"pos{offset}"
            col = f"{prefix}{lbl}"
            val = row.get(col, None)
            y_vals.append(val if pd.notna(val) else None)

        fig.add_trace(go.Scatter(
            x=x_percent, y=y_vals, mode='lines',
            line=dict(color=color if color else '#ffffff'),
            showlegend=False
        ))

    # (C) Draw exactly one release line using FIRST pitch
    first_pitch = df_curves.iloc[0]
    foot_fr_1 = first_pitch["foot_contact_frame"]
    release_fr_1 = first_pitch["release_frame"]
    total_span_1 = max((release_fr_1 + 30) - foot_fr_1, 1)
    release_x_pct = 100.0 * (release_fr_1 - foot_fr_1) / total_span_1

    fig.add_shape(
        dict(
            type="line",
            x0=release_x_pct, x1=release_x_pct,
            y0=0, y1=1,
            xref='x', yref='paper',
            line=dict(color="gold", dash="dash", width=2)
        )
    )

    # (D) Final X-Axis settings. Remove or comment out the next 2 lines
    # if you want full 0..100% or some other range.
    if force_axis_start_at_zero:  # force 30..100 if that's your desired zoom:
        fig.update_xaxes(range=[30, 100])

    # shift the domain so there's some left padding
    fig.update_layout(
        xaxis=dict(
            domain=[0.1, 0.95],
            # range=[30, 100], # if you prefer to hard-code
        )
    )
    return fig


def build_acceleration_figure(df_curves, df_reference=None, force_axis_start_at_zero=True):
    """
    Acceleration figure with reference band if df_reference is provided, using a 0..100% x-axis
    from foot_contact_frame to end_of_trial. Draws exactly one release line at the end.
    """
    fig = go.Figure()
    fig.update_layout(
        template="plotly_dark",
        title=dict(text="Acceleration: Transverse & Frontal", font=dict(size=14)),
        margin=dict(l=20, r=20, t=30, b=20),
        paper_bgcolor="#000000",
        plot_bgcolor="#000000",
        legend=dict(
            x=0.15, y=0.99, xanchor='right', yanchor='top', bgcolor='rgba(0,0,0,0)'
        )
    )

    # # # ---------------------------------------------------------
    # # (A) OPTIONAL REFERENCE PITCH
    # # ---------------------------------------------------------
    # if df_reference is not None and not df_reference.empty:
    #     ref_row = df_reference.iloc[0]  # e.g. highest-scored pitch
    #     foot_fr_ref = ref_row["foot_contact_frame"]
    #     release_fr_ref = ref_row["release_frame"]
    #     end_fr_ref = release_fr_ref + 30
    #     span_ref = max(end_fr_ref - foot_fr_ref, 1)
    #
    #     x_ref = np.arange(foot_fr_ref, end_fr_ref + 1)
    #     x_percent_ref = 100.0 * (x_ref - foot_fr_ref) / span_ref
    #
    #     # Build arrays for AY & AZ
    #     ay_ref = []
    #     az_ref = []
    #     for fr in x_ref:
    #         offset = fr - release_fr_ref
    #         lbl = f"neg{abs(offset)}" if offset < 0 else f"pos{offset}"
    #         ay_val = ref_row.get(f"ay_{lbl}", None)
    #         az_val = ref_row.get(f"az_{lbl}", None)
    #         ay_ref.append(ay_val if pd.notna(ay_val) else None)
    #         az_ref.append(az_val if pd.notna(az_val) else None)
    #
    #     # Plot as a wide, semi-transparent band (just using AY for reference, e.g.)
    #     # If you prefer combining them, adapt as needed
    #     fig.add_trace(go.Scatter(
    #         x=x_percent_ref, y=ay_ref, mode='lines',
    #         line=dict(color='grey', width=22),
    #         fill='tonexty', fillcolor='rgba(200,200,200,0.3)',
    #         opacity=0.4, name='Reference'
    #     ))

    # ---------------------------------------------------------
    # (B) PLOT ALL PITCHES, NO RELEASE LINES HERE
    # ---------------------------------------------------------
    shown_uld = False
    shown_pro = False

    for _, row in df_curves.iterrows():
        foot_fr = row["foot_contact_frame"]
        release_fr = row["release_frame"]
        end_fr = release_fr + 30
        span = max(end_fr - foot_fr, 1)

        x_vals = np.arange(foot_fr, end_fr + 1)
        x_percent = 100.0 * (x_vals - foot_fr) / span

        ay_vals = []
        az_vals = []
        for fr in x_vals:
            offset = fr - release_fr
            lbl = f"neg{abs(offset)}" if offset < 0 else f"pos{offset}"
            ay_val = row.get(f"ay_{lbl}", None)
            az_val = row.get(f"az_{lbl}", None)
            ay_vals.append(ay_val if pd.notna(ay_val) else None)
            az_vals.append(az_val if pd.notna(az_val) else None)

        # Plot AY => "Ulnar Deviation"
        fig.add_trace(go.Scatter(
            x=x_percent, y=ay_vals, mode="lines",
            line=dict(color="#2c99d4"),
            name="Ulnar Deviation" if not shown_uld else None,
            showlegend=(not shown_uld)
        ))
        shown_uld = True

        # Plot AZ => "Pro/Supination"
        fig.add_trace(go.Scatter(
            x=x_percent, y=az_vals, mode="lines",
            line=dict(color="#d62728"),
            name="Pro/Supination" if not shown_pro else None,
            showlegend=(not shown_pro)
        ))
        shown_pro = True

    # ---------------------------------------------------------
    # (C) SINGLE RELEASE LINE FROM FIRST PITCH
    # ---------------------------------------------------------
    first_pitch = df_curves.iloc[0]
    ffc = first_pitch["foot_contact_frame"]  # foot contact
    rls = first_pitch["release_frame"]       # release
    total_span = max((rls + 30) - ffc, 1)
    release_x_pct = 100.0 * (rls - ffc) / total_span

    fig.add_shape(
        dict(
            type="line",
            x0=release_x_pct, x1=release_x_pct,
            y0=0, y1=1,
            xref='x', yref='paper',
            line=dict(color="gold", dash="dash", width=2)
        )
    )

    # ---------------------------------------------------------
    # (D) FINAL X-AXIS SETTINGS
    # ---------------------------------------------------------
    # For example, zoom in from 30..100%
    if force_axis_start_at_zero:
        fig.update_xaxes(range=[30, 100])

    # Shift domain if you want extra left padding
    fig.update_layout(
        xaxis=dict(
            domain=[0.1, 0.95],
        )
    )
    return fig


# -------------------------------
# Main Execution Block
# -------------------------------
if __name__ == "__main__":
    # Initialize both tables
    init_db()
    init_reference_db()

    # Clear pitch_data table to ensure fresh data for this run
    # NOTE: Reference data is NOT cleared - it remains untouched for comparison
    clear_pitch_data()

    # NOTE: Reference data is NOT modified here. It remains untouched and is only used
    # for comparison in report generation. To add/update reference data, use updateReferenceData.py

    # Parse events from the events file and ingest new pitch data
    events_dict = parse_events(EVENTS_PATH)
    ingest_pitches_with_events(events_dict)

    # Now that the DB is populated, generate the report.
    # The report will use existing reference_data for comparison.
    generate_curve_report()
