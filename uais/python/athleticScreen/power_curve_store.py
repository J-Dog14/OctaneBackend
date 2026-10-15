"""
Warehouse storage for raw athletic-screen power curves.

Every scalar the force plate gives us lands in the f_athletic_screen_* tables,
but the power-vs-time trace each trial's metrics were computed from used to
live only in a ``*_Power.txt`` file on whichever machine ran the insert. Any
report built later — a comparison from the PDF Reports page, or anything run
on Railway after the temp upload dir is gone — had no way to draw the real
curve, and the comparison report ended up matching another session's (or
another athlete's) file by trial name alone.

This module persists the curve itself at insert time, keyed exactly like the
fact rows, so a report can draw the curve that belongs to *that* athlete on
*that* date or honestly say it doesn't have one.

Table: ``public.f_athletic_screen_power_curve`` (also in
``uais/sql/create_athletic_screen_tables.sql``). Created lazily here so the
first insert after deploy doesn't depend on someone running the SQL by hand.
"""
from __future__ import annotations

from typing import Dict, List, Sequence

import numpy as np

POWER_CURVE_TABLE = "public.f_athletic_screen_power_curve"

#: Force plate sample rate the Power.txt series are recorded at.
DEFAULT_SAMPLE_HZ = 1000.0

_CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {POWER_CURVE_TABLE} (
    athlete_uuid  VARCHAR(36) NOT NULL,
    session_date  DATE        NOT NULL,
    movement      VARCHAR(8)  NOT NULL,
    trial_name    TEXT        NOT NULL,
    sample_hz     REAL        NOT NULL DEFAULT {DEFAULT_SAMPLE_HZ},
    power_w       REAL[]      NOT NULL,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (athlete_uuid, session_date, movement, trial_name)
)
"""

_table_ready = False


def ensure_power_curve_table(conn) -> None:
    """Create the table once per process. ``conn`` is a psycopg2 connection."""
    global _table_ready
    if _table_ready:
        return
    with conn.cursor() as cur:
        cur.execute(_CREATE_SQL)
    conn.commit()
    _table_ready = True


def save_power_curve(conn, athlete_uuid: str, session_date: str, movement: str,
                     trial_name: str, power: Sequence[float],
                     sample_hz: float = DEFAULT_SAMPLE_HZ) -> bool:
    """Upsert one trial's power curve and commit. Returns True on success.

    Runs in its own transaction, after the trial's fact row has already been
    committed, so a failure here can never cost us the metrics themselves.
    """
    values = [float(v) for v in np.asarray(power, dtype=float) if np.isfinite(v)]
    if not values or not trial_name:
        return False
    try:
        ensure_power_curve_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO {POWER_CURVE_TABLE}
                    (athlete_uuid, session_date, movement, trial_name, sample_hz, power_w)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (athlete_uuid, session_date, movement, trial_name)
                DO UPDATE SET sample_hz = EXCLUDED.sample_hz,
                              power_w   = EXCLUDED.power_w,
                              created_at = CURRENT_TIMESTAMP
                """,
                (athlete_uuid, session_date, movement, trial_name, float(sample_hz), values),
            )
        conn.commit()
        return True
    except Exception as exc:  # pragma: no cover - depends on DB permissions
        conn.rollback()
        print(f"Warning: could not store power curve for {movement} {trial_name}: {exc}")
        return False


def load_power_curves(engine, athlete_uuid: str, session_date: str,
                      movement: str) -> Dict[str, np.ndarray]:
    """``{trial_name: power array}`` for one athlete/session/movement.

    ``engine`` is a SQLAlchemy engine. Returns an empty dict when the table
    doesn't exist yet or the session predates curve storage.
    """
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT trial_name, power_w FROM {POWER_CURVE_TABLE}
                    WHERE athlete_uuid = :uuid AND session_date = :date
                      AND movement = :movement
                    """
                ),
                {"uuid": athlete_uuid, "date": session_date, "movement": movement},
            ).fetchall()
    except Exception:
        return {}
    return {
        str(trial): np.asarray(power, dtype=float)
        for trial, power in rows
        if power
    }


def load_power_curves_for_sessions(engine, athlete_uuid: str,
                                   session_dates: Sequence[str],
                                   movement: str) -> List[Dict[str, np.ndarray]]:
    """One ``{trial_name: array}`` dict per session date, same order."""
    return [load_power_curves(engine, athlete_uuid, d, movement) for d in session_dates]
