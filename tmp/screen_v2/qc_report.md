# Athletic Screen v2 scan - 2026-10-21 13:14

Session folders found: 684

```
         sessions
status           
skipped       474
ok            210
```

## CMJ: 420 trials, 192 athletes
- body weight source: {'trial_quiet': 194, 'session_bw': 176, 'entered_mass': 50}
- QC flags: {'v_quiet_resid_gt_0.15': 55, 'bw_from_entered_mass': 50, 'plate_bw_vs_entered_mass_gt_8pct': 27, 'bw_impulse_vs_quiet_gt_2pct': 6, 'plate_offset_gt_15N': 2}
- vel@PP / takeoff velocity: median 0.94 (should be ~0.9-0.97)
- PP W/kg median 60.0  (IQR 53.8-65.3)
- quiet-start velocity residual |median| 0.075 m/s (n=194)

## DJ: 611 trials, 191 athletes
- body weight source: {'session_bw': 537, 'entered_mass': 74}
- QC flags: {'bw_from_entered_mass': 74, 'dj_implied_drop_vs_box_gt_10cm': 67, 'plate_bw_vs_entered_mass_gt_8pct': 40, 'dj_contact_start_not_in_file': 6, 'plate_offset_gt_15N': 3}
- vel@PP / takeoff velocity: median 0.91 (should be ~0.9-0.97)
- PP W/kg median 70.3  (IQR 62.2-78.4)
- implied drop height median 28 cm (IQR 24-31)

## PPU: 405 trials, 187 athletes
- body weight source: {'ppu_first_50ms': 221, 'trial_quiet': 184}
- QC flags: {'ppu_point_mass_model': 405, 'ppu_no_quiet_window': 221, 'plate_offset_gt_15N': 4}
- PP W/kg median 23.7  (IQR 20.7-26.9)
- quiet-start velocity residual |median| 0.422 m/s (n=184)

## SLV: 814 trials, 191 athletes
- body weight source: {'trial_quiet': 403, 'session_bw': 313, 'entered_mass': 98}
- QC flags: {'v_quiet_resid_gt_0.15': 198, 'bw_from_entered_mass': 98, 'plate_bw_vs_entered_mass_gt_8pct': 58, 'bw_impulse_vs_quiet_gt_2pct': 50, 'plate_offset_gt_15N': 4}
- vel@PP / takeoff velocity: median 0.95 (should be ~0.9-0.97)
- PP W/kg median 42.4  (IQR 38.1-47.0)
- quiet-start velocity residual |median| 0.147 m/s (n=403)

Plate BW vs entered mass: median +0.0%, >5% off in 26 sessions

Trial errors: 7

```
                                                       n
error                                                   
TrialError: contact before takeoff shorter than 50 ms  3
Fz mostly NaN                                          2
TrialError: no flight phase found                      2
```