"""
Pair pitching 3D trials with TrackMan pitches (chunk 2 of the TrackMan <-> 3D sync).

Three signals, in this order:
  1. Eligibility - same athlete, same local date; TrackMan pitch is live (the portal
     pull is live-only) and its type is compatible with the 3D trial's category.
  2. Velo        - the 3D velo is typed from TrackMan, so a true pair matches to 0.1 mph.
  3. Time        - 3D capture_time (QTM PC clock) vs TrackMan pitch_time. The two clocks
                   are not synced, so one clock offset per session is estimated first
                   from the velo-exact, type-compatible pairs, then each trial is paired
                   within a few seconds of (capture_time + offset).

Assignment keeps both sides in time order (a DP like sequence alignment), so a missed
capture or a TrackMan pitch with no 3D trial is simply skipped.

Each link gets a confidence:
  exact    - velo within 0.05, residual <= 3 s, type agrees, no rival candidate
  probable - velo within 0.15, residual <= 6 s, no rival candidate
  review   - anything else that still paired (big velo gap, weak type, rival, or no clock)
Links set or confirmed by a person have confidence 'manual' and are never replaced.

Usage (from uais/):
  python -m python.trackman.match_3d --athlete "Garrett Cleavinger"            # dry run, latest 3D date
  python -m python.trackman.match_3d --athlete <uuid> --date 2026-10-30 --write
  python -m python.trackman.match_3d --all --write                              # every athlete/date with both
  python -m python.trackman.match_3d --all --new --write                        # only sessions not paired yet (nightly)
  python -m python.trackman.match_3d --confirm <uuid> 2026-10-30 breaking_ball 0 <pitch_uid>   # manual link
  python -m python.trackman.match_3d --unlink  <uuid> 2026-10-30 breaking_ball 0

A 3D trial is identified by (athlete, date, pitch_category, trial_index): trial numbers count
within each category (fastball 0..n, breaking_ball 0..n, ...). The report shows each trial's
TrackMan pitch number (TM#) - the order thrown among that player's live pitches in the session.

Needs the pitch_category migration (npm run pitchtype:setup) for capture_time /
pitch_category on f_pitching_trials, and npm run pi:setup for the link table.
"""

from __future__ import annotations

import argparse
import statistics
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve()
UAIS = HERE.parents[2]          # .../uais
sys.path.insert(0, str(UAIS))
sys.path.insert(0, str(UAIS / "python"))

# ---------------------------------------------------------------------------
# Rules (all in one place so they're easy to tune)
# ---------------------------------------------------------------------------

#: 3D category -> TrackMan codes that agree / are plausible-but-weak.
TYPE_RULES: dict[str, tuple[set[str], set[str]]] = {
    "fastball": ({"FF", "SI"}, {"FC"}),
    # 8ctane files cutters under "Breaking Ball" in QTM (Joey, 2026-11-02)
    "breaking_ball": ({"FC", "SL", "ST", "CU", "KC", "SV"}, set()),
    "off_speed": ({"CH", "FS"}, set()),
    "pitch": (set(), set()),   # untyped in QTM: any TrackMan type is allowed, none "agrees"
}

VELO_EXACT = 0.05        # mph; both sides carry 1 decimal
VELO_CLOSE = 0.15
VELO_MAX = 1.5           # beyond this a pair is never made
OFFSET_WINDOW_S = 6.0    # width of the densest-bin search for the clock offset
PAIR_WINDOW_S = 10.0     # max |residual| for a pair once the offset is applied
EXACT_RES_S = 3.0
PROBABLE_RES_S = 6.0
MIN_OFFSET_SUPPORT = 3   # velo-exact pairs needed to trust an offset


def type_relation(category: str | None, tm_code: str | None) -> str:
    """'agree' | 'weak' | 'unknown' (3D untyped or TrackMan OTHER) | 'conflict'."""
    cat = category or "pitch"
    code = (tm_code or "").upper()
    agree, weak = TYPE_RULES.get(cat, (set(), set()))
    if cat == "pitch" or code in ("", "OTHER"):
        return "unknown"
    if code in agree:
        return "agree"
    if code in weak:
        return "weak"
    return "conflict"


CATEGORY_RANK = {"fastball": 0, "breaking_ball": 1, "off_speed": 2, "pitch": 3}


@dataclass
class Trial:
    trial_index: int
    category: str | None
    velo: float | None
    t: datetime | None
    owner_filename: str | None = None

    @property
    def key(self) -> tuple[str, int]:
        """A trial's identity: trial numbers count within each pitch category."""
        return (self.category or "fastball", self.trial_index)

    @property
    def sort_key(self) -> tuple[int, int]:
        return (CATEGORY_RANK.get(self.category or "fastball", 9), self.trial_index)


@dataclass
class Pitch:
    pitch_uid: str
    code: str | None
    velo: float | None
    t: datetime | None
    has_movement: bool = True
    no: int | None = None          # TrackMan pitch number (order thrown in the session)


@dataclass
class Link:
    trial: Trial
    pitch: Pitch
    residual_s: float | None
    velo_diff: float | None
    relation: str
    confidence: str
    notes: list[str] = field(default_factory=list)


@dataclass
class MatchResult:
    offset_s: float | None
    offset_support: int
    offset_note: str
    links: list[Link]
    unmatched_trials: list[Trial]
    unmatched_pitches: list[Pitch]


def _vdiff(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else abs(a - b)


def estimate_offset(trials: list[Trial], pitches: list[Pitch]) -> tuple[float | None, int, str]:
    """Clock offset (TrackMan - QTM, seconds) from velo-exact, type-compatible pairs.

    Every such pair votes with its time difference; the offset is the median of the
    densest OFFSET_WINDOW_S window. Pairs that are velo-exact by coincidence (same velo
    thrown twice) land outside the window, so they don't move it.
    """
    votes: list[tuple[float, float]] = []   # (dt, velo diff)
    for tr in trials:
        if tr.t is None:
            continue
        for p in pitches:
            if p.t is None:
                continue
            dv = _vdiff(tr.velo, p.velo)
            if dv is None or dv > VELO_EXACT + 1e-9:
                continue
            if type_relation(tr.category, p.code) == "conflict":
                continue
            votes.append(((p.t - tr.t).total_seconds(), dv))
    if not votes:
        return None, 0, "no velo-exact pairs: no clock offset"
    votes.sort()
    best: tuple[int, float, int, int] | None = None   # (count, -spread, i, j)
    j = 0
    for i in range(len(votes)):
        while j < len(votes) and votes[j][0] - votes[i][0] <= OFFSET_WINDOW_S:
            j += 1
        count = j - i
        spread = votes[j - 1][0] - votes[i][0]
        cand = (count, -spread, i, j)
        if best is None or cand[:2] > best[:2]:
            best = cand
    count, _, i, j = best  # type: ignore[misc]
    offset = statistics.median(v[0] for v in votes[i:j])
    if count < MIN_OFFSET_SUPPORT:
        return offset, count, f"weak clock offset ({count} supporting pair{'s' if count != 1 else ''})"
    return offset, count, f"clock offset {offset:+.0f} s from {count} velo-exact pairs"


def _pair_score(tr: Trial, p: Pitch, offset: float | None) -> tuple[float, float | None] | None:
    """Score for pairing tr with p, or None if they can't pair."""
    rel = type_relation(tr.category, p.code)
    if rel == "conflict":
        return None
    dv = _vdiff(tr.velo, p.velo)
    if dv is not None and dv > VELO_MAX:
        return None
    res = None
    if offset is not None and tr.t is not None and p.t is not None:
        res = (p.t - tr.t).total_seconds() - offset
        if abs(res) > PAIR_WINDOW_S:
            return None
    elif offset is not None:
        return None   # clock-based session, but this row has no time
    score = 5.0
    if dv is None:
        score -= 2.0
    elif dv <= VELO_EXACT:
        score += 3.0
    elif dv <= VELO_CLOSE:
        score += 1.5
    else:
        score -= 2.0 * dv
    if res is not None:
        score += 2.0 - abs(res) / 3.0
    score += {"agree": 1.0, "unknown": 0.0, "weak": -1.0}[rel]
    return score, res


def match_session(trials: list[Trial], pitches: list[Pitch]) -> MatchResult:
    """Pair one athlete's 3D trials with his TrackMan pitches for one date."""
    offset, support, note = estimate_offset(trials, pitches)
    use_clock = offset is not None and support >= 1

    # Order both sides. With a clock: by time. Without: by trial_index / pitch time.
    far = datetime.max
    tr_sorted = sorted(trials, key=lambda t: ((t.t or far) if use_clock else far, t.sort_key))
    p_sorted = sorted(pitches, key=lambda p: (p.t or far, p.pitch_uid))
    n, m = len(tr_sorted), len(p_sorted)

    scores: dict[tuple[int, int], tuple[float, float | None]] = {}
    for a, tr in enumerate(tr_sorted):
        for b, p in enumerate(p_sorted):
            s = _pair_score(tr, p, offset if use_clock else None)
            if s is not None:
                scores[(a, b)] = s

    if use_clock:
        # Order-preserving DP (skips cost nothing; pairs add their score).
        dp = [[0.0] * (m + 1) for _ in range(n + 1)]
        back = [[0] * (m + 1) for _ in range(n + 1)]   # 0 skip trial, 1 skip pitch, 2 pair
        for a in range(n - 1, -1, -1):
            for b in range(m - 1, -1, -1):
                best, how = dp[a + 1][b], 0
                if dp[a][b + 1] > best:
                    best, how = dp[a][b + 1], 1
                s = scores.get((a, b))
                if s is not None and s[0] > 0 and s[0] + dp[a + 1][b + 1] > best:
                    best, how = s[0] + dp[a + 1][b + 1], 2
                dp[a][b], back[a][b] = best, how
        pairs = []
        a = b = 0
        while a < n and b < m:
            how = back[a][b]
            if how == 2:
                pairs.append((a, b))
                a, b = a + 1, b + 1
            elif how == 1:
                b += 1
            else:
                a += 1
    else:
        # No usable clock: greedy on score (velo + type), one pitch per trial.
        pairs = []
        used_a: set[int] = set()
        used_b: set[int] = set()
        for (a, b), (s, _) in sorted(scores.items(), key=lambda kv: -kv[1][0]):
            if a in used_a or b in used_b or s <= 0:
                continue
            pairs.append((a, b))
            used_a.add(a)
            used_b.add(b)

    links: list[Link] = []
    paired_b = {b for _, b in pairs}
    for a, b in pairs:
        tr, p = tr_sorted[a], p_sorted[b]
        _, res = scores[(a, b)]
        dv = _vdiff(tr.velo, p.velo)
        rel = type_relation(tr.category, p.code)
        notes: list[str] = []
        # A rival: another unpaired-or-paired pitch that would also pass as velo-close and in-window.
        rivals = [
            b2 for (a2, b2), (s2, r2) in scores.items()
            if a2 == a and b2 != b and (_vdiff(tr.velo, p_sorted[b2].velo) or 9) <= VELO_CLOSE
            and (r2 is None or abs(r2) <= PROBABLE_RES_S)
        ]
        # Without a 3D velo, a rival is any other compatible pitch close in time.
        time_rivals = [
            b2 for (a2, b2), (s2, r2) in scores.items()
            if a2 == a and b2 != b and r2 is not None and abs(r2) <= PROBABLE_RES_S
        ] if dv is None else []
        if dv is None:
            notes.append("no 3D velo: paired on time + type" + (f" ({len(time_rivals)} other pitch(es) within {PROBABLE_RES_S:.0f} s)" if time_rivals else ""))
        if rivals:
            notes.append(f"{len(rivals)} other TrackMan pitch(es) also fit")
        if rel == "weak":
            notes.append(f"type is a weak fit ({tr.category} vs {p.code})")
        if rel == "unknown":
            notes.append("type not checked (untyped on one side)")
        if res is None:
            notes.append("no clock: paired on velo + type only")
        if not p.has_movement:
            notes.append("TrackMan has velo/spin/release only (no break)")

        if res is not None and support < MIN_OFFSET_SUPPORT:
            notes.append("clock offset is weak")
        weak_clock = support < MIN_OFFSET_SUPPORT
        if weak_clock:
            conf = "review"
        elif dv is not None and dv <= VELO_EXACT and res is not None and abs(res) <= EXACT_RES_S and rel == "agree" and not rivals:
            conf = "exact"
        elif dv is not None and dv <= VELO_CLOSE and res is not None and abs(res) <= PROBABLE_RES_S and rel != "weak" and not rivals:
            conf = "probable"
        elif dv is None and res is not None and abs(res) <= EXACT_RES_S and rel == "agree" and not time_rivals:
            # No 3D velo (blank Comments in QTM): trusted clock + agreeing type + nothing else nearby.
            conf = "probable"
        else:
            conf = "review"
        links.append(Link(tr, p, res, dv, rel, conf, notes))

    paired_a = {a for a, _ in pairs}
    return MatchResult(
        offset_s=offset if use_clock else None,
        offset_support=support,
        offset_note=note,
        links=sorted(links, key=lambda l: l.trial.sort_key),
        unmatched_trials=[t for i, t in enumerate(tr_sorted) if i not in paired_a],
        unmatched_pitches=[p for i, p in enumerate(p_sorted) if i not in paired_b],
    )


# ---------------------------------------------------------------------------
# Warehouse I/O
# ---------------------------------------------------------------------------

def _pitch_time(v) -> datetime | None:
    from python.trackman.load_trackman_pull import pitch_time_key
    t = pitch_time_key(v)
    return None if t == datetime.max else t


def load_session(conn, athlete_uuid: str, session_date: str) -> tuple[list[Trial], list[Pitch], set[tuple[str, int]]]:
    """3D trials, TrackMan pitches, and the (category, trial_index) keys already linked by hand."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT trial_index, pitch_category, velocity_mph::float8, capture_time, owner_filename
                 FROM public.f_pitching_trials
                WHERE athlete_uuid = %s AND session_date = %s
                ORDER BY pitch_category, trial_index""",
            (athlete_uuid, session_date),
        )
        trials = [Trial(r[0], r[1], r[2], r[3], r[4]) for r in cur.fetchall()]
        cur.execute(
            """SELECT p.pitch_uid, p.pitch_type, p.rel_speed, p.pitch_time, (p.ivb IS NOT NULL AND p.hb IS NOT NULL), p.pitch_no
                 FROM pitch_intel.trackman_pitches p
                WHERE p.athlete_uuid = %s AND p.session_date = %s AND p.session_type = 'bullpen'
                  AND NOT EXISTS (SELECT 1 FROM pitch_intel.biomech_trackman_links l
                                   WHERE l.pitch_uid = p.pitch_uid AND l.confidence = 'manual')""",
            (athlete_uuid, session_date),
        )
        pitches = [Pitch(r[0], r[1], r[2], _pitch_time(r[3]), bool(r[4]), r[5]) for r in cur.fetchall()]
        cur.execute(
            """SELECT pitch_category, trial_index FROM pitch_intel.biomech_trackman_links
                WHERE athlete_uuid = %s AND session_date = %s AND confidence = 'manual'""",
            (athlete_uuid, session_date),
        )
        manual = {(r[0], r[1]) for r in cur.fetchall()}
    return [t for t in trials if t.key not in manual], pitches, manual


def write_links(conn, athlete_uuid: str, session_date: str, result: MatchResult) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """DELETE FROM pitch_intel.biomech_trackman_links
                WHERE athlete_uuid = %s AND session_date = %s AND confidence <> 'manual'""",
            (athlete_uuid, session_date),
        )
        for l in result.links:
            cur.execute(
                """INSERT INTO pitch_intel.biomech_trackman_links
                     (athlete_uuid, session_date, trial_index, owner_filename, pitch_category, pitch_uid, tm_pitch_type,
                      capture_time, pitch_time, clock_offset_s, residual_s, velo_3d, velo_tm, confidence, notes, matched_by)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'auto')""",
                (athlete_uuid, session_date, l.trial.trial_index, l.trial.owner_filename, l.trial.category,
                 l.pitch.pitch_uid, l.pitch.code, l.trial.t, l.pitch.t, result.offset_s, l.residual_s,
                 l.trial.velo, l.pitch.velo, l.confidence, "; ".join(l.notes) or None),
            )
    conn.commit()
    return len(result.links)


def candidate_sessions(conn, only_new: bool = False) -> list[tuple[str, str, str]]:
    """(athlete_uuid, name, date) with both 3D trials and TrackMan bullpen pitches on the same date.
    only_new: just the ones with no stored links yet (what the nightly run pairs)."""
    new_only = """AND t.capture_time IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM pitch_intel.biomech_trackman_links l
                                  WHERE l.athlete_uuid = t.athlete_uuid AND l.session_date = t.session_date)""" if only_new else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT DISTINCT t.athlete_uuid, a.name, t.session_date::text
                 FROM public.f_pitching_trials t
                 JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
                WHERE EXISTS (SELECT 1 FROM pitch_intel.trackman_pitches p
                               WHERE p.athlete_uuid = t.athlete_uuid AND p.session_date = t.session_date
                                 AND p.session_type = 'bullpen')
                  {new_only}
                ORDER BY 3 DESC, 2"""
        )
        return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def resolve_athlete(conn, who: str) -> tuple[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT athlete_uuid, name FROM analytics.d_athletes WHERE athlete_uuid = %s", (who,))
        row = cur.fetchone()
        if row:
            return row[0], row[1]
        cur.execute("SELECT athlete_uuid, name FROM analytics.d_athletes WHERE name ILIKE %s ORDER BY name", (f"%{who}%",))
        rows = cur.fetchall()
    if len(rows) != 1:
        names = ", ".join(r[1] for r in rows[:8]) or "none"
        raise SystemExit(f"'{who}' matches {len(rows)} athletes ({names}). Use the athlete_uuid.")
    return rows[0][0], rows[0][1]


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _hms(t: datetime | None) -> str:
    return t.strftime("%H:%M:%S") if t else "--:--:--"


def _v(x: float | None) -> str:
    return f"{x:5.1f}" if x is not None else "  -  "


def _no(p: Pitch) -> str:
    return f"{p.no:>3}" if p.no is not None else "  -"


def report(name: str, session_date: str, res: MatchResult, manual: set) -> str:
    out = [f"{name} - {session_date}", f"  {res.offset_note}"]
    counts = {c: sum(1 for l in res.links if l.confidence == c) for c in ("exact", "probable", "review")}
    out.append(f"  linked {len(res.links)} (exact {counts['exact']}, probable {counts['probable']}, review {counts['review']})"
               f"; 3D unmatched {len(res.unmatched_trials)}; TrackMan unmatched {len(res.unmatched_pitches)}"
               + (f"; {len(manual)} manual link(s) kept" if manual else ""))
    out.append("  category       trial  3D time   velo | TM#  TM time   type  velo |  resid  conf      notes")
    for l in res.links:
        t, p = l.trial, l.pitch
        resid = f"{l.residual_s:+5.1f}s" if l.residual_s is not None else "   -  "
        out.append(f"  {(t.category or '?'):<13}  {t.trial_index:>5}  {_hms(t.t)} {_v(t.velo)} | {_no(p)}  {_hms(p.t)}  {(p.code or '?'):<4} {_v(p.velo)} | {resid}  {l.confidence:<8}  {'; '.join(l.notes)}")
    for t in res.unmatched_trials:
        out.append(f"  {(t.category or '?'):<13}  {t.trial_index:>5}  {_hms(t.t)} {_v(t.velo)} |  (no TrackMan pitch)")
    for p in res.unmatched_pitches:
        out.append(f"  {'-':<13}  {'':5}  {'':8} {'':5} | {_no(p)}  {_hms(p.t)}  {(p.code or '?'):<4} {_v(p.velo)} |  (no 3D trial)")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Pair pitching 3D trials with TrackMan pitches.")
    ap.add_argument("--athlete", help="athlete_uuid or (part of) the name")
    ap.add_argument("--date", help="YYYY-MM-DD (default: every date with both 3D and TrackMan for the athlete)")
    ap.add_argument("--all", action="store_true", help="every athlete/date with both 3D trials and TrackMan pitches")
    ap.add_argument("--write", action="store_true", help="store the links (default is a dry run)")
    ap.add_argument("--new", action="store_true", help="with --all: only sessions with no links yet (nightly)")
    ap.add_argument("--confirm", nargs=5, metavar=("UUID", "DATE", "CATEGORY", "TRIAL_INDEX", "PITCH_UID"),
                    help="set a manual link (CATEGORY: fastball | breaking_ball | off_speed | pitch)")
    ap.add_argument("--unlink", nargs=4, metavar=("UUID", "DATE", "CATEGORY", "TRIAL_INDEX"), help="remove a link (manual or auto)")
    args = ap.parse_args(argv)

    from python.common.athlete_manager import get_warehouse_connection
    conn = get_warehouse_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('pitch_intel.biomech_trackman_links')")
            if cur.fetchone()[0] is None:
                print("pitch_intel.biomech_trackman_links doesn't exist yet. Run `npm run pi:setup` first.")
                return 2
            cur.execute("""SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='f_pitching_trials' AND column_name='capture_time'""")
            if cur.fetchone() is None:
                print("f_pitching_trials has no capture_time yet. Run `npm run pitchtype:setup` and re-ingest the session first.")
                return 2
            cur.execute("SELECT 1 FROM pg_constraint WHERE conname = 'biomech_trackman_links_trial_key'")
            if cur.fetchone() is None:
                print("The link table still keys trials without pitch_category. Run `npm run pitchtype:keys` first.")
                return 2

        if args.confirm:
            uuid, d, cat, ti, uid = args.confirm
            with conn.cursor() as cur:
                cur.execute("""DELETE FROM pitch_intel.biomech_trackman_links
                                WHERE pitch_uid = %s OR (athlete_uuid=%s AND session_date=%s AND pitch_category=%s AND trial_index=%s)""",
                            (uid, uuid, d, cat, int(ti)))
                cur.execute(
                    """INSERT INTO pitch_intel.biomech_trackman_links
                         (athlete_uuid, session_date, trial_index, owner_filename, pitch_category, pitch_uid, tm_pitch_type,
                          capture_time, pitch_time, velo_3d, velo_tm, confidence, matched_by)
                       SELECT t.athlete_uuid, t.session_date, t.trial_index, t.owner_filename, t.pitch_category, p.pitch_uid, p.pitch_type,
                              t.capture_time, NULL, t.velocity_mph, p.rel_speed, 'manual', 'manual'
                         FROM public.f_pitching_trials t, pitch_intel.trackman_pitches p
                        WHERE t.athlete_uuid=%s AND t.session_date=%s AND t.pitch_category=%s AND t.trial_index=%s AND p.pitch_uid=%s""",
                    (uuid, d, cat, int(ti), uid))
                n = cur.rowcount
            conn.commit()
            print("manual link saved" if n else "no such trial / pitch")
            return 0 if n else 1
        if args.unlink:
            uuid, d, cat, ti = args.unlink
            with conn.cursor() as cur:
                cur.execute("""DELETE FROM pitch_intel.biomech_trackman_links
                                WHERE athlete_uuid=%s AND session_date=%s AND pitch_category=%s AND trial_index=%s""",
                            (uuid, d, cat, int(ti)))
            conn.commit()
            return 0

        if args.all:
            todo = candidate_sessions(conn, only_new=args.new)
            print(f"{len(todo)} session(s) with 3D capture times and TrackMan pitches{' and no links yet' if args.new else ''}\n")
        elif args.athlete:
            uuid, name = resolve_athlete(conn, args.athlete)
            if args.date:
                todo = [(uuid, name, args.date)]
            else:
                todo = [s for s in candidate_sessions(conn) if s[0] == uuid]
            if not todo:
                print(f"{name}: no date with both 3D trials and TrackMan bullpen pitches.")
                return 1
        else:
            ap.error("give --athlete or --all")

        for uuid, name, d in todo:
            trials, pitches, manual = load_session(conn, uuid, d)
            if not trials or not pitches:
                print(f"{name} - {d}: nothing to pair ({len(trials)} trials, {len(pitches)} TrackMan pitches)\n")
                continue
            if not any(t.t for t in trials):
                cats = ", ".join(f"{c} {sum(1 for t in trials if t.category == c)}"
                                 for c in ("fastball", "breaking_ball", "off_speed", "pitch")
                                 if any(t.category == c for t in trials))
                print(f"{name} - {d}: the 3D trials have no capture_time ({len(trials)} trials: {cats}).\n"
                      "  These rows come from an ingest that ran before the pitch-category change, so they have\n"
                      "  no capture times (and only fastballs). Re-run this session through the pitching ingest,\n"
                      "  then run this again. Nothing was paired.\n")
                continue
            res = match_session(trials, pitches)
            print(report(name, d, res, manual))
            if args.write:
                print(f"  stored {write_links(conn, uuid, d, res)} link(s)")
            print()
        if not args.write:
            print("Dry run - add --write to store the links.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
