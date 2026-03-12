"""
Check Vercel Database Connection
Tests if you can actually connect to the Vercel database

Usage:
    python python/scripts/check_vercel_connection.py
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import psycopg2
except ImportError:
    print("[ERROR] psycopg2 not installed. Install with: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    project_root = Path(__file__).parent.parent.parent
    env_file = project_root / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    print("[WARNING] python-dotenv not installed. Using system environment variables only.")


def test_connection(conn_str: str, name: str) -> bool:
    """Test database connection"""
    try:
        parsed = urlparse(conn_str)
        
        print(f"\nTesting {name}...")
        print(f"  Host: {parsed.hostname}")
        print(f"  Port: {parsed.port or 5432}")
        print(f"  Database: {parsed.path.lstrip('/')}")
        
        # Handle Prisma Accelerate format
        if conn_str.startswith("prisma+postgres://"):
            print(f"  [INFO] This is Prisma Accelerate format - may not work with standard psycopg2")
            print(f"  [INFO] Try using POSTGRES_URL instead for direct connections")
            return False
        
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path.lstrip('/').split('?')[0],  # Remove query params
            user=parsed.username,
            password=parsed.password,
            sslmode='require' if 'sslmode=require' in conn_str else 'prefer',
            connect_timeout=10
        )
        
        # Test query
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            version = cur.fetchone()[0]
            print(f"  [OK] Connected successfully!")
            print(f"  PostgreSQL version: {version[:50]}...")
        
        conn.close()
        return True
        
    except psycopg2.OperationalError as e:
        print(f"  [ERROR] Connection failed: {e}")
        return False
    except Exception as e:
        print(f"  [ERROR] Unexpected error: {e}")
        return False


def main():
    print("=" * 70)
    print("Vercel Database Connection Test")
    print("=" * 70)
    print()
    
    # Check for Vercel variables
    postgres_url = os.environ.get('POSTGRES_URL')
    prisma_url = os.environ.get('PRISMA_DATABASE_URL')
    
    if not postgres_url and not prisma_url:
        print("[ERROR] No Vercel database connection strings found!")
        print()
        print("This means either:")
        print("  1. The database wasn't created in Vercel")
        print("  2. The connection strings weren't copied to .env")
        print("  3. The database is in a different project/team")
        print()
        print("To create the database:")
        print("  1. Go to Vercel Dashboard → Your Project")
        print("  2. Click 'Storage' tab")
        print("  3. Click 'Create Database' → Select 'Prisma Postgres'")
        print("  4. Copy the connection strings to your .env file")
        sys.exit(1)
    
    print("[INFO] Vercel connection strings found in environment")
    print()
    
    # Test POSTGRES_URL (preferred)
    if postgres_url:
        success = test_connection(postgres_url, "POSTGRES_URL")
        if success:
            print("\n[OK] Vercel database is accessible!")
            print("  You can use this database if you want")
            return
    else:
        print("[WARNING] POSTGRES_URL not found")
    
    # Test PRISMA_DATABASE_URL (if POSTGRES_URL failed)
    if prisma_url:
        print("\n[INFO] Trying PRISMA_DATABASE_URL...")
        print("  Note: This uses Prisma Accelerate and may not work with standard PostgreSQL clients")
        test_connection(prisma_url, "PRISMA_DATABASE_URL")
    
    print("\n" + "=" * 70)
    print("Summary:")
    print("  - If connection failed, the database might not exist or be accessible")
    print("  - Check Vercel Dashboard → Storage to see if database is listed")
    print("  - You might not need this database anyway (see docs/vercel-database-location-guide.md)")
    print()


if __name__ == "__main__":
    main()

