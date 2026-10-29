"""Read-only warehouse identity audit, including every Trackman-linked athlete.

Writes a repeatable candidate report, never merges or updates athletes.
"""
import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

UAIS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(UAIS))
from psycopg2.extras import RealDictCursor
from python.common.athlete_manager import get_warehouse_connection, _name_similarity, normalize_email
from python.common.athlete_cleanup import clean_and_normalize_name


def name_key(row):
    return clean_and_normalize_name(row.get('name') or '')


def audit_pairs(athletes, trackman_uuids):
    """Broad candidate discovery; similarity alone is never proof of identity."""
    rows = {a['athlete_uuid']: a for a in athletes}
    buckets = defaultdict(set)
    for a in athletes:
        uuid = a['athlete_uuid']
        name = name_key(a)
        for kind, key in (
            ('name', name), ('tokens', ' '.join(sorted(name.split()))),
            ('email', normalize_email(a.get('email'))),
            ('app', a.get('app_db_uuid')), ('dob', str(a.get('date_of_birth') or '')),
        ):
            if key:
                buckets[(kind, key)].add(uuid)
    pairs = set()
    for ids in buckets.values():
        pairs.update(combinations(sorted(ids), 2))
    # Check all names, including misspellings without shared DOB/email. Cheap
    # bounds discard impossible 90% matches before the full comparison.
    from difflib import SequenceMatcher
    normalized = [(a['athlete_uuid'], name_key(a)) for a in athletes]
    for i, (uuid_a, name_a) in enumerate(normalized):
        for uuid_b, name_b in normalized[i + 1:]:
            if not name_a or not name_b:
                continue
            sm = SequenceMatcher(None, name_a.lower(), name_b.lower())
            if sm.real_quick_ratio() >= .90 and sm.quick_ratio() >= .90 and sm.ratio() >= .90:
                pairs.add(tuple(sorted((uuid_a, uuid_b))))
    findings = []
    for left, right in sorted(pairs):
        a, b = rows[left], rows[right]
        na, nb = name_key(a), name_key(b)
        same_name = bool(na and na == nb)
        reordered = bool(na and nb and not same_name and sorted(na.split()) == sorted(nb.split()))
        da, db = a.get('date_of_birth'), b.get('date_of_birth')
        same_dob = bool(da and db and str(da) == str(db))
        conflict_dob = bool(da and db and str(da) != str(db))
        ea, eb = normalize_email(a.get('email')), normalize_email(b.get('email'))
        same_email = bool(ea and ea == eb)
        same_app = bool(a.get('app_db_uuid') and a.get('app_db_uuid') == b.get('app_db_uuid'))
        score = _name_similarity(na, nb)
        reasons = []
        if same_name:
            reasons.append('same_normalized_name')
        if reordered:
            reasons.append('same_name_tokens_reordered')
        if same_email:
            reasons.append('same_email')
        if same_app:
            reasons.append('same_app_uuid')
        if score >= .90 and not same_name:
            reasons.append('name_similarity_90pct')
        if same_dob and score >= .60:
            reasons.append('same_dob_similar_name')
        if not reasons:
            continue
        strong = (same_name or reordered) and same_dob
        classification = ('conflicting_dob_review' if conflict_dob else
                          'strong_duplicate_candidate' if strong or same_app else 'needs_review')
        findings.append(dict(classification=classification,
            trackman_involved=left in trackman_uuids or right in trackman_uuids,
            athlete_uuid_a=left, name_a=a['name'], origin_a=a.get('source_system'),
            dob_a=str(da or ''), email_present_a=bool(ea), created_at_a=str(a.get('created_at') or ''),
            athlete_uuid_b=right, name_b=b['name'], origin_b=b.get('source_system'),
            dob_b=str(db or ''), email_present_b=bool(eb), created_at_b=str(b.get('created_at') or ''),
            same_dob=same_dob, conflicting_dob=conflict_dob, same_email=same_email,
            name_similarity=round(score, 4), evidence=';'.join(reasons)))
    return sorted(findings, key=lambda f: (not f['trackman_involved'], f['classification'], f['name_a']))


def audit_trackman_links(athletes, mappings, players, links, pitch_links):
    """Check IDs across stores, foreign-ID aliases, dangling links and linked DOBs."""
    known = {a['athlete_uuid']: a for a in athletes}
    ids = defaultdict(set)
    for m in mappings:
        if m['source_system'] == 'trackman':
            ids[('trackman', str(m['source_athlete_id']))].add(m['athlete_uuid'])
    for link in links:
        if link.get('athlete_uuid'):
            ids[('trackman', str(link['source_player_id']))].add(link['athlete_uuid'])
    for link in pitch_links:
        if link.get('athlete_uuid'):
            ids[('trackman', str(link['tm_player_id']))].add(link['athlete_uuid'])
    dob_conflicts = []
    for p in players:
        uuid = p.get('athlete_uuid')
        if not uuid:
            continue
        ids[('trackman', str(p['player_id']))].add(uuid)
        if p.get('portal_id'):
            ids[('portal', str(p['portal_id']))].add(uuid)
        for foreign in p.get('foreign_ids') or []:
            system, sep, value = foreign.partition('-')
            if sep and system.upper() in ('TMBB', 'AMA'):
                ids[('trackman', value)].add(uuid)
        athlete = known.get(uuid)
        pdob, adob = str(p.get('date_of_birth') or ''), str((athlete or {}).get('date_of_birth') or '')
        # Exclude known placeholder DOBs from the mismatch report.
        real = lambda d: bool(d) and not d.startswith('1970-01-01') and d[:4].isdigit() and int(d[:4]) < datetime.now(timezone.utc).year
        if athlete and real(pdob) and real(adob) and pdob != adob:
            dob_conflicts.append(dict(player_id=p['player_id'], trackman_name=p['name'], trackman_dob=pdob,
                athlete_uuid=uuid, athlete_name=athlete['name'], warehouse_dob=adob, match_status=p['match_status']))
    disagreements = [dict(id_type=k[0], source_id=k[1], athlete_uuids=sorted(v)) for k, v in ids.items() if len(v) > 1]
    orphans = [dict(id_type=k[0], source_id=k[1], athlete_uuid=u) for k, v in ids.items() for u in v if u not in known]
    return dict(id_disagreements=disagreements, orphaned_links=orphans, linked_dob_conflicts=dob_conflicts)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    ap.add_argument('--out', default=str(UAIS.parent / 'outputs' / f'athlete-identity-audit-{today}'))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    conn = get_warehouse_connection()
    conn.set_session(readonly=True, isolation_level='REPEATABLE READ')
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('SELECT * FROM analytics.d_athletes ORDER BY athlete_uuid')
            athletes = [dict(r) for r in cur.fetchall()]
            print(f'Loaded {len(athletes)} athlete profiles.', flush=True)
            cur.execute('SELECT * FROM analytics.source_athlete_map')
            mappings = [dict(r) for r in cur.fetchall()]
            cur.execute('SELECT player_id, name, date_of_birth, athlete_uuid, match_status, match_note, updated_at, foreign_ids, portal_id FROM pitch_intel.trackman_players')
            players = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM pitch_intel.athlete_source_links WHERE source = 'trackman'")
            links = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT tm_player_id, athlete_uuid FROM pitch_intel.trackman_pitches WHERE data_source='portal' AND athlete_uuid IS NOT NULL")
            pitch_links = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT indexdef FROM pg_indexes WHERE schemaname='analytics' AND tablename='d_athletes'")
            indexes = [r['indexdef'] for r in cur.fetchall()]
        trackman = {a['athlete_uuid'] for a in athletes if a.get('source_system') == 'trackman'}
        trackman.update(m['athlete_uuid'] for m in mappings if m['source_system'] == 'trackman')
        trackman.update(p['athlete_uuid'] for p in players if p.get('athlete_uuid'))
        trackman.update(l['athlete_uuid'] for l in links if l.get('athlete_uuid'))
        snapshot = dict(athletes=athletes, source_mappings=mappings, trackman_players=players,
                        trackman_links=links, pitch_links=pitch_links, indexes=indexes)
        (out / 'snapshot.json').write_text(json.dumps(snapshot, default=str), encoding='utf-8')
    finally:
        conn.close()
    print(f'Trackman-linked profiles: {len(trackman)}; checking identity candidates.', flush=True)
    findings = audit_pairs(athletes, trackman)
    link_audit = audit_trackman_links(athletes, mappings, players, links, pitch_links)
    (out / 'trackman-link-audit.json').write_text(json.dumps(link_audit, indent=2, default=str), encoding='utf-8')
    if findings:
        with (out / 'candidates.csv').open('w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=list(findings[0]))
            writer.writeheader()
            writer.writerows(findings)
    else:
        (out / 'candidates.csv').write_text('classification,trackman_involved,athlete_uuid_a,name_a,athlete_uuid_b,name_b,evidence\n', encoding='utf-8-sig')
    summary = dict(audited_at=datetime.now(timezone.utc).isoformat(), athlete_profiles=len(athletes),
        trackman_origin_profiles=sum(a.get('source_system') == 'trackman' for a in athletes),
        trackman_linked_profiles=len(trackman), trackman_players=len(players),
        trackman_match_status=dict(Counter(p['match_status'] for p in players)),
        candidate_pairs=len(findings), trackman_candidate_pairs=sum(f['trackman_involved'] for f in findings),
        classifications=dict(Counter(f['classification'] for f in findings)),
        trackman_classifications=dict(Counter(f['classification'] for f in findings if f['trackman_involved'])))
    summary.update({key: len(value) for key, value in link_audit.items()})
    (out / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    for f in findings:
        if f['trackman_involved'] or f['classification'] == 'strong_duplicate_candidate':
            print(f"{f['classification']}: {f['name_a']} / {f['name_b']} [{f['evidence']}]")


if __name__ == '__main__':
    main()
