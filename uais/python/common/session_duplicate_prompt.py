#!/usr/bin/env python3
"""
Duplicate session check and stdin prompt for Existing Athlete runs (Safeguard 4).

When ATHLETE_UUID is set, pipelines should call session_exists() before inserting
a session row. If it returns True, call prompt_duplicate_session(); if that returns
False, skip the insert or exit. Octane detects the parseable message in the stream
and shows a modal, then sends "yes" or "no" via job input.

Message format (for Octane to detect):
  Line 1: DUPLICATE_SESSION:YYYY-MM-DD
  Line 2: It looks like you already ran this data for the following date: YYYY-MM-DD. Reply 'yes' to continue or 'no' to abort.
"""
import sys


# Parseable prefix for Octane stream detection (regex: DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2}))
DUPLICATE_SESSION_PREFIX = "DUPLICATE_SESSION:"


def session_exists(conn, table_name: str, athlete_uuid: str, session_date, date_column: str = "session_date") -> bool:
    """
    Return True if a row exists in the given fact table for this athlete_uuid and session_date.
    session_date can be date or YYYY-MM-DD string.
    """
    if session_date is None:
        return False
    date_val = session_date.isoformat()[:10] if hasattr(session_date, "isoformat") else str(session_date)[:10]
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT 1 FROM public.{table_name} WHERE athlete_uuid = %s AND {date_column} = %s LIMIT 1',
            (athlete_uuid, date_val),
        )
        return cur.fetchone() is not None


def prompt_duplicate_session(session_date) -> bool:
    """
    Print the parseable duplicate-session message and read one line from stdin.
    Returns True if the user replied yes (proceed with insert), False otherwise.
    """
    date_str = session_date.isoformat()[:10] if hasattr(session_date, "isoformat") else str(session_date)[:10]
    print(DUPLICATE_SESSION_PREFIX + date_str, flush=True)
    print(
        f"It looks like you already ran this data for the following date: {date_str}. Reply 'yes' to continue or 'no' to abort.",
        flush=True,
    )
    try:
        line = sys.stdin.readline()
        response = (line or "").strip().lower()
        return response == "yes"
    except Exception:
        return False
