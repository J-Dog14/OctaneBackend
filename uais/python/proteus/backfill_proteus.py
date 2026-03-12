"""
Backfill script for Proteus data.
Processes existing Excel files and loads them into the database.
"""
import sys
import logging
from pathlib import Path
from datetime import datetime

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from proteus.etl_proteus import process_proteus_file, get_processed_files, ensure_column_exists
from common.athlete_manager import get_warehouse_connection, update_athlete_flags
import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def backfill_proteus_file(excel_path: Path) -> bool:
    """
    Backfill a single Proteus Excel file.
    
    Args:
        excel_path: Path to Excel file
        
    Returns:
        True if successful, False otherwise
    """
    logger.info("=" * 80)
    logger.info("Proteus Backfill")
    logger.info("=" * 80)
    logger.info(f"Processing file: {excel_path}")
    
    if not excel_path.exists():
        logger.error(f"File not found: {excel_path}")
        return False
    
    # Connect to database
    conn = get_warehouse_connection()
    
    try:
        # Check if file already processed
        processed_files = get_processed_files(conn)
        file_path_normalized = str(excel_path.resolve())
        
        if file_path_normalized in processed_files:
            logger.warning(f"File already processed: {excel_path.name}")
            response = input("Process anyway? (y/n): ").strip().lower()
            if response != 'y':
                logger.info("Skipping file")
                return False
        
        # Process the file
        result = process_proteus_file(excel_path, conn)
        
        # process_proteus_file returns a list of UUIDs on success, False on failure
        if result is not False and result is not None:
            logger.info("✓ File processed successfully!")
            
            # Update athlete flags
            logger.info("Updating athlete data flags...")
            try:
                update_athlete_flags(conn=conn, verbose=True)
            except Exception as e:
                logger.warning(f"Could not update athlete flags: {e}")
            
            return True
        else:
            logger.error("✗ File processing failed")
            return False
            
    except Exception as e:
        logger.error(f"Error processing file: {e}", exc_info=True)
        return False
    finally:
        conn.close()


def backfill_directory(directory_path: Path) -> None:
    """
    Backfill all Excel files in a directory.
    
    Args:
        directory_path: Path to directory containing Excel files
    """
    logger.info("=" * 80)
    logger.info("Proteus Directory Backfill")
    logger.info("=" * 80)
    logger.info(f"Scanning directory: {directory_path}")
    
    if not directory_path.exists():
        logger.error(f"Directory not found: {directory_path}")
        return
    
    # Find all Excel files
    excel_files = list(directory_path.glob("*.xlsx")) + list(directory_path.glob("*.xls"))
    
    if not excel_files:
        logger.warning("No Excel files found in directory")
        return
    
    logger.info(f"Found {len(excel_files)} Excel files")
    
    # Connect to database
    conn = get_warehouse_connection()
    
    try:
        # Get processed files
        processed_files = get_processed_files(conn)
        processed_files_normalized = {str(Path(f).resolve()) for f in processed_files}
        
        # Filter out already processed files
        new_files = []
        for f in excel_files:
            file_path_normalized = str(f.resolve())
            if file_path_normalized not in processed_files_normalized:
                new_files.append(f)
            else:
                logger.info(f"  Skipping already processed: {f.name}")
        
        if not new_files:
            logger.info("All files have already been processed")
            return
        
        logger.info(f"Processing {len(new_files)} new files...")
        
        # Process each file
        processed_count = 0
        failed_count = 0
        
        for file_path in new_files:
            logger.info(f"\nProcessing: {file_path.name}")
            result = process_proteus_file(file_path, conn)
            # process_proteus_file returns a list of UUIDs on success, False on failure
            if result is not False and result is not None:
                processed_count += 1
            else:
                failed_count += 1
        
        # Update athlete flags
        logger.info("\nUpdating athlete data flags...")
        try:
            update_athlete_flags(conn=conn, verbose=True)
        except Exception as e:
            logger.warning(f"Could not update athlete flags: {e}")
        
        # Summary
        logger.info("=" * 80)
        logger.info("Backfill Summary")
        logger.info("=" * 80)
        logger.info(f"Processed: {processed_count} files")
        logger.info(f"Failed: {failed_count} files")
        
    finally:
        conn.close()


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Backfill Proteus data from Excel files')
    parser.add_argument('path', nargs='?', help='Path to Excel file or directory')
    parser.add_argument('--file', '-f', help='Process a single Excel file')
    parser.add_argument('--dir', '-d', help='Process all Excel files in a directory')
    
    args = parser.parse_args()
    
    if args.file:
        # Process single file
        file_path = Path(args.file)
        if not file_path.is_absolute():
            # First try relative to current directory
            if (Path.cwd() / file_path).exists():
                file_path = Path.cwd() / file_path
            # If not found, try relative to proteus directory (where script is located)
            elif (Path(__file__).parent / file_path).exists():
                file_path = Path(__file__).parent / file_path
            else:
                # Default to current directory (will show error if not found)
                file_path = Path.cwd() / file_path
        backfill_proteus_file(file_path)
    elif args.dir:
        # Process directory
        dir_path = Path(args.dir)
        if not dir_path.is_absolute():
            dir_path = Path.cwd() / dir_path
        backfill_directory(dir_path)
    elif args.path:
        # Process path (file or directory)
        path = Path(args.path)
        if not path.is_absolute():
            # First try relative to current directory
            if (Path.cwd() / path).exists():
                path = Path.cwd() / path
            # If not found, try relative to proteus directory (where script is located)
            elif (Path(__file__).parent / path).exists():
                path = Path(__file__).parent / path
            else:
                # Default to current directory (will show error if not found)
                path = Path.cwd() / path
        
        if path.is_file():
            backfill_proteus_file(path)
        elif path.is_dir():
            backfill_directory(path)
        else:
            logger.error(f"Path not found: {path}")
    else:
        # Default: look for any proteus export file in the proteus directory
        proteus_dir = Path(__file__).parent
        # Try to find the most recent proteus export file
        excel_files = list(proteus_dir.glob("proteus-export-*.xlsx")) + list(proteus_dir.glob("proteus-export-*.xls"))
        if excel_files:
            # Sort by modification time, most recent first
            excel_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            example_file = excel_files[0]
            logger.info(f"No path specified, using most recent file: {example_file.name}")
            backfill_proteus_file(example_file)
        else:
            parser.print_help()
            logger.error("\nPlease specify a file or directory to process")


if __name__ == "__main__":
    main()
