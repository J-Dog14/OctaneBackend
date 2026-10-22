"""Read-only pelvic X/Z exploration. See uais/docs/pelvic_tilt_exploration.md."""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


QUERY = """
SELECT r.athlete_uuid, r.session_date, r.trial_index, r.segment_names, r.data,
       t.metrics, t.age_at_collection, t.age_group, t.handedness,
       td.frame_rate
FROM public.f_pitching_segment_rot_data r
JOIN public.f_pitching_trials t USING (athlete_uuid, session_date, trial_index)
JOIN public.f_pitching_time_data td USING (athlete_uuid, session_date, trial_index)
WHERE (%s IS NULL OR r.athlete_uuid = %s)
  AND (%s::date IS NULL OR r.session_date >= %s::date)
  AND (%s::date IS NULL OR r.session_date <= %s::date)
ORDER BY r.session_date DESC, r.athlete_uuid, r.trial_index
LIMIT %s
"""


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def event(metrics, key):
    value = metrics.get(key)
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"invalid event {key}")
    return value


def extract(row, segment, units, start_seconds=0):
    """Use cropped-relative event times, matching the force processing pipeline."""
    from python.common.age_utils import calculate_age_group, standardize_age_group

    names = decoded(row['segment_names']) or []
    matches = [i for i, name in enumerate(names) if str(name).casefold() == segment.casefold()]
    if len(matches) != 1:
        raise ValueError(f"expected one {segment!r}; available segments: {names}")
    data = decoded(row['data'])
    metrics = decoded(row['metrics']) or {}
    fps = float(row['frame_rate'] or 0)
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError('missing/invalid frame rate')
    release = event(metrics, 'TIMING.ReleaseTime.X')
    footstrike = event(metrics, 'TIMING.FootstrikeTime.X')
    if release is None:
        raise ValueError('missing TIMING.ReleaseTime.X')
    first, last = math.ceil(start_seconds * fps), round(release * fps)
    if not data or not 0 <= first < last < len(data):
        raise ValueError('start/release outside recorded frames or empty window')
    age = row['age_at_collection']
    age_group = (calculate_age_group(float(age)) if age is not None
                 else standardize_age_group(row['age_group'])) or 'UNKNOWN'
    factor = 180 / math.pi if units == 'radians' else 1
    result = []
    for frame in range(first, last + 1):
        try:
            angles = data[frame][matches[0]]
            x, z = float(angles[0]) * factor, float(angles[2]) * factor
        except (TypeError, IndexError, ValueError) as exc:
            raise ValueError(f'invalid segment data at frame {frame}') from exc
        if not all(map(math.isfinite, (x, z))):
            raise ValueError(f'nonfinite angle at frame {frame}')
        result.append(dict(athlete_uuid=row['athlete_uuid'], session_date=str(row['session_date']),
                           trial_index=row['trial_index'], age_group=age_group,
                           handedness=row['handedness'] or 'UNKNOWN', frame=frame,
                           time_s=frame / fps, time_to_release_s=(frame-last) / fps,
                           window_pct=100 * (frame-first) / (last-first),
                           pelvis_x_deg=x, pelvis_z_deg=z,
                           footstrike_s=footstrike, release_s=release))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--units', required=True, choices=['degrees', 'radians'],
                        help='Confirmed source segmentRot units; never inferred')
    parser.add_argument('--segment', default='Pelvis', help='Exact segment name, case insensitive')
    parser.add_argument('--athlete-uuid')
    parser.add_argument('--start-date')
    parser.add_argument('--end-date')
    parser.add_argument('--age-group', choices=['YOUTH', 'HIGH SCHOOL', 'COLLEGE', 'PRO', 'UNKNOWN'])
    parser.add_argument('--limit', type=int, default=100, help='Maximum joined trials inspected, newest first')
    parser.add_argument('--start-seconds', type=float, default=0,
                        help='Window start relative to cropped recording; default first recorded frame')
    parser.add_argument('--output', type=Path, default=Path('outputs/pelvic_tilt'))
    args = parser.parse_args()
    if args.limit < 1 or not math.isfinite(args.start_seconds) or args.start_seconds < 0:
        parser.error('limit must be positive and start-seconds finite and nonnegative')

    import pandas as pd
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from psycopg2.extras import RealDictCursor
    from python.common.athlete_manager import get_warehouse_connection

    params = (args.athlete_uuid, args.athlete_uuid, args.start_date, args.start_date,
              args.end_date, args.end_date, args.limit)
    conn = get_warehouse_connection()
    records, skipped = [], []
    try:
        conn.set_session(readonly=True, autocommit=False)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(QUERY, params)
            for row in cur:
                try:
                    trial = extract(row, args.segment, args.units, args.start_seconds)
                    if not args.age_group or trial[0]['age_group'] == args.age_group:
                        records.extend(trial)
                except (ValueError, TypeError, KeyError) as exc:
                    skipped.append(dict(athlete_uuid=row['athlete_uuid'],
                                        session_date=str(row['session_date']), trial_index=row['trial_index'],
                                        reason=str(exc)))
    finally:
        conn.rollback()
        conn.close()
    args.output.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(skipped, columns=['athlete_uuid', 'session_date', 'trial_index', 'reason']).to_csv(
        args.output / 'skipped_trials.csv', index=False)
    if not records:
        raise SystemExit('No valid matching trials. Check filters and skipped_trials.csv.')
    df = pd.DataFrame(records)
    df.to_csv(args.output / 'pelvis_frames.csv', index=False)
    keys = ['athlete_uuid', 'session_date', 'trial_index']
    counts = df.drop_duplicates(keys).groupby(['age_group', 'handedness']).agg(
        trials=('trial_index', 'size'), athletes=('athlete_uuid', 'nunique'))
    counts.to_csv(args.output / 'cohort_counts.csv')
    for (group, hand), cohort in df.groupby(['age_group', 'handedness']):
        fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                            subplot_titles=('Pelvis X (tilt candidate)', 'Pelvis Z (rotation candidate)'))
        for key, trial in cohort.groupby(keys):
            label = f'{key[0]} / {key[1]} / trial {key[2]}'
            for panel, column in enumerate(['pelvis_x_deg', 'pelvis_z_deg'], 1):
                fig.add_trace(go.Scatter(x=trial.time_to_release_s, y=trial[column],
                              mode='lines', name=label, legendgroup=label, showlegend=panel == 1,
                              hovertemplate='%{x:.3f} s to release<br>%{y:.2f} deg'), row=panel, col=1)
                fc = trial.footstrike_s.iloc[0]
                if pd.notna(fc) and trial.time_s.iloc[0] <= fc <= trial.time_s.iloc[-1]:
                    idx = (trial.time_s - fc).abs().idxmin()
                    fig.add_trace(go.Scatter(x=[trial.loc[idx, 'time_to_release_s']],
                                  y=[trial.loc[idx, column]], mode='markers', marker=dict(symbol='x'),
                                  name='Footstrike: ' + label, showlegend=False), row=panel, col=1)
        fig.add_vline(x=0, line_dash='dash')
        fig.update_yaxes(title_text='Degrees (source sign)')
        fig.update_xaxes(title_text='Seconds relative to ball release', row=2, col=1)
        fig.update_layout(title=f'{group} / {hand}: pelvis X and Z | first recorded frame to release',
                          height=800)
        safe_name = ''.join(c if c.isalnum() else '_' for c in f'{group}_{hand}')
        fig.write_html(args.output / f'{safe_name}.html', include_plotlyjs=True)
    print(f'Exported {len(df.drop_duplicates(keys))} trials; skipped {len(skipped)}. Output: {args.output}')


if __name__ == '__main__':
    main()
