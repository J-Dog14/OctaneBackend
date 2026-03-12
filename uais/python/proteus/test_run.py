"""
Test script for Proteus processing.
This will:
1. Check if environment variables are set
2. Check if there are CSV files in inbox (if so, run ETL only)
3. If no files, run full download + ETL
"""
import sys
import os
import logging
from pathlib import Path

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

# Try to load .env file
try:
    from dotenv import load_dotenv
    env_path = project_root / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded .env file from {env_path}")
except ImportError:
    pass

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def check_environment():
    """Check if required environment variables are set."""
    required = ['PROTEUS_EMAIL', 'PROTEUS_PASSWORD']
    missing = []
    
    for var in required:
        if not os.getenv(var):
            missing.append(var)
    
    if missing:
        logger.error("Missing required environment variables:")
        for var in missing:
            logger.error(f"  - {var}")
        logger.info("\nSet them with:")
        logger.info("  set PROTEUS_EMAIL=your_email@example.com")
        logger.info("  set PROTEUS_PASSWORD=your_password")
        logger.info("\nOr create a .env file in the project root with:")
        logger.info("  PROTEUS_EMAIL=your_email@example.com")
        logger.info("  PROTEUS_PASSWORD=your_password")
        return False
    
    logger.info("✓ Environment variables are set")
    logger.info(f"  PROTEUS_EMAIL: {os.getenv('PROTEUS_EMAIL')}")
    logger.info(f"  PROTEUS_LOCATION: {os.getenv('PROTEUS_LOCATION', 'byoungphysicaltherapy')}")
    return True

def check_inbox_files():
    """Check if there are CSV files in the inbox."""
    try:
        from proteus.web.config import get_proteus_inbox_dir
        inbox_dir = get_proteus_inbox_dir()
        csv_files = list(inbox_dir.glob("*.csv"))
        return inbox_dir, csv_files
    except Exception as e:
        logger.warning(f"Could not check inbox: {e}")
        return None, []

def main():
    """Main test function."""
    logger.info("=" * 80)
    logger.info("Proteus Processing Test")
    logger.info("=" * 80)
    
    # Check environment
    if not check_environment():
        logger.error("\nPlease set environment variables before running.")
        return
    
    # Check inbox
    inbox_dir, csv_files = check_inbox_files()
    if inbox_dir:
        logger.info(f"\nInbox directory: {inbox_dir}")
        logger.info(f"Found {len(csv_files)} CSV files in inbox")
        
        if csv_files:
            logger.info("\nFiles found:")
            for f in csv_files:
                logger.info(f"  - {f.name}")
            
            # Ask user what to do
            logger.info("\n" + "=" * 80)
            logger.info("OPTIONS:")
            logger.info("1. Run ETL only (process existing CSV files)")
            logger.info("2. Run full job (download + ETL)")
            logger.info("=" * 80)
            
            choice = input("\nEnter choice (1 or 2, default=1): ").strip() or "1"
            
            if choice == "1":
                # Run ETL only
                logger.info("\nRunning ETL on existing files...")
                try:
                    from proteus.etl_proteus import run_daily_proteus_ingest
                    from proteus.web.config import get_proteus_archive_dir
                    archive_dir = get_proteus_archive_dir()
                    run_daily_proteus_ingest(inbox_dir=inbox_dir, archive_dir=archive_dir)
                    logger.info("\n✓ ETL completed successfully!")
                except Exception as e:
                    logger.error(f"\n✗ ETL failed: {e}", exc_info=True)
                    raise
            else:
                # Run full job
                logger.info("\nRunning full job (download + ETL)...")
                try:
                    from proteus.web.runner import run_daily_proteus_job
                    run_daily_proteus_job()
                    logger.info("\n✓ Full job completed successfully!")
                except Exception as e:
                    logger.error(f"\n✗ Full job failed: {e}", exc_info=True)
                    raise
        else:
            # No files, run full job
            logger.info("\nNo CSV files in inbox. Running full job (download + ETL)...")
            try:
                from proteus.web.runner import run_daily_proteus_job
                run_daily_proteus_job()
                logger.info("\n✓ Full job completed successfully!")
            except Exception as e:
                logger.error(f"\n✗ Full job failed: {e}", exc_info=True)
                raise
    else:
        # Can't check inbox, try full job
        logger.warning("\nCould not determine inbox directory. Attempting full job...")
        try:
            from proteus.web.runner import run_daily_proteus_job
            run_daily_proteus_job()
            logger.info("\n✓ Full job completed successfully!")
        except Exception as e:
            logger.error(f"\n✗ Full job failed: {e}", exc_info=True)
            raise
    
    logger.info("\n" + "=" * 80)
    logger.info("Test complete!")
    logger.info("=" * 80)

if __name__ == "__main__":
    main()
