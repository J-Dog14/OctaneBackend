import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

UAIS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / 'python'))

from python.common import athlete_manager as am
from python.common.identity_matching import same_name_reordered, review_similarity
from python.common.duplicate_detector import find_similar_athletes_for_uuids
from python.trackman.load_trackman_pull import Resolver
from python.scripts.audit_athlete_identity import audit_pairs, audit_trackman_links


def connection(rows):
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    cur.fetchall.return_value = rows
    return conn, cur


class IdentityMatchingTests(unittest.TestCase):
    def test_calvin_raw_xml_name_resolves_to_original_profile(self):
        from python.common.athlete_cleanup import clean_athlete_name_for_processing
        _, normalized = clean_athlete_name_for_processing('Calvin, Madenspacher')
        self.assertEqual(normalized, 'MADENSPACHER CALVIN')
        self.assertLess(am._name_similarity(normalized, 'CALVIN MADENSPACHER'), .8)
        conn, cur = connection([dict(athlete_uuid='original', name='Calvin Madenspacher')])
        with patch.object(am, 'get_athlete_from_warehouse', return_value=None):
            result = am.find_existing_athlete_by_name_or_email(conn, normalized, date_of_birth='2011-05-27')
        self.assertEqual(result['athlete_uuid'], 'original')
        self.assertEqual(cur.execute.call_args.args[1], ('CALVIN MADENSPACHER', '2011-05-27'))

    def test_missing_dob_blocks_creation_of_reordered_name(self):
        conn, cur = connection([dict(athlete_uuid='original', name='Levi Mills', normalized_name='LEVI MILLS')])
        with patch.object(am, 'get_athlete_from_warehouse', return_value=None):
            with self.assertRaisesRegex(ValueError, 'IDENTITY_REVIEW'):
                am.create_athlete_in_warehouse(name='Mills Levi', normalized_name='MILLS LEVI', conn=conn)
        self.assertFalse(any('INSERT INTO' in c.args[0] for c in cur.execute.call_args_list))

    def test_unrelated_names_do_not_block_creation_guard(self):
        conn, _ = connection([dict(athlete_uuid='other', name='Liam Bailey', normalized_name='LIAM BAILEY')])
        am.guard_reordered_identity(conn, 'LEVI BAILEY')

    def test_multicomponent_reordered_name_goes_to_review(self):
        self.assertTrue(same_name_reordered('ROMAN MAGANDA AGUILAR', 'MAGANDA-AGUILAR ROMAN'))

    def test_short_last_names_are_preserved(self):
        self.assertTrue(same_name_reordered('JOHN LEE', 'LEE JOHN'))
        self.assertFalse(same_name_reordered('JOHN LEE', 'JOHN LI'))

    def test_post_import_check_catches_calvin_even_below_old_threshold(self):
        a = dict(athlete_uuid='new', name='Madenspacher Calvin', normalized_name='MADENSPACHER CALVIN')
        b = dict(athlete_uuid='old', name='Calvin Madenspacher', normalized_name='CALVIN MADENSPACHER')
        conn, cur = connection([])
        cur.fetchall.side_effect = [[a], [a, b]]
        pairs = find_similar_athletes_for_uuids(conn, ['new'], min_similarity=.9)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0][2], 1.)

    def test_trackman_holds_reversed_name_without_dob(self):
        resolver = Resolver.__new__(Resolver)
        resolver._athletes = [dict(athlete_uuid='existing', name='Levi Mills', normalized_name='LEVI MILLS', dob=None)]
        resolver.am = am
        note = resolver.near_miss('MILLS LEVI', None)
        self.assertIn('HELD:', note)
        self.assertIn('existing', note)

    def test_review_score_does_not_change_automatic_fuzzy_score(self):
        self.assertEqual(review_similarity('MADENSPACHER CALVIN', 'CALVIN MADENSPACHER'), 1.)
        self.assertLess(am._name_similarity('MADENSPACHER CALVIN', 'CALVIN MADENSPACHER'), .8)

    def test_audit_flags_reordered_name_with_missing_dob(self):
        athletes = [dict(athlete_uuid='a', name='Levi Mills', date_of_birth='2010-09-08'),
                    dict(athlete_uuid='b', name='Mills Levi')]
        findings = audit_pairs(athletes, {'a'})
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]['classification'], 'needs_review')
        self.assertTrue(findings[0]['trackman_involved'])

    def test_same_birthday_siblings_are_not_strong_duplicates(self):
        athletes = [dict(athlete_uuid='a', name='Liam Bailey', date_of_birth='2014-08-21'),
                    dict(athlete_uuid='b', name='Levi Bailey', date_of_birth='2014-08-21')]
        findings = audit_pairs(athletes, {'a', 'b'})
        self.assertEqual(findings[0]['classification'], 'needs_review')

    def test_audit_detects_trackman_alias_split_between_profiles(self):
        athletes = [dict(athlete_uuid='a', name='One'), dict(athlete_uuid='b', name='Two')]
        players = [dict(player_id='111', athlete_uuid='a', foreign_ids=['TMBB-222'])]
        links = [dict(source_player_id='222', athlete_uuid='b')]
        result = audit_trackman_links(athletes, [], players, links, [])
        self.assertEqual(result['id_disagreements'][0]['athlete_uuids'], ['a', 'b'])

    def test_audit_detects_orphaned_pitch_link(self):
        result = audit_trackman_links([], [], [], [], [dict(tm_player_id='1', athlete_uuid='gone')])
        self.assertEqual(result['orphaned_links'][0]['athlete_uuid'], 'gone')


if __name__ == '__main__':
    unittest.main()
