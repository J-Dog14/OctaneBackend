"""Quick test script for Proteus - checks setup and runs ETL if files exist."""
import sys
from pathlib import Path

# Setup path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

# Load .env if available
try:
    from dotenv import load_dotenv
    load_dotenv(project_root / '.env')
except:
    pass

import os
print("=" * 60)
print("Proteus Quick Test")
print("=" * 60)

# Check env vars
email = os.getenv('PROTEUS_EMAIL')
password = os.getenv('PROTEUS_PASSWORD')
print(f"\nEnvironment Variables:")
print(f"  PROTEUS_EMAIL: {'SET' if email else 'NOT SET'}")
print(f"  PROTEUS_PASSWORD: {'SET' if password else 'NOT SET'}")

if not email or not password:
    print("\n⚠️  Missing environment variables!")
    print("Set them with:")
    print("  set PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
    print("  set PROTEUS_PASSWORD=DerekCarr4")
    print("\nOr create a .env file in the project root.")
    sys.exit(1)

# Check directories
try:
    from proteus.web.config import get_proteus_inbox_dir, get_proteus_archive_dir
    inbox = get_proteus_inbox_dir()
    archive = get_proteus_archive_dir()
    print(f"\nDirectories:")
    print(f"  Inbox: {inbox}")
    print(f"  Archive: {archive}")
    
    # Check for CSV files
    csv_files = list(inbox.glob("*.csv"))
    print(f"\nCSV Files in inbox: {len(csv_files)}")
    for f in csv_files:
        print(f"  - {f.name}")
    
    if csv_files:
        print("\n✓ Found CSV files! Running ETL...")
        from proteus.etl_proteus import run_daily_proteus_ingest
        run_daily_proteus_ingest(inbox_dir=inbox, archive_dir=archive)
        print("\n✓ ETL completed!")
    else:
        print("\n⚠️  No CSV files in inbox.")
        print("Options:")
        print("  1. Place CSV files in:", inbox)
        print("  2. Run full job to download: python python/proteus/main.py")
        
except Exception as e:
    print(f"\n✗ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 60)
print("Test complete!")
print("=" * 60)
