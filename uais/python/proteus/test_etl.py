"""
Test script to run Proteus ETL on existing CSV files.
Use this if you have CSV files already downloaded and want to test the ETL pipeline.
"""
import sys
import logging
from pathlib import Path

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from proteus.etl_proteus import run_daily_proteus_ingest
from proteus.web.config import get_proteus_inbox_dir, get_proteus_archive_dir

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Test ETL processing on existing CSV files."""
    logger.info("=" * 80)
    logger.info("Testing Proteus ETL Pipeline")
    logger.info("=" * 80)
    
    # Get directories
    inbox_dir = get_proteus_inbox_dir()
    archive_dir = get_proteus_archive_dir()
    
    logger.info(f"Inbox directory: {inbox_dir}")
    logger.info(f"Archive directory: {archive_dir}")
    
    # Check if inbox has files
    csv_files = list(inbox_dir.glob("*.csv"))
    logger.info(f"Found {len(csv_files)} CSV files in inbox")
    
    if not csv_files:
        logger.warning("No CSV files found in inbox directory!")
        logger.info(f"Please place CSV files in: {inbox_dir}")
        logger.info("Or run the full script to download from the portal:")
        logger.info("  python python/proteus/main.py")
        return
    
    # List files
    for csv_file in csv_files:
        logger.info(f"  - {csv_file.name}")
    
    # Run ETL
    try:
        logger.info("\nRunning ETL pipeline...")
        run_daily_proteus_ingest(inbox_dir=inbox_dir, archive_dir=archive_dir)
        logger.info("=" * 80)
        logger.info("ETL test completed successfully!")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"ETL test failed: {e}", exc_info=True)
        raise

if __name__ == "__main__":
    main()
