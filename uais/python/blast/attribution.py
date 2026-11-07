"""
Who swung: Blast swing (sensor, time) + coach assignments -> athlete.

Pure functions, no database, so the rules are testable on their own
(python -m unittest python.blast.tests.test_blast -v, from uais/).

Rules, per sensor, in time order
  1. A swing at time t belongs to the assignment whose window holds t:
       [started_at, ended_at)  cut short by the next assignment on that sensor.
  2. The sensor sleeps when it isn't swung. A gap of more than `idle_minutes` with no
     swing (counting from the assignment start for the first swing) means the sensor
     went off, so the assignment is over: that swing and every later swing in the same
     assignment are 'stale' (held for review, not guessed). The coach reassigns after a
     break, which starts a fresh assignment.
  3. A swing with no assignment, up to `grace_seconds` before the next assignment on that
     sensor starts, counts for it ('grace'): the coach tapped a little late, or the phone
     and the server clocks differ.
  4. Anything else is 'unassigned'.
  5. 'manual' swings are never changed (they still count as activity for rule 2).
Voided assignments are ignored entirely.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable

FAR_FUTURE = datetime.max


@dataclass(frozen=True)
class Swing:
    capture_id: str
    sensor_serial: str
    swing_at: datetime
    attribution: str = "unassigned"          # current value; 'manual' is kept
    athlete_uuid: str | None = None


@dataclass(frozen=True)
class Assignment:
    id: int
    sensor_serial: str
    athlete_uuid: str
    started_at: datetime
    ended_at: datetime | None = None
    voided: bool = False


@dataclass(frozen=True)
class Result:
    athlete_uuid: str | None
    assignment_id: int | None
    attribution: str
    note: str | None


def _hhmm(t: datetime, tz) -> str:
    return (t.astimezone(tz) if tz and t.tzinfo else t).strftime("%H:%M:%S")


def attribute(swings: Iterable[Swing], assignments: Iterable[Assignment], idle_minutes: int = 20,
              grace_seconds: int = 120, tz=None) -> dict[str, Result]:
    """-> {capture_id: Result} for every swing passed in (manual ones echo their current athlete)."""
    idle = timedelta(minutes=idle_minutes)
    grace = timedelta(seconds=grace_seconds)
    by_sensor_sw: dict[str, list[Swing]] = {}
    for s in swings:
        by_sensor_sw.setdefault(s.sensor_serial, []).append(s)
    by_sensor_as: dict[str, list[Assignment]] = {}
    for a in assignments:
        if not a.voided:
            by_sensor_as.setdefault(a.sensor_serial, []).append(a)

    out: dict[str, Result] = {}
    for serial, sws in by_sensor_sw.items():
        sws.sort(key=lambda s: (s.swing_at, s.capture_id))
        ases = sorted(by_sensor_as.get(serial, []), key=lambda a: (a.started_at, a.id))
        starts = [a.started_at for a in ases]
        # Window end = own end, cut at the next assignment's start.
        ends = []
        for i, a in enumerate(ases):
            end = a.ended_at or FAR_FUTURE.replace(tzinfo=a.started_at.tzinfo)
            if i + 1 < len(ases):
                end = min(end, ases[i + 1].started_at)
            ends.append(end)

        last_activity: dict[int, datetime] = {}   # assignment id -> last swing (or start)
        asleep: dict[int, str] = {}               # assignment id -> why it ended

        for s in sws:
            i = bisect_right(starts, s.swing_at) - 1
            inside = i >= 0 and s.swing_at < ends[i]
            a = ases[i] if inside else None
            if a is None:
                j = i + 1  # next assignment after this swing
                if j < len(ases) and ases[j].started_at - s.swing_at <= grace and (i < 0 or s.swing_at >= ends[i]):
                    a = ases[j]
                    if s.attribution != "manual":
                        out[s.capture_id] = Result(a.athlete_uuid, a.id, "grace",
                                                   f"{int((a.started_at - s.swing_at).total_seconds())}s before assignment #{a.id} started")
                    last_activity[a.id] = max(last_activity.get(a.id, s.swing_at), s.swing_at)
                    continue
                if s.attribution != "manual":
                    out[s.capture_id] = Result(None, None, "unassigned", None)
                continue

            prev = last_activity.get(a.id, a.started_at)
            if a.id not in asleep and s.swing_at - prev > idle:
                gap = int((s.swing_at - prev).total_seconds() // 60)
                asleep[a.id] = (f"no swing for {gap} min after {_hhmm(prev, tz)} (sensor likely slept); "
                                f"assignment #{a.id} treated as over")
            last_activity[a.id] = s.swing_at
            if s.attribution == "manual":
                continue
            if a.id in asleep:
                out[s.capture_id] = Result(None, a.id, "stale", asleep[a.id])
            else:
                out[s.capture_id] = Result(a.athlete_uuid, a.id, "assigned", None)

    for sws in by_sensor_sw.values():
        for s in sws:
            if s.attribution == "manual":
                out[s.capture_id] = Result(s.athlete_uuid, None, "manual", None)
    return out
