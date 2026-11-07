"""Blast CSV parsing + sensor attribution.

Fixture: 18 real swings from the 2026-11-06 team-portal export (sensor 111444004664, all
labelled "Bobby Wahl" because of the individual subscription), copied byte-for-byte so the
BOM and the multi-line timezone field are exercised.

Run from uais/:  python -m unittest python.blast.tests.test_blast -v
Database test (skipped unless BLAST_DATABASE_URL points at a THROWAWAY database / Neon branch):
    BLAST_DATABASE_URL=postgres://... python -m unittest python.blast.tests.test_blast -v
"""

import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

UAIS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / "python"))

from python.blast.attribution import Assignment, Swing, attribute  # noqa: E402
from python.blast.blast_csv import BlastCsvError, default_label, parse_blast_text, read_blast_csv  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "blast_export_sample.csv"
UTC = timezone.utc


def t(hhmmss: str, day: int = 4) -> datetime:
    """Eastern wall time on 2026-11-<day> as UTC (EST = UTC-5)."""
    h, m, s = (int(x) for x in hhmmss.split(":"))
    return datetime(2026, 11, day, h, m, s, tzinfo=UTC) + timedelta(hours=5)


class ParseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.warnings = read_blast_csv(FIXTURE)
        cls.by_id = {r["capture_id"]: r for r in cls.rows}

    def test_reads_every_record_despite_multiline_timezone(self):
        self.assertEqual(len(self.rows), 18)
        self.assertEqual(self.warnings, [])

    def test_timestamps_are_utc_and_local_date_is_eastern(self):
        r = self.by_id["A7727DE0-F73D-41FD-B6F8-0978323C5D4C"]   # "2026-11-03 01:15:35" = Nov 2, 8:15 PM ET
        self.assertEqual(r["swing_at"], datetime(2026, 11, 3, 1, 15, 35, tzinfo=UTC))
        self.assertEqual(r["local_date"], date(2026, 11, 2))
        self.assertEqual(r["uploaded_at"], datetime(2026, 11, 3, 1, 15, 39, tzinfo=UTC))
        first = self.by_id["CC4F0FBE-E09E-4A35-970F-DC20666CC7D1"]  # 22:58:33 UTC = 5:58 PM ET Nov 4
        self.assertEqual(first["local_date"], date(2026, 11, 4))

    def test_metrics_units_and_rounding(self):
        r = self.by_id["CC4F0FBE-E09E-4A35-970F-DC20666CC7D1"]
        self.assertEqual(r["bat_speed_mph"], 66.07)
        self.assertEqual(r["time_to_contact_s"], 0.152)        # 0.1519999999999999
        self.assertEqual(r["commit_time_s"], 0.09)
        self.assertEqual(r["on_plane_efficiency_pct"], 59.3)   # 0.5932745980953629
        self.assertEqual(r["attack_angle_deg"], 5.95)
        self.assertEqual(r["vertical_bat_angle_deg"], -22.35)
        self.assertEqual(r["body_tilt_deg"], 34.56)

    def test_identity_fields(self):
        r = self.rows[0]
        self.assertEqual(r["sensor_serial"], "111444004664")
        self.assertEqual(r["blast_user_name"], "Bobby Wahl")
        self.assertEqual(r["blast_user_id"], 895816)
        self.assertEqual(r["environment"], "general practice")
        self.assertIsNone(r["bat_nickname"])
        self.assertIn("timezone", r["raw"])

    def test_rejects_other_files(self):
        with self.assertRaises(BlastCsvError):
            parse_blast_text("PitchNo,Date,Pitcher\n1,2026-11-04,Smith\n")

    def test_excel_mangled_serial_is_an_error_not_a_new_sensor(self):
        text = FIXTURE.read_text(encoding="utf-8-sig").replace('"111444004664"', "1.11444E+11", 1)
        with self.assertRaises(BlastCsvError):
            parse_blast_text(text)

    def test_default_label(self):
        self.assertEqual(default_label("111444004664", set()), "664")
        self.assertEqual(default_label("111444009664", {"664"}), "9664")


class AttributionTest(unittest.TestCase):
    S1, S2 = "111444004664", "111444004665"

    def sw(self, cid, hhmmss, sensor=S1, **kw):
        return Swing(cid, sensor, t(hhmmss), **kw)

    def test_assignment_covers_swings_until_reassigned(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00"), t("15:20:00")),
                Assignment(2, self.S1, "mike", t("15:20:00"))]
        res = attribute([self.sw("a", "15:01:00"), self.sw("b", "15:19:59"), self.sw("c", "15:30:00"), self.sw("d", "15:45:00")], ases)
        self.assertEqual([res[k].athlete_uuid for k in "abcd"], ["john", "john", "mike", "mike"])
        self.assertEqual(res["c"].assignment_id, 2)

    def test_open_assignment_is_cut_by_the_next_one(self):
        # Coach never ended John's; Mike's start still ends it.
        ases = [Assignment(1, self.S1, "john", t("15:00:00")), Assignment(2, self.S1, "mike", t("15:20:00"))]
        res = attribute([self.sw("a", "15:10:00"), self.sw("b", "15:21:00")], ases)
        self.assertEqual((res["a"].athlete_uuid, res["b"].athlete_uuid), ("john", "mike"))

    def test_idle_gap_means_sensor_slept(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00"))]
        swings = [self.sw("a", "15:05:00"), self.sw("b", "15:20:00"), self.sw("c", "15:45:00"), self.sw("d", "15:46:00")]
        res = attribute(swings, ases, idle_minutes=20)
        self.assertEqual([res[k].attribution for k in "abcd"], ["assigned", "assigned", "stale", "stale"])
        self.assertIsNone(res["c"].athlete_uuid)
        self.assertEqual(res["c"].assignment_id, 1)
        self.assertIn("25 min", res["c"].note)

    def test_first_swing_long_after_assignment_is_stale(self):
        res = attribute([self.sw("a", "15:30:00")], [Assignment(1, self.S1, "john", t("15:00:00"))], idle_minutes=20)
        self.assertEqual(res["a"].attribution, "stale")

    def test_grace_before_start(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00"))]
        res = attribute([self.sw("a", "14:59:10"), self.sw("b", "14:55:00")], ases, grace_seconds=120)
        self.assertEqual((res["a"].attribution, res["a"].athlete_uuid), ("grace", "john"))
        self.assertEqual(res["b"].attribution, "unassigned")

    def test_grace_does_not_steal_from_a_live_assignment(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00")), Assignment(2, self.S1, "mike", t("15:20:00"))]
        res = attribute([self.sw("a", "15:19:30")], ases)
        self.assertEqual(res["a"].athlete_uuid, "john")

    def test_grace_after_an_ended_assignment(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00"), t("15:10:00")), Assignment(2, self.S1, "mike", t("15:20:00"))]
        res = attribute([self.sw("a", "15:12:00"), self.sw("b", "15:19:00")], ases)
        self.assertEqual((res["a"].attribution, res["b"].athlete_uuid), ("unassigned", "mike"))

    def test_sensors_are_independent(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00")), Assignment(2, self.S2, "mike", t("15:00:00"))]
        res = attribute([self.sw("a", "15:05:00"), self.sw("b", "15:05:00", sensor=self.S2)], ases)
        self.assertEqual((res["a"].athlete_uuid, res["b"].athlete_uuid), ("john", "mike"))

    def test_voided_assignment_is_ignored(self):
        ases = [Assignment(1, self.S1, "wrong", t("15:00:00"), voided=True), Assignment(2, self.S1, "john", t("15:00:00"))]
        res = attribute([self.sw("a", "15:05:00")], ases)
        self.assertEqual(res["a"].athlete_uuid, "john")

    def test_manual_is_kept_and_keeps_the_sensor_awake(self):
        ases = [Assignment(1, self.S1, "john", t("15:00:00"))]
        swings = [self.sw("a", "15:15:00", attribution="manual", athlete_uuid="pinned"), self.sw("b", "15:30:00")]
        res = attribute(swings, ases, idle_minutes=20)
        self.assertEqual((res["a"].attribution, res["a"].athlete_uuid), ("manual", "pinned"))
        self.assertEqual(res["b"].athlete_uuid, "john")   # 15 min after the manual swing, not 30 after start

    def test_real_export_without_assignments_is_unassigned(self):
        rows, _ = read_blast_csv(FIXTURE)
        res = attribute([Swing(r["capture_id"], r["sensor_serial"], r["swing_at"]) for r in rows], [])
        self.assertEqual({r.attribution for r in res.values()}, {"unassigned"})


@unittest.skipUnless(os.environ.get("BLAST_DATABASE_URL"), "BLAST_DATABASE_URL not set")
class DatabaseTest(unittest.TestCase):
    """End to end against a throwaway database that already has analytics.d_athletes and the schema."""

    def test_load_attribute_and_reload(self):
        import psycopg2
        from python.blast import load_blast_csv as L
        conn = psycopg2.connect(os.environ["BLAST_DATABASE_URL"])
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM hitting_intel.blast_swings; DELETE FROM hitting_intel.blast_assignment_events; "
                            "DELETE FROM hitting_intel.blast_assignments; DELETE FROM hitting_intel.ingest_runs; "
                            "DELETE FROM hitting_intel.blast_sensors;")
                cur.execute("""INSERT INTO analytics.d_athletes (athlete_uuid, name, normalized_name)
                               VALUES ('test-blast-1', 'Test Hitter', 'TEST HITTER') ON CONFLICT DO NOTHING""")
                cur.execute("""INSERT INTO hitting_intel.blast_sensors (serial, label) VALUES ('111444004664', '664')""")
                # 17:45-18:00 ET on Nov 4: covers the 10 newest swings in the fixture (17:55:24-17:58:33 ET).
                cur.execute("""INSERT INTO hitting_intel.blast_assignments (sensor_serial, athlete_uuid, started_at, assigned_by)
                               VALUES ('111444004664', 'test-blast-1', '2026-11-04 22:45:00+00', 'test')""")
            conn.commit()
            s = L.load_file(conn, FIXTURE, dry_run=False, force=False)
            self.assertEqual((s["inserted"], s["updated"]), (18, 0))
            out = L.reattribute(conn, {date(2026, 11, 2), date(2026, 11, 4)})
            self.assertEqual(out.get("assigned"), 10)
            self.assertEqual(out.get("unassigned"), 8)
            again = L.load_file(conn, FIXTURE, dry_run=False, force=False)
            self.assertIn("skipped", again)
            again = L.load_file(conn, FIXTURE, dry_run=False, force=True)
            self.assertEqual((again["inserted"], again["updated"]), (0, 18))
            with conn.cursor() as cur:   # a forced reload keeps the attribution
                cur.execute("SELECT COUNT(*) FROM hitting_intel.blast_swings WHERE athlete_uuid = 'test-blast-1'")
                self.assertEqual(cur.fetchone()[0], 10)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
