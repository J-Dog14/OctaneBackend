"""
Login automation for Proteus web portal.
"""
import logging
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
from .config import get_proteus_base_url, get_proteus_email, get_proteus_password, get_proteus_location

logger = logging.getLogger(__name__)


def login_to_proteus(page: Page) -> bool:
    """
    Log into Proteus web portal.
    
    Args:
        page: Playwright page object
        
    Returns:
        True if login successful, False otherwise
    """
    base_url = get_proteus_base_url()
    login_url = f"{base_url}/login"
    
    logger.info(f"Navigating to login page: {login_url}")
    logger.info("Note: If browser window is visible, you can watch the process")
    try:
        # Use longer timeout and less strict wait condition (2 min for slow networks / after wake)
        # "domcontentloaded" is faster than "networkidle"
        page.goto(login_url, wait_until="domcontentloaded", timeout=120000)
        logger.info("Page loaded, waiting for network to settle...")
        # Give it a moment for any dynamic content
        page.wait_for_timeout(5000)
    except PlaywrightTimeoutError as e:
        logger.error("Timeout loading login page after 120 seconds")
        logger.error(f"Error details: {e}")
        logger.error("Possible causes:")
        logger.error("  - Slow internet connection")
        logger.error("  - Website is down or slow")
        logger.error("  - Firewall/proxy blocking connection")
        logger.error("  - Check if you can access https://kiosk.proteusmotion.com/login in your browser")
        return False
    except Exception as e:
        error_str = str(e)
        if "ERR_NAME_NOT_RESOLVED" in error_str or "net::ERR" in error_str:
            logger.error(f"Network error loading login page: {e}")
            logger.error("This usually means:")
            logger.error("  - DNS resolution failed (network not ready)")
            logger.error("  - No internet connection")
            logger.error("  - Computer may have just woken from sleep")
            logger.error("  - Try running the task again in a few minutes")
        else:
            logger.error(f"Error loading login page: {e}")
        return False
    
    # Wait for login form to be visible
    try:
        logger.info("Step 1: Filling email and location on first page...")
        
        # Look for email/username input field
        email_selector = None
        for selector in ['input[type="email"]', 'input[name="email"]', 'input[id*="email"]', 
                        'input[name="username"]', 'input[id*="username"]', 'input[placeholder*="email" i]',
                        'input[placeholder*="Email" i]', 'input[placeholder*="User" i]']:
            try:
                page.wait_for_selector(selector, timeout=20000)
                email_selector = selector
                break
            except:
                continue
        
        if not email_selector:
            logger.error("Could not find email input field on login page")
            return False
        
        logger.info(f"Found email field with selector: {email_selector}")
        
        # Fill email
        email = get_proteus_email()
        page.fill(email_selector, email)
        logger.info("Filled email field")
        
        # Look for location field (required on first page)
        location = get_proteus_location()
        location_selector = None
        for selector in ['input[name="location"]', 'input[id*="location"]', 'select[name="location"]', 
                        'select[id*="location"]', 'input[placeholder*="location" i]',
                        'input[placeholder*="Location" i]', 'select[placeholder*="location" i]']:
            try:
                if page.wait_for_selector(selector, timeout=10000, state="visible"):
                    location_selector = selector
                    break
            except:
                continue
        
        if not location_selector:
            logger.warning("Could not find location field - continuing without it")
        else:
            logger.info(f"Found location field with selector: {location_selector}")
            if 'select' in location_selector:
                page.select_option(location_selector, location)
                logger.info(f"Selected location: {location}")
            else:
                page.fill(location_selector, location)
                logger.info(f"Filled location: {location}")
        
        # Find and click continue/next button to go to password page
        continue_button_selector = None
        for selector in ['button[type="submit"]', 'button:has-text("Continue")', 'button:has-text("Next")',
                        'button:has-text("Login")', 'button:has-text("Sign In")',
                        'input[type="submit"]', 'button[id*="continue"]', 'button[id*="next"]',
                        'button[id*="login"]', 'button[id*="signin"]']:
            try:
                if page.query_selector(selector):
                    continue_button_selector = selector
                    break
            except:
                continue
        
        if not continue_button_selector:
            logger.error("Could not find continue/next button on first page")
            return False
        
        logger.info(f"Found continue button with selector: {continue_button_selector}")
        logger.info("Clicking continue to go to password page...")
        
        # Click continue and wait for navigation to password page
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=60000):
                page.click(continue_button_selector)
            logger.info("Navigated to password page")
        except PlaywrightTimeoutError:
            logger.warning("Navigation timeout - page may have already changed, continuing...")
        
        # Wait for page to settle
        page.wait_for_timeout(3000)
        
        logger.info("Step 2: Filling password on second page...")
        
        # Look for password field on second page
        password_selector = None
        for selector in ['input[type="password"]', 'input[name="password"]', 'input[id*="password"]',
                        'input[placeholder*="password" i]', 'input[placeholder*="Password" i]']:
            try:
                page.wait_for_selector(selector, timeout=20000)
                password_selector = selector
                break
            except:
                continue
        
        if not password_selector:
            logger.error("Could not find password input field on password page")
            logger.error("Current URL: " + page.url)
            # Take a screenshot for debugging
            try:
                screenshot_path = "password_page_debug.png"
                page.screenshot(path=screenshot_path)
                logger.error(f"Screenshot saved to {screenshot_path} for debugging")
            except:
                pass
            return False
        
        logger.info(f"Found password field with selector: {password_selector}")
        
        # Fill password
        password = get_proteus_password()
        page.fill(password_selector, password)
        logger.info("Filled password field")
        
        # Find and click login/submit button on password page
        # On Proteus, the button is "Next" on the password page
        login_button_selector = None
        for selector in ['button:has-text("Next")', 'button:has-text("Login")', 'button:has-text("Sign In")',
                        'button[type="submit"]', 'button:has-text("Submit")', 'input[type="submit"]', 
                        'button[id*="login"]', 'button[id*="signin"]', 'button[id*="submit"]',
                        'button[id*="next"]']:
            try:
                if page.query_selector(selector):
                    login_button_selector = selector
                    break
            except:
                continue
        
        if not login_button_selector:
            logger.error("Could not find login/next button on password page")
            logger.error("Current URL: " + page.url)
            # Take a screenshot for debugging
            try:
                screenshot_path = "password_page_button_debug.png"
                page.screenshot(path=screenshot_path)
                logger.error(f"Screenshot saved to {screenshot_path} for debugging")
            except:
                pass
            return False
        
        logger.info(f"Found login/next button with selector: {login_button_selector}")
        logger.info("Clicking button to complete login...")
        
        # Click login and wait for navigation
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=60000):
                page.click(login_button_selector)
        except PlaywrightTimeoutError:
            logger.warning("Navigation timeout after login click - may have already navigated")
        
        # Wait a bit for any redirects
        page.wait_for_timeout(5000)
        
        # Check if we're logged in (not on login page anymore)
        current_url = page.url
        logger.info(f"Current URL after login: {current_url}")
        
        if "/login" in current_url.lower():
            logger.error("Still on login page after login attempt - login may have failed")
            # Check for error messages
            error_selectors = ['.error', '.alert', '[class*="error"]', '[class*="alert"]', 
                             '[class*="danger"]', '[role="alert"]']
            for selector in error_selectors:
                error_elem = page.query_selector(selector)
                if error_elem:
                    error_text = error_elem.inner_text()
                    if error_text.strip():
                        logger.error(f"Login error message: {error_text}")
            return False
        
        logger.info(f"Login successful! Current URL: {current_url}")
        return True
        
    except PlaywrightTimeoutError as e:
        logger.error(f"Timeout during login process: {e}")
        return False
    except Exception as e:
        logger.error(f"Error during login: {e}", exc_info=True)
        return False
