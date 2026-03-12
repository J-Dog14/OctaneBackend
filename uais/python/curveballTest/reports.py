"""
Report generation functions for creating PDF reports with graphs and tables.
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
from reportlab.platypus import Table, TableStyle
from pathlib import Path

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_warehouse_engine
from config import OUTPUT_DIR, OUTPUT_DIR_TWO, LOGO_PATH


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
    # 1) GATHER DATA FROM THE WAREHOUSE
    # -------------------------------------------
    engine = get_warehouse_engine()
    
    # Get the most recent record from warehouse
    df_last = pd.read_sql_query(
        """
        SELECT 
            a.name as participant_name, 
            ct.session_date as pitch_date
        FROM public.f_curveball_test ct
        JOIN analytics.d_athletes a ON ct.athlete_uuid = a.athlete_uuid
        ORDER BY ct.id DESC
        LIMIT 1
        """,
        engine
    )
    if df_last.empty:
        raise ValueError("No data found in warehouse!")

    participant_name = df_last.iloc[0]["participant_name"]
    test_date = df_last.iloc[0]["pitch_date"]

    # All curve pitches for that participant/date
    # Query all columns including the 306 angle/accel columns
    offsets = list(range(-20, 31))
    angle_cols = []
    for off in offsets:
        lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
        angle_cols.extend([f"ct.x_{lbl} as x_{lbl}", f"ct.y_{lbl} as y_{lbl}", 
                          f"ct.z_{lbl} as z_{lbl}", f"ct.ax_{lbl} as ax_{lbl}", 
                          f"ct.ay_{lbl} as ay_{lbl}", f"ct.az_{lbl} as az_{lbl}"])
    
    # Build SELECT statement with all columns
    select_cols = [
        "ct.id", "ct.athlete_uuid", "ct.session_date", "ct.source_system",
        "ct.source_athlete_id", "ct.filename", "ct.pitch_type",
        "ct.foot_contact_frame", "ct.release_frame", "ct.pitch_stability_score",
        "a.name as participant_name"
    ]
    select_cols.extend(angle_cols)
    
    df_curves = pd.read_sql_query(f"""
        SELECT 
            {", ".join(select_cols)}
        FROM public.f_curveball_test ct
        JOIN analytics.d_athletes a ON ct.athlete_uuid = a.athlete_uuid
        WHERE a.name = %s
          AND ct.session_date = %s
          AND ct.pitch_type = 'Curve'
    """, engine, params=(participant_name, test_date))
    
    if df_curves.empty:
        raise ValueError(f"No Curve data for {participant_name} on {test_date}.")
    
    # Average stability
    df_avg = pd.read_sql_query("""
        SELECT AVG(pitch_stability_score) AS avg_score
        FROM public.f_curveball_test ct
        JOIN analytics.d_athletes a ON ct.athlete_uuid = a.athlete_uuid
        WHERE a.name = %s
          AND ct.session_date = %s
          AND ct.pitch_type = 'Curve'
    """, engine, params=(participant_name, test_date))

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
    # Note: Reference data is still stored in SQLite (managed separately via updateReferenceData.py)
    # For now, we'll try to read from SQLite if the database exists, otherwise use empty DataFrame
    import sqlite3
    from config import DB_PATH
    
    df_ref_curves = pd.DataFrame()
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            df_ref_curves = pd.read_sql_query("""
                SELECT * FROM reference_data WHERE pitch_type='Curve'
            """, conn)
            conn.close()
        except Exception as e:
            print(f"Warning: Could not read reference data: {e}")
            df_ref_curves = pd.DataFrame()

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
    # Try D: (OUTPUT_DIR) first, then G: (OUTPUT_DIR_TWO) if permission denied (e.g. network drive from laptop)
    base_filename = f"{participant_name} {test_date} Curve Ball Report.pdf"

    def _pick_writable_path():
        for output_dir in (OUTPUT_DIR, OUTPUT_DIR_TWO):
            os.makedirs(output_dir, exist_ok=True)
            path = os.path.join(output_dir, base_filename)
            counter = 1
            while os.path.exists(path):
                name_without_ext = base_filename.replace(".pdf", "")
                path = os.path.join(output_dir, f"{name_without_ext} ({counter}).pdf")
                counter += 1
            try:
                with open(path, "wb") as _:
                    pass
                os.remove(path)
                return path, output_dir
            except (PermissionError, OSError):
                continue
        return os.path.join(OUTPUT_DIR, base_filename), OUTPUT_DIR

    pdf_path, pdf_output_dir = _pick_writable_path()
    if pdf_output_dir == OUTPUT_DIR_TWO:
        print(f"Using G: drive (D: not writable): {pdf_path}")

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

    # Copy to the other output directory only if we didn't already write there (and if it's writable)
    if pdf_output_dir == OUTPUT_DIR:
        try:
            os.makedirs(OUTPUT_DIR_TWO, exist_ok=True)
            shutil.copy2(pdf_path, os.path.join(OUTPUT_DIR_TWO, os.path.basename(pdf_path)))
        except (PermissionError, OSError):
            print("Could not copy to G: (secondary); PDF is only on D:.")


def build_time_series_figure(df_curves, title, prefix, color, df_reference=None, force_axis_start_at_zero=True):
    """Build a time series figure for a specific metric (x, y, or z)."""
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

