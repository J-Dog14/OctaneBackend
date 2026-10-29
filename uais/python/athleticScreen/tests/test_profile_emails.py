import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PYTHON = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON))
sys.path.insert(0, str(PYTHON.parent))

from athleticScreen.v2.profile_emails import fill_missing_emails
from athleticScreen.v2.session_meta import parse_session_xml
from common import athlete_manager as am
import pandas as pd


class ProfileEmailTests(unittest.TestCase):
    def connection(self, results):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect = results
        cur.rowcount = 1
        return conn, cur

    def test_qtm_email_spellings_and_encodings(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'session.xml'
            for encoding in ('utf-8', 'utf-16'):
                for tag in ('email', 'Email', 'E-mail', 'email_address', 'EmailAddress', 'EMAIL'):
                    with self.subTest(encoding=encoding, tag=tag):
                        path.write_text(f'<Subject><Fields><{tag}> Athlete@Example.com </{tag}></Fields></Subject>', encoding=encoding)
                        self.assertEqual(parse_session_xml(path)['email'], 'athlete@example.com')

    def test_fill_missing_for_existing_trackman_profile(self):
        conn, cur = self.connection([(None,), None])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='trackman-uuid', email=' Athlete@Example.com ')]), (['trackman-uuid'], []))
        self.assertEqual(cur.execute.call_args.args[1], ('athlete@example.com', 'trackman-uuid'))
        conn.commit.assert_not_called()

    def test_email_from_later_session_is_used(self):
        conn, _ = self.connection([('',), None])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email=None), dict(athlete_uuid='u', email='a@example.com')]), (['u'], []))

    def test_existing_email_is_preserved(self):
        conn, cur = self.connection([('existing@example.com',)])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email='new@example.com')]), ([], []))
        self.assertEqual(cur.execute.call_count, 1)

    def test_conflicting_sessions_need_review(self):
        conn, cur = self.connection([(None,)])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email=e) for e in ('a@example.com', 'b@example.com')]), ([], ['u']))
        self.assertEqual(cur.execute.call_count, 1)

    def test_email_on_another_athlete_needs_review(self):
        conn, cur = self.connection([(None,), (1,)])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email='a@example.com')]), ([], ['u']))
        self.assertEqual(cur.execute.call_count, 2)

    def test_email_shared_by_two_candidates_needs_review_for_both(self):
        conn, cur = self.connection([(None,), (None,)])
        records = [dict(athlete_uuid=u, email='shared@example.com') for u in ('a', 'b')]
        self.assertEqual(fill_missing_emails(conn, records), ([], ['a', 'b']))
        self.assertEqual(cur.execute.call_count, 2)

    def test_dry_run_does_not_update(self):
        conn, cur = self.connection([('   ',), None])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email='a@example.com')], dry_run=True), (['u'], []))
        self.assertEqual(cur.execute.call_count, 2)

    def test_invalid_email_is_ignored(self):
        conn, cur = self.connection([])
        self.assertEqual(fill_missing_emails(conn, [dict(athlete_uuid='u', email='Gmail:')]), ([], []))
        cur.execute.assert_not_called()

    def test_warehouse_update_accepts_blank_email(self):
        conn, cur = self.connection([])
        am.update_athlete_in_warehouse('u', email=' A@Example.com ', conn=conn)
        self.assertIn("NULLIF(TRIM(email), '')", cur.execute.call_args.args[0])
        self.assertEqual(cur.execute.call_args.args[1], ['a@example.com', 'u'])

    @patch.object(am, 'get_athlete_from_warehouse', return_value=None)
    def test_reversed_name_requires_matching_dob(self, _):
        conn, cur = self.connection([])
        cur.fetchall.return_value = [dict(athlete_uuid='canonical')]
        result = am.find_existing_athlete_by_name_or_email(conn, 'MADENSPACHER CALVIN', date_of_birth='2011-05-27')
        self.assertEqual(result['athlete_uuid'], 'canonical')
        self.assertEqual(cur.execute.call_args.args[1], ('CALVIN MADENSPACHER', '2011-05-27'))

    @patch.object(am, 'get_athlete_from_warehouse', return_value=None)
    def test_reversed_name_without_dob_does_not_match(self, _):
        conn, cur = self.connection([])
        cur.fetchall.return_value = [dict(athlete_uuid='canonical', normalized_name='CALVIN MADENSPACHER')]
        self.assertIsNone(am.find_existing_athlete_by_name_or_email(conn, 'MADENSPACHER CALVIN'))

    @patch.object(am, 'get_athlete_from_warehouse', return_value=None)
    def test_ambiguous_reversed_names_stop_creation(self, _):
        conn, cur = self.connection([])
        cur.fetchall.return_value = [dict(athlete_uuid='a'), dict(athlete_uuid='b')]
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            am.find_existing_athlete_by_name_or_email(conn, 'MADENSPACHER CALVIN', date_of_birth='2011-05-27')

    def test_existing_session_refreshes_email_without_reprocessing_trials(self):
        # This metadata-only path must not read c3d; the optional processor is
        # not needed to exercise the orchestration around already-loaded rows.
        with patch.dict(sys.modules, {'ezc3d': MagicMock()}):
            from athleticScreen.v2 import ingest
        for dry_run in (False, True):
            with self.subTest(dry_run=dry_run), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                folder = root / 'Athlete Example_AE' / '2026-10-26_'
                folder.mkdir(parents=True)
                history = pd.DataFrame([dict(source_athlete_id=folder.parent.name,
                    session_folder=folder.name, athlete_uuid='existing', session_date='2026-10-26')])
                conn = MagicMock()
                argv = ['ingest.py', '--session', str(root)] + (['--dry-run'] if dry_run else [])
                with patch.object(sys, 'argv', argv), patch.dict('os.environ', {'ATHLETE_UUID': ''}), \
                     patch.object(am, 'get_warehouse_connection', return_value=conn), \
                     patch.object(ingest, 'v2_tables_exist', return_value=True), \
                     patch.object(ingest, 'ingested_sessions', return_value=history), \
                     patch.object(ingest, 'find_session_folders', return_value=[folder]), \
                     patch.object(ingest, 'q', return_value=pd.DataFrame({'athlete_uuid': ['existing']})), \
                     patch.object(ingest, 'parse_session_xml', return_value={'email': 'a@example.com'}), \
                     patch.object(ingest, 'fill_missing_emails', return_value=(['existing'], [])) as fill, \
                     patch.object(ingest, 'process_session') as process:
                    self.assertEqual(ingest.main(), 0)
                    fill.assert_called_once_with(conn, [dict(athlete_uuid='existing', email='a@example.com')], dry_run=dry_run)
                    process.assert_not_called()
                    conn.close.assert_called_once()
                    if dry_run:
                        conn.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
