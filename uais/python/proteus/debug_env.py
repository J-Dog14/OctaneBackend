"""Debug script to check .env file format and loading."""
import sys
import os
from pathlib import Path

# Setup path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

print("=" * 60)
print("Debugging .env file")
print("=" * 60)

env_path = project_root / '.env'
print(f"\n.env file path: {env_path}")
print(f"Exists: {env_path.exists()}")

if not env_path.exists():
    print("\n❌ .env file not found!")
    print(f"Create it at: {env_path}")
    sys.exit(1)

# Read the file directly
print("\n" + "=" * 60)
print("Reading .env file directly:")
print("=" * 60)
try:
    with open(env_path, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.splitlines()
        print(f"\nTotal lines: {len(lines)}")
        print("\nFile contents (showing first 100 chars of each line):")
        for i, line in enumerate(lines, 1):
            if line.strip():  # Only show non-empty lines
                # Mask password
                if 'PASSWORD' in line:
                    parts = line.split('=', 1)
                    if len(parts) == 2:
                        masked = f"{parts[0]}=***"
                    else:
                        masked = line[:50] + "..." if len(line) > 50 else line
                    print(f"  Line {i}: {masked}")
                else:
                    print(f"  Line {i}: {line[:100]}")
                
                # Check for common issues
                if ' = ' in line or '= ' in line or ' =' in line:
                    print(f"    ⚠️  WARNING: Spaces around = sign detected!")
                if line.startswith(' ') or line.startswith('\t'):
                    print(f"    ⚠️  WARNING: Line starts with whitespace!")
                if '"' in line or "'" in line:
                    print(f"    ⚠️  WARNING: Quotes detected (may cause issues)")
except Exception as e:
    print(f"\n❌ Error reading file: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Try loading with python-dotenv
print("\n" + "=" * 60)
print("Testing python-dotenv loading:")
print("=" * 60)

try:
    from dotenv import load_dotenv
    
    # Clear any existing values first
    if 'PROTEUS_EMAIL' in os.environ:
        del os.environ['PROTEUS_EMAIL']
    if 'PROTEUS_PASSWORD' in os.environ:
        del os.environ['PROTEUS_PASSWORD']
    if 'PROTEUS_LOCATION' in os.environ:
        del os.environ['PROTEUS_LOCATION']
    
    print("\nBefore loading:")
    print(f"  PROTEUS_EMAIL: {os.getenv('PROTEUS_EMAIL', 'NOT SET')}")
    print(f"  PROTEUS_PASSWORD: {'SET' if os.getenv('PROTEUS_PASSWORD') else 'NOT SET'}")
    
    # Load the file
    result = load_dotenv(env_path, override=True)
    print(f"\nload_dotenv() returned: {result}")
    
    print("\nAfter loading:")
    email = os.getenv('PROTEUS_EMAIL')
    password = os.getenv('PROTEUS_PASSWORD')
    location = os.getenv('PROTEUS_LOCATION')
    
    print(f"  PROTEUS_EMAIL: {email if email else 'NOT SET'}")
    print(f"  PROTEUS_PASSWORD: {'SET (' + str(len(password)) + ' chars)' if password else 'NOT SET'}")
    print(f"  PROTEUS_LOCATION: {location if location else 'NOT SET'}")
    
    if not email or not password:
        print("\n❌ Variables not loaded!")
        print("\nCommon issues:")
        print("  1. Spaces around = sign (should be KEY=value, not KEY = value)")
        print("  2. Quotes around values (should be KEY=value, not KEY=\"value\")")
        print("  3. Wrong line endings (should be Unix LF, not Windows CRLF)")
        print("  4. BOM (Byte Order Mark) at start of file")
        print("\nCorrect format:")
        print("  PROTEUS_EMAIL=jimmy@8ctanebaseball.com")
        print("  PROTEUS_PASSWORD=DerekCarr4")
        print("  PROTEUS_LOCATION=byoungphysicaltherapy")
    else:
        print("\n✓ Variables loaded successfully!")
        
except ImportError:
    print("\n❌ python-dotenv not installed!")
    print("Install with: pip install python-dotenv")
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
