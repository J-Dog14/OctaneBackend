"""Consolidate the two confirmed Calvin profiles with a snapshot and count checks."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'uais'))
from python.common.athlete_manager import get_warehouse_connection

SOURCE = 'c63016c5-93d1-4112-9c9f-56665bd47050'
TARGET = 'fbd5540e-0e5b-45be-b5b2-16ad2365ec60'
ap = argparse.ArgumentParser()
ap.add_argument('--apply', action='store_true')
args = ap.parse_args()
conn = get_warehouse_connection()
try:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT * FROM analytics.d_athletes WHERE athlete_uuid IN (%s,%s) FOR UPDATE', (SOURCE, TARGET))
        athletes = {r['athlete_uuid']: dict(r) for r in cur.fetchall()}
        if SOURCE not in athletes:
            assert TARGET in athletes
            print('Already consolidated.')
            sys.exit(0)
        source, target = athletes[SOURCE], athletes[TARGET]
        assert source['date_of_birth'] == target['date_of_birth'] and source['date_of_birth'] is not None
        assert source['name'] == 'Madenspacher Calvin' and target['name'] == 'Calvin Madenspacher'
        assert not source['email'] and target['email']
        assert not source['app_db_uuid']
        cur.execute('''SELECT c.table_schema, c.table_name FROM information_schema.columns c
            JOIN information_schema.tables t USING (table_schema, table_name)
            WHERE c.column_name='athlete_uuid' AND t.table_type='BASE TABLE'
            AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            AND NOT (c.table_schema='analytics' AND c.table_name='d_athletes')''')
        tables = [(r['table_schema'], r['table_name']) for r in cur.fetchall()]
        snapshot = dict(athletes=athletes, tables={})
        counts = {}
        for schema, table in tables:
            ident = sql.Identifier(schema, table)
            cur.execute(sql.SQL('SELECT * FROM {} WHERE athlete_uuid=%s').format(ident), (SOURCE,))
            rows = [dict(r) for r in cur.fetchall()]
            cur.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE athlete_uuid=%s').format(ident), (TARGET,))
            counts[(schema, table)] = (len(rows), cur.fetchone()['n'])
            if rows:
                snapshot['tables'][schema + '.' + table] = rows
                print(f'{schema}.{table}: move {len(rows)} rows')
        if not args.apply:
            print('Dry run; no changes.')
            conn.rollback()
            sys.exit(0)
        backup = ROOT / 'tmp' / ('calvin_profile_backup_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
        backup.write_text(json.dumps(snapshot, default=str), encoding='utf-8')
        print('Snapshot:', backup)
        for (schema, table), (n_source, n_target) in counts.items():
            if n_source:
                cur.execute(sql.SQL('UPDATE {} SET athlete_uuid=%s WHERE athlete_uuid=%s').format(sql.Identifier(schema, table)), (TARGET, SOURCE))
                assert cur.rowcount == n_source, (schema, table, cur.rowcount, n_source)
        cur.execute('DELETE FROM analytics.d_athletes WHERE athlete_uuid=%s', (SOURCE,))
        assert cur.rowcount == 1
        for (schema, table), (n_source, n_target) in counts.items():
            cur.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE athlete_uuid=%s').format(sql.Identifier(schema, table)), (TARGET,))
            assert cur.fetchone()['n'] == n_source + n_target, (schema, table)
        cur.execute('SELECT update_athlete_data_flags()')
        cur.execute('SELECT email, has_hitting_data, has_athletic_screen_data, athletic_screen_session_count FROM analytics.d_athletes WHERE athlete_uuid=%s', (TARGET,))
        result = dict(cur.fetchone())
        assert result['has_hitting_data'] and result['has_athletic_screen_data']
        assert result['athletic_screen_session_count'] == 1
    conn.commit()
    print('Consolidated and verified:', json.dumps(result, default=str))
except BaseException:
    conn.rollback()
    raise
finally:
    conn.close()
