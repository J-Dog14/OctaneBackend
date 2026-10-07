/* ==================== MLB SHAPE-MATCHED BASELINES & COMPS ====================
   Shared by app.js (single/multi-start CSV tool) and athletes-v2.js (athlete
   profile dashboard). Instead of comparing a pitch to the flat MLB average
   for its pitch type, this matches on velo + movement + release point:
     - matchShapeCluster(): nearest MLB "shape cluster" for baseline stats
     - findPitchComps(): actual MLB pitchers with the closest single pitch
     - findArsenalComps(): actual MLB pitchers with the closest whole arsenal
*/

let SHAPE_BASELINES = {};
let PITCHER_COMPS = {};

fetch('shape_baselines.json')
  .then(r => r.json())
  .then(data => { SHAPE_BASELINES = data; })
  .catch(() => { console.warn('shape_baselines.json not found — shape-matched comparisons unavailable.'); });

fetch('pitcher_comps.json')
  .then(r => r.json())
  .then(data => { PITCHER_COMPS = data; })
  .catch(() => { console.warn('pitcher_comps.json not found — MLB comps unavailable.'); });

const SHAPE_FEATURES = ['velo', 'hb_norm', 'vb', 'side_norm', 'height', 'ext'];
// For data where release point wasn't saved (e.g. historical athlete-profile
// outings imported before release point tracking existed) — velo + movement
// still gives a meaningful comp, just without release-slot precision.
const REDUCED_FEATURES = ['velo', 'hb_norm', 'vb'];

// Normalizes a raw pitch into the handedness-normalized feature space the
// clusters/comps were built in. relX/relZ/ext may be omitted (null) when
// only reduced-feature matching is available.
function normalizeShape(throws, velo, hb, vb, relX = null, relZ = null, ext = null) {
  const sign = throws === 'L' ? -1 : 1;
  return {
    velo, hb_norm: hb * sign, vb,
    side_norm: relX != null ? relX * sign : null,
    height: relZ, ext
  };
}

function zDist(a, b, mean, scale, features = SHAPE_FEATURES) {
  let d = 0;
  for (const f of features) {
    const za = (a[f] - mean[f]) / scale[f];
    const zb = (b[f] - mean[f]) / scale[f];
    d += (za - zb) ** 2;
  }
  return Math.sqrt(d);
}

// Nearest MLB cluster for a single pitch — returns { n, centroid, metrics } or null.
function matchShapeCluster(pt, throws, velo, hb, vb, relX, relZ, ext, features = SHAPE_FEATURES) {
  const norm = pt === 'FA' ? 'FF' : pt;
  const data = SHAPE_BASELINES[norm];
  if (!data || [velo, hb, vb].some(v => v == null || isNaN(v))) return null;
  const feat = normalizeShape(throws, velo, hb, vb, relX, relZ, ext);
  let best = null, bestDist = Infinity;
  for (const c of data.clusters) {
    const dist = zDist(feat, c.centroid, data.scaler_mean, data.scaler_scale, features);
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best;
}

// Actual MLB pitchers whose SAME pitch type most closely matches this one pitch.
function findPitchComps(pt, throws, velo, hb, vb, relX, relZ, ext, topN = 3, features = SHAPE_FEATURES) {
  const norm = pt === 'FA' ? 'FF' : pt;
  const scaler = SHAPE_BASELINES[norm];
  if (!scaler || [velo, hb, vb].some(v => v == null || isNaN(v))) return [];
  const feat = normalizeShape(throws, velo, hb, vb, relX, relZ, ext);
  const results = [];
  for (const p of Object.values(PITCHER_COMPS)) {
    const ap = p.arsenal[norm];
    if (!ap) continue;
    const dist = zDist(feat, ap, scaler.scaler_mean, scaler.scaler_scale, features);
    results.push({ name: p.name, throws: p.throws, n: ap.n, dist, metrics: ap });
  }
  results.sort((a, b) => a.dist - b.dist);
  return results.slice(0, topN);
}

// Actual MLB pitchers whose WHOLE ARSENAL (mix + shape of each pitch) most
// closely resembles the athlete's. athleteArsenal: { PT: {usage_pct, velo,
// hb_norm, vb, [side_norm, height, ext]}, ... } — already handedness-normalized.
function findArsenalComps(athleteArsenal, topN = 3, minPitcherSample = 150, features = SHAPE_FEATURES) {
  const results = [];
  for (const p of Object.values(PITCHER_COMPS)) {
    if (p.total_n < minPitcherSample) continue;
    let total = 0, wsum = 0;
    for (const [pt, ap] of Object.entries(athleteArsenal)) {
      const scaler = SHAPE_BASELINES[pt];
      if (!scaler) continue;
      const w = ap.usage_pct / 100;
      wsum += w;
      const pp = p.arsenal[pt];
      const dist = pp ? zDist(ap, pp, scaler.scaler_mean, scaler.scaler_scale, features) : 3.0; // penalty: pitcher doesn't throw this pitch at all
      total += w * dist;
    }
    // small penalty for pitches the comp throws that the athlete doesn't
    for (const [pt, pp] of Object.entries(p.arsenal)) {
      if (!athleteArsenal[pt]) total += 0.3 * (pp.usage_pct / 100);
    }
    if (wsum > 0) results.push({ name: p.name, throws: p.throws, total_n: p.total_n, score: total / Math.max(wsum, 0.01) });
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, topN);
}

/* ==================== 8-GRADE ====================
   A 100-scale grade (100 = MLB average, ~10 pts per standard deviation —
   same convention as Stuff+/Pitching+) built from the SAME shape-matched
   cluster outcome data as the rest of this file. No new data pull needed:
   shape_baselines.json already carries whiff%/CSW%/xwOBA/hard-hit% for
   every cluster across all 9 pitch types.

   Population stats below were computed by pooling all 53 clusters
   (~1.08M pitches total) weighted by cluster sample size — so a grade
   on a splitter and a grade on a fastball sit on the same scale and are
   directly comparable. Re-derive these if shape_baselines.json is
   regenerated from a materially different Statcast pull.
*/
const GRADE_POP_STATS = {
  whiff_pct:    { mean: 22.820, sd: 7.436 },
  csw_pct:      { mean: 27.194, sd: 2.383 },
  xwoba:        { mean: 0.317,  sd: 0.035 },
  hard_hit_pct: { mean: 40.156, sd: 5.575 }
};
// Sign baked into the weight: positive = higher is better, negative = lower is better.
const GRADE_WEIGHTS = { whiff_pct: 0.35, csw_pct: 0.20, xwoba: -0.35, hard_hit_pct: -0.10 };

// Grades any {whiff_pct, csw_pct, xwoba, hard_hit_pct} outcome bundle —
// works with a shape-matched cluster's `.metrics`, OR a flat MLB_BASELINE_REF
// entry reshaped to { whiff_pct, csw_pct, xwoba: avg_xwoba, hard_hit_pct }.
// Returns a number, or null if inputs are incomplete.
function gradeFromMetrics(metrics) {
  if (!metrics) return null;
  const vals = { whiff_pct: metrics.whiff_pct, csw_pct: metrics.csw_pct, xwoba: metrics.xwoba, hard_hit_pct: metrics.hard_hit_pct };
  if (Object.values(vals).some(v => v == null || isNaN(v))) return null;
  let z = 0;
  for (const [key, weight] of Object.entries(GRADE_WEIGHTS)) {
    const { mean, sd } = GRADE_POP_STATS[key];
    z += weight * ((vals[key] - mean) / sd);
  }
  return Math.round((100 + z * 10) * 10) / 10;
}

// Convenience: grade a single pitch straight from its raw shape inputs.
// Finds the nearest MLB cluster via matchShapeCluster() and grades that
// cluster's real outcome data. Pass REDUCED_FEATURES for `features` when
// release point (relX/relZ/ext) isn't available (e.g. older imported
// outings that predate release-point tracking).
// Returns { grade, n } or null if there isn't enough shape data to match.
function compute8Grade(pt, throws, velo, hb, vb, relX = null, relZ = null, ext = null, features = SHAPE_FEATURES) {
  const cluster = matchShapeCluster(pt, throws, velo, hb, vb, relX, relZ, ext, features);
  if (!cluster) return null;
  const grade = gradeFromMetrics(cluster.metrics);
  return grade == null ? null : { grade, n: cluster.n };
}
