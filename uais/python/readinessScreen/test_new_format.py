"""
Smoke tests for the updated readiness screen CMJ/PPU intake.
Tests parsing, file discovery, and power curve analysis against
the new 5-column file format — no database calls.

Run from repo root:
    python uais/python/readinessScreen/test_new_format.py
"""
import os
import sys
import tempfile
import textwrap
from pathlib import Path

# Wire up the same sys.path that main.py uses
_here = Path(__file__).resolve()
_python_dir = _here.parent.parent  # uais/python
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

from readinessScreen.file_parsers import (
    find_cmj_ppu_trial_files,
    parse_txt_file,
    extract_name,
    extract_date,
)
from athleticScreen.power_analysis import load_power_txt, analyze_power_curve_advanced

# ---------------------------------------------------------------------------
# Sample file content (matches the files shared in the session)
# ---------------------------------------------------------------------------

CMJ1_TXT = textwrap.dedent("""\
\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d
\tJH_IN\tPP_FORCEPLATE\tForce@PP\tVel@PP\tPP_W_per_kg
\tMETRIC\tMETRIC\tMETRIC\tMETRIC\tMETRIC
\tPROCESSED\tPROCESSED\tPROCESSED\tPROCESSED\tPROCESSED
ITEM\tX\tX\tX\tX\tX
1\t15.7\t374.8\t1648.02\t227.40\t4.47
""")

PPU1_TXT = textwrap.dedent("""\
\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\PPU 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\PPU 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\PPU 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\PPU 1.c3d\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\PPU 1.c3d
\tJH_IN\tPP_FORCEPLATE\tForce@PP\tVel@PP\tPP_W_per_kg
\tMETRIC\tMETRIC\tMETRIC\tMETRIC\tMETRIC
\tPROCESSED\tPROCESSED\tPROCESSED\tPROCESSED\tPROCESSED
ITEM\tX\tX\tX\tX\tX
1\t5.9\t698.0\t733.22\t951.90\t8.32
""")

# First 20 rows of CMJ1_Power.txt (enough to exercise the curve analysis)
CMJ1_POWER_TXT = textwrap.dedent("""\
\tD:\\Athletic Screen 2.0\\Data\\Trevor Cleavland_TC\\2026-05-06__2\\CMJ 1.c3d
\tPowZ
\tDERIVED
\tPROCESSED
ITEM\tX
1\t0.00000
2\t-0.00609
3\t-0.01170
4\t-0.01902
5\t-0.02622
6\t-0.03221
7\t-0.03917
8\t-0.04587
9\t-0.05238
10\t-0.05855
11\t-0.06555
12\t-0.07305
13\t-0.08075
14\t-0.08856
15\t-0.09668
16\t-0.10594
17\t-0.11638
18\t-0.12557
19\t-0.13432
20\t-0.14385
""")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f"  ok  {msg}")


def fail(msg, detail=""):
    global FAIL
    FAIL += 1
    print(f"  FAIL  {msg}" + (f": {detail}" if detail else ""))


def assert_eq(label, got, expected):
    if got == expected:
        ok(f"{label} == {expected!r}")
    else:
        fail(label, f"got {got!r}, expected {expected!r}")


def assert_approx(label, got, expected, tol=0.01):
    if got is not None and abs(got - expected) <= tol:
        ok(f"{label} ~= {expected}")
    else:
        fail(label, f"got {got!r}, expected ≈ {expected}")


def assert_not_none(label, got):
    if got is not None:
        ok(f"{label} is not None")
    else:
        fail(label, "got None")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_file_discovery(tmp_dir):
    print("\n[1] find_cmj_ppu_trial_files")
    result = find_cmj_ppu_trial_files(tmp_dir)
    assert_eq("CMJ file count", len(result["CMJ"]), 1)
    assert_eq("PPU file count", len(result["PPU"]), 1)
    assert_eq("CMJ[0] basename", os.path.basename(result["CMJ"][0]), "CMJ1.txt")
    assert_eq("PPU[0] basename", os.path.basename(result["PPU"][0]), "PPU1.txt")
    # Power files must NOT appear
    all_found = result["CMJ"] + result["PPU"]
    power_leaked = [f for f in all_found if "_Power" in f or "_power" in f]
    assert_eq("No _Power files in discovery", len(power_leaked), 0)


def test_cmj_parse(tmp_dir):
    print("\n[2] parse_txt_file — CMJ1.txt")
    path = os.path.join(tmp_dir, "CMJ1.txt")
    d = parse_txt_file(path, "CMJ")
    assert_not_none("parse returned data", d)
    assert_eq("name", d["name"], "Trevor Cleavland_TC")
    assert_eq("date", d["date"], "2026-05-06")
    assert_eq("movement_type", d["movement_type"], "CMJ")
    assert_eq("trial_name", d["trial_name"], "CMJ1")
    assert_approx("JH_IN", d["JH_IN"], 15.7)
    assert_approx("PP_FORCEPLATE", d["PP_FORCEPLATE"], 374.8)
    assert_approx("Force_at_PP", d["Force_at_PP"], 1648.02)
    assert_approx("Vel_at_PP", d["Vel_at_PP"], 227.40)
    assert_approx("PP_W_per_kg", d["PP_W_per_kg"], 4.47)
    # Old columns must NOT exist
    assert_eq("no LEWIS_PEAK_POWER key", "LEWIS_PEAK_POWER" in d, False)
    assert_eq("no Max_Force key", "Max_Force" in d, False)


def test_ppu_parse(tmp_dir):
    print("\n[3] parse_txt_file — PPU1.txt")
    path = os.path.join(tmp_dir, "PPU1.txt")
    d = parse_txt_file(path, "PPU")
    assert_not_none("parse returned data", d)
    assert_eq("name", d["name"], "Trevor Cleavland_TC")
    assert_eq("trial_name", d["trial_name"], "PPU1")
    assert_approx("JH_IN", d["JH_IN"], 5.9)
    assert_approx("PP_FORCEPLATE", d["PP_FORCEPLATE"], 698.0)
    assert_approx("Force_at_PP", d["Force_at_PP"], 733.22)
    assert_approx("Vel_at_PP", d["Vel_at_PP"], 951.90)
    assert_approx("PP_W_per_kg", d["PP_W_per_kg"], 8.32)


def test_power_file(tmp_dir):
    print("\n[4] load_power_txt + analyze_power_curve_advanced — CMJ1_Power.txt")
    path = os.path.join(tmp_dir, "CMJ1_Power.txt")
    power_data = load_power_txt(path)
    assert_eq("sample count", len(power_data), 20)

    pa = analyze_power_curve_advanced(power_data, fs_hz=1000.0)
    # With only 20 samples of decreasing negative values, peak_power_w will be
    # the maximum (least negative) value = 0.0 at sample 1
    assert_not_none("pa dict returned", pa)
    # Check all expected keys are present
    expected_keys = [
        "peak_power_w", "time_to_peak_s", "rise_time_10_90_s", "rise_slope_w_per_s",
        "fwhm_s", "auc_j", "t_com_s", "t_com_norm_0to1", "cv_local_peak",
        "rpd_max_w_per_s", "time_to_rpd_max_s", "auc_pre_j", "auc_post_j",
        "work_early_pct", "decay_90_10_s", "skewness", "kurtosis", "spectral_centroid_hz",
    ]
    for key in expected_keys:
        if key in pa:
            ok(f"key present: {key}")
        else:
            fail(f"missing key: {key}")


def test_power_file_naming(tmp_dir):
    print("\n[5] Power file naming — trial_name matches discovery")
    cmj_files = find_cmj_ppu_trial_files(tmp_dir)["CMJ"]
    for trial_id, fp in enumerate(cmj_files, start=1):
        trial_name = os.path.splitext(os.path.basename(fp))[0]  # "CMJ1"
        power_file = os.path.join(tmp_dir, f"{trial_name}_Power.txt")
        assert_eq(f"CMJ trial {trial_id} power file exists", os.path.exists(power_file), True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Write sample files
        for fname, content in [
            ("CMJ1.txt", CMJ1_TXT),
            ("PPU1.txt", PPU1_TXT),
            ("CMJ1_Power.txt", CMJ1_POWER_TXT),
        ]:
            with open(os.path.join(tmp_dir, fname), "w", encoding="utf-8") as f:
                f.write(content)

        test_file_discovery(tmp_dir)
        test_cmj_parse(tmp_dir)
        test_ppu_parse(tmp_dir)
        test_power_file(tmp_dir)
        test_power_file_naming(tmp_dir)

    print(f"\n{'='*50}")
    if FAIL == 0:
        print(f"ALL {PASS} TESTS PASSED.")
    else:
        print(f"{PASS} passed, {FAIL} FAILED.")
    return FAIL


if __name__ == "__main__":
    sys.exit(main())
