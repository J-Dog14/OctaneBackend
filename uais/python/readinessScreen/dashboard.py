"""
Dash dashboard for Readiness Screen.
Interactive web dashboard for visualizing readiness data.
"""
import sqlite3
import pandas as pd
import numpy as np
from dash import Dash, dcc, html, Input, Output
import plotly.graph_objects as go
import plotly.colors as plotly_colors


def load_dashboard_data(db_path: str) -> dict:
    """
    Load all data needed for the dashboard.
    
    Args:
        db_path: Path to database file.
    
    Returns:
        Dictionary with DataFrames for each movement type.
    """
    conn = sqlite3.connect(db_path)
    
    df_cmj = pd.read_sql("""
        SELECT Name, Creation_Date,
               Jump_Height             AS Jump_Height_CMJ,
               PP_FORCEPLATE           AS PP_FORCEPLATE_CMJ,
               Force_at_PP             AS Force_at_PP_CMJ,
               Vel_at_PP               AS Vel_at_PP_CMJ
        FROM CMJ
    """, conn)
    
    df_ppu = pd.read_sql("""
        SELECT Name, Creation_Date,
               Jump_Height             AS Jump_Height_PPU,
               PP_FORCEPLATE           AS PP_FORCEPLATE_PPU,
               Force_at_PP             AS Force_at_PP_PPU,
               Vel_at_PP               AS Vel_at_PP_PPU
        FROM PPU
    """, conn)
    
    df_i = pd.read_sql("SELECT Name, Creation_Date, Avg_Force AS Avg_Force_I FROM I", conn)
    df_y = pd.read_sql("SELECT Name, Creation_Date, Avg_Force AS Avg_Force_Y FROM Y", conn)
    df_t = pd.read_sql("SELECT Name, Creation_Date, Avg_Force AS Avg_Force_T FROM T", conn)
    df_ir = pd.read_sql("SELECT Name, Creation_Date, Avg_Force AS Avg_Force_IR90 FROM IR90", conn)
    
    conn.close()
    
    # Merge for time-series
    df_merged = (
        df_cmj.merge(df_ppu, on=["Name", "Creation_Date"], how="outer")
              .merge(df_i, on=["Name", "Creation_Date"], how="outer")
              .merge(df_y, on=["Name", "Creation_Date"], how="outer")
              .merge(df_t, on=["Name", "Creation_Date"], how="outer")
              .merge(df_ir, on=["Name", "Creation_Date"], how="outer")
    )
    df_merged["Creation_Date"] = pd.to_datetime(df_merged["Creation_Date"])
    df_merged.sort_values("Creation_Date", inplace=True)
    
    # Create reference dataframes
    cmj_ref = df_cmj[
        (df_cmj["Force_at_PP_CMJ"].notna()) & 
        (df_cmj["Vel_at_PP_CMJ"].notna())
    ].copy()
    
    ppu_ref = df_ppu[
        (df_ppu["Force_at_PP_PPU"].notna()) & 
        (df_ppu["Vel_at_PP_PPU"].notna())
    ].copy()
    
    return {
        'merged': df_merged,
        'cmj': df_cmj,
        'ppu': df_ppu,
        'cmj_ref': cmj_ref,
        'ppu_ref': ppu_ref
    }


def stat_box(lines: str):
    """
    Helper function to create a styled stat box.
    
    Args:
        lines: Text content for the box.
    
    Returns:
        HTML Pre element with styling.
    """
    return html.Pre(lines, style={
        "background": "#2d2d2d",
        "color": "#ffffff",
        "padding": "30px",
        "borderRadius": "8px",
        "fontFamily": "monospace",
        "whiteSpace": "pre",
        "fontSize": "18px",
        "border": "1px solid #444",
        "margin": "10px 0",
        "boxShadow": "0 2px 4px rgba(0,0,0,0.3)",
        "width": "100%",
        "textAlign": "center",
        "letterSpacing": "1px"
    })


def last_two(df: pd.DataFrame, col: str) -> tuple:
    """
    Get last two values and difference for a column.
    
    Args:
        df: DataFrame sorted by Creation_Date.
        col: Column name.
    
    Returns:
        Tuple of (latest, previous, difference) as formatted strings.
    """
    df = df.dropna(subset=[col]).sort_values("Creation_Date")
    if len(df) < 2:
        return "–", "–", "–"
    latest, prev = df.iloc[-1][col], df.iloc[-2][col]
    return f"{latest:.2f}", f"{prev:.2f}", f"{latest-prev:+.2f}"


def create_dashboard_app(db_path: str, port: int = 8051):
    """
    Create and configure the Dash dashboard application.
    
    Args:
        db_path: Path to database file.
        port: Port number for the server (default: 8051).
    
    Returns:
        Dash application object.
    """
    # Load data
    data = load_dashboard_data(db_path)
    df_merged = data['merged']
    cmj_ref = data['cmj_ref']
    ppu_ref = data['ppu_ref']
    
    participants = sorted(df_merged["Name"].dropna().unique())
    
    # Create app
    app = Dash(__name__, title="Readiness Dashboard")
    
    # Custom CSS for dark dropdown
    app.index_string = '''
    <!DOCTYPE html>
    <html>
        <head>
            {%metas%}
            <title>{%title%}</title>
            {%favicon%}
            {%css%}
            <style>
                .dark-dropdown .Select-control {
                    background-color: #2d2d2d !important;
                    border: 1px solid #444 !important;
                    color: white !important;
                }
                .dark-dropdown .Select-value-label {
                    color: white !important;
                }
                .dark-dropdown .Select-input {
                    color: white !important;
                }
                .dark-dropdown .Select-menu-outer {
                    background-color: #2d2d2d !important;
                    border: 1px solid #444 !important;
                }
                .dark-dropdown .Select-option {
                    background-color: #2d2d2d !important;
                    color: white !important;
                }
                .dark-dropdown .Select-option.is-focused {
                    background-color: #444 !important;
                }
                .dark-dropdown .Select-option.is-selected {
                    background-color: #555 !important;
                }
            </style>
        </head>
        <body>
            {%app_entry%}
            <footer>
                {%config%}
                {%scripts%}
                {%renderer%}
            </footer>
        </body>
    </html>
    '''
    
    # Layout
    app.layout = html.Div(
        [
            html.H2("Readiness / Force-Plate Dashboard", 
                   style={"color": "white", "textAlign": "center", "marginBottom": "30px"}),
            
            # Athlete picker
            html.Div([
                html.Label("Select athlete:", 
                          style={"color": "white", "fontSize": "16px", "fontWeight": "bold"}),
                dcc.Dropdown(
                    id="athlete",
                    options=[{"label": n, "value": n} for n in participants],
                    value=participants[0] if participants else None,
                    clearable=False,
                    style={
                        "backgroundColor": "#2d2d2d",
                        "color": "white",
                        "border": "1px solid #444"
                    },
                    className="dark-dropdown"
                ),
            ], style={"width": "400px", "marginBottom": "20px"}),
            
            html.Hr(style={"borderColor": "#444", "margin": "30px 0"}),
            
            # Row 1 - Avg-Force over time
            html.Div([
                dcc.Graph(id="force-lines", 
                         style={"width": "100%", "height": "600px", "marginBottom": "20px"}),
                html.Div(id="force-box", style={"width": "100%", "marginBottom": "30px"}),
            ]),
            
            html.Hr(style={"borderColor": "#444", "margin": "30px 0"}),
            
            # Row 2 - CMJ line + scatter
            html.Div([
                html.Div([
                    dcc.Graph(id="cmj-jump", 
                             style={"width": "48%", "display": "inline-block", "height": "600px"}),
                    dcc.Graph(id="cmj-scatter", 
                             style={"width": "48%", "display": "inline-block", "height": "600px", "marginLeft": "4%"}),
                ]),
                html.Div(id="cmj-box", 
                        style={"width": "100%", "marginTop": "20px", "marginBottom": "30px"}),
            ]),
            
            html.Hr(style={"borderColor": "#444", "margin": "30px 0"}),
            
            # Row 3 - PPU line + scatter
            html.Div([
                html.Div([
                    dcc.Graph(id="ppu-jump", 
                             style={"width": "48%", "display": "inline-block", "height": "600px"}),
                    dcc.Graph(id="ppu-scatter", 
                             style={"width": "48%", "display": "inline-block", "height": "600px", "marginLeft": "4%"}),
                ]),
                html.Div(id="ppu-box", 
                        style={"width": "100%", "marginTop": "20px", "marginBottom": "30px"}),
            ]),
        ],
        style={
            "maxWidth": "2200px",
            "margin": "auto",
            "backgroundColor": "#1a1a1a",
            "color": "white",
            "minHeight": "100vh"
        },
    )
    
    # Callback
    @app.callback(
        Output("force-lines", "figure"),
        Output("cmj-jump", "figure"),
        Output("ppu-jump", "figure"),
        Output("cmj-scatter", "figure"),
        Output("ppu-scatter", "figure"),
        Output("force-box", "children"),
        Output("cmj-box", "children"),
        Output("ppu-box", "children"),
        Input("athlete", "value"),
    )
    def update(name):
        # Reload all data
        data = load_dashboard_data(db_path)
        df_merged = data['merged']
        cmj_ref = data['cmj_ref']
        ppu_ref = data['ppu_ref']
        
        dff = df_merged[df_merged["Name"] == name].sort_values("Creation_Date")
        dates_cat = dff["Creation_Date"].dt.strftime("%Y-%m-%d")
        
        # Row 1: Avg-Force lines
        fig_force = go.Figure()
        for col, label in [("Avg_Force_I", "I"), ("Avg_Force_T", "T"),
                          ("Avg_Force_Y", "Y"), ("Avg_Force_IR90", "IR90")]:
            if dff[col].notna().any():
                fig_force.add_trace(go.Scatter(
                    x=dates_cat, y=dff[col], mode="lines+markers", name=label))
        fig_force.update_layout(
            title="Avg Force (I / T / Y / IR90) – categorical spacing",
            template="plotly_dark",
            xaxis=dict(type="category"),
            xaxis_title="Session date",
            yaxis_title="Avg Force (N)",
            height=550
        )
        
        # Stats for force box
        force_lines = ["Metric           Latest      Prev        Δ",
                      "──────────────── ────────── ────────── ──────────"]
        for col, label in [("Avg_Force_I", "I"), ("Avg_Force_T", "T"),
                          ("Avg_Force_Y", "Y"), ("Avg_Force_IR90", "IR90")]:
            l, p, d = last_two(dff, col)
            force_lines.append(f"{label:<15} {l:>10} {p:>10} {d:>10}")
        force_box = stat_box("\n".join(force_lines))
        
        # Row 2: CMJ jump-height line
        fig_cmj = go.Figure()
        if dff["Jump_Height_CMJ"].notna().any():
            fig_cmj.add_trace(go.Scatter(
                x=dates_cat, y=dff["Jump_Height_CMJ"],
                mode="lines+markers", name="CMJ Jump Height"))
        fig_cmj.update_layout(
            title="CMJ Jump Height",
            template="plotly_dark",
            xaxis=dict(type="category"),
            xaxis_title="Session date",
            yaxis_title="JH (cm)",
            height=550
        )
        
        # CMJ scatter
        fig_c_scatter = go.Figure()
        fig_c_scatter.add_trace(go.Scatter(
            x=cmj_ref["Force_at_PP_CMJ"], y=cmj_ref["Vel_at_PP_CMJ"],
            mode="markers", name="Reference",
            marker=dict(color="cornflowerblue", opacity=0.4, size=8)))
        
        sel = cmj_ref[cmj_ref["Name"] == name]
        if not sel.empty:
            unique_dates = sel["Creation_Date"].unique()
            color_palette = plotly_colors.qualitative.Set3
            
            for i, date in enumerate(unique_dates):
                date_data = sel[sel["Creation_Date"] == date]
                color = color_palette[i % len(color_palette)]
                
                fig_c_scatter.add_trace(go.Scatter(
                    x=date_data["Force_at_PP_CMJ"],
                    y=date_data["Vel_at_PP_CMJ"],
                    mode="markers+text",
                    textposition="top center",
                    name=f"{name} ({date})",
                    marker=dict(color=color, size=12,
                               line=dict(width=1, color="black")),
                    hovertemplate=f"<b>{name}</b><br>Date: {date}<br>Force: %{{x}}<br>Velocity: %{{y}}<extra></extra>"
                ))
        fig_c_scatter.update_layout(
            title="CMJ Force-vs-Velocity",
            xaxis_title="Force @ PP (N)",
            yaxis_title="Velocity @ PP (m/s)",
            template="plotly_dark",
            height=550
        )
        
        cmj_lines = ["Metric                Latest      Prev        Δ",
                    "───────────────────── ────────── ────────── ──────────"]
        for col, label in [
            ("Jump_Height_CMJ", "JH"),
            ("PP_FORCEPLATE_CMJ", "PP_FP"),
            ("Force_at_PP_CMJ", "F@PP"),
            ("Vel_at_PP_CMJ", "V@PP")
        ]:
            l, p, d = last_two(dff, col)
            cmj_lines.append(f"{label:<20} {l:>10} {p:>10} {d:>10}")
        cmj_box = stat_box("\n".join(cmj_lines))
        
        # Row 3: PPU jump-height line
        fig_ppu = go.Figure()
        if dff["Jump_Height_PPU"].notna().any():
            fig_ppu.add_trace(go.Scatter(
                x=dates_cat, y=dff["Jump_Height_PPU"],
                mode="lines+markers", name="PPU Jump Height"))
        fig_ppu.update_layout(
            title="PPU Jump Height",
            template="plotly_dark",
            xaxis=dict(type="category"),
            xaxis_title="Session date",
            yaxis_title="JH (cm)",
            height=550
        )
        
        # PPU scatter
        fig_p_scatter = go.Figure()
        fig_p_scatter.add_trace(go.Scatter(
            x=ppu_ref["Force_at_PP_PPU"], y=ppu_ref["Vel_at_PP_PPU"],
            mode="markers", name="Reference",
            marker=dict(color="cornflowerblue", opacity=0.4, size=8)))
        
        sel = ppu_ref[ppu_ref["Name"] == name]
        if not sel.empty:
            unique_dates = sel["Creation_Date"].unique()
            color_palette = plotly_colors.qualitative.Set3
            
            for i, date in enumerate(unique_dates):
                date_data = sel[sel["Creation_Date"] == date]
                color = color_palette[i % len(color_palette)]
                
                fig_p_scatter.add_trace(go.Scatter(
                    x=date_data["Force_at_PP_PPU"],
                    y=date_data["Vel_at_PP_PPU"],
                    mode="markers+text",
                    textposition="top center",
                    name=f"{name} ({date})",
                    marker=dict(color=color, size=12,
                               line=dict(width=1, color="black")),
                    hovertemplate=f"<b>{name}</b><br>Date: {date}<br>Force: %{{x}}<br>Velocity: %{{y}}<extra></extra>"
                ))
        fig_p_scatter.update_layout(
            title="PPU Force-vs-Velocity",
            xaxis_title="Force @ PP (N)",
            yaxis_title="Velocity @ PP (m/s)",
            template="plotly_dark",
            height=550
        )
        
        ppu_lines = ["Metric                Latest      Prev        Δ",
                    "───────────────────── ────────── ────────── ──────────"]
        for col, label in [
            ("Jump_Height_PPU", "JH"),
            ("PP_FORCEPLATE_PPU", "PP_FP"),
            ("Force_at_PP_PPU", "F@PP"),
            ("Vel_at_PP_PPU", "V@PP")
        ]:
            l, p, d = last_two(dff, col)
            ppu_lines.append(f"{label:<20} {l:>10} {p:>10} {d:>10}")
        ppu_box = stat_box("\n".join(ppu_lines))
        
        return (fig_force, fig_cmj, fig_ppu,
                fig_c_scatter, fig_p_scatter,
                force_box, cmj_box, ppu_box)
    
    return app


def run_dashboard(db_path: str, port: int = 8051, debug: bool = True):
    """
    Run the dashboard server.
    
    Args:
        db_path: Path to database file.
        port: Port number for the server.
        debug: Enable debug mode.
    """
    app = create_dashboard_app(db_path, port=port)
    app.run_server(port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    # Standalone dashboard runner
    import sys
    from pathlib import Path
    
    # Default database path
    default_db = r'D:/Readiness Screen 3/Readiness_Screen_Data_v2.db'
    
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    else:
        db_path = default_db
    
    if not Path(db_path).exists():
        print(f"Error: Database file not found: {db_path}")
        sys.exit(1)
    
    print(f"Starting Readiness Screen Dashboard...")
    print(f"Database: {db_path}")
    print(f"Server: http://127.0.0.1:8051")
    print(f"Press Ctrl+C to stop")
    
    run_dashboard(db_path, port=8051, debug=True)

