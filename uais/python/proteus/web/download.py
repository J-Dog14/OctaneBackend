"""
CSV download automation for Proteus web portal.
"""
import logging
import shutil
from pathlib import Path
from datetime import date, timedelta
from playwright.sync_api import Page, Browser, TimeoutError as PlaywrightTimeoutError, expect
from .config import get_proteus_base_url, get_date_range

logger = logging.getLogger(__name__)


def navigate_to_export_page(page: Page) -> bool:
    """
    Navigate to the data export/download page.
    
    Args:
        page: Playwright page object (should be logged in)
        
    Returns:
        True if navigation successful, False otherwise
    """
    base_url = get_proteus_base_url()
    export_url = f"{base_url}/admin/data-export"
    
    logger.info(f"Navigating to data export page: {export_url}")
    try:
        page.goto(export_url, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_timeout(3000)  # Wait for page to settle
        
        # Check if we're on the right page
        current_url = page.url
        if "data-export" in current_url.lower() or "export" in current_url.lower():
            logger.info(f"Successfully navigated to export page: {current_url}")
            return True
        else:
            logger.warning(f"Unexpected URL after navigation: {current_url}")
            # Take screenshot for debugging
            try:
                page.screenshot(path="export_page_navigation_debug.png")
                logger.info("Screenshot saved to export_page_navigation_debug.png")
            except:
                pass
            return False
    except Exception as e:
        logger.error(f"Error navigating to export page: {e}")
        return False


def set_date_range(page: Page, start_date: date, end_date: date) -> bool:
    """
    Set the date range for export.
    Tries to use "Today" option if available, otherwise fills date fields directly.
    
    Args:
        page: Playwright page object
        start_date: Start date for export
        end_date: End date for export
        
    Returns:
        True if date range set successfully, False otherwise
    """
    try:
        logger.info(f"Setting date range: {start_date} to {end_date}")
        
        # Format dates as strings (common formats)
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")
        
        # First, try to find and click "Today" buttons if both dates are today
        # (For daily runs, we use yesterday, so this won't apply, but good to have)
        today = date.today()
        if start_date == today and end_date == today:
            logger.info("Both dates are today - looking for 'Today' option...")
            today_selectors = [
                'button:has-text("Today")',
                'a:has-text("Today")',
                '[data-value="today"]',
                '[aria-label*="Today" i]',
            ]
            
            for selector in today_selectors:
                try:
                    today_buttons = page.query_selector_all(selector)
                    if len(today_buttons) >= 2:
                        # Click first "Today" for start date, second for end date
                        today_buttons[0].click()
                        page.wait_for_timeout(500)
                        today_buttons[1].click()
                        logger.info("Used 'Today' option for both dates")
                        return True
                except:
                    continue
        
        # Try to find Start Date and End Date fields (skip checkboxes - they can match name*="end" etc.)
        def is_fillable_date_input(el):
            return el and el.get_attribute("type") != "checkbox"

        start_date_selectors = [
            'input[type="date"]',
            'input[placeholder*="Start Date" i]',
            'input[name*="start" i]',
            'input[id*="start" i]',
            'input[aria-label*="Start" i]',
            'label:has-text("Start Date") + input',
            'label:has-text("Start") + input',
        ]

        end_date_selectors = [
            'input[type="date"]',
            'input[placeholder*="End Date" i]',
            'input[name*="end" i]',
            'input[id*="end" i]',
            'input[aria-label*="End" i]',
            'label:has-text("End Date") + input',
            'label:has-text("End") + input',
        ]

        start_input = None
        end_input = None

        for selector in start_date_selectors:
            try:
                element = page.query_selector(selector)
                if element and is_fillable_date_input(element):
                    start_input = element
                    logger.info(f"Found start date field with selector: {selector}")
                    break
            except Exception:
                continue

        for selector in end_date_selectors:
            try:
                element = page.query_selector(selector)
                if element and is_fillable_date_input(element) and element != start_input:
                    end_input = element
                    logger.info(f"Found end date field with selector: {selector}")
                    break
            except Exception:
                continue
        
        if start_input and end_input:
            # Fill both date fields
            start_input.fill(start_str)
            logger.info(f"Set start date to {start_str}")
            page.wait_for_timeout(500)
            
            end_input.fill(end_str)
            logger.info(f"Set end date to {end_str}")
            page.wait_for_timeout(500)
            return True
        elif start_input or end_input:
            logger.warning("Found only one date field - filling it with end date")
            if end_input:
                end_input.fill(end_str)
            else:
                start_input.fill(start_str)
            return True
        else:
            logger.warning("Could not find date input fields - trying alternative methods")
            # Try clicking on date fields to open date picker
            # Look for any input that might be a date field
            all_inputs = page.query_selector_all('input[type="date"], input[type="text"]')
            for inp in all_inputs:
                try:
                    placeholder = inp.get_attribute('placeholder') or ''
                    name = inp.get_attribute('name') or ''
                    if 'date' in placeholder.lower() or 'date' in name.lower():
                        # Try to fill it
                        inp.fill(start_str if 'start' in placeholder.lower() or 'start' in name.lower() else end_str)
                        logger.info(f"Filled date field: {placeholder or name}")
                except:
                    continue
            return True
        
    except Exception as e:
        logger.error(f"Error setting date range: {e}", exc_info=True)
        return False


def download_proteus_csv(
    page: Page,
    start_date: date,
    end_date: date,
    target_dir: Path
) -> Path:
    """
    Download Proteus CSV file for the given date range.
    
    Args:
        page: Playwright page object (should be logged in)
        start_date: Start date for export
        end_date: End date for export
        target_dir: Directory where CSV should be saved
        
    Returns:
        Path to downloaded CSV file
        
    Raises:
        Exception if download fails
    """
    try:
        # Navigate to export page (assumes already logged in)
        logger.info("Navigating to data export page...")
        if not navigate_to_export_page(page):
            raise Exception("Could not navigate to export page")
        
        # Wait for page to fully load
        page.wait_for_timeout(2000)
        
        # Set date range
        logger.info("Setting date range...")
        if not set_date_range(page, start_date, end_date):
            logger.warning("Could not set date range automatically - continuing anyway")
        
        # Wait a moment for any date picker updates
        page.wait_for_timeout(1000)
        
        logger.info("Date range set, ready to download")
        
        # Find and click Download button
        # On Proteus, the button is labeled "Download"
        export_button_selector = None
        for selector in [
            'button:has-text("Download")',
            'button:has-text("Export")',
            'button:has-text("Export CSV")',
            'button:has-text("Download CSV")',
            'a:has-text("Download")',
            'a:has-text("Export CSV")',
            'a:has-text("Download CSV")',
            'button[type="submit"]',
            'input[type="submit"]',
            'button[id*="download"]',
            'button[id*="export"]',
        ]:
            try:
                element = page.query_selector(selector)
                if element and element.is_visible():
                    export_button_selector = selector
                    break
            except:
                continue
        
        if not export_button_selector:
            # Take screenshot for debugging
            screenshot_path = target_dir / "proteus_export_page_debug.png"
            page.screenshot(path=str(screenshot_path))
            logger.error(f"Could not find export button. Screenshot saved to {screenshot_path}")
            raise Exception("Could not find export/download button on page")
        
        logger.info(f"Found export button with selector: {export_button_selector}")
        
        # Set up download tracking
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate expected filename (Proteus downloads as .xlsx, not .csv)
        date_str = f"{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}"
        expected_filename = f"proteus_export_{date_str}.xlsx"
        target_path = target_dir / expected_filename
        
        logger.info(f"Starting download, expecting file: {expected_filename}")
        
        # Click export button and wait for download
        with page.expect_download(timeout=60000) as download_info:
            page.click(export_button_selector)
        
        download = download_info.value
        
        # Save the downloaded file
        downloaded_path = target_dir / download.suggested_filename
        download.save_as(str(downloaded_path))
        logger.info(f"Downloaded file: {downloaded_path}")
        
        # Rename to expected filename if different
        if downloaded_path != target_path:
            if target_path.exists():
                # Add timestamp if file exists
                import time
                timestamp = int(time.time())
                target_path = target_dir / f"proteus_export_{date_str}_{timestamp}.xlsx"
            shutil.move(str(downloaded_path), str(target_path))
            logger.info(f"Renamed to: {target_path}")
        
        return target_path
        
    except Exception as e:
        logger.error(f"Error during download: {e}", exc_info=True)
        raise


def download_daily_csv(
    page: Page,
    target_dir: Path,
    start_date: date,
    end_date: date,
) -> Path:
    """
    Download Proteus CSV for the given date range.
    This is a convenience wrapper around download_proteus_csv.
    
    Args:
        page: Playwright page object (should be logged in)
        target_dir: Directory where CSV should be saved
        start_date: Start date for export
        end_date: End date for export
        
    Returns:
        Path to downloaded CSV file
    """
    return download_proteus_csv(page, start_date, end_date, target_dir)
