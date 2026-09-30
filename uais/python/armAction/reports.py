"""
PDF report generation functions for Action Plus analysis.
Now reads from warehouse database.
"""

import os
import sys
import shutil
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Table, TableStyle
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_warehouse_engine
from config import (
    OUTPUT_DIR, OUTPUT_DIR_TWO, LOGO_PATH,
    AP_TORSO_V_FILE, AP_ARM_V_FILE, CAPTURE_RATE,
    IMG_FRONT_FP, IMG_SAG_FP, IMG_SAG_MAXER, IMG_SAG_REL
)
from database import get_session_trial_events


def get_report_data():
    """
    Retrieve summary data from warehouse database for report generation.
    Gets the most recent session data from f_arm_action table.
    
    Returns:
        tuple: (participant_name, test_date, summary_df)
    """
    from common.config import get_warehouse_engine
    
    engine = get_warehouse_engine()
    
    # Get the most recent record from warehouse table
    df_last = pd.read_sql_query(
        """
        SELECT 
            a.name as participant_name, 
            aa.session_date
        FROM public.f_arm_action aa
        JOIN analytics.d_athletes a ON aa.athlete_uuid = a.athlete_uuid
        ORDER BY aa.id DESC
        LIMIT 1
        """,
        engine
    )
    
    if df_last.empty:
        raise ValueError("No data found in warehouse! Make sure data has been ingested.")
    
    participant_name = df_last.iloc[0]["participant_name"]
    test_date = df_last.iloc[0]["session_date"]
    
    # Get the average metrics grouped by movement_type for this session
    query = """
    SELECT 
        aa.movement_type,
        AVG(aa.arm_abduction_at_footplant)     AS avg_abd,
        AVG(aa.max_abduction)                  AS avg_max_abd,
        AVG(aa.shoulder_angle_at_footplant)    AS avg_shoulder_fp,
        AVG(aa.max_er)                         AS avg_max_er,
        AVG(aa.arm_velo)                       AS avg_arm_velo,
        AVG(aa.max_torso_rot_velo)             AS avg_torso_velo,
        AVG(aa.torso_angle_at_footplant)       AS avg_torso_angle,
        AVG(aa.score)                          AS avg_score
    FROM public.f_arm_action aa
    JOIN analytics.d_athletes a ON aa.athlete_uuid = a.athlete_uuid
    WHERE a.name = %s
      AND aa.session_date = %s
    GROUP BY aa.movement_type
    """
    df = pd.read_sql_query(query, engine, params=(participant_name, test_date))
    
    # Sort by movement_type in a custom order
    order = ["Pitch", "Shortstop", "Catchers", "Crow Hop", "From Knees"]
    df["order"] = df["movement_type"].apply(lambda x: order.index(x) if x in order else 99)
    df = df.sort_values("order").drop(columns="order")
    
    return participant_name, str(test_date), df


def _read_curve_file_with_trials(txt_path):
    """
    Read a Visual3D ASCII curve export that has ONE data column per trial
    (e.g. Torso_Rot_Velo or the Z-only Pitching_Shoulder_Velo exports used
    here), keyed by the trial's filename so it can be matched against the
    per-trial foot_contact_frame/release_frame stored in the warehouse.

    File layout (fixed, matches the rest of this module's "-7" convention):
      row 0: leading blank cell + one full c3d path per trial column
      rows 1-3: variable name / LINK_MODEL_BASED / PROCESSED metadata
      row 4: "ITEM" label row (component labels, e.g. Y/Y/Y/Y)
      rows 5+: ITEM number in column 0, one value per trial in columns 1..N

    Row index 7 of the raw file (0-indexed) is the first data row this
    module has always treated as "x=0" -- kept as-is here so existing
    foot_contact_frame/release_frame values (computed elsewhere as
    event_seconds * CAPTURE_RATE) stay comparable via the same "-7" offset.

    Returns:
        dict[str, pd.Series]: filename -> velocity series (abs value),
        indexed 0..N-1 in the same coordinate system as the "-7" offset.
    """
    raw = pd.read_csv(txt_path, header=None, sep="\t")
    filenames_row = raw.iloc[0]
    data = raw.iloc[7:, :].reset_index(drop=True)
    data = data.apply(pd.to_numeric, errors="coerce")

    series_by_file = {}
    # Column 0 is the ITEM/index column -- skip it. Every remaining column
    # is one trial (previously this code sliced from column 2, which
    # silently dropped the first trial's curve from the chart).
    for col in data.columns[1:]:
        fn = str(filenames_row[col]).strip()
        if not fn or fn.lower() == "nan":
            continue
        series_by_file[fn] = data[col].abs()
    return series_by_file


def build_velocity_figure_aligned(torso_txt, arm_txt, trial_events):
    """
    Time-aligned angular velocity chart: every trial's torso & arm curves
    are shifted so that trial's OWN foot-contact event lands at x=0, then
    converted to milliseconds via CAPTURE_RATE. This makes trials of
    different lengths directly comparable, instead of overlaying them on a
    shared raw-frame axis where each trial's foot contact/release fall at
    different points.

    Args:
        torso_txt: Path to torso velocity text file
        arm_txt: Path to arm velocity text file
        trial_events: list of dicts with keys 'filename',
            'foot_contact_frame', 'release_frame' -- one entry per trial in
            the current session (as returned by database.get_session_trial_events)

    Returns:
        plotly.graph_objects.Figure: The velocity figure
    """
    torso_by_file = _read_curve_file_with_trials(torso_txt)
    arm_by_file = _read_curve_file_with_trials(arm_txt)

    ms_per_frame = 1000.0 / CAPTURE_RATE

    fig = go.Figure()
    legend_shown = {"Torso": False, "Arm": False}
    all_y = []
    release_offsets_ms = []

    for trial in trial_events or []:
        fn = trial.get("filename")
        fc = trial.get("foot_contact_frame")
        rel = trial.get("release_frame")
        if not fn or fc is None:
            continue

        # Same "-7" row-offset convention used everywhere else in this module.
        fc_pos = fc - 7

        for series_map, label, color in (
            (torso_by_file, "Torso", "#d62728"),
            (arm_by_file, "Arm", "#2c99d4"),
        ):
            series = series_map.get(fn)
            if series is None or series.empty:
                continue
            x_ms = (np.arange(len(series)) - fc_pos) * ms_per_frame
            y = series.values
            all_y.append(y)
            fig.add_trace(go.Scatter(
                x=x_ms,
                y=y,
                mode="lines",
                name=label if not legend_shown[label] else None,
                line=dict(color=color),
                showlegend=not legend_shown[label],
                opacity=0.75
            ))
            legend_shown[label] = True

        if rel is not None:
            release_offsets_ms.append((rel - fc) * ms_per_frame)

    if all_y:
        combined = np.concatenate(all_y)
        y_min = float(np.nanmin(combined))
        y_max = float(np.nanmax(combined))
    else:
        y_min, y_max = 0, 1

    # Foot contact is x=0 for every trial by construction.
    fig.add_shape(
        type="line",
        x0=0, x1=0, y0=y_min, y1=y_max,
        line=dict(color="gold", dash="dot", width=2)
    )
    fig.add_annotation(
        x=0, y=y_max, text="Foot Contact", showarrow=False,
        yshift=15, font=dict(color="gold", size=14)
    )

    # Release timing varies rep to rep, so we mark the average rather than
    # cluttering the chart with one dashed line per trial.
    if release_offsets_ms:
        avg_release_ms = float(np.mean(release_offsets_ms))
        fig.add_shape(
            type="line",
            x0=avg_release_ms, x1=avg_release_ms, y0=y_min, y1=y_max,
            line=dict(color="gold", dash="dash", width=2)
        )
        fig.add_annotation(
            x=avg_release_ms, y=y_max, text="Release (avg)", showarrow=False,
            yshift=15, font=dict(color="gold", size=14)
        )

    fig.update_layout(
        width=1600,
        height=600,
        template="plotly_dark",
        title="Angular Velocities (Torso & Arm) – Aligned to Foot Contact",
        legend=dict(
            orientation="h",
            yanchor="bottom", y=1.02,
            xanchor="left", x=0.05
        ),
        xaxis_title="Time relative to Foot Contact (ms)",
        yaxis_title="Velocity (absolute)"
    )
    return fig


def generate_movement_report():
    """Generate the PDF movement analysis report."""
    # --- (A) GET SUMMARY TABLE DATA ---
    participant_name, test_date, summary_df = get_report_data()

    # --- (B) RETRIEVE PER-TRIAL EVENTS FOR THE CURRENT SESSION ---
    # Each trial in the current session has its own foot_contact_frame /
    # release_frame, keyed by filename, so the velocity chart can align
    # every trial to its own foot contact instead of a single shared frame.
    # Read from the permanent f_arm_action table (not the ingest-time temp
    # table, which only exists on the connection that created it and is
    # long closed by the time this runs).
    session_rows = get_session_trial_events(participant_name, test_date)

    pitch_rows = [r for r in session_rows if r.get("movement_type") == "Pitch"]
    trial_source_rows = pitch_rows if pitch_rows else session_rows
    trial_events = [
        {
            "filename": r.get("filename"),
            "foot_contact_frame": r.get("foot_contact_frame"),
            "release_frame": r.get("release_frame"),
        }
        for r in trial_source_rows
    ]

    # --- (C) BUILD & SAVE VELOCITY FIG ---
    fig_velo = build_velocity_figure_aligned(
        AP_TORSO_V_FILE,
        AP_ARM_V_FILE,
        trial_events
    )
    velo_png = "angular_velocity.png"
    
    # Try to export image with error handling
    try:
        fig_velo.write_image(velo_png)
    except Exception as e:
        print(f"Warning: Image export failed: {e}")
        print("Attempting SVG format as fallback...")
        try:
            velo_svg = velo_png.replace('.png', '.svg')
            fig_velo.write_image(velo_svg, format='svg')
            velo_png = velo_svg
            print(f"Successfully exported as SVG: {velo_svg}")
        except Exception as e2:
            print(f"Error: Both PNG and SVG export failed. {e2}")
            print("Skipping velocity graph in PDF...")
            velo_png = None  # Set to None so we can skip drawing it

    # --- (D) CREATE PDF ---
    page_width, page_height = 2000, 3200
    
    # Generate filename, adding a number suffix if file already exists
    base_filename = f"{participant_name} {test_date} Pitching Report.pdf"
    pdf_filename = os.path.join(OUTPUT_DIR, base_filename)
    
    # If file exists, add a number suffix (e.g., "Report (1).pdf", "Report (2).pdf")
    counter = 1
    while os.path.exists(pdf_filename):
        name_without_ext = base_filename.replace(".pdf", "")
        pdf_filename = os.path.join(OUTPUT_DIR, f"{name_without_ext} ({counter}).pdf")
        counter += 1
    
    c = canvas.Canvas(pdf_filename, pagesize=(page_width, page_height))

    # BLACK BG
    c.setFillColorRGB(0, 0, 0)
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    brand_border = colors.HexColor("#4887a8")
    card_bg = colors.HexColor("#1f1f1f")
    text_color = colors.HexColor("#ffffff")

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
    table_df = table_df.rename(columns={
        "avg_abd": "Abd @ FP",
        "avg_max_abd": "Max Abd",
        "avg_shoulder_fp": "Arm Timing",
        "avg_max_er": "Max ER",
        "avg_arm_velo": "Arm Velo",
        "avg_torso_velo": "Torso Velo",
        "avg_torso_angle": "Torso Ang@FP"
    })

    table_df = table_df.set_index("movement_type")
    desired_order = [mt for mt in ["Pitch", "Shortstop", "Catchers", "Crow Hop", "From Knees"] if mt in table_df.index]
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
    t = Table(table_data, colWidths=[280] + [150]*(len(header_row)-1), rowHeights=48)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#333333")),
        ('TEXTCOLOR', (0, 0), (-1, 0), text_color),
        ('FONTNAME', (0, 0), (-1, 0), "Helvetica-Bold"),
        ('FONTSIZE', (0, 0), (-1, 0), 20),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#444444")),
        ('BACKGROUND', (0, 1), (-1, -1), colors.black),
        ('TEXTCOLOR', (0, 1), (-1, -1), text_color),
        ('FONTNAME', (0, 1), (-1, -1), "Helvetica"),
        ('FONTSIZE', (0, 1), (-1, -1), 26),
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
    ############################################################################
    score_w = 340
    score_h = 300
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

    # We place the velocity box below the table
    top_text_graph_card_w = page_width - 100
    top_text_graph_card_h = 800
    top_text_graph_card_x = 50
    top_text_graph_card_y = table_card_y - top_text_graph_card_h - 30

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
        "Every pitch is time-aligned to its own foot contact (gold dotted line at 0 ms), so timing and "
        "peaks are directly comparable across throws even when each pitch takes a different amount of "
        "time. The gold dashed line marks the average release time across pitches."
    )

    c.setFont("Helvetica", 24)
    text_left = top_text_graph_card_x + 30
    text_top = top_text_graph_card_y + top_text_graph_card_h - 100
    max_width = top_text_graph_card_w - 30
    draw_wrapped_text(c, arm_text, text_left, text_top, max_width, font_size=24)

    graph_img_y = top_text_graph_card_y + 50
    graph_img_h = 550
    graph_side_margin = 10
    graph_img_w = top_text_graph_card_w - (graph_side_margin * 2)

    if velo_png: # Only draw image if velo_png is not None
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
        text_top = card_y + card_h - 100
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
                left_img_x = card_x + spacing
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
    ha_text = (
        "Horizontal abduction is how far behind the body the arm/elbow gets during the pitching motion. "
        "Commonly referred to as the 'loading' of the arm, horizontal abduction has been linked to both velocity "
        "and arm health."
    )
    draw_text_image_block(ha_title, ha_text, [IMG_FRONT_FP, IMG_SAG_FP], box_height=720)

    # Shoulder External Rotation
    ser_title = "Shoulder External Rotation"
    ser_text = (
        "Shoulder external rotation is measured at both footplant and as a max value during the pitching motion. "
        "Shoulder external rotation at footplant is often referred to as 'arm timing.' An on-time arm is between "
        "33 and 77 degrees. Anything lower than 33 is deemed late; above 77 is deemed early.\n\n"
        "Max External rotation (often called layback) is how much the arm externally rotates during "
        "the pitching motion. A higher max ER has been linked to both arm health and velocity."
    )
    draw_text_image_block(ser_title, ser_text, [IMG_SAG_MAXER, IMG_SAG_REL], box_height=720)

    c.showPage()
    c.save()
    print(f"PDF saved to: {pdf_filename}")

    # Copy to secondary output directory
    for extra_dir in (OUTPUT_DIR_TWO,):
        os.makedirs(extra_dir, exist_ok=True)
        shutil.copy2(pdf_filename, os.path.join(extra_dir, os.path.basename(pdf_filename)))

