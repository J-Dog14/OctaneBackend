"""
One-off repair: re-point orphaned fact table rows from a failed merge.

After the 2026-06-10 Cody Yarborough merge, most fact tables still have
athlete_uuid = 92139511-5812-40eb-b5d1-b66357295d2e (the deleted duplicate).
This script updates them to the canonical UUID c8df3248-f36d-4165-a97e-8708cfa8d27c.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.db import get_connection

ORPHANED_UUID = '92139511-5812-40eb-b5d1-b66357295d2e'
CANONICAL_UUID = 'c8df3248-f36d-4165-a97e-8708cfa8d27c'

TABLES = [
    'f_athletic_screen',
    'f_athletic_screen_cmj',
    'f_athletic_screen_dj',
    'f_athletic_screen_slv',
    'f_athletic_screen_nmt',
    'f_athletic_screen_ppu',
    'f_pro_sup',
    'f_readiness_screen',
    'f_readiness_screen_i',
    'f_readiness_screen_y',
    'f_readiness_screen_t',
    'f_readiness_screen_ir90',
    'f_mobility',
    'f_proteus',
    'f_kinematics_pitching',
    'f_kinematics_hitting',
    'f_arm_action',
    'f_curveball_test',
]

def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for table in TABLES:
                cur.execute('''
                    SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = %s AND column_name = 'athlete_uuid'
                ''', (table,))
                if cur.fetchone()[0] == 0:
                    continue

                cur.execute(f'''
                    UPDATE public.{table}
                    SET athlete_uuid = %s
                    WHERE athlete_uuid = %s
                ''', (CANONICAL_UUID, ORPHANED_UUID))

                if cur.rowcount > 0:
                    print(f"  Fixed {table}: {cur.rowcount} row(s)")

        conn.commit()
        print("Done.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    main()
