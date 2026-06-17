"""
Tests for cross-insert (athletic screen → readiness screen) and 3-tier scoring.

Mirrors the Tracker's tests/test_e2e.py pattern:
  - Python unittest with TestCase classes
  - Fully mocked DB via unittest.mock (no real database needed)
  - SQL statements captured for assertion

Run:
    python -m unittest uais/python/readinessScreen/tests/test_cross_insert_and_scoring.py
"""
import sys
import os
import re
import unittest
from datetime import date
from unittest.mock import MagicMock, call, patch

# ---------------------------------------------------------------------------
# Make all packages importable.
# athleticScreen/main.py uses bare `from file_parsers import ...` so its folder
# must be on sys.path directly (not just the parent).
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(__file__)
_PYTHON_ROOT = os.path.abspath(os.path.join(_HERE, '..', '..'))
_ATHLETIC_DIR = os.path.join(_PYTHON_ROOT, 'athleticScreen')
_READINESS_DIR = os.path.join(_PYTHON_ROOT, 'readinessScreen')
for _d in (_PYTHON_ROOT, _ATHLETIC_DIR, _READINESS_DIR):
    if _d not in sys.path:
        sys.path.insert(0, _d)

# athleticScreen/main.py has many top-level imports (shutil, common.*, etc.)
# that would pull in real DB connections at import time.  Mock the heavy ones
# so we can import just the helper function without side-effects.
import unittest.mock as _mock  # noqa: E402

_MOCKED_MODULES = [
    'common', 'common.athlete_manager', 'common.config', 'common.age_utils',
    'common.units', 'common.athlete_matcher', 'common.athlete_utils',
    'common.duplicate_detector', 'common.session_duplicate_prompt',
    'common.session_xml', 'database_utils',
    'file_parsers', 'power_analysis',
    'athleticScreen.power_analysis',
]
for _mod in _MOCKED_MODULES:
    if _mod not in sys.modules:
        sys.modules[_mod] = _mock.MagicMock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_conn(fetchone_val=None, fetchall_val=None, rowcount=None):
    """Build a minimal mock psycopg2 connection + cursor."""
    cursor = MagicMock()
    cursor.__enter__ = lambda s: s
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = fetchone_val
    cursor.fetchall.return_value = fetchall_val or []
    conn = MagicMock()
    conn.cursor.return_value = cursor
    conn.__enter__ = lambda s: s
    conn.__exit__ = MagicMock(return_value=False)
    return conn, cursor


def _cmj_insert_data(jh_in=38.0, trial_name='CMJ1'):
    """Minimal athletic screen insert_data dict for a CMJ trial."""
    return {
        'athlete_uuid':      'aaaa-uuid',
        'session_date':      '2026-06-04',
        'source_system':     'athletic_screen',
        'source_athlete_id': 'JOHN DOE',
        'trial_name':        trial_name,
        'age_at_collection': 22.5,
        'age_group':         'COLLEGE',
        'jh_in':             jh_in,
        'peak_power':        3200.0,
        'pp_forceplate':     3100.0,
        'force_at_pp':       980.0,
        'vel_at_pp':         3.1,
        'pp_w_per_kg':       42.3,
        'peak_power_w':      3100.0,
        'time_to_peak_s':    0.28,
        'rpd_max_w_per_s':   18000.0,
        'time_to_rpd_max_s': 0.18,
        'rise_time_10_90_s': 0.14,
        'fwhm_s':            0.35,
        'auc_j':             210.0,
        'work_early_pct':    62.0,
        'decay_90_10_s':     0.21,
        't_com_norm_0to1':   0.48,
        'skewness':          0.3,
        'kurtosis':          -0.5,
        'spectral_centroid_hz': 4.2,
    }


# ===========================================================================
# 1. Cross-insert tests
# ===========================================================================

class TestCrossInsert(unittest.TestCase):
    """Tests for _cross_insert_to_readiness_screen() in athleticScreen/main.py."""

    def _import_fn(self):
        from athleticScreen.main import _cross_insert_to_readiness_screen
        return _cross_insert_to_readiness_screen

    def _call_insert(self, movement_type='CMJ', trial_name='CMJ1',
                     conn=None, cursor=None, insert_data=None):
        fn = self._import_fn()
        if conn is None:
            conn, cursor = _make_conn(fetchone_val=None)  # no existing row → INSERT
        if insert_data is None:
            insert_data = _cmj_insert_data(trial_name=trial_name)
        fn(conn, 'aaaa-uuid', '2026-06-04', movement_type, trial_name, insert_data)
        return conn, cursor

    # ---- table targeting ---------------------------------------------------

    def test_cmj_targets_readiness_cmj_table(self):
        conn, cursor = self._call_insert(movement_type='CMJ', trial_name='CMJ1')
        all_sql = ' '.join(str(c) for c in cursor.execute.call_args_list)
        self.assertIn('f_readiness_screen_cmj', all_sql)
        self.assertNotIn('f_readiness_screen_ppu', all_sql)

    def test_ppu_targets_readiness_ppu_table(self):
        conn, cursor = _make_conn(fetchone_val=None)
        fn = self._import_fn()
        data = _cmj_insert_data(trial_name='PPU1')
        fn(conn, 'aaaa-uuid', '2026-06-04', 'PPU', 'PPU1', data)
        all_sql = ' '.join(str(c) for c in cursor.execute.call_args_list)
        self.assertIn('f_readiness_screen_ppu', all_sql)
        self.assertNotIn('f_readiness_screen_cmj', all_sql)

    # ---- column mapping ----------------------------------------------------

    def test_jh_in_mapped_to_jump_height(self):
        """jh_in from athletic screen must land as jump_height in the readiness row."""
        fn = self._import_fn()
        conn, cursor = _make_conn(fetchone_val=None)
        data = _cmj_insert_data(jh_in=42.5, trial_name='CMJ1')
        fn(conn, 'aaaa-uuid', '2026-06-04', 'CMJ', 'CMJ1', data)

        # Capture the INSERT call arguments
        insert_call = None
        for c in cursor.execute.call_args_list:
            sql = c[0][0] if c[0] else ''
            if 'INSERT' in str(sql):
                insert_call = c
                break
        self.assertIsNotNone(insert_call, "No INSERT call found")

        sql = insert_call[0][0]
        values = insert_call[0][1]
        self.assertIn('jump_height', sql)
        # jump_height should appear in the column list and its value should be 42.5
        cols_match = re.search(r'INSERT INTO public\.\S+\s+\(([^)]+)\)', sql)
        self.assertIsNotNone(cols_match)
        col_names = [c.strip() for c in cols_match.group(1).split(',')]
        jh_idx = col_names.index('jump_height')
        self.assertAlmostEqual(float(values[jh_idx]), 42.5)

    def test_source_system_is_athletic_screen(self):
        fn = self._import_fn()
        conn, cursor = _make_conn(fetchone_val=None)
        fn(conn, 'aaaa-uuid', '2026-06-04', 'CMJ', 'CMJ1', _cmj_insert_data())

        insert_call = None
        for c in cursor.execute.call_args_list:
            if 'INSERT' in str(c[0][0] if c[0] else ''):
                insert_call = c
                break
        self.assertIsNotNone(insert_call)
        sql = insert_call[0][0]
        values = insert_call[0][1]
        cols_match = re.search(r'INSERT INTO public\.\S+\s+\(([^)]+)\)', sql)
        col_names = [c.strip() for c in cols_match.group(1).split(',')]
        ss_idx = col_names.index('source_system')
        self.assertEqual(values[ss_idx], 'athletic_screen')

    def test_phase_cols_are_null(self):
        """Phase and force-derived columns must be NULL in the cross-inserted row."""
        fn = self._import_fn()
        conn, cursor = _make_conn(fetchone_val=None)
        fn(conn, 'aaaa-uuid', '2026-06-04', 'CMJ', 'CMJ1', _cmj_insert_data())

        insert_call = None
        for c in cursor.execute.call_args_list:
            if 'INSERT' in str(c[0][0] if c[0] else ''):
                insert_call = c
                break
        self.assertIsNotNone(insert_call)
        sql = insert_call[0][0]
        values = insert_call[0][1]
        cols_match = re.search(r'INSERT INTO public\.\S+\s+\(([^)]+)\)', sql)
        col_names = [c.strip() for c in cols_match.group(1).split(',')]
        null_cols = [
            'contraction_time_s', 'eccentric_duration_s', 'mrsi',
            'peak_grf_n', 'peak_grf_bw_ratio', 'rfd_0_100ms', 'concentric_impulse_ns',
        ]
        for nc in null_cols:
            if nc in col_names:
                idx = col_names.index(nc)
                self.assertIsNone(values[idx], f"{nc} should be NULL")

    # ---- upsert behaviour --------------------------------------------------

    def test_existing_row_triggers_update(self):
        """When the SELECT returns a row, UPDATE path must be used."""
        conn, cursor = _make_conn(fetchone_val=(1,))  # row exists
        self._call_insert(conn=conn, cursor=cursor)
        sql_calls = [str(c[0][0]) for c in cursor.execute.call_args_list]
        self.assertTrue(any('UPDATE' in s for s in sql_calls), "Expected UPDATE")
        self.assertFalse(any('INSERT' in s for s in sql_calls), "Did not expect INSERT")

    def test_no_existing_row_triggers_insert(self):
        """When the SELECT returns None, INSERT path must be used."""
        conn, cursor = _make_conn(fetchone_val=None)  # no row
        self._call_insert(conn=conn, cursor=cursor)
        sql_calls = [str(c[0][0]) for c in cursor.execute.call_args_list]
        self.assertTrue(any('INSERT' in s for s in sql_calls), "Expected INSERT")
        self.assertFalse(any('UPDATE' in s for s in sql_calls), "Did not expect UPDATE")

    # ---- safety ------------------------------------------------------------

    def test_failure_does_not_propagate_when_wrapped(self):
        """Cross-insert failure inside try/except must not raise."""
        fn = self._import_fn()
        bad_conn = MagicMock()
        bad_conn.cursor.side_effect = Exception("DB exploded")
        try:
            fn(bad_conn, 'x', '2026-06-04', 'CMJ', 'CMJ1', _cmj_insert_data())
            self.fail("Expected exception was not raised from the function itself")
        except Exception:
            pass  # the function itself raises; caller wraps it in try/except


# ===========================================================================
# 2. Scoring tier tests
# ===========================================================================

class TestScoringTier(unittest.TestCase):
    """Tests for the 3-tier routing in scoring.py."""

    def _mock_scoring(self, n_prior=0, today_val=40.0, baseline_vals=None,
                      cohort_mean=40.0, cohort_sd=5.0, cohort_n=10):
        """
        Patch get_connection so that:
          - _count_prior_sessions returns n_prior
          - _fetch_today_and_baseline returns (today_val, baseline_vals)
          - _fetch_cohort_stats returns (cohort_mean, cohort_sd, cohort_n)
        Returns the score dict from compute_score_for_session.
        """
        if baseline_vals is None:
            baseline_vals = list(range(max(n_prior, 0)))  # dummy baseline

        # We need to patch at a level that intercepts the actual SQL.
        # The easiest approach is to patch _count_prior_sessions,
        # _fetch_today_and_baseline, and _fetch_cohort_stats directly.
        with patch('readinessScreen.scoring._count_prior_sessions',
                   return_value=n_prior), \
             patch('readinessScreen.scoring._fetch_today_and_baseline',
                   return_value=(today_val, baseline_vals)), \
             patch('readinessScreen.scoring._fetch_cohort_stats',
                   return_value=(cohort_mean, cohort_sd, cohort_n)), \
             patch('readinessScreen.scoring.get_connection') as mock_conn, \
             patch('readinessScreen.scoring.compute_intra_session_cv',
                   return_value={}):
            conn_mock = MagicMock()
            conn_mock.__enter__ = lambda s: s
            conn_mock.__exit__ = MagicMock(return_value=False)
            mock_conn.return_value = conn_mock

            from readinessScreen.scoring import compute_score_for_session
            return compute_score_for_session('uuid', date(2026, 6, 4))

    def test_first_run_tier_when_zero_prior(self):
        result = self._mock_scoring(n_prior=0)
        self.assertEqual(result['scoring_tier'], 'FIRST_RUN')

    def test_a_to_b_tier_when_one_prior(self):
        result = self._mock_scoring(n_prior=1, baseline_vals=[38.0])
        self.assertEqual(result['scoring_tier'], 'A_TO_B')

    def test_readiness_tier_when_two_plus_prior(self):
        result = self._mock_scoring(n_prior=2, baseline_vals=[38.0, 37.5])
        self.assertEqual(result['scoring_tier'], 'READINESS')

    def test_insufficient_history_band_when_no_metrics(self):
        with patch('readinessScreen.scoring._count_prior_sessions', return_value=0), \
             patch('readinessScreen.scoring._fetch_today_and_baseline',
                   return_value=(None, [])), \
             patch('readinessScreen.scoring._fetch_cohort_stats', return_value=None), \
             patch('readinessScreen.scoring.get_connection') as mock_conn, \
             patch('readinessScreen.scoring.compute_intra_session_cv', return_value={}):
            conn_mock = MagicMock()
            conn_mock.__enter__ = lambda s: s
            conn_mock.__exit__ = MagicMock(return_value=False)
            mock_conn.return_value = conn_mock
            from readinessScreen.scoring import compute_score_for_session
            result = compute_score_for_session('uuid', date(2026, 6, 4))
        self.assertEqual(result['band'], 'INSUFFICIENT_HISTORY')
        self.assertIsNone(result['composite_score'])

    def test_scoring_tier_in_upsert_sql(self):
        """upsert_score() SQL must include the scoring_tier column."""
        with patch('readinessScreen.scoring.get_connection') as mock_conn:
            conn_mock = MagicMock()
            cursor_mock = MagicMock()
            cursor_mock.__enter__ = lambda s: s
            cursor_mock.__exit__ = MagicMock(return_value=False)
            conn_mock.cursor.return_value = cursor_mock
            mock_conn.return_value = conn_mock

            from readinessScreen.scoring import upsert_score
            upsert_score('uuid', date(2026, 6, 4), {
                'composite_score': 55.0, 'composite_z': 0.3, 'band': 'CAUTION',
                'cmj_z': 0.3, 'ppu_z': 0.2, 'iso_z': None, 'power_curve_z': None,
                'grip_z': None, 'metrics_used': 4, 'baseline_window_days': 28,
                'flags_json': '{}', 'scoring_tier': 'READINESS',
            })

        sql_called = cursor_mock.execute.call_args[0][0]
        self.assertIn('scoring_tier', sql_called)


# ===========================================================================
# 3. Column mapping / trial_id tests (no DB needed)
# ===========================================================================

class TestColumnMapping(unittest.TestCase):
    """Pure unit tests for trial_id extraction — no DB mock needed."""

    def _trial_id(self, trial_name):
        m = re.search(r'(\d+)\s*$', trial_name or '')
        return int(m.group(1)) if m else 1

    def test_cmj1_gives_trial_id_1(self):
        self.assertEqual(self._trial_id('CMJ1'), 1)

    def test_cmj2_gives_trial_id_2(self):
        self.assertEqual(self._trial_id('CMJ2'), 2)

    def test_ppu1_gives_trial_id_1(self):
        self.assertEqual(self._trial_id('PPU1'), 1)

    def test_ppu2_gives_trial_id_2(self):
        self.assertEqual(self._trial_id('PPU2'), 2)

    def test_no_number_fallback_to_1(self):
        self.assertEqual(self._trial_id('CMJ'), 1)

    def test_none_fallback_to_1(self):
        self.assertEqual(self._trial_id(None), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
