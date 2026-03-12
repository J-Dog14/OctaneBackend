"""
Verify .env File Setup
Checks that all required environment variables are set correctly

Usage:
    python python/scripts/verify_env_setup.py
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse


def check_env_var(name: str, required: bool = True) -> tuple[bool, str, str]:
    """
    Check if environment variable is set and valid
    
    Returns:
        (is_set, value, message)
    """
    value = os.environ.get(name)
    
    if not value:
        if required:
            return (False, "", f"[MISSING] {name} is not set")
        else:
            return (False, "", f"[OPTIONAL] {name} is not set (not required)")
    
    # Validate it looks like a connection string
    if name.endswith("_DATABASE_URL"):
        try:
            parsed = urlparse(value)
            if not parsed.scheme or not parsed.hostname:
                return (True, value, f"[INVALID] {name} doesn't look like a valid connection string")
            
            # Check for SSL mode
            if 'sslmode=require' not in value and 'localhost' not in parsed.hostname:
                return (True, value, f"[WARNING] {name} doesn't have sslmode=require (may cause SSL errors)")
            
            # Mask password in display
            if parsed.password:
                masked = value.replace(parsed.password, "***")
                return (True, masked, f"[OK] {name} is set and looks valid")
            else:
                return (True, value, f"[OK] {name} is set")
        except Exception as e:
            return (True, value, f"[ERROR] {name} has parsing error: {e}")
    
    # For non-URL variables, just check if set
    if 'PASSWORD' in name:
        masked = "***" if value else ""
        return (True, masked, f"[OK] {name} is set")
    else:
        return (True, value, f"[OK] {name} is set")


def main():
    print("=" * 70)
    print("UAIS Environment Variables Verification")
    print("=" * 70)
    print()
    
    # Check if .env file exists
    project_root = Path(__file__).parent.parent.parent
    env_file = project_root / ".env"
    
    if env_file.exists():
        print(f"[OK] .env file found at: {env_file}")
        print()
    else:
        print(f"[WARNING] .env file not found at: {env_file}")
        print("  You may need to create it or set environment variables in system")
        print()
    
    # Try to load .env if python-dotenv is available
    try:
        from dotenv import load_dotenv
        if env_file.exists():
            load_dotenv(env_file, override=True)
            print("[OK] Loaded .env file with python-dotenv")
            print()
    except ImportError:
        print("[INFO] python-dotenv not installed - using system environment variables only")
        print("  Install with: pip install python-dotenv")
        print()
    except Exception as e:
        print(f"[WARNING] Error loading .env: {e}")
        print()
    
    # Required variables
    print("Required Variables:")
    print("-" * 70)
    
    required_vars = [
        ("APP_DATABASE_URL", True),
        ("WAREHOUSE_DATABASE_URL", True),
    ]
    
    all_ok = True
    for var_name, required in required_vars:
        is_set, value, message = check_env_var(var_name, required)
        print(f"{message}")
        if value and not var_name.endswith("_PASSWORD"):
            print(f"  Value: {value[:80]}..." if len(value) > 80 else f"  Value: {value}")
        if not is_set and required:
            all_ok = False
        print()
    
    # Vercel-specific variables (optional but helpful)
    print("Vercel Prisma Postgres Variables (Optional):")
    print("-" * 70)
    
    vercel_vars = [
        ("PRISMA_DATABASE_URL", False),
        ("POSTGRES_URL", False),
        ("POSTGRES_URL_NON_POOLING", False),
    ]
    
    vercel_found = False
    for var_name, required in vercel_vars:
        is_set, value, message = check_env_var(var_name, required)
        if is_set:
            vercel_found = True
        print(f"{message}")
        if value and len(value) > 0 and value != "***":
            print(f"  Value: {value[:80]}..." if len(value) > 80 else f"  Value: {value}")
        if var_name == "POSTGRES_URL_NON_POOLING" and not is_set:
            print("  [INFO] This is optional - only needed for Prisma migrations")
            print("  [INFO] You can use POSTGRES_URL for everything if this is missing")
        print()
    
    if vercel_found:
        print("[INFO] Vercel database connection strings found in .env")
        print("  This means the database exists in Vercel")
        print("  To view it: Vercel Dashboard → Your Project → Storage tab")
        print("  Note: You might not need this database - see docs/vercel-database-location-guide.md")
        print()
    
    # Check APP_DATABASE_URL configuration
    app_db_url = os.environ.get("APP_DATABASE_URL", "")
    postgres_url = os.environ.get("POSTGRES_URL", "")
    
    print("Database Configuration Check:")
    print("-" * 70)
    
    # APP_DATABASE_URL is the other app's database (read-only source of UUIDs)
    if app_db_url and "localhost" in app_db_url:
        print("[OK] APP_DATABASE_URL points to local database")
        print("  This is correct if you're using a local dump of the other app's database")
        print("  APP_DATABASE_URL = Other app's database (source of truth for UUIDs)")
        print()
    elif app_db_url and "localhost" not in app_db_url:
        print("[OK] APP_DATABASE_URL points to remote database")
        print("  This is correct if you're connecting to the other app's production database")
        print("  APP_DATABASE_URL = Other app's database (source of truth for UUIDs)")
        print()
    else:
        print("[WARNING] APP_DATABASE_URL is not set or empty")
        print()
    
    # WAREHOUSE_DATABASE_URL is YOUR warehouse (should go to Neon)
    warehouse_db_url = os.environ.get("WAREHOUSE_DATABASE_URL", "")
    if warehouse_db_url and "localhost" in warehouse_db_url:
        print("[INFO] WAREHOUSE_DATABASE_URL points to local database")
        print("  This is fine for now - you can migrate to Neon later")
        print("  WAREHOUSE_DATABASE_URL = Your UAIS warehouse database")
        print()
    elif warehouse_db_url and "localhost" not in warehouse_db_url:
        print("[OK] WAREHOUSE_DATABASE_URL points to cloud database (Neon)")
        print("  WAREHOUSE_DATABASE_URL = Your UAIS warehouse database")
        print()
    
    # Vercel database (optional - might not be needed)
    if vercel_found:
        print("[INFO] Vercel Prisma Postgres variables are set")
        print("  These are optional - you can use the Vercel database for:")
        print("    - A local copy/sync of the other app's database")
        print("    - Or delete it if you don't need it")
        print("  Your APP_DATABASE_URL should point to the OTHER app's database, not Vercel")
        print()
    
    # Other variables (PROTEUS, etc.)
    print("Other Variables:")
    print("-" * 70)
    
    other_vars = [
        ("PROTEUS_EMAIL", False),
        ("PROTEUS_PASSWORD", False),
        ("PROTEUS_LOCATION", False),
    ]
    
    for var_name, required in other_vars:
        is_set, value, message = check_env_var(var_name, required)
        print(f"{message}")
        print()
    
    # Summary
    print("=" * 70)
    if all_ok:
        print("[OK] All required variables are set!")
        print()
        print("Architecture Summary:")
        print("  APP_DATABASE_URL = Other app's database (source of UUIDs, read-only)")
        print("  WAREHOUSE_DATABASE_URL = Your UAIS warehouse database")
        print()
        print("Note: APP_DATABASE_URL pointing to localhost is CORRECT if you're")
        print("using a local dump of the other app's database.")
        print()
        print("Next steps:")
        print("  1. Test connections: python python/scripts/check_database_sizes.py")
        print("  2. When ready, migrate WAREHOUSE_DATABASE_URL to Neon")
        print("  3. Keep APP_DATABASE_URL as-is (other app's database)")
    else:
        print("[ERROR] Some required variables are missing!")
        print()
        print("Please set the missing variables in your .env file.")
        print("See docs/database-architecture-clarification.md for details.")
        sys.exit(1)
    
    print()


if __name__ == "__main__":
    main()

