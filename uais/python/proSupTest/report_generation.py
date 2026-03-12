"""
Report generation for Pro-Sup Test.
Generates PDF reports with charts and analysis.

NOTE: This module contains the full report generation code from the original
process_raw.py (lines 238-487). It can be further refactored into sub-modules
if needed (e.g., report_plots.py, report_pdf.py).
"""
import os
import sqlite3
import pandas as pd
import plotly.graph_objects as go
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from typing import Optional


# Report configuration constants
ACCENT_HEX = "#4887a8"       # teal
MUTED_HEX = "#586c7b"        # muted blue-gray
SHADOW_HEX = "#0a0d10"        # shadow color


def pct_color(p: float) -> str:
    """
    Get color based on percentile value.
    
    Args:
        p: Percentile value (0-100).
    
    Returns:
        Color name ('red', 'yellow', or 'limegreen').
    """
    if p < 33:
        return "red"
    if p < 67:
        return "yellow"
    return "limegreen"


def ring_gauge(pct: float, file_path: str, size: int = 240) -> str:
    """
    Generate a ring gauge (pie chart) showing percentile.
    
    Args:
        pct: Percentile value (0-100).
        file_path: Output file path for the image.
        size: Size of the image in pixels.
    
    Returns:
        Path to the generated image file.
    """
    import tempfile
    
    # Ensure file_path is absolute and in temp directory
    if not os.path.isabs(file_path):
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, file_path)
    
    pct = max(0, min(100, pct))
    fig = go.Figure(go.Pie(
        values=[pct, 100-pct],
        hole=0.78,
        marker=dict(colors=[pct_color(pct), "#303030"]),
        sort=False,
        direction="clockwise",
        textinfo="none"
    ))
    fig.add_annotation(
        text=f"<b>{int(pct)}%</b>",
        font=dict(size=size*0.13, color="white"),
        showarrow=False
    )
    fig.update_layout(
        margin=dict(l=0, r=0, t=0, b=0),
        paper_bgcolor="black",
        showlegend=False
    )
    
    try:
        fig.write_image(file_path, width=size, height=size, engine="kaleido")
    except Exception as e:
        # Fallback: try without specifying engine
        try:
            fig.write_image(file_path, width=size, height=size)
        except Exception as e2:
            raise RuntimeError(f"Failed to export plotly image. Make sure kaleido is installed: pip install kaleido. Error: {e2}")
    
    return file_path


def rom_bars(rom0: float, rom1: float, rom2: float, 
            highlight_idx: int, file_path: str, 
            size: tuple = (120, 120)) -> str:
    """
    Generate 3-bar vertical ROM chart.
    
    Args:
        rom0: ROM value for interval 0-10s.
        rom1: ROM value for interval 10-20s.
        rom2: ROM value for interval 20-30s.
        highlight_idx: Index of bar to highlight (0, 1, or 2).
        file_path: Output file path for the image.
        size: Image size as (width, height) tuple.
    
    Returns:
        Path to the generated image file.
    """
    import tempfile
    
    # Ensure file_path is absolute and in temp directory
    if not os.path.isabs(file_path):
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, file_path)
    
    vals = [rom0, rom1, rom2]
    bar_colors = [MUTED_HEX] * 3
    bar_colors[highlight_idx] = ACCENT_HEX

    fig = go.Figure(go.Bar(
        x=["0", "1", "2"],  # dummy labels (hidden)
        y=vals,
        marker_color=bar_colors,
        width=0.9,  # bar covers 90% of slot
        hoverinfo="none",
    ))
    fig.update_layout(
        bargap=0.02,  # ~1px gap
        bargroupgap=0,
        xaxis=dict(visible=False, fixedrange=True),
        yaxis=dict(visible=False, fixedrange=True),
        margin=dict(l=0, r=0, t=0, b=0),
        paper_bgcolor="black",
        plot_bgcolor="black",
    )
    
    try:
        fig.write_image(file_path, width=size[0], height=size[1], engine="kaleido")
    except Exception as e:
        # Fallback: try without specifying engine
        try:
            fig.write_image(file_path, width=size[0], height=size[1])
        except Exception as e2:
            raise RuntimeError(f"Failed to export plotly image. Make sure kaleido is installed: pip install kaleido. Error: {e2}")
    
    return file_path


def load_report_data(db_path: str) -> pd.DataFrame:
    """
    Load data for report generation.
    
    Args:
        db_path: Path to database.
    
    Returns:
        DataFrame with report data.
    """
    query = """
    SELECT name, test_date,
           tot_rom_0to10, tot_rom_10to20, tot_rom_20to30,
           fatigue_index_10, fatigue_index_20, fatigue_index_30,
           total_score, forearm_rom_0to10, forearm_rom_10to20, forearm_rom_20to30
    FROM pro_sup_data
    """
    
    with sqlite3.connect(db_path) as conn:
        df = pd.read_sql_query(query, conn)
    
    df["test_date"] = pd.to_datetime(df["test_date"])
    
    # Convert numeric columns
    numeric_cols = [
        "tot_rom_0to10", "tot_rom_10to20", "tot_rom_20to30",
        "forearm_rom_0to10", "forearm_rom_10to20", "forearm_rom_20to30",
        "fatigue_index_10", "fatigue_index_20", "fatigue_index_30",
        "total_score"
    ]
    df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors="coerce")
    
    return df


def generate_pdf_report(athlete_name: str, test_date: str, 
                       db_path: str, output_dir: str,
                       logo_path: Optional[str] = None):
    """
    Generate PDF report for an athlete.
    
    Args:
        athlete_name: Name of the athlete.
        test_date: Test date string.
        db_path: Path to database.
        output_dir: Directory for output report.
        logo_path: Optional path to logo image.
    
    Returns:
        Path to generated PDF file.
    """
    from score_calculation import add_percentile_columns
    
    # Load and prepare data
    df = load_report_data(db_path)
    df = add_percentile_columns(df)
    
    # Filter for target athlete and date
    target_date = pd.to_datetime(test_date)
    df_target = df[
        (df["name"] == athlete_name) &
        (df["test_date"] == target_date)
    ]
    
    if df_target.empty:
        raise RuntimeError(
            f"No row in the DB matches name='{athlete_name}' "
            f"and test_date='{test_date}'."
        )
    
    row = df_target.iloc[0]
    date_str = row["test_date"].date().isoformat()
    
    # Create output path
    os.makedirs(output_dir, exist_ok=True)
    pdf_out = os.path.join(output_dir, f"{athlete_name} {date_str} Performance Report.pdf")
    
    # Build PDF
    c = canvas.Canvas(pdf_out, pagesize=letter)
    W, H = letter
    tmp = []  # collect temp PNGs for cleanup
    
    # Background
    c.setFillColor(colors.HexColor("#0e1116"))  # deep slate-gray
    c.rect(0, 0, W, H, stroke=0, fill=1)
    
    # Vertical teal bar
    ACCENT = colors.HexColor(ACCENT_HEX)
    c.setFillColor(ACCENT)
    c.rect(10, 0, 6, H, stroke=0, fill=1)
    
    # Header
    if logo_path and os.path.exists(logo_path):
        img = ImageReader(logo_path)
        iw, ih = img.getSize()
        target_w = 140
        scale = target_w / iw
        target_h = ih * scale
        
        c.drawImage(
            logo_path,
            W - target_w - 20,
            H - target_h - 20,
            width=target_w,
            height=target_h,
            mask='auto'
        )
    
    c.setFont("Helvetica-BoldOblique", 18)
    c.setFillColor(colors.white)
    c.drawString(30, H-40, f"Name: {athlete_name}")
    c.drawString(30, H-60, f"Test Date: {date_str}")
    
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2)
    c.line(20, H-75, W-20, H-75)
    
    # Card layout helpers
    card_x, card_w = 40, W - 80
    shadow_off, card_radius = 4, 10
    y = H - 100
    
    SHADOW = colors.HexColor(SHADOW_HEX)
    
    def draw_card_shadow(y_top, h):
        c.setFillColor(SHADOW)
        c.roundRect(card_x+shadow_off, y_top-h-shadow_off,
                    card_w, h, card_radius, fill=1, stroke=0)
    
    def draw_card(y_top, h):
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.white)
        c.roundRect(card_x, y_top-h, card_w, h, card_radius, fill=1, stroke=1)
    
    # Score card
    score_h = 124
    draw_card_shadow(y, score_h)
    draw_card(y, score_h)
    
    c.setFont("Helvetica-BoldOblique", 24)
    c.setFillColor(ACCENT)
    c.drawString(card_x+140, y-45, "Score")
    c.setFont("Helvetica-BoldOblique", 46)
    c.setFillColor(colors.white)
    c.drawString(card_x+140, y-92, f"{row['total_score']:.1f}")
    
    png = ring_gauge(row["total_score_pct"], "_score.png", size=230)
    tmp.append(png)
    c.drawImage(ImageReader(png), card_x+card_w-210, y-score_h+8,
                width=108, height=108, mask='auto')
    
    y -= score_h + 28
    
    # Interval cards
    intervals = [
        ("0–10 Seconds", 0, "tot_rom_0to10", "fatigue_index_10", "forearm_rom_0to10"),
        ("10–20 Seconds", 1, "tot_rom_10to20", "fatigue_index_20", "forearm_rom_10to20"),
        ("20–30 Seconds", 2, "tot_rom_20to30", "fatigue_index_30", "forearm_rom_20to30"),
    ]
    
    for title, idx, rom_col, fat_col, rom_col2 in intervals:
        card_h = 150
        draw_card_shadow(y, card_h)
        draw_card(y, card_h)
        
        # Titles & data
        c.setFont("Helvetica-BoldOblique", 18)
        c.setFillColor(ACCENT)
        c.drawString(card_x+40, y-35, title)
        
        c.setFont("Helvetica-Oblique", 16)
        c.setFillColor(colors.white)
        c.drawString(card_x+40, y-65, f"Cumulative ROM: {row[rom_col]:.1f}°")
        c.drawString(card_x+40, y-90, f"Fatigue Index:       {row[fat_col]:.1f}%")
        c.drawString(card_x+40, y-115, f"ROM:                     {row[rom_col2]:.1f}°")
        
        # Mini bar chart
        bars_png = rom_bars(row["tot_rom_0to10"], row["tot_rom_10to20"],
                            row["tot_rom_20to30"], idx,
                            f"_bars_{idx}.png", size=(110, 110))
        tmp.append(bars_png)
        c.drawImage(ImageReader(bars_png),
                    card_x+card_w/2-0, y-card_h+25,
                    width=110, height=110, mask='auto')
        
        # Ring gauge
        ring_png = ring_gauge(row[f"{rom_col}_pct"],
                              f"_ring_{idx}.png", size=240)
        tmp.append(ring_png)
        c.drawImage(ImageReader(ring_png), card_x+card_w-110, y-card_h+30,
                    width=90, height=90, mask='auto')
        
        y -= card_h + 28
    
    # Finalize
    c.showPage()
    c.save()
    print("Saved", pdf_out)
    
    # Cleanup temp files
    for p in tmp:
        if os.path.exists(p):
            os.remove(p)
    
    return pdf_out

