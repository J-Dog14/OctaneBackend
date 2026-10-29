#!/usr/bin/env python3
"""
Recompute the readiness score history from Readiness Screen v2.

Scores every session in v_readiness_screen_sessions (oldest first). Each session gets up to 3 attempts
on a fresh connection, so a dropped Neon/Wi-Fi connection doesn't lose it. Safe to re-run.

    python uais/python/readinessScreen/v2/rescore_all.py              # dry run: counts only
    python uais/python/readinessScreen/v2/rescore_all.py --apply [--delete-orphans]
"""
import argparse
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from common.athlete_manager import get_warehouse_connection          # noqa: E402
from readinessScreen.scoring import compute_and_upsert_score        # noqa: E402


def fetch(sql, params=None):
    """Short-lived connection per query - long idle connections get dropped."""
    for attempt in range(3):
        conn = None
        try:
            conn = get_warehouse_connection()
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall() if cur.description else cur.rowcount
            conn.commit()
            return rows
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--delete-orphans", action="store_true")
    ap.add_argument("--workers", type=int, default=6, help="sessions scored in parallel (default 6)")
    args = ap.parse_args()
    sessions = fetch("SELECT athlete_uuid, session_date FROM public.v_readiness_screen_sessions "
                     "ORDER BY session_date, athlete_uuid")
    orphans = fetch("""SELECT s.athlete_uuid, s.session_date FROM public.f_readiness_screen_score s
                       WHERE NOT EXISTS (SELECT 1 FROM public.v_readiness_screen_sessions v
                                         WHERE v.athlete_uuid = s.athlete_uuid AND v.session_date = s.session_date)""")
    print(f"Readiness sessions to score: {len(sessions)}")
    print(f"Score rows with no readiness session behind them: {len(orphans)}")
    if not args.apply:
        print("\nDry run - nothing written. Rerun with --apply.")
        return
    t0, fails = time.time(), []

    def score_one(item):
        uuid, d = item
        for attempt in range(3):
            try:
                compute_and_upsert_score(uuid, d)
                return None
            except Exception as e:
                if attempt == 2:
                    return (uuid, d, f"{type(e).__name__}: {str(e).splitlines()[0][:120]}")
                time.sleep(3 * (attempt + 1))

    # sessions are independent (each score only reads raw readiness/screen rows), so score in parallel
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, res in enumerate(pool.map(score_one, sessions), 1):
            if res:
                fails.append(res)
            if i % 50 == 0 or i == len(sessions):
                print(f"  {i}/{len(sessions)}  failures {len(fails)}  {time.time() - t0:.0f}s", flush=True)
    if args.delete_orphans and orphans:
        for uuid, d in orphans:
            fetch("DELETE FROM public.f_readiness_screen_score WHERE athlete_uuid=%s AND session_date=%s", (uuid, d))
        print(f"Deleted {len(orphans)} orphan score rows.")
    print(f"Score rows by band now: {dict(fetch('SELECT band, COUNT(*) FROM public.f_readiness_screen_score GROUP BY 1 ORDER BY 2 DESC'))}")
    if fails:
        print(f"\n{len(fails)} session(s) failed after 3 attempts. Reasons:")
        for reason, n in Counter(f[2] for f in fails).most_common(8):
            print(f"  {n:4d}  {reason}")
        print("Re-run the same command to retry them (already-scored sessions are just recomputed).")


if __name__ == "__main__":
    main()
