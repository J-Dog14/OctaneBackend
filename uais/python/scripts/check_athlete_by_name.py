#!/usr/bin/env python3
"""Quick script to check for an athlete by name."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from python.common.athlete_manager import get_warehouse_connection
from psycopg2.extras import RealDictCursor

conn = get_warehouse_connection()
cur = conn.cursor(cursor_factory=RealDictCursor)

# Check for Bobby Wahl
cur.execute("""
    SELECT athlete_uuid, name, source_athlete_id, source_system, normalized_name
    FROM analytics.d_athletes 
    WHERE name ILIKE '%wahl%' OR name ILIKE '%bobby%'
""")
rows = cur.fetchall()

print(f"Found {len(rows)} athletes matching 'wahl' or 'bobby':")
for r in rows:
    print(f"  {r['name']} - UUID: {r['athlete_uuid']}, source_id: {r['source_athlete_id']}, system: {r['source_system']}")

# Check for BW source_id
cur.execute("""
    SELECT athlete_uuid, name, normalized_name, source_athlete_id, source_system
    FROM analytics.d_athletes 
    WHERE source_athlete_id = 'BW'
""")
rows = cur.fetchall()

print(f"\nFound {len(rows)} athletes with source_athlete_id='BW':")
for r in rows:
    print(f"  {r['name']} - UUID: {r['athlete_uuid']}, normalized: {r['normalized_name']}, system: {r['source_system']}")

# Check Bobby Wahl's normalized name
cur.execute("""
    SELECT athlete_uuid, name, normalized_name, source_athlete_id
    FROM analytics.d_athletes 
    WHERE name ILIKE '%wahl%'
""")
rows = cur.fetchall()

print(f"\nBobby Wahl details:")
for r in rows:
    words = r['normalized_name'].split()
    initials = ''.join([w[0] for w in words if w])
    print(f"  Name: {r['name']}")
    print(f"  Normalized: {r['normalized_name']}")
    print(f"  Initials from normalized: {initials}")
    print(f"  Source ID: {r['source_athlete_id']}")

conn.close()

