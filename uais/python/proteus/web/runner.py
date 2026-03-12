"""
Main runner for Proteus web automation and ETL integration.
"""
import logging
import shutil
from pathlib import Path
from datetime import date
from playwright.sync_api import sync_playwright, Browser
from .config import (
    get_proteus_download_dir,
    get_proteus_inbox_dir,
    get_proteus_archive_dir,
    get_date_range,
    is_headless
)
from .login import login_to_proteus
from .download import download_daily_csv

logger = logging.getLogger(__name__)


def run_daily_proteus_job() -> None:
    """
    Main function to run daily Proteus job:
    1. Launches Playwright browser
    2. Logs into Proteus
    3. Downloads CSV for date range (default: yesterday)
    4. Moves CSV to ETL inbox directory
    5. Triggers ETL processing
    6. Archives processed files
    """
    logger.info("=" * 80)
    logger.info("Starting daily Proteus job")
    logger.info("=" * 80)
    
    download_dir = get_proteus_download_dir()
    inbox_dir = get_proteus_inbox_dir()
    archive_dir = get_proteus_archive_dir()
    
    logger.info(f"Download directory: {download_dir}")
    logger.info(f"Inbox directory: {inbox_dir}")
    logger.info(f"Archive directory: {archive_dir}")
    
    # Get date range (default: yesterday)
    start_date, end_date = get_date_range()
    logger.info(f"Date range: {start_date} to {end_date}")
    
    # Check network connectivity before launching browser
    # This is especially important for scheduled tasks that may run when network isn't ready
    import socket
    import time
    
    def check_network_connectivity(hostname: str = "kiosk.proteusmotion.com", max_retries: int = 3, retry_delay: int = 10) -> bool:
        """Check if network is available by resolving DNS and checking connectivity."""
        for attempt in range(max_retries):
            try:
                # Try to resolve DNS
                socket.gethostbyname(hostname)
                logger.info(f"Network connectivity check passed (attempt {attempt + 1}/{max_retries})")
                return True
            except socket.gaierror as e:
                logger.warning(f"Network connectivity check failed (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    logger.info(f"Waiting {retry_delay} seconds before retry...")
                    time.sleep(retry_delay)
                else:
                    logger.error(f"Network connectivity check failed after {max_retries} attempts")
                    logger.error("Possible causes:")
                    logger.error("  - Computer just woke from sleep (network adapter not ready)")
                    logger.error("  - No internet connection")
                    logger.error("  - DNS server not available")
                    logger.error("  - Firewall blocking DNS resolution")
                    return False
        return False
    
    # Check network before proceeding
    if not check_network_connectivity():
        logger.error("Network not available. Aborting Proteus job.")
        logger.error("The scheduled task will retry later (if configured).")
        return
    
    # Launch browser
    headless_mode = is_headless()
    logger.info("Launching browser...")
    if headless_mode:
        logger.info("  Running in headless mode (browser hidden)")
    else:
        logger.info("  Running with visible browser window (you can watch the process)")
        logger.info("  Set PROTEUS_HEADLESS=true to run in background")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless_mode,
            slow_mo=500  # Slow down actions by 500ms so you can see what's happening
        )
        # Create context with downloads enabled
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        
        try:
            # Login
            logger.info("Logging into Proteus...")
            if not login_to_proteus(page):
                logger.error("Login failed. Aborting.")
                return
            
            logger.info("Login successful!")
            
            # Download CSV (use the same page that's logged in)
            logger.info("Downloading CSV...")
            try:
                # Ensure downloads are accepted for this context
                context.set_extra_http_headers({})
                
                csv_path = download_daily_csv(
                    page=page,
                    target_dir=download_dir,
                    start_date=start_date,
                    end_date=end_date
                )
                logger.info(f"[OK] Downloaded CSV: {csv_path}")
            except Exception as e:
                logger.error(f"Failed to download CSV: {e}", exc_info=True)
                return
            
            # Move CSV to inbox
            inbox_path = inbox_dir / csv_path.name
            if inbox_path.exists():
                # Add timestamp if file exists
                import time
                timestamp = int(time.time())
                name_parts = csv_path.stem, csv_path.suffix
                inbox_path = inbox_dir / f"{name_parts[0]}_{timestamp}{name_parts[1]}"
            
            shutil.move(str(csv_path), str(inbox_path))
            logger.info(f"[OK] Moved CSV to inbox: {inbox_path}")
            
        finally:
            context.close()
            browser.close()
        
        # Run ETL
        logger.info("Running ETL pipeline...")
        try:
            from proteus.etl_proteus import run_daily_proteus_ingest
            run_daily_proteus_ingest(inbox_dir=inbox_dir, archive_dir=archive_dir)
            logger.info("[OK] ETL processing complete")
        except ImportError:
            # Fallback to existing ETL if new function doesn't exist
            logger.info("Using existing ETL function...")
            from proteus.etl_proteus import etl_proteus
            etl_proteus()
            logger.info("[OK] ETL processing complete")
        except Exception as e:
            logger.error(f"ETL processing failed: {e}", exc_info=True)
            raise
    
    logger.info("=" * 80)
    logger.info("Daily Proteus job complete")
    logger.info("=" * 80)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    run_daily_proteus_job()
