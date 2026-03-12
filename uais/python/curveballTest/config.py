"""
Configuration file containing all file paths and database settings.
Database connection is now handled by common.config and common.athlete_manager.
All paths are loaded from environment variables.
"""

import os
from pathlib import Path

# Load environment variables
def _get_env_path(key: str, default: str = None) -> str:
    """Get path from environment variable, with fallback to default."""
    value = os.getenv(key, default)
    if value is None:
        raise ValueError(f"Environment variable {key} is not set. Please set it in your .env file.")
    return value

# Base directories from environment
EXPORTS_DIR = _get_env_path("YOUTH_PITCH_DESIGN_EXPORTS_DIR", r"D:\Youth Pitch Design\Exports")
REPORTS_DIR = _get_env_path("YOUTH_PITCH_DESIGN_REPORTS_DIR", r"D:\Youth Pitch Design\Reports")
LOGO_DIR = _get_env_path("YOUTH_PITCH_DESIGN_LOGO_DIR", r"D:\Youth Pitch Design\Logo")
REPORTS_GOOGLE_DRIVE = _get_env_path("YOUTH_PITCH_DESIGN_REPORTS_GOOGLE_DRIVE", r"G:\My Drive\Youth Pitch Reports\Reports")

# Input file paths (relative to EXPORTS_DIR)
EVENTS_FILE = _get_env_path("CURVEBALL_EVENTS_FILE", "events.txt")
LINK_MODEL_BASED_FILE = _get_env_path("CURVEBALL_LINK_MODEL_BASED_FILE", "link_model_based.txt")
ACCEL_DATA_FILE = _get_env_path("CURVEBALL_ACCEL_DATA_FILE", "accel_data.txt")

# Reference file paths (relative to EXPORTS_DIR)
REF_EVENTS_FILE = _get_env_path("CURVEBALL_REF_EVENTS_FILE", "reference_events.txt")
REF_LINK_MODEL_BASED_FILE = _get_env_path("CURVEBALL_REF_LINK_MODEL_BASED_FILE", "reference_link_model_based.txt")
REF_ACCEL_DATA_FILE = _get_env_path("CURVEBALL_REF_ACCEL_DATA_FILE", "reference_accel_data.txt")

# Full paths
EVENTS_PATH = os.path.join(EXPORTS_DIR, EVENTS_FILE)
LINK_MODEL_BASED_PATH = os.path.join(EXPORTS_DIR, LINK_MODEL_BASED_FILE)
ACCEL_DATA_PATH = os.path.join(EXPORTS_DIR, ACCEL_DATA_FILE)
REF_EVENTS_PATH = os.path.join(EXPORTS_DIR, REF_EVENTS_FILE)
REF_LINK_MODEL_BASED_PATH = os.path.join(EXPORTS_DIR, REF_LINK_MODEL_BASED_FILE)
REF_ACCEL_DATA_PATH = os.path.join(EXPORTS_DIR, REF_ACCEL_DATA_FILE)

# Report output settings
REPORTS_SUBDIR = _get_env_path("CURVEBALL_REPORTS_SUBDIR", "Curveball")
OUTPUT_DIR = os.path.join(REPORTS_DIR, REPORTS_SUBDIR)
OUTPUT_DIR_TWO = os.path.join(REPORTS_GOOGLE_DRIVE, REPORTS_SUBDIR)
LOGO_PATH = os.path.join(LOGO_DIR, "8ctnae - Faded 8 to Blue.png")

# Database path for reference data (still uses SQLite for reference/baseline data)
# This is managed separately via updateReferenceData.py
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pitch_kinematics.db")

