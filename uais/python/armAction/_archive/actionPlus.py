import os
import sqlite3

# --- Helper to remove leading empty element if present ---
def clean_line(line):
    return line[1:] if line and line[0] == "" else line

###############################################################################
# 1) CREATE/KEEP THE SINGLE movement_data TABLE
###############################################################################
def init_db(db_path="actionPlus.sqlite"):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    create_sql = """
    CREATE TABLE IF NOT EXISTS movement_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE,
      participant_name TEXT,
      test_date TEXT,
      movement_type TEXT,
      foot_contact_frame INTEGER,
      release_frame INTEGER,

      [Arm_Abduction@Footplant] REAL,
      [Max_Abduction] REAL,
      [Shoulder_Angle@Footplant] REAL,
      [Max_ER] REAL,
      [Arm_Velo] REAL,
      [Max_Torso_Rot_Velo] REAL,
      [Torso_Angle@Footplant] REAL,

      [Score] REAL  -- <--- new column for our computed score
    );
    """
    c.execute(create_sql)
    conn.commit()
    conn.close()


###############################################################################
# 2) PARSE participant_name, test_date, movement_type from c3d path
###############################################################################
def parse_file_info(full_path):
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

    return participant_name, test_date, movement_type


###############################################################################
# 3) PARSE aPlus_events.txt => foot_contact_frame, release_frame
#    (Process in chunks of 3; if the last chunk is partial, use what’s available)
###############################################################################
def parse_events_from_aPlus(events_path, capture_rate=300):
    if not os.path.isfile(events_path):
        print(f"❌ Missing events file: {events_path}")
        return {}
    with open(events_path, "r", encoding="utf-8") as f:
        lines = [clean_line(line.rstrip("\n").split("\t")) for line in f]
    if len(lines) < 2:
        print(f"⚠️ Not enough lines in {events_path}")
        return {}
    filenames_line = lines[0]
    # Find the first numeric data row (assumed to be after header rows)
    data_line = None
    for row in lines[2:]:
        if row and row[0].isdigit():
            data_line = row
            break
    if not data_line:
        print(f"⚠️ Could not find numeric data in {events_path}")
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


###############################################################################
# 4) PARSE APlusData.txt => kinematics in chunks of 6 columns
###############################################################################
def parse_aplus_kinematics(txt_path):
    if not os.path.isfile(txt_path):
        print(f"❌ APlusData file not found: {txt_path}")
        return []
    with open(txt_path, "r", encoding="utf-8") as f:
        lines = [clean_line(line.rstrip("\n").split("\t")) for line in f]
    if len(lines) < 2:
        print(f"⚠️ Not enough lines in {txt_path}")
        return []
    filenames_line = lines[0]
    varnames_line  = lines[1]
    # Find the first numeric data row
    data_line = None
    for row in lines[2:]:
        if row and row[0].isdigit():
            data_line = row
            break
    if not data_line:
        print(f"⚠️ Could not find numeric row in {txt_path}")
        return []

    # If the first cell is a row index, skip it:
    data_vals = data_line[1:] if data_line[0].isdigit() else data_line

    # We now have 7 columns per trial: 
    #   Arm_Abduction@Footplant, Max_Abduction, Shoulder_Angle@Footplant,
    #   Max_ER, Arm_Velo, Max_Torso_Rot_Velo, Torso_Angle@Footplant
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
            val_str  = sub_vals[i].strip()
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

def compute_score(
    arm_velo: float,
    torso_velo: float,
    abd_footplant: float,
    shoulder_fp: float,
    max_er: float
) -> float:
    """
    Example scoring logic:
      1) arm_velo * 0.005
      2) torso_velo * 0.02
      3) abduction@footplant => -1 * (abd_footplant * 2)
      4) shoulder ER@footplant => piecewise logic
      5) max_er => piecewise logic => +10 if in 180..210, 0 if in 211..220,
         0 if in 179..(just below 180?), and -10 if <180 or >220
    """

    # Safety for None => 0
    arm_velo      = arm_velo      or 0
    torso_velo    = torso_velo    or 0
    abd_footplant = abd_footplant or 0
    shoulder_fp   = shoulder_fp   or 0
    max_er        = max_er        or 0

    score = 0.0

    # 1) Arm velocity
    score += arm_velo * 0.005

    # 2) Torso velocity
    score += torso_velo * 0.02

    # 3) Abduction @ footplant (negative factor)
    score += -1.0 * (abd_footplant * 2)

    # 4) Shoulder ER @ footplant piecewise
    if 35 <= shoulder_fp <= 75:
        score += 30
    elif 76 <= shoulder_fp <= 85:
        score += 15
    elif 86 <= shoulder_fp <= 95:
        score += 0
    elif 96 <= shoulder_fp <= 105:
        score -= 10
    elif shoulder_fp >= 106:
        score -= 20
    elif 25 <= shoulder_fp <= 34:
        score += 15
    elif 15 <= shoulder_fp <= 24:
        score += 0
    elif 5 <= shoulder_fp <= 14:
        score -= 10
    elif shoulder_fp < 5:
        score -= 20

    # 5) Max_ER piecewise
    er_score = 0
    if 180 <= max_er <= 210:
        er_score = 10
    elif 211 <= max_er <= 220:
        er_score = 0
    elif max_er > 220:
        er_score = -10
    elif max_er < 180:
        er_score = -10
    
    score += er_score

    return score


###############################################################################
# 5) INGEST DATA INTO movement_data TABLE (INSERT OR REPLACE so DB builds over time)
###############################################################################
def ingest_data(aPlusDataPath, aPlusEventsPath, db_path="actionPlus.sqlite"):
    events_dict = parse_events_from_aPlus(aPlusEventsPath, capture_rate=300)
    kinematics  = parse_aplus_kinematics(aPlusDataPath)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    insert_sql = """
    INSERT OR REPLACE INTO movement_data (
      filename, participant_name, test_date, movement_type,
      foot_contact_frame, release_frame,

      [Arm_Abduction@Footplant],
      [Max_Abduction],
      [Shoulder_Angle@Footplant],
      [Max_ER],
      [Arm_Velo],
      [Max_Torso_Rot_Velo],
      [Torso_Angle@Footplant],

      [Score]
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    for row in kinematics:
        fn = row.get("filename", "").strip()
        if not fn:
            continue
        fc = events_dict.get(fn, {}).get("foot_contact_frame")
        rel= events_dict.get(fn, {}).get("release_frame")
        p_name, p_date, m_type = parse_file_info(fn)

        # Pull the numeric fields from row
        abd_fp    = row.get("Arm_Abduction@Footplant") or 0
        max_abd   = row.get("Max_Abduction") or 0
        shld_fp   = row.get("Shoulder_Angle@Footplant") or 0
        max_er    = row.get("Max_ER") or 0
        arm_velo  = row.get("Arm_Velo") or 0
        torso_velo= row.get("Max_Torso_Rot_Velo") or 0
        torso_ang = row.get("Torso_Angle@Footplant") or 0

        # Compute the score
        score_val = compute_score(
            arm_velo,
            torso_velo,
            abd_fp,
            shld_fp,
            max_er
        )

        vals = [
            fn,
            p_name,
            p_date,
            m_type,
            fc,
            rel,

            abd_fp,
            max_abd,
            shld_fp,
            max_er,
            arm_velo,
            torso_velo,
            torso_ang,

            score_val  # <--- store it
        ]
        c.execute(insert_sql, vals)

    conn.commit()
    conn.close()


###############################################################################
# 6) Example main – adjust file paths as needed
###############################################################################
if __name__ == "__main__":
    from config import APLUS_EVENTS_PATH, APLUS_DATA_PATH
    DB_PATH = "actionPlus.sqlite"
    init_db(DB_PATH)
    ingest_data(APLUS_DATA_PATH, APLUS_EVENTS_PATH, DB_PATH)
    print("✅ Done. Check movement_data in actionPlus.sqlite.")

################################################################################
# 7) Create report
################################################################################

import os, shutil
import sqlite3
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Table, TableStyle

####################################################
# CONFIG
####################################################
from config import (
    OUTPUT_DIR, OUTPUT_DIR_TWO, LOGO_PATH,
    AP_TORSO_V_FILE, AP_ARM_V_FILE
)
DB_PATH = "actionPlus.sqlite"

# Image paths
ASSETS_DIR = r"C:\Users\q\PycharmProjects\Youth Pitch Design\assets"
IMG_FRONT_FP  = os.path.join(ASSETS_DIR, "Front@FP.png")
IMG_SAG_FP    = os.path.join(ASSETS_DIR, "sag@FP.png")
IMG_SAG_MAXER = os.path.join(ASSETS_DIR, "sag@MaxER.png")
IMG_SAG_REL   = os.path.join(ASSETS_DIR, "sag@Rel.png")

####################################################
# 1) DB / DATA HELPERS
####################################################
def get_report_data():
    conn = sqlite3.connect(DB_PATH)
    df_last = pd.read_sql_query(
        """
        SELECT participant_name, test_date
        FROM movement_data
        ORDER BY id DESC
        LIMIT 1
        """,
        conn
    )
    if df_last.empty:
        conn.close()
        raise ValueError("No data found in DB!")

    participant_name = df_last.iloc[0]["participant_name"]
    test_date        = df_last.iloc[0]["test_date"]

    # Now also get the average Score:
    query = f"""
    SELECT movement_type,
           AVG([Arm_Abduction@Footplant])     AS avg_abd,
           AVG([Max_Abduction])               AS avg_max_abd,
           AVG([Shoulder_Angle@Footplant])    AS avg_shoulder_fp,
           AVG([Max_ER])                      AS avg_max_er,
           AVG([Arm_Velo])                    AS avg_arm_velo,
           AVG([Max_Torso_Rot_Velo])          AS avg_torso_velo,
           AVG([Torso_Angle@Footplant])       AS avg_torso_angle,
           AVG([Score])                       AS avg_score   -- <--- new
    FROM movement_data
    WHERE participant_name = '{participant_name}'
      AND test_date        = '{test_date}'
    GROUP BY movement_type
    """
    df = pd.read_sql_query(query, conn)
    conn.close()

    # Sort by movement_type in a custom order
    order = ["Pitch", "Shortstop", "Catchers", "Crow Hop"]
    df["order"] = df["movement_type"].apply(lambda x: order.index(x) if x in order else 99)
    df = df.sort_values("order").drop(columns="order")
    return participant_name, test_date, df

def build_velocity_figure_all_frames(
    torso_txt,
    arm_txt,
    foot_contact_row,
    release_row
):
    """
    Plots the entire trial from frame=0 to frame=N-1 for both torso & arm velocity txt files.
    We skip top 7 lines, then treat columns>=2 as data.

    The x-axis is frames from 0..(N−1).
    We draw vertical gold lines at foot_contact_row-7 and release_row-7 if they're in range.

    This version sets the figure width=1600 & height=600 to make it wider and a bit taller.
    """
    # 1) Read TORSO (skip top 7 lines)
    df_torso = pd.read_csv(torso_txt, header=None, sep="\t").iloc[7:,:].copy()
    torso_data = df_torso.iloc[:, 2:].apply(pd.to_numeric, errors="coerce").abs()

    # 2) Read ARM
    df_arm = pd.read_csv(arm_txt, header=None, sep="\t").iloc[7:,:].copy()
    arm_data = df_arm.iloc[:, 2:].apply(pd.to_numeric, errors="coerce").abs()

    # 3) Number of total frames
    total_torso = len(torso_data)
    total_arm   = len(arm_data)
    total_rows  = max(total_torso, total_arm)

    x = np.arange(total_rows)

    def clamp_to_range(n, high):
        return max(0, min(n, high-1))

    if foot_contact_row is None:
        foot_contact_row = -9999
    if release_row is None:
        release_row = -9999

    foot_line = clamp_to_range(foot_contact_row - 7, total_rows)
    release_line = clamp_to_range(release_row - 7, total_rows)

    # 4) Build figure
    fig = go.Figure()
    fig.update_layout(
        width=1600,   # Widen the figure
        height=600,
        template="plotly_dark",
        title="Angular Velocities (Torso & Arm) – Full Trial Frames",
    )

    # TORSO => unify in one legend
    torso_cols = torso_data.columns
    for i, col_i in enumerate(torso_cols):
        y = torso_data[col_i].values
        show_legend = (i == 0)
        fig.add_trace(go.Scatter(
            x=x[:len(y)],
            y=y,
            mode="lines",
            name="Torso" if show_legend else None,
            line=dict(color="#d62728"),
            showlegend=show_legend,
            opacity=0.8
        ))

    # ARM => unify in one legend
    arm_cols = arm_data.columns
    for j, col_j in enumerate(arm_cols):
        y = arm_data[col_j].values
        show_legend = (j == 0)
        fig.add_trace(go.Scatter(
            x=x[:len(y)],
            y=y,
            mode="lines",
            name="Arm" if show_legend else None,
            line=dict(color="#2c99d4"),
            showlegend=show_legend,
            opacity=0.8
        ))

    combined = pd.concat([torso_data, arm_data], axis=1)
    y_min = float(np.nanmin(combined.values)) if not combined.empty else 0
    y_max = float(np.nanmax(combined.values)) if not combined.empty else 1

    # foot_contact line
    if 0 <= foot_line < total_rows:
        fig.add_shape(
            type="line",
            x0=foot_line,
            x1=foot_line,
            y0=y_min,
            y1=y_max,
            line=dict(color="gold", dash="dot", width=2)
        )

    # release line
    if 0 <= release_line < total_rows:
        fig.add_shape(
            type="line",
            x0=release_line,
            x1=release_line,
            y0=y_min,
            y1=y_max,
            line=dict(color="gold", dash="dash", width=3)
        )

    fig.update_layout(
        legend=dict(
            orientation="h",
            yanchor="bottom", y=1.02,
            xanchor="left",   x=0.05
        ),
        xaxis_title="Frames (0..end of trial)",
        yaxis_title="Velocity (absolute)"
    )
    return fig


####################################################
# 2) PDF GENERATION
####################################################
def generate_movement_report():
    # --- (A) RETRIEVE DB FRAMES ---
    conn = sqlite3.connect(DB_PATH)
    df_frames = pd.read_sql_query(
        """
        SELECT foot_contact_frame, release_frame
        FROM movement_data
        ORDER BY id DESC
        LIMIT 1
        """,
        conn
    )
    conn.close()

    if df_frames.empty:
        foot_contact_row = 0
        release_row      = 0
    else:
        foot_contact_row = df_frames.iloc[0]["foot_contact_frame"]
        release_row      = df_frames.iloc[0]["release_frame"]
        if pd.isna(foot_contact_row):
            foot_contact_row = 0
        if pd.isna(release_row):
            release_row = 0

    # --- (B) GET SUMMARY TABLE DATA ---
    participant_name, test_date, summary_df = get_report_data()

    # --- (C) BUILD & SAVE VELOCITY FIG ---
    fig_velo = build_velocity_figure_all_frames(
        AP_TORSO_V_FILE,
        AP_ARM_V_FILE,
        foot_contact_row,
        release_row
    )
    velo_png = "angular_velocity.png"
    fig_velo.write_image(velo_png)

    # --- (D) CREATE PDF ---
    page_width, page_height = 2000, 3200
    pdf_filename = os.path.join(OUTPUT_DIR, f"{participant_name} {test_date} Pitching Report.pdf")
    c = canvas.Canvas(pdf_filename, pagesize=(page_width, page_height))

    # BLACK BG
    c.setFillColorRGB(0,0,0)
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    brand_border = colors.HexColor("#4887a8")
    card_bg      = colors.HexColor("#1f1f1f")
    text_color   = colors.HexColor("#ffffff")

    # --- HEADER ---
    c.setFont("Helvetica-BoldOblique", 50)
    c.setFillColor(text_color)
    c.drawString(30, page_height - 60, "Movement Analysis Dashboard")

    c.setFont("Helvetica-Oblique", 34)
    c.drawString(30, page_height - 120, f"Athlete: {participant_name}")
    c.drawString(30, page_height - 170, f"Date: {test_date}")

    c.setStrokeColor(brand_border)
    c.setLineWidth(3)
    c.line(20, page_height - 185, page_width - 20, page_height - 185)

    # LOGO
    if os.path.exists(LOGO_PATH):
        c.drawImage(
            LOGO_PATH,
            page_width - 500,
            page_height - 180,
            width=398.06,
            height=160.03,
            preserveAspectRatio=True,
            mask='auto'
        )

    # --- TABLE OF AVERAGES ---
    table_df = summary_df.copy()
    # If your summary_df has a column 'avg_score' that you do NOT want in the table,
    # you can drop it. Or just rename everything except that column:
    table_df = table_df.rename(columns={
        "avg_abd":         "Abd @ FP",
        "avg_max_abd":     "Max Abd",
        "avg_shoulder_fp": "Arm Timing",
        "avg_max_er":      "Max ER",
        "avg_arm_velo":    "Arm Velo",
        "avg_torso_velo":  "Torso Velo",
        "avg_torso_angle": "Torso Ang@FP"
        # Note: if "avg_score" is in df, we won't rename it, or we can drop it:
        # "avg_score": "Score"  # or just not rename if we don't want it in the table
    })

    table_df = table_df.set_index("movement_type")
    desired_order = [mt for mt in ["Pitch", "Shortstop", "Catchers", "Crow Hop"] if mt in table_df.index]
    table_df = table_df.loc[desired_order]

    # Build list-of-lists for the table
    header_row = ["Movement Type"] + list(table_df.columns)
    table_data = [header_row]
    for mt, row in table_df.iterrows():
        row_vals = [mt]
        for col in table_df.columns:
            val = row[col]
            row_vals.append(f"{val:.1f}" if pd.notna(val) else "")
        table_data.append(row_vals)

    # Table coords & sizes
    table_card_x = 20
    table_card_y = page_height - 520
    table_card_w = page_width - 480
    table_card_h = 300

    # Draw the "card" for the table
    c.setFillColor(card_bg)
    c.setStrokeColor(brand_border)
    c.roundRect(table_card_x, table_card_y, table_card_w, table_card_h, 10, fill=1)

    # Table title
    c.setFillColor(text_color)
    c.setFont("Helvetica-BoldOblique", 34)
    c.drawString(table_card_x + 15, table_card_y + table_card_h - 40, "Movement Averages")

    # Build the actual table using ReportLab's Table
    from reportlab.platypus import Table, TableStyle
    t = Table(table_data, colWidths=[280] + [150]*(len(header_row)-1), rowHeights=48)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#333333")),
        ('TEXTCOLOR',  (0, 0), (-1, 0), text_color),
        ('FONTNAME',   (0, 0), (-1, 0), "Helvetica-Bold"),
        ('FONTSIZE',   (0, 0), (-1, 0), 20),
        ('ALIGN',      (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID',       (0, 0), (-1, -1), 1, colors.HexColor("#444444")),
        ('BACKGROUND', (0, 1), (-1, -1), colors.black),
        ('TEXTCOLOR',  (0, 1), (-1, -1), text_color),
        ('FONTNAME',   (0, 1), (-1, -1), "Helvetica"),
        ('FONTSIZE',   (0, 1), (-1, -1), 26),
    ]))
    tw, th = t.wrapOn(c, table_card_w-20, table_card_h-20)
    t.drawOn(c, table_card_x+25, table_card_y + table_card_h - 60 - th)

    ############################################################################
    # (1) Compute the final "stability_score" from summary_df["avg_score"]
    ############################################################################
    if "avg_score" in summary_df.columns and not summary_df.empty:
        stability_score = summary_df["avg_score"].mean()
    else:
        stability_score = 0.0

    ############################################################################
    # (2) Draw Score Box to the RIGHT of the table
    # So let's place it relative to table_card_x, table_card_y, etc.
    ############################################################################
    score_w = 340
    score_h = 300
    # place it 20 px to the right, and top-aligned
    score_x = table_card_x + table_card_w + 20
    score_y = table_card_y + (table_card_h - score_h)

    c.setFillColor(card_bg)
    c.setStrokeColor(brand_border)
    c.roundRect(score_x, score_y, score_w, score_h, 10, fill=1)

    c.setFillColor(text_color)

    c.setFont("Helvetica-Oblique", 24)
    c.drawString(score_x + 10, score_y + 20, "Higher = Better")

    c.setFont("Helvetica-BoldOblique", 40)
    c.drawString(score_x + 10, score_y + score_h - 40, "Kinematic Score")

    c.setFont("Helvetica-BoldOblique", 90)
    c.setFillColor(colors.HexColor("#32CD32"))  # lime color
    c.drawString(score_x + 40, score_y + 100, f"{stability_score:.1f}")

    ##########################################################
    # ANGULAR VELOCITIES TEXT + GRAPH IN ONE BOX
    ##########################################################
    def draw_wrapped_text(canvas_obj, text, x, y, max_width, font_name="Helvetica", font_size=24, leading=5):
        words = text.split()
        lines = []
        current_line = ""
        for word in words:
            test_line = f"{current_line} {word}".strip()
            if canvas_obj.stringWidth(test_line, font_name, font_size) <= max_width:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = word
        if current_line:
            lines.append(current_line)
        
        for i, line in enumerate(lines):
            canvas_obj.drawString(x, y - i*(font_size + leading), line)

    # We place the velocity box below the table, as usual
    top_text_graph_card_w = page_width - 100
    top_text_graph_card_h = 800
    top_text_graph_card_x = 50
    top_text_graph_card_y = table_card_y - top_text_graph_card_h - 30  # same small gap

    c.setFillColor(card_bg)
    c.setStrokeColor(brand_border)
    c.roundRect(top_text_graph_card_x, top_text_graph_card_y,
                top_text_graph_card_w, top_text_graph_card_h,
                10, fill=1)

    c.setFillColor(text_color)
    # Title
    c.setFont("Helvetica-Bold", 36)
    c.drawString(top_text_graph_card_x + 30, top_text_graph_card_y + top_text_graph_card_h - 50, 
                 "Angular Velocities")

    # Body text
    arm_text = (
        "Angular velocities are how fast the designated segment rotates around the proximal segment "
        "throughout the pitching motion. The kinematic sequence refers to sequential velocity peaks "
        "in the pelvis, torso, upper arm, forearm, and hand. Higher velocities in the trunk and arm "
        "have been linked to increased performance.\n\n"
        "This chart displays the entire trial's data (frame 0 through the final frame), with vertical "
        "gold lines at the foot contact and release frames if they exist."
    )

    c.setFont("Helvetica", 24)
    text_left  = top_text_graph_card_x + 30
    text_top   = top_text_graph_card_y + top_text_graph_card_h - 100
    max_width  = top_text_graph_card_w - 30
    draw_wrapped_text(c, arm_text, text_left, text_top, max_width, font_size=24)

    graph_img_y = top_text_graph_card_y + 50
    graph_img_h = 550
    graph_side_margin = 10
    graph_img_w = top_text_graph_card_w - (graph_side_margin * 2)

    c.drawImage(
        velo_png,
        text_left, 
        graph_img_y,  
        width=graph_img_w,
        height=graph_img_h,
        preserveAspectRatio=True,
        mask='auto'
    )

    # Move the next sections up...
    current_y = top_text_graph_card_y - 30

    def draw_text_image_block(title_str, body_str, image_paths=None, box_height=700):
        nonlocal current_y
        card_w = page_width - 100
        card_h = box_height
        card_x = 50
        card_y = current_y - card_h

        c.setFillColor(card_bg)
        c.setStrokeColor(brand_border)
        c.roundRect(card_x, card_y, card_w, card_h, 10, fill=1)

        c.setFillColor(text_color)
        c.setFont("Helvetica-Bold", 36)
        c.drawString(card_x + 30, card_y + card_h - 50, title_str)

        c.setFont("Helvetica", 24)
        text_left = card_x + 30
        text_top  = card_y + card_h - 100
        max_text_width = card_w - 60
        draw_wrapped_text(c, body_str, text_left, text_top, max_width=max_text_width, font_size=24)

        # Move images further down
        img_y_offset = 20  
        img_y = card_y + img_y_offset
        img_w = 650
        img_h = 500
        if image_paths:
            if len(image_paths) == 1:
                # center
                img_x = card_x + (card_w - img_w)/2
                c.drawImage(image_paths[0], img_x, img_y,
                            width=img_w, height=img_h,
                            preserveAspectRatio=True, mask='auto')
            elif len(image_paths) == 2:
                spacing = (card_w - 2*img_w) / 3
                left_img_x  = card_x + spacing
                right_img_x = card_x + spacing*2 + img_w
                c.drawImage(image_paths[0], left_img_x, img_y,
                            width=img_w, height=img_h,
                            preserveAspectRatio=True, mask='auto')
                c.drawImage(image_paths[1], right_img_x, img_y,
                            width=img_w, height=img_h,
                            preserveAspectRatio=True, mask='auto')

        current_y = card_y - 60
        return current_y

    # Horizontal Abduction
    ha_title = "Horizontal Abduction"
    ha_text  = (
        "Horizontal abduction is how far behind the body the arm/elbow gets during the pitching motion. "
        "Commonly referred to as the 'loading' of the arm, horizontal abduction has been linked to both velocity "
        "and arm health.\n\n"
        "Front@FP.png      Sag@FP.png"
    )
    draw_text_image_block(ha_title, ha_text, [IMG_FRONT_FP, IMG_SAG_FP], box_height=720)

    # Shoulder External Rotation
    ser_title = "Shoulder External Rotation"
    ser_text  = (
        "Shoulder external rotation is measured at both footplant and as a max value during the pitching motion. "
        "Shoulder external rotation at footplant is often referred to as 'arm timing.' An on-time arm is between "
        "33 and 77 degrees. Anything lower than 33 is deemed late; above 77 is deemed early.\n\n"
        "Max External rotation (often called layback) is how much the arm externally rotates during "
        "the pitching motion. A higher max ER has been linked to both arm health and velocity.\n\n"
        "Sag@MaxER.png      sag@Rel.png"
    )
    draw_text_image_block(ser_title, ser_text, [IMG_SAG_MAXER, IMG_SAG_REL], box_height=720)

    c.showPage()
    c.save()
    print(f"✅ PDF saved to: {pdf_filename}")

    for extra_dir in (OUTPUT_DIR_TWO,):
        os.makedirs(extra_dir, exist_ok=True)
        shutil.copy2(pdf_filename, os.path.join(extra_dir, os.path.basename(pdf_filename)))
    
if __name__ == "__main__":
    generate_movement_report()

