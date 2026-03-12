#!/usr/bin/env python3
"""
Backfill UUIDs from verceldb for athletes in warehouse.

This script checks verceldb (master source of truth) for name matches and updates
UUIDs across all tables (d_athletes and all f_ tables) when matches are found.

Usage:
    python python/scripts/backfill_uuids_from_verceldb.py
    python python/scripts/backfill_uuids_from_verceldb.py --dry-run
"""

import sys
import argparse
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from python.common.athlete_manager import backfill_uuids_from_verceldb


def main():
    parser = argparse.ArgumentParser(
        description='Backfill UUIDs from verceldb for athletes in warehouse'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("UUID BACKFILL FROM VERCELDB")
    print("=" * 80)
    if args.dry_run:
        print("DRY RUN MODE - No changes will be made")
    print("=" * 80)
    print()
    
    result = backfill_uuids_from_verceldb(dry_run=args.dry_run)
    
    if result['errors']:
        print("\nErrors encountered:")
        for error in result['errors']:
            print(f"  - {error}")
    
    if args.dry_run:
        print("\nRun without --dry-run to apply changes")
    
    return 0 if not result['errors'] else 1


if __name__ == '__main__':
    sys.exit(main())

