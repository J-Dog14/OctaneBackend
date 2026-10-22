"""
v2 data access for the athletic screen reports (single-session PDF and comparison PDF).

The report code was written against the legacy tables and their column names. These readers return the
same column names the report code expects, filled from the v2 tables:

    report column       v2 source
    JH_IN               jh_in
    PP_W_per_kg         pp_w_per_kg
    PP_FORCEPLATE       peak_power_w
    Force_at_PP         force_at_pp_n
    Vel_at_PP           vel_at_pp_m_s                    (m/s - matches the report's axis label)
    auc_j               concentric_work_j                (push-off work)
    kurtosis            pwr_con_time_kurtosis            (shape of the concentric power curve)
    rpd_max_w_per_s     rpd_max_w_per_s
    time_to_rpd_max_s   concentric_duration_s - rpd_max_before_takeoff_s  (push-off start -> max RPD)
    CT                  ct_s                              (DJ)
    RSI                 rsi_legacy                        (DJ, 2 x JH/CT - the scale coaches know)
    side                side                              (SLV)

Power curves come from f_athletic_screen_v2_force_curve: velocity is rebuilt by backward integration from
takeoff (same as kinetics.py) and power is drawn from contact/movement onset to takeoff.
"""
from typing import Dict, List, Sequence

import numpy as np
import pandas as pd
from sqlalchemy import text

from . import schema

G = 9.81

_BASE = [
    ("trial_name", "trial_name"),
    ("JH_IN", "jh_in"),
    ("PP_W_per_kg", "pp_w_per_kg"),
    ("PP_FORCEPLATE", "peak_power_w"),
    ("Force_at_PP", "force_at_pp_n"),
    ("Vel_at_PP", "vel_at_pp_m_s"),
    ("auc_j", "concentric_work_j"),
    ("kurtosis", "pwr_con_time_kurtosis"),
    ("rpd_max_w_per_s", "rpd_max_w_per_s"),
    ("time_to_rpd_max_s", "GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)"),
]
_EXTRA = {"DJ": [("CT", "ct_s"), ("RSI", "rsi_legacy")], "SLV": [("side", "side")]}
NUMERIC = ["JH_IN", "PP_W_per_kg", "PP_FORCEPLATE", "Force_at_PP", "Vel_at_PP", "auc_j", "kurtosis",
           "rpd_max_w_per_s", "time_to_rpd_max_s", "CT", "RSI"]


def _table(movement_type):
    mv = movement_type.lower()
    return schema.TABLE.format(mv) if mv in schema.MOVEMENTS else None


def _select(movement_type, alias=""):
    cols = _BASE + _EXTRA.get(movement_type, [])
    p = f"{alias}." if alias else ""
    out = []
    for name, expr in cols:
        e = expr if expr.startswith("GREATEST") else f"{p}{expr}"
        if expr.startswith("GREATEST") and alias:
            e = e.replace("concentric_duration_s", f"{p}concentric_duration_s").replace(
                "rpd_max_before_takeoff_s", f"{p}rpd_max_before_takeoff_s")
        out.append(f'{e} AS "{name}"')
    return ", ".join(out)


def _numeric(df):
    for c in NUMERIC:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def query_athlete_data(engine, athlete_uuid, session_date, movement_type):
    t = _table(movement_type)
    if not t:
        return pd.DataFrame()
    sql = (f"SELECT {_select(movement_type)} FROM {t} "
           f"WHERE athlete_uuid = :u AND session_date = :d ORDER BY trial_name")
    with engine.connect() as c:
        r = c.execute(text(sql), {"u": athlete_uuid, "d": session_date})
        df = pd.DataFrame(r.fetchall(), columns=list(r.keys()))
    if not df.empty:
        df["name"] = ""
        df = _numeric(df)
    return df


def query_population_data(engine, movement_type, gender=None):
    t = _table(movement_type)
    if not t:
        return pd.DataFrame()
    join = ""
    if gender and str(gender).lower() == "female":
        join = " JOIN analytics.d_athletes da ON da.athlete_uuid = s.athlete_uuid AND da.gender = 'Female'"
    sql = f"SELECT {_select(movement_type, 's')} FROM {t} s{join} WHERE s.jh_in IS NOT NULL"
    with engine.connect() as c:
        r = c.execute(text(sql))
        df = pd.DataFrame(r.fetchall(), columns=list(r.keys()))
    return _numeric(df) if not df.empty else df


def sessions_union_sql():
    return " UNION ".join(f"SELECT athlete_uuid, session_date FROM {schema.TABLE.format(mv)}"
                          for mv in schema.MOVEMENTS)


def _power_from_curve(row) -> np.ndarray:
    fz = np.asarray(row["fz_n"], dtype=float)
    fs, bw = float(row["fs_hz"]), float(row["bw_n"])
    to, ld = int(row["takeoff_idx"]), int(row["landing_idx"])
    if bw <= 0 or to <= 0 or ld <= to:
        return np.array([])
    m = bw / G
    v_to = G * (ld - to) / fs / 2.0
    v = v_to - np.cumsum(((fz[:to] - bw) / m)[::-1])[::-1] / fs
    onset = row.get("movement_onset_idx")
    start = int(onset) if onset is not None and int(onset) >= 0 else int(row["contact_start_idx"])
    start = max(0, min(start, to - 1))
    return (fz[:to] * v)[start:]


def load_power_curves(engine, athlete_uuid, session_date, movement) -> Dict[str, np.ndarray]:
    """{trial_name: power array} for one athlete/session/movement from the v2 force curves."""
    sql = (f"SELECT trial_name, fs_hz, fz_n, bw_n, takeoff_idx, landing_idx, contact_start_idx, movement_onset_idx "
           f"FROM {schema.CURVE_TABLE} WHERE athlete_uuid = :u AND session_date = :d AND movement = :m")
    with engine.connect() as c:
        rows = c.execute(text(sql), {"u": athlete_uuid, "d": session_date, "m": movement.upper()}).mappings().all()
    out = {}
    for r in rows:
        p = _power_from_curve(dict(r))
        if p.size:
            out[r["trial_name"]] = p
    return out


def load_power_curves_for_sessions(engine, athlete_uuid, session_dates: Sequence[str], movement) -> List[Dict[str, np.ndarray]]:
    return [load_power_curves(engine, athlete_uuid, d, movement) for d in session_dates]


def load_all_power_curves(engine, athlete_uuid, session_date) -> Dict[str, np.ndarray]:
    """All movements for a session, keyed by trial_name (CMJ1, DJ2, SLVL1, ...) - the report's power_data_dict."""
    out = {}
    for mv in ("CMJ", "DJ", "PPU", "SLV"):
        out.update(load_power_curves(engine, athlete_uuid, session_date, mv))
    return out
