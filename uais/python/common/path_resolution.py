"""
Resolve pitching and hitting data paths from athlete name (athletic-screen-first workflow).

Pitching: H:\\Pitching\\Data\\{Last, First}\\Baseball Right Handed (or Left) -> newest session.
Hitting: D:\\Hitting\\Data\\{First Last}\\Baseball Hitting Sports -> newest session.

Folder names may be "Last, First" or "First Last"; we try both when matching.
"""

from pathlib import Path
from typing import List, Optional, Tuple

# Prefer athlete_manager for normalization when available
try:
    from common.athlete_manager import normalize_name_for_matching
except ImportError:
    from python.common.athlete_manager import normalize_name_for_matching


def to_pitching_folder_name_variants(name: str) -> Tuple[str, str]:
    """
    Return (Last, First), (First Last) for folder lookup under H:\\Pitching\\Data.
    Pitching typically uses "Last, First"; we return both for matching.
    """
    norm = normalize_name_for_matching(name)  # "FIRST LAST"
    if not norm:
        return ("", "")
    parts = norm.split(None, 1)
    if len(parts) == 2:
        first, last = parts[0], parts[1]
        return (f"{last}, {first}", f"{first} {last}")
    return (norm, norm)


def to_hitting_folder_name_variants(name: str) -> Tuple[str, str]:
    """
    Return (First Last), (Last, First) for folder lookup under D:\\Hitting\\Data.
    Hitting typically uses "First Last"; we return both for matching.
    """
    return to_pitching_folder_name_variants(name)  # same variants, order may differ per convention


def _folder_matches_name(folder_name: str, athlete_name: str) -> bool:
    """True if folder_name matches athlete_name (either Last, First or First Last)."""
    fn_norm = normalize_name_for_matching(folder_name)
    if not fn_norm:
        return False
    target_norm = normalize_name_for_matching(athlete_name)
    if not target_norm:
        return False
    return fn_norm == target_norm


def _newest_session_folder(parent: Path, subdir_names: List[str]) -> Optional[Path]:
    """Return path to the newest session folder among subdirs with names in subdir_names (by mtime)."""
    best_path: Optional[Path] = None
    best_mtime: float = 0
    if not parent.is_dir():
        return None
    for child in parent.iterdir():
        if not child.is_dir():
            continue
        if child.name not in subdir_names:
            continue
        m = child.stat().st_mtime
        if m >= best_mtime:
            best_mtime = m
            best_path = child
    return best_path


def resolve_pitching_data_path(base_path: Path, athlete_name: str) -> Optional[Path]:
    """
    Resolve the pitching session folder for an athlete from the athletic screen name.

    Looks under base_path (e.g. H:\\Pitching\\Data) for a folder matching the athlete name
    (either "Last, First" or "First Last"). Then selects the newest of "Baseball Right Handed"
    or "Baseball Left Handed" and returns that folder path (where session.xml lives).
    Returns None if no matching folder found.
    """
    base_path = Path(base_path)
    if not base_path.is_dir() or not athlete_name or not str(athlete_name).strip():
        return None
    for entry in base_path.iterdir():
        if not entry.is_dir():
            continue
        if not _folder_matches_name(entry.name, athlete_name):
            continue
        # Found athlete folder; look for handedness subdirs (newest)
        session_folder = _newest_session_folder(
            entry,
            ["Baseball Right Handed", "Baseball Left Handed"],
        )
        if session_folder is None:
            continue
        session_xml = session_folder / "session.xml"
        if session_xml.exists():
            return session_folder
    return None


def resolve_hitting_data_path(base_path: Path, athlete_name: str) -> Optional[Path]:
    """
    Resolve the hitting session folder for an athlete from the athletic screen name.

    Looks under base_path (e.g. D:\\Hitting\\Data) for a folder matching the athlete name
    (either "First Last" or "Last, First"). Then uses subfolder "Baseball Hitting Sports"
    (newest if multiple) and returns that folder path.
    Returns None if no matching folder found.
    """
    base_path = Path(base_path)
    if not base_path.is_dir() or not athlete_name or not str(athlete_name).strip():
        return None
    for entry in base_path.iterdir():
        if not entry.is_dir():
            continue
        if not _folder_matches_name(entry.name, athlete_name):
            continue
        # Subfolder "Baseball Hitting Sports" (single or pick newest)
        sports = entry / "Baseball Hitting Sports"
        if not sports.is_dir():
            continue
        session_xml = sports / "session.xml"
        if session_xml.exists():
            return sports
        # If multiple session folders inside Baseball Hitting Sports, pick newest
        best = _newest_session_folder(sports, [d.name for d in sports.iterdir() if d.is_dir()])
        if best is not None and (best / "session.xml").exists():
            return best
        return sports if sports.exists() else None
    return None
