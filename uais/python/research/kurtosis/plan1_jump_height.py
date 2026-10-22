#!/usr/bin/env python3
"""
Kurtosis study - Plan 1: what drives jump height in each screen movement,
and where kurtosis sits in that picture.

Input : tmp/kurtosis_study/screen_{cmj,dj,ppu,slv}.csv  (from export_kurtosis_data.py)
Output: tmp/kurtosis_study/plan1/*.csv  +  plan1_summary.md

Three lenses per movement:
  1. BETWEEN athletes  - each athlete's first session, trials averaged.
                         "Do athletes who have more X jump higher?"
  2. WITHIN athlete    - trial values centred on the athlete-session mean.
                         "On a trial where X is higher than his norm, does he jump higher?"
                         Body size, age and strength cancel out here.
  3. KURTOSIS block    - kurtosis vs JH (linear + inverted-U check), vs every metric,
                         vs window/timing proxies (artifact check), and JH by kurtosis quartile.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

REPO = Path(__file__).resolve().parents[4]
IN = REPO / "tmp" / "kurtosis_study"
if len(sys.argv) > 1:
    IN = Path(sys.argv[1])
OUT = IN / "plan1"

ID = ["athlete_uuid", "session_date", "trial_name", "side"]
META = ["id", "source_system", "source_athlete_id", "age_group", "created_at", "demographic",
        "gender", "athlete_height", "athlete_weight", "age_at_collection"]
TARGET = "jh_in"
SHAPE = ["skewness", "kurtosis", "spectral_centroid_hz"]


def fdr(p):
    p = np.asarray(p, float); ok = np.isfinite(p); q = np.full_like(p, np.nan)
    if ok.sum():
        ps = p[ok]; o = np.argsort(ps); r = ps[o] * ok.sum() / (np.arange(ok.sum()) + 1)
        r = np.minimum.accumulate(r[::-1])[::-1]; tmp = np.empty_like(r); tmp[o] = np.minimum(r, 1); q[ok] = tmp
    return q


def resid(y, X):
    X = np.column_stack([np.ones(len(y)), X]); beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return y - X @ beta


def corr_row(x, y, cov=None):
    m = x.notna() & y.notna()
    if cov is not None:
        m &= cov.notna().all(axis=1)
    n = int(m.sum())
    if n < 10 or x[m].nunique() < 3:
        return dict(n=n)
    r, p = stats.pearsonr(x[m], y[m]); rho, ps = stats.spearmanr(x[m], y[m])
    out = dict(n=n, pearson_r=r, pearson_p=p, spearman_rho=rho, spearman_p=ps)
    if cov is not None:
        rx = resid(stats.rankdata(x[m]), np.column_stack([stats.rankdata(c) for c in cov[m].T.values]))
        ry = resid(stats.rankdata(y[m]), np.column_stack([stats.rankdata(c) for c in cov[m].T.values]))
        out["partial_rho"], out["partial_p"] = stats.pearsonr(rx, ry)
    return out


def load(mv):
    df = pd.read_csv(IN / f"screen_{mv}.csv")
    if "side" not in df:
        df["side"] = "both"
    df["side"] = df["side"].fillna("both")
    for c in df.columns:
        if c not in ID + ["age_group", "gender", "demographic", "source_system", "created_at"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    # derived
    df["body_mass_kg"] = df["pp_forceplate"] / df["pp_w_per_kg"]
    df["rpd_10_90_w_per_s"] = 0.8 * df["peak_power_w"] / df["rise_time_10_90_s"]
    df = df[df[TARGET] > 0].copy()
    metrics = [c for c in df.columns if c not in ID + META + [TARGET] and df[c].dtype.kind in "fi"
               and c != "body_mass_kg"]
    # robust outlier screen per metric (|robust z| > 6 -> NaN), keeps rows
    for c in metrics + [TARGET]:
        med = df[c].median(); mad = (df[c] - med).abs().median() * 1.4826
        if mad and np.isfinite(mad):
            df.loc[((df[c] - med) / mad).abs() > 6, c] = np.nan
    return df, metrics


def between(df, metrics):
    g = df.groupby(["athlete_uuid", "session_date", "side"], as_index=False)
    s = g[[TARGET] + metrics + ["body_mass_kg", "age_at_collection"]].mean()
    first = s.sort_values("session_date").groupby(["athlete_uuid", "side"]).head(1)
    first = first.groupby("athlete_uuid").mean(numeric_only=True)   # SLV: average L/R
    cov = first[["body_mass_kg"]]
    rows = [dict(metric=m, **corr_row(first[m], first[TARGET], cov)) for m in metrics]
    t = pd.DataFrame(rows)
    t["spearman_q"] = fdr(t.get("spearman_p", np.nan))
    return t.sort_values("spearman_rho", key=lambda x: -x.abs()), first


def within(df, metrics):
    key = ["athlete_uuid", "session_date", "side"]
    cnt = df.groupby(key)[TARGET].transform("count")
    d = df[cnt >= 2].copy()
    cols = [TARGET] + metrics
    d[cols] = d[cols] - d.groupby(key)[cols].transform("mean")
    rows = [dict(metric=m, **corr_row(d[m], d[TARGET])) for m in metrics]
    t = pd.DataFrame(rows)
    t["spearman_q"] = fdr(t.get("spearman_p", np.nan))
    return t.sort_values("spearman_rho", key=lambda x: -x.abs()), d


def kurtosis_block(first, d_within, metrics):
    k = "kurtosis"; out = {}
    m = first[[k, TARGET]].dropna()
    if len(m) >= 15:
        lin = np.polyfit(m[k], m[TARGET], 1); quad = np.polyfit(m[k], m[TARGET], 2)
        ss = ((m[TARGET] - m[TARGET].mean()) ** 2).sum()
        r2l = 1 - ((m[TARGET] - np.polyval(lin, m[k])) ** 2).sum() / ss
        r2q = 1 - ((m[TARGET] - np.polyval(quad, m[k])) ** 2).sum() / ss
        vertex = -quad[1] / (2 * quad[0]) if quad[0] != 0 else np.nan
        out["fit"] = dict(n=len(m), r2_linear=r2l, r2_quadratic=r2q, quad_vertex_kurtosis=vertex,
                          quad_shape="inverted-U" if quad[0] < 0 else "U")
        first = first.copy()
        first["kurt_quartile"] = pd.qcut(first[k], 4, labels=["Q1 low", "Q2", "Q3", "Q4 high"])
        out["quartiles"] = first.groupby("kurt_quartile", observed=True)[[k, TARGET] + [
            c for c in ["peak_power_w", "pp_w_per_kg", "vel_at_pp", "force_at_pp", "rpd_max_w_per_s",
                        "rise_time_10_90_s", "fwhm_s", "time_to_peak_s", "work_early_pct",
                        "t_com_norm_0to1", "skewness", "ct", "rsi"] if c in first]].agg(["mean", "count"])
    vs_b = pd.DataFrame([dict(metric=c, **corr_row(first[c], first[k])) for c in metrics + [TARGET] if c != k])
    vs_w = pd.DataFrame([dict(metric=c, **corr_row(d_within[c], d_within[k])) for c in metrics + [TARGET] if c != k])
    out["vs_between"] = vs_b.sort_values("spearman_rho", key=lambda x: -x.abs())
    out["vs_within"] = vs_w.sort_values("spearman_rho", key=lambda x: -x.abs())
    return out


def fmt(t, n=10, cols=("metric", "n", "spearman_rho", "spearman_q", "partial_rho")):
    cols = [c for c in cols if c in t]
    return t[cols].head(n).to_markdown(index=False, floatfmt=".3f")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    md = ["# Plan 1 - jump height correlates and kurtosis\n",
          "Between = each athlete's first session (trials averaged; SLV sides averaged). "
          "partial_rho controls for body mass. Within = trial deviations from the athlete-session mean.\n",
          "Note: stored `kurtosis` is value-distribution kurtosis over the whole Power.txt window "
          "(see shape.py docstring) - read its rows with that in mind.\n"]
    for mv in ["cmj", "dj", "ppu", "slv"]:
        f = IN / f"screen_{mv}.csv"
        if not f.exists():
            continue
        df, metrics = load(mv)
        b, first = between(df, metrics); w, dw = within(df, metrics)
        kb = kurtosis_block(first, dw, metrics)
        b.to_csv(OUT / f"{mv}_between_vs_jh.csv", index=False)
        w.to_csv(OUT / f"{mv}_within_vs_jh.csv", index=False)
        kb["vs_between"].to_csv(OUT / f"{mv}_kurtosis_vs_metrics_between.csv", index=False)
        kb["vs_within"].to_csv(OUT / f"{mv}_kurtosis_vs_metrics_within.csv", index=False)
        md += [f"\n## {mv.upper()}  (athletes={first.shape[0]}, trials={len(df)})\n",
               "### Top correlates of JH - between athletes\n", fmt(b),
               "\n### Top correlates of JH - within athlete\n", fmt(w),
               "\n### Kurtosis vs other metrics - between\n", fmt(kb["vs_between"]),
               "\n### Kurtosis vs other metrics - within\n", fmt(kb["vs_within"])]
        if "fit" in kb:
            md += ["\n### Kurtosis -> JH shape\n", pd.DataFrame([kb["fit"]]).to_markdown(index=False, floatfmt=".3f"),
                   "\n### By kurtosis quartile (between)\n", kb["quartiles"].round(3).to_markdown()]
            kb["quartiles"].to_csv(OUT / f"{mv}_kurtosis_quartiles.csv")
    (OUT / "plan1_summary.md").write_text("\n".join(md), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
