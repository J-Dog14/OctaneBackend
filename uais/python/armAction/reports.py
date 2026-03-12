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
    AP_TORSO_V_FILE, AP_ARM_V_FILE,
    IMG_FRONT_FP, IMG_SAG_FP, IMG_SAG_MAXER, IMG_SAG_REL
)


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


def build_velocity_figure_all_frames(
    torso_txt,
    arm_txt,
    foot_contact_row,
    release_row
):
    """
    Plot the entire trial from frame=0 to frame=N-1 for both torso & arm velocity txt files.
    We skip top 7 lines, then treat columns>=2 as data.

    The x-axis is frames from 0..(N-1).
    We draw vertical gold lines at foot_contact_row-7 and release_row-7 if they're in range.

    This version sets the figure width=1600 & height=600 to make it wider and a bit taller.
    
    Args:
        torso_txt: Path to torso velocity text file
        arm_txt: Path to arm velocity text file
        foot_contact_row: Frame number for foot contact
        release_row: Frame number for release
        
    Returns:
        plotly.graph_objects.Figure: The velocity figure
    """
    # 1) Read TORSO (skip top 7 lines)
    df_torso = pd.read_csv(torso_txt, header=None, sep="\t").iloc[7:,:].copy()
    torso_data = df_torso.iloc[:, 2:].apply(pd.to_numeric, errors="coerce").abs()

    # 2) Read ARM
    df_arm = pd.read_csv(arm_txt, header=None, sep="\t").iloc[7:,:].copy()
    arm_data = df_arm.iloc[:, 2:].apply(pd.to_numeric, errors="coerce").abs()

    # 3) Number of total frames
    total_torso = len(torso_data)
    total_arm = len(arm_data)
    total_rows = max(total_torso, total_arm)

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
            xanchor="left", x=0.05
        ),
        xaxis_title="Frames (0..end of trial)",
        yaxis_title="Velocity (absolute)"
    )
    return fig


def generate_movement_report():
    """Generate the PDF movement analysis report."""
    from common.config import get_warehouse_engine
    
    engine = get_warehouse_engine()
    
    # --- (A) RETRIEVE DB FRAMES ---
    # Get the most recent record from warehouse
    df_frames = pd.read_sql_query(
        """
        SELECT foot_contact_frame, release_frame
        FROM public.f_arm_action
        ORDER BY id DESC
        LIMIT 1
        """,
        engine
    )

    if df_frames.empty:
        foot_contact_row = 0
        release_row = 0
    else:
        foot_contact_row = df_frames.iloc[0]["foot_contact_frame"]
        release_row = df_frames.iloc[0]["release_frame"]
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
        "This chart displays the entire trial's data (frame 0 through the final frame), with vertical "
        "gold lines at the foot contact and release frames if they exist."
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
        "and arm health.\n\n"
        "Front@FP.png      Sag@FP.png"
    )
    draw_text_image_block(ha_title, ha_text, [IMG_FRONT_FP, IMG_SAG_FP], box_height=720)

    # Shoulder External Rotation
    ser_title = "Shoulder External Rotation"
    ser_text = (
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
    print(f"PDF saved to: {pdf_filename}")

    # Copy to secondary output directory
    for extra_dir in (OUTPUT_DIR_TWO,):
        os.makedirs(extra_dir, exist_ok=True)
        shutil.copy2(pdf_filename, os.path.join(extra_dir, os.path.basename(pdf_filename)))

