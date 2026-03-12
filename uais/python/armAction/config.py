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
APLUS_EVENTS_FILE = _get_env_path("ACTION_PLUS_EVENTS_FILE", "aPlus_events.txt")
APLUS_DATA_FILE = _get_env_path("ACTION_PLUS_DATA_FILE", "APlusData.txt")
AP_TORSO_V_FILE_NAME = _get_env_path("ACTION_PLUS_TORSO_VELO_FILE", "aPlus_torsoVelo.txt")
AP_ARM_V_FILE_NAME = _get_env_path("ACTION_PLUS_ARM_VELO_FILE", "aPlus_armVelo.txt")

# Full paths
APLUS_EVENTS_PATH = os.path.join(EXPORTS_DIR, APLUS_EVENTS_FILE)
APLUS_DATA_PATH = os.path.join(EXPORTS_DIR, APLUS_DATA_FILE)
AP_TORSO_V_FILE = os.path.join(EXPORTS_DIR, AP_TORSO_V_FILE_NAME)
AP_ARM_V_FILE = os.path.join(EXPORTS_DIR, AP_ARM_V_FILE_NAME)

# Report output settings
REPORTS_SUBDIR = _get_env_path("ACTION_PLUS_REPORTS_SUBDIR", "Action+")
OUTPUT_DIR = os.path.join(REPORTS_DIR, REPORTS_SUBDIR)
OUTPUT_DIR_TWO = os.path.join(REPORTS_GOOGLE_DRIVE, REPORTS_SUBDIR)
LOGO_PATH = os.path.join(LOGO_DIR, "8ctnae - Faded 8 to Blue.png")

# Image paths - located in Exports folder
IMG_FRONT_FP = os.path.join(EXPORTS_DIR, _get_env_path("ACTION_PLUS_IMG_FRONT_FP", "Front@FP.png"))
IMG_SAG_FP = os.path.join(EXPORTS_DIR, _get_env_path("ACTION_PLUS_IMG_SAG_FP", "sag@FP.png"))
IMG_SAG_MAXER = os.path.join(EXPORTS_DIR, _get_env_path("ACTION_PLUS_IMG_SAG_MAXER", "sag@MaxER.png"))
IMG_SAG_REL = os.path.join(EXPORTS_DIR, _get_env_path("ACTION_PLUS_IMG_SAG_REL", "sag@Rel.png"))

# Capture rate for frame calculations
CAPTURE_RATE = int(os.getenv("CAPTURE_RATE", "300"))

