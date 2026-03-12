"""
Rotate Neon branch backups (weekly cascade).

Chain: prod -> dev -> backup -> backup 2; prod also copies to prod_alt if set.
Each week: backup 2 gets backup's data, backup gets dev's data, dev gets prod's data, prod_alt gets prod's data.
Run order: backup->backup2, then dev->backup, then prod->dev, then prod->prod_alt (if URL set).

Requires in .env: WAREHOUSE_DATABASE_URL (prod), plus _DEV, _BACKUP, _BACKUP2.
  Optional: _PROD_ALT (prod copy, like dev). Optional for app: APP_DATABASE_URL (prod), plus _DEV, _BACKUP, _BACKUP2, _PROD_ALT.

Usage:
  python python/scripts/rotate_neon_branches.py
  python python/scripts/rotate_neon_branches.py --dry-run
  python python/scripts/rotate_neon_branches.py --db warehouse
"""

import os
import sys
from pathlib import Path

# Add project root so we can import from python.scripts
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Load .env so WAREHOUSE_DATABASE_URL_* and APP_DATABASE_URL_* are set
try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass

from python.scripts.migrate_to_cloud import migrate_database

# Branch order for rotation: copy (source, target) in this order
ROTATION_STEPS = [
    ("backup", "backup2"),   # backup -> backup 2 (preserve oldest snapshot first)
    ("dev", "backup"),       # dev -> backup
    ("prod", "dev"),         # prod -> dev
]
# Optional: prod -> prod_alt (same as dev; run if _PROD_ALT URL is set)

ENV_SUFFIXES = {"prod": "PROD", "dev": "DEV", "backup": "BACKUP", "backup2": "BACKUP2"}


def get_branch_urls(db_name: str) -> dict:
    """Read connection strings for all four branches from environment.
    For prod, falls back to WAREHOUSE_DATABASE_URL / APP_DATABASE_URL if _PROD is not set.
    """
    base_var = "WAREHOUSE_DATABASE_URL" if db_name == "warehouse" else "APP_DATABASE_URL"
    urls = {}
    for branch, suffix in ENV_SUFFIXES.items():
        var = f"{base_var}_{suffix}"
        value = os.environ.get(var)
        if not value and branch == "prod":
            value = os.environ.get(base_var)  # Use WAREHOUSE_DATABASE_URL as prod
        if not value:
            return None
        urls[branch] = value
    return urls


def rotate_db(db_name: str, dry_run: bool = False) -> bool:
    """Run the 3-step rotation for one database. Returns True on success."""
    urls = get_branch_urls(db_name)
    if not urls:
        print(f"[SKIP] {db_name}: missing env vars. Set {db_name.upper()}_DATABASE_URL (or _PROD), _DEV, _BACKUP, _BACKUP2")
        return True  # skip, don't fail the whole run

    print(f"\n{'='*70}")
    print(f"Rotating Neon branches: {db_name}")
    print(f"{'='*70}")

    for source_branch, target_branch in ROTATION_STEPS:
        source_url = urls[source_branch]
        target_url = urls[target_branch]
        step_label = f"{source_branch} -> {target_branch}"
        print(f"\n--- Step: {step_label} ---")
        ok = migrate_database(
            source_url,
            target_url,
            db_name,
            dry_run=dry_run,
            confirm=False,
        )
        if ok is False:
            print(f"[ERROR] Rotation failed at {step_label}")
            return False

    # Optional: prod -> prod_alt (if WAREHOUSE_DATABASE_URL_PROD_ALT / APP_DATABASE_URL_PROD_ALT is set)
    base_var = "WAREHOUSE_DATABASE_URL" if db_name == "warehouse" else "APP_DATABASE_URL"
    prod_alt_url = os.environ.get(f"{base_var}_PROD_ALT")
    if prod_alt_url:
        step_label = "prod -> prod_alt"
        print(f"\n--- Step: {step_label} ---")
        ok = migrate_database(
            urls["prod"],
            prod_alt_url,
            db_name,
            dry_run=dry_run,
            confirm=False,
        )
        if ok is False:
            print(f"[ERROR] Rotation failed at {step_label}")
            return False
    return True


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Rotate Neon branch backups (prod->dev->backup->backup2 weekly cascade)"
    )
    parser.add_argument(
        "--db",
        choices=["warehouse", "app", "all"],
        default="warehouse",
        help="Database(s) to rotate (default: warehouse)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only show what would be done")
    args = parser.parse_args()

    if args.db == "all":
        dbs = ["warehouse", "app"]
    else:
        dbs = [args.db]

    failed = False
    for db_name in dbs:
        if not rotate_db(db_name, dry_run=args.dry_run):
            failed = True

    if failed:
        sys.exit(1)
    print("\n[OK] Neon branch rotation complete.")


if __name__ == "__main__":
    main()
