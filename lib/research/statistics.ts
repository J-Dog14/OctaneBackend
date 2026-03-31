/**
 * Statistical computations for the Research page.
 * All functions operate on paired arrays of numbers [xs, ys].
 */

export type RegressionResult = {
  slope: number;
  intercept: number;
  equation: string;
};

export type PolyRegressionResult = {
  /** Coefficients [a, b, c] for y = a + bx + cx² */
  coefficients: [number, number, number];
  equation: string;
};

export type StatisticsResult = {
  n: number;
  /** Pearson product-moment correlation coefficient */
  pearsonR: number | null;
  /** Coefficient of determination (r²) */
  rSquared: number | null;
  /** Two-tailed p-value for Pearson r */
  pValue: number | null;
  /** Lower bound of 95% CI for Pearson r (Fisher z-transform) */
  ci95Low: number | null;
  /** Upper bound of 95% CI for Pearson r */
  ci95High: number | null;
  /** Spearman rank-order correlation */
  spearmanRho: number | null;
  /** Two-tailed p-value for Spearman ρ */
  spearmanP: number | null;
  /** Simple linear regression */
  regression: RegressionResult | null;
  /** Degree-2 polynomial regression */
  polyRegression: PolyRegressionResult | null;
  /** Standard error of the estimate (residual std dev) */
  standardError: number | null;
  meanX: number | null;
  meanY: number | null;
  sdX: number | null;
  sdY: number | null;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sampleStdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0;
  const m = mu ?? mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

/** Assign ranks with tie-averaging (1-indexed) */
function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2; // e.g. positions 0,1,2 → ranks 1,2,3 → avg of tied = (pos0+posLast+2)/2
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17) */
function normalCDF(z: number): number {
  const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937, a4 = -1.821255978, a5 = 1.330274429;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  const p = 1 - 0.39894228 * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
}

/** Approximate two-tailed p-value from t-statistic with df degrees of freedom */
function tPValue(t: number, df: number): number {
  if (!isFinite(t) || df <= 0) return 1;
  if (df >= 30) {
    // Normal approximation is accurate enough
    return 2 * (1 - normalCDF(Math.abs(t)));
  }
  // Cornish-Fisher adjustment for small df
  const adjusted = Math.abs(t) * (1 - (t * t - 1) / (4 * df));
  return Math.max(0, Math.min(1, 2 * (1 - normalCDF(adjusted))));
}

/** Round to n decimal places; returns null for non-finite */
function round(v: number | null | undefined, places = 4): number | null {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Fit degree-2 polynomial y = a + bx + cx² via normal equations (3×3 Cramer's rule).
 * Returns null-tuple if matrix is singular.
 */
function polyFit2(xs: number[], ys: number[]): [number, number, number] | null {
  const n = xs.length;
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], x2 = x * x;
    s1 += x; s2 += x2; s3 += x * x2; s4 += x2 * x2;
    t0 += y; t1 += x * y; t2 += x2 * y;
  }
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-12) return null;
  const a = (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)) / det;
  const b = (s0 * (t1 * s4 - s3 * t2) - t0 * (s1 * s4 - s3 * s2) + s2 * (s1 * t2 - s2 * t1)) / det;
  const c = (s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2)) / det;
  return [a, b, c];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute all statistics for paired arrays xs and ys.
 * Both arrays must have the same length and no NaN/null values.
 */
export function computeStatistics(xs: number[], ys: number[]): StatisticsResult {
  const n = xs.length;
  const emptyResult: StatisticsResult = {
    n,
    pearsonR: null,
    rSquared: null,
    pValue: null,
    ci95Low: null,
    ci95High: null,
    spearmanRho: null,
    spearmanP: null,
    regression: null,
    polyRegression: null,
    standardError: null,
    meanX: n > 0 ? round(mean(xs)) : null,
    meanY: n > 0 ? round(mean(ys)) : null,
    sdX: null,
    sdY: null,
  };
  if (n < 3) return emptyResult;

  const mx = mean(xs);
  const my = mean(ys);
  const sx = sampleStdDev(xs, mx);
  const sy = sampleStdDev(ys, my);
  const cov = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / (n - 1);

  // ── Pearson r ────────────────────────────────────────────────────────────
  const r = sx === 0 || sy === 0 ? null : cov / (sx * sy);
  const r2 = r !== null ? r * r : null;

  // ── p-value for r ────────────────────────────────────────────────────────
  let pValue: number | null = null;
  if (r !== null) {
    if (Math.abs(r) >= 1) {
      pValue = 0;
    } else {
      const tStat = r * Math.sqrt(n - 2) / Math.sqrt(1 - r * r);
      pValue = tPValue(tStat, n - 2);
    }
  }

  // ── 95% CI via Fisher z-transform ────────────────────────────────────────
  let ci95Low: number | null = null;
  let ci95High: number | null = null;
  if (r !== null && n >= 4 && Math.abs(r) < 1) {
    const z = 0.5 * Math.log((1 + r) / (1 - r));
    const se = 1 / Math.sqrt(n - 3);
    const zLo = z - 1.96 * se;
    const zHi = z + 1.96 * se;
    ci95Low  = round((Math.exp(2 * zLo) - 1) / (Math.exp(2 * zLo) + 1));
    ci95High = round((Math.exp(2 * zHi) - 1) / (Math.exp(2 * zHi) + 1));
  }

  // ── Linear regression ────────────────────────────────────────────────────
  let regression: RegressionResult | null = null;
  if (sx !== 0) {
    const slope     = cov / (sx * sx);
    const intercept = my - slope * mx;
    const signStr   = intercept >= 0 ? '+ ' : '- ';
    regression = {
      slope,
      intercept,
      equation: `y = ${round(slope, 4)}x ${signStr}${round(Math.abs(intercept), 4)}`,
    };
  }

  // ── Standard error of estimate ───────────────────────────────────────────
  let standardError: number | null = null;
  if (regression && n >= 3) {
    const sse = xs.reduce((acc, x, i) => {
      const yhat = regression!.slope * x + regression!.intercept;
      return acc + (ys[i] - yhat) ** 2;
    }, 0);
    standardError = Math.sqrt(sse / (n - 2));
  }

  // ── Polynomial regression (degree 2) ─────────────────────────────────────
  let polyRegression: PolyRegressionResult | null = null;
  if (n >= 5) {
    const fit = polyFit2(xs, ys);
    if (fit) {
      const [a, b, c] = fit;
      const signB = b >= 0 ? '+ ' : '- ';
      const signC = c >= 0 ? '+ ' : '- ';
      polyRegression = {
        coefficients: [a, b, c],
        equation: `y = ${round(a, 4)} ${signB}${round(Math.abs(b), 4)}x ${signC}${round(Math.abs(c), 4)}x²`,
      };
    }
  }

  // ── Spearman ρ ───────────────────────────────────────────────────────────
  const xRanks = rankArray(xs);
  const yRanks = rankArray(ys);
  const mxr    = mean(xRanks);
  const myr    = mean(yRanks);
  const sxr    = sampleStdDev(xRanks, mxr);
  const syr    = sampleStdDev(yRanks, myr);
  const covR   = xRanks.reduce((acc, xr, i) => acc + (xr - mxr) * (yRanks[i] - myr), 0) / (n - 1);
  const rho    = sxr === 0 || syr === 0 ? null : covR / (sxr * syr);

  let spearmanP: number | null = null;
  if (rho !== null && Math.abs(rho) < 1) {
    const tStat = rho * Math.sqrt(n - 2) / Math.sqrt(1 - rho * rho);
    spearmanP = tPValue(tStat, n - 2);
  }

  return {
    n,
    pearsonR:     round(r),
    rSquared:     round(r2),
    pValue:       pValue !== null ? round(pValue, 5) : null,
    ci95Low,
    ci95High,
    spearmanRho:  round(rho),
    spearmanP:    spearmanP !== null ? round(spearmanP, 5) : null,
    regression,
    polyRegression,
    standardError: standardError !== null ? round(standardError) : null,
    meanX: round(mx),
    meanY: round(my),
    sdX:   round(sx),
    sdY:   round(sy),
  };
}

/**
 * Generate trendline points for display on a scatter chart.
 * Returns an array of {x, y} points to draw the trendline.
 */
export function generateTrendlinePoints(
  xs: number[],
  regression: RegressionResult | null,
  polyRegression: PolyRegressionResult | null,
  mode: 'linear' | 'polynomial',
  steps = 80,
): Array<{ x: number; y: number }> {
  if (xs.length < 2) return [];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  if (mode === 'linear' && regression) {
    return [
      { x: minX, y: regression.slope * minX + regression.intercept },
      { x: maxX, y: regression.slope * maxX + regression.intercept },
    ];
  }

  if (mode === 'polynomial' && polyRegression) {
    const [a, b, c] = polyRegression.coefficients;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const x = minX + ((maxX - minX) * i) / steps;
      pts.push({ x, y: a + b * x + c * x * x });
    }
    return pts;
  }

  return [];
}
