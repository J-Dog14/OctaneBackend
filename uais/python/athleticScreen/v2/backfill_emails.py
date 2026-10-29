"""Repair missing profile emails using already-linked v2 session.xml files.

Dry run by default; --apply fills blanks only. No name matching or merges.
"""
import argparse
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parents[2]))

from dotenv import load_dotenv
from python.common.athlete_manager import get_warehouse_connection
from v2 import schema
from v2.profile_emails import fill_missing_emails
from v2.session_meta import parse_session_xml


def main():
    load_dotenv(HERE.parents[2] / '.env')
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--data', default=os.environ.get('ATHLETIC_SCREEN_DATA_DIR', r'D:\Athletic Screen 2.0\Data'))
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    root = Path(args.data).resolve(strict=True)
    conn = get_warehouse_connection()
    try:
        if not args.apply:
            conn.set_session(readonly=True)
        parts = [f'''SELECT DISTINCT s.athlete_uuid, s.source_athlete_id, s.session_folder,
                           NULLIF(TRIM(a.email), '') IS NULL AS missing_email
                    FROM {schema.TABLE.format(mv)} s JOIN analytics.d_athletes a USING (athlete_uuid)
                    '''
                 for mv in schema.MOVEMENTS]
        with conn.cursor() as cur:
            cur.execute(' UNION '.join(parts))
            links = cur.fetchall()
        owners = {}
        missing = set()
        for uuid, folder, session, missing_email in links:
            owners.setdefault((folder, session), set()).add(uuid)
            if missing_email:
                missing.add(uuid)
        records = []
        skipped = 0
        for (folder, session), uuids in owners.items():
            if len(uuids) != 1 or not folder or not session:
                skipped += 1
                continue
            if next(iter(uuids)) not in missing:
                continue
            xml = (root / folder / session / 'session.xml').resolve()
            if not xml.is_relative_to(root) or not xml.is_file():
                skipped += 1
                continue
            try:
                email = parse_session_xml(xml)['email']
            except (ValueError, OSError, ET.ParseError) as exc:
                print(f'Skipping {folder}/{session}: {type(exc).__name__}')
                skipped += 1
                continue
            records.append(dict(athlete_uuid=next(iter(uuids)), email=email))
        filled, review = fill_missing_emails(conn, records, dry_run=not args.apply)
        if args.apply:
            conn.commit()
        print(f"{'Filled' if args.apply else 'Would fill'} {len(filled)} missing profile email(s); "
              f'{len(review)} need review; {skipped} source session(s) skipped.')
        for uuid in filled:
            print(f'  {uuid}')
        for uuid in review:
            print(f'  EMAIL_REVIEW: {uuid}')
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
