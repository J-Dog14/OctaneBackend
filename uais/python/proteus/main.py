"""
Main orchestration script for Proteus data processing.
Handles web automation (download) and ETL processing.

Backfill failed dates (run from project root):
  python python/proteus/main.py --start 2026-01-28 --end 2026-02-11
  (Downloads that date range once and runs ETL on the export.)
"""
import argparse
import os
import sys
import logging
from pathlib import Path

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

# Set up logging to both console and file FIRST (before loading .env so we can log it)
def setup_logging():
    """Set up logging to both console and file."""
    from pathlib import Path
    from datetime import datetime
    
    # Create logs directory
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    
    # Create log file with timestamp
    log_file = log_dir / f"proteus_{datetime.now().strftime('%Y%m%d')}.log"
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8'),
            logging.StreamHandler()  # Also log to console
        ],
        force=True  # Override any existing configuration
    )
    
    return log_file

# Configure logging FIRST
log_file = setup_logging()
logger = logging.getLogger(__name__)

# NOW try to load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    env_path = project_root / '.env'
    if env_path.exists():
        logger.info("=" * 80)
        logger.info("DEBUG: Loading .env file")
        logger.info("=" * 80)
        logger.info(f"File path: {env_path}")
        logger.info(f"File exists: {env_path.exists()}")
        logger.info(f"File size: {env_path.stat().st_size} bytes")
        
        # First, read the file directly to see what's actually in it
        logger.info("\n--- Reading .env file directly ---")
        try:
            # Try utf-8-sig first to handle BOM
            with open(env_path, 'r', encoding='utf-8-sig') as f:
                all_lines = f.readlines()
                logger.info(f"Total lines in file: {len(all_lines)}")
                logger.info(f"[WARN] NOTE: File has BOM (Byte Order Mark) - this can cause parsing issues!")
                logger.info(f"   Consider re-saving the file as UTF-8 without BOM")
                
                # Show all non-empty lines
                logger.info("\nAll non-empty lines in file:")
                for i, line in enumerate(all_lines, 1):
                    stripped = line.rstrip('\n\r')
                    if stripped.strip():  # Only show non-empty lines
                        # Check if it's a PROTEUS_ line
                        is_proteus = stripped.strip().startswith('PROTEUS_')
                        marker = ">>> PROTEUS LINE <<<" if is_proteus else ""
                        logger.info(f"  Line {i:2d}: {repr(stripped)} {marker}")
                
                # Find PROTEUS_ lines specifically
                proteus_lines_found = []
                for i, line in enumerate(all_lines, 1):
                    stripped = line.strip()
                    if stripped.startswith('PROTEUS_'):
                        proteus_lines_found.append((i, stripped, line))
                
                logger.info(f"\nFound {len(proteus_lines_found)} PROTEUS_ lines:")
                for line_num, stripped, original in proteus_lines_found:
                    logger.info(f"  Line {line_num}: {stripped}")
                    logger.info(f"    Original (repr): {repr(original)}")
                    # Try to parse it manually
                    if '=' in stripped:
                        parts = stripped.split('=', 1)
                        logger.info(f"    Parsed: key='{parts[0]}', value='{parts[1]}'")
        except Exception as e:
            logger.error(f"Error reading file: {e}", exc_info=True)
        
        # Now try loading with python-dotenv
        logger.info("\n--- Loading with python-dotenv ---")
        logger.info("Environment BEFORE load_dotenv:")
        before_vars = {k: v for k, v in os.environ.items() if k.startswith('PROTEUS_')}
        logger.info(f"  PROTEUS_* variables: {len(before_vars)}")
        for k, v in before_vars.items():
            if 'PASSWORD' in k:
                logger.info(f"    {k}: {'*' * len(v)}")
            else:
                logger.info(f"    {k}: {v}")
        
        # Load the .env file
        result = load_dotenv(env_path, override=True)
        logger.info(f"\nload_dotenv() returned: {result}")
        
        # Check what's in environment AFTER loading
        logger.info("\nEnvironment AFTER load_dotenv:")
        all_proteus_vars = {k: v for k, v in os.environ.items() if k.startswith('PROTEUS_')}
        logger.info(f"  PROTEUS_* variables: {len(all_proteus_vars)}")
        if all_proteus_vars:
            logger.info("  [OK] Variables loaded successfully:")
            for key, value in all_proteus_vars.items():
                if 'PASSWORD' in key:
                    logger.info(f"    {key}: {'*' * len(value)} (set, {len(value)} chars)")
                else:
                    logger.info(f"    {key}: {value}")
        else:
            logger.error("  [ERROR] No PROTEUS_* variables found in environment!")
            
            # Try to manually parse and set them
            logger.info("\n--- Attempting manual parse and set ---")
            if proteus_lines_found:
                logger.info("Found PROTEUS_ lines in file, trying to set manually:")
                for line_num, stripped, original in proteus_lines_found:
                    if '=' in stripped:
                        parts = stripped.split('=', 1)
                        key = parts[0].strip()
                        value = parts[1].strip()
                        # Remove quotes if present
                        if value.startswith('"') and value.endswith('"'):
                            value = value[1:-1]
                        elif value.startswith("'") and value.endswith("'"):
                            value = value[1:-1]
                        
                        logger.info(f"  Setting {key} = {value if 'PASSWORD' not in key else '***'}")
                        os.environ[key] = value
                
                # Check again
                all_proteus_vars_after_manual = {k: v for k, v in os.environ.items() if k.startswith('PROTEUS_')}
                logger.info(f"\nAfter manual set: {len(all_proteus_vars_after_manual)} PROTEUS_* variables")
                if all_proteus_vars_after_manual:
                    logger.info("  [OK] Manual set successful!")
                    for key, value in all_proteus_vars_after_manual.items():
                        if 'PASSWORD' in key:
                            logger.info(f"    {key}: {'*' * len(value)}")
                        else:
                            logger.info(f"    {key}: {value}")
                    # Update the all_proteus_vars variable so the rest of the code sees them
                    all_proteus_vars = all_proteus_vars_after_manual
                else:
                    logger.error("  Manual set failed - variables still not in environment!")
            else:
                logger.error("  No PROTEUS_ lines found in file to manually set!")
                logger.error("")
                logger.error("  [WARN] IMPORTANT: The PROTEUS_ variables are NOT in your .env file!")
                logger.error(f"     File only has {len(all_lines)} lines, but PROTEUS_ variables should be at lines 26-28")
                logger.error("")
                logger.error("  SOLUTION: Add these lines to the END of your .env file:")
                logger.error("     PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
                logger.error("     PROTEUS_PASSWORD=DerekCarr4")
                logger.error("     PROTEUS_LOCATION=byoungphysicaltherapy")
                logger.error("")
                logger.error("  Also, your file has a BOM (Byte Order Mark) at the start.")
                logger.error("  Re-save the file as UTF-8 without BOM to fix parsing issues.")
        
        logger.info("=" * 80)
    else:
        logger.info(f".env file not found at {env_path}")
except ImportError:
    # python-dotenv not installed
    logger.warning("python-dotenv not installed. Install with: pip install python-dotenv")
    logger.warning("Continuing without .env file support...")
except Exception as e:
    logger.error(f"Error loading .env file: {e}", exc_info=True)

logger.info("=" * 80)
logger.info("Proteus Processing - Starting")
logger.info("=" * 80)
logger.info(f"Log file: {log_file}")


def main():
    """
    Main execution function.
    Runs the daily Proteus job: download + ETL.
    """
    # Check for required environment variables
    required_vars = ['PROTEUS_EMAIL', 'PROTEUS_PASSWORD']
    missing_vars = []
    
    # Check each variable and provide detailed feedback
    for var in required_vars:
        value = os.getenv(var)
        if not value:
            missing_vars.append(var)
            logger.warning(f"  {var}: NOT SET")
        else:
            if 'PASSWORD' in var:
                logger.info(f"  {var}: {'*' * len(value)} (set, {len(value)} chars)")
            else:
                logger.info(f"  {var}: {value}")
    
    if missing_vars:
        logger.error("=" * 80)
        logger.error(f"Missing required environment variables: {', '.join(missing_vars)}")
        logger.error("=" * 80)
        logger.error("\nTo fix this:")
        logger.error("1. Check your .env file format (no spaces around =, no quotes)")
        logger.error("2. Make sure .env file is in project root: " + str(project_root / '.env'))
        logger.error("3. Verify .env file contains (one per line, no spaces):")
        logger.error("   PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
        logger.error("   PROTEUS_PASSWORD=DerekCarr4")
        logger.error("\nOr set them temporarily in PowerShell:")
        for var in missing_vars:
            logger.error(f"   $env:{var} = \"your_value\"")
        logger.error("\nOr set them in Command Prompt:")
        for var in missing_vars:
            logger.error(f"   set {var}=your_value")
        return
    
    try:
        # Run the daily job (download + ETL)
        from proteus.web.runner import run_daily_proteus_job
        run_daily_proteus_job()
        logger.info("=" * 80)
        logger.info("Proteus job completed successfully")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"Error running Proteus job: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run Proteus download + ETL. Use --start/--end to backfill a date range."
    )
    parser.add_argument(
        "--start",
        metavar="YYYY-MM-DD",
        help="Backfill start date (use with --end). Overrides default date range.",
    )
    parser.add_argument(
        "--end",
        metavar="YYYY-MM-DD",
        help="Backfill end date (use with --start). Overrides default date range.",
    )
    args = parser.parse_args()
    if args.start:
        os.environ["PROTEUS_START_DATE"] = args.start
        logger.info("Backfill start date: %s", args.start)
    if args.end:
        os.environ["PROTEUS_END_DATE"] = args.end
        logger.info("Backfill end date: %s", args.end)
    main()
