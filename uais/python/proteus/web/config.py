"""
Configuration for Proteus web automation.
"""
import os
from pathlib import Path
from typing import Optional
from datetime import date, timedelta


def get_proteus_base_url() -> str:
    """Get the base URL for Proteus client portal."""
    return os.getenv("PROTEUS_BASE_URL", "https://kiosk.proteusmotion.com")


def get_proteus_email() -> str:
    """Get Proteus login email from environment variable."""
    email = os.getenv("PROTEUS_EMAIL")
    if not email:
        raise ValueError(
            "PROTEUS_EMAIL environment variable not set. "
            "Set it with: set PROTEUS_EMAIL=your_email@example.com"
        )
    return email


def get_proteus_password() -> str:
    """Get Proteus login password from environment variable."""
    password = os.getenv("PROTEUS_PASSWORD")
    if not password:
        raise ValueError(
            "PROTEUS_PASSWORD environment variable not set. "
            "Set it with: set PROTEUS_PASSWORD=your_password"
        )
    return password


def get_proteus_location() -> str:
    """Get Proteus location from environment variable."""
    location = os.getenv("PROTEUS_LOCATION", "byoungphysicaltherapy")
    return location


def get_proteus_download_dir() -> Path:
    """Get directory where browser will save downloaded CSVs."""
    download_dir = os.getenv("PROTEUS_DOWNLOAD_DIR")
    if download_dir:
        return Path(download_dir)
    
    # Default to user's Downloads folder
    return Path.home() / "Downloads"


def get_proteus_inbox_dir() -> Path:
    """Get inbox directory where CSVs should be placed for ETL processing."""
    inbox_dir = os.getenv("PROTEUS_ETL_INBOX_DIR")
    if inbox_dir:
        # Check if drive exists if it's a drive letter path
        if len(inbox_dir) >= 2 and inbox_dir[1] == ':':
            drive = inbox_dir[0:2]
            try:
                os.listdir(drive + '\\')
            except:
                # Drive doesn't exist, fall through to local path
                inbox_dir = None
    
    if inbox_dir:
        return Path(inbox_dir)
    
    # Default to proteus raw data path from config
    try:
        from common.config import get_raw_paths
        paths = get_raw_paths()
        proteus_path = paths.get('proteus')
        if proteus_path:
            # Check if drive exists
            if len(proteus_path) >= 2 and proteus_path[1] == ':':
                drive = proteus_path[0:2]
                try:
                    os.listdir(drive + '\\')
                except:
                    # Drive doesn't exist, fall through to local path
                    proteus_path = None
            
            if proteus_path:
                inbox = Path(proteus_path) / "inbox"
                inbox.mkdir(parents=True, exist_ok=True)
                return inbox
    except:
        pass
    
    # Fallback to project directory (always available)
    project_root = Path(__file__).parent.parent.parent.parent
    inbox = project_root / "data" / "proteus" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    return inbox


def get_proteus_archive_dir() -> Path:
    """Get archive directory where processed CSVs should be moved."""
    archive_dir = os.getenv("PROTEUS_ETL_ARCHIVE_DIR")
    if archive_dir:
        # Check if drive exists if it's a drive letter path
        if len(archive_dir) >= 2 and archive_dir[1] == ':':
            drive = archive_dir[0:2]
            try:
                os.listdir(drive + '\\')
            except:
                # Drive doesn't exist, fall through to local path
                archive_dir = None
    
    if archive_dir:
        return Path(archive_dir)
    
    # Default to proteus raw data path from config
    try:
        from common.config import get_raw_paths
        paths = get_raw_paths()
        proteus_path = paths.get('proteus')
        if proteus_path:
            # Check if drive exists
            if len(proteus_path) >= 2 and proteus_path[1] == ':':
                drive = proteus_path[0:2]
                try:
                    os.listdir(drive + '\\')
                except:
                    # Drive doesn't exist, fall through to local path
                    proteus_path = None
            
            if proteus_path:
                archive = Path(proteus_path) / "archive"
                archive.mkdir(parents=True, exist_ok=True)
                return archive
    except:
        pass
    
    # Fallback to project directory (always available)
    project_root = Path(__file__).parent.parent.parent.parent
    archive = project_root / "data" / "proteus" / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    return archive


def get_proteus_date_range_days() -> int:
    """Get number of days to include in date range (default: 1 for yesterday)."""
    return int(os.getenv("PROTEUS_DATE_RANGE_DAYS", "1"))


def get_date_range(days: Optional[int] = None) -> tuple[date, date]:
    """
    Get date range for CSV download.
    If PROTEUS_START_DATE and PROTEUS_END_DATE are set (e.g. for backfill), use those.
    Otherwise use default: yesterday, or N days back from yesterday.

    Args:
        days: Number of days to go back (default: from PROTEUS_DATE_RANGE_DAYS env var)

    Returns:
        Tuple of (start_date, end_date)
    """
    start_str = os.getenv("PROTEUS_START_DATE")
    end_str = os.getenv("PROTEUS_END_DATE")
    if start_str and end_str:
        try:
            start_date = date.fromisoformat(start_str.strip())
            end_date = date.fromisoformat(end_str.strip())
            if start_date <= end_date:
                return start_date, end_date
        except ValueError:
            pass

    if days is None:
        days = get_proteus_date_range_days()

    end_date = date.today() - timedelta(days=1)  # Yesterday
    start_date = end_date - timedelta(days=days - 1)  # Go back N days from yesterday

    return start_date, end_date


def is_headless() -> bool:
    """Check if browser should run in headless mode."""
    # Default to False (show browser) for easier debugging
    # Set PROTEUS_HEADLESS=true to run in background
    return os.getenv("PROTEUS_HEADLESS", "false").lower() == "true"
