"""
Interactive terminal prompts for picking an athlete and the sessions to
compare. Pure stdin/stdout — no GUI dependencies.

Two entry points:
  - :func:`prompt_for_athlete` (athlete picker)
  - :func:`prompt_for_sessions` (session picker, 2-4 dates)

Both gracefully handle Ctrl-C by re-raising ``KeyboardInterrupt`` and treat
empty input as "cancel". Numbered list selection plus a name-substring
shortcut keeps things fast even with hundreds of athletes.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .config import MAX_SESSIONS, format_session_label
from .data_loader import (
    list_athletes_with_multiple_sessions,
    list_sessions_for_athlete,
)


# ---------------------------------------------------------------------------
# Small input helpers
# ---------------------------------------------------------------------------
def _read(prompt: str) -> str:
    """Wrapper around input() that strips whitespace and tolerates EOF."""
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def _print_header(text: str) -> None:
    print()
    print("=" * 60)
    print(text)
    print("=" * 60)


# ---------------------------------------------------------------------------
# Athlete picker
# ---------------------------------------------------------------------------
def prompt_for_athlete(engine) -> Optional[Dict]:
    """Pick an athlete who has 2+ athletic-screen sessions.

    Returns the athlete dict (``{athlete_uuid, name, session_count}``) or
    ``None`` if the user cancels.
    """
    athletes = list_athletes_with_multiple_sessions(engine)
    if not athletes:
        print("No athletes have multiple athletic-screen sessions.")
        return None

    _print_header("Select an athlete (athletes shown have 2+ sessions)")
    while True:
        # Optional name filter to cut the list down
        query = _read(
            "Type a name (or part of a name) to filter, or press Enter to list all: "
        )
        if query:
            filtered = [
                a for a in athletes if query.lower() in str(a["name"]).lower()
            ]
        else:
            filtered = athletes

        if not filtered:
            print(f"No athletes match '{query}'. Try again.\n")
            continue

        # If exactly one match, confirm and return it.
        if len(filtered) == 1:
            only = filtered[0]
            confirm = _read(
                f"Found 1 match: {only['name']} "
                f"({only['session_count']} sessions). Use this athlete? [Y/n]: "
            )
            if confirm == "" or confirm.lower().startswith("y"):
                return only
            continue

        # Otherwise show a numbered list — cap to 50 to avoid wall-of-text.
        print()
        for i, a in enumerate(filtered[:50], start=1):
            print(f"  {i:>3}. {a['name']:<35}  ({a['session_count']} sessions)")
        if len(filtered) > 50:
            print(f"  ... and {len(filtered) - 50} more. "
                  "Refine your filter to narrow.")

        choice = _read(
            "\nEnter the number of the athlete (or blank to refilter, 'q' to quit): "
        )
        if choice == "":
            continue
        if choice.lower().startswith("q"):
            return None
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= min(50, len(filtered)):
                return filtered[idx - 1]
        print("Invalid choice. Try again.\n")


# ---------------------------------------------------------------------------
# Session picker
# ---------------------------------------------------------------------------
def prompt_for_sessions(engine, athlete: Dict) -> List[str]:
    """Pick 2-4 session dates to compare for ``athlete``.

    Returns the chosen ISO date strings in chronological order
    (oldest first). Empty list if the user cancels.
    """
    sessions = list_sessions_for_athlete(engine, athlete["athlete_uuid"])
    if len(sessions) < 2:
        print(
            f"\n{athlete['name']} only has {len(sessions)} session(s); "
            "comparison needs at least 2."
        )
        return []

    _print_header(f"Select 2-{MAX_SESSIONS} sessions to compare for {athlete['name']}")
    print(
        "Sessions are listed newest first. Pick by typing a comma-separated "
        f"list of numbers (e.g. '1,3' for two sessions, '1,2,3,4' for four)."
    )
    print()
    for i, s in enumerate(sessions, start=1):
        movements = ", ".join(s["movements"]) if s["movements"] else "no data"
        print(
            f"  {i:>2}. {format_session_label(s['session_date'])}   "
            f"[{movements}]"
        )

    while True:
        raw = _read(
            f"\nEnter 2-{MAX_SESSIONS} session numbers (comma-separated), "
            "or blank to cancel: "
        )
        if raw == "":
            return []

        # Allow either commas or spaces between numbers.
        parts = [p for p in raw.replace(",", " ").split() if p]
        if not all(p.isdigit() for p in parts):
            print("All entries must be numbers. Try again.")
            continue

        idxs = [int(p) for p in parts]
        if not (2 <= len(idxs) <= MAX_SESSIONS):
            print(f"Pick between 2 and {MAX_SESSIONS} sessions.")
            continue
        if len(set(idxs)) != len(idxs):
            print("Duplicate session numbers — pick each only once.")
            continue
        if not all(1 <= idx <= len(sessions) for idx in idxs):
            print(f"Numbers must be between 1 and {len(sessions)}.")
            continue

        # Translate to ISO date strings, then sort chronologically (oldest first)
        chosen = [sessions[idx - 1]["session_date"] for idx in idxs]
        chosen_sorted = sorted(chosen)  # ISO strings sort chronologically
        return chosen_sorted
