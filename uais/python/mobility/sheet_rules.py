"""
Rules for reading a mobility Google Sheet: which template it uses, which
values can be trusted, what date the session happened, and who it belongs to.

Kept separate from main.py so the backfill script and tests use the exact same
rules as the nightly pull.

Two templates exist in the Drive folder:

* "v2"     — UPDATED Mobility Assessment Template: rows 11-80, column C holds
             optimal ranges (header "OPTIMAL RANGES" on row 9). Real degrees,
             dynamometer readings and 1-3 grades, each in its own row.
* "legacy" — the old "Assessment Key" sheet: header on row 8, column B is
             "COLOR OR NUMBERS" — almost everything is a 1-3 color grade, with
             labels like "Cervical-rotation" that don't map to the v2 columns.

For legacy sheets only values on the same scale as v2 are kept (decision
2026-10-14): 1-3 tests that are 1-3 in both templates, and degree / grip
columns only when the value is clearly a measurement (> 3). Every raw cell is
still stored in f_mobility.raw_values so nothing is lost.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from typing import Any, Dict, Optional, Tuple

# 1-3 graded tests in both templates (mirrors lib/octane/mobilityColumnTypes.ts SCALE_3_COLUMNS)
SCALE_3_COLUMNS = frozenset({
    "back_to_wall_shoulder_flexion", "pelvic_tilt_against_wall", "radial_nerve_glide",
    "ulnar_nerve_glide", "backbend", "slump_test", "thomas_test_hip_flexor_r",
    "thomas_test_hip_flexor_l", "young_stretch_passive", "hip_pinch", "scap_winging",
})

# Measurements (degrees or lbs). In a legacy sheet a value of 1-3 in one of these
# is a color grade, not a measurement.
MEASUREMENT_COLUMNS_LEGACY_GUARD = frozenset({
    "elbow_extension_rom", "elbow_flexion_rom", "elbow_pronation_rom", "elbow_supination_rom",
    "r_prone_hip_ir", "r_prone_hip_er", "l_prone_hip_ir", "l_prone_hip_er",
    "sittiing_t_spine_pvc_r", "sittiing_t_spine_pvc_l",
    "grip_strength_r", "gs_l", "grip_strength_r_at_90", "gs_l_at_90",
})


# Row labels that only exist in the old "Assessment Key" sheet (sanitized form).
LEGACY_ONLY_LABELS = frozenset({
    "cervical_rotation", "cervical_flexion", "cervical_extension", "cervical_lateral_flexion",
    "shoulder_total_arc", "horizontal_abduction", "shoulder_ir", "shoulder_er",
    "shoulder_stability_flexion", "shoulder_stability_abduction", "supine_shoulder_flexion",
    "ankle_dorsiflextion_to_wall", "ankle_manual_test", "hamstring_stretch", "mid_trap", "low_trap",
    "prone_hamstring_raise", "glute_strength_test_prone_hammy_push", "elbow_extension", "elbow_flexion",
})


def _sanitize(label: Any) -> str:
    n = re.sub(r"[^a-zA-Z0-9_]", "_", str(label).strip())
    return re.sub(r"_+", "_", n).strip("_").lower()


def detect_template(ws) -> str:
    """
    'legacy' only for the old Assessment Key sheet: no OPTIMAL RANGES header and at
    least one row label that exists only in that template. Anything else is read as
    v2, so a trimmed-down re-check sheet (header row deleted, only a few rows kept)
    isn't mistaken for the old template and stripped of its degree values.
    """
    for r in (8, 9, 10):
        v = ws[f"C{r}"].value
        if v is not None and "OPTIMAL" in str(v).upper():
            return "v2"
    for r in range(8, 81):
        label = ws[f"A{r}"].value
        if label is not None and _sanitize(label) in LEGACY_ONLY_LABELS:
            return "legacy"
    return "v2"


def filter_legacy_metrics(metrics: Dict[str, Optional[float]]) -> Tuple[Dict[str, Optional[float]], Dict[str, Any]]:
    """
    Keep only legacy values that mean the same thing as in v2.
    Returns (kept, dropped) where dropped maps column -> raw value (for logging).
    """
    kept: Dict[str, Optional[float]] = {}
    dropped: Dict[str, Any] = {}
    for key, val in metrics.items():
        if val is None:
            continue
        if key in SCALE_3_COLUMNS:
            if 1 <= val <= 3:
                kept[key] = val
            else:
                dropped[key] = val
        elif key in MEASUREMENT_COLUMNS_LEGACY_GUARD:
            if val > 3:
                kept[key] = val
            else:
                dropped[key] = val
        else:
            dropped[key] = val
    return kept, dropped


def read_raw_values(ws, first_row: int = 8, last_row: int = 80) -> Dict[str, Any]:
    """Every non-empty (label -> value) pair in columns A/B, as written in the sheet."""
    out: Dict[str, Any] = {}
    for r in range(first_row, last_row + 1):
        label = ws[f"A{r}"].value
        if label is None or not str(label).strip():
            continue
        val = ws[f"B{r}"].value
        if val is None or (isinstance(val, str) and not val.strip()):
            continue
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        elif not isinstance(val, (int, float)):
            val = str(val).strip()
        key = str(label).strip()
        if key in out:  # duplicate label: keep both
            key = f"{key} (row {r})"
        out[key] = val
    return out


# ---------------------------------------------------------------------------
# Height
# ---------------------------------------------------------------------------

def parse_height_inches(raw: Any) -> Optional[float]:
    """
    Height in inches from the B6 cell, or None when it can't be read safely.
    "Height: 6' 4''" -> 76, "5 10" -> 70, "Height: 71" -> 71, "16 yo, 5'10'', 160" -> 70,
    "70 in" -> 70. Anything outside 36-90 in is rejected (ages, weights, dates).
    The old parser kept only the first number, so 6' 4'' was stored as 6.
    """
    if raw is None or isinstance(raw, (datetime, date)):
        return None
    s = re.sub(r"(?i)^\s*height\s*:?", "", str(raw)).strip()
    if not s:
        return None
    val: Optional[float] = None
    m = re.search(r"(?<!\d)([3-7])\s*(?:'|’|ft\b|feet\b)\s*(\d{1,2}(?:\.\d+)?)?", s, re.I)
    if m:
        val = int(m.group(1)) * 12 + (float(m.group(2)) if m.group(2) else 0.0)
    else:
        m = re.match(r"^([3-7])\s+(\d{1,2}(?:\.\d+)?)\b", s)
        if m:
            val = int(m.group(1)) * 12 + float(m.group(2))
        else:
            m = re.search(r"(\d{2}(?:\.\d+)?)\s*(?:in\b|inches|\")", s, re.I)
            if m:
                val = float(m.group(1))
            else:
                m = re.match(r"^(\d+(?:\.\d+)?)\s*$", s)
                if m:
                    v = float(m.group(1))
                    val = v * 12 if v < 8 else v
    if val is None or not (36 <= val <= 90):
        return None
    return round(val, 1)


# ---------------------------------------------------------------------------
# Athlete name from the file name (only used when A6 is blank)
# ---------------------------------------------------------------------------

_NAME_STOP = {
    "mobility", "assessment", "asesesment", "assesment", "key", "remote", "short", "strength",
    "recheck", "re-check", "retest", "re-test", "reassessment", "reassess", "follow", "followup",
    "follow-up", "screen", "update", "updated", "cervical", "shoulder", "shoulders", "elbow",
    "hip", "hips", "spine", "core", "ankle", "ankles", "grip", "stability", "mobility-strength",
    "mobility/strength", "partial", "check", "test",
}
_MONTHS = {m.lower(): i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september",
     "october", "november", "december"], start=1)}
_MONTHS.update({k[:3]: v for k, v in list(_MONTHS.items())})


def name_from_filename(file_name: str) -> Optional[str]:
    """
    "Ryan Weiss Mobility Assessment 5-27.xlsx" -> "Ryan Weiss"
    "Ryan Weiss Shoulder Recheck 10-14.xlsx"   -> "Ryan Weiss"
    "Braden PolegaAssessment Key.xlsx"         -> "Braden Polega"
    Returns None for templates / nothing usable.
    """
    stem = os.path.splitext(os.path.basename(file_name))[0]
    stem = re.sub(r"\s*\[[^\]]*\]\s*$", "", stem)            # " [2026-10-14]" added for same-named sheets
    stem = re.sub(r"(?<=[a-z])(Assessment|Mobility)", r" \1", stem)  # "PolegaAssessment"
    out = []
    for tok in re.split(r"\s+", stem.strip()):
        low = tok.lower().strip("-_,.()")
        if not low:
            continue
        if low in _NAME_STOP or low in _MONTHS or any(ch.isdigit() for ch in low):
            break
        out.append(tok)
    name = " ".join(out).strip(" -_")
    if not name or name.lower() in {"template", "updated", "mobility", "remote"}:
        return None
    return name


# ---------------------------------------------------------------------------
# Session date
# ---------------------------------------------------------------------------

def _plausible(d: date) -> bool:
    return date(2018, 1, 1) <= d <= date.today()


def date_from_filename(file_name: str, reference: Optional[date] = None) -> Optional[date]:
    """
    Dates written into the sheet name: "5-27", "5-6-2026", "5/15/26", "10.14.2026", "5 15".
    Without a year, the year is the one closest to `reference` (the Drive created date).
    """
    stem = os.path.splitext(os.path.basename(file_name))[0]
    stem = re.sub(r"\s*\[[^\]]*\]\s*$", "", stem)  # our own " [created date]" suffix isn't a written date
    ref = reference or date.today()
    iso = re.search(r"(?<!\d)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)", stem)
    if iso:
        try:
            d = date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
            return d if _plausible(d) else None
        except ValueError:
            return None
    m = re.search(r"(?<!\d)(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2,4}))?(?!\d)", stem)
    if not m:
        return None
    mo, dy, yr = int(m.group(1)), int(m.group(2)), m.group(3)
    if yr:
        y = int(yr)
        if y < 100:
            y += 2000
        try:
            d = date(y, mo, dy)
        except ValueError:
            return None
        return d if _plausible(d) else None
    # No year written: take the year that puts it closest to the reference date
    # (sheets are sometimes created a few days before the session).
    best = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            d = date(y, mo, dy)
        except ValueError:
            continue
        if _plausible(d) and (best is None or abs((d - ref).days) < abs((best - ref).days)):
            best = d
    return best


def read_drive_meta(file_path: str) -> Optional[Dict[str, Any]]:
    """The <file>.meta.json sidecar written at download: {id, name, createdTime, modifiedTime}."""
    p = file_path + ".meta.json"
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _iso_day(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def session_date_from(file_name: str, created_iso: Optional[str], legacy_sidecar: Optional[str] = None) -> Tuple[Optional[date], str]:
    """
    Session date and where it came from:
      1. a date written in the file name ("... 5-27")   -> 'filename'
      2. the Drive created date                         -> 'drive_created'
      3. the old .date sidecar (Drive modified date)    -> 'legacy_sidecar'
    Returns (None, 'unknown') when none exist.
    """
    created = _iso_day(created_iso)
    sidecar = _iso_day(legacy_sidecar)
    from_name = date_from_filename(file_name, reference=created or sidecar)
    if from_name:
        return from_name, "filename"
    if created:
        return created, "drive_created"
    if sidecar:
        return sidecar, "legacy_sidecar"
    return None, "unknown"


def resolve_session_date(file_path: str) -> Tuple[Optional[date], str]:
    """
    session_date_from() for a cached sheet, reading its .meta.json / .date sidecars.
    The local file time is never used: it is the day the file was downloaded,
    which is how 173 sheets ended up dated 2026-06-08.
    """
    meta = read_drive_meta(file_path)
    sidecar = None
    if os.path.exists(file_path + ".date"):
        try:
            sidecar = open(file_path + ".date", encoding="utf-8").read().strip()
        except Exception:
            sidecar = None
    return session_date_from(file_path, meta.get("createdTime") if meta else None, sidecar)
