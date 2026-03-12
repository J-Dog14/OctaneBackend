#!/usr/bin/env python3
"""
Backfill source_athlete_map table from existing d_athletes records.

This script should be run once to populate the mapping table with existing data.
After this, the mapping table will be maintained automatically by get_or_create_athlete
and deduplication functions.

Usage:
    python python/scripts/backfill_source_athlete_map.py --dry-run
    python python/scripts/backfill_source_athlete_map.py
"""

import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection
from python.common.source_athlete_map import backfill_source_mappings, ensure_source_map_table
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Backfill source_athlete_map table from existing d_athletes records'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )
    
    args = parser.parse_args()
    
    logger.info("=" * 80)
    logger.info("BACKFILLING SOURCE ATHLETE MAP")
    logger.info("=" * 80)
    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
    logger.info("")
    
    conn = get_warehouse_connection()
    
    try:
        # Ensure table exists
        logger.info("Ensuring source_athlete_map table exists...")
        ensure_source_map_table(conn)
        logger.info("✓ Table exists")
        logger.info("")
        
        # Backfill mappings
        logger.info("Backfilling mappings from d_athletes...")
        mappings_added = backfill_source_mappings(conn, dry_run=args.dry_run)
        
        logger.info("")
        logger.info("=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)
        logger.info(f"Mappings added: {mappings_added}")
        logger.info("=" * 80)
        
        if args.dry_run:
            logger.info("\nRun without --dry-run to apply changes")
        
        return 0
        
    except Exception as e:
        logger.exception(f"Error: {e}")
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())

