"""Quick script to check if .env file is being loaded correctly."""
import sys
from pathlib import Path

# Setup path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

print("=" * 60)
print("Checking .env file loading")
print("=" * 60)

# Check if python-dotenv is installed
try:
    import dotenv
    print("✓ python-dotenv is installed")
except ImportError:
    print("✗ python-dotenv is NOT installed")
    print("  Install with: pip install python-dotenv")
    sys.exit(1)

# Check .env file location
env_path = project_root / '.env'
print(f"\n.env file path: {env_path}")
print(f"  Exists: {env_path.exists()}")

if env_path.exists():
    # Try to load it
    from dotenv import load_dotenv
    import os
    
    # Clear any existing values
    if 'PROTEUS_EMAIL' in os.environ:
        del os.environ['PROTEUS_EMAIL']
    if 'PROTEUS_PASSWORD' in os.environ:
        del os.environ['PROTEUS_PASSWORD']
    
    # Load .env
    result = load_dotenv(env_path, override=True)
    print(f"  Load result: {result}")
    
    # Check what was loaded
    print("\nEnvironment variables after loading .env:")
    email = os.getenv('PROTEUS_EMAIL')
    password = os.getenv('PROTEUS_PASSWORD')
    location = os.getenv('PROTEUS_LOCATION')
    
    print(f"  PROTEUS_EMAIL: {email if email else 'NOT SET'}")
    print(f"  PROTEUS_PASSWORD: {'SET (' + str(len(password)) + ' chars)' if password else 'NOT SET'}")
    print(f"  PROTEUS_LOCATION: {location if location else 'NOT SET'}")
    
    if not email or not password:
        print("\n⚠️  Missing required variables!")
        print("\nYour .env file should contain:")
        print("PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
        print("PROTEUS_PASSWORD=DerekCarr4")
        print("PROTEUS_LOCATION=byoungphysicaltherapy")
        print("\nMake sure:")
        print("  1. No spaces around the = sign")
        print("  2. No quotes around values (unless they contain spaces)")
        print("  3. One variable per line")
    else:
        print("\n✓ All required variables are set!")
else:
    print("\n⚠️  .env file not found!")
    print(f"Create it at: {env_path}")
    print("\nWith contents:")
    print("PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
    print("PROTEUS_PASSWORD=DerekCarr4")
    print("PROTEUS_LOCATION=byoungphysicaltherapy")

print("\n" + "=" * 60)
