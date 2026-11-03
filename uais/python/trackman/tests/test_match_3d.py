"""Matcher tests on Garrett Cleavinger's real TrackMan session (2026-10-30, 26 live pitches)
with simulated 3D captures: a QTM clock offset, capture-time jitter, missed captures, an
extra capture, a mistyped velo and an untyped "Pitch" trial.

Run from uais/:  python -m unittest python.trackman.tests.test_match_3d -v
"""

import random
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

UAIS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / "python"))

from python.trackman.match_3d import Pitch, Trial, estimate_offset, match_session, type_relation  # noqa: E402

# time, TrackMan type code, velo, has IVB/HB  (from the 11-02 nightly pull)
GARRETT = [
    ("14:02:27", "FF", 90.7, False), ("14:02:57", "FF", 91.5, True), ("14:03:25", "FF", 90.7, True),
    ("14:04:14", "FF", 90.8, True), ("14:05:22", "SI", 91.0, True), ("14:05:47", "SI", 90.6, True),
    ("14:06:15", "SI", 91.3, True), ("14:06:45", "FC", 83.2, True), ("14:07:17", "FC", 84.8, True),
    ("14:07:51", "FC", 83.6, True), ("14:08:49", "FC", 84.0, True), ("14:09:26", "ST", 75.0, True),
    ("14:10:03", "ST", 75.8, True), ("14:10:51", "ST", 75.5, True), ("14:11:40", "ST", 76.3, True),
    ("14:13:49", "CH", 84.5, False), ("14:14:29", "CH", 84.7, True), ("14:14:56", "CH", 84.3, True),
    ("14:15:50", "CH", 85.3, True), ("14:16:22", "CH", 85.7, True), ("14:16:59", "CH", 84.7, True),
    ("14:17:21", "CH", 84.4, True), ("14:17:51", "FF", 90.0, True), ("14:18:20", "FF", 91.3, True),
    ("14:18:43", "FF", 90.1, True), ("14:19:07", "FF", 91.3, False),
]
CATEGORY = {"FF": "fastball", "SI": "fastball", "FC": "breaking_ball", "ST": "breaking_ball", "CH": "off_speed"}
DAY = "2026-10-30 "


def tm_pitches():
    return [Pitch(f"tm{i}", code, velo, datetime.fromisoformat(DAY + t), mv) for i, (t, code, velo, mv) in enumerate(GARRETT)]


def captures(offset_s=-47, jitter=2, seed=7, drop=(), extra=False, typo=None, untyped=()):
    """3D trials as the R ingest would store them: fastballs first, then the rest."""
    rng = random.Random(seed)
    rows = []
    for i, (t, code, velo, _) in enumerate(GARRETT):
        if i in drop:
            continue
        cap = datetime.fromisoformat(DAY + t) + timedelta(seconds=offset_s + rng.uniform(-jitter, jitter))
        cap = cap.replace(microsecond=0)                      # session.xml has 1-s times
        v = typo[1] if typo and typo[0] == i else velo
        cat = "pitch" if i in untyped else CATEGORY[code]
        rows.append((i, cat, v, cap))
    if extra:  # a capture with no live TrackMan pitch (e.g. a warm-up recorded in QTM)
        rows.append((99, "fastball", 88.0, datetime.fromisoformat(DAY + "14:01:30")))
    rank = {"fastball": 0, "breaking_ball": 1, "off_speed": 2, "pitch": 3}
    rows.sort(key=lambda r: (rank[r[1]], r[0]))
    # trial numbers count within each category, like the ingest (fastball 0..n, breaking_ball 0..n, ...)
    per_cat: dict[str, int] = {}
    trials = []
    for src, cat, v, cap in rows:
        ti = per_cat.get(cat, 0)
        per_cat[cat] = ti + 1
        trials.append(Trial(ti, cat, v, cap, owner_filename=f"src{src}"))
    truth = {tr.key: f"tm{int(tr.owner_filename[3:])}" for tr in trials if tr.owner_filename != "src99"}
    return trials, truth


class MatchTests(unittest.TestCase):
    def test_trial_numbers_repeat_across_categories(self):
        trials, truth = captures()
        self.assertEqual(sorted(t.trial_index for t in trials if t.category == "breaking_ball"), [0, 1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(len({t.key for t in trials}), len(trials))
        res = match_session(trials, tm_pitches())
        self.assertEqual({l.trial.key: l.pitch.pitch_uid for l in res.links}, truth)

    def test_type_rules(self):
        self.assertEqual(type_relation("fastball", "SI"), "agree")
        self.assertEqual(type_relation("breaking_ball", "FC"), "agree")   # cutters are filed as Breaking Ball
        self.assertEqual(type_relation("fastball", "FC"), "weak")
        self.assertEqual(type_relation("off_speed", "FF"), "conflict")
        self.assertEqual(type_relation("pitch", "CH"), "unknown")

    def test_offset_recovered(self):
        trials, _ = captures(offset_s=-47)
        off, support, _ = estimate_offset(trials, tm_pitches())
        self.assertAlmostEqual(off, 47, delta=2.5)
        self.assertGreaterEqual(support, 15)

    def test_clean_session_all_correct(self):
        trials, truth = captures()
        res = match_session(trials, tm_pitches())
        got = {l.trial.key: l.pitch.pitch_uid for l in res.links}
        self.assertEqual(got, truth)
        self.assertFalse(res.unmatched_pitches)
        # cutters are filed under Breaking Ball, so they pair like everything else
        cutters = [l for l in res.links if l.pitch.code == "FC"]
        self.assertEqual(len(cutters), 4)
        self.assertTrue(all(l.trial.category == "breaking_ball" and l.confidence != "review" for l in cutters))
        exact = sum(l.confidence == "exact" for l in res.links)
        self.assertGreaterEqual(exact, 20)

    def test_messy_session(self):
        # two missed captures, one extra capture, a mistyped velo, an untyped "Pitch" trial, more jitter
        trials, truth = captures(offset_s=-312, jitter=3, seed=3, drop=(2, 17), extra=True, typo=(9, 83.1), untyped=(20,))
        res = match_session(trials, tm_pitches())
        got = {l.trial.key: l.pitch.pitch_uid for l in res.links}
        wrong = {k: v for k, v in got.items() if truth.get(k) != v}
        self.assertEqual(wrong, {}, f"wrong pairs: {wrong}")
        self.assertEqual(len(got), len(truth))
        self.assertEqual({p.pitch_uid for p in res.unmatched_pitches}, {"tm2", "tm17"})
        self.assertEqual([t.owner_filename for t in res.unmatched_trials], ["src99"])
        typo = next(l for l in res.links if l.pitch.pitch_uid == "tm9")
        self.assertEqual(typo.confidence, "review")
        untyped = next(l for l in res.links if l.pitch.pitch_uid == "tm20")
        self.assertNotEqual(untyped.confidence, "exact")

    def test_duplicate_velos_split_by_time(self):
        # 90.7 (tm0, tm2), 84.7 (tm16, tm20), 91.3 (tm6, tm23, tm25) all thrown twice or more
        trials, truth = captures(offset_s=25, jitter=2.5, seed=11)
        res = match_session(trials, tm_pitches())
        got = {l.trial.key: l.pitch.pitch_uid for l in res.links}
        for k, v in truth.items():
            if v in ("tm0", "tm2", "tm16", "tm20", "tm6", "tm23", "tm25"):
                self.assertEqual(got.get(k), v)

    def test_no_clock(self):
        trials, truth = captures()
        for t in trials:
            t.t = None
        res = match_session(trials, tm_pitches())
        self.assertIsNone(res.offset_s)
        self.assertTrue(all(l.confidence == "review" for l in res.links))

    def test_many_random_sessions(self):
        bad = 0
        for seed in range(200):
            rng = random.Random(seed)
            drop = tuple(rng.sample(range(26), rng.randint(0, 3)))
            trials, truth = captures(offset_s=rng.uniform(-600, 600), jitter=rng.uniform(0, 3.5), seed=seed, drop=drop, extra=rng.random() < 0.3)
            res = match_session(trials, tm_pitches())
            for l in res.links:
                if truth.get(l.trial.key) != l.pitch.pitch_uid and l.confidence != "review":
                    bad += 1
        self.assertEqual(bad, 0, "a wrong pair was marked exact/probable")


    def test_no_velo_offspeed_is_probable(self):
        # Garrett's real case: Off Speed trials with blank velo in QTM, clean clock from the rest
        trials, truth = captures(offset_s=8, jitter=1, seed=5)
        for t in trials:
            if t.category == "off_speed":
                t.velo = None
        res = match_session(trials, tm_pitches())
        got = {l.trial.key: l.pitch.pitch_uid for l in res.links}
        self.assertEqual(got, truth)
        cos = [l for l in res.links if l.trial.category == "off_speed"]
        self.assertTrue(cos and all(l.confidence in ("probable", "review") for l in cos))
        self.assertTrue(any(l.confidence == "probable" for l in cos))


if __name__ == "__main__":
    unittest.main()
