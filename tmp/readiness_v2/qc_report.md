# Readiness Screen v2 scan - 2026-10-28 15:51

Session folders seen: 830

```
st            ok  skipped
source_root              
AS2          301      386
RS3          143        0
```

Skip reasons:

```
                                                       n
status                                                  
skipped: no Readiness Screen session in session.xml  386
```

Readiness sessions: 444 (197 athlete folders), 2024-09-24 -> 2026-10-20
Athlete/date pairs present in both roots: 0
Session body-weight source: {'session_cmj_quiet': 222, 'impulse_from_start': 91, 'none': 82, 'same_day_other_session': 49}

## CMJ: 564 trials, 159 athletes
- QC flags: {'bw_from_entered_mass': 75, 'v_quiet_resid_gt_0.15': 68, 'plate_offset_gt_15N': 20, 'plate_bw_vs_entered_mass_gt_8pct': 16, 'bw_impulse_vs_quiet_gt_2pct': 4}
- body weight source: {'trial_quiet': 287, 'session_bw': 199, 'entered_mass': 75, 'trial_post_landing_quiet': 3}
- JH median 17.9 in; PP W/kg median 61.1 (IQR 55.5-64.9)
- vel@PP / takeoff velocity median 0.94 (expect ~0.9-0.97)

## PPU: 562 trials, 159 athletes
- QC flags: {'ppu_point_mass_model': 562, 'ppu_no_quiet_window': 273, 'plate_offset_gt_15N': 12}
- body weight source: {'trial_quiet': 289, 'ppu_first_50ms': 273}
- JH median 4.1 in; PP W/kg median 24.6 (IQR 21.7-28.5)

## ISO: 1264 trials, 187 athletes
- QC flags: {'max_at_file_end': 70, 'lt_3s_after_push': 43, 'no_quiet_lead_in': 35, 'push_at_file_start': 34, 'plate_offset_gt_10N': 32}
- I: n=219, max force median 125.0 N, time to max median 2.14 s, |offset| median 1.3 N, |corrected-raw max| median 1.3 N
- IR90: n=414, max force median 135.5 N, time to max median 2.22 s, |offset| median 1.1 N, |corrected-raw max| median 1.1 N
- T: n=215, max force median 90.5 N, time to max median 2.12 s, |offset| median 1.1 N, |corrected-raw max| median 1.1 N
- Y: n=416, max force median 111.9 N, time to max median 1.95 s, |offset| median 1.1 N, |corrected-raw max| median 1.1 N

Trial errors: 2

```
                                                 n
error                                             
no plate loaded (max Fz < 200 N on every plate)  2
```