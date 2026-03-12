"""
Parse session.xml (QTM/v3d style) for subject fields such as birth date.
Used by Athletic Screen and Youth Pitch Design (arm action, curveball) intake
to populate date_of_birth in d_athletes from session.xml under project Data folders.
"""

import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime
from typing import Optional


def normalize_gender(raw: Optional[str]) -> str:
    """
    Normalize a raw gender/sex value to "Male" or "Female".
    None, empty, whitespace, "unspecified", "other", or anything not clearly Female -> "Male".
    Only (case-insensitive) "female" or "f" -> "Female".
    """
    if raw is None or not str(raw).strip():
        return "Male"
    val = str(raw).strip().lower()
    if val in ("female", "f"):
        return "Female"
    return "Male"


# Field names to look for birth date in Subject/Fields (exact match, case-sensitive)
_BIRTH_DATE_FIELD_NAMES = (
    "Birth_date",
    "DOB",
    "DateOfBirth",
    "BirthDate",
    "birth_date",
    "Birth_Date",
    "Birthdate",
    "Date_of_Birth",
    "date_of_birth",
)

# Field names to look for email in Subject/Fields (exact match, case-sensitive)
_EMAIL_FIELD_NAMES = (
    "Email",
    "email",
    "E-mail",
    "e-mail",
    "EmailAddress",
    "email_address",
)


def _tag_looks_like_dob(tag_local_name: str) -> bool:
    """True if the Fields child tag looks like a birth/DOB field (flexible match)."""
    t = tag_local_name.strip()
    if not t:
        return False
    lower = t.lower()
    return "dob" in lower or "birth" in lower


def _read_session_xml(path: Path) -> str:
    """Read session.xml; handle UTF-16 BOM and UTF-8."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16", errors="replace")
    else:
        text = raw.decode("utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    return text


def parse_birthdate_from_session_xml(session_xml_path) -> Optional[str]:
    """
    Parse session.xml and return birth date from Subject/Fields if present.

    Looks for Fields children with tag in _BIRTH_DATE_FIELD_NAMES.
    Tries common date formats and returns YYYY-MM-DD or None.

    Args:
        session_xml_path: Path to session.xml (str or Path).

    Returns:
        Date string YYYY-MM-DD, or None if not found / parse failed.
    """
    path = Path(session_xml_path)
    if not path.exists():
        return None
    try:
        text = _read_session_xml(path)
        root = ET.fromstring(text)
    except Exception:
        return None

    tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if tag != "Subject":
        return None

    raw_value = None
    for child in root:
        ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if ctag == "Fields":
            for f in child:
                ftag = f.tag.split("}")[-1] if "}" in f.tag else f.tag
                if f.text and (ftag in _BIRTH_DATE_FIELD_NAMES or _tag_looks_like_dob(ftag)):
                    raw_value = f.text.strip()
                    break
            if raw_value is not None:
                break

    if not raw_value:
        return None

    # Parse to date and return YYYY-MM-DD
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            dt = datetime.strptime(raw_value, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def find_session_xml_in_folder(folder: Path) -> Optional[Path]:
    """
    Return path to session.xml in folder or any subfolder (first found).
    """
    folder = Path(folder)
    if not folder.is_dir():
        return None
    first = folder / "session.xml"
    if first.exists():
        return first
    for p in folder.rglob("session.xml"):
        return p
    return None


def get_dob_from_athletic_screen_data(data_root, athlete_name: str) -> Optional[str]:
    """
    Find athlete folder under Athletic Screen Data root and parse birthdate from session.xml.

    data_root should be e.g. D:\\Athletic Screen 2.0\\Data.
    athlete_name is the name extracted from the txt file (may be like "Name" or "Name_MS").
    Matches by listing dirs under data_root and finding a folder whose name contains
    athlete_name (or vice versa), then looks for session.xml and parses DOB.

    Returns:
        Date string YYYY-MM-DD or None.
    """
    root = Path(data_root)
    if not root.is_dir() or not athlete_name or not athlete_name.strip():
        return None
    name_clean = athlete_name.strip().replace("_", " ").upper()
    if not name_clean:
        return None
    # Find folder: exact match, or folder name contains name_clean, or name_clean in folder name
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        folder_name = entry.name.replace("_", " ").upper()
        if folder_name != name_clean and name_clean not in folder_name and folder_name not in name_clean:
            continue
        session_path = find_session_xml_in_folder(entry)
        if session_path:
            dob = parse_birthdate_from_session_xml(session_path)
            if dob:
                return dob
    return None


def parse_email_from_session_xml(session_xml_path) -> Optional[str]:
    """
    Parse session.xml and return email from Subject/Fields if present.

    Looks for Fields children with tag in _EMAIL_FIELD_NAMES.
    Returns normalized email (lowercase, stripped) or None.

    Args:
        session_xml_path: Path to session.xml (str or Path).

    Returns:
        Normalized email string, or None if not found.
    """
    path = Path(session_xml_path)
    if not path.exists():
        return None
    try:
        text = _read_session_xml(path)
        root = ET.fromstring(text)
    except Exception:
        return None

    tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if tag != "Subject":
        return None

    raw_value = None
    for child in root:
        ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if ctag == "Fields":
            for f in child:
                ftag = f.tag.split("}")[-1] if "}" in f.tag else f.tag
                if f.text and ftag in _EMAIL_FIELD_NAMES:
                    raw_value = f.text.strip()
                    break
            if raw_value is not None:
                break

    if not raw_value:
        return None
    # Normalize: lowercase, strip
    return raw_value.lower().strip()


def parse_gender_from_session_xml(session_xml_path) -> Optional[str]:
    """
    Parse session.xml and return Gender from Subject/Fields if present.

    Looks for a Fields child with tag "Gender". Returns the raw string value
    (callers should use normalize_gender() to get "Male" or "Female").

    Args:
        session_xml_path: Path to session.xml (str or Path).

    Returns:
        Raw gender string, or None if not found.
    """
    path = Path(session_xml_path)
    if not path.exists():
        return None
    try:
        text = _read_session_xml(path)
        root = ET.fromstring(text)
    except Exception:
        return None

    tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if tag != "Subject":
        return None

    for child in root:
        ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if ctag == "Fields":
            for f in child:
                ftag = f.tag.split("}")[-1] if "}" in f.tag else f.tag
                if ftag == "Gender" and f.text and f.text.strip():
                    return f.text.strip()
    return None


def get_dob_from_session_xml_next_to_file(file_path) -> Optional[str]:
    """
    Given a path to a data file (e.g. .c3d) from the first row of the export/txt file,
    look for session.xml in the same directory and return birthdate if present.
    The file_path does not need to exist; we use its parent directory to find session.xml.
    Used by Athletic Screen and Youth Pitch Design (arm action, curveball).

    Returns:
        Date string YYYY-MM-DD or None.
    """
    if not file_path or not str(file_path).strip():
        return None
    path = Path(file_path)
    session_path = path.parent / "session.xml"
    if not session_path.exists():
        return None
    return parse_birthdate_from_session_xml(session_path)
