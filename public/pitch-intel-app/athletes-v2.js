/* =============================================
   8CTANE BASEBALL — ATHLETE MANAGER
   athletes.js
   ============================================= */

const PITCH_COLORS = {
  FF:'#378ADD',FA:'#378ADD',SI:'#888780',FC:'#534AB7',
  SL:'#E24B4A',ST:'#D85A30',CU:'#1D9E75',KC:'#1D9E75',
  FS:'#BA7517',CH:'#BA7517',CS:'#1D9E75',OTHER:'#555566'
};
const PITCH_NAMES = {
  FF:'4-Seam',FA:'4-Seam',SI:'Sinker',FC:'Cutter',
  SL:'Slider',ST:'Sweeper',CU:'Curveball',KC:'K-Curve',
  FS:'Splitter',CH:'Changeup',CS:'Slow Curve',OTHER:'Other'
};

const pc = pt => PITCH_COLORS[pt] || '#555566';
const pn = pt => PITCH_NAMES[pt] || pt;
const pf = v => parseFloat(v) || 0;
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const clean = dateStr.toString().split('T')[0].trim();
  const d = new Date(clean + 'T12:00:00');
  if (isNaN(d)) return clean;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

let SCRIPT_URL = localStorage.getItem('8ctane_script_url') || '';
let currentAthlete = null;
let athleteOutings = [];     // outings for the selected season (what every tab renders)
let athleteOutingsAll = [];  // every outing for this athlete, all seasons
let profileSeason = 'all';   // 'all' or a 'YYYY' string
const profileSeasonByAthlete = {}; // remembers the pick per athlete this session
let profileCharts = {};
let cachedAthletes = [];

/* ==================== INIT ==================== */
window.addEventListener('DOMContentLoaded', () => {
  if (!SCRIPT_URL) {
    showConfigBanner();
  } else {
    loadRoster();
  }

  // Profile tabs
  document.querySelectorAll('[data-ptab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.ptab;
      document.querySelectorAll('#profile-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === name));
      document.querySelectorAll('.ptab-panel').forEach(p => p.classList.toggle('active', p.id === `ptab-${name}`));
      renderTab(name);
    });
  });
});

let reportSub = 'report';
function setReportSub(name) {
  reportSub = name;
  document.querySelectorAll('#report-subtabs .loc-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  document.getElementById('report-content').style.display = name === 'report' ? '' : 'none';
  document.getElementById('report-11').style.display      = name === '11' ? '' : 'none';
  document.getElementById('report-fpfb').style.display    = name === 'fpfb' ? '' : 'none';
  if (name === '11') renderCount11();
  if (name === 'fpfb') renderFirstPitchFB();
}

function renderTab(name) {
  if (name === 'trends')    renderTrends();
  if (name === 'splits')    renderSplits();
  if (name === 'locations') renderLocations();
  if (name === 'yoy')       renderYoY();
  if (name === 'report') { renderReport(); setReportSub(reportSub); }
  if (name === 'season-insight') renderSeasonInsight();
  if (name === 'outing-insight') initOutingInsight();
  if (name === 'compare') populateCompareSelectors();
  if (name === 'history') renderYearOverYear();
  if (name === 'xarsenal') renderXArsenalTab();
}

/* ==================== PITCHING LINE (K / BB / HBP / H / HR / IP) ==================== */
// FIP = ((13*HR + 3*(BB+HBP) - 2*K) / IP) + FIP constant   (FanGraphs definition)
// The constant puts FIP on the league's ERA scale. MLB is ~3.10; other
// leagues have different run environments — set them here when known.
// Constant = lgERA - (13*HR + 3*(BB+HBP) - 2*K) / IP, from league totals.
//   ALPB 2026: 10,875.2 IP, 7,218 ER (5.97 ERA), 1,689 HR, 5,711 BB, 955 HBP, 10,514 K -> 4.05
const FIP_CONSTANTS = {
  MLB:  { default: 3.10 },
  ALPB: { 2026: 4.05, default: 4.05 },   // add a year here each season
};
const ALPB_TEAMS = /long island ducks|york revolution|southern maryland|hagerstown|lexington legends|high point rockers|gastonia|lancaster stormers|charleston dirty birds|staten island ferry hawks/i;

function fipLeague(athlete) {
  if (ALPB_TEAMS.test(athlete?.team || '') || /atlantic|alpb/i.test(athlete?.level || '')) return 'ALPB';
  return 'MLB';   // MLB / MiLB / everything else until we have their league constants
}
function fipConstantFor(league, year) {
  const t = FIP_CONSTANTS[league] || FIP_CONSTANTS.MLB;
  return t[year] ?? t.default;
}
// Outings can span seasons ("All"): use each season's constant, weighted by innings
function fipConstantForOutings(outings, athlete) {
  const league = fipLeague(athlete);
  let w = 0, sum = 0;
  outings.forEach(o => { const ip = Math.round((+o.ip || 0) * 3) / 3; if (!ip) return;
    sum += fipConstantFor(league, (o.date || '').toString().slice(0, 4)) * ip; w += ip; });
  return w ? sum / w : fipConstantFor(league, null);
}
function calcFIP(hr, bb, hbp, k, ip, constant) {
  return ip > 0 ? ((13*hr + 3*(bb + (hbp||0)) - 2*k) / ip) + constant : null;
}

// Statcast `events` -> outs recorded on the play (incl. caught stealing / pickoffs)
const OUTS_ON_EVENT = {
  field_out:1, strikeout:1, force_out:1, sac_fly:1, sac_bunt:1, fielders_choice_out:1, other_out:1,
  grounded_into_double_play:2, double_play:2, strikeout_double_play:2, sac_fly_double_play:2,
  sac_bunt_double_play:2, runner_double_play:2, triple_play:3,
  caught_stealing_2b:1, caught_stealing_3b:1, caught_stealing_home:1,
  pickoff_1b:1, pickoff_2b:1, pickoff_3b:1,
  pickoff_caught_stealing_2b:1, pickoff_caught_stealing_3b:1, pickoff_caught_stealing_home:1,
};
function statcastLine(rows) {
  let k=0, bb=0, hbp=0, h=0, hr=0, outs=0;
  rows.forEach(r => {
    const ev = (r.events || '').toLowerCase();
    if (!ev) return;
    if (ev === 'strikeout' || ev === 'strikeout_double_play') k++;
    else if (ev === 'walk' || ev === 'intent_walk') bb++;
    else if (ev === 'hit_by_pitch') hbp++;
    if (ev === 'single' || ev === 'double' || ev === 'triple' || ev === 'home_run') h++;
    if (ev === 'home_run') hr++;
    outs += OUTS_ON_EVENT[ev] || 0;
  });
  return { ks:k, walks:bb, hbp, hits:h, hrs:hr, outs, ip: +(outs/3).toFixed(2) };
}
// Trackman: KorBB / PitchCall / PlayResult / OutsOnPlay (OutsOnPlay excludes strikeouts)
function trackmanLine(rows) {
  let k=0, bb=0, hbp=0, h=0, hr=0, outs=0;
  rows.forEach(r => {
    const korbb = r.korbb || r.KorBB || '', call = r.pitchcall || r.PitchCall || '', res = r.playresult || r.PlayResult || '';
    if (korbb === 'Strikeout') { k++; outs++; }
    if (korbb === 'Walk') bb++;
    if (call === 'HitByPitch') hbp++;
    if (['Single','Double','Triple','HomeRun'].includes(res)) h++;
    if (res === 'HomeRun') hr++;
    const oop = parseInt(r.outsonplay ?? r.OutsOnPlay, 10); if (!isNaN(oop) && oop > 0) outs += oop;
  });
  return { ks:k, walks:bb, hbp, hits:h, hrs:hr, outs, ip: +(outs/3).toFixed(2) };
}

/* ==================== SITUATIONAL (count / first pitch) ==================== */
// Built at import from Statcast rows and saved per outing as sit_json.
// Every bucket stores raw sums {pa, ab, h, k, bb, wn, wd} so seasons can be
// added together: wOBA = wn / wd, BAA = h / ab.
const SIT_FASTBALLS = new Set(['FF', 'FA', 'SI', 'FT']);   // 4-seam + sinker (cutters excluded)
const SIT_NON_PA = /^(caught_stealing|pickoff|stolen_base|wild_pitch|passed_ball|other_advance|runner_double_play|truncated_pa|game_advisory|ejection)/;
const SIT_NOT_AB = new Set(['walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','sac_fly_double_play','sac_bunt_double_play','catcher_interf']);
const SIT_HITS = new Set(['single','double','triple','home_run']);
const SIT_WOBA_W = { walk:.696, hit_by_pitch:.726, single:.883, double:1.244, triple:1.569, home_run:2.004 };

function sitBucket() { return { pa:0, ab:0, h:0, k:0, bb:0, wn:0, wd:0 }; }
function sitAdd(b, res) {
  b.pa++; b.wn += res.wn; b.wd += res.wd;
  if (res.ab) b.ab++; if (res.h) b.h++; if (res.k) b.k++; if (res.bb) b.bb++;
}
function sitMerge(dst, src) { if (!src) return; for (const k in src) dst[k] = (dst[k]||0) + (src[k]||0); }

function computeSituational(rows) {
  // Group into PAs (game + at-bat), ordered by pitch number
  const pas = {};
  rows.forEach(r => {
    const key = (r.game_pk || r.game_date || '') + '|' + (r.at_bat_number || '');
    if (!r.at_bat_number) return;
    (pas[key] = pas[key] || []).push(r);
  });
  const out = {
    c11_all: sitBucket(), c11_won: sitBucket(), c11_lost: sitBucket(), c11_end: sitBucket(),
    c11_byPitch: {},          // pt -> { n, won, lost, end, wn, wd }
    fp_all: sitBucket(),      // every PA (baseline)
    fp_fb_pa: sitBucket(),    // PA started with a fastball — full PA result
    fp_os_pa: sitBucket(),    // PA started with a non-fastball
    fp_fb_end: sitBucket(),   // PA decided ON the first-pitch fastball (0-0 in play / HBP)
    fp_fb_n: 0, fp_fb_strikes: 0, fp_n: 0,
  };
  Object.values(pas).forEach(ps => {
    ps.sort((a, b) => (+a.pitch_number || 0) - (+b.pitch_number || 0));
    const last = ps[ps.length - 1];
    const ev = (last.events || '').toLowerCase();
    if (!ev || SIT_NON_PA.test(ev)) return;           // not a completed PA
    let wv = parseFloat(last.woba_value), wd = parseFloat(last.woba_denom);
    if (isNaN(wv)) wv = SIT_WOBA_W[ev] || 0;
    if (isNaN(wd)) wd = (ev === 'intent_walk' || ev === 'sac_bunt' || ev === 'catcher_interf') ? 0 : 1;
    const res = { wn: wv, wd, ab: !SIT_NOT_AB.has(ev), h: SIT_HITS.has(ev), k: ev.startsWith('strikeout'), bb: ev === 'walk' || ev === 'intent_walk' };

    sitAdd(out.fp_all, res);
    // ---- first pitch ----
    const f = ps[0];
    const fpt = (f.pitch_type || '').toUpperCase();
    const fdesc = (f.description || '').toLowerCase();
    out.fp_n++;
    if (SIT_FASTBALLS.has(fpt)) {
      out.fp_fb_n++;
      if (fdesc.includes('strike') || fdesc.includes('foul') || fdesc === 'hit_into_play') out.fp_fb_strikes++;
      sitAdd(out.fp_fb_pa, res);
      if (ps.length === 1) sitAdd(out.fp_fb_end, res);
    } else if (fpt) sitAdd(out.fp_os_pa, res);

    // ---- 1-1 count ----
    const i11 = ps.findIndex(r => +r.balls === 1 && +r.strikes === 1);
    if (i11 < 0) return;
    const p11 = ps[i11];
    const d11 = (p11.description || '').toLowerCase();
    const pt11 = (p11.pitch_type || 'UN').toUpperCase();
    let bucket;
    if (i11 === ps.length - 1) bucket = 'end';                                  // PA ended on the 1-1 pitch
    else if (d11.includes('ball') || d11 === 'pitchout') bucket = 'lost';      // -> 2-1
    else bucket = 'won';                                                        // strike / foul -> 1-2
    sitAdd(out.c11_all, res);
    sitAdd(out['c11_' + bucket], res);
    const bp = out.c11_byPitch[pt11] = out.c11_byPitch[pt11] || { n:0, won:0, lost:0, end:0, wn:0, wd:0 };
    bp.n++; bp[bucket]++; bp.wn += res.wn; bp.wd += res.wd;
  });
  // Runs allowed while pitching (score change per pitch) + MLBAM id for the headshot
  out.runs = rows.reduce((a, r) => { const b = parseFloat(r.bat_score), pb = parseFloat(r.post_bat_score); return a + (!isNaN(b) && !isNaN(pb) && pb > b ? pb - b : 0); }, 0);
  const pid = rows.find(r => r.pitcher)?.pitcher; if (pid && /^\d+$/.test(pid)) out.pitcherId = pid;
  // round the wOBA sums so the JSON stays small
  const rnd = b => { b.wn = +b.wn.toFixed(3); return b; };
  ['c11_all','c11_won','c11_lost','c11_end','fp_all','fp_fb_pa','fp_os_pa','fp_fb_end'].forEach(k => rnd(out[k]));
  Object.values(out.c11_byPitch).forEach(b => { b.wn = +b.wn.toFixed(3); });
  return out;
}

// Season totals across outings (only outings that have sit_json)
function aggregateSituational(outings) {
  const agg = { outings:0, c11_all:{}, c11_won:{}, c11_lost:{}, c11_end:{}, c11_byPitch:{},
                fp_all:{}, fp_fb_pa:{}, fp_os_pa:{}, fp_fb_end:{}, fp_fb_n:0, fp_fb_strikes:0, fp_n:0 };
  outings.forEach(o => {
    let s = o.sit;
    if (!s) { try { s = o.sit_json ? JSON.parse(o.sit_json) : null; } catch(e) { s = null; } }
    if (!s) return;
    agg.outings++;
    ['c11_all','c11_won','c11_lost','c11_end','fp_all','fp_fb_pa','fp_os_pa','fp_fb_end'].forEach(k => sitMerge(agg[k], s[k]));
    agg.fp_fb_n += s.fp_fb_n||0; agg.fp_fb_strikes += s.fp_fb_strikes||0; agg.fp_n += s.fp_n||0;
    Object.entries(s.c11_byPitch || {}).forEach(([pt, b]) => { agg.c11_byPitch[pt] = agg.c11_byPitch[pt] || {}; sitMerge(agg.c11_byPitch[pt], b); });
  });
  return agg;
}

/* ==================== PER-ATHLETE PITCH TYPE REMAP ==================== */
// Merge or drop pitch types for specific pitchers when Statcast/Trackman
// tagging doesn't match what they actually throw. Keyed by name without the
// "(YYYY)" suffix, so it covers every season record. Applied when outings
// load — the saved data in the sheet is untouched, so edits here are
// reversible. Value null = drop that pitch type entirely.
const ATHLETE_PITCH_REMAP = {
  'ryan chasse': { FC: 'SL', FS: 'CH', ST: null },
};

function pitchRemapFor(athlete) {
  return ATHLETE_PITCH_REMAP[stripYearSuffix(athlete?.name || '').toLowerCase()] || null;
}

// Combine two stat objects for the same pitch (or the same L/R split).
// Counts add; averages are weighted by pitches, contact stats by balls in play.
function mergePitchStats(a, b) {
  if (!a) return b; if (!b) return a;
  const out = { ...a };
  const na = a.count || 0, nb = b.count || 0;
  const W = (k, wa, wb) => {
    const va = a[k], vb = b[k];
    const oka = va !== null && va !== undefined && va !== '' && !isNaN(+va) && wa;
    const okb = vb !== null && vb !== undefined && vb !== '' && !isNaN(+vb) && wb;
    if (oka && okb) out[k] = +(((+va) * wa + (+vb) * wb) / (wa + wb)).toFixed(3);
    else if (okb) out[k] = vb; // else keep a's
  };
  ['avgVelo','avgIVB','avgHB','avgSpin','avgVAA','avgHAA','avgRelHeight','avgRelSide','avgExt','avgPercVelo','strikePct','avgArm']
    .forEach(k => W(k, na, nb));
  const ha = a.hip || 0, hb = b.hip || 0, ea = a.bbe || ha, eb = b.bbe || hb;
  ['avgXwoba','avgXba','avgXslg','gbPct','fbPct','ldPct'].forEach(k => W(k, ha, hb));
  ['avgEV','hardHitPct'].forEach(k => W(k, ea, eb));
  ['count','whiffs','cstrikes','hip','bbe','zoneN','outN','zSw','oSw','zCon','totalStrikes','gb','fb','ld','bip','rv','swWhiffs'].forEach(k => {
    if (a[k] != null || b[k] != null) out[k] = (a[k] || 0) + (b[k] || 0);
  });
  // swings: only sum when both sides know them, otherwise leave for enrichOuting to rebuild
  out.swings = (a.swings != null && b.swings != null) ? a.swings + b.swings : undefined;
  if (out.swings === undefined) delete out.swings;
  if (a.peakVelo || b.peakVelo) out.peakVelo = Math.max(+a.peakVelo || 0, +b.peakVelo || 0);
  ['locations','mv','spray','rp'].forEach(k => { if (a[k] || b[k]) out[k] = [...(a[k] || []), ...(b[k] || [])]; });
  if (a.lhh || b.lhh) out.lhh = mergePitchStats(a.lhh, b.lhh);
  if (a.rhh || b.rhh) out.rhh = mergePitchStats(a.rhh, b.rhh);
  out.whiffPct = out.swings ? +(((out.swWhiffs ?? out.whiffs) || 0) / out.swings * 100).toFixed(1) : out.whiffPct;
  out.cswPct = out.count ? +(((out.whiffs||0) + (out.cstrikes||0)) / out.count * 100).toFixed(1) : out.cswPct;
  return out;
}

function applyPitchRemap(o, remap) {
  if (!remap || !o) return o;
  let pm = {};
  try { pm = (typeof o.pitch_stats === 'object' && o.pitch_stats) ? o.pitch_stats : JSON.parse(o.pitch_stats_json || '{}'); } catch(e) {}
  const out = {};
  Object.entries(pm).forEach(([pt, s]) => {
    const to = Object.prototype.hasOwnProperty.call(remap, pt) ? remap[pt] : pt;
    if (to === null) return;                        // dropped pitch type
    out[to] = out[to] ? mergePitchStats(out[to], s) : s;
  });
  o.pitch_stats = out;
  // count / first-pitch data is keyed by pitch type too
  if (o.sit_json) {
    try {
      const sit = JSON.parse(o.sit_json), bp = {};
      Object.entries(sit.c11_byPitch || {}).forEach(([pt, b]) => {
        const to = Object.prototype.hasOwnProperty.call(remap, pt) ? remap[pt] : pt;
        if (to === null) return;
        bp[to] = bp[to] || {}; sitMerge(bp[to], b);
      });
      sit.c11_byPitch = bp; o.sit = sit;
    } catch(e) {}
  }
  return o;
}

/* ==================== IN-ZONE WHIFF% ==================== */
// Z-Whiff% = whiffs on swings at pitches in the zone / swings in the zone.
// Uses the importer's zone counts (Statcast zone 1-9) when saved; otherwise
// rebuilds from saved pitch locations using the rulebook box
// (|plate_x| <= 0.83 ft, 1.5-3.5 ft high) — close, not batter-specific.
function zoneWhiffOf(s) {
  if (!s) return { sw:0, wh:0 };
  if (s.zSw != null && s.zCon != null) return { sw: s.zSw, wh: s.zSw - s.zCon };
  let sw = 0, wh = 0;
  (s.locations || []).forEach(l => {
    if (!Array.isArray(l)) return;
    const [x, z, oc] = l;
    if (x == null || z == null || Math.abs(x) > 0.83 || z < 1.5 || z > 3.5) return;
    if (oc === 'W') { sw++; wh++; } else if (oc === 'F' || oc === 'HIP') sw++;
  });
  return { sw, wh };
}
function zoneWhiffPct(pitchStatsList) {   // list of pitch-stat objects
  let sw = 0, wh = 0;
  pitchStatsList.forEach(s => { const z = zoneWhiffOf(s); sw += z.sw; wh += z.wh; });
  return sw ? wh / sw * 100 : null;
}

/* ==================== AI CONTEXT: HANDEDNESS + LOCATION ==================== */
// Stored HB is -pfx_x (inches): positive = toward 3B from the catcher's view,
// which is ARM side for a RHP but GLOVE side for a LHP. The AI prompts used to
// get the raw signed number with no orientation, so for lefties it read the
// fastball's run as glove-side and gave backwards location advice. Everything
// the AI sees is now labeled arm-side / glove-side and inside / away by batter.
function aiIsLefty() { return (currentAthlete?.throws || 'R').toUpperCase().startsWith('L'); }

function aiHB(hb, lefty) {
  if (hb === null || hb === undefined || hb === '' || isNaN(+hb)) return '?';
  const arm = (+hb) * (lefty ? -1 : 1);
  return `${Math.abs(arm).toFixed(1)}" ${arm >= 0 ? 'arm-side' : 'glove-side'}`;
}

function aiOrientation(lefty) {
  return lefty
    ? `ORIENTATION (LHP): Arm side = INSIDE to LHB and AWAY from RHB. Glove side = INSIDE to RHB and AWAY from LHB. A LHP's fastball/sinker/changeup run ARM-side; sliders/sweepers/cutters move GLOVE-side.`
    : `ORIENTATION (RHP): Arm side = INSIDE to RHB and AWAY from LHB. Glove side = INSIDE to LHB and AWAY from RHB. A RHP's fastball/sinker/changeup run ARM-side; sliders/sweepers/cutters move GLOVE-side.`;
}

// Where each pitch was actually located, by batter side, from saved
// locations [plate_x, plate_z, outcome, stand]. plate_x is catcher's view
// (negative = 3B side), so arm side = x < 0 for RHP, x > 0 for LHP.
function aiLocationLines(pitchMaps, lefty) {
  const agg = {};
  pitchMaps.forEach(pm => Object.entries(pm || {}).forEach(([pt, s]) => {
    (s.locations || []).forEach(l => {
      if (!Array.isArray(l)) return;
      const [x, z, oc, stand] = l;
      if (x == null || z == null || (stand !== 'L' && stand !== 'R')) return;
      const k = pt + '|' + stand;
      const a = agg[k] = agg[k] || { pt, stand, n:0, arm:0, up:0, zone:0, armSw:0, armWh:0, gloveSw:0, gloveWh:0 };
      const isArm = lefty ? x > 0 : x < 0;
      a.n++; if (isArm) a.arm++; if (z > 2.5) a.up++;
      if (Math.abs(x) <= 0.83 && z >= 1.5 && z <= 3.5) a.zone++;
      const sw = oc === 'W' || oc === 'F' || oc === 'HIP';
      if (sw) { if (isArm) { a.armSw++; if (oc === 'W') a.armWh++; } else { a.gloveSw++; if (oc === 'W') a.gloveWh++; } }
    });
  }));
  const rows = Object.values(agg).filter(a => a.n >= 8).sort((a, b) => b.n - a.n);
  if (!rows.length) return 'LOCATION DATA: not available for these outings — do NOT give specific location advice.';
  const pc_ = (a, b) => b ? Math.round(a / b * 100) + '%' : 'n/a';
  const armLbl = st => (lefty ? (st === 'L' ? 'inside' : 'away') : (st === 'R' ? 'inside' : 'away'));
  return 'LOCATION DATA (where you actually threw each pitch, by batter side):\n' + rows.map(a =>
    `${pn(a.pt)} vs ${a.stand}HB (${a.n}p): ${pc_(a.arm, a.n)} arm-side (${armLbl(a.stand)}), ${pc_(a.n - a.arm, a.n)} glove-side (${armLbl(a.stand) === 'inside' ? 'away' : 'inside'}) | ${pc_(a.up, a.n)} up | ${pc_(a.zone, a.n)} in zone | Whiff/Swing arm-side ${pc_(a.armWh, a.armSw)}, glove-side ${pc_(a.gloveWh, a.gloveSw)}`
  ).join('\n');
}

const AI_LOCATION_RULE = `LOCATION RULES: Use the ORIENTATION above exactly. Any location advice ("in", "away", "arm side", "glove side", "up", "down") must be supported by LOCATION DATA and must name the batter side (e.g. "in to LHB"). Never contradict the pitcher's handedness.`;

/* ==================== WHIFF / SWING ==================== */
// Every "Whiff%" in the app is whiffs per SWING — the Statcast / MLB
// Network definition. Swings = swinging strikes + fouls (incl. tips and
// bunts) + balls in play. SwStr% (whiffs per pitch) is labeled separately.
//
// Outings imported before Sept 29 2026 don't store swing counts, so they
// are rebuilt from each pitch's saved outcome in `locations`
// ([x, z, outcome, stand] — W / CS / HIP / F / B). If an outing has no
// locations (older Trackman), the outing-level Swing% saved at import is
// used for the outing total; per-pitch values stay blank for that outing.
function wps(whiffs, swings) { return swings ? +(whiffs / swings * 100).toFixed(1) : null; }

function swingsFromLocs(locs, stand) {
  let sw = 0, wh = 0, n = 0;
  (locs || []).forEach(l => {
    if (!Array.isArray(l)) return;
    if (stand && l[3] !== stand) return;
    n++;
    if (l[2] === 'W') { sw++; wh++; } else if (l[2] === 'F' || l[2] === 'HIP') sw++;
  });
  return n ? { swings: sw, whiffs: wh } : null;
}

// Adds swings / swWhiffs / whiffPct (per swing) / swStrPct (per pitch) to
// every pitch type and L/R split, plus o.swings / o.swWhiffs / o.whiffSwPct.
function enrichOuting(o) {
  if (!o || o._whiffEnriched) return o;
  let pm = {};
  try { pm = (typeof o.pitch_stats === 'object' && o.pitch_stats) ? o.pitch_stats : JSON.parse(o.pitch_stats_json || '{}'); } catch(e) {}
  let sw = 0, wh = 0, complete = true;
  Object.values(pm).forEach(s => {
    if (!s || !s.count) return;
    s.swStrPct = +((s.whiffs || 0) / s.count * 100).toFixed(1);
    if (s.swings !== undefined && s.swings !== null) { s.swWhiffs = s.whiffs || 0; }
    else {
      const d = swingsFromLocs(s.locations);
      if (d) { s.swings = d.swings; s.swWhiffs = d.whiffs; } else { s.swings = null; s.swWhiffs = null; }
    }
    s.whiffPct = s.swings != null ? wps(s.swWhiffs, s.swings) : null;
    ['lhh', 'rhh'].forEach(k => {
      const sd = s[k]; if (!sd) return;
      if (sd.swings !== undefined && sd.swings !== null) sd.swWhiffs = sd.whiffs || 0;
      else {
        const d = swingsFromLocs(s.locations, k === 'lhh' ? 'L' : 'R');
        if (d) { sd.swings = d.swings; sd.swWhiffs = d.whiffs; } else { sd.swings = null; sd.swWhiffs = null; }
      }
      sd.whiffPct = sd.swings != null ? wps(sd.swWhiffs, sd.swings) : null;
    });
    if (s.swings == null) complete = false; else { sw += s.swings; wh += s.swWhiffs; }
  });
  if (!complete) {
    const sp = pf(o.swing_pct), tp = +o.total_pitches || 0;
    if (sp && tp) { sw = Math.round(sp * tp / 100); wh = +o.whiffs || 0; }
  }
  o.swings = sw || null;
  o.swWhiffs = sw ? wh : null;
  o.whiffSwPct = wps(o.swWhiffs, o.swings);
  o.pitch_stats = pm;
  o._whiffEnriched = true;
  return o;
}

// Season Whiff/Swing across outings (sums, then divides once)
function outingsWhiffSw(outings) {
  let sw = 0, wh = 0;
  outings.forEach(o => { if (o.swings) { sw += o.swings; wh += o.swWhiffs || 0; } });
  return wps(wh, sw);
}

/* ==================== REPORT: 1-1 COUNT & FIRST-PITCH FASTBALLS ==================== */
const sitWoba = b => b && b.wd ? b.wn / b.wd : null;
const sitBaa  = b => b && b.ab ? b.h / b.ab : null;
const fmt3 = v => v === null || v === undefined ? '—' : v.toFixed(3).replace(/^0/, '');
const fmtP = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';

function sitEmpty(el) {
  const n = athleteOutings.length;
  el.innerHTML = `<div class="empty-state">No count data for ${n ? 'these outings' : 'this season'} yet.<br>
    <small>Count and plate-appearance results are saved on import starting Sept 29 2026. Re-import this season with
    <b>Bulk Import → "Replace existing outings"</b> checked to fill it in (Statcast CSVs).</small></div>`;
}

function sitKpi(label, val, sub, cls = '') {
  return `<div class="sit-kpi ${cls}"><div class="sit-kpi-val">${val}</div><div class="sit-kpi-lbl">${label}</div>${sub ? `<div class="sit-kpi-sub">${sub}</div>` : ''}</div>`;
}

function sitRow(label, b, extra = '') {
  return `<tr><td>${label}</td><td class="v-num">${b.pa||0}</td><td class="v-num"><b>${fmt3(sitWoba(b))}</b></td>
    <td class="v-num">${fmt3(sitBaa(b))}</td><td class="v-num">${fmtP(b.k||0, b.pa)}</td><td class="v-num">${fmtP(b.bb||0, b.pa)}</td>${extra}</tr>`;
}

function renderCount11() {
  const el = document.getElementById('report-11');
  const a = aggregateSituational(athleteOutings);
  if (!a.outings || !a.c11_all.pa) return sitEmpty(el);
  const won = a.c11_won, lost = a.c11_lost, end = a.c11_end;
  const decided = (won.pa||0) + (lost.pa||0);
  const wW = sitWoba(won), wL = sitWoba(lost);
  const gap = (wW !== null && wL !== null) ? Math.round((wL - wW) * 1000) : null;

  const byPitch = Object.entries(a.c11_byPitch).filter(([, b]) => b.n).sort((x, y) => y[1].n - x[1].n);
  const tot11 = byPitch.reduce((s, [, b]) => s + b.n, 0);
  const pitchRows = byPitch.map(([pt, b]) => `<tr>
      <td><span class="pitch-chip"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span></td>
      <td class="v-num">${b.n}</td><td class="v-num">${fmtP(b.n, tot11)}</td>
      <td class="v-num">${fmtP(b.won||0, (b.won||0)+(b.lost||0))}</td>
      <td class="v-num">${fmt3(b.wd ? b.wn/b.wd : null)}</td></tr>`).join('');

  el.innerHTML = `
    <div class="section-hd">Winning the 1-1 count — ${seasonLabel()}</div>
    <div class="sit-kpis">
      ${sitKpi('wOBA after winning 1-1', fmt3(wW), `${won.pa||0} PA reached 1-2`, 'sit-good')}
      ${sitKpi('wOBA after losing 1-1', fmt3(wL), `${lost.pa||0} PA reached 2-1`, 'sit-bad')}
      ${sitKpi('1-1 win rate', fmtP(won.pa||0, decided), 'strike on 1-1 (excl. balls in play)')}
      ${sitKpi('Value of winning 1-1', gap !== null ? gap + ' pts' : '—', 'of wOBA saved vs losing it')}
    </div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>After 1-1</th><th>PA</th><th>wOBA</th><th>BAA</th><th>K%</th><th>BB%</th></tr></thead>
      <tbody>
        ${sitRow('Won → 1-2', won)}
        ${sitRow('Lost → 2-1', lost)}
        ${sitRow('Decided on 1-1 pitch', end)}
        ${sitRow('All PA through 1-1', a.c11_all)}
      </tbody>
    </table></div>
    <div class="section-hd" style="margin-top:1.5rem">What you throw on 1-1</div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Pitch</th><th>Thrown</th><th>Usage</th><th>Win rate</th><th>PA wOBA</th></tr></thead>
      <tbody>${pitchRows}</tbody>
    </table></div>
    <div class="chart-footnote">"Won" = strike or foul on 1-1 → 1-2 · "Lost" = ball → 2-1 · wOBA is the final result of the plate appearance · Based on ${a.outings} outing${a.outings!==1?'s':''} with count data</div>`;
}

function renderFirstPitchFB() {
  const el = document.getElementById('report-fpfb');
  const a = aggregateSituational(athleteOutings);
  if (!a.outings || !a.fp_n) return sitEmpty(el);
  const endB = a.fp_fb_end, faB = a.fp_fb_pa, osB = a.fp_os_pa;
  el.innerHTML = `
    <div class="section-hd">First-pitch fastballs — ${seasonLabel()}</div>
    <div class="sit-kpis">
      ${sitKpi('BAA on first-pitch fastballs', fmt3(sitBaa(endB)), `${endB.h||0} H in ${endB.ab||0} AB decided on pitch 1`, sitBaa(endB) !== null && sitBaa(endB) <= .250 ? 'sit-good' : sitBaa(endB) >= .330 ? 'sit-bad' : '')}
      ${sitKpi('First-pitch FB rate', fmtP(a.fp_fb_n, a.fp_n), `${a.fp_fb_n} of ${a.fp_n} PA`)}
      ${sitKpi('First-pitch FB strike%', fmtP(a.fp_fb_strikes, a.fp_fb_n), 'called, swinging, foul or in play')}
      ${sitKpi('BAA when PA starts with FB', fmt3(sitBaa(faB)), 'full plate appearance')}
    </div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Plate appearances</th><th>PA</th><th>wOBA</th><th>BAA</th><th>K%</th><th>BB%</th></tr></thead>
      <tbody>
        ${sitRow('Decided on first-pitch FB', endB)}
        ${sitRow('Started with a fastball', faB)}
        ${sitRow('Started with a non-fastball', osB)}
        ${sitRow('All PA', a.fp_all)}
      </tbody>
    </table></div>
    <div class="chart-footnote">Fastball = 4-seam or sinker (cutters not included) · "Decided on first-pitch FB" = the 0-0 fastball was put in play or hit the batter · Based on ${a.outings} outing${a.outings!==1?'s':''} with count data</div>`;
}

/* ==================== SEASON SELECTOR ==================== */
// Season bar under the athlete hero. Filters athleteOutings to one year
// (or All) and re-renders the hero, overview, outings list and whichever
// tab is open. Hidden when the athlete only has one season.
function outingYear(o) {
  const y = (o.date || '').toString().slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

function profileYears() {
  return [...new Set(athleteOutingsAll.map(outingYear).filter(Boolean))].sort();
}

function seasonLabel() {
  if (profileSeason !== 'all') return profileSeason;
  const ys = profileYears();
  if (!ys.length) return '';
  return ys.length === 1 ? ys[0] : `${ys[0]}–${ys[ys.length-1]}`;
}

function renderSeasonBar() {
  const bar = document.getElementById('season-bar');
  if (!bar) return;
  const ys = profileYears();
  if (ys.length < 2) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = '';
  const btn = (val, label) => {
    const n = val === 'all' ? athleteOutingsAll.length : athleteOutingsAll.filter(o => outingYear(o) === val).length;
    return `<button class="loc-filter-btn${profileSeason === val ? ' active' : ''}" onclick="setProfileSeason('${val}')" title="${n} outing${n!==1?'s':''}">${label}</button>`;
  };
  bar.innerHTML = `
    <div class="loc-filter-row">
      <span class="loc-filter-label">Season:</span>
      ${ys.slice().reverse().map(y => btn(y, y)).join('')}
      ${btn('all', 'All')}
    </div>`;
}

function applySeasonFilter() {
  athleteOutings = profileSeason === 'all'
    ? athleteOutingsAll.slice()
    : athleteOutingsAll.filter(o => outingYear(o) === profileSeason);
  const label = seasonLabel();
  document.querySelectorAll('.season-label').forEach(el => el.textContent = label);
  renderSeasonBar();
}

function setProfileSeason(val) {
  if (val === profileSeason) return;
  profileSeason = val;
  if (currentAthlete) profileSeasonByAthlete[currentAthlete.id] = val;
  applySeasonFilter();
  renderProfileHero();
  renderSeasonOverview();
  renderOutingsList();
  populateCompareSelectors();
  const active = document.querySelector('#profile-tabs .tab.active');
  if (active && active.dataset.ptab !== 'overview' && active.dataset.ptab !== 'compare') renderTab(active.dataset.ptab);
}

/* ==================== CONFIG ==================== */
function showConfigBanner() {
  document.getElementById('config-banner').style.display = '';
  const input = document.getElementById('script-url-input');
  if (SCRIPT_URL) input.value = SCRIPT_URL;
}

function saveScriptUrl() {
  const url = document.getElementById('script-url-input').value.trim();
  // Accept the Apps Script URL directly, or the Cloudflare Worker proxy
  // in front of it (*.workers.dev) — the proxy avoids Safari's echo 404s.
  const ok = url.startsWith('https://script.google.com') || /^https:\/\/[^/]+\.workers\.dev\/?$/.test(url);
  if (!ok) {
    toast('Paste your Apps Script URL or your workers.dev proxy URL', 'error'); return;
  }
  SCRIPT_URL = url;
  localStorage.setItem('8ctane_script_url', url);
  document.getElementById('config-banner').style.display = 'none';
  toast('Connected to Google Sheets ✓', 'success');
  loadRoster();
}

/* ==================== API ==================== */
// Uses XMLHttpRequest instead of fetch(). Apps Script web apps respond via a
// 302 redirect to a script.googleusercontent.com/macros/echo?... URL, and
// Safari's fetch() intermittently fails to follow that cross-origin redirect
// on POST requests (surfaces in the console as a 404 on the echo URL even
// though the Apps Script execution completed fine). XHR follows redirects
// more reliably in Safari, so this sidesteps the issue without needing a
// proxy in front of Apps Script.
function api(action, body = {}) {
  return new Promise((resolve, reject) => {
    if (!SCRIPT_URL) { showConfigBanner(); reject(new Error('No script URL configured')); return; }
    const url = `${SCRIPT_URL}?action=${action}`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Request failed with status ${xhr.status}`));
        return;
      }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        reject(new Error('Invalid JSON response from server'));
        return;
      }
      if (data.error) { reject(new Error(data.error)); return; }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error('Network error contacting Apps Script'));
    xhr.send(JSON.stringify({ action, ...body }));
  });
}

// api() with retries + backoff. Only use for actions that are safe to
// repeat (addOuting and addAthlete both dedupe server-side).
async function apiWithRetry(action, body = {}, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api(action, body);
    } catch (e) {
      if (attempt >= retries) throw e;
      console.warn(`${action} attempt ${attempt+1} failed (${e.message}), retrying...`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/* ==================== ROSTER ==================== */
async function loadRoster() {
  const grid = document.getElementById('athlete-grid');
  grid.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Loading athletes...</div>';
  try {
    const { athletes } = await api('getAthletes');
    cachedAthletes = athletes;
    renderRoster(athletes);
  } catch(e) {
    grid.innerHTML = `<div class="empty-state">Could not connect to Google Sheets.<br><small>${e.message}</small></div>`;
  }
}

function renderRoster(athletes) {
  const grid = document.getElementById('athlete-grid');
  const empty = document.getElementById('roster-empty');
  const count = document.getElementById('roster-count');
  count.textContent = `${athletes.length} athlete${athletes.length !== 1 ? 's' : ''}`;

  if (!athletes.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = athletes.map(a => {
    const initials = a.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    return `<div class="athlete-card" onclick="openProfile('${a.id}')">
      <button class="card-delete-btn" onclick="event.stopPropagation();confirmDeleteAthlete('${a.id}','${a.name}')" title="Delete athlete">✕</button>
      <div class="athlete-card-header">
        <div class="athlete-avatar">${initials}</div>
        <div>
          <div class="athlete-card-name">${a.name}</div>
          <div class="athlete-card-meta">${a.throws}HP · ${a.team || '—'} · ${a.level || '—'}</div>
        </div>
      </div>
      <div class="athlete-card-footer">
        <span class="outing-count-badge" id="badge-${a.id}">Loading outings...</span>
        <span style="font-size:11px;color:var(--muted)">Click to view →</span>
      </div>
    </div>`;
  }).join('');

  // Load outing counts async
  athletes.forEach(a => loadOutingCount(a.id));
}

async function loadOutingCount(athleteId) {
  try {
    const { outings } = await api('getOutings', { athleteId });
    const badge = document.getElementById(`badge-${athleteId}`);
    if (badge) badge.textContent = `${outings.length} outing${outings.length !== 1 ? 's' : ''}`;
  } catch(e) {}
}

/* ==================== ADD ATHLETE ==================== */
function showAddAthlete() {
  openModal('Add Athlete', `
    <div class="form-group">
      <label class="form-label">Full Name *</label>
      <input class="form-input" id="f-name" placeholder="Thomas Harrington">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Throws</label>
        <select class="form-select" id="f-throws">
          <option value="R">Right</option>
          <option value="L">Left</option>
          <option value="S">Switch</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Position</label>
        <select class="form-select" id="f-position">
          <option value="SP">SP</option>
          <option value="RP">RP</option>
          <option value="P">P</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Team / Org</label>
        <input class="form-input" id="f-team" placeholder="Memphis Redbirds">
      </div>
      <div class="form-group">
        <label class="form-label">Level</label>
        <select class="form-select" id="f-level">
          <option value="MLB">MLB</option>
          <option value="AAA">AAA</option>
          <option value="AA">AA</option>
          <option value="A+">A+</option>
          <option value="A">A</option>
          <option value="College">College</option>
          <option value="HS">High School</option>
          <option value="Other">Other</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="f-notes" placeholder="Any notes about this athlete..."></textarea>
    </div>
    <div class="form-actions">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitAddAthlete()">Add Athlete</button>
    </div>
  `);
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

let addAthleteSubmitting = false;
async function submitAddAthlete() {
  // FIX (bug #2): no guard existed here at all — a double-click on
  // "Add Athlete" fired this twice before the first request returned,
  // creating two identical athlete records. Guard + disable the button
  // synchronously, before any await, so a second click can't get in.
  if (addAthleteSubmitting) return;
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  addAthleteSubmitting = true;
  const btn = document.querySelector('#modal-body .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

  try {
    await api('addAthlete', {
      name,
      throws:   document.getElementById('f-throws').value,
      position: document.getElementById('f-position').value,
      team:     document.getElementById('f-team').value.trim(),
      level:    document.getElementById('f-level').value,
      notes:    document.getElementById('f-notes').value.trim(),
    });
    closeModal();
    toast(`${name} added ✓`, 'success');
    loadRoster();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    addAthleteSubmitting = false;
  }
}

async function confirmDeleteAthlete(id, name) {
  if (!confirm(`Delete ${name} and all their outings? This cannot be undone.`)) return;
  try {
    await api('deleteAthlete', { athleteId: id });
    toast(`${name} deleted`, 'success');
    loadRoster();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

/* ==================== PROFILE ==================== */
async function openProfile(athleteId) {
  document.getElementById('view-roster').style.display = 'none';
  document.getElementById('view-profile').style.display = '';

  // Show loading
  document.getElementById('profile-hero').style.opacity = '.5';

  try {
    const { athletes } = await api('getAthletes');
    currentAthlete = athletes.find(a => a.id === athleteId);
    if (!currentAthlete) { showRoster(); return; }

    const { outings } = await api('getOutings', { athleteId });
    const remap = pitchRemapFor(currentAthlete);
    athleteOutingsAll = (outings || []).map(o => enrichOuting(applyPitchRemap(o, remap)));
    // Default to the most recent season; keep the previous pick for this
    // athlete if it still exists (e.g. after importing or deleting an outing)
    const ys = profileYears();
    const prev = profileSeasonByAthlete[athleteId];
    profileSeason = (prev && (prev === 'all' || ys.includes(prev))) ? prev : (ys.length > 1 ? ys[ys.length-1] : 'all');
    applySeasonFilter();

    renderProfileHero();
    renderSeasonOverview();
    renderOutingsList();
    populateCompareSelectors();

    // Reset to overview tab
    // Land on the Report tab
    document.querySelectorAll('#profile-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'report'));
    document.querySelectorAll('.ptab-panel').forEach(p => p.classList.toggle('active', p.id === 'ptab-report'));
    renderTab('report');

  } catch(e) {
    toast('Error loading profile: ' + e.message, 'error');
    showRoster();
  }
}

function showRoster() {
  document.getElementById('view-roster').style.display = '';
  document.getElementById('view-profile').style.display = 'none';
  document.getElementById('view-bulk-import').style.display = 'none';
  currentAthlete = null;
  athleteOutings = [];
  athleteOutingsAll = [];
  Object.keys(profileCharts).forEach(id => { if(profileCharts[id]) { profileCharts[id].destroy(); delete profileCharts[id]; } });
  loadRoster();
}

function showBulkImport() {
  document.getElementById('view-roster').style.display = 'none';
  document.getElementById('view-profile').style.display = 'none';
  document.getElementById('view-bulk-import').style.display = '';
  // Populate athlete dropdown
  const sel = document.getElementById('bulk-athlete-select');
  sel.innerHTML = '<option value="">Select athlete...</option>' +
    cachedAthletes.map(a => `<option value="${a.id}">${a.name} — ${a.team||''} ${a.level||''}</option>`).join('');
  sel.onchange = () => {
    const btn = document.getElementById('bulk-import-btn');
    const hasFile = bulkOutings.length > 0;
    const hasAthlete = sel.value;
    btn.disabled = !(hasFile && hasAthlete);
    btn.style.opacity = (hasFile && hasAthlete) ? '1' : '.4';
  };
  // Setup drag and drop
  const dz = document.getElementById('drop-zone');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag-over'); };
  dz.ondragleave = () => dz.classList.remove('drag-over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag-over'); if(e.dataTransfer.files[0]) handleBulkFile(e.dataTransfer.files[0]); };
}

// =============================================
// BULK IMPORT
// =============================================
let bulkOutings = [];

function resetBulkImport() {
  bulkOutings = [];
  document.getElementById('bulk-preview').style.display = 'none';
  document.getElementById('bulk-result').style.display = 'none';
  document.getElementById('drop-zone').style.display = '';
  document.getElementById('csv-file-input').value = '';
}

function handleBulkFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => parseBulkCSV(e.target.result, file.name);
  reader.readAsText(file);
}

function parseBulkCSV(text, filename) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase());

  // Detect format: Statcast vs Trackman
  const isStatcast  = headers.includes('pitch_type') && headers.includes('release_speed');
  const isTrackman  = headers.includes('taggedpitchtype') || headers.includes('relspeed');

  if (!isStatcast && !isTrackman) {
    alert('Could not detect CSV format. Please use a Statcast or Trackman export.');
    return;
  }

  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i]||'').trim().replace(/^"|"$/g,''));
    return obj;
  });

  if (!rows.length) { alert('No data found in CSV.'); return; }

  const parsed = isStatcast ? parseStatcastBulk(rows) : parseTrackmanBulk(rows);
  if (!parsed.outings.length) { alert('No outings detected in this file.'); return; }

  bulkOutings = parsed.outings;

  // Show preview
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('bulk-preview').style.display = '';
  document.getElementById('bulk-preview-title').textContent = parsed.pitcher + ' — ' + parsed.outings.length + ' outings detected';
  document.getElementById('bulk-preview-sub').textContent =
    parsed.outings.reduce((a,o)=>a+o.total_pitches,0) + ' total pitches · ' +
    parsed.outings[0].date + ' to ' + parsed.outings[parsed.outings.length-1].date + ' · ' + filename;

  // Render outing rows
  document.getElementById('bulk-outing-rows').innerHTML = parsed.outings.map((o,i) => {
    const ptags = Object.entries(o.pitchMap).filter(([,s])=>s.count>0)
      .sort((a,b)=>b[1].count-a[1].count).slice(0,5)
      .map(([pt,s])=>`${pn(pt)} ${o.total_pitches?(s.count/o.total_pitches*100).toFixed(0):0}%`).join(' · ');
    const pmv = Object.values(o.pitchMap || {});
    const bSw = pmv.reduce((a,s)=>a+(s.swings||0),0), bWh = pmv.reduce((a,s)=>a+(s.whiffs||0),0);
    const whiffPct = bSw ? (bWh/bSw*100).toFixed(1) : '—';
    return `<div class="bulk-outing-row" id="bulk-row-${i}">
      <div class="bulk-outing-left">
        <div class="bulk-outing-date">${formatDate(o.date)}</div>
        <div>
          <div class="bulk-outing-opp">vs. ${o.opponent||'Unknown'}</div>
          <div class="bulk-outing-meta">${o.total_pitches} pitches · ${whiffPct}% whiff · ${o.ks}K ${o.walks}BB · ${ptags}</div>
        </div>
      </div>
      <div class="bulk-outing-status" id="bulk-status-${i}" style="color:var(--muted2)">Pending</div>
    </div>`;
  }).join('');

  // Try auto-select athlete by name
  const sel = document.getElementById('bulk-athlete-select');
  const nameMatch = cachedAthletes.find(a =>
    parsed.pitcher.toLowerCase().includes(a.name.split(' ').pop().toLowerCase()) ||
    a.name.toLowerCase().includes(parsed.pitcher.split(',')[0].toLowerCase().trim())
  );
  if (nameMatch) { sel.value = nameMatch.id; sel.dispatchEvent(new Event('change')); }
}

function parseCsvLine(line) {
  const result = []; let cur = ''; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; }
    else if (c === ',' && !inQuote) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

function parseStatcastBulk(rows) {
  const NORMALIZE = {FA:'FF',FO:'FS',CS:'CU',SV:'SL'};
  const VALID_PT  = new Set(['FF','SI','FC','SL','ST','CU','KC','FS','CH','OTHER']);
  const STRIKE_ZONES = new Set(['1','2','3','4','5','6','7','8','9']);

  const pitcher = rows[0]?.player_name || 'Unknown';
  const games = {};
  rows.forEach(r => {
    const key = (r.game_date||'') + '|' + (r.game_pk||'');
    if (!games[key]) games[key] = [];
    games[key].push(r);
  });

  const outings = Object.entries(games).sort((a,b)=>a[0].localeCompare(b[0])).map(([key, pitches]) => {
    const home = pitches[0]?.home_team||''; const away = pitches[0]?.away_team||'';
    const opp = pitches[0]?.inning_topbot==='Top' ? away : home;
    const date = pitches[0]?.game_date||'';

    const pm = {};
    let inZone=0,outZone=0,swingInZone=0,swingOutZone=0,contactInZone=0;
    let totalSwings=0,totalStrikes=0,gbCount=0,fbCount=0,ldCount=0,bipCount=0;
    let fp_total=0,fp_strikes=0,oneone_total=0,oneone_strikes=0;

    // Group pitches by at_bat_number for PA-level metrics
    const paMap = {};
    pitches.forEach(r => {
      const pa = r.at_bat_number||r.at_bat_number||'';
      if (!pa) return;
      if (!paMap[pa]) paMap[pa] = [];
      paMap[pa].push(r);
    });

    // Race to 2K: % of PAs where pitcher gets to 2 strikes within first 3 pitches
    let race2k_total = 0, race2k_hit = 0;
    // Putaway%: % of 2-strike plate appearances ending in strikeout
    let putaway_total = 0, putaway_k = 0;

    Object.values(paMap).forEach(paPitches => {
      const sorted = [...paPitches].sort((a,b) => (+a.pitch_number||0)-(+b.pitch_number||0));
      race2k_total++;
      // Check if pitcher reached 2 strikes within first 3 pitches
      let strikes = 0;
      for (let i = 0; i < Math.min(3, sorted.length); i++) {
        const desc = sorted[i].description||'';
        if (desc.includes('swinging_strike')||desc.includes('called_strike')||desc.includes('foul')||desc==='foul_tip') {
          strikes++;
          if (strikes >= 2) { race2k_hit++; break; }
        }
      }
      // Putaway: did this PA ever reach 2 strikes?
      const lastPitch = sorted[sorted.length-1];
      const maxStrikes = Math.max(...sorted.map(p=>+(p.strikes||0)));
      if (maxStrikes >= 2) {
        putaway_total++;
        if (lastPitch.events==='strikeout') putaway_k++;
      }
    });

    pitches.forEach(r => {
      let pt = (r.pitch_type||'').trim().toUpperCase();
      pt = NORMALIZE[pt] || pt;
      if (!pt || !VALID_PT.has(pt)) pt = 'OTHER';
      if (!pm[pt]) pm[pt] = {count:0,velos:[],whiffs:0,cstrikes:0,hip:0,xwobas:[],launch_speeds:[],pfx_xs:[],pfx_zs:[],vaas:[],haas:[],hard_hits:0,
        spins:[],locations:[],spray:[],
        pfx_x_raw:[],pfx_z_raw:[],rel_xs:[],rel_zs:[],exts:[],realExts:[],effSpeeds:[],throws:[],mv:[],rp:[],arms:[],
        swings:0,zoneN:0,outN:0,zSw:0,oSw:0,zCon:0,
        lhh:{count:0,whiffs:0,cstrikes:0,hip:0,velos:[],xbas:[],xslgs:[],launch_speeds:[],hard_hits:0,gb:0,fb:0,ld:0,bip:0,totalStrikes:0,locations:[]},
        rhh:{count:0,whiffs:0,cstrikes:0,hip:0,velos:[],xbas:[],xslgs:[],launch_speeds:[],hard_hits:0,gb:0,fb:0,ld:0,bip:0,totalStrikes:0,locations:[]}};
      const s = pm[pt];
      s.count++;
      const stand = (r.stand||'').toUpperCase();
      const side = stand==='L' ? s.lhh : stand==='R' ? s.rhh : null;
      if (side) {
        side.count++;
        const sv = parseFloat(r.release_speed); if(!isNaN(sv)) side.velos.push(sv);
      }

      const v = parseFloat(r.release_speed); if (!isNaN(v)) s.velos.push(v);
      const hb = parseFloat(r.pfx_x); if (!isNaN(hb)) s.pfx_xs.push(-hb*12);
      const ivb = parseFloat(r.pfx_z); if (!isNaN(ivb)) s.pfx_zs.push(ivb*12);
      // Per-pitch movement for the Movement Profile chart (inches, 1 decimal)
      if (!isNaN(hb) && !isNaN(ivb)) s.mv.push([+(-hb*12).toFixed(1), +(ivb*12).toFixed(1)]);
      // Raw (unscaled, feet) shape/release values for MLB shape-matched comparison
      if (!isNaN(hb))  s.pfx_x_raw.push(hb);
      if (!isNaN(ivb)) s.pfx_z_raw.push(ivb);
      const rpx = parseFloat(r.release_pos_x); if (!isNaN(rpx)) s.rel_xs.push(rpx);
      const rpz = parseFloat(r.release_pos_z); if (!isNaN(rpz)) s.rel_zs.push(rpz);
      if (!isNaN(rpx) && !isNaN(rpz)) s.rp.push([+rpx.toFixed(2), +rpz.toFixed(2)]);   // per-pitch release (outing card)
      const arm = parseFloat(r.arm_angle); if (!isNaN(arm)) s.arms.push(arm);          // Savant arm angle
      if (r.p_throws) s.throws.push(r.p_throws);

      // VAA / HAA from pitch physics
      const vx0=parseFloat(r.vx0),vy0=parseFloat(r.vy0),vz0=parseFloat(r.vz0);
      const ax=parseFloat(r.ax),ay=parseFloat(r.ay),az=parseFloat(r.az);
      const ext=parseFloat(r.release_extension)||6.0;
      s.exts.push(ext);
      // Real extension only (no 6.0 fallback) for the displayed average
      const extReal=parseFloat(r.release_extension); if(!isNaN(extReal)) s.realExts.push(extReal);
      // Perceived velo — Statcast effective_speed
      const eff=parseFloat(r.effective_speed); if(!isNaN(eff)) s.effSpeeds.push(eff);
      if(!isNaN(vx0)&&!isNaN(vy0)&&!isNaN(vz0)&&!isNaN(ax)&&!isNaN(ay)&&!isNaN(az)){
        const t=(60.5-ext)/Math.abs(vy0);
        const vxf=vx0+ax*t, vyf=vy0+ay*t, vzf=vz0+az*t;
        const vaa=+(Math.atan(vzf/Math.abs(vyf))*(180/Math.PI)).toFixed(1);
        const haa=+(Math.atan(vxf/Math.abs(vyf))*(180/Math.PI)).toFixed(1);
        s.vaas.push(vaa); s.haas.push(haa);
      }

      // Spin rate
      const spin = parseFloat(r.release_spin_rate); if (!isNaN(spin)) s.spins.push(spin);

      const desc = r.description||'';
      const zone = (r.zone||'').trim();
      const inSZ = STRIKE_ZONES.has(zone);
      if (inSZ) inZone++; else if (zone) outZone++;
      const isSwing = desc.includes('swinging_strike')||desc.includes('foul')||desc==='hit_into_play'||desc==='foul_tip';
      const isContact = desc.includes('foul')||desc==='hit_into_play'||desc==='foul_tip';
      const isStrikeResult = desc.includes('swinging_strike')||desc.includes('called_strike')||desc.includes('foul')||desc==='hit_into_play'||desc==='foul_tip';

      // Plate location — store as [x, z, outcome, stand] for scatter plot
      const px = parseFloat(r.plate_x); const pz = parseFloat(r.plate_z);
      if (!isNaN(px) && !isNaN(pz)) {
        const outcome = desc.includes('swinging_strike') ? 'W' : desc.includes('called_strike') ? 'CS' : desc==='hit_into_play' ? 'HIP' : desc.includes('foul') ? 'F' : 'B';
        const loc = [+px.toFixed(2), +pz.toFixed(2), outcome, stand];
        s.locations.push(loc);
        if (side) side.locations.push(loc);
      }
      if (isSwing) { totalSwings++; if(inSZ){swingInZone++;if(isContact)contactInZone++;} else if(zone)swingOutZone++; }
      // Per-pitch-type swing/zone counts (Whiff/Swing, Zone%, Chase%, Z-Contact%)
      if (inSZ) s.zoneN++; else if (zone) s.outN++;
      if (isSwing) { s.swings++; if (side) side.swings = (side.swings||0) + 1; if (inSZ) { s.zSw++; if (isContact) s.zCon++; } else if (zone) s.oSw++; }
      // Pitch run value (Savant): delta_run_exp is from the batter's side, so pitcher RV = -delta_run_exp
      const dre = parseFloat(r.delta_run_exp);
      if (!isNaN(dre)) { s.rv = (s.rv||0) - dre; if (side) side.rv = (side.rv||0) - dre; }
      if (desc.includes('swinging_strike')) {
        s.whiffs++;
        if(side) side.whiffs++;
      } else if (desc.includes('called_strike')) {
        s.cstrikes++;
        if(side) side.cstrikes++;
      } else if (desc==='hit_into_play') {
        s.hip++;
        if(side) side.hip++;
        const ev = parseFloat(r.launch_speed); if(!isNaN(ev)){s.launch_speeds.push(ev);if(ev>=95)s.hard_hits++;if(side){side.launch_speeds.push(ev);if(ev>=95)side.hard_hits++;}}
        const xw = parseFloat(r.estimated_woba_using_speedangle); if(!isNaN(xw))s.xwobas.push(xw);
        const xba  = parseFloat(r.estimated_ba_using_speedangle);  if(!isNaN(xba)  && side) side.xbas.push(xba);
        const xslg = parseFloat(r.estimated_slg_using_speedangle); if(!isNaN(xslg) && side) side.xslgs.push(xslg);
        // Spray chart
        const hcx = parseFloat(r.hc_x); const hcy = parseFloat(r.hc_y);
        if (!isNaN(hcx) && !isNaN(hcy)) {
          const bbt = (r.bb_type||'').toLowerCase();
          const ev2 = parseFloat(r.launch_speed);
          s.spray.push([+hcx.toFixed(1), +hcy.toFixed(1), bbt, isNaN(ev2)?null:+ev2.toFixed(1), stand]);
        }
      }
      // Track strikes and BIP types per side
      const isStrikeDesc = desc.includes('swinging_strike')||desc.includes('called_strike')||desc.includes('foul')||desc==='hit_into_play'||desc==='foul_tip';
      if(isStrikeDesc && side) side.totalStrikes++;
      const bbt2 = (r.bb_type||'').toLowerCase();
      if(bbt2 && side){side.bip++;if(bbt2==='ground_ball')side.gb++;else if(bbt2==='fly_ball')side.fb++;else if(bbt2==='line_drive')side.ld++;}
      if (isStrikeResult) totalStrikes++;
      const bbt = (r.bb_type||'').toLowerCase();
      if (bbt){bipCount++;if(bbt==='ground_ball')gbCount++;else if(bbt==='fly_ball')fbCount++;else if(bbt==='line_drive')ldCount++;}
      const balls_n=parseInt(r.balls||0),strikes_n=parseInt(r.strikes||0);
      if (balls_n===0&&strikes_n===0){fp_total++;if(isStrikeResult)fp_strikes++;}
      if (balls_n===1&&strikes_n===1){oneone_total++;if(isStrikeResult)oneone_strikes++;}
    });

    const total = pitches.length;
    const allEVs = Object.values(pm).flatMap(s=>s.launch_speeds);
    const hardHits = Object.values(pm).reduce((a,s)=>a+s.hard_hits,0);
    const zonedP = inZone+outZone;
    // K / BB / HBP / H / HR / IP — full event list (strikeout double plays,
    // intentional walks, caught stealing and pickoffs were being missed)
    const line  = statcastLine(pitches);
    const ks = line.ks, walks = line.walks, hbp = line.hbp;
    const hrs = line.hrs, hits = line.hits, ip = line.ip;
    const avgg = arr => arr.length ? arr.reduce((a,b)=>a+b)/arr.length : null;

    const makeSplitStats = (side) => {
      const xba  = side.xbas.length  ? avgg(side.xbas)  : null;
      const xslg = side.xslgs.length ? avgg(side.xslgs) : null;
      return {
        count:    side.count,
        whiffs:   side.whiffs,
        cstrikes: side.cstrikes,
        hip:      side.hip,
        rv:       side.rv != null ? +side.rv.toFixed(2) : undefined,
        swings:   side.swings || 0,
        whiffPct: side.swings ? +(side.whiffs/side.swings*100).toFixed(1) : null,   // per swing
        cswPct:   side.count ? +((side.whiffs+side.cstrikes)/side.count*100).toFixed(1) : 0,
        strikePct:side.count ? +(side.totalStrikes/side.count*100).toFixed(1) : 0,
        avgVelo:  side.velos.length ? +avgg(side.velos).toFixed(1) : null,
        avgXba:   xba  !== null ? +xba.toFixed(3)  : null,
        avgXslg:  xslg !== null ? +xslg.toFixed(3) : null,
        avgXops:  (xba!==null&&xslg!==null) ? +(xba+xslg).toFixed(3) : null,
        avgEV:    side.launch_speeds.length ? +avgg(side.launch_speeds).toFixed(1) : null,
        hardHitPct:side.launch_speeds.length ? +(side.hard_hits/side.launch_speeds.length*100).toFixed(1) : null,
        gbPct:    side.bip ? +(side.gb/side.bip*100).toFixed(1) : null,
        fbPct:    side.bip ? +(side.fb/side.bip*100).toFixed(1) : null,
        ldPct:    side.bip ? +(side.ld/side.bip*100).toFixed(1) : null,
      };
    };
    const flatMap = {};
    Object.entries(pm).forEach(([pt,s]) => {
      if (!s.count) return;
      const xbas_all  = [...(s.lhh.xbas||[]), ...(s.rhh.xbas||[])];
      const xslgs_all = [...(s.lhh.xslgs||[]), ...(s.rhh.xslgs||[])];
      flatMap[pt] = {
        count:s.count, whiffs:s.whiffs, cstrikes:s.cstrikes, hip:s.hip,
        avgVelo:  s.velos.length  ? +avgg(s.velos).toFixed(1)  : null,
        peakVelo: s.velos.length  ? +Math.max(...s.velos).toFixed(1) : null,
        whiffPct: s.swings ? +(s.whiffs/s.swings*100).toFixed(1) : null,   // per swing
        cswPct:   +((s.whiffs+s.cstrikes)/s.count*100).toFixed(1),
        avgXwoba: s.xwobas.length ? +avgg(s.xwobas).toFixed(3) : null,
        avgXba:   xbas_all.length  ? +avgg(xbas_all).toFixed(3)  : null,
        avgXslg:  xslgs_all.length ? +avgg(xslgs_all).toFixed(3) : null,
        avgEV:    s.launch_speeds.length ? +avgg(s.launch_speeds).toFixed(1) : null,
        hardHitPct: s.launch_speeds.length ? +(s.hard_hits/s.launch_speeds.length*100).toFixed(1) : null,
        avgIVB:   s.pfx_zs.length ? +avgg(s.pfx_zs).toFixed(1) : null,
        avgHB:    s.pfx_xs.length ? +avgg(s.pfx_xs).toFixed(1) : null,
        avgVAA:   s.vaas.length   ? +avgg(s.vaas).toFixed(1)   : null,
        avgHAA:   s.haas.length   ? +avgg(s.haas).toFixed(1)   : null,
        avgSpin:  s.spins.length  ? +avgg(s.spins).toFixed(0)  : null,
        // Release point — release_pos_z (height, ft off the ground) and
        // release_pos_x (side, ft from the center of the rubber; sign
        // follows Statcast's raw convention, catcher's-view, NOT
        // hand-flipped like avgHB is).
        avgRelHeight: s.rel_zs.length ? +avgg(s.rel_zs).toFixed(2) : null,
        avgRelSide:   s.rel_xs.length ? +avgg(s.rel_xs).toFixed(2) : null,
        avgExt:       s.realExts.length ? +avgg(s.realExts).toFixed(2) : null,
        avgPercVelo:  s.effSpeeds.length ? +avgg(s.effSpeeds).toFixed(1) : null,
        swings:s.swings, zoneN:s.zoneN, outN:s.outN, zSw:s.zSw, oSw:s.oSw, zCon:s.zCon,
        bbe: s.launch_speeds.length,
        rv: s.rv != null ? +s.rv.toFixed(2) : undefined,
        avgArm: s.arms.length ? +avgg(s.arms).toFixed(1) : null,
        rp: s.rp || [],
        mv: s.mv || [],
        locations: s.locations || [],
        spray: s.spray || [],
        lhh: makeSplitStats(s.lhh),
        rhh: makeSplitStats(s.rhh),
      };
    });

    return {
      date, opponent:opp, total_pitches:total,
      whiffs:Object.values(pm).reduce((a,s)=>a+s.whiffs,0),
      calledStrikes:Object.values(pm).reduce((a,s)=>a+s.cstrikes,0),
      walks, ks, hrs, hits, ip, hbp,
      avgEV:allEVs.length?+avgg(allEVs).toFixed(1):null,
      hardHitPct:allEVs.length?+(hardHits/allEVs.length*100).toFixed(1):null,
      zonePct:    zonedP      ?+(inZone/zonedP*100).toFixed(1):null,
      oSwingPct:  outZone     ?+(swingOutZone/outZone*100).toFixed(1):null,
      zSwingPct:  inZone      ?+(swingInZone/inZone*100).toFixed(1):null,
      zContactPct:swingInZone ?+(contactInZone/swingInZone*100).toFixed(1):null,
      swingPct:   total       ?+(totalSwings/total*100).toFixed(1):null,
      strikePct:  total       ?+(totalStrikes/total*100).toFixed(1):null,
      gbPct:      bipCount    ?+(gbCount/bipCount*100).toFixed(1):null,
      fbPct:      bipCount    ?+(fbCount/bipCount*100).toFixed(1):null,
      ldPct:      bipCount    ?+(ldCount/bipCount*100).toFixed(1):null,
      fpStrikePct: fp_total    ?+(fp_strikes/fp_total*100).toFixed(1):null,
      oonStrikePct:oneone_total?+(oneone_strikes/oneone_total*100).toFixed(1):null,
      race2kPct:   race2k_total?+(race2k_hit/race2k_total*100).toFixed(1):null,
      putawayPct:  putaway_total?+(putaway_k/putaway_total*100).toFixed(1):null,
      sit: computeSituational(pitches),
      pitchMap: flatMap,
    };
  });
  return { pitcher, outings };
}

function parseTrackmanBulk(rows) {
  const PT_MAP = {
    'Fastball':'FF','Four-Seam':'FF','FourSeamFastBall':'FF',
    'Sinker':'SI','TwoSeamFastBall':'SI','Cutter':'FC',
    'Slider':'SL','Sweeper':'ST','Curveball':'CU','CurveBall':'CU',
    'Splitter':'FS','Split-Finger':'FS','Changeup':'CH','ChangeUp':'CH',
  };
  const pitcher = rows[0]?.pitcher || rows[0]?.Pitcher || 'Unknown';
  const games = {};
  rows.forEach(r => {
    const date = r.date || r.Date || '';
    if (!games[date]) games[date] = [];
    games[date].push(r);
  });

  const outings = Object.entries(games).sort((a,b)=>a[0].localeCompare(b[0])).map(([date, pitches]) => {
    const opp = pitches[0]?.batterteam || pitches[0]?.BatterTeam || '';
    const pm = {};
    pitches.forEach(r => {
      const tagged = r.taggedpitchtype || r.TaggedPitchType || '';
      const auto   = r.autopitchtype   || r.AutoPitchType   || '';
      const pt = PT_MAP[tagged] || PT_MAP[auto] || 'OTHER';
      if (!pm[pt]) pm[pt] = {count:0,velos:[],whiffs:0,cstrikes:0,hip:0,launch_speeds:[],ivbs:[],hbs:[],rel_xs:[],rel_zs:[],exts:[],percVelos:[],swings:0,lhh:{count:0,whiffs:0,cstrikes:0},rhh:{count:0,whiffs:0,cstrikes:0}};
      const s = pm[pt]; s.count++;
      const stand = (r.batterside||r.BatterSide||'').toUpperCase();
      const side = stand==='L'?s.lhh:stand==='R'?s.rhh:null;
      if(side) side.count++;
      const v = parseFloat(r.relspeed||r.RelSpeed); if(!isNaN(v))s.velos.push(v);
      const ivb=parseFloat(r.inducedvertbreak||r.InducedVertBreak); if(!isNaN(ivb))s.ivbs.push(ivb);
      const hb=parseFloat(r.horzbreak||r.HorzBreak); if(!isNaN(hb))s.hbs.push(hb);
      // Trackman release point — RelHeight/RelSide (feet)
      const rh=parseFloat(r.relheight||r.RelHeight); if(!isNaN(rh))s.rel_zs.push(rh);
      const rs=parseFloat(r.relside||r.RelSide); if(!isNaN(rs))s.rel_xs.push(rs);
      // Trackman extension (ft). Trackman has no perceived-velo column, so
      // estimate it per pitch: velo scaled by MLB-avg release distance
      // (60.5 - 6.3 ft) over this pitch's actual release distance.
      const ex=parseFloat(r.extension||r.Extension); if(!isNaN(ex)){s.exts.push(ex); if(!isNaN(v)&&ex<60.5)s.percVelos.push(v*(60.5-6.3)/(60.5-ex));}
      const call = r.pitchcall||r.PitchCall||'';
      if(call.includes('SwingingStrike')||call==='StrikeSwinging'||call.includes('Foul')||call==='InPlay'){s.swings++;if(side)side.swings=(side.swings||0)+1;}
      if(call.includes('SwingingStrike')||call==='StrikeSwinging'){s.whiffs++;if(side)side.whiffs++;}
      else if(call.includes('CalledStrike')||call==='StrikeCalled'){s.cstrikes++;if(side)side.cstrikes++;}
      else if(call==='InPlay'){s.hip++;const ev=parseFloat(r.exitspeed||r.ExitSpeed);if(!isNaN(ev))s.launch_speeds.push(ev);}
      const korbb=r.korbb||r.KorBB||'';
      if(korbb==='Strikeout'){}; // handled above
    });
    const total=pitches.length;
    // Trackman imports never saved IP / H / HR, so FIP was blank or wrong for them
    const tmLine=trackmanLine(pitches);
    const ks=tmLine.ks, walks=tmLine.walks;
    const avgg=arr=>arr.length?arr.reduce((a,b)=>a+b)/arr.length:null;
    const flatMap={};
    Object.entries(pm).forEach(([pt,s])=>{
      if(!s.count)return;
      flatMap[pt]={
        count:s.count,whiffs:s.whiffs,cstrikes:s.cstrikes,hip:s.hip,
        avgVelo:s.velos.length?+avgg(s.velos).toFixed(1):null,
        peakVelo:s.velos.length?+Math.max(...s.velos).toFixed(1):null,
        whiffPct:s.swings?+(s.whiffs/s.swings*100).toFixed(1):null,
        cswPct:+((s.whiffs+s.cstrikes)/s.count*100).toFixed(1),
        avgIVB:s.ivbs.length?+avgg(s.ivbs).toFixed(1):null,
        avgHB:s.hbs.length?+avgg(s.hbs).toFixed(1):null,
        avgEV:s.launch_speeds.length?+avgg(s.launch_speeds).toFixed(1):null,
        avgXwoba:null,
        avgRelHeight:s.rel_zs.length?+avgg(s.rel_zs).toFixed(2):null,
        avgRelSide:s.rel_xs.length?+avgg(s.rel_xs).toFixed(2):null,
        avgExt:s.exts.length?+avgg(s.exts).toFixed(2):null,
        avgPercVelo:s.percVelos.length?+avgg(s.percVelos).toFixed(1):null,
        hardHitPct:s.launch_speeds.length?+(s.launch_speeds.filter(v=>v>=95).length/s.launch_speeds.length*100).toFixed(1):null,
        bbe:s.launch_speeds.length,
        swings:s.swings,
        lhh:{count:s.lhh.count,whiffs:s.lhh.whiffs,cstrikes:s.lhh.cstrikes,swings:s.lhh.swings||0,whiffPct:s.lhh.swings?+(s.lhh.whiffs/s.lhh.swings*100).toFixed(1):null,cswPct:s.lhh.count?+((s.lhh.whiffs+s.lhh.cstrikes)/s.lhh.count*100).toFixed(1):0},
        rhh:{count:s.rhh.count,whiffs:s.rhh.whiffs,cstrikes:s.rhh.cstrikes,swings:s.rhh.swings||0,whiffPct:s.rhh.swings?+(s.rhh.whiffs/s.rhh.swings*100).toFixed(1):null,cswPct:s.rhh.count?+((s.rhh.whiffs+s.rhh.cstrikes)/s.rhh.count*100).toFixed(1):0},
      };
    });
    // Parse date from M/D/YY
    let isoDate = date;
    if (date.includes('/')) { const [m,d,y]=date.split('/'); isoDate=`20${y.slice(-2)}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
    return {date:isoDate,opponent:opp,total_pitches:total,whiffs:Object.values(pm).reduce((a,s)=>a+s.whiffs,0),calledStrikes:Object.values(pm).reduce((a,s)=>a+s.cstrikes,0),walks,ks,hbp:tmLine.hbp,hrs:tmLine.hrs,hits:tmLine.hits,ip:tmLine.ip,avgEV:null,hardHitPct:null,zonePct:null,oSwingPct:null,zSwingPct:null,zContactPct:null,swingPct:null,strikePct:null,gbPct:null,fbPct:null,ldPct:null,fpStrikePct:null,oonStrikePct:null,pitchMap:flatMap};
  });
  return { pitcher, outings };
}

let bulkImportRunning = false;
async function runBulkImport() {
  // FIX (bug #2): the button disable used to happen AFTER the
  // `await api('getOutings', ...)` call below. That left a window where
  // a double-click (or any duplicate trigger) fired this function twice
  // before either call had disabled the button. Each of those two
  // concurrent runs fetched its own "existing outings" snapshot before
  // the other had written anything, so neither saw the other's rows as
  // duplicates — and the entire batch got imported twice (10 outings
  // recorded as 20). Guard + disable now happen synchronously, first
  // thing, before any await.
  if (bulkImportRunning) return;
  const athleteId = document.getElementById('bulk-athlete-select').value;
  if (!athleteId || !bulkOutings.length) return;

  bulkImportRunning = true;
  document.getElementById('bulk-import-btn').disabled = true;
  document.getElementById('bulk-import-btn').textContent = 'Importing...';
  document.getElementById('bulk-progress-wrap').style.display = '';

  // Check for duplicates against existing outings
  const existingRes = await api('getOutings', { athleteId });
  const existingByDate = {};
  (existingRes.outings||[]).forEach(o => { const d = o.date?.toString().split('T')[0]; (existingByDate[d] = existingByDate[d] || []).push(o.id); });
  const existingDates = new Set(Object.keys(existingByDate));
  const replaceExisting = !!document.getElementById('bulk-replace')?.checked;

  let done=0, skipped=0, errors=0;

  for (let i=0; i<bulkOutings.length; i++) {
    const o = bulkOutings[i];
    const row = document.getElementById(`bulk-row-${i}`);
    const status = document.getElementById(`bulk-status-${i}`);

    // Check duplicate
    const dateKey = o.date?.toString().split('T')[0];
    if (existingDates.has(dateKey) && replaceExisting) {
      // Replace mode: delete the old outing(s) for this date, then re-add below
      try {
        status.textContent = 'Replacing...';
        for (const oid of existingByDate[dateKey]) await apiWithRetry('deleteOuting', { athleteId, outingId: oid });
      } catch(e) {
        row.className = 'bulk-outing-row error';
        status.style.color = 'var(--danger)';
        status.textContent = '✗ Could not replace';
        status.title = e.message || '';
        errors++;
        document.getElementById('bulk-progress-bar').style.width = ((i+1)/bulkOutings.length*100)+'%';
        continue;
      }
    } else if (existingDates.has(dateKey)) {
      row.className = 'bulk-outing-row skip';
      status.style.color = 'var(--muted2)';
      status.textContent = '— Skipped (exists)';
      skipped++;
      document.getElementById('bulk-progress-bar').style.width = ((i+1)/bulkOutings.length*100)+'%';
      continue;
    }

    row.className = 'bulk-outing-row active';
    status.style.color = 'var(--cyan)';
    status.textContent = 'Saving...';

    try {
      const cleanMap = {};
      Object.entries(o.pitchMap).forEach(([pt,s]) => { if(s.count>0) cleanMap[pt]=s; });
      // Retry up to 2x. Apps Script often finishes the write but the
      // response gets lost on the googleusercontent redirect, so the
      // first attempt "fails" even though the row saved. Retrying is
      // safe: addOuting dedupes on athlete+date and returns success.
      await apiWithRetry('addOuting', {
        athleteId,
        date: o.date,
        opponent: o.opponent,
        notes: '',
        sit: o.sit || null,
        pitchMap: cleanMap,
        stats: {
          total: o.total_pitches, whiffs: o.whiffs, calledStrikes: o.calledStrikes,
          walks: o.walks, ks: o.ks, hbp: o.hbp||0, hrs: o.hrs||0, hits: o.hits||0, ip: o.ip||0, avgEV: o.avgEV, hardHitPct: o.hardHitPct,
          zonePct: o.zonePct, oSwingPct: o.oSwingPct, zSwingPct: o.zSwingPct,
          zContactPct: o.zContactPct, swingPct: o.swingPct, strikePct: o.strikePct,
          gbPct: o.gbPct, fbPct: o.fbPct, ldPct: o.ldPct,
          fpStrikePct: o.fpStrikePct, oonStrikePct: o.oonStrikePct,
          race2kPct: o.race2kPct, putawayPct: o.putawayPct,
        }
      });
      row.className = 'bulk-outing-row done';
      status.style.color = 'var(--good)';
      status.textContent = '✓ Saved';
      done++;
      // Also record this date as now-existing so a duplicate date
      // later in the SAME csv/run gets skipped too, not just re-checked
      // against the pre-import snapshot.
      existingDates.add(dateKey);
    } catch(e) {
      row.className = 'bulk-outing-row error';
      status.style.color = 'var(--danger)';
      status.textContent = '✗ Error';
      status.title = e.message || 'Unknown error';   // hover to see reason
      console.error(`Bulk import failed for ${o.date} vs ${o.opponent}:`, e);
      errors++;
    }

    document.getElementById('bulk-progress-bar').style.width = ((i+1)/bulkOutings.length*100)+'%';
    await new Promise(r => setTimeout(r, 500));
  }

  const title = errors===0
    ? `✓ ${done} outing${done!==1?'s':''} imported successfully`
    : `${done} imported · ${errors} failed · ${skipped} skipped`;
  const body = skipped > 0
    ? `${skipped} outing${skipped!==1?'s':''} were skipped because they already exist for this athlete.`
    : `All outings saved. Head to the athlete profile to view the updated season data.`;

  document.getElementById('bulk-result-title').textContent = title;
  document.getElementById('bulk-result-body').textContent = body;
  document.getElementById('bulk-result').style.display = '';

  bulkImportRunning = false;
  document.getElementById('bulk-import-btn').disabled = false;
  document.getElementById('bulk-import-btn').textContent = 'Import All Outings';
}

function renderProfileHero() {
  const a = currentAthlete;
  const initials = a.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent = a.name;
  document.getElementById('profile-meta').innerHTML =
    `<span class="hero-meta-item">${a.throws}HP</span>
     <span class="hero-meta-item">${a.position}</span>
     <span class="hero-meta-item">${a.team || '—'}</span>
     <span class="hero-meta-item">${a.level || '—'}</span>`;
  document.getElementById('profile-hero').style.opacity = '1';

  // Last CSV updated — most recent outing import timestamp
  const lastUpdatedEl = document.getElementById('profile-last-updated');
  if (lastUpdatedEl) {
    const createdDates = athleteOutings.map(o => o.createdAt).filter(Boolean).sort();
    const latest = createdDates.length ? createdDates[createdDates.length-1] : null;
    lastUpdatedEl.textContent = latest ? `Last CSV updated: ${formatDate(latest)}` : 'No outings imported yet';
  }

  const totalPitches = athleteOutings.reduce((a,o)=>a+(+o.total_pitches||0), 0);
  const totalK  = athleteOutings.reduce((a,o)=>a+(+o.strikeouts||0), 0);
  const totalBB = athleteOutings.reduce((a,o)=>a+(+o.walks||0), 0);
  const totalHR = athleteOutings.reduce((a,o)=>a+(+o.hrs||0), 0);
  const totalH  = athleteOutings.reduce((a,o)=>a+(+o.hits||0), 0);
  const totalWhiffs = athleteOutings.reduce((a,o)=>a+(+o.whiffs||0), 0);
  const totalIP = athleteOutings.reduce((a,o)=>a+Math.round((+o.ip||0)*3), 0) / 3;   // via outs (ip is stored as outs/3)
  const totalHBP = athleteOutings.reduce((a,o)=>a+(+o.hbp||0), 0);

  const whiffSwSeason = outingsWhiffSw(athleteOutings);
  const whiffRate = whiffSwSeason !== null ? whiffSwSeason.toFixed(1) : '—';

  const fipV = calcFIP(totalHR, totalBB, totalHBP, totalK, totalIP, fipConstantForOutings(athleteOutings, currentAthlete));
  const fip = fipV !== null ? fipV.toFixed(2) : '—';

  // WHIP = (BB + H) / IP
  const whip = totalIP > 0
    ? ((totalBB + totalH) / totalIP).toFixed(2)
    : '—';

  // K%-BB%
  const totalBIP = athleteOutings.reduce((a,o) => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    return a + Object.values(pm).reduce((s,p)=>s+(p.hip||0), 0);
  }, 0);
  const totalPA = totalK + totalBB + totalBIP;
  const kPct  = totalPA ? (totalK/totalPA*100).toFixed(1) : null;
  const bbPct = totalPA ? (totalBB/totalPA*100).toFixed(1) : null;
  const kMinusBB = (kPct !== null && bbPct !== null)
    ? `${(parseFloat(kPct)-parseFloat(bbPct)).toFixed(1)}%`
    : '—';

  // Use org stats if available
  const heroKey = (currentAthlete.name||'').toLowerCase();
  const orgHero = (typeof SEASON_STATS !== 'undefined') ? SEASON_STATS?.[heroKey] : null;
  const displayFIP  = orgHero ? orgHero.fip.toFixed(2)  : fip;
  const displayWHIP = orgHero ? orgHero.whip.toFixed(2) : whip;
  const displayKBB  = orgHero ? `${orgHero.kMinusBB}%`  : kMinusBB;

  document.getElementById('profile-kpis').innerHTML = [
    { v: athleteOutings.length, l: 'Outings' },
    { v: displayFIP,            l: 'FIP'     },
    { v: displayWHIP,           l: 'WHIP'    },
    { v: whiffRate+'%',         l: 'Whiff%'  },
    { v: displayKBB,            l: 'K%-BB%'  },
  ].map(k => `<div class="kpi"><div class="kpi-val mono">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('');
}

/* ==================== xARSENAL GRADES (8ctane pitch grading) ==================== */
// Scored by the Cloudflare Worker (?action=scoreArsenal) so the benchmarks
// stay private. Inputs are the season's count-weighted pitch shape; spin
// efficiency is estimated in the Worker (not in Statcast/Trackman exports).
const XA_MIN_SHARE = 0.03, XA_MIN_COUNT = 10;   // ignore tiny-sample pitch types
const xaCache = {};

function xaSeasonShape(outings, minCount = XA_MIN_COUNT, minShare = XA_MIN_SHARE) {
  const acc = {};
  outings.forEach(o => Object.entries(o.pitch_stats || {}).forEach(([pt, s]) => {
    if (!s || !s.count) return;
    const a = acc[pt] = acc[pt] || { count:0, sums:{}, ws:{} };
    a.count += s.count;
    [['velocity','avgVelo'],['spinRate','avgSpin'],['ivb','avgIVB'],['hb','avgHB'],['extension','avgExt'],['vaa','avgVAA']].forEach(([k, f]) => {
      const v = s[f]; if (v === null || v === undefined || v === '' || isNaN(+v)) return;
      a.sums[k] = (a.sums[k]||0) + (+v) * s.count; a.ws[k] = (a.ws[k]||0) + s.count;
    });
  }));
  const total = Object.values(acc).reduce((t, a) => t + a.count, 0);
  return Object.entries(acc)
    .filter(([pt, a]) => a.count >= minCount && a.count / (total||1) >= minShare)
    .map(([pt, a]) => {
      const p = { key: pt, code: pt };
      ['velocity','spinRate','ivb','hb','extension','vaa'].forEach(k => { p[k] = a.ws[k] ? +(a.sums[k] / a.ws[k]).toFixed(2) : null; });
      return p;
    });
}

async function getXArsenal(outings) {
  const pitches = xaSeasonShape(outings);
  if (!pitches.length) return null;
  const body = { hand: currentAthlete?.throws || 'R', level: currentAthlete?.level || '', veloWeighted: true, pitches };
  const key = JSON.stringify(body);
  if (!xaCache[key]) xaCache[key] = api('scoreArsenal', body).catch(e => { delete xaCache[key]; throw e; });
  return xaCache[key];
}

const xaClass = sc => sc == null ? 'v-num' : sc >= 70 ? 'v-good' : sc >= 55 ? 'v-num' : sc >= 45 ? 'v-warn' : 'v-bad';
const XA_METRIC_LBL = { velocity:'Velo', spinRate:'Spin', ivb:'IVB', hb:'HB', extension:'Ext', vaa:'VAA', spinEfficiency:'Spin eff' };
function xaTitle(r) {
  const parts = Object.entries(r.metrics).filter(([, m]) => m.score !== null && m.importance).map(([k, m]) => `${XA_METRIC_LBL[k]} ${m.score}`);
  return `xArsenal ${r.score} (${r.grade}, ${r.gradeLabel}) · graded as ${r.subtype}` +
    (parts.length ? ` · ${parts.join(' · ')}` : '') +
    (r.spinEffEstimated && r.spinEfficiency !== null ? ` · spin eff ~${r.spinEfficiency}% (estimated)` : '');
}

// Fill every [data-xa-pt] element in `root` from the xArsenal result
async function fillXArsenal(root, outings, summaryEl) {
  const cells = root.querySelectorAll('[data-xa-pt]');
  try {
    const res = await getXArsenal(outings);
    const byPt = {}; (res?.pitches || []).forEach(r => { byPt[r.key] = r; });
    cells.forEach(el => {
      const r = byPt[el.dataset.xaPt];
      if (!r) { el.innerHTML = '<span class="v-num">—</span>'; el.title = 'Not graded — too few pitches or pitch type not covered'; return; }
      el.className = (el.dataset.xaBase || '') + ' ' + xaClass(r.score);
      el.title = xaTitle(r);
      el.innerHTML = `<b>${r.score}</b> <span class="xa-letter">${r.grade}</span>`;
    });
    if (summaryEl) {
      summaryEl.innerHTML = res && res.pitches.length
        ? `<span class="xa-sum-lbl">xArsenal</span> <b class="${xaClass(res.arsenalScore)}">${res.arsenalScore}</b> <span class="xa-letter">${res.arsenalGrade}</span> <span class="xa-sum-sub">${res.arsenalLabel} · graded at ${res.compLevel} level</span>`
        : '';
    }
  } catch (e) {
    const msg = /Unknown action/i.test(e.message || '') ? 'Grades need the updated Cloudflare Worker' : 'Could not load grades: ' + (e.message || '');
    cells.forEach(el => { el.innerHTML = '<span class="v-num">—</span>'; el.title = msg; });
    if (summaryEl) summaryEl.innerHTML = `<span class="xa-sum-sub">${msg}</span>`;
  }
}

// ---- Per-outing grades (one batched Worker call for the whole season) ----
const XA_OUTING_MIN = 5;   // pitches of a type needed in an outing to grade it
const xaOutingCache = {};
async function getXArsenalByOuting(outings) {
  const hand = currentAthlete?.throws || 'R', level = currentAthlete?.level || '';
  const items = outings.map(o => ({ id: o.id, hand, level, veloWeighted: true, pitches: xaSeasonShape([o], XA_OUTING_MIN, 0) }))
                       .filter(it => it.pitches.length);
  if (!items.length) return {};
  const key = JSON.stringify(items);
  if (!xaOutingCache[key]) xaOutingCache[key] = api('scoreArsenal', { items })
    .then(res => { const m = {}; (res.results || []).forEach(r => { m[r.id] = r; }); return m; })
    .catch(e => { delete xaOutingCache[key]; throw e; });
  return xaOutingCache[key];
}

// Outings list: grade chips per outing, with change vs the season grade
async function fillOutingGrades() {
  const els = document.querySelectorAll('#outings-list [data-xa-outing]');
  if (!els.length) return;
  try {
    const [byOuting, season] = await Promise.all([getXArsenalByOuting(athleteOutings), getXArsenal(athleteOutings).catch(() => null)]);
    const seasonBy = {}; (season?.pitches || []).forEach(r => { seasonBy[r.key] = r.score; });
    els.forEach(el => {
      const res = byOuting[el.dataset.xaOuting];
      if (!res || !res.pitches.length) { el.innerHTML = ''; return; }
      el.innerHTML = `<span class="xa-out-lbl">xArsenal</span><span class="xa-out-total ${xaClass(res.arsenalScore)}">${res.arsenalScore}</span>` +
        res.pitches.sort((a, b) => b.score - a.score).map(r => {
          const s = seasonBy[r.key];
          const d = s !== undefined ? r.score - s : null;
          const dTxt = d === null ? '' : d === 0 ? '<span class="xa-d0">=</span>' : `<span class="${d > 0 ? 'delta-good' : 'delta-bad'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
          return `<span class="xa-chip" style="border-color:${pc(r.key)}66" title="${xaTitle(r)}${s !== undefined ? ` · season ${s}` : ''}"><span class="pitch-dot" style="background:${pc(r.key)}"></span>${r.key} <b class="${xaClass(r.score)}">${r.score}</b> ${dTxt}</span>`;
        }).join('');
    });
  } catch (e) {
    els.forEach(el => { el.innerHTML = ''; });
  }
}

/* ==================== xARSENAL TAB ==================== */
let xaTabChart = null;
function xaValue(k, p, r) {
  const v = k === 'spinEfficiency' ? r.spinEfficiency : p?.[k];
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (k === 'velocity') return (+v).toFixed(1) + ' mph';
  if (k === 'spinRate') return Math.round(v) + ' rpm';
  if (k === 'ivb') return (+v).toFixed(1) + '"';
  if (k === 'hb') return aiHB(v, aiIsLefty());
  if (k === 'extension') return (+v).toFixed(1) + ' ft';
  if (k === 'vaa') return (+v).toFixed(1) + '°';
  if (k === 'spinEfficiency') return '~' + v + '%' + (r.spinEffEstimated ? ' est.' : '');
  return v;
}
const XA_STATUS_LBL = { elite:'Elite', above_avg:'Above avg', avg:'Average', below_avg:'Below avg', poor:'Poor' };
const XA_STATUS_CLS = { elite:'xa-s-elite', above_avg:'xa-s-above', avg:'xa-s-avg', below_avg:'xa-s-below', poor:'xa-s-poor' };

function xaWhy(r) {
  const ms = Object.entries(r.metrics).filter(([, m]) => m.score !== null && (m.importance === 'primary' || m.importance === 'secondary'));
  const strong = ms.filter(([, m]) => m.score >= 65).sort((a, b) => b[1].score - a[1].score);
  const weak = ms.filter(([, m]) => m.score < 50).sort((a, b) => a[1].score - b[1].score);
  const nm = ([k, m]) => `${XA_METRIC_LBL[k]} (${m.score})`;
  const parts = [];
  if (strong.length) parts.push(`Carried by ${strong.slice(0, 2).map(nm).join(' and ')}.`);
  if (weak.length) parts.push(`Held back by ${weak.slice(0, 2).map(nm).join(' and ')}.`);
  if (!parts.length) parts.push('Grades out evenly — no key metric far above or below average.');
  return `Graded as a <b>${r.subtype}</b>. ` + parts.join(' ');
}

async function renderXArsenalTab() {
  const el = document.getElementById('xarsenal-content');
  el.innerHTML = '<div class="ai-loading"><div class="loading-spinner"></div><p>Grading arsenal...</p></div>';
  const inputs = {}; xaSeasonShape(athleteOutings).forEach(p => { inputs[p.key] = p; });
  let res;
  try { res = await getXArsenal(athleteOutings); }
  catch (e) {
    el.innerHTML = `<div class="empty-state">${/Unknown action/i.test(e.message||'') ? 'Grades need the updated Cloudflare Worker.' : 'Could not load grades: ' + e.message}</div>`;
    return;
  }
  if (!res || !res.pitches.length) { el.innerHTML = '<div class="empty-state">Not enough pitch data this season to grade.</div>'; return; }

  const order = ['velocity','spinRate','ivb','hb','extension','vaa','spinEfficiency'];
  const impRank = { primary:0, secondary:1, minor:2 };
  const cards = [...res.pitches].sort((a, b) => b.score - a.score).map(r => {
    const p = inputs[r.key];
    const rows = order.filter(k => r.metrics[k].importance && r.metrics[k].score !== null)
      .sort((a, b) => impRank[r.metrics[a].importance] - impRank[r.metrics[b].importance])
      .map(k => { const m = r.metrics[k];
        return `<div class="xa-mrow">
          <div class="xa-mlbl">${XA_METRIC_LBL[k]} <span class="xa-imp xa-imp-${m.importance}">${m.importance}</span></div>
          <div class="xa-mval">${xaValue(k, p, r)}</div>
          <div class="xa-mbar"><div class="xa-mfill ${XA_STATUS_CLS[m.status]}" style="width:${Math.min(100, m.score / 107 * 100)}%"></div><div class="xa-mavg"></div></div>
          <div class="xa-mscore"><b>${m.score}</b> <span>${XA_STATUS_LBL[m.status]}</span></div>
        </div>`; }).join('');
    const lev = (r.levers || []).map(l => `<li><b class="delta-good">+${l.gain}</b> with ${l.direction}${l.metric === 'spinEfficiency' && r.spinEffEstimated ? ' <span class="xa-muted">(estimated metric)</span>' : ''}</li>`).join('');
    return `<div class="xa-card" style="border-top-color:${pc(r.key)}">
      <div class="xa-card-hd">
        <span class="pitch-dot" style="background:${pc(r.key)}"></span><span class="xa-card-name">${pn(r.key)}</span>
        <span class="xa-card-score ${xaClass(r.score)}">${r.score}</span><span class="xa-card-grade">${r.grade}<br><small>${r.gradeLabel}</small></span>
      </div>
      <div class="xa-why">${xaWhy(r)}</div>
      <div class="xa-mrows">${rows}</div>
      ${lev ? `<div class="xa-lev-hd">Biggest levers</div><ul class="xa-lev">${lev}</ul>` : '<div class="xa-lev-hd">Every key metric is already grading as good or better.</div>'}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="xa-summary-card">
      <div class="xa-sum-score ${xaClass(res.arsenalScore)}">${res.arsenalScore}</div>
      <div>
        <div class="xa-sum-title">xArsenal ${res.arsenalGrade} · ${res.arsenalLabel} <span class="xa-muted">— ${seasonLabel()} · graded at ${res.compLevel} level</span></div>
        <div class="xa-sum-desc">${res.description || ''}</div>
      </div>
    </div>
    <div class="xa-cards">${cards}</div>
    <div class="section" style="margin-top:1.5rem">
      <div class="section-hd">Grade by outing</div>
      <div class="chart-card"><div class="chart-wrap" style="height:260px"><canvas id="xa-trend-chart" role="img" aria-label="xArsenal grade by outing"></canvas></div></div>
      <div class="chart-footnote">Each point = that pitch's grade in one outing (min ${XA_OUTING_MIN} pitches) · 60 ≈ MLB average · Scale: 35 below avg, 60 avg, 80 good, 100 elite</div>
    </div>
    <div class="chart-footnote">Bars show each metric's score (60 ≈ average, marked). "Primary" metrics drive most of the grade. Spin efficiency is estimated from velo, spin and movement. Levers = points gained if that one metric reached "good."</div>`;

  // Grade-by-outing chart
  try {
    const byOuting = await getXArsenalByOuting(athleteOutings);
    const sortedO = [...athleteOutings].sort((a, b) => a.date.localeCompare(b.date)).filter(o => byOuting[o.id]);
    const pts = res.pitches.map(r => r.key);
    if (xaTabChart) xaTabChart.destroy();
    const cv = document.getElementById('xa-trend-chart');
    if (cv && sortedO.length) xaTabChart = new Chart(cv, {
      type: 'line',
      data: { labels: sortedO.map(o => formatDate(o.date)),
        datasets: pts.map(pt => ({ label: pn(pt), borderColor: pc(pt), backgroundColor: pc(pt), spanGaps: true, tension: .25, pointRadius: 3,
          data: sortedO.map(o => byOuting[o.id].pitches.find(r => r.key === pt)?.score ?? null) })) },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:'#72747c', font:{ size:11, family:'DM Mono' } } },
          tooltip:{ callbacks:{ afterLabel: ctx => { const o = sortedO[ctx.dataIndex]; return o.opponent ? 'vs ' + o.opponent : ''; } } } },
        scales:{ y:{ suggestedMin:30, suggestedMax:90, ticks:{ color:'#72747c' }, grid:{ color:'rgba(255,255,255,0.04)' } },
                 x:{ ticks:{ color:'#72747c', maxRotation:0, autoSkip:true, maxTicksLimit:10 }, grid:{ display:false } } } }
    });
  } catch (e) {}
}

/* ==================== PITCH USAGE BY BATTER SIDE (Savant-style) ==================== */
function renderUsageChart() {
  const el = document.getElementById('season-usage');
  if (!el) return;
  const acc = {};
  athleteOutings.forEach(o => Object.entries(o.pitch_stats || {}).forEach(([pt, s]) => {
    if (!s || !s.count) return;
    const a = acc[pt] = acc[pt] || { L:0, R:0, rvL:0, rvR:0, hasRV:false, n:0 };
    a.n += s.count;
    if (s.lhh) { a.L += s.lhh.count || 0; if (s.lhh.rv != null) { a.rvL += +s.lhh.rv; a.hasRV = true; } }
    if (s.rhh) { a.R += s.rhh.count || 0; if (s.rhh.rv != null) { a.rvR += +s.rhh.rv; a.hasRV = true; } }
  }));
  const totL = Object.values(acc).reduce((t, a) => t + a.L, 0), totR = Object.values(acc).reduce((t, a) => t + a.R, 0);
  if (!totL && !totR) { el.innerHTML = ''; return; }
  const rows = Object.entries(acc).filter(([pt, a]) => pt !== 'OTHER' && (a.L + a.R) > 0)
    .sort((x, y) => (y[1].L + y[1].R) - (x[1].L + x[1].R));
  const anyRV = rows.some(([, a]) => a.hasRV);
  const pctTxt = p => p > 0 && p < 1 ? '<1%' : Math.round(p) + '%';
  const rvTxt = (v, has) => {
    if (!has) return '<span class="us-rv us-rv0">—</span>';
    const r = Math.round(v);
    return `<span class="us-rv ${r > 0 ? 'us-rv-pos' : r < 0 ? 'us-rv-neg' : 'us-rv0'}">${r > 0 ? '+' + r : r}</span>`;
  };
  const maxP = Math.max(1, ...rows.map(([, a]) => Math.max(totL ? a.L / totL * 100 : 0, totR ? a.R / totR * 100 : 0)));
  el.innerHTML = `
    <div class="us-title"><span class="us-year">${seasonLabel()}</span> Pitch Usage</div>
    <div class="us-grid">
      <div class="us-hd us-hd-l">Usage vs. LHH</div><div class="us-hd us-hd-c">${anyRV ? 'Pitch Run Value' : ''}</div><div class="us-hd us-hd-r">Usage vs. RHH</div>
      ${rows.map(([pt, a]) => {
        const pL = totL ? a.L / totL * 100 : 0, pR = totR ? a.R / totR * 100 : 0;
        return `
        <div class="us-side us-left"><span class="us-pct">${pctTxt(pL)}</span><div class="us-bar-wrap us-wrap-l"><div class="us-bar" style="width:${pL / maxP * 100}%;background:${pc(pt)}"></div></div></div>
        <div class="us-mid">${anyRV ? rvTxt(a.rvL, a.hasRV) : ''}<span class="us-pill" style="background:${pc(pt)}">${pn(pt)}</span>${anyRV ? rvTxt(a.rvR, a.hasRV) : ''}</div>
        <div class="us-side us-right"><div class="us-bar-wrap"><div class="us-bar" style="width:${pR / maxP * 100}%;background:${pc(pt)}"></div></div><span class="us-pct">${pctTxt(pR)}</span></div>`;
      }).join('')}
    </div>
    <div class="chart-footnote">${anyRV ? 'Pitch run value = runs saved by that pitch vs. each side (positive = good for the pitcher). ' : 'Pitch run value appears once outings are re-imported from Statcast. '}${totL} pitches vs. LHH · ${totR} vs. RHH</div>`;
}

/* ==================== SEASON OVERVIEW ==================== */
function renderSeasonOverview() {
  // Aggregate all pitch stats across all outings
  const combined = {};
  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats === 'object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json || '{}'); } catch(e) {}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!combined[pt]) combined[pt] = { count:0, velos:[], whiffs:0, cstrikes:0, hip:0, xwobas:[], ivbs:[], hbs:[], veloW:0, veloN:0, xwW:0, xwN:0, swings:0, swWhiffs:0 };
      const c = combined[pt];
      // Weighted season averages (by pitches / balls in play)
      if (s.avgVelo && s.count)  { c.veloW += pf(s.avgVelo)*s.count; c.veloN += s.count; }
      if (s.avgXwoba && s.hip)   { c.xwW += pf(s.avgXwoba)*s.hip;    c.xwN += s.hip; }
      if (s.swings) { c.swings += s.swings; c.swWhiffs += s.swWhiffs||0; }
      c.count += (s.count||0);
      c.whiffs += (s.whiffs||0);
      c.cstrikes += (s.cstrikes||0);
      c.hip += (s.hip||0);
      if (s.avgVelo) c.velos.push(pf(s.avgVelo));
      if (s.avgXwoba) c.xwobas.push(pf(s.avgXwoba));
      if (s.avgIVB != null && s.avgIVB !== '') c.ivbs.push(pf(s.avgIVB));
      if (s.avgHB != null && s.avgHB !== '') c.hbs.push(pf(s.avgHB));
    });
  });

  const total = Object.values(combined).reduce((a,s)=>a+s.count, 0);
  const sorted = Object.entries(combined).sort((a,b)=>b[1].count-a[1].count);

  document.getElementById('season-arsenal-body').innerHTML = sorted.map(([pt, s]) => {
    const usagePct = total ? (s.count/total*100).toFixed(1) : 0;
    const whiffN = wps(s.swWhiffs, s.swings);   // Whiff/Swing
    const whiff = whiffN !== null ? whiffN.toFixed(1) : '—';
    const csw   = s.count ? ((s.whiffs+s.cstrikes)/s.count*100).toFixed(1) : '—';
    const avgV  = s.veloN ? (s.veloW/s.veloN).toFixed(1) : (s.velos.length ? avg(s.velos).toFixed(1) : '—');
    const xwoba = s.xwN ? (s.xwW/s.xwN).toFixed(3) : (s.xwobas.length ? avg(s.xwobas).toFixed(3) : '—');
    const mlbW  = MLB_BASELINE_REF[pt]?.whiff_pct;
    // Whiff/Swing color bands vs its own pitch type's MLB average
    const wC    = whiffN === null ? 'v-num' : mlbW ? (whiffN >= mlbW + 2 ? 'v-good' : whiffN >= mlbW - 2 ? 'v-warn' : 'v-bad') : (whiffN >= 30 ? 'v-good' : whiffN >= 20 ? 'v-warn' : 'v-bad');
    const mlbTag = (mlbW && whiffN !== null) ? (() => {
      const d = whiffN - mlbW;
      return `${mlbW}% <span class="${d>=0?'delta-good':'delta-bad'}">${d>=0?'▲':'▼'}${Math.abs(d).toFixed(1)}</span>`;
    })() : (mlbW ? `${mlbW}%` : '—');


    return `<tr>
      <td><span class="pitch-chip"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span></td>
      <td class="v-num">${s.count}</td>
      <td class="v-num">${usagePct}%</td>
      <td class="v-num">${avgV}</td>
      <td data-xa-pt="${pt}" title="Loading xArsenal grade…"><span class="v-num">…</span></td>
      <td class="${wC}">${whiff}${whiff!=='—'?'%':''}</td>
      <td class="v-num">${csw}%</td>
      <td class="v-num">${xwoba}</td>
      <td class="mlb-avg">${mlbTag}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-state">No outing data yet.</td></tr>';

  fillXArsenal(document.getElementById('season-arsenal-body'), athleteOutings, document.getElementById('season-xarsenal'));
  renderUsageChart();

  // Charts
  if (profileCharts['season-mix']) { profileCharts['season-mix'].destroy(); }
  if (profileCharts['season-csw']) { profileCharts['season-csw'].destroy(); }

  profileCharts['season-mix'] = new Chart(document.getElementById('season-mix-chart'), {
    type: 'doughnut',
    data: { labels:sorted.map(([pt])=>pn(pt)), datasets:[{ data:sorted.map(([,s])=>s.count), backgroundColor:sorted.map(([pt])=>pc(pt)), borderWidth:2, borderColor:'#111316' }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'58%', plugins:{ legend:{ display:true, position:'right', labels:{ color:'#72747c', font:{size:11,family:'DM Mono'}, padding:10 } } } }
  });

  const cswVals = sorted.map(([,s]) => s.count ? Math.round((s.whiffs+s.cstrikes)/s.count*100) : 0);
  profileCharts['season-csw'] = new Chart(document.getElementById('season-csw-chart'), {
    type: 'bar',
    data: { labels:sorted.map(([pt])=>pn(pt)), datasets:[{ data:cswVals, backgroundColor:sorted.map(([pt])=>pc(pt)), borderRadius:3, borderSkipped:false }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ y:{beginAtZero:true,max:65,ticks:{callback:v=>v+'%',color:'#72747c',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}}, x:{ticks:{color:'#72747c',font:{size:10}},grid:{display:false}} } }
  });
}

/* ==================== TRENDS ==================== */
function renderTrends() {
  if (!athleteOutings.length) return;
  const sorted = [...athleteOutings].sort((a,b) => a.date.localeCompare(b.date));

  // Clean labels: "Apr 11 vs LOU"
  const labels = sorted.map(o => {
    const clean = (o.date||'').toString().split('T')[0].trim();
    const d = new Date(clean + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    return o.opponent ? `${dateStr} vs ${o.opponent}` : dateStr;
  });

  // Shared x-axis options
  const xAxis = { ticks:{ color:'#72747c', font:{size:10}, maxRotation:40, minRotation:30 }, grid:{display:false} };
  const yPct  = { ticks:{ callback:v=>v+'%', color:'#72747c', font:{size:10} }, grid:{color:'rgba(255,255,255,0.04)'} };
  const yMph  = { ticks:{ callback:v=>v+' mph', color:'#72747c', font:{size:10} }, grid:{color:'rgba(255,255,255,0.04)'} };
  const legend = { display:true, position:'bottom', labels:{ color:'#72747c', font:{size:10,family:'DM Mono'}, padding:12, boxWidth:10 } };

  // ---- Avg velocity ----
  const veloData = sorted.map(o => pf(o.ff_velo) || null);
  if (profileCharts['trend-velo']) profileCharts['trend-velo'].destroy();
  profileCharts['trend-velo'] = new Chart(document.getElementById('trend-velo-chart'), {
    type: 'line',
    data: { labels, datasets:[{
      label:'Avg velo', data:veloData,
      borderColor:'#378ADD', backgroundColor:'rgba(55,138,221,0.1)',
      fill:true, tension:.3, pointRadius:5, pointBackgroundColor:'#378ADD'
    }]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ y:yMph, x:xAxis } }
  });

  // ---- Peak velocity ----
  const peakData = sorted.map(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    const ff = pm['FF'] || pm['FA'];
    return ff?.peakVelo ? pf(ff.peakVelo) : null;
  });
  if (profileCharts['trend-peak']) profileCharts['trend-peak'].destroy();
  profileCharts['trend-peak'] = new Chart(document.getElementById('trend-peak-chart'), {
    type: 'line',
    data: { labels, datasets:[{
      label:'Peak velo', data:peakData,
      borderColor:'#00d4ff', backgroundColor:'rgba(0,212,255,0.08)',
      fill:true, tension:.3, pointRadius:5, pointBackgroundColor:'#00d4ff',
      borderDash:[],
    },{
      label:'Avg velo', data:veloData,
      borderColor:'#378ADD', backgroundColor:'transparent',
      tension:.3, pointRadius:4, pointBackgroundColor:'#378ADD',
      borderDash:[4,3],
    }]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, position:'bottom', labels:{ color:'#72747c', font:{size:10,family:'DM Mono'}, padding:12, boxWidth:10 } } },
      scales:{ y:yMph, x:xAxis } }
  });

  // ---- Whiff trend ----
  // Whiff/Swing per pitch type, top 5 pitch types by volume
  const ptCounts = {};
  sorted.forEach(o => Object.entries(o.pitch_stats||{}).forEach(([pt,s]) => { ptCounts[pt] = (ptCounts[pt]||0) + (s.count||0); }));
  const pitchKeys = Object.entries(ptCounts).filter(([pt]) => pt !== 'OTHER').sort((a,b)=>b[1]-a[1]).slice(0,5).map(([pt]) => [pt, pc(pt)]);
  const whiffOf = (o, pt) => { const v = o.pitch_stats?.[pt]?.whiffPct; return (v === null || v === undefined) ? null : v; };
  const whiffDs = pitchKeys
    .filter(([pt]) => sorted.some(o => whiffOf(o, pt) !== null))
    .map(([pt, col]) => ({
      label: pn(pt), data: sorted.map(o => whiffOf(o, pt)),
      borderColor:col, backgroundColor:'transparent',
      tension:.3, pointRadius:4, pointBackgroundColor:col,
    }));
  if (profileCharts['trend-whiff']) profileCharts['trend-whiff'].destroy();
  profileCharts['trend-whiff'] = new Chart(document.getElementById('trend-whiff-chart'), {
    type:'line', data:{ labels, datasets:whiffDs },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend },
      scales:{ y:yPct, x:xAxis } }
  });

  // ---- In-zone whiff% by pitch ----
  const zwOf = (o, pt) => { const z = zoneWhiffOf(o.pitch_stats?.[pt]); return z.sw >= 2 ? +(z.wh / z.sw * 100).toFixed(1) : null; };
  const zwDs = pitchKeys.filter(([pt]) => sorted.some(o => zwOf(o, pt) !== null)).map(([pt, col]) => ({
    label: pn(pt), data: sorted.map(o => zwOf(o, pt)), borderColor: col, backgroundColor: 'transparent',
    tension: .3, pointRadius: 4, pointBackgroundColor: col, spanGaps: true,
  }));
  if (profileCharts['trend-zwhiff']) profileCharts['trend-zwhiff'].destroy();
  const zwCanvas = document.getElementById('trend-zwhiff-chart');
  if (zwCanvas) profileCharts['trend-zwhiff'] = new Chart(zwCanvas, {
    type:'line', data:{ labels, datasets:zwDs },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend }, scales:{ y:yPct, x:xAxis } }
  });

  // ---- Mix trend ----
  // Built from each outing's pitch map so every pitch type shows (the sheet's
  // fixed ff_pct/st_pct/... columns missed SL, CH, SI and ignore pitch remaps)
  const mixPitches = Object.entries(ptCounts).filter(([pt]) => pt !== 'OTHER').sort((a,b)=>b[1]-a[1]).slice(0,6).map(([pt]) => [pt, pc(pt)]);
  const mixShare = (o, pt) => { const pm = o.pitch_stats || {}; const tot = Object.values(pm).reduce((a,s)=>a+(s.count||0),0); return tot ? +((pm[pt]?.count||0)/tot*100).toFixed(1) : 0; };
  const mixDs = mixPitches.map(([pt,col]) => ({
    label:pn(pt), data:sorted.map(o=>mixShare(o, pt)),
    borderColor:col, backgroundColor:col+'55',
    fill:true, tension:.3, pointRadius:3,
  }));
  if (profileCharts['trend-mix']) profileCharts['trend-mix'].destroy();
  profileCharts['trend-mix'] = new Chart(document.getElementById('trend-mix-chart'), {
    type:'line', data:{ labels, datasets:mixDs },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend },
      scales:{ y:{ stacked:true, ...yPct }, x:xAxis } }
  });
}

/* ==================== OUTINGS LIST ==================== */
function renderOutingsList() {
  const container = document.getElementById('outings-list');
  if (!athleteOutings.length) {
    container.innerHTML = '<div class="empty-state">No outings yet. Add the first outing above.</div>';
    if (outingView === 'card') renderOutingCard(); else renderSeasonCard();
    return;
  }
  const sorted = [...athleteOutings].sort((a,b) => b.date.localeCompare(a.date));
  container.innerHTML = sorted.map(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats === 'object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json || '{}'); } catch(e) {}
    const topPitches = Object.entries(pm).sort((a,b)=>b[1].count-a[1].count).slice(0,5);
    const whiffRate = o.whiffSwPct !== null && o.whiffSwPct !== undefined ? o.whiffSwPct.toFixed(1) : '—';
    return `<div class="outing-row">
      <div class="outing-date">${formatDate(o.date)}</div>
      <div class="outing-opp">${o.opponent || '—'}</div>
      <div class="outing-stats">
        <div class="outing-stat"><div class="outing-stat-val">${o.total_pitches||0}</div><div class="outing-stat-lbl">Pitches</div></div>
        <div class="outing-stat"><div class="outing-stat-val">${whiffRate}${whiffRate !== '—' ? '%' : ''}</div><div class="outing-stat-lbl">Whiff%</div></div>
        <div class="outing-stat"><div class="outing-stat-val">${o.strikeouts||0}</div><div class="outing-stat-lbl">K</div></div>
        <div class="outing-stat"><div class="outing-stat-val">${o.walks||0}</div><div class="outing-stat-lbl">BB</div></div>
      </div>
      <div class="outing-pitch-pills">
        ${topPitches.map(([pt,s])=>{
          const total = Object.values(pm).reduce((a,b)=>a+b.count,0);
          const pct = total ? Math.round(s.count/total*100) : 0;
          return `<span class="pitch-pill" style="background:${pc(pt)}22;color:${pc(pt)}">${pt} ${pct}%</span>`;
        }).join('')}
      </div>
      <div class="outing-xa" data-xa-outing="${o.id}"></div>
      ${o.notes ? `<div style="font-size:11px;color:var(--muted);font-style:italic;min-width:100%">${o.notes}</div>` : ''}
      <button class="outing-delete-btn" onclick="event.stopPropagation();confirmDeleteOuting('${o.id}','${formatDate(o.date)}')" title="Delete outing">✕</button>
    </div>`;
  }).join('');
  fillOutingGrades();
  if (outingView === 'card') renderOutingCard(); else renderSeasonCard();
}

/* ==================== OUTING CARD (Pitch Profiler-style) ==================== */
let outingView = 'card';          // 'card' | 'list'
let selectedOutingId = null;
const xaCardCache = {};

function setOutingView(v) {
  outingView = v;
  document.querySelectorAll('[data-oview]').forEach(b => b.classList.toggle('active', b.dataset.oview === v));
  document.getElementById('outing-card-wrap').style.display = v === 'card' ? '' : 'none';
  document.getElementById('season-card-wrap').style.display = v === 'season' ? '' : 'none';
  document.getElementById('oc-picker').style.visibility = v === 'card' ? '' : 'hidden';
  if (v === 'card') renderOutingCard(); else renderSeasonCard();
}
function outingsNewestFirst() { return [...athleteOutings].sort((a, b) => b.date.localeCompare(a.date)); }
function selectOuting(id) { selectedOutingId = id; renderOutingCard(); }
function stepOuting(dir) {
  const list = outingsNewestFirst(); const i = list.findIndex(o => o.id === selectedOutingId);
  const n = list[Math.min(list.length - 1, Math.max(0, i + dir))]; if (n) selectOuting(n.id);
}

async function gradeOutingForCard(o) {
  const body = { hand: currentAthlete?.throws || 'R', level: currentAthlete?.level || '', veloWeighted: true, pitches: xaSeasonShape([o], 1, 0) };
  if (!body.pitches.length) return null;
  const key = JSON.stringify(body);
  if (!xaCardCache[key]) xaCardCache[key] = api('scoreArsenal', body).catch(e => { delete xaCardCache[key]; throw e; });
  return xaCardCache[key];
}

// Diverging cell color, Savant style: red = good for the pitcher, blue = bad
function divColor(v, mid, span, higherBetter = true) {
  if (v === null || v === undefined || isNaN(v)) return '';
  let d = (v - mid) / span; if (!higherBetter) d = -d; d = Math.max(-1, Math.min(1, d));
  const a = Math.abs(d), base = d >= 0 ? [214, 60, 70] : [70, 110, 200];
  return `background:rgba(${base.join(',')},${(0.15 + a * 0.75).toFixed(2)});color:${a > 0.45 ? '#fff' : 'var(--text)'}`;
}

// ---- Release point: your Visual3D skeleton renders (img/release/*.png) ----
// Three righty catcher's-view renders at ball release (low / mid / high slot).
// The render closest to the pitcher's arm angle is scaled and placed so its
// throwing hand sits on the pitcher's average release point and its landing
// foot on the ground; lefties get it mirrored. Actual release dots go on top.
// hand / ground = anchor pixels in each PNG (measured from the files).
const RELEASE_TEMPLATES = {
  low:  { src: (window.RELEASE_IMG && window.RELEASE_IMG.low) || 'img/release/low.png',  w: 631, h: 700, hand: [40.0, 282.0], ground: 696.6, skullTop: 10.1,  armDeg: 15 },
  mid:  { src: (window.RELEASE_IMG && window.RELEASE_IMG.mid) || 'img/release/mid.png',  w: 438, h: 700, hand: [36.3, 39.7],  ground: 696.8, skullTop: 16.2,  armDeg: 36 },
  high: { src: (window.RELEASE_IMG && window.RELEASE_IMG.high) || 'img/release/high.png', w: 325, h: 700, hand: [30.0, 31.8],  ground: 697.1, skullTop: 105.0, armDeg: 55 },
};
function releaseTemplateFor(armDeg, relZ, relX) {
  // no arm angle saved: estimate the slot from release height vs. side
  const a = armDeg ?? (Math.atan2(Math.max(0.1, relZ - 4.6), Math.max(0.3, Math.abs(relX) - 0.45)) * 180 / Math.PI);
  return a < 25 ? RELEASE_TEMPLATES.low : a < 46 ? RELEASE_TEMPLATES.mid : RELEASE_TEMPLATES.high;
}

function ocReleaseSVG(rows, lefty) {
  const W = 320, H = 300, K = 31, G = H - 26;
  const sx = x => W/2 + x * K, sy = z => G - z * K;
  const wavg = k => { let s = 0, w = 0; rows.forEach(([, p]) => { if (p[k] != null && p[k] !== '' && !isNaN(+p[k])) { s += +p[k] * p.count; w += p.count; } }); return w ? s / w : null; };
  // Catcher's view: RHP release side is negative (3B side), LHP positive.
  // Some sources (e.g. Trackman exports) store release side with the opposite
  // sign — if it disagrees with the pitcher's hand, flip it for the drawing.
  const rawX = wavg('avgRelSide');
  const flipX = rawX !== null && ((lefty && rawX < 0) || (!lefty && rawX > 0)) ? -1 : 1;
  const relX = rawX !== null ? rawX * flipX : (lefty ? 1.8 : -1.8);
  const relZ = wavg('avgRelHeight') ?? 5.8;
  const armDeg = wavg('avgArm');
  const mirror = lefty;                       // renders are righties; mirror for lefties
  const T = releaseTemplateFor(armDeg, relZ, relX);

  // Scale: body sized to a ~5.9 ft head-height in stride, stretched up to
  // +/-20% toward the pitcher's release height; feet stay on the platform
  // unless the hand would still be far off, then the figure lifts slightly.
  const HEAD_FT = 5.9;
  const sBody = (HEAD_FT * K) / (T.ground - T.skullTop);            // viewBox px per image px
  const handFt = (T.ground - T.hand[1]) * sBody / K;                  // template hand height at body scale
  const s = sBody * Math.max(0.85, Math.min(1.2, relZ / handFt));
  const miss = relZ - (T.ground - T.hand[1]) * s / K;                 // ft the hand is still off
  const lift = Math.max(-0.15, Math.min(0.15, miss * 0.5)) * K;   // keep feet (nearly) on the platform
  const imgW = T.w * s, imgH = T.h * s;
  const top = sy(0) - lift - T.ground * s;
  const left = mirror ? sx(relX) - (T.w - T.hand[0]) * s : sx(relX) - T.hand[0] * s;
  const pct = (v, of) => (v / of * 100).toFixed(3) + '%';

  const dots = rows.flatMap(([pt, st]) => (st.rp && st.rp.length ? st.rp : (st.avgRelSide != null && st.avgRelHeight != null ? [[+st.avgRelSide, +st.avgRelHeight]] : []))
    .map(([x, z]) => `<circle cx="${sx(x * flipX).toFixed(1)}" cy="${sy(z).toFixed(1)}" r="${st.rp && st.rp.length ? 4 : 7}" fill="${pc(pt)}" fill-opacity=".92" stroke="rgba(0,0,0,.55)"/>`)).join('');

  return `<div class="oc-rel" style="padding-top:${pct(H, W)}">
    <svg viewBox="0 0 ${W} ${H}" class="oc-rel-layer">
      <defs><radialGradient id="stageGlow" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="#3a3f4c"/><stop offset="1" stop-color="#16181e" stop-opacity="0"/></radialGradient></defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#stageGlow)"/>
      <path d="M${sx(-3.6)},${sy(0)} L${sx(3.6)},${sy(0)} L${sx(4.4)},${H} L${sx(-4.4)},${H} Z" fill="#7d88a8" opacity=".55"/>
      <line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(0)}" y2="${H}" stroke="#16181e" stroke-width="2" opacity=".6"/>
    </svg>
    <img class="oc-rel-img" src="${T.src}" alt="" onerror="this.style.display='none'" style="left:${pct(left, W)};top:${pct(top, H)};width:${pct(imgW, W)};height:${pct(imgH, H)};${mirror ? 'transform:scaleX(-1);' : ''}">
    <svg viewBox="0 0 ${W} ${H}" class="oc-rel-layer">
      ${dots}
      <text x="6" y="14" class="oc-axis">Catcher's view · ${lefty ? 'LHP' : 'RHP'}${armDeg !== null ? ` · arm angle ${Math.round(armDeg)}°` : ''}</text>
    </svg>
  </div>`;
}

function ocMovementSVG(rows) {
  const W = 300, H = 300, C = 150, R = 150 / 30;
  const grid = [-30,-20,-10,10,20,30].map(v => `<line x1="${C+v*R}" y1="0" x2="${C+v*R}" y2="${H}" class="oc-grid"/><line x1="0" y1="${C-v*R}" x2="${W}" y2="${C-v*R}" class="oc-grid"/>`).join('');
  const lbl = [-20,-10,10,20].map(v => `<text x="${C+v*R}" y="${H-4}" class="oc-axis" text-anchor="middle">${v}</text><text x="4" y="${C-v*R+3}" class="oc-axis">${v}</text>`).join('');
  const clamp30 = v => Math.max(-29, Math.min(29, v));
  const dots = rows.flatMap(([pt, s]) => {
    const pts = s.mv && s.mv.length ? s.mv : (s.avgHB != null && s.avgIVB != null ? [[+s.avgHB, +s.avgIVB]] : []);
    const big = !(s.mv && s.mv.length);
    const out = pts.map(([hb, ivb]) => `<circle cx="${(C + clamp30(hb)*R).toFixed(1)}" cy="${(C - clamp30(ivb)*R).toFixed(1)}" r="${big ? 7 : 4.5}" fill="${pc(pt)}" fill-opacity=".8" stroke="rgba(0,0,0,.4)"/>`);
    if (s.avgHB != null && s.avgIVB != null && !big)   // ring at the average
      out.push(`<circle cx="${C + clamp30(+s.avgHB)*R}" cy="${C - clamp30(+s.avgIVB)*R}" r="8" fill="none" stroke="${pc(pt)}" stroke-width="2"/>`);
    return out;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="oc-svg">${grid}
    <line x1="${C}" y1="0" x2="${C}" y2="${H}" stroke="var(--muted)"/><line x1="0" y1="${C}" x2="${W}" y2="${C}" stroke="var(--muted)"/>
    ${lbl}${dots}<text x="${W-4}" y="12" class="oc-axis" text-anchor="end">HB / IVB (in)</text></svg>`;
}

function ocFrequency(rows) {
  const totL = rows.reduce((a, [, s]) => a + (s.lhh?.count || 0), 0), totR = rows.reduce((a, [, s]) => a + (s.rhh?.count || 0), 0);
  if (!totL && !totR) return '<div class="empty-state" style="padding:1rem">No batter-side data for this outing.</div>';
  const line = (sd, tot, side) => {
    const n = sd?.count || 0; const w = tot ? n / tot * 100 : 0;
    const wh = sd?.whiffPct != null ? `${sd.whiffPct}% whiff` : '';
    return { w, txt: `<div class="oc-f-count">Count: ${n}</div>${wh ? `<div class="oc-f-sub">${wh}</div>` : ''}` };
  };
  return `<div class="oc-freq">
    <div class="oc-f-hd"><span>LHH (${totL})</span><span>RHH (${totR})</span></div>
    ${rows.map(([pt, s]) => { const L = line(s.lhh, totL), Rr = line(s.rhh, totR);
      return `<div class="oc-f-row">
        <div class="oc-f-side oc-f-l"><div class="oc-f-txt">${L.txt}</div><div class="oc-f-bar" style="width:${L.w/2}%;background:${pc(pt)}"></div></div>
        <div class="oc-f-side oc-f-r"><div class="oc-f-bar" style="width:${Rr.w/2}%;background:${pc(pt)}"></div><div class="oc-f-txt">${Rr.txt}</div></div>
      </div>`; }).join('')}
    <div class="oc-f-axis"><span>100%</span><span>50%</span><span>0%</span><span>50%</span><span>100%</span></div>
  </div>`;
}

async function renderOutingCard() {
  const wrap = document.getElementById('outing-card');
  const sel = document.getElementById('outing-select');
  if (!wrap || !sel) return;
  const list = outingsNewestFirst();
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">No outings yet.</div>'; sel.innerHTML = ''; return; }
  if (!list.some(o => o.id === selectedOutingId)) selectedOutingId = list[0].id;
  sel.innerHTML = list.map(o => `<option value="${o.id}" ${o.id === selectedOutingId ? 'selected' : ''}>${formatDate(o.date)}${o.opponent ? ' vs ' + o.opponent : ''} · ${o.total_pitches || 0}p</option>`).join('');
  const o = list.find(x => x.id === selectedOutingId);
  return renderCard(wrap, o, {
    sub: `${formatDate(o.date)}${o.opponent ? ' vs ' + o.opponent : ''}`,
    gradeFn: () => gradeOutingForCard(o),
    guard: () => selectedOutingId === o.id && outingView === 'card',
  });
}

// Runs allowed for an outing: saved value, else 0 if nobody reached base
function outingRuns(o) {
  let st = o.sit; if (!st && o.sit_json) { try { st = JSON.parse(o.sit_json); } catch(e) {} }
  if (st?.runs != null) return st.runs;
  const baserunners = (+o.hits || 0) + (+o.walks || 0) + (+o.hbp || 0);
  const known = o.hits !== undefined && o.hits !== '' && o.walks !== undefined && o.walks !== '';
  return known && baserunners === 0 ? 0 : null;
}

// Season summary: every outing in the selected season merged into one card
function seasonPseudoOuting() {
  const pm = {};
  athleteOutings.forEach(o => Object.entries(o.pitch_stats || {}).forEach(([pt, s]) => {
    if (!s || !s.count) return;
    pm[pt] = pm[pt] ? mergePitchStats(pm[pt], s) : { ...s };
  }));
  // keep the SVGs light: evenly sample per-pitch dots
  const sample = (arr, n) => !arr || arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor(i * arr.length / n)]);
  Object.values(pm).forEach(s => { s.mv = sample(s.mv, 150); s.rp = sample(s.rp, 150); });
  const sum = f => athleteOutings.reduce((a, o) => a + (+o[f] || 0), 0);
  const outs = athleteOutings.reduce((a, o) => a + ipToOuts(o.ip), 0);
  let runs = 0, haveRuns = true, pitcherId = null;
  athleteOutings.forEach(o => { let st = o.sit; if (!st && o.sit_json) { try { st = JSON.parse(o.sit_json); } catch(e) {} }
    const r = outingRuns(o); if (r === null) haveRuns = false; else runs += r; if (st?.pitcherId) pitcherId = st.pitcherId; });
  return { id: '__season', pitch_stats: pm, ip: outs / 3, hits: sum('hits'), strikeouts: sum('strikeouts'), walks: sum('walks'), hrs: sum('hrs'),
           total_pitches: sum('total_pitches'), whiffSwPct: outingsWhiffSw(athleteOutings), sit: { runs: haveRuns ? runs : null, pitcherId } };
}

function renderSeasonCard() {
  const wrap = document.getElementById('season-card');
  if (!wrap) return;
  if (!athleteOutings.length) { wrap.innerHTML = '<div class="empty-state">No outings this season.</div>'; return; }
  const o = seasonPseudoOuting();
  return renderCard(wrap, o, {
    sub: `${seasonLabel()} Season · ${athleteOutings.length} outing${athleteOutings.length !== 1 ? 's' : ''}`,
    gradeFn: () => getXArsenal(athleteOutings),
    guard: () => outingView === 'season',
    season: true,
  });
}

async function renderCard(wrap, o, opts) {
  const lefty = aiIsLefty();
  const pm = o.pitch_stats || {};
  const total = Object.values(pm).reduce((a, s) => a + (s.count || 0), 0);
  const rows = Object.entries(pm).filter(([pt, s]) => s && s.count).sort((a, b) => b[1].count - a[1].count);
  let sit = o.sit; if (!sit && o.sit_json) { try { sit = JSON.parse(o.sit_json); } catch(e) {} }
  const name = stripYearSuffix(currentAthlete?.name || '');
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const photo = sit?.pitcherId
    ? `<img class="oc-photo" crossorigin="anonymous" src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${sit.pitcherId}/headshot/67/current" alt="" onerror="this.outerHTML='<div class=&quot;oc-initials&quot;>${initials}</div>'">`
    : `<div class="oc-initials">${initials}</div>`;
  const ipTxt = o.ip ? fmtIP(Math.round(o.ip * 3)) : '—';
  const box = (l, v) => `<div class="oc-box"><div class="oc-box-l">${l}</div><div class="oc-box-v">${v}</div></div>`;
  const f1 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '—' : (+v).toFixed(1);
  const f2 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '—' : (+v).toFixed(2);
  const f0 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '—' : Math.round(+v);

  const tableRows = rows.map(([pt, s]) => {
    const mlbW = MLB_BASELINE_REF[pt]?.whiff_pct;
    const xw = s.avgXwoba != null && s.avgXwoba !== '' ? +s.avgXwoba : null;
    return `<tr>
      <td class="oc-pname" style="color:${pc(pt)}">${pn(pt)}</td><td>${s.count}</td><td>${(s.count / total * 100).toFixed(1)}</td>
      <td>${f1(s.avgVelo)}</td><td>${f0(s.avgSpin)}</td><td>${f1(s.avgIVB)}</td><td>${f1(s.avgHB)}</td><td>${f2(s.avgVAA)}</td><td>${f2(s.avgHAA)}</td>
      <td class="oc-sep">${f2(s.avgRelHeight)}</td><td>${f2(s.avgRelSide)}</td><td>${f2(s.avgExt)}</td><td>${f0(s.avgArm)}</td>
      <td class="oc-sep"><span class="oc-cell" data-oc-grade="${pt}">…</span></td>
      <td><span class="oc-cell" style="${s.whiffPct != null ? divColor(s.whiffPct, mlbW || 25, 15, true) : ''}">${s.whiffPct != null ? s.whiffPct.toFixed(1) + '%' : '—'}</span></td>
      ${(() => { const zw = zoneWhiffPct([s]); return `<td><span class="oc-cell" style="${zw !== null ? divColor(zw, 15, 10, true) : ''}">${zw !== null ? zw.toFixed(1) + '%' : '—'}</span></td>`; })()}
      <td><span class="oc-cell" style="${xw !== null ? divColor(xw, .370, .12, false) : ''}">${xw !== null ? xw.toFixed(3).replace(/^0/, '') : '—'}</span></td>
    </tr>`;
  }).join('');
  const wAvg = k => { let s = 0, w = 0; rows.forEach(([, p]) => { if (p[k] != null && p[k] !== '' && !isNaN(+p[k])) { s += +p[k] * p.count; w += p.count; } }); return w ? s / w : null; };
  const xwAll = (() => { let s = 0, w = 0; rows.forEach(([, p]) => { if (p.avgXwoba != null && p.avgXwoba !== '' && p.hip) { s += +p.avgXwoba * p.hip; w += p.hip; } }); return w ? s / w : null; })();

  wrap.innerHTML = `<div class="oc">
    <div class="oc-head">
      ${photo}
      <div class="oc-title">
        <div class="oc-name">${name}</div>
        <div class="oc-sub">${opts.sub}</div>
        <div class="oc-tags"><span>${lefty ? 'LHP' : 'RHP'}</span>${currentAthlete?.team ? `<span>${currentAthlete.team}</span>` : ''}${currentAthlete?.level ? `<span>${currentAthlete.level}</span>` : ''}</div>
      </div>
      <div class="oc-boxes">${box('IP', ipTxt)}${box('R', o.id === '__season' ? (sit?.runs ?? '—') : (outingRuns(o) ?? '—'))}${box('H', o.hits ?? '—')}${box('K', o.strikeouts ?? '—')}${box('BB', o.walks ?? '—')}${box('HR', o.hrs ?? '—')}</div>
    </div>
    <div class="oc-panels">
      <div class="oc-panel"><div class="oc-ph">Release Point</div>${ocReleaseSVG(rows, lefty)}</div>
      <div class="oc-panel"><div class="oc-ph">Movement Profile</div>${ocMovementSVG(rows)}</div>
      <div class="oc-panel"><div class="oc-ph">Pitch Frequency</div>${ocFrequency(rows)}</div>
    </div>
    <div class="oc-tablewrap"><table class="oc-table">
      <thead><tr><th>Pitch</th><th>#</th><th>%</th><th>Velo</th><th>Spin</th><th>IVB</th><th>HB</th><th>VAA</th><th>HAA</th>
        <th class="oc-sep">vRel</th><th>hRel</th><th>Ext</th><th>Arm°</th><th class="oc-sep">Grade</th><th>Whiff%</th><th>Z-Whiff%</th><th title="xwOBA on balls in play (MLB avg ≈ .370)">xwOBAcon</th></tr></thead>
      <tbody>${tableRows}
        <tr class="oc-overall"><td>Overall</td><td>${total}</td><td>100.0</td><td>·</td><td>·</td><td>·</td><td>·</td><td>·</td><td>·</td>
          <td class="oc-sep">${f2(wAvg('avgRelHeight'))}</td><td>${f2(wAvg('avgRelSide'))}</td><td>${f2(wAvg('avgExt'))}</td><td>${f0(wAvg('avgArm'))}</td>
          <td class="oc-sep"><span class="oc-cell" data-oc-grade="__all">…</span></td>
          <td><span class="oc-cell" style="${o.whiffSwPct != null ? divColor(o.whiffSwPct, 25, 15, true) : ''}">${o.whiffSwPct != null ? o.whiffSwPct.toFixed(1) + '%' : '—'}</span></td>
          ${(() => { const zw = zoneWhiffPct(rows.map(([, s]) => s)); return `<td><span class="oc-cell" style="${zw !== null ? divColor(zw, 15, 10, true) : ''}">${zw !== null ? zw.toFixed(1) + '%' : '—'}</span></td>`; })()}
          <td><span class="oc-cell" style="${xwAll !== null ? divColor(xwAll, .370, .12, false) : ''}">${xwAll !== null ? xwAll.toFixed(3).replace(/^0/, '') : '—'}</span></td></tr>
      </tbody></table></div>
    <div class="oc-foot"><span>${opts.season ? 'Season averages · grades use the season shape (min 10 pitches) · ' : ''}Grade = 8ctane xArsenal (60 ≈ MLB average) · Whiff% per swing · Z-Whiff% = whiffs on in-zone swings · Red = good for the pitcher, blue = bad${!rows.some(([, s]) => s.mv && s.mv.length) ? ' · Re-import for per-pitch dots and arm angle' : ''}</span><span class="oc-brand">8CTANE BASEBALL · Pitch Intelligence</span></div>
  </div>`;

  // grades
  try {
    const res = await opts.gradeFn();
    if (opts.guard && !opts.guard()) return;
    const by = {}; (res?.pitches || []).forEach(r => { by[r.key] = r; });
    wrap.querySelectorAll('[data-oc-grade]').forEach(el => {
      const r = el.dataset.ocGrade === '__all' ? (res ? { score: res.arsenalScore, grade: res.arsenalGrade, gradeLabel: res.arsenalLabel } : null) : by[el.dataset.ocGrade];
      if (!r) { el.textContent = '—'; return; }
      el.textContent = r.score; el.setAttribute('style', divColor(r.score, 60, 25, true));
      el.title = r.subtype ? xaTitle(r) : `xArsenal ${r.score} (${r.grade}, ${r.gradeLabel})`;
    });
  } catch(e) { wrap.querySelectorAll('[data-oc-grade]').forEach(el => { el.textContent = '—'; }); }
}

// Save the card as a PNG (html2canvas loaded on demand)
async function saveOutingCardImage() {
  const el = document.querySelector((outingView === 'season' ? '#season-card' : '#outing-card') + ' .oc'); if (!el) return;
  try {
    if (!window.html2canvas) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const canvas = await html2canvas(el, { backgroundColor: getComputedStyle(document.body).backgroundColor || '#0a0b0e', scale: 2, useCORS: true });
    const o = athleteOutings.find(x => x.id === selectedOutingId);
    const a = document.createElement('a');
    a.download = `${stripYearSuffix(currentAthlete?.name || 'pitcher').replace(/\s+/g, '_')}_${outingView === 'season' ? seasonLabel() + '_season' : (o?.date || '').toString().slice(0, 10)}.png`;
    a.href = canvas.toDataURL('image/png'); a.click();
  } catch(e) { toast('Could not create image: ' + (e.message || e), 'error'); }
}

/* ==================== EXPORT DATA (CSV) ==================== */
function showExportData() {
  const dates = athleteOutings.map(o => (o.date || '').toString().slice(0, 10)).sort();
  const allDates = athleteOutingsAll.map(o => (o.date || '').toString().slice(0, 10)).sort();
  openModal('Export data', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">From</label><input class="form-input" id="ex-from" type="date" value="${dates[0] || ''}"></div>
      <div class="form-group"><label class="form-label">To</label><input class="form-input" id="ex-to" type="date" value="${dates[dates.length-1] || ''}"></div>
    </div>
    <div class="loc-filter-row" style="margin:.25rem 0 1rem">
      <span class="loc-filter-label">Quick:</span>
      <button class="loc-filter-btn" onclick="document.getElementById('ex-from').value='${dates[0]||''}';document.getElementById('ex-to').value='${dates[dates.length-1]||''}'">${seasonLabel() || 'Season'}</button>
      <button class="loc-filter-btn" onclick="document.getElementById('ex-from').value='${allDates[0]||''}';document.getElementById('ex-to').value='${allDates[allDates.length-1]||''}'">All seasons</button>
    </div>
    <div class="form-group">
      <label class="form-label">What to export</label>
      <label class="ex-opt"><input type="checkbox" id="ex-outings" checked> Outing summary — one row per outing</label>
      <label class="ex-opt"><input type="checkbox" id="ex-pitches" checked> Pitch-type detail — one row per pitch type per outing</label>
      <label class="ex-opt"><input type="checkbox" id="ex-grades" checked> Include xArsenal grades</label>
    </div>
    <div class="form-actions" style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="ex-go" onclick="runExportData()">Download CSV</button>
    </div>`);
}

function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCSV(name, header, rows) {
  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function runExportData() {
  const from = document.getElementById('ex-from').value, to = document.getElementById('ex-to').value;
  const wantO = document.getElementById('ex-outings').checked, wantP = document.getElementById('ex-pitches').checked, wantG = document.getElementById('ex-grades').checked;
  if (!wantO && !wantP) { toast('Pick at least one export', 'error'); return; }
  const outs = athleteOutingsAll.filter(o => { const d = (o.date || '').toString().slice(0, 10); return (!from || d >= from) && (!to || d <= to); })
                                .sort((a, b) => a.date.localeCompare(b.date));
  if (!outs.length) { toast('No outings in that date range', 'error'); return; }
  const btn = document.getElementById('ex-go'); btn.disabled = true; btn.textContent = 'Preparing…';
  let grades = {};
  if (wantG) { try { const prev = {}; outs.forEach(o => prev[o.id] = 1);
      // grade every outing that has enough pitches (same rule as the Outings tab)
      grades = await getXArsenalByOuting(outs); } catch(e) { grades = {}; } }
  const base = `${stripYearSuffix(currentAthlete?.name || 'pitcher').replace(/\s+/g, '_')}_${from || 'start'}_to_${to || 'end'}`;
  const r1 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '' : +(+v).toFixed(1);
  const r2 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '' : +(+v).toFixed(2);
  const r3 = v => v === null || v === undefined || v === '' || isNaN(+v) ? '' : +(+v).toFixed(3);

  if (wantO) {
    const header = ['Date','Opponent','IP','Pitches','K','BB','HBP','H','HR','R','Whiff%','CSW%','Strike%','Zone%','Chase%','FB Velo','xArsenal'];
    const rows = outs.map(o => {
      const pm = o.pitch_stats || {}; const tot = Object.values(pm).reduce((a, s) => a + (s.count || 0), 0);
      const csw = tot ? Object.values(pm).reduce((a, s) => a + (s.whiffs || 0) + (s.cstrikes || 0), 0) / tot * 100 : null;
      const ff = pm.FF || pm.FA || pm.SI;
      let sit = o.sit; if (!sit && o.sit_json) { try { sit = JSON.parse(o.sit_json); } catch(e) {} }
      return [(o.date || '').toString().slice(0, 10), o.opponent || '', o.ip ? fmtIP(ipToOuts(o.ip)) : '', o.total_pitches || tot,
        o.strikeouts ?? '', o.walks ?? '', o.hbp ?? '', o.hits ?? '', o.hrs ?? '', outingRuns(o) ?? '',
        r1(o.whiffSwPct), r1(csw), r1(o.strike_pct), r1(o.zone_pct), r1(o.o_swing_pct), r1(ff?.avgVelo), grades[o.id]?.arsenalScore ?? ''];
    });
    downloadCSV(base + '_outings.csv', header, rows);
  }
  if (wantP) {
    const header = ['Date','Opponent','Pitch','Count','Usage%','Velo','Peak Velo','Spin','IVB','HB','VAA','HAA','Rel Height','Rel Side','Extension','Arm Angle',
                    'Whiff%','CSW%','xwOBA','Avg EV','Hard Hit%','vs LHH','vs RHH','Run Value','xArsenal','Graded As'];
    const rows = [];
    outs.forEach(o => {
      const pm = o.pitch_stats || {}; const tot = Object.values(pm).reduce((a, s) => a + (s.count || 0), 0);
      const g = {}; (grades[o.id]?.pitches || []).forEach(r => { g[r.key] = r; });
      Object.entries(pm).filter(([, s]) => s && s.count).sort((a, b) => b[1].count - a[1].count).forEach(([pt, s]) => {
        rows.push([(o.date || '').toString().slice(0, 10), o.opponent || '', pn(pt), s.count, r1(tot ? s.count / tot * 100 : null),
          r1(s.avgVelo), r1(s.peakVelo), s.avgSpin ? Math.round(s.avgSpin) : '', r1(s.avgIVB), r1(s.avgHB), r2(s.avgVAA), r2(s.avgHAA),
          r2(s.avgRelHeight), r2(s.avgRelSide), r2(s.avgExt), r1(s.avgArm),
          r1(s.whiffPct), r1(s.count ? ((s.whiffs || 0) + (s.cstrikes || 0)) / s.count * 100 : null), r3(s.avgXwoba), r1(s.avgEV), r1(s.hardHitPct),
          s.lhh?.count ?? '', s.rhh?.count ?? '', r2(s.rv), g[pt]?.score ?? '', g[pt]?.subtype ?? '']);
      });
    });
    downloadCSV(base + '_pitches.csv', header, rows);
  }
  closeModal();
  toast(`Exported ${outs.length} outing${outs.length !== 1 ? 's' : ''}`);
}

/* ==================== ADD OUTING ==================== */
function showAddOuting() {
  openModal('Add Outing', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Date *</label>
        <input class="form-input" id="o-date" type="date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-group">
        <label class="form-label">Opponent</label>
        <input class="form-input" id="o-opp" placeholder="vs. Indianapolis">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="o-notes" placeholder="Any notes about this outing..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Upload Statcast CSV *</label>
      <div class="drop-area" id="outing-drop" style="padding:1.5rem;gap:.5rem">
        <div class="drop-icon" style="font-size:24px">⚾</div>
        <div class="drop-label" style="font-size:14px">Drop CSV here or click to select</div>
        <input type="file" id="outing-csv" accept=".csv" style="display:none">
      </div>
      <div class="form-hint" id="outing-csv-status">No file selected</div>
    </div>
    <div class="form-actions">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="btn-submit-outing" onclick="submitOuting()" disabled style="opacity:.4">Save Outing</button>
    </div>
  `);

  const drop = document.getElementById('outing-drop');
  const input = document.getElementById('outing-csv');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); if(e.dataTransfer.files[0]) loadOutingCSV(e.dataTransfer.files[0]); });
  input.addEventListener('change', e => { if(e.target.files[0]) loadOutingCSV(e.target.files[0]); });
}

let pendingOutingData = null;

function loadOutingCSV(file) {
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: r => {
      const rows = r.data;
      pendingOutingData = processOutingRows(rows);
      document.getElementById('outing-csv-status').textContent = `✓ ${file.name} — ${rows.length} pitches loaded`;
      document.getElementById('outing-csv-status').style.color = 'var(--good)';
      const btn = document.getElementById('btn-submit-outing');
      btn.disabled = false; btn.style.opacity = '1';
    }
  });
}

function processOutingRows(rows) {
  const NORMALIZE = { FA:'FF', FO:'FS', CS:'CU', SV:'SL' };
  rows.forEach(r => {
    let pt = (r.pitch_type||'').trim().toUpperCase();
    pt = NORMALIZE[pt] || pt;
    if (!PITCH_COLORS[pt]) pt = 'OTHER';
    r._pt = pt;
  });

  const total = rows.length;
  const pitchMap = {};

  // Zone/swing counters (outing-level)
  let inZone=0, outZone=0, swingInZone=0, swingOutZone=0,
      contactInZone=0, contactOutZone=0, totalSwings=0,
      totalStrikes=0, gbCount=0, fbCount=0, ldCount=0, puCount=0, bipCount=0,
      fp_total=0, fp_strikes=0, oneone_total=0, oneone_strikes=0;

  const STRIKE_ZONES = new Set(['1','2','3','4','5','6','7','8','9']);

  rows.forEach(r => {
    const pt = r._pt;
    if (!pitchMap[pt]) pitchMap[pt] = { count:0, velos:[], whiffs:0, cstrikes:0, balls:0, fouls:0, hip:0, xwobas:[], launch_speeds:[], pfx_xs:[], pfx_zs:[], rel_xs:[], rel_zs:[], exts:[], effSpeeds:[], rawRows:[], mv:[], rp:[], arms:[], swings:0, zoneN:0, outN:0, zSw:0, oSw:0, zCon:0,
      lhh:{count:0,whiffs:0,cstrikes:0,hip:0}, rhh:{count:0,whiffs:0,cstrikes:0,hip:0} };
    const s = pitchMap[pt];
    s.count++;
    s.rawRows.push(r);
    if (r.release_speed) s.velos.push(pf(r.release_speed));
    if (r.pfx_x) s.pfx_xs.push(pf(r.pfx_x));
    if (r.pfx_z) s.pfx_zs.push(pf(r.pfx_z));
    if (r.pfx_x && r.pfx_z) s.mv.push([+(-pf(r.pfx_x)*12).toFixed(1), +(pf(r.pfx_z)*12).toFixed(1)]);
    // Release point — release_pos_z (height, ft) / release_pos_x (side, ft)
    if (r.release_pos_z) s.rel_zs.push(pf(r.release_pos_z));
    if (r.release_pos_x) s.rel_xs.push(pf(r.release_pos_x));
    if (r.release_pos_x && r.release_pos_z) s.rp.push([+pf(r.release_pos_x).toFixed(2), +pf(r.release_pos_z).toFixed(2)]);
    if (r.arm_angle !== undefined && r.arm_angle !== '' && !isNaN(+r.arm_angle)) s.arms.push(+r.arm_angle);
    // Extension (ft) and perceived velo (Statcast effective_speed)
    if (r.release_extension) s.exts.push(pf(r.release_extension));
    if (r.effective_speed)   s.effSpeeds.push(pf(r.effective_speed));

    const desc = r.description||'';
    const zone = (r.zone||'').toString().trim();
    const inStrikeZone = STRIKE_ZONES.has(zone);
    if (inStrikeZone) inZone++; else if (zone) outZone++;

    const isSwing = desc.includes('swinging_strike') || desc.includes('foul') || desc === 'hit_into_play' || desc === 'foul_tip';
    const isContact = desc.includes('foul') || desc === 'hit_into_play' || desc === 'foul_tip';

    if (isSwing) {
      totalSwings++;
      if (inStrikeZone) { swingInZone++; if(isContact) contactInZone++; }
      else if (zone) { swingOutZone++; if(isContact) contactOutZone++; }
    }
    // Batter-side usage + pitch run value (pitcher RV = -delta_run_exp)
    const sideS = r.stand === 'L' ? s.lhh : r.stand === 'R' ? s.rhh : null;
    if (sideS) sideS.count++;
    const dreS = parseFloat(r.delta_run_exp);
    if (!isNaN(dreS)) { s.rv = (s.rv||0) - dreS; if (sideS) sideS.rv = (sideS.rv||0) - dreS; }
    // Per-pitch-type swing/zone counts
    if (inStrikeZone) s.zoneN++; else if (zone) s.outN++;
    if (isSwing) { s.swings++; if (inStrikeZone) { s.zSw++; if (isContact) s.zCon++; } else if (zone) s.oSw++; }

    if (desc.includes('swinging_strike')) s.whiffs++;
    else if (desc.includes('called_strike')) s.cstrikes++;
    else if (desc==='ball'||desc==='blocked_ball') s.balls++;
    else if (desc.includes('foul')) s.fouls++;
    else if (desc==='hit_into_play') {
      s.hip++;
      if (r.launch_speed) s.launch_speeds.push(pf(r.launch_speed));
      if (r.estimated_woba_using_speedangle) s.xwobas.push(pf(r.estimated_woba_using_speedangle));
    }

    // Strikes = swinging strikes + called strikes + fouls + HIP
    if (desc.includes('swinging_strike')||desc.includes('called_strike')||desc.includes('foul')||desc==='hit_into_play') totalStrikes++;

    // Count-based strike tracking
    const balls_n   = parseInt(r.balls||0);
    const strikes_n = parseInt(r.strikes||0);
    const isStrike  = desc.includes('swinging_strike')||desc.includes('called_strike')||desc.includes('foul')||desc==='hit_into_play'||desc==='foul_tip';
    if (balls_n===0 && strikes_n===0) { fp_total++; if(isStrike) fp_strikes++; }
    if (balls_n===1 && strikes_n===1) { oneone_total++; if(isStrike) oneone_strikes++; }

    // BIP types
    const bbt = (r.bb_type||'').toLowerCase();
    if (bbt) {
      bipCount++;
      if (bbt==='ground_ball') gbCount++;
      else if (bbt==='fly_ball') fbCount++;
      else if (bbt==='line_drive') ldCount++;
      else if (bbt==='popup') puCount++;
    }
  });

  // Flatten pitch map
  const flatMap = {};
  Object.entries(pitchMap).forEach(([pt, s]) => {
    const angles = s.rawRows.map(r => {
      const vx0=pf(r.vx0),vy0=pf(r.vy0),vz0=pf(r.vz0),ax=pf(r.ax),ay=pf(r.ay),az=pf(r.az),ext=pf(r.release_extension)||6;
      if (!vy0) return null;
      const t = (60.5-ext)/Math.abs(vy0);
      return { vaa: +(Math.atan((vz0+az*t)/Math.abs(vy0+ay*t))*(180/Math.PI)).toFixed(1), haa: +(Math.atan((vx0+ax*t)/Math.abs(vy0+ay*t))*(180/Math.PI)).toFixed(1) };
    }).filter(Boolean);
    flatMap[pt] = {
      count:    s.count,
      whiffs:   s.whiffs,
      cstrikes: s.cstrikes,
      hip:      s.hip,
      avgVelo:  s.velos.length  ? +avg(s.velos).toFixed(1)  : null,
      peakVelo: s.velos.length  ? +Math.max(...s.velos).toFixed(1) : null,
      whiffPct: s.swings ? +(s.whiffs/s.swings*100).toFixed(1) : null,   // per swing
      cswPct:   s.count ? +((s.whiffs+s.cstrikes)/s.count*100).toFixed(1) : 0,
      avgXwoba: s.xwobas.length ? +avg(s.xwobas).toFixed(3) : null,
      avgEV:    s.launch_speeds.length ? +avg(s.launch_speeds).toFixed(1) : null,
      avgIVB:   s.pfx_zs.length ? +(avg(s.pfx_zs)*12).toFixed(1) : null,
      avgHB:    s.pfx_xs.length ? +(-avg(s.pfx_xs)*12).toFixed(1) : null,
      avgVAA:   angles.length   ? +avg(angles.map(a=>a.vaa)).toFixed(1) : null,
      avgHAA:   angles.length   ? +avg(angles.map(a=>a.haa)).toFixed(1) : null,
      // Release point — height (ft off ground) and side (ft from rubber
      // center, catcher's-view sign — matches Statcast's raw convention).
      avgRelHeight: s.rel_zs.length ? +avg(s.rel_zs).toFixed(2) : null,
      avgRelSide:   s.rel_xs.length ? +avg(s.rel_xs).toFixed(2) : null,
      avgExt:       s.exts.length ? +avg(s.exts).toFixed(2) : null,
      avgPercVelo:  s.effSpeeds.length ? +avg(s.effSpeeds).toFixed(1) : null,
      hardHitPct:   s.launch_speeds.length ? +(s.launch_speeds.filter(v=>v>=95).length/s.launch_speeds.length*100).toFixed(1) : null,
      bbe: s.launch_speeds.length,
      mv: s.mv,
      rp: s.rp,
      avgArm: s.arms.length ? +avg(s.arms).toFixed(1) : null,
      rv: s.rv != null ? +s.rv.toFixed(2) : undefined,
      lhh: s.lhh.count ? { count:s.lhh.count, rv: s.lhh.rv != null ? +s.lhh.rv.toFixed(2) : undefined } : undefined,
      rhh: s.rhh.count ? { count:s.rhh.count, rv: s.rhh.rv != null ? +s.rhh.rv.toFixed(2) : undefined } : undefined,
      swings:s.swings, zoneN:s.zoneN, outN:s.outN, zSw:s.zSw, oSw:s.oSw, zCon:s.zCon,
    };
  });

  const totalWhiffs = Object.values(pitchMap).reduce((a,s)=>a+s.whiffs,0);
  const totalCS     = Object.values(pitchMap).reduce((a,s)=>a+s.cstrikes,0);
  const allEVs      = Object.values(pitchMap).flatMap(s=>s.launch_speeds);
  const hardHits    = allEVs.filter(ev=>ev>=95).length;
  const zonedPitches = inZone + outZone;

  return {
    pitchMap: flatMap,
    stats: {
      total,
      whiffs:        totalWhiffs,
      calledStrikes: totalCS,
      ...(() => { const l = statcastLine(rows); return { walks:l.walks, ks:l.ks, hbp:l.hbp, hits:l.hits, hrs:l.hrs, ip:l.ip }; })(),
      avgEV:         allEVs.length ? +avg(allEVs).toFixed(1) : null,
      hardHitPct:    allEVs.length ? +(hardHits/allEVs.length*100).toFixed(1) : null,
      zonePct:       zonedPitches  ? +(inZone/zonedPitches*100).toFixed(1) : null,
      oSwingPct:     outZone       ? +(swingOutZone/outZone*100).toFixed(1) : null,
      zSwingPct:     inZone        ? +(swingInZone/inZone*100).toFixed(1) : null,
      zContactPct:   swingInZone   ? +(contactInZone/swingInZone*100).toFixed(1) : null,
      swingPct:      total         ? +(totalSwings/total*100).toFixed(1) : null,
      strikePct:     total         ? +(totalStrikes/total*100).toFixed(1) : null,
      gbPct:         bipCount      ? +(gbCount/bipCount*100).toFixed(1) : null,
      fbPct:         bipCount      ? +(fbCount/bipCount*100).toFixed(1) : null,
      ldPct:         bipCount      ? +(ldCount/bipCount*100).toFixed(1) : null,
      fpStrikePct:   fp_total      ? +(fp_strikes/fp_total*100).toFixed(1) : null,
      oonStrikePct:  oneone_total  ? +(oneone_strikes/oneone_total*100).toFixed(1) : null,
    },
    sit: computeSituational(rows),
  };
}

async function submitOuting() {
  if (!pendingOutingData) { toast('Please upload a CSV first', 'error'); return; }
  const date = document.getElementById('o-date').value;
  if (!date) { toast('Date is required', 'error'); return; }

  const btn = document.getElementById('btn-submit-outing');
  btn.textContent = 'Saving...'; btn.disabled = true;

  try {
    await api('addOuting', {
      athleteId: currentAthlete.id,
      date,
      opponent: document.getElementById('o-opp').value.trim(),
      notes: document.getElementById('o-notes').value.trim(),
      pitchMap: pendingOutingData.pitchMap,
      stats: pendingOutingData.stats,
      sit: pendingOutingData.sit || null,
    });
    closeModal();
    pendingOutingData = null;
    toast('Outing saved ✓', 'success');
    // Reload profile
    await openProfile(currentAthlete.id);
  } catch(e) {
    toast('Error saving outing: ' + e.message, 'error');
    btn.textContent = 'Save Outing'; btn.disabled = false;
  }
}

async function confirmDeleteOuting(outingId, date) {
  if (!confirm(`Delete outing from ${date}? This cannot be undone.`)) return;
  try {
    await api('deleteOuting', { athleteId: currentAthlete.id, outingId });
    toast('Outing deleted', 'success');
    await openProfile(currentAthlete.id);
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

function sharePlayerLink() {
  const base = window.location.origin + window.location.pathname.replace('athletes.html','');
  const url = `${base}player.html?id=${currentAthlete.id}`;
  navigator.clipboard.writeText(url).then(() => {
    toast(`Link copied for ${currentAthlete.name} ✓`, 'success');
  }).catch(() => {
    prompt('Copy this link to share:', url);
  });
}

/* ==================== PITCH METRICS EDITOR ==================== */
const PITCH_METRIC_FIELDS = [
  { key:'psStuffPlus',  label:'psStuff+',  type:'number', placeholder:'e.g. 117' },
  { key:'spinRate',     label:'Spin Rate', type:'number', placeholder:'e.g. 2332' },
  { key:'armSide',     label:'Arm Side',  type:'number', placeholder:'e.g. 7.01' },
  { key:'vertical',    label:'Vertical',  type:'number', placeholder:'e.g. 17.17' },
  { key:'xwOBA',       label:'xwOBA',     type:'number', placeholder:'e.g. .398' },
  { key:'xSLG',        label:'xSLG',      type:'number', placeholder:'e.g. .582' },
  { key:'xBA',         label:'xBA',       type:'number', placeholder:'e.g. .346' },
  { key:'whiffPct',    label:'Whiff%',    type:'number', placeholder:'e.g. 9.1' },
  { key:'hardHitPct',  label:'HardHit%',  type:'number', placeholder:'e.g. 66.67' },
];

const EDITABLE_PITCH_TYPES = [
  { code:'FF', label:'4-Seam' },
  { code:'SI', label:'Sinker' },
  { code:'FC', label:'Cutter' },
  { code:'ST', label:'Sweeper' },
  { code:'SL', label:'Slider' },
  { code:'CU', label:'Curveball' },
  { code:'CH', label:'Changeup' },
  { code:'FS', label:'Splitter' },
];

function showEditPitchMetrics() {
  const existing = currentAthlete.pitch_metrics || {};

  const pitchRows = EDITABLE_PITCH_TYPES.map(({ code, label }) => {
    const m = existing[code] || {};
    const fields = PITCH_METRIC_FIELDS.map(f =>
      `<div class="pm-field">
        <label class="pm-field-label">${f.label}</label>
        <input class="pm-field-input" type="${f.type}" placeholder="${f.placeholder}"
          id="pm-${code}-${f.key}" value="${m[f.key] !== undefined ? m[f.key] : ''}">
      </div>`
    ).join('');
    return `<div class="pm-pitch-block">
      <div class="pm-pitch-name">
        <span class="pitch-dot" style="background:${pc(code)};width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:8px"></span>
        ${label}
      </div>
      <div class="pm-fields-grid">${fields}</div>
    </div>`;
  }).join('');

  document.getElementById('modal-title').textContent = 'Edit Pitch Metrics';
  document.getElementById('modal-body').innerHTML = `
    <p style="font-size:12px;color:var(--muted);margin-bottom:1.25rem;line-height:1.6">
      Enter psStuff+ and pitch metrics from your analytics system. Leave fields blank if not available.
      These values are used in Season Insight analysis.
    </p>
    <div class="pm-editor">${pitchRows}</div>
    <div style="display:flex;gap:.75rem;margin-top:1.5rem;justify-content:flex-end">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="savePitchMetrics()">Save Metrics</button>
    </div>`;
  document.getElementById('modal-overlay').style.display = 'flex';
}

async function savePitchMetrics() {
  const metrics = {};
  EDITABLE_PITCH_TYPES.forEach(({ code }) => {
    const pitchData = {};
    let hasData = false;
    PITCH_METRIC_FIELDS.forEach(f => {
      const el = document.getElementById(`pm-${code}-${f.key}`);
      if (el && el.value.trim() !== '') {
        pitchData[f.key] = parseFloat(el.value.trim());
        hasData = true;
      }
    });
    if (hasData) metrics[code] = pitchData;
  });

  try {
    await api('updateAthlete', {
      athleteId: currentAthlete.id,
      pitch_metrics_json: JSON.stringify(metrics)
    });
    currentAthlete.pitch_metrics = metrics;
    closeModal();
    toast('Pitch metrics saved ✓', 'success');
  } catch(e) {
    toast('Error saving: ' + e.message, 'error');
  }
}

/* ==================== SEASON INSIGHT ==================== */
async function renderSeasonInsight() {
  const container = document.getElementById('season-insight-content');
  if (!athleteOutings.length) {
    container.innerHTML = '<div class="empty-state">No outing data yet.</div>';
    return;
  }

  container.innerHTML = `<div class="ai-loading"><div class="loading-spinner"></div><p>Analyzing season data...</p></div>`;

  // Aggregate full season data
  const combined = {};
  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!s.count) return;
      if (!combined[pt]) combined[pt] = { count:0, whiffs:0, cstrikes:0, hip:0, xwobas:[], evs:[], hardHits:0, velos:[], ivbs:[], hbs:[], vaas:[], swings:0, swWhiffs:0 };
      const c = combined[pt];
      c.count += s.count||0; c.whiffs += s.whiffs||0; c.cstrikes += s.cstrikes||0; c.hip += s.hip||0;
      if (s.swings) { c.swings += s.swings; c.swWhiffs += s.swWhiffs||0; }
      if (s.avgVelo)  c.velos.push(pf(s.avgVelo));
      if (s.avgXwoba) c.xwobas.push(pf(s.avgXwoba));
      if (s.avgEV)    c.evs.push(pf(s.avgEV));
      if (s.avgIVB)   c.ivbs.push(pf(s.avgIVB));
      if (s.avgHB)    c.hbs.push(pf(s.avgHB));
      if (s.avgVAA)   c.vaas.push(pf(s.avgVAA));
    });
  });

  const total = Object.values(combined).reduce((a,s)=>a+s.count,0);
  const totalK  = athleteOutings.reduce((a,o)=>a+(+o.strikeouts||0),0);
  const totalBB = athleteOutings.reduce((a,o)=>a+(+o.walks||0),0);
  const sorted  = Object.entries(combined).sort((a,b)=>b[1].count-a[1].count);

  // Build pitch summary for AI
  // Filter out pitches with ≤10 samples (likely mistagged)
  const pitchSummary = sorted
    .filter(([,s]) => s.count > 10)
    .map(([pt,s]) => {
      const mlb = MLB_BASELINE_REF[pt];
      const xbas  = athleteOutings.flatMap(o => { try { const pm = typeof o.pitch_stats==='object'?o.pitch_stats:JSON.parse(o.pitch_stats_json||'{}'); return pm[pt]?.avgXba ? [pf(pm[pt].avgXba)] : []; } catch(e){ return []; } });
      const xslgs = athleteOutings.flatMap(o => { try { const pm = typeof o.pitch_stats==='object'?o.pitch_stats:JSON.parse(o.pitch_stats_json||'{}'); return pm[pt]?.avgXslg ? [pf(pm[pt].avgXslg)] : []; } catch(e){ return []; } });
      const spins = athleteOutings.flatMap(o => { try { const pm = typeof o.pitch_stats==='object'?o.pitch_stats:JSON.parse(o.pitch_stats_json||'{}'); return pm[pt]?.avgSpin ? [pf(pm[pt].avgSpin)] : []; } catch(e){ return []; } });
      return {
        pitch: pn(pt),
        code: pt,
        count: s.count,
        usage: total ? +(s.count/total*100).toFixed(1) : 0,
        avgVelo: s.velos.length ? +avg(s.velos).toFixed(1) : null,
        whiffPct: wps(s.swWhiffs, s.swings),   // per swing
        swStrPct: s.count ? +(s.whiffs/s.count*100).toFixed(1) : 0,
        cswPct: s.count ? +((s.whiffs+s.cstrikes)/s.count*100).toFixed(1) : 0,
        avgXwoba: s.xwobas.length ? +avg(s.xwobas).toFixed(3) : null,
        avgXba:  xbas.length  ? +avg(xbas).toFixed(3)  : null,
        avgXslg: xslgs.length ? +avg(xslgs).toFixed(3) : null,
        avgEV: s.evs.length ? +avg(s.evs).toFixed(1) : null,
        avgIVB: s.ivbs.length ? +avg(s.ivbs).toFixed(1) : null,
        avgHB: s.hbs.length ? +avg(s.hbs).toFixed(1) : null,
        avgVAA: s.vaas.length ? +avg(s.vaas).toFixed(1) : null,
        avgSpin: spins.length ? Math.round(avg(spins)) : null,
        mlbWhiff: mlb?.whiff_pct || null,
        mlbXwoba: mlb?.avg_xwoba || null,
      };
    });

  // Zone/swing season averages
  const zonePct     = avg(athleteOutings.map(o=>pf(o.zone_pct)).filter(Boolean));
  const oSwingPct   = avg(athleteOutings.map(o=>pf(o.o_swing_pct)).filter(Boolean));
  const zContactPct = avg(athleteOutings.map(o=>pf(o.z_contact_pct)).filter(Boolean));
  const gbPct       = avg(athleteOutings.map(o=>pf(o.gb_pct)).filter(Boolean));

  const fpStrikePct  = avg(athleteOutings.map(o=>pf(o.fp_strike_pct)).filter(Boolean)) || null;
  const oonStrikePct = avg(athleteOutings.map(o=>pf(o.oon_strike_pct)).filter(Boolean)) || null;
  const race2kPct    = avg(athleteOutings.map(o=>pf(o.race2k_pct)).filter(Boolean)) || null;
  const putawayPct   = avg(athleteOutings.map(o=>pf(o.putaway_pct)).filter(Boolean)) || null;

  const pm_stored = (() => {
    let pm = currentAthlete.pitch_metrics || {};
    if (!Object.keys(pm).length) {
      const key = (currentAthlete.name || '').toLowerCase();
      pm = PSSTUFF_DATA[key]?.metrics || {};
    }
    return pm;
  })();

  // Supplemental org stats if available
  const seasonKey = (currentAthlete.name || '').toLowerCase();
  const orgStats = SEASON_STATS?.[seasonKey] || null;
  const orgStatsLine = orgStats ? `
ORG REPORT STATS (source of truth — use these over Statcast estimates):
FIP:${orgStats.fip} | WHIP:${orgStats.whip} | IP:${orgStats.ip}
K%:${orgStats.kPct}% | BB%:${orgStats.bbPct}% | K%-BB%:${orgStats.kMinusBB}% | SwStr%:${orgStats.swingWhiffPct}%
Total K:${orgStats.totalK} | Total BB:${orgStats.totalBB} | HR allowed:${orgStats.totalHR}

ORG PITCH DATA (use these numbers — more accurate than Statcast):
${Object.entries(orgStats.pitchData).map(([pt, p]) =>
  `${pn(pt)}: ${p.total} pitches | ${p.avgVelo}mph | Strike%:${p.strikePct}% | Whiff%:${p.whiffPct}% | xBA:${p.xba} xSLG:${p.xslg} xOPS:${p.xops} | GB%:${p.gbPct}% FB%:${p.fbPct}% LD%:${p.ldPct}%` +
  (p.rhh?.total ? `\n  vs RHH: ${p.rhh.total}p | Whiff%:${p.rhh.whiffPct}% | xBA:${p.rhh.xba} xOPS:${p.rhh.xops} | GB%:${p.rhh.gbPct}%` : '') +
  (p.lhh?.total ? `\n  vs LHH: ${p.lhh.total}p | Whiff%:${p.lhh.whiffPct}% | xBA:${p.lhh.xba} xOPS:${p.lhh.xops} | GB%:${p.lhh.gbPct}%` : '')
).join('\n')}` : '';

  const prompt = `You are a pitching coach at 8ctane Baseball writing directly to your pitcher. Your tone is direct, encouraging, and specific - like a coach who knows this pitcher well. Use "you" and "your" throughout. Frame weaknesses constructively. Speak plainly - no stat abbreviations in narrative text. NEVER mention psStuff+ or any stuff grade unless explicitly provided in the data.

PITCHER: ${currentAthlete.name} (${currentAthlete.throws}HP, ${currentAthlete.team||'unknown team'}, ${currentAthlete.level||''})
SEASON: ${athleteOutings.length} outings, ${total} pitches, ${totalK}K, ${totalBB}BB
ZONE%: ${zonePct?.toFixed(1)||'N/A'}% | O-Swing%: ${oSwingPct?.toFixed(1)||'N/A'}% | Z-Contact%: ${zContactPct?.toFixed(1)||'N/A'}% | GB%: ${gbPct?.toFixed(1)||'N/A'}% | F-Strike%: ${fpStrikePct?.toFixed(1)||'N/A'}% | 1-1 Strike%: ${oonStrikePct?.toFixed(1)||'N/A'}% | Race to 2K: ${race2kPct?.toFixed(1)||'N/A'}% | Putaway%: ${putawayPct?.toFixed(1)||'N/A'}%

${orgStatsLine}

NOTE: Pitches with 10 or fewer samples have been excluded as likely mistagged. Only analyze the pitches listed below.

${aiOrientation(aiIsLefty())}

ARSENAL (IVB in inches; HB in inches labeled arm-side / glove-side — only pitches with >10 samples):
${pitchSummary.map(p => {
  const real = pm_stored[p.code] || pm_stored[p.code === 'FA' ? 'FF' : p.code === 'FF' ? 'FA' : p.code];
  const gradeStr = (real && real.psStuffPlus) ? ' | psStuff+:' + real.psStuffPlus + ' [8ctane]' : '';
  const spinStr = p.avgSpin ? ' | Spin:' + p.avgSpin + 'rpm' : '';
  const shapeStr = ' | IVB:' + (p.avgIVB||'?') + '" HB:' + aiHB(p.avgHB, aiIsLefty());
  const resultsStr = ' | Whiff/Swing:' + (p.whiffPct ?? '?') + '% (MLB avg:' + (p.mlbWhiff||'?') + '%) | SwStr:' + p.swStrPct + '% | xwOBA:' + (p.avgXwoba||'N/A') + ' | xBA:' + (p.avgXba||'N/A') + ' | xSLG:' + (p.avgXslg||'N/A');
  return p.pitch + ' (' + p.code + '): ' + p.count + ' pitches, ' + p.usage + '% usage | ' + (p.avgVelo||'?') + 'mph' + spinStr + shapeStr + resultsStr + gradeStr;
}).join('\n')}

${aiLocationLines(athleteOutings.map(o => o.pitch_stats), aiIsLefty())}

${AI_LOCATION_RULE}

8CTANE COACHING PHILOSOPHY — follow these exactly:

PRIORITY ORDER:
1. STUFF QUALITY — velo, movement shape, whiff rate. This is the primary signal for everything.
2. STRIKE THROWING — Zone%, F-Strike%, 1-1 Strike%, Race to 2K, and Putaway% are all critical. F-Strike% below 58% or 1-1 Strike% below 55% should lead concerns. Race to 2K below 45% means the pitcher is falling behind early. Putaway% below 28% means they struggle to finish when ahead.
3. RESULTS — xwOBA, xBA, xSLG as supporting context.

ARSENAL SHAPE RULES:
- Big shape fastball = IVB > 18". Big shape breaking ball = HB > 10" glove-side OR drop > 10".
- If pitcher has BOTH but NO bridging pitch (cutter/firm slider with < 6" movement), flag the gap and recommend the bridging pitch.
- ALWAYS include an MLB pitcher comp with similar arsenal and handedness — someone currently active who throws a similar mix. Make it specific and relevant.
- ONLY recommend adding a pitch if there is a clear shape gap. Stick to: cutter, sinker, slider, sweeper, changeup, splitter, curveball. NEVER suggest knuckleball, eephus, or screwball.
- Never remove a pitch based on usage alone — only on poor stuff AND poor results.

WHIFF RULES:
- 30%+ whiff = elite weapon, highlight prominently.
- Below 12% whiff with 20%+ usage = address constructively.

TONE: Lead with strengths. Name the actual pitch. Frame concerns as fixable. Speak directly to the pitcher.

Respond with JSON only (no markdown):
{
  "headline": "2-3 word headline capturing the season",
  "summary": "3-4 sentences to the pitcher — lead with strengths, address the main story",
  "pitchBlurbs": [
    {
      "pitch": "pitch name",
      "grade": "Elite / Plus / Average / Below Average / Poor — only include if psStuff+ was provided, otherwise omit this field",
      "blurb": "1-2 sentences covering what makes this pitch work or not — reference shape, velo, whiff rate, xwOBA/xBA/xSLG where relevant. Written directly to the pitcher."
    }
  ],
  "strengths": [{"title": "...", "detail": "specific and encouraging, name the pitch and what makes it work"}],
  "concerns": [{"title": "...", "detail": "honest but constructive — what needs fixing and why it's fixable"}],
  "arsenalAssessment": {
    "keepPitches": [{"pitch": "...", "reason": "why this pitch is a weapon for you"}],
    "developPitches": [{"pitch": "...", "reason": "what you can unlock with more work on this pitch"}],
    "addPitch": {"pitch": "...", "reason": "specific gap in arsenal + name MLB pitcher with similar profile and handedness who uses this pitch successfully"},
    "removePitch": {"pitch": "...", "reason": "honest explanation — only include if poor stuff AND poor results"}
  },
  "mlbComp": {
    "name": "MLB pitcher name",
    "reason": "2-3 sentences — why this pitcher is a relevant comp (similar handedness, similar arsenal shape, similar movement profiles). What can this pitcher learn from watching that comp?"
  },
  "splitAdvice": {
    "vsRHH": "2-3 sentences — specific pitch sequencing advice based on movement profiles",
    "vsLHH": "2-3 sentences — specific pitch sequencing advice based on movement profiles"
  },
  "developmentPriorities": ["most important thing to work on right now", "second priority", "third priority"]
}`;


  try {
    const analysis = await callClaudeProxy(prompt);
    renderSeasonInsightHTML(analysis, pitchSummary, total);
  } catch(e) {
    container.innerHTML = `<div class="empty-state">Could not generate insights: ${e.message}</div>`;
  }
}

function renderSeasonInsightHTML(a, pitchSummary, total) {
  const container = document.getElementById('season-insight-content');

  const strengthCards = (a.strengths||[]).map(s =>
    `<div class="insight-card good"><div class="insight-title">${s.title}</div><div class="insight-body">${s.detail}</div></div>`
  ).join('');

  const concernCards = (a.concerns||[]).map(c =>
    `<div class="insight-card danger"><div class="insight-title">${c.title}</div><div class="insight-body">${c.detail}</div></div>`
  ).join('');

  const keepPitches = (a.arsenalAssessment?.keepPitches||[]).map(p =>
    `<div class="arsenal-rec keep">✓ <strong>${p.pitch}</strong> — ${p.reason}</div>`
  ).join('');
  const devPitches = (a.arsenalAssessment?.developPitches||[]).map(p =>
    `<div class="arsenal-rec develop">↑ <strong>${p.pitch}</strong> — ${p.reason}</div>`
  ).join('');
  const addPitch = a.arsenalAssessment?.addPitch
    ? `<div class="arsenal-rec add">+ Add: <strong>${a.arsenalAssessment.addPitch.pitch}</strong> — ${a.arsenalAssessment.addPitch.reason}</div>` : '';
  const removePitch = a.arsenalAssessment?.removePitch
    ? `<div class="arsenal-rec remove">− Consider removing: <strong>${a.arsenalAssessment.removePitch.pitch}</strong> — ${a.arsenalAssessment.removePitch.reason}</div>` : '';

  // Per-pitch blurbs
  const pitchBlurbs = (a.pitchBlurbs||[]).map(pb => {
    const match = pitchSummary.find(p => p.pitch === pb.pitch || p.code === pb.pitch);
    const dotColor = match ? pc(match.code) : '#555';
    const gradeHTML = pb.grade
      ? `<span class="pitch-blurb-grade ${pb.grade.toLowerCase().replace(' ','_')}">${pb.grade}</span>` : '';
    return `<div class="pitch-blurb-row">
      <div class="pitch-blurb-header">
        <span class="pitch-dot" style="background:${dotColor};width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:7px;flex-shrink:0"></span>
        <span class="pitch-blurb-name">${pb.pitch}</span>
        ${gradeHTML}
      </div>
      <div class="pitch-blurb-text">${pb.blurb}</div>
    </div>`;
  }).join('');

  // MLB comp
  const mlbCompHTML = a.mlbComp?.name ? `
    <div class="section-hd" style="margin-top:1.5rem">MLB Comparison</div>
    <div class="mlb-comp-card">
      <div class="mlb-comp-name">${a.mlbComp.name}</div>
      <div class="mlb-comp-reason">${a.mlbComp.reason}</div>
    </div>` : '';

  container.innerHTML = `
    <div class="insight-page">

      <div class="insight-headline">${a.headline||''}</div>
      <div class="insight-summary">${a.summary||''}</div>

      ${pitchBlurbs ? `<div class="section-hd" style="margin-top:1.5rem">Pitch Breakdown</div>
      <div class="pitch-blurbs-wrap">${pitchBlurbs}</div>` : ''}

      <div class="section-hd" style="margin-top:1.5rem">Strengths & concerns</div>
      <div class="insight-grid">${strengthCards}${concernCards}</div>

      <div class="section-hd" style="margin-top:1.5rem">Arsenal assessment</div>
      <div class="arsenal-recs">${keepPitches}${devPitches}${addPitch}${removePitch}</div>

      ${mlbCompHTML}

      <div class="section-hd" style="margin-top:1.5rem">Splits sequencing</div>
      <div class="splits-advice-grid">
        <div class="splits-advice-card">
          <div class="splits-advice-hd" style="color:#378ADD">vs. Right-handed hitters</div>
          <div class="splits-advice-body">${a.splitAdvice?.vsRHH||''}</div>
        </div>
        <div class="splits-advice-card">
          <div class="splits-advice-hd" style="color:#D85A30">vs. Left-handed hitters</div>
          <div class="splits-advice-body">${a.splitAdvice?.vsLHH||''}</div>
        </div>
      </div>

      <div class="section-hd" style="margin-top:1.5rem">Development priorities</div>
      <div class="dev-priorities">
        ${(a.developmentPriorities||[]).map((p,i) =>
          `<div class="dev-priority-row"><span class="dev-num">${i+1}</span><span>${p}</span></div>`
        ).join('')}
      </div>

    </div>`;
}

/* ==================== OUTING INSIGHT ==================== */
function initOutingInsight() {
  const sel = document.getElementById('outing-insight-sel');
  const sorted = [...athleteOutings].sort((a,b) => b.date.localeCompare(a.date));
  sel.innerHTML = '<option value="">Select an outing...</option>' +
    sorted.map(o => `<option value="${o.id}">${formatDate(o.date)} vs. ${o.opponent||'—'} (${o.total_pitches||0} pitches)</option>`).join('');
  document.getElementById('outing-insight-content').innerHTML = '';
}

async function loadOutingInsight() {
  const sel = document.getElementById('outing-insight-sel');
  const outingId = sel.value;
  if (!outingId) return;

  const outing = athleteOutings.find(o => o.id === outingId);
  if (!outing) return;

  const container = document.getElementById('outing-insight-content');
  container.innerHTML = `<div class="ai-loading"><div class="loading-spinner"></div><p>Analyzing outing...</p></div>`;

  let pm = {};
  try { pm = typeof outing.pitch_stats==='object' ? outing.pitch_stats : JSON.parse(outing.pitch_stats_json||'{}'); } catch(e){}

  const total = outing.total_pitches || 0;
  const pitchLines = Object.entries(pm)
    .filter(([,s])=>s.count>0)
    .sort((a,b)=>b[1].count-a[1].count)
    .map(([pt,s]) => {
      const mlb = MLB_BASELINE_REF[pt];
      return `${pn(pt)}: ${s.count} pitches (${total?(s.count/total*100).toFixed(0):0}%) | ${s.avgVelo||'?'} mph | Whiff/Swing: ${s.whiffPct ?? '?'}% | SwStr: ${s.swStrPct ?? '?'}% | CSW: ${s.cswPct||0}% | xwOBA: ${s.avgXwoba||'N/A'} | IVB: ${s.avgIVB||'?'}" HB: ${aiHB(s.avgHB, aiIsLefty())} VAA: ${s.avgVAA||'?'}° (MLB whiff avg: ${mlb?.whiff_pct||'?'}%)`;
    }).join('\n');

  const prompt = `You are a pitching coach at 8ctane Baseball writing directly to your pitcher after their outing. Your tone is direct, honest, and encouraging — like a coach who watched every pitch and wants to help them grow. Use "you" and "your" throughout. Be specific about what happened, what worked, and what to adjust. Speak plainly — avoid stat jargon. NEVER mention psStuff+ or any stuff grade unless it was explicitly provided in the data — do not calculate or infer it yourself.

PITCHER: ${currentAthlete.name} (${currentAthlete.throws}HP, ${currentAthlete.level||''})
OUTING: ${formatDate(outing.date)} vs. ${outing.opponent||'Unknown'} | ${total} pitches | ${outing.strikeouts||outing.ks||0}K ${outing.walks||0}BB
Zone%: ${outing.zone_pct||'N/A'}% | O-Swing%: ${outing.o_swing_pct||'N/A'}% | Z-Contact%: ${outing.z_contact_pct||'N/A'}% | GB%: ${outing.gb_pct||'N/A'}% | SwStr%: ${total?(+outing.whiffs/total*100).toFixed(1):'N/A'}%

${aiOrientation(aiIsLefty())}

PITCH-BY-PITCH (HB labeled arm-side / glove-side):
${pitchLines}

${aiLocationLines([pm], aiIsLefty())}

${AI_LOCATION_RULE}

Respond with JSON only (no markdown):
{
  "headline": "2-3 word outing summary — direct and honest",
  "summary": "3-4 sentences written directly to the pitcher — what happened tonight, the good and the bad",
  "whatWorked": [{"title": "...", "detail": "specific encouragement about what worked and why to keep doing it"}],
  "whatDidnt": [{"title": "...", "detail": "honest but constructive — what went wrong and how to fix it"}],
  "keyMoments": ["specific moment from the outing written to the pitcher", "..."],
  "adjustments": [{"count": "...", "current": "...", "suggested": "...", "pitch": "...", "reason": "direct coaching advice"}],
  "nextOutingFocus": ["specific actionable focus written to the pitcher", "...", "..."]
}`;

  try {
    const analysis = await callClaudeProxy(prompt);
    renderOutingInsightHTML(analysis, outing, pm, total);
  } catch(e) {
    container.innerHTML = `<div class="empty-state">Could not generate insights: ${e.message}</div>`;
  }
}

function renderOutingInsightHTML(a, outing, pm, total) {
  const container = document.getElementById('outing-insight-content');

  const workedCards = (a.whatWorked||[]).map(s =>
    `<div class="insight-card good"><div class="insight-title">${s.title}</div><div class="insight-body">${s.detail}</div></div>`
  ).join('');
  const didntCards = (a.whatDidnt||[]).map(s =>
    `<div class="insight-card danger"><div class="insight-title">${s.title}</div><div class="insight-body">${s.detail}</div></div>`
  ).join('');

  const pitchRows = Object.entries(pm).filter(([,s])=>s.count>0).sort((a,b)=>b[1].count-a[1].count)
    .map(([pt,s]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <span class="pitch-chip" style="min-width:90px"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span>
        <span class="v-num" style="min-width:35px">${s.count}</span>
        <span style="color:var(--muted);font-size:11px;min-width:45px">${total?(s.count/total*100).toFixed(0):0}%</span>
        <span class="v-num" style="min-width:55px">${s.avgVelo||'—'} mph</span>
        <span class="${s.whiffPct>=30?'v-good':s.whiffPct>=20?'v-warn':'v-bad'}">${s.whiffPct ?? '—'}${s.whiffPct!=null?'%':''} W</span>
        <span class="v-num" style="font-size:11px">${s.cswPct||0}% CSW</span>
      </div>`).join('');

  // Build outing-level location chart
  const outingLocationChart = buildOutingLocationChart(pm, total);
  const outingSprayChart    = buildOutingSprayChart(pm);

  container.innerHTML = `
    <div class="insight-page">

      <div class="outing-insight-header">
        <div class="insight-headline">${a.headline||''}</div>
        <div class="outing-insight-meta">${formatDate(outing.date)} · vs. ${outing.opponent||'—'} · ${total} pitches · ${outing.strikeouts||outing.ks||0}K ${outing.walks||0}BB</div>
      </div>
      <div class="insight-summary">${a.summary||''}</div>

      <div class="section-hd" style="margin-top:1.5rem">Pitch breakdown</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.75rem 1.25rem">
        <div style="display:flex;gap:10px;padding:.4rem 0;margin-bottom:4px">
          <span style="min-width:90px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Pitch</span>
          <span style="min-width:35px;font-size:10px;color:var(--muted);text-transform:uppercase">N</span>
          <span style="min-width:45px;font-size:10px;color:var(--muted);text-transform:uppercase">Use%</span>
          <span style="min-width:55px;font-size:10px;color:var(--muted);text-transform:uppercase">Velo</span>
          <span style="font-size:10px;color:var(--muted);text-transform:uppercase">Results</span>
        </div>
        ${pitchRows}
      </div>

      ${(outingLocationChart || outingSprayChart) ? `
      <div class="section-hd" style="margin-top:1.5rem">Pitch locations</div>
      <div style="display:flex;flex-wrap:wrap;gap:1.5rem;margin-top:.75rem">
        ${outingLocationChart||''}
        ${outingSprayChart||''}
      </div>` : ''}

      <div class="section-hd" style="margin-top:1.5rem">What worked / what didn't</div>
      <div class="insight-grid">${workedCards}${didntCards}</div>

      ${a.keyMoments?.length ? `
      <div class="section-hd" style="margin-top:1.5rem">Key moments</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.875rem 1.25rem">
        ${a.keyMoments.map(m=>`<div style="padding:.4rem 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--muted)">· ${m}</div>`).join('')}
      </div>` : ''}

      ${a.nextOutingFocus?.length ? `
      <div class="section-hd" style="margin-top:1.5rem">Focus for next outing</div>
      <div class="dev-priorities">
        ${a.nextOutingFocus.map((p,i)=>`<div class="dev-priority-row"><span class="dev-num">${i+1}</span><span>${p}</span></div>`).join('')}
      </div>` : ''}

    </div>`;
}

function buildOutingLocationChart(pm, total) {
  // Collect all locations from this outing's pitch map
  const allLocs = [];
  Object.entries(pm).forEach(([pt, s]) => {
    if (!s.locations || !s.locations.length) return;
    s.locations.forEach(loc => {
      const [x, z, outcome, stand] = loc;
      allLocs.push({ x, z, outcome, stand, pt });
    });
  });
  if (!allLocs.length) return null;

  const W = 260, H = 300, PAD = 22;
  const xMin=-1.75, xMax=1.75, zMin=0.5, zMax=5.0;
  const toSvgX = x => PAD + (x-xMin)/(xMax-xMin)*(W-PAD*2);
  const toSvgZ = z => H - PAD - (z-zMin)/(zMax-zMin)*(H-PAD*2);
  const szX1=toSvgX(-0.71), szX2=toSvgX(0.71);
  const szZ1=toSvgZ(3.5),   szZ2=toSvgZ(1.5);

  const OUTCOME_COLORS = { W:'#e91e8c', CS:'#00d4ff', HIP:'#BA7517', F:'#534AB7', B:'rgba(255,255,255,0.15)' };

  // Sort: balls behind, whiffs on top
  const priority = { B:0, F:1, HIP:2, CS:3, W:4 };
  const sorted = [...allLocs].sort((a,b)=>(priority[a.outcome]||0)-(priority[b.outcome]||0));

  const dots = sorted.map(({ x, z, outcome, pt }) => {
    const cx = toSvgX(x), cy = toSvgZ(z);
    if (cx < PAD-10 || cy < PAD-10 || cx > W+10 || cy > H+10) return '';
    const color = pc(pt);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${outcome==='W'?5:3.5}" fill="${color}" fill-opacity="0.75" stroke="${outcome==='W'?'#fff':color}" stroke-width="${outcome==='W'?0.8:0.3}"/>`;
  }).join('');

  // Pitch legend
  const ptCounts = {};
  allLocs.forEach(({pt}) => ptCounts[pt]=(ptCounts[pt]||0)+1);
  const legend = Object.entries(ptCounts).sort((a,b)=>b[1]-a[1])
    .map(([pt,n])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:10px;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:${pc(pt)};display:inline-block"></span>${pn(pt)}</span>`).join('');

  return `<div class="loc-zone-card">
    <div class="loc-zone-title">Locations <span style="font-size:11px;color:var(--muted);font-weight:400">${allLocs.length} pitches</span></div>
    <svg width="${W}" height="${H}" style="display:block">
      <rect x="${PAD}" y="${PAD}" width="${W-PAD*2}" height="${H-PAD*2}" fill="rgba(255,255,255,0.02)" rx="2"/>
      <rect x="${szX1}" y="${szZ1}" width="${szX2-szX1}" height="${szZ2-szZ1}" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" rx="1"/>
      ${[1,2].map(i=>`<line x1="${szX1+(szX2-szX1)/3*i}" y1="${szZ1}" x2="${szX1+(szX2-szX1)/3*i}" y2="${szZ2}" stroke="rgba(255,255,255,0.12)" stroke-width="0.75"/>`).join('')}
      ${[1,2].map(i=>`<line x1="${szX1}" y1="${szZ1+(szZ2-szZ1)/3*i}" x2="${szX2}" y2="${szZ1+(szZ2-szZ1)/3*i}" stroke="rgba(255,255,255,0.12)" stroke-width="0.75"/>`).join('')}
      <rect x="${toSvgX(-1.05)}" y="${toSvgZ(4.0)}" width="${toSvgX(1.05)-toSvgX(-1.05)}" height="${toSvgZ(1.0)-toSvgZ(4.0)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4,3" rx="2"/>
      <polygon points="${toSvgX(0)},${H-PAD+4} ${toSvgX(-0.28)},${H-PAD-4} ${toSvgX(-0.28)},${H-PAD} ${toSvgX(0.28)},${H-PAD} ${toSvgX(0.28)},${H-PAD-4}" fill="rgba(255,255,255,0.25)"/>
      <text x="${W/2}" y="${H-2}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.2)">← Inside · Outside →</text>
      ${dots}
    </svg>
    <div style="margin-top:6px;line-height:1.8">${legend}</div>
    <div style="font-size:10px;color:var(--muted2);margin-top:2px">White outline = whiff</div>
  </div>`;
}

function buildOutingSprayChart(pm) {
  const sprayData = [];
  Object.entries(pm).forEach(([pt, s]) => {
    if (!s.spray || !s.spray.length) return;
    s.spray.forEach(sp => {
      const [x, y, bbt, ev] = sp;
      sprayData.push({ x, y, bbt, ev, pt });
    });
  });
  if (!sprayData.length) return null;

  const W=280, H=265;
  const BB_COLORS = { ground_ball:'#BA7517', line_drive:'#00d4ff', fly_ball:'#e91e8c', popup:'#888780' };
  const BB_LABELS  = { ground_ball:'Ground Ball', line_drive:'Line Drive', fly_ball:'Fly Ball', popup:'Popup' };
  const HX_CENTER=125, HY_HOME=205, SCALE=1.0;
  const cx=W/2, homY=H-18;
  const lfX=25, lfY=50, rfX=W-25, rfY=50, cfX=cx, cfY=5;

  const toX = hcx => W/2+(hcx-HX_CENTER)*SCALE;
  const toY = hcy => H-20-(HY_HOME-hcy)*SCALE;

  const dots = sprayData.map(({x,y,bbt,ev,pt})=>{
    const svgX=toX(x), svgY=toY(y);
    if(svgX<0||svgY<-10||svgX>W||svgY>H) return '';
    const color = BB_COLORS[bbt]||'#888';
    const hard = ev&&ev>=95;
    return `<circle cx="${svgX.toFixed(1)}" cy="${svgY.toFixed(1)}" r="${hard?6:4.5}" fill="${color}" fill-opacity="0.8" stroke="${hard?'rgba(255,255,255,0.8)':'none'}" stroke-width="${hard?1:0}"/>`;
  }).join('');

  const legend = Object.entries(BB_COLORS).map(([k,c])=>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:10px;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></span>${BB_LABELS[k]}</span>`
  ).join('');

  return `<div class="loc-zone-card">
    <div class="loc-zone-title">Spray Chart <span style="font-size:11px;color:var(--muted);font-weight:400">${sprayData.length} batted balls</span></div>
    <svg width="${W}" height="${H}" style="display:block">
      <path d="M ${cx} ${homY} L ${lfX} ${lfY} Q ${cfX} ${cfY-5} ${rfX} ${rfY} Z" fill="rgba(255,255,255,0.02)" stroke="none"/>
      <path d="M ${lfX} ${lfY} Q ${cfX} ${cfY-5} ${rfX} ${rfY}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
      <line x1="${cx}" y1="${homY}" x2="${lfX-8}" y2="${lfY-12}" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
      <line x1="${cx}" y1="${homY}" x2="${rfX+8}" y2="${rfY-12}" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
      <circle cx="${cx}" cy="${homY-60}" r="46" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="3,3"/>
      <rect x="${cx-5}" y="${homY-115-5}" width="10" height="10" fill="rgba(255,255,255,0.2)" transform="rotate(45,${cx},${homY-115})" rx="1"/>
      <rect x="${cx-58-5}" y="${homY-58-5}" width="10" height="10" fill="rgba(255,255,255,0.2)" transform="rotate(45,${cx-58},${homY-58})" rx="1"/>
      <rect x="${cx+58-5}" y="${homY-58-5}" width="10" height="10" fill="rgba(255,255,255,0.2)" transform="rotate(45,${cx+58},${homY-58})" rx="1"/>
      <polygon points="${cx},${homY-3} ${cx-7},${homY-9} ${cx-7},${homY+2} ${cx+7},${homY+2} ${cx+7},${homY-9}" fill="rgba(255,255,255,0.3)"/>
      ${dots}
    </svg>
    <div style="margin-top:6px;line-height:1.8">${legend}</div>
    <div style="font-size:10px;color:var(--muted2);margin-top:2px">White outline = hard hit (95+ mph)</div>
  </div>`;
}

/* ==================== STRIKE ZONE DIAGRAM ==================== */
function strikeZoneDiagram(location, pitchName) {
  // 3x3 grid: positions = up-in, up-middle, up-away / middle-in, middle, middle-away / low-in, low-middle, low-away
  const grid = [
    ['up-in','up-middle','up-away'],
    ['middle-in','middle','middle-away'],
    ['low-in','low-middle','low-away'],
  ];
  const ptColor = Object.entries(PITCH_NAMES).find(([,v])=>v===pitchName)?.[0];
  const color = ptColor ? pc(ptColor) : 'var(--cyan)';

  const cells = grid.map(row =>
    row.map(zone => {
      const isActive = zone === location;
      return `<div class="sz-cell ${isActive?'active':''}" style="${isActive?`background:${color};border-color:${color}`:''}"></div>`;
    }).join('')
  ).join('');

  return `<div class="strike-zone">${cells}</div>`;
}

async function callClaudeProxy(prompt) {
  const res = await api('analyze', {
    messages: [{ role: 'user', content: prompt }]
  });
  if (res.error) throw new Error(res.error);
  return JSON.parse(res.text);
}
function renderReport() {
  const container = document.getElementById('report-content');
  if (!athleteOutings.length) {
    container.innerHTML = '<div class="empty-state">No outing data available yet.</div>';
    return;
  }

  // Detect level — skip MLB percentiles for independent league
  const level = (currentAthlete.level || '').toLowerCase();
  const isIndependent = level === 'other' || level === 'atlantic' || level === 'indy';
  const hasBaselines = Object.keys(MLB_BASELINE_REF).length > 0 && !isIndependent;

  // Aggregate season stats from pitch map
  const combined = {};
  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!s.count) return;
      if (!combined[pt]) combined[pt] = { count:0, whiffs:0, cstrikes:0, hip:0, xwobas:[], evs:[], hardHits:0, velos:[], ivbs:[], hbs:[], swings:0, swWhiffs:0 };
      const c = combined[pt];
      c.count    += s.count    || 0;
      c.whiffs   += s.whiffs   || 0;
      if (s.swings) { c.swings += s.swings; c.swWhiffs += s.swWhiffs||0; }
      c.cstrikes += s.cstrikes || 0;
      c.hip      += s.hip      || 0;
      if (s.avgVelo)      c.velos.push(pf(s.avgVelo));
      if (s.avgXwoba)     c.xwobas.push(pf(s.avgXwoba));
      if (s.avgEV)        c.evs.push(pf(s.avgEV));
      if (s.avgIVB)       c.ivbs.push(pf(s.avgIVB));
      if (s.avgHB)        c.hbs.push(pf(s.avgHB));
    });
  });

  const totalPitches = Object.values(combined).reduce((a,s)=>a+s.count,0);

  // MLB comps — uses velo + movement only (reduced feature set), since that's
  // already saved for every historical outing. Release point isn't saved per
  // outing yet, so comps here are slightly less precise than the single-CSV
  // tool's, but work without re-importing anything.
  const throwsHand = (currentAthlete.throws || 'R').toUpperCase().charAt(0);
  const athleteArsenal = {};
  const pitchComps = {};
  Object.entries(combined).forEach(([pt, c]) => {
    if (!c.velos.length || !c.hbs.length || !c.ivbs.length) return;
    const norm = pt === 'FA' ? 'FF' : pt;
    const velo = avg(c.velos);
    const hbFeet = -avg(c.hbs)/12; // stored avgHB is inches, sign-flipped for display — back to raw feet
    const vbFeet = avg(c.ivbs)/12;
    athleteArsenal[norm] = {
      usage_pct: c.count/totalPitches*100,
      velo, hb_norm: hbFeet*(throwsHand==='L'?-1:1), vb: vbFeet,
    };
    pitchComps[norm] = findPitchComps(norm, throwsHand, velo, hbFeet, vbFeet, null, null, null, 3, REDUCED_FEATURES);
  });
  const arsenalComps = Object.keys(athleteArsenal).length ? findArsenalComps(athleteArsenal, 3, 150, REDUCED_FEATURES) : [];
  const compName = c => c.name.split(', ').reverse().join(' ');
  const totalWhiffs  = Object.values(combined).reduce((a,s)=>a+s.whiffs,0);
  const totalCS      = Object.values(combined).reduce((a,s)=>a+s.cstrikes,0);
  const totalHIP     = Object.values(combined).reduce((a,s)=>a+s.hip,0);
  const allXwobas    = Object.values(combined).flatMap(s=>s.xwobas);
  const allEVs       = Object.values(combined).flatMap(s=>s.evs);
  const totalBB      = athleteOutings.reduce((a,o)=>a+(+o.walks||0),0);
  const totalK       = athleteOutings.reduce((a,o)=>a+(+o.strikeouts||0),0);

  // Use outing-level hard_hit_pct — per-pitch is too noisy with small samples
  const outingHHPs = athleteOutings.map(o=>pf(o.hard_hit_pct)).filter(v=>v>0);
  const hardHitPctSeason = outingHHPs.length ? avg(outingHHPs) : 0;

  const whiffPct   = outingsWhiffSw(athleteOutings) ?? 0;   // per swing
  const zWhiffSeason = zoneWhiffPct(athleteOutings.flatMap(o => Object.values(o.pitch_stats || {})));
  const cswPct     = totalPitches ? (totalWhiffs+totalCS)/totalPitches*100 : 0;
  const kPct       = totalHIP+totalK+totalBB > 0 ? totalK/(totalHIP+totalK+totalBB)*100 : 0;
  const bbPct      = totalHIP+totalK+totalBB > 0 ? totalBB/(totalHIP+totalK+totalBB)*100 : 0;
  const avgXwoba   = allXwobas.length ? avg(allXwobas) : null;
  const avgEV      = allEVs.length ? avg(allEVs) : null;
  const hardHitPct = hardHitPctSeason;
  const ffMap      = combined['FF'] || combined['FA'];
  const avgVelo    = ffMap?.velos.length ? avg(ffMap.velos) : null;
  const swStrPct   = totalPitches ? totalWhiffs/totalPitches*100 : 0;

  // Aggregate zone/swing metrics from stored outing stats
  const zoneVals=[], oSwingVals=[], zSwingVals=[], zContactVals=[],
        swingVals=[], strikeVals=[], gbVals=[], fbVals=[], ldVals=[],
        fpVals=[], oonVals=[], race2kVals=[], putawayVals=[];

  athleteOutings.forEach(o => {
    if (pf(o.zone_pct))      zoneVals.push(pf(o.zone_pct));
    if (pf(o.o_swing_pct))   oSwingVals.push(pf(o.o_swing_pct));
    if (pf(o.z_swing_pct))   zSwingVals.push(pf(o.z_swing_pct));
    if (pf(o.z_contact_pct)) zContactVals.push(pf(o.z_contact_pct));
    if (pf(o.swing_pct))     swingVals.push(pf(o.swing_pct));
    if (pf(o.strike_pct))    strikeVals.push(pf(o.strike_pct));
    if (pf(o.gb_pct))        gbVals.push(pf(o.gb_pct));
    if (pf(o.fb_pct))        fbVals.push(pf(o.fb_pct));
    if (pf(o.ld_pct))        ldVals.push(pf(o.ld_pct));
    if (pf(o.fp_strike_pct))  fpVals.push(pf(o.fp_strike_pct));
    if (pf(o.oon_strike_pct)) oonVals.push(pf(o.oon_strike_pct));
    if (pf(o.race2k_pct))     race2kVals.push(pf(o.race2k_pct));
    if (pf(o.putaway_pct))    putawayVals.push(pf(o.putaway_pct));
  });

  const zonePct     = zoneVals.length     ? avg(zoneVals)     : null;
  const oSwingPct   = oSwingVals.length   ? avg(oSwingVals)   : null;
  const zSwingPct   = zSwingVals.length   ? avg(zSwingVals)   : null;
  const zContactPct = zContactVals.length ? avg(zContactVals) : null;
  const swingPct    = swingVals.length    ? avg(swingVals)    : null;
  const strikePct   = strikeVals.length   ? avg(strikeVals)   : null;
  const gbPct       = gbVals.length       ? avg(gbVals)       : null;
  const fbPct       = fbVals.length       ? avg(fbVals)       : null;
  const ldPct       = ldVals.length       ? avg(ldVals)       : null;
  const fpStrikePct  = fpVals.length      ? avg(fpVals)      : null;
  const oonStrikePct = oonVals.length     ? avg(oonVals)     : null;
  const race2kPct    = race2kVals.length  ? avg(race2kVals)  : null;
  const putawayPct   = putawayVals.length ? avg(putawayVals) : null;

  // Peak velo
  const ffOutingPeaks = [];
  athleteOutings.forEach(o => {
    let pm={};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    const ff = pm['FF'] || pm['FA'];
    if (ff?.peakVelo) ffOutingPeaks.push(pf(ff.peakVelo));
  });
  const peakVelo = ffOutingPeaks.length ? Math.max(...ffOutingPeaks) : null;

  // MLB baseline distributions — percentile curves (p10,p25,p50,p75,p90)
  const DIST = {
    whiffPct:   { p10:18,  p25:21,  p50:25,  p75:29,  p90:33,  hib:true  },   // whiffs per swing
    swStrPct:   { p10:8,   p25:9.5, p50:11,  p75:13,  p90:15,  hib:true  },   // whiffs per pitch
    zWhiffPct:  { p10:9,   p25:12,  p50:15,  p75:18,  p90:22,  hib:true  },   // whiffs per in-zone swing
    cswPct:     { p10:14,  p25:19,  p50:24,  p75:29,  p90:35,  hib:true  },
    kPct:       { p10:14,  p25:18,  p50:22,  p75:27,  p90:32,  hib:true  },
    bbPct:      { p10:4,   p25:6,   p50:8,   p75:11,  p90:14,  hib:false },
    avgXwoba:   { p10:.26, p25:.29, p50:.32, p75:.35, p90:.39, hib:false },
    avgEV:      { p10:85,  p25:87,  p50:89,  p75:91,  p90:93,  hib:false },
    hardHitPct: { p10:28,  p25:33,  p50:38,  p75:43,  p90:49,  hib:false },
    avgVelo:    { p10:90,  p25:92,  p50:94,  p75:96,  p90:98,  hib:true  },
    zonePct:    { p10:40,  p25:44,  p50:48,  p75:52,  p90:56,  hib:true  },
    oSwingPct:  { p10:22,  p25:26,  p50:30,  p75:35,  p90:40,  hib:true  },
    zSwingPct:  { p10:58,  p25:63,  p50:68,  p75:73,  p90:78,  hib:true  },
    zContactPct:{ p10:74,  p25:78,  p50:82,  p75:86,  p90:90,  hib:false },
    swingPct:   { p10:38,  p25:42,  p50:46,  p75:50,  p90:55,  hib:true  },
    strikePct:  { p10:58,  p25:61,  p50:64,  p75:67,  p90:70,  hib:true  },
    gbPct:      { p10:30,  p25:38,  p50:45,  p75:52,  p90:58,  hib:true  },
    fbPct:      { p10:20,  p25:25,  p50:30,  p75:36,  p90:42,  hib:false },
    ldPct:      { p10:14,  p25:17,  p50:20,  p75:23,  p90:27,  hib:false },
    fpStrikePct:  { p10:52, p25:57,  p50:62,  p75:67,  p90:72,  hib:true  },
    oonStrikePct: { p10:50, p25:55,  p50:60,  p75:65,  p90:70,  hib:true  },
    race2kPct:    { p10:40, p25:47,  p50:54,  p75:61,  p90:68,  hib:true  },
    putawayPct:   { p10:22, p25:28,  p50:34,  p75:40,  p90:48,  hib:true  },
  };

  function getPercentile(val, dist) {
    if (val === null || val === undefined || isNaN(val)) return null;
    const { p10, p25, p50, p75, p90, hib } = dist;
    let pct;
    if (val <= p10) pct = hib ? 5 : 95;
    else if (val <= p25) pct = hib ? 15 + (val-p10)/(p25-p10)*15 : 80 - (val-p10)/(p25-p10)*15;
    else if (val <= p50) pct = hib ? 30 + (val-p25)/(p50-p25)*20 : 65 - (val-p25)/(p50-p25)*20;
    else if (val <= p75) pct = hib ? 50 + (val-p50)/(p75-p50)*25 : 40 - (val-p50)/(p75-p50)*25;
    else if (val <= p90) pct = hib ? 75 + (val-p75)/(p90-p75)*15 : 15 - (val-p75)/(p90-p75)*10;
    else pct = hib ? 92 : 5;
    return Math.min(99, Math.max(1, Math.round(pct)));
  }

  function pctColor(p) {
    if (p === null) return '#555';
    if (p >= 80) return '#e91e8c';
    if (p >= 60) return '#e91e8c99';
    if (p >= 40) return '#72747c';
    if (p >= 20) return '#534AB7';
    return '#378ADD';
  }

  function pctBar(label, val, displayVal, dist, unit='') {
    if (!hasBaselines) {
      return `<div class="pct-row">
        <div class="pct-label">${label}</div>
        <div class="pct-bar-track"><div class="pct-bar-fill-plain" style="width:50%;background:var(--cyan)"></div></div>
        <div class="pct-value">${displayVal !== null && displayVal !== undefined ? displayVal+unit : '—'}</div>
      </div>`;
    }
    const p = getPercentile(val, dist);
    const color = pctColor(p);
    return `<div class="pct-row">
      <div class="pct-label">${label}</div>
      <div class="pct-bar-track">
        <div class="pct-bar-fill" style="width:${p||0}%;background:${color}">
          ${p !== null ? `<span class="pct-bubble" style="background:${color}">${p}</span>` : ''}
        </div>
      </div>
      <div class="pct-value">${displayVal !== null && displayVal !== undefined ? displayVal+unit : '—'}</div>
    </div>`;
  }

  const r = (v,d=1) => v !== null && v !== undefined ? (+v).toFixed(d) : null;

  const levelBadge = isIndependent
    ? `<div class="report-note">Percentile rankings not shown — independent league data compared to MLB baselines would not be meaningful.</div>`
    : '';

  const sorted = Object.entries(combined).sort((a,b)=>b[1].count-a[1].count);

  container.innerHTML = `
    <div class="report-card">
      <div class="report-header">
        <div class="report-name">${currentAthlete.name}</div>
        <div class="report-meta">${currentAthlete.throws}HP · ${currentAthlete.team||''} · ${currentAthlete.level||''} · ${seasonLabel()} Season</div>
        <div class="report-summary-strip">
          ${[
            { v: athleteOutings.length,               l: 'G' },
            { v: totalPitches,                        l: 'Pitches' },
            { v: totalK,                              l: 'K' },
            { v: totalBB,                             l: 'BB' },
            { v: avgVelo  ? avgVelo.toFixed(1)  : '—',l: 'FB avg' },
            { v: peakVelo ? peakVelo.toFixed(1) : '—',l: 'FB peak' },
          ].map(k=>`<div class="report-sum-stat"><div class="report-sum-val">${k.v}</div><div class="report-sum-lbl">${k.l}</div></div>`).join('')}
        </div>
      </div>

      ${levelBadge}

      ${arsenalComps.length ? `<div class="arsenal-comp-banner">
        <span class="arsenal-comp-lbl">Arsenal comps (velo &amp; shape across the whole mix):</span>
        ${arsenalComps.map(c => `<span class="arsenal-comp-chip">${compName(c)}</span>`).join('')}
      </div>` : ''}

      <div class="report-section-hd">Season Percentiles${!hasBaselines?' (raw values)':' vs. MLB'}</div>
      <div class="pct-axis-labels"><span>Poor</span><span>Average</span><span>Great</span></div>

      <div class="pct-group-hd">Results</div>
      ${avgXwoba !== null        ? pctBar('xwOBA',      avgXwoba,    r(avgXwoba,3),  DIST.avgXwoba)       : ''}
      ${pctBar('Whiff%',          whiffPct,    r(whiffPct),    DIST.whiffPct,   '%')}
      ${pctBar('CSW%',            cswPct,      r(cswPct),      DIST.cswPct,     '%')}
      ${pctBar('K%',              kPct,        r(kPct),        DIST.kPct,       '%')}
      ${pctBar('BB%',             bbPct,       r(bbPct),       DIST.bbPct,      '%')}
      ${pctBar('SwStr%',          swStrPct,    r(swStrPct),    DIST.swStrPct,   '%')}
      ${zWhiffSeason !== null ? pctBar('Z-Whiff%', zWhiffSeason, r(zWhiffSeason), DIST.zWhiffPct, '%') : ''}

      <div class="pct-group-hd">Plate discipline</div>
      ${zonePct     !== null     ? pctBar('Zone%',         zonePct,      r(zonePct),      DIST.zonePct,     '%') : ''}
      ${oSwingPct   !== null     ? pctBar('O-Swing%',      oSwingPct,    r(oSwingPct),    DIST.oSwingPct,   '%') : ''}
      ${zSwingPct   !== null     ? pctBar('Z-Swing%',      zSwingPct,    r(zSwingPct),    DIST.zSwingPct,   '%') : ''}
      ${zContactPct !== null     ? pctBar('Z-Contact%',    zContactPct,  r(zContactPct),  DIST.zContactPct, '%') : ''}
      ${swingPct    !== null     ? pctBar('Swing%',        swingPct,     r(swingPct),     DIST.swingPct,    '%') : ''}
      ${strikePct   !== null     ? pctBar('Strike%',       strikePct,    r(strikePct),    DIST.strikePct,   '%') : ''}
      ${fpStrikePct !== null     ? pctBar('F-Strike%',     fpStrikePct,  r(fpStrikePct),  DIST.fpStrikePct, '%') : ''}
      ${oonStrikePct!== null     ? pctBar('1-1 Strike%',   oonStrikePct, r(oonStrikePct), DIST.oonStrikePct,'%') : ''}
      ${race2kPct   !== null     ? pctBar('Race to 2K',    race2kPct,    r(race2kPct),    DIST.race2kPct,   '%') : ''}
      ${putawayPct  !== null     ? pctBar('Putaway%',      putawayPct,   r(putawayPct),   DIST.putawayPct,  '%') : ''}

      <div class="pct-group-hd">Contact quality</div>
      ${avgEV       !== null     ? pctBar('Avg EV',      avgEV,       r(avgEV),       DIST.avgEV,      ' mph') : ''}
      ${pctBar('Hard Hit%',       hardHitPct,  r(hardHitPct),  DIST.hardHitPct, '%')}
      ${gbPct       !== null     ? pctBar('GB%',         gbPct,       r(gbPct),       DIST.gbPct,      '%') : ''}
      ${fbPct       !== null     ? pctBar('FB%',         fbPct,       r(fbPct),       DIST.fbPct,      '%') : ''}
      ${ldPct       !== null     ? pctBar('LD%',         ldPct,       r(ldPct),       DIST.ldPct,      '%') : ''}

      <div class="pct-group-hd">Stuff</div>
      ${avgVelo     !== null     ? pctBar('FB Avg Velo', avgVelo,     r(avgVelo),     DIST.avgVelo,    ' mph') : ''}
      ${peakVelo    !== null     ? pctBar('FB Peak Velo',peakVelo,    r(peakVelo),    DIST.avgVelo,    ' mph') : ''}

      ${Object.keys(pitchComps).length ? `<div class="pct-group-hd">MLB Comps by Pitch</div>
        ${Object.entries(pitchComps).filter(([,c])=>c.length).map(([pt,c]) =>
          `<div class="mlb-comp-tag" style="margin-bottom:6px" title="MLB pitchers with the closest matching velo/movement for this pitch">
            <strong style="color:var(--text)">${pn(pt)}:</strong> ${c.map(compName).join(' · ')}
          </div>`
        ).join('')}` : ''}

    </div>`;
}

/* ==================== LOCATIONS ==================== */
let locationHand = 'all';
let locationColor = 'pitch';

function setLocationHand(hand, btn) {
  locationHand = hand;
  document.querySelectorAll('[data-hand]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLocations();
}

function setLocationColor(color, btn) {
  locationColor = color;
  document.querySelectorAll('[data-color]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLocations();
}

let locationMode = 'heat';   // 'heat' (Savant density maps per pitch) | 'dots'
function setLocationMode(m, btn) {
  locationMode = m;
  document.querySelectorAll('[data-locmode]').forEach(b => b.classList.toggle('active', b.dataset.locmode === m));
  const colorRow = document.getElementById('loc-color-row');
  if (colorRow) colorRow.style.display = m === 'dots' ? '' : 'none';
  renderLocations();
}

// Density heat map on a canvas: Gaussian KDE over plate_x / plate_z (catcher's
// view), banded like Savant — blue (few) -> white -> red (most).
const HEAT_STOPS = [
  [0.00, [123, 147, 201, 0]], [0.10, [123, 147, 201, 0.85]], [0.35, [168, 186, 224, 0.95]],
  [0.55, [245, 245, 248, 1]], [0.72, [236, 170, 170, 1]], [0.88, [214, 90, 90, 1]], [1.00, [196, 40, 50, 1]],
];
function heatColor(v) {
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i], [p0, c0] = HEAT_STOPS[i-1];
    if (v <= p1) { const f = (v - p0) / (p1 - p0); return c0.map((c, k) => c + (c1[k] - c) * f); }
  }
  return HEAT_STOPS[HEAT_STOPS.length-1][1];
}
function drawHeatmap(canvas, locs) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const xMin = -3.0, xMax = 3.0, zMin = -0.6, zMax = 6.0;   // roomy frame like Savant
  const sx = x => (x - xMin) / (xMax - xMin) * W, sz = z => H - (z - zMin) / (zMax - zMin) * H;
  ctx.clearRect(0, 0, W, H);
  // KDE on a coarse grid
  const G = 2, gw = Math.ceil(W / G), gh = Math.ceil(H / G), dens = new Float32Array(gw * gh);
  const n = locs.length;
  const bw = Math.max(0.15, Math.min(0.36, 0.48 * Math.pow(n, -0.2)));   // ft — wider for small samples
  const bpx = bw / (xMax - xMin) * W, rad = Math.ceil(bpx * 3 / G);
  locs.forEach(({ x, z }) => {
    const cx = sx(x) / G, cy = sz(z) / G;
    for (let j = Math.max(0, Math.floor(cy - rad)); j < Math.min(gh, cy + rad); j++)
      for (let i = Math.max(0, Math.floor(cx - rad)); i < Math.min(gw, cx + rad); i++) {
        const dx = (i - cx) * G / bpx, dy = (j - cy) * G / bpx;
        dens[j * gw + i] += Math.exp(-0.5 * (dx*dx + dy*dy));
      }
  });
  let max = 0; for (let i = 0; i < dens.length; i++) if (dens[i] > max) max = dens[i];
  if (max > 0) {
    const img = ctx.createImageData(gw, gh);
    for (let i = 0; i < dens.length; i++) {
      let v = dens[i] / max;
      if (v < 0.06) continue;
      v = Math.round(v * 12) / 12;                       // banded contours
      const [r, g, b, a] = heatColor(v);
      img.data[i*4] = r; img.data[i*4+1] = g; img.data[i*4+2] = b; img.data[i*4+3] = a * 255;
    }
    const off = document.createElement('canvas'); off.width = gw; off.height = gh;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
  }
  // strike zone (dashed) + plate
  ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,20,24,.9)';
  ctx.strokeRect(sx(-0.83), sz(3.5), sx(0.83) - sx(-0.83), sz(1.5) - sz(3.5));
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(sx(-0.83), sz(3.5), sx(0.83) - sx(-0.83), sz(1.5) - sz(3.5));
  ctx.fillStyle = 'rgba(200,200,205,.35)';
  ctx.beginPath();
  const py = sz(0.35);
  ctx.moveTo(sx(-0.71), py); ctx.lineTo(sx(0.71), py); ctx.lineTo(sx(0.71), py + 10); ctx.lineTo(sx(0), py + 20); ctx.lineTo(sx(-0.71), py + 10); ctx.closePath(); ctx.fill();
}

function renderLocationHeatmaps(container, pitchLocs) {
  const total = Object.values(pitchLocs).reduce((t, l) => t + l.length, 0);
  const pts = Object.entries(pitchLocs).filter(([pt, l]) => l.length && pt !== 'OTHER').sort((a, b) => b[1].length - a[1].length);
  if (!pts.length) { container.innerHTML = '<div class="empty-state">No pitch location data for this filter.</div>'; return; }
  const last = stripYearSuffix(currentAthlete?.name || '').split(' ').slice(-1)[0] || 'He';
  const side = locationHand === 'L' ? ' vs. LHB' : locationHand === 'R' ? ' vs. RHB' : '';
  container.innerHTML = `
    <div class="hm-intro">${last} relies on ${pts.length} pitch${pts.length !== 1 ? 'es' : ''}${side}. ${pts.map(([pt, l]) =>
      `<span style="color:${pc(pt)}">${pn(pt)}</span> (${(l.length / total * 100).toFixed(1)}%)`).join(' ')}</div>
    <div class="hm-grid">${pts.map(([pt, l]) => `
      <div class="hm-card">
        <div class="hm-hd"><div class="hm-name" style="color:${pc(pt)}">${pn(pt)}</div><div class="hm-sub">${l.length} Pitches (${(l.length / total * 100).toFixed(1)}%)</div></div>
        <canvas class="hm-canvas" data-pt="${pt}" width="300" height="340"></canvas>
      </div>`).join('')}
    </div>
    <div class="chart-footnote">Catcher's view · Red = where the pitch is thrown most, blue = least · Dashed box = strike zone</div>`;
  container.querySelectorAll('.hm-canvas').forEach(cv => drawHeatmap(cv, pitchLocs[cv.dataset.pt]));
}

function renderLocations() {
  const container = document.getElementById('locations-content');
  if (!athleteOutings.length) { container.innerHTML = '<div class="empty-state">No outing data yet.</div>'; return; }

  // Aggregate locations per pitch type
  const pitchLocs = {};
  const allSpray = [];

  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (s.locations && s.locations.length) {
        if (!pitchLocs[pt]) pitchLocs[pt] = [];
        s.locations.forEach(loc => {
          const [x, z, outcome, stand] = loc;
          if (locationHand === 'all' || stand === locationHand) pitchLocs[pt].push({ x, z, outcome, stand });
        });
      }
      if (s.spray && s.spray.length) {
        s.spray.forEach(sp => {
          const [x, y, bbt, ev, stand] = sp;
          if (locationHand === 'all' || stand === locationHand) allSpray.push({ x, y, bbt, ev, pt });
        });
      }
    });
  });

  const hasLocations = Object.values(pitchLocs).some(l => l.length > 0);
  const hasSpray     = allSpray.length > 0;

  if (!hasLocations && !hasSpray) {
    container.innerHTML = '<div class="empty-state">No pitch location data available. Re-import your outings using Bulk Import to capture locations.</div>';
    return;
  }
  if (locationMode === 'heat' && hasLocations) { renderLocationHeatmaps(container, pitchLocs); return; }

  const OUTCOME_COLORS = { W:'#e91e8c', CS:'#00d4ff', HIP:'#BA7517', F:'#534AB7', B:'rgba(255,255,255,0.15)' };
  const OUTCOME_LABELS = { W:'Whiff', CS:'Called Strike', HIP:'In Play', F:'Foul', B:'Ball' };

  // ---- Combined pitch location chart ----
  const W = 280, H = 320, PAD = 24;
  const xMin=-1.75, xMax=1.75, zMin=0.5, zMax=5.0;
  const toSvgX = x => PAD + (x - xMin) / (xMax - xMin) * (W - PAD*2);
  const toSvgZ = z => H - PAD - (z - zMin) / (zMax - zMin) * (H - PAD*2);
  const szX1 = toSvgX(-0.71), szX2 = toSvgX(0.71);
  const szZ1 = toSvgZ(3.5),   szZ2 = toSvgZ(1.5);

  // Collect all dots — draw balls first, then strikes, then whiffs on top
  const allDots = [];
  Object.entries(pitchLocs).forEach(([pt, locs]) => {
    locs.forEach(({ x, z, outcome }) => {
      const cx = toSvgX(x), cy = toSvgZ(z);
      if (cx < PAD-10 || cy < PAD-10 || cx > W+10 || cy > H+10) return;
      const color = locationColor === 'pitch' ? pc(pt) : (OUTCOME_COLORS[outcome] || '#444');
      const priority = outcome === 'W' ? 3 : outcome === 'CS' ? 2 : outcome === 'HIP' ? 1 : 0;
      allDots.push({ cx, cy, color, priority, pt, outcome });
    });
  });
  allDots.sort((a,b) => a.priority - b.priority);

  const dots = allDots.map(({ cx, cy, color, outcome }) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${outcome==='W'?5:4}" fill="${color}" fill-opacity="0.75" stroke="${color}" stroke-width="0.5"/>`
  ).join('');

  // Pitch type legend
  const pitchLegend = Object.entries(pitchLocs).filter(([,l])=>l.length>0).sort((a,b)=>b[1].length-a[1].length)
    .map(([pt, locs]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--muted)"><span style="width:9px;height:9px;border-radius:50%;background:${pc(pt)};display:inline-block"></span>${pn(pt)} <span style="color:var(--muted2)">${locs.length}</span></span>`).join('');

  const outcomeLegend = Object.entries(OUTCOME_COLORS).map(([k,c]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--muted)"><span style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></span>${OUTCOME_LABELS[k]}</span>`
  ).join('');

  const totalLocs = Object.values(pitchLocs).reduce((a,l)=>a+l.length, 0);

  const locationChart = `<div class="loc-zone-card">
    <div class="loc-zone-title">Pitch Locations <span style="font-size:11px;color:var(--muted);font-weight:400">${totalLocs} pitches</span></div>
    <svg width="${W}" height="${H}" style="display:block">
      <!-- background -->
      <rect x="${PAD}" y="${PAD}" width="${W-PAD*2}" height="${H-PAD*2}" fill="rgba(255,255,255,0.02)" rx="2"/>
      <!-- strike zone -->
      <rect x="${szX1}" y="${szZ1}" width="${szX2-szX1}" height="${szZ2-szZ1}" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" rx="1"/>
      <!-- 9-zone grid -->
      ${[1,2].map(i=>`<line x1="${szX1+(szX2-szX1)/3*i}" y1="${szZ1}" x2="${szX1+(szX2-szX1)/3*i}" y2="${szZ2}" stroke="rgba(255,255,255,0.12)" stroke-width="0.75"/>`).join('')}
      ${[1,2].map(i=>`<line x1="${szX1}" y1="${szZ1+(szZ2-szZ1)/3*i}" x2="${szX2}" y2="${szZ1+(szZ2-szZ1)/3*i}" stroke="rgba(255,255,255,0.12)" stroke-width="0.75"/>`).join('')}
      <!-- shadow zone (chase zone) dashed border -->
      <rect x="${toSvgX(-1.05)}" y="${toSvgZ(4.0)}" width="${toSvgX(1.05)-toSvgX(-1.05)}" height="${toSvgZ(1.0)-toSvgZ(4.0)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4,3" rx="2"/>
      <!-- home plate -->
      <polygon points="${toSvgX(0)},${H-PAD+4} ${toSvgX(-0.28)},${H-PAD-4} ${toSvgX(-0.28)},${H-PAD} ${toSvgX(0.28)},${H-PAD} ${toSvgX(0.28)},${H-PAD-4}" fill="rgba(255,255,255,0.25)"/>
      <!-- axis labels -->
      <text x="${W/2}" y="${H-2}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.25)">← Inside · Outside →</text>
      ${dots}
    </svg>
    <div style="margin-top:8px;line-height:2">${locationColor==='pitch' ? pitchLegend : outcomeLegend}</div>
  </div>`;

  // ---- Spray chart ----
  const sprayChart = hasSpray ? buildSprayChart(allSpray) : '';

  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:1.5rem">${locationChart}${sprayChart}</div>`;
}

function buildSprayChart(sprayData) {
  // Field dimensions in SVG space
  // Home plate at bottom-center, CF at top-center
  // Foul lines go ~45deg from home to LF/RF corners
  // Outfield fence is a wide arc connecting LF to RF through CF
  const W = 340, H = 310;
  const hpX = W/2, hpY = H - 18;  // home plate

  // Foul pole positions (where foul lines meet the fence)
  const lfX = 22,    lfY = 95;   // left field foul pole
  const rfX = W-22,  rfY = 95;   // right field foul pole
  const cfX = W/2,   cfY = 10;   // center field

  // Bases (diamond rotated 45deg)
  const b1X = hpX+72, b1Y = hpY-72;   // 1B (right)
  const b2X = hpX,    b2Y = hpY-144;  // 2B (top)
  const b3X = hpX-72, b3Y = hpY-72;   // 3B (left)

  // Statcast coordinate mapping onto the field wedge
  // hc_x: ~26-205, center=125 → left-right
  // hc_y: HIGH=near home, LOW=outfield (inverted)
  // We map: depth = (hc_y - 45) / (200 - 45)  → 0=outfield, 1=home
  // We map: lateral = (hc_x - 125) / 90        → -1=LF, 0=CF, 1=RF

  const HX_CENTER = 125, HX_RANGE = 90;
  const HY_HOME = 200, HY_FENCE = 45;

  const toSvgX = (hcx, hcy) => {
    const depth    = Math.max(0, Math.min(1, (hcy - HY_FENCE) / (HY_HOME - HY_FENCE)));
    const lateral  = (hcx - HX_CENTER) / HX_RANGE;
    // At depth=1 (home), lateral range ~= 0. At depth=0 (fence), lateral range = full width
    const maxSpread = W/2 - 25;
    return hpX + lateral * maxSpread * (1 - depth * 0.05);
  };

  const toSvgY = (hcx, hcy) => {
    const depth = Math.max(0, Math.min(1.1, (hcy - HY_FENCE) / (HY_HOME - HY_FENCE)));
    return hpY - (1 - depth) * (hpY - cfY - 10) - depth * 0;
  };

  const BB_COLORS = { ground_ball:'#c13584', line_drive:'#f0d44a', fly_ball:'#4a9e4a', popup:'#e05c2a' };
  const BB_LABELS = { ground_ball:'Ground Ball', line_drive:'Line Drive', fly_ball:'Fly Ball', popup:'Popup' };
  const ptCounts = {};
  sprayData.forEach(({pt}) => ptCounts[pt] = (ptCounts[pt]||0)+1);

  const dots = sprayData.map(({ x, y, bbt, ev, pt }) => {
    const svgX = toSvgX(x, y), svgY = toSvgY(x, y);
    if (svgX < 5 || svgY < 5 || svgX > W-5 || svgY > H+5) return '';
    const color = locationColor === 'pitch' ? pc(pt) : (BB_COLORS[bbt] || '#888');
    const hard = ev && ev >= 95;
    return `<circle cx="${svgX.toFixed(1)}" cy="${svgY.toFixed(1)}" r="${hard?6:4.5}" fill="${color}" fill-opacity="0.92" stroke="${hard?'#fff':'rgba(0,0,0,0.35)'}" stroke-width="${hard?1.5:0.5}"/>`;
  }).join('');

  const pitchLegend = Object.entries(ptCounts).sort((a,b)=>b[1]-a[1])
    .map(([pt])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--muted)"><span style="width:9px;height:9px;border-radius:50%;background:${pc(pt)};display:inline-block"></span>${pn(pt)}</span>`).join('');
  const outcomeLegend = Object.entries(BB_COLORS)
    .map(([k,c])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--muted)"><span style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></span>${BB_LABELS[k]}</span>`).join('');
  const legend = locationColor === 'pitch' ? pitchLegend : outcomeLegend;

  // Warning track arc (slightly outside fence)
  const wtLfX = lfX-14, wtLfY = lfY+8;
  const wtRfX = rfX+14, wtRfY = rfY+8;
  const wtCfY = cfY - 14;

  return `<div class="loc-zone-card">
    <div class="loc-zone-title">Spray Chart <span style="font-size:11px;color:var(--muted);font-weight:400">${sprayData.length} batted balls</span></div>
    <svg width="${W}" height="${H}" style="display:block">
      <!-- Warning track -->
      <path d="M ${hpX} ${hpY} L ${wtLfX} ${wtLfY} Q ${cfX} ${wtCfY} ${wtRfX} ${wtRfY} Z" fill="rgba(110,78,30,0.6)"/>
      <!-- Outfield grass wedge -->
      <path d="M ${hpX} ${hpY} L ${lfX} ${lfY} Q ${cfX} ${cfY} ${rfX} ${rfY} Z" fill="rgba(35,72,35,0.75)"/>
      <!-- Outfield fence arc -->
      <path d="M ${lfX} ${lfY} Q ${cfX} ${cfY} ${rfX} ${rfY}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.5"/>
      <!-- Foul lines -->
      <line x1="${hpX}" y1="${hpY}" x2="${wtLfX-8}" y2="${wtLfY+4}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
      <line x1="${hpX}" y1="${hpY}" x2="${wtRfX+8}" y2="${wtRfY+4}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
      <!-- Infield dirt (large circle area) -->
      <path d="M ${hpX} ${hpY} L ${b1X+20} ${b1Y+12} L ${b2X} ${b2Y-8} L ${b3X-20} ${b3Y+12} Z" fill="rgba(130,88,35,0.5)"/>
      <!-- Infield grass (inner diamond) -->
      <polygon points="${hpX},${hpY} ${b1X},${b1Y} ${b2X},${b2Y} ${b3X},${b3Y}" fill="rgba(35,72,35,0.85)"/>
      <!-- Base paths -->
      <line x1="${hpX}" y1="${hpY}" x2="${b1X}" y2="${b1Y}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <line x1="${b1X}" y1="${b1Y}" x2="${b2X}" y2="${b2Y}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <line x1="${b2X}" y1="${b2Y}" x2="${b3X}" y2="${b3Y}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <line x1="${b3X}" y1="${b3Y}" x2="${hpX}" y2="${hpY}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <!-- Pitcher mound -->
      <ellipse cx="${hpX}" cy="${(hpY+b2Y)/2+6}" rx="9" ry="7" fill="rgba(130,88,35,0.7)"/>
      <!-- Bases -->
      <rect x="${b2X-5}" y="${b2Y-5}" width="10" height="10" fill="rgba(235,230,210,0.9)" transform="rotate(45,${b2X},${b2Y})" rx="1"/>
      <rect x="${b1X-5}" y="${b1Y-5}" width="10" height="10" fill="rgba(235,230,210,0.9)" transform="rotate(45,${b1X},${b1Y})" rx="1"/>
      <rect x="${b3X-5}" y="${b3Y-5}" width="10" height="10" fill="rgba(235,230,210,0.9)" transform="rotate(45,${b3X},${b3Y})" rx="1"/>
      <!-- Home plate -->
      <polygon points="${hpX},${hpY-5} ${hpX-8},${hpY-12} ${hpX-8},${hpY+4} ${hpX+8},${hpY+4} ${hpX+8},${hpY-12}" fill="rgba(235,230,210,0.9)"/>
      ${dots}
    </svg>
    <div style="margin-top:8px;line-height:2">${legend}</div>
    <div style="font-size:10px;color:var(--muted2);margin-top:2px">White outline = hard hit (95+ mph EV)</div>
  </div>`;
}

/* ==================== SPLITS ==================== */
function renderSplits() {
  const container = document.getElementById('splits-content');
  if (!athleteOutings.length) {
    container.innerHTML = '<div class="empty-state">No outing data yet.</div>';
    return;
  }

  // Aggregate combined pitch map across all outings
  const combined = {};
  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!s.count) return;
      if (!combined[pt]) combined[pt] = {
        count:0, whiffs:0, cstrikes:0, hip:0, velos:[], xbas:[], xslgs:[], launch_speeds:[], hard_hits:0, gb:0, fb:0, ld:0, bip:0, totalStrikes:0, swings:0, swWhiffs:0,
        lhh:{ count:0, whiffs:0, cstrikes:0, hip:0, velos:[], xbas:[], xslgs:[], launch_speeds:[], hard_hits:0, gb:0, fb:0, ld:0, bip:0, totalStrikes:0, swings:0, swWhiffs:0 },
        rhh:{ count:0, whiffs:0, cstrikes:0, hip:0, velos:[], xbas:[], xslgs:[], launch_speeds:[], hard_hits:0, gb:0, fb:0, ld:0, bip:0, totalStrikes:0, swings:0, swWhiffs:0 },
      };
      const c = combined[pt];
      c.count += s.count||0; c.whiffs += s.whiffs||0; c.cstrikes += s.cstrikes||0; c.hip += s.hip||0;
      if (s.swings) { c.swings += s.swings; c.swWhiffs += s.swWhiffs||0; }
      if (s.avgVelo) c.velos.push(pf(s.avgVelo));
      if (s.avgXba)  c.xbas.push(pf(s.avgXba));
      if (s.avgXslg) c.xslgs.push(pf(s.avgXslg));
      if (s.avgEV)   c.launch_speeds.push(pf(s.avgEV));

      // Accumulate split data
      ['lhh','rhh'].forEach(hand => {
        const src = s[hand]; if (!src || !src.count) return;
        const dst = c[hand];
        dst.count    += src.count    ||0;
        dst.whiffs   += src.whiffs   ||0;
        dst.cstrikes += src.cstrikes ||0;
        dst.hip      += src.hip      ||0;
        if (src.swings) { dst.swings += src.swings; dst.swWhiffs += src.swWhiffs||0; }
        // Stored splits only keep percentages (gbPct etc.), not raw counts —
        // rebuild counts from pct x balls in play so GB/FB/LD% aren't blank.
        const bipN = src.bip || src.hip || 0;
        dst.gb  += src.gb  != null ? src.gb  : (src.gbPct != null ? src.gbPct/100*bipN : 0);
        dst.fb  += src.fb  != null ? src.fb  : (src.fbPct != null ? src.fbPct/100*bipN : 0);
        dst.ld  += src.ld  != null ? src.ld  : (src.ldPct != null ? src.ldPct/100*bipN : 0);
        dst.bip += (src.bip != null ? src.bip : (src.gbPct != null ? bipN : 0));
        dst.totalStrikes += src.totalStrikes != null ? src.totalStrikes : (src.strikePct != null ? src.strikePct/100*src.count : 0);
        if (src.avgVelo) dst.velos.push(pf(src.avgVelo));
        if (src.avgXba)  dst.xbas.push(pf(src.avgXba));
        if (src.avgXslg) dst.xslgs.push(pf(src.avgXslg));
        if (src.avgEV)   dst.launch_speeds.push(pf(src.avgEV));
      });
    });
  });

  const totalPitches = Object.values(combined).reduce((a,s)=>a+s.count, 0);
  const sorted = Object.entries(combined).sort((a,b)=>b[1].count-a[1].count);
  const noData = !sorted.some(([,s])=>s.lhh.count>0||s.rhh.count>0);

  function buildTable(title, getStats, accentColor) {
    const headers = ['Pitch','Total','Avg Velo','Strike%','Whiff%','xBA','xSLG','xOPS','GB%','FB%','LD%'];
    const rows = sorted.map(([pt, s]) => {
      const st = getStats(s);
      if (!st || !st.count) return '';
      const avgV = st.velos.length ? avg(st.velos).toFixed(1) : '—';
      const strikePct = st.count ? (st.totalStrikes/st.count*100).toFixed(1)+'%' : '—';
      const whiffPct  = st.swings ? (st.swWhiffs/st.swings*100).toFixed(1)+'%' : '—';   // per swing
      const xba  = st.xbas.length  ? avg(st.xbas).toFixed(3)  : '—';
      const xslg = st.xslgs.length ? avg(st.xslgs).toFixed(3) : '—';
      const xops = (st.xbas.length&&st.xslgs.length) ? (avg(st.xbas)+avg(st.xslgs)).toFixed(3) : '—';
      const gb   = st.bip ? (st.gb/st.bip*100).toFixed(1)+'%' : '—';
      const fb   = st.bip ? (st.fb/st.bip*100).toFixed(1)+'%' : '—';
      const ld   = st.bip ? (st.ld/st.bip*100).toFixed(1)+'%' : '—';
      const wCls = parseFloat(whiffPct)>=30?'v-good':parseFloat(whiffPct)>=20?'':'v-bad';
      return `<tr>
        <td><span class="pitch-chip"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span></td>
        <td class="v-num">${st.count}</td>
        <td class="v-num">${avgV}</td>
        <td class="v-num">${strikePct}</td>
        <td class="${wCls}">${whiffPct}</td>
        <td class="v-num">${xba}</td>
        <td class="v-num">${xslg}</td>
        <td class="v-num">${xops}</td>
        <td class="v-num">${gb}</td>
        <td class="v-num">${fb}</td>
        <td class="v-num">${ld}</td>
      </tr>`;
    }).join('');

    return `<div class="splits-table-wrap" style="margin-bottom:2rem">
      <div class="splits-table-header" style="background:${accentColor}">
        <span>${title}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows||'<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:1rem">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  }

  if (noData) {
    container.innerHTML = `
      ${buildTable('Overall — Pitch Performance', s=>s, '#1a3a5c')}
      <div class="empty-state" style="margin-top:1rem">
        L/R split data is only available for outings imported via the Bulk Import tool from Statcast CSVs. Re-import your outings to see splits.
      </div>`;
    return;
  }

  container.innerHTML =
    buildTable('Overall — Pitch Performance', s => ({
      count:s.count, whiffs:s.whiffs, cstrikes:s.cstrikes, hip:s.hip,
      swings:s.swings, swWhiffs:s.swWhiffs,
      velos:s.velos, xbas:s.xbas, xslgs:s.xslgs, launch_speeds:s.launch_speeds,
      // top-level counts aren't stored per outing — combine the L/R splits
      totalStrikes:(s.lhh.totalStrikes||0)+(s.rhh.totalStrikes||0),
      gb:(s.lhh.gb||0)+(s.rhh.gb||0), fb:(s.lhh.fb||0)+(s.rhh.fb||0), ld:(s.lhh.ld||0)+(s.rhh.ld||0),
      bip:(s.lhh.bip||0)+(s.rhh.bip||0),
    }), '#1a3a5c') +
    buildTable('vs. RHB — Pitch Performance', s => s.rhh, '#3a1a1a') +
    buildTable('vs. LHB — Pitch Performance', s => s.lhh, '#1a2a1a');
}

/* ==================== YEAR-OVER-YEAR ==================== */
// Hardcoded psStuff+ data per athlete (from 8ctane analytics)
// Update these periodically — every 2-3 weeks or after a significant stretch of starts
const PSSTUFF_DATA = {
  'ryan weiss': {
    lastUpdated: 'May 21, 2026',
    metrics: {
      SI: { psStuffPlus:92,  spinRate:2189, armSide:14.46,  vertical:10.47,  xwOBA:.334, xSLG:.427, xBA:.305, whiffPct:10.80, hardHitPct:29.41  },
      FF: { psStuffPlus:117, spinRate:2332, armSide:7.01,   vertical:17.17,  xwOBA:.398, xSLG:.582, xBA:.346, whiffPct:9.10,  hardHitPct:66.67  },
      FA: { psStuffPlus:117, spinRate:2332, armSide:7.01,   vertical:17.17,  xwOBA:.398, xSLG:.582, xBA:.346, whiffPct:9.10,  hardHitPct:66.67  },
      ST: { psStuffPlus:104, spinRate:2473, armSide:-13.54, vertical:2.10,   xwOBA:.387, xSLG:.324, xBA:.278, whiffPct:23.50, hardHitPct:0.00   },
      CH: { psStuffPlus:105, spinRate:1151, armSide:11.60,  vertical:1.87,   xwOBA:.213, xSLG:.058, xBA:.051, whiffPct:44.40, hardHitPct:100.00 },
      CU: { psStuffPlus:81,  spinRate:2244, armSide:-7.91,  vertical:-11.70, xwOBA:.235, xSLG:.077, xBA:.076, whiffPct:60.00, hardHitPct:0.00   },
    }
  },
  'sam highfill': {
    lastUpdated: 'May 21, 2026',
    metrics: {
      FF: { spinRate:2256, armSide:10.8, vertical:15.9, whiffPct:9.5  },
      FA: { spinRate:2256, armSide:10.8, vertical:15.9, whiffPct:9.5  },
      SL: { spinRate:2346, armSide:5.8,  vertical:-2.2, whiffPct:31.8 },
      SW: { spinRate:2087, armSide:-11.7,vertical:-9.5, whiffPct:33.3 },
      CH: { spinRate:1564, armSide:11.9, vertical:10.7, whiffPct:30.8 },
    }
  }
};

// Supplemental season stats from internal/org reports. Anything here
// OVERRIDES the imported outings (header FIP/WHIP/K%-BB%, Year-over-Year,
// Season Insight), so only add a pitcher when the report is current for that
// season. Ryan Chasse's June 2026 entry was removed (Sept 2026) — it froze
// his numbers across every season.
const SEASON_STATS = {};

function renderPsStuffCards() {
  const section = document.getElementById('metrics-psstuff-section');
  const container = document.getElementById('metrics-psstuff-cards');
  if (!section || !container) return;

  // Use stored data from Sheets, or fall back to hardcoded data
  let pm = currentAthlete.pitch_metrics || {};
  let lastUpdated = null;
  let source = 'stored';

  if (!Object.keys(pm).length) {
    const key = (currentAthlete.name || '').toLowerCase();
    const hardcoded = PSSTUFF_DATA[key];
    if (hardcoded) {
      pm = hardcoded.metrics;
      lastUpdated = hardcoded.lastUpdated;
      source = 'hardcoded';
    }
  }

  const entries = Object.entries(pm).filter(([,m]) => m && m.psStuffPlus);
  if (!entries.length) { section.style.display = 'none'; return; }

  section.style.display = '';

  // Only show columns where at least one pitch has data
  const allCols = [
    { label:'psStuff+',  key:'psStuffPlus' },
    { label:'Spin',      key:'spinRate'    },
    { label:'Arm Side',  key:'armSide'     },
    { label:'Vertical',  key:'vertical'    },
    { label:'xwOBA',     key:'xwOBA'       },
    { label:'xSLG',      key:'xSLG'        },
    { label:'xBA',       key:'xBA'         },
    { label:'Whiff%',    key:'whiffPct'    },
    { label:'HardHit%',  key:'hardHitPct'  },
  ];
  const activeCols = allCols.filter(c => entries.some(([,m]) => m[c.key] !== undefined && m[c.key] !== null && m[c.key] !== ''));

  const updatedNote = lastUpdated
    ? `<div style="font-size:11px;color:var(--muted);margin-bottom:.75rem;font-family:'DM Mono',monospace">
        Last updated: ${lastUpdated} &nbsp;·&nbsp; <span style="color:var(--warn)">Update every 2-3 weeks or after a significant stretch of starts</span>
       </div>`
    : '';

  const header = `<div class="mov-header-row">
    <div class="mov-header-label">Pitch</div>
    <div class="mov-header-stats">${activeCols.map(c=>`<div class="mov-header-stat">${c.label}</div>`).join('')}</div>
  </div>`;

  const rows = entries.sort((a,b) => {
    const pa = EDITABLE_PITCH_TYPES.findIndex(p=>p.code===a[0]);
    const pb = EDITABLE_PITCH_TYPES.findIndex(p=>p.code===b[0]);
    return (pa===-1?99:pa) - (pb===-1?99:pb);
  }).map(([pt, m]) => {
    const vals = activeCols.map(c => {
      const v = m[c.key];
      if (v === undefined || v === null || v === '') return '<span class="v-num">—</span>';
      if (c.key === 'psStuffPlus') {
        const cls = v >= 110 ? 'v-good' : v >= 95 ? 'v-num' : 'v-bad';
        return `<span class="${cls}">${v}</span>`;
      }
      return `<span class="v-num">${v}</span>`;
    });
    return `<div class="mov-pitch-row">
      <div class="mov-pitch-label">
        <span class="pitch-dot" style="background:${pc(pt)};width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:8px;flex-shrink:0"></span>
        <span class="mov-pitch-name">${pn(pt)}</span>
      </div>
      <div class="mov-stat-group">${vals.map(v=>`<div class="mov-stat"><div class="mov-stat-val">${v}</div></div>`).join('')}</div>
    </div>`;
  }).join('');

  container.innerHTML = updatedNote + header + rows;
}

function renderYoY() {
  if (!athleteOutings.length) {
    document.getElementById('yoy-empty').style.display = '';
    return;
  }
  document.getElementById('yoy-empty').style.display = 'none';

  // Render psStuff+ cards if data exists
  renderPsStuffCards();
  // ---- Aggregate the selected season, per pitch type ----
  // Outing-level averages are weighted by pitch count (shape) or balls in
  // play (contact), so a 2-pitch outing doesn't count as much as a 30-pitch one.
  const W = () => ({ sum:0, w:0 });
  const addW = (acc, v, w) => { if (v === null || v === undefined || v === '' || isNaN(+v) || !w) return; acc.sum += (+v) * w; acc.w += w; };
  const getW = (acc, d) => acc.w ? +(acc.sum / acc.w).toFixed(d) : null;

  const combined = {};
  athleteOutings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!s.count) return;
      if (!combined[pt]) combined[pt] = {
        count:0, whiffs:0, cstrikes:0, hip:0, bbe:0, peak:null,
        velo:W(), perc:W(), spin:W(), ivb:W(), hb:W(), vaa:W(), haa:W(), relH:W(), relS:W(), ext:W(),
        xwoba:W(), xba:W(), xslg:W(), ev:W(), hh:W(), gb:W(),
        // swing/zone counts only exist on outings imported after Sept 29 2026
        swN:0, swWhiffs:0, swings:0, zoneN:0, outN:0, zSw:0, oSw:0, zCon:0, zoneOutings:0, zwSw:0, zwWh:0,
      };
      const c = combined[pt], n = s.count;
      c.count += n; c.whiffs += s.whiffs||0; c.cstrikes += s.cstrikes||0; c.hip += s.hip||0;
      if (s.peakVelo) c.peak = Math.max(c.peak ?? 0, pf(s.peakVelo));
      addW(c.velo, s.avgVelo, n);     addW(c.perc, s.avgPercVelo, n);  addW(c.spin, s.avgSpin, n);
      addW(c.ivb,  s.avgIVB, n);      addW(c.hb,   s.avgHB, n);        addW(c.vaa,  s.avgVAA, n);
      addW(c.haa,  s.avgHAA, n);      addW(c.relH, s.avgRelHeight, n); addW(c.relS, s.avgRelSide, n);
      addW(c.ext,  s.avgExt, n);
      const bbe = s.bbe || s.hip || 0;
      c.bbe += bbe;
      addW(c.xwoba, s.avgXwoba, s.hip||bbe); addW(c.xba, s.avgXba, s.hip||bbe); addW(c.xslg, s.avgXslg, s.hip||bbe);
      addW(c.ev, s.avgEV, bbe);              addW(c.hh,  s.hardHitPct, bbe);
      // GB% lives on the L/R splits
      ['lhh','rhh'].forEach(k => { const sd = s[k]; if (sd && sd.gbPct != null) addW(c.gb, sd.gbPct, sd.hip || 0); });
      if (s.swings) { c.swN += n; c.swWhiffs += s.swWhiffs||0; c.swings += s.swings; }
      { const zw = zoneWhiffOf(s); c.zwSw += zw.sw; c.zwWh += zw.wh; }
      if (s.zoneN !== undefined) { c.zoneOutings++; c.zoneN += s.zoneN||0; c.outN += s.outN||0; c.zSw += s.zSw||0; c.oSw += s.oSw||0; c.zCon += s.zCon||0; }
    });
  });

  const total = Object.values(combined).reduce((a,s)=>a+s.count, 0);
  const sorted = Object.entries(combined).sort((a,b)=>b[1].count-a[1].count);
  const fmt = (v, d, suf='') => v === null || v === undefined || isNaN(v) ? '—' : (+v).toFixed(d) + suf;
  const pct = (a, b) => b ? a / b * 100 : null;

  // ---- Pitch shape cards: one card per pitch, stats grouped in rows ----
  const shapeCards = sorted.filter(([,s]) => getW(s.velo,1) !== null).map(([pt, s]) => {
    const stat = (lbl, val) => `<div class="shape-stat"><div class="shape-stat-lbl">${lbl}</div><div class="shape-stat-val">${val}</div></div>`;
    const group = (lbl, stats) => `<div class="shape-group"><div class="shape-group-lbl">${lbl}</div><div class="shape-group-stats">${stats.join('')}</div></div>`;
    const spin = getW(s.spin,0);
    return `<div class="shape-card" style="border-top-color:${pc(pt)}">
      <div class="shape-card-hd">
        <span class="pitch-dot" style="background:${pc(pt)}"></span>
        <span class="shape-card-name">${pn(pt)}</span>
        <span class="shape-card-sub">${s.count} pitches · ${fmt(pct(s.count,total),1,'%')}</span>
        <span class="xa-badge" data-xa-pt="${pt}" data-xa-base="xa-badge"></span>
      </div>
      ${group('Velo', [stat('Avg', fmt(getW(s.velo,1),1)), stat('Peak', fmt(s.peak,1)), stat('Perceived', fmt(getW(s.perc,1),1))])}
      ${group('Movement', [stat('Spin', spin!==null ? Math.round(spin)+' rpm' : '—'), stat('IVB', fmt(getW(s.ivb,1),1,'"')), stat('HB', fmt(getW(s.hb,1),1,'"'))])}
      ${group('Approach', [stat('VAA', fmt(getW(s.vaa,1),1,'°')), stat('HAA', fmt(getW(s.haa,1),1,'°'))])}
      ${group('Release', [stat('Height', fmt(getW(s.relH,2),2,"'")), stat('Side', fmt(getW(s.relS,2),2,"'")), stat('Extension', fmt(getW(s.ext,1),1,"'"))])}
    </div>`;
  }).join('');
  document.getElementById('metrics-shape-cards').innerHTML = shapeCards || '<div class="empty-state">No pitch shape data for this season.</div>';
  fillXArsenal(document.getElementById('metrics-shape-cards'), athleteOutings, null);

  // ---- vs-MLB cell: value, MLB avg, colored delta ----
  function vsMLB(val, base, higherBetter, d=1, suf='') {
    const f = v => d >= 3 ? (+v).toFixed(3).replace(/^0/, '') : (+v).toFixed(d) + suf;
    if (val === null || val === undefined || isNaN(val)) return `<td class="v-num">—</td><td class="mlb-avg">${base!=null ? f(base) : '—'}</td>`;
    if (base == null) return `<td class="v-num">${f(val)}</td><td class="mlb-avg">—</td>`;
    const diff = val - base;
    const tol = d >= 3 ? 0.010 : 0.5;
    const better = higherBetter ? diff > 0 : diff < 0;
    const cls = Math.abs(diff) < tol ? '' : better ? 'delta-good' : 'delta-bad';
    const valCls = Math.abs(diff) < tol ? 'v-warn' : better ? 'v-good' : 'v-bad';
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
    const dTxt = d >= 3 ? Math.abs(diff).toFixed(3).replace(/^0/, '') : Math.abs(diff).toFixed(d);
    const vTxt = d >= 3 ? (+val).toFixed(3).replace(/^0/, '') : (+val).toFixed(d) + suf;
    const bTxt = d >= 3 ? (+base).toFixed(3).replace(/^0/, '') : (+base).toFixed(d) + suf;
    return `<td class="${valCls}">${vTxt}</td><td class="mlb-avg"><span class="v-num">${bTxt}</span> <span class="${cls}">${arrow}${dTxt}</span></td>`;
  }
  const chip = pt => `<td><span class="pitch-chip"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span></td>`;
  let missingSwingData = false;

  // ---- Table 1: swing & miss ----
  document.getElementById('metrics-swing-body').innerHTML = sorted.map(([pt, s]) => {
    const whiffSw = s.swings ? pct(s.swWhiffs, s.swings) : null;
    if (!s.zoneOutings) missingSwingData = true;
    const zone  = s.zoneOutings ? pct(s.zoneN, s.zoneN + s.outN) : null;
    const chase = s.zoneOutings ? pct(s.oSw, s.outN) : null;
    const zCon  = s.zoneOutings ? pct(s.zCon, s.zSw) : null;
    const zWhiff = s.zwSw ? pct(s.zwWh, s.zwSw) : null;
    const csw   = pct(s.whiffs + s.cstrikes, s.count);
    const cC = csw >= 30 ? 'v-good' : csw >= 25 ? 'v-warn' : 'v-bad';
    return `<tr>${chip(pt)}
      <td class="v-num">${s.count}</td>
      <td class="v-num">${fmt(pct(s.count,total),1,'%')}</td>
      ${vsMLB(whiffSw, MLB_BASELINE_REF[pt]?.whiff_pct, true, 1, '%')}
      <td class="v-num">${fmt(pct(s.whiffs,s.count),1,'%')}</td>
      <td class="${cC}">${fmt(csw,1,'%')}</td>
      <td class="v-num">${fmt(zone,1,'%')}</td>
      <td class="v-num">${fmt(chase,1,'%')}</td>
      <td class="v-num">${fmt(zCon,1,'%')}</td>
      <td class="${zWhiff === null ? 'v-num' : zWhiff >= 20 ? 'v-good' : zWhiff >= 12 ? 'v-warn' : 'v-bad'}">${fmt(zWhiff,1,'%')}</td>
    </tr>`;
  }).join('');

  // ---- Table 2: contact quality ----
  document.getElementById('metrics-contact-body').innerHTML = sorted.map(([pt, s]) => {
    const ref = MLB_BASELINE_REF[pt] || {};
    return `<tr>${chip(pt)}
      <td class="v-num">${s.bbe || s.hip || 0}</td>
      ${vsMLB(getW(s.xwoba,3), ref.avg_xwoba, false, 3)}
      <td class="v-num">${fmt(getW(s.xba,3),3).replace(/^0/,'')}</td>
      <td class="v-num">${fmt(getW(s.xslg,3),3).replace(/^0/,'')}</td>
      ${vsMLB(getW(s.ev,1), ref.avg_ev, false, 1)}
      ${vsMLB(getW(s.hh,1), ref.hard_hit_pct, false, 1, '%')}
      <td class="v-num">${fmt(getW(s.gb,1),1,'%')}</td>
    </tr>`;
  }).join('');

  const note = document.getElementById('metrics-swing-note');
  if (note) note.style.display = missingSwingData ? '' : 'none';

  // ---- Velo bar chart ----
  if (profileCharts['metrics-velo']) profileCharts['metrics-velo'].destroy();
  profileCharts['metrics-velo'] = new Chart(document.getElementById('metrics-velo-chart'), {
    type: 'bar',
    data: {
      labels: sorted.map(([pt])=>pn(pt)),
      datasets: [
        { label:'Avg velo',  data:sorted.map(([,s])=>getW(s.velo,1)||0), backgroundColor:sorted.map(([pt])=>pc(pt)+'88'), borderRadius:3, borderSkipped:false },
        { label:'Peak velo', data:sorted.map(([,s])=>s.peak||0),          backgroundColor:sorted.map(([pt])=>pc(pt)),     borderRadius:3, borderSkipped:false },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, position:'top', labels:{ color:'#72747c', font:{size:10,family:'DM Mono'}, padding:12 } } },
      scales:{ y:{ ticks:{callback:v=>v+' mph',color:'#72747c',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'}}, x:{ticks:{color:'#72747c',font:{size:11}},grid:{display:false}} } }
  });

  // ---- Whiff% vs MLB avg grouped bar ----
  if (profileCharts['metrics-whiff']) profileCharts['metrics-whiff'].destroy();
  const whiffPitches = sorted.filter(([,s])=>s.count>=3 && s.swings>0);
  profileCharts['metrics-whiff'] = new Chart(document.getElementById('metrics-whiff-chart'), {
    type: 'bar',
    data: {
      labels: whiffPitches.map(([pt])=>pn(pt)),
      datasets: [
        { label:'Whiff%', data:whiffPitches.map(([,s])=>+(s.swWhiffs/s.swings*100).toFixed(1)), backgroundColor:whiffPitches.map(([pt])=>pc(pt)), borderRadius:3, borderSkipped:false },
        { label:'MLB avg',       data:whiffPitches.map(([pt])=>MLB_BASELINE_REF[pt]?.whiff_pct||0),           backgroundColor:'rgba(255,255,255,0.08)',           borderRadius:3, borderSkipped:false },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, position:'top', labels:{ color:'#72747c', font:{size:10,family:'DM Mono'}, padding:12 } } },
      scales:{ y:{ beginAtZero:true, ticks:{callback:v=>v+'%',color:'#72747c',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'}}, x:{ticks:{color:'#72747c',font:{size:11}},grid:{display:false}} } }
  });

  renderMovementProfile(sorted, total);
}

/* ==================== MOVEMENT PROFILE (Savant-style) ==================== */
// HB is stored as -pfx_x in inches: positive = toward 3B (catcher's view),
// which is the orientation Savant uses — so no hand flip needed.
// MLB average ellipses come from shape_baselines.json (pooled L+R, stored
// arm-side-normalized in feet as if RHP; mirrored here for LHP).
let movementMode = 'pitch';   // 'pitch' (individual pitches) | 'outing' (outing averages)
let movementSample = true;    // 100-pitch sample when showing pitches

function setMovementMode(m) { movementMode = m; renderYoY(); }
function toggleMovementSample() { movementSample = !movementSample; renderYoY(); }

function renderMovementProfile(sorted, total) {
  const el = document.getElementById('metrics-movement-profile');
  if (!el) return;
  const lhp = (currentAthlete?.throws || '').toUpperCase() === 'L';
  const pts = sorted.filter(([pt, s]) => pt !== 'OTHER' && s.count / (total||1) >= 0.02).map(([pt]) => pt);

  // Collect dots per pitch type
  const hasPitchData = athleteOutings.some(o => Object.values(o.pitch_stats || {}).some(s => s.mv && s.mv.length));
  const mode = (movementMode === 'pitch' && hasPitchData) ? 'pitch' : 'outing';
  const dots = {};
  pts.forEach(pt => {
    let arr = [];
    athleteOutings.forEach(o => {
      const s = o.pitch_stats?.[pt]; if (!s) return;
      if (mode === 'pitch') { (s.mv || []).forEach(m => arr.push(m)); }
      else if (s.avgHB != null && s.avgIVB != null && s.avgHB !== '' && s.avgIVB !== '') arr.push([pf(s.avgHB), pf(s.avgIVB)]);
    });
    dots[pt] = arr;
  });
  // 100-pitch sample: split across pitch types by usage, evenly spaced (deterministic)
  if (mode === 'pitch' && movementSample) {
    const tot = pts.reduce((a, pt) => a + dots[pt].length, 0);
    pts.forEach(pt => {
      const a = dots[pt], n = Math.max(1, Math.round(100 * a.length / (tot || 1)));
      if (a.length > n) { const step = a.length / n; dots[pt] = Array.from({length:n}, (_, i) => a[Math.floor(i * step)]); }
    });
  }

  // Geometry: 24" = 250px, centered in a 620x620 box
  const W = 620, C = 310, R = 250 / 24;
  const X = hb => C + hb * R, Y = ivb => C - ivb * R;
  const clamp = v => Math.max(-29, Math.min(29, v));

  // MLB averages from shape baselines (feet, RHP-normalized)
  const mlbFor = pt => {
    const b = (typeof SHAPE_BASELINES !== 'undefined') ? SHAPE_BASELINES[pt === 'FA' ? 'FF' : pt] : null;
    if (!b || !b.scaler_mean) return null;
    const hbFeet = b.scaler_mean.hb_norm * (lhp ? -1 : 1);   // = pfx_x
    return { hb: -hbFeet * 12, ivb: b.scaler_mean.vb * 12,
             rx: (b.scaler_scale?.hb_norm || 0.3) * 12, ry: (b.scaler_scale?.vb || 0.35) * 12,
             velo: b.scaler_mean.velo };
  };

  const rings = [6, 12, 18, 24].map(r => `<circle cx="${C}" cy="${C}" r="${r*R}" fill="none" stroke="var(--mp-line)" stroke-width="${r%12===0?1.4:1}" ${r%12===0?'':'stroke-dasharray="5 5"'}/>`).join('');
  const ringLbl = [12, 24].map(r => `
      <text x="${C+6}" y="${C - r*R + 16}" class="mp-tick">${r}"</text>
      <text x="${C+6}" y="${C + r*R - 6}" class="mp-tick">${r}"</text>
      <text x="${C - r*R + 4}" y="${C - 6}" class="mp-tick">${r}"</text>
      <text x="${C + r*R - 26}" y="${C - 6}" class="mp-tick">${r}"</text>`).join('');
  const patterns = pts.map(pt => `
      <pattern id="mp-hatch-${pt}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="${pc(pt)}" fill-opacity="0.10"/>
        <line x1="0" y1="0" x2="0" y2="8" stroke="${pc(pt)}" stroke-width="2" stroke-opacity="0.55"/>
      </pattern>`).join('');
  const mlbShapes = pts.map(pt => { const m = mlbFor(pt); if (!m) return '';
    return `<ellipse cx="${X(clamp(m.hb))}" cy="${Y(clamp(m.ivb))}" rx="${Math.max(m.rx,4)*R}" ry="${Math.max(m.ry,4)*R}" fill="url(#mp-hatch-${pt})" stroke="${pc(pt)}" stroke-opacity=".5" stroke-dasharray="3 3"><title>MLB avg ${pn(pt)}: ${m.hb.toFixed(1)}" HB, ${m.ivb.toFixed(1)}" IVB</title></ellipse>`; }).join('');
  const r = mode === 'pitch' ? 6.5 : 8;
  const dotSvg = pts.map(pt => dots[pt].map(([hb, ivb]) =>
    `<circle cx="${X(clamp(hb)).toFixed(1)}" cy="${Y(clamp(ivb)).toFixed(1)}" r="${r}" fill="${pc(pt)}" fill-opacity=".85" stroke="rgba(0,0,0,.45)" stroke-width="1"><title>${pn(pt)}: ${hb}" HB, ${ivb}" IVB</title></circle>`).join('')).join('');

  const svg = `<svg viewBox="0 0 ${W} ${W}" class="mp-svg" role="img" aria-label="Movement profile">
    <defs>${patterns}</defs>
    <circle cx="${C}" cy="${C}" r="${30*R}" fill="var(--mp-band)"/>
    <circle cx="${C}" cy="${C}" r="${24*R}" fill="var(--mp-fill)"/>
    ${rings}
    <line x1="${C-30*R}" y1="${C}" x2="${C+30*R}" y2="${C}" stroke="var(--mp-line)"/>
    <line x1="${C}" y1="${C-30*R}" x2="${C}" y2="${C+30*R}" stroke="var(--mp-line)"/>
    ${ringLbl}
    ${mlbShapes}
    ${dotSvg}
    <text x="${C}" y="22" text-anchor="middle" class="mp-axis">1B ◀ MOVES TOWARD ▶ 3B</text>
    <text x="14" y="${C-60}" class="mp-axis">MORE RISE ▲</text>
    <text x="14" y="${C+70}" class="mp-axis">MORE DROP ▼</text>
    <g transform="translate(${W-120},16)">
      <ellipse cx="20" cy="14" rx="16" ry="12" fill="url(#mp-hatch-legend)" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <text x="42" y="19" class="mp-axis">MLB AVG</text>
    </g>
    <defs><pattern id="mp-hatch-legend" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted)" stroke-width="1.5"/></pattern></defs>
  </svg>`;

  // Legend / table under the chart
  const col = pts.map(pt => {
    const s = sorted.find(([p]) => p === pt)[1];
    const velo = s.velo && s.velo.w ? (s.velo.sum / s.velo.w).toFixed(1) : '—';
    const m = mlbFor(pt);
    return { pt, usage: (s.count / (total||1) * 100).toFixed(0) + '%', velo, mlbVelo: m ? m.velo.toFixed(1) : '—' };
  });
  const table = `<table class="mp-table">
    <tr><td></td>${col.map(c => `<td><div class="mp-pname">${pn(c.pt)}</div><div class="mp-pill" style="background:${pc(c.pt)}"></div></td>`).join('')}</tr>
    <tr><td class="mp-rlbl">Usage</td>${col.map(c => `<td>${c.usage}</td>`).join('')}</tr>
    <tr><td class="mp-rlbl">MPH</td>${col.map(c => `<td>${c.velo}</td>`).join('')}</tr>
    <tr><td class="mp-rlbl mp-it">MLB avg</td>${col.map(c => `<td class="mp-muted">${c.mlbVelo}</td>`).join('')}</tr>
  </table>`;

  const controls = `<div class="loc-filter-row mp-controls">
      <button class="loc-filter-btn${mode==='pitch'?' active':''}" ${hasPitchData?'':'disabled title="Re-import outings to get per-pitch movement"'} onclick="setMovementMode('pitch')">Pitches</button>
      <button class="loc-filter-btn${mode==='outing'?' active':''}" onclick="setMovementMode('outing')">Outing avgs</button>
      ${mode==='pitch' ? `<button class="loc-filter-btn${movementSample?' active':''}" onclick="toggleMovementSample()">100-pitch sample</button>` : ''}
    </div>`;

  el.innerHTML = `<div class="mp-card">
    <div class="mp-title"><span class="mp-year">${seasonLabel()}</span> Movement Profile (Induced Break)</div>
    ${controls}
    ${svg}
    ${table}
    <div class="chart-footnote">${mode==='pitch' ? 'Each dot = one pitch' : 'Each dot = one outing average'} · Catcher's view (arm side is right for RHP, left for LHP) · Hatched = MLB average shape for that pitch type</div>
  </div>`;
}

/* ==================== COMPARE ==================== */
/* ==================== YEAR OVER YEAR ==================== */
function stripYearSuffix(name) {
  return (name || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

// IP is stored as outs/3 rounded to 2 decimals (e.g. 0.33, 0.67), so sums
// drift (43.0100000005). Convert back to outs for all IP math.
const ipToOuts = ip => Math.round((+ip || 0) * 3);
const fmtIP = outs => outs ? `${Math.floor(outs/3)}.${outs%3}` : '—';

function computeSeasonAggregate(outings) {
  const sum = f => outings.reduce((a,o)=>a+(+o[f]||0), 0);
  const totalPitches = sum('total_pitches');
  const totalK = sum('strikeouts'), totalBB = sum('walks'), totalHR = sum('hrs'), totalH = sum('hits');
  const outs = outings.reduce((a,o)=>a+ipToOuts(o.ip), 0);
  const ip = outs / 3;

  const totalHBP = sum('hbp');
  const fipV = calcFIP(totalHR, totalBB, totalHBP, totalK, ip, fipConstantForOutings(outings, currentAthlete));
  const fip  = fipV !== null ? +fipV.toFixed(2) : null;
  const whip = ip > 0 ? +((totalBB + totalH) / ip).toFixed(2) : null;

  // Per-pitch-type aggregation (weighted by pitches / balls in play)
  const combined = {};
  let totalBIP = 0, totW = 0, totCS = 0;
  outings.forEach(o => {
    let pm = {};
    try { pm = typeof o.pitch_stats==='object' ? o.pitch_stats : JSON.parse(o.pitch_stats_json||'{}'); } catch(e){}
    Object.entries(pm).forEach(([pt, s]) => {
      if (!s || !s.count) return;
      totalBIP += s.hip || 0; totW += s.whiffs || 0; totCS += s.cstrikes || 0;
      if (!combined[pt]) combined[pt] = { count:0, whiffs:0, cstrikes:0, swings:0, swWhiffs:0, hip:0,
        velo:[0,0], ivb:[0,0], hb:[0,0], spin:[0,0], xwoba:[0,0], hh:[0,0] };
      const c = combined[pt], n = s.count;
      const add = (acc, v, w) => { if (v === null || v === undefined || v === '' || isNaN(+v) || !w) return; acc[0] += (+v)*w; acc[1] += w; };
      c.count += n; c.whiffs += s.whiffs||0; c.cstrikes += s.cstrikes||0; c.hip += s.hip||0;
      if (s.swings) { c.swings += s.swings; c.swWhiffs += s.swWhiffs||0; }
      add(c.velo, s.avgVelo, n); add(c.ivb, s.avgIVB, n); add(c.hb, s.avgHB, n); add(c.spin, s.avgSpin, n);
      add(c.xwoba, s.avgXwoba, s.hip||0); add(c.hh, s.hardHitPct, s.bbe || s.hip || 0);
    });
  });
  const totalPA = totalK + totalBB + totalBIP;
  const kPct  = totalPA ? +(totalK/totalPA*100).toFixed(1) : null;
  const bbPct = totalPA ? +(totalBB/totalPA*100).toFixed(1) : null;
  const kMinusBB = (kPct !== null && bbPct !== null) ? +(kPct - bbPct).toFixed(1) : null;
  const whiffPct = outingsWhiffSw(outings);   // per swing
  const cswPct = totalPitches ? +((totW + totCS) / totalPitches * 100).toFixed(1) : null;

  const wv = (acc, d) => acc[1] ? +(acc[0]/acc[1]).toFixed(d) : null;
  const pitchStats = {};
  Object.entries(combined).forEach(([pt, s]) => {
    pitchStats[pt] = {
      count: s.count,
      usagePct: totalPitches ? +(s.count/totalPitches*100).toFixed(1) : 0,
      whiffPct: wps(s.swWhiffs, s.swings),
      cswPct: s.count ? +((s.whiffs + s.cstrikes)/s.count*100).toFixed(1) : null,
      avgVelo: wv(s.velo, 1), avgIVB: wv(s.ivb, 1), avgHB: wv(s.hb, 1), avgSpin: wv(s.spin, 0),
      avgXwoba: wv(s.xwoba, 3), hardHitPct: wv(s.hh, 1),
    };
  });
  const ff = pitchStats.FF || pitchStats.FA || pitchStats.SI;

  return { outingCount: outings.length, outs, totalIP: ip, totalPitches, totalK, totalBB, totalHR, totalH,
           whiffPct, cswPct, fip, whip, kPct, bbPct, kMinusBB, fbVelo: ff ? ff.avgVelo : null, pitchStats };
}

function yoyDeltaHTML(first, last, higherBetter=true) {
  if (first === null || last === null || first === undefined || last === undefined) return '';
  const d = +(last - first).toFixed(2);
  if (Math.abs(d) < 0.05) return '<span style="color:var(--muted);font-size:11px"> —</span>';
  const better = higherBetter ? d > 0 : d < 0;
  const cls = better ? 'delta-good' : 'delta-bad';
  const arrow = d > 0 ? '▲' : '▼';
  return ` <span class="${cls}" style="font-size:11px">${arrow}${Math.abs(d)}</span>`;
}

// Year-over-Year state: all seasons for the current athlete, plus which
// years are toggled on via the buttons at the top of the tab.
let yoySeasons = [];
let yoySelectedYears = new Set();

async function renderYearOverYear() {
  const container = document.getElementById('history-content');
  container.innerHTML = '<div class="ai-loading"><div class="loading-spinner"></div><p>Loading season history...</p></div>';

  const baseName = stripYearSuffix(currentAthlete.name).toLowerCase();

  let allAthletes;
  try {
    const res = await api('getAthletes');
    allAthletes = res.athletes;
  } catch(e) {
    container.innerHTML = `<div class="empty-state">Could not load athlete history: ${e.message}</div>`;
    return;
  }

  // Every record for this pitcher: "Josh Sborz", "Josh Sborz (2023)", etc.
  const matches = allAthletes.filter(a => stripYearSuffix(a.name).toLowerCase() === baseName);
  if (!matches.some(a => a.id === currentAthlete.id)) matches.push(currentAthlete);

  const records = await Promise.all(matches.map(async a => {
    let outings;
    if (a.id === currentAthlete.id) {
      outings = athleteOutingsAll;
    } else {
      try { const r = await api('getOutings', { athleteId: a.id }); const rm = pitchRemapFor(a); outings = (r.outings || []).map(o => enrichOuting(applyPitchRemap(o, rm))); } catch(e) { outings = []; }
    }
    return { athlete: a, outings };
  }));

  // Group outings by the year of each outing's date, so one record holding
  // several Savant seasons splits into separate years, and "(YYYY)" records
  // still work. Same date in two records only counts once.
  const byYear = {};
  const seenDates = new Set();
  const orgStatsByYear = {};
  records.forEach(rec => {
    rec.outings.forEach(o => {
      const d = (o.date || '').toString().split('T')[0];
      const y = d.slice(0, 4);
      if (!/^\d{4}$/.test(y) || seenDates.has(d)) return;
      seenDates.add(d);
      (byYear[y] = byYear[y] || []).push(o);
    });
    // Org season stats are keyed by record name; tie them to that record's year
    const key = rec.athlete.name.toLowerCase();
    const org = (typeof SEASON_STATS !== 'undefined') ? SEASON_STATS[key] : null;
    if (org) {
      const suffix = rec.athlete.name.match(/\((\d{4})\)\s*$/);
      let y = suffix ? suffix[1] : null;
      if (!y) {
        const counts = {};
        rec.outings.forEach(o => { const yy = (o.date||'').toString().slice(0,4); if (yy) counts[yy] = (counts[yy]||0)+1; });
        y = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      }
      if (y) orgStatsByYear[y] = org;
    }
  });

  yoySeasons = Object.keys(byYear).sort().map(year => ({
    year,
    outings: byYear[year],
    agg: computeSeasonAggregate(byYear[year]),
    orgStats: orgStatsByYear[year] || null,
  }));

  if (yoySeasons.length < 2) {
    const nm = stripYearSuffix(currentAthlete.name);
    container.innerHTML = `<div class="empty-state">Only one season of data found for ${nm}.<br><small>Import outings from another season (into this record or a "${nm} (YYYY)" record) and each year will show up here.</small></div>`;
    return;
  }

  // Keep the previous selection when re-opening the tab; default = all years
  const years = yoySeasons.map(s => s.year);
  const kept = [...yoySelectedYears].filter(y => years.includes(y));
  yoySelectedYears = new Set(kept.length ? kept : years);

  renderYearOverYearHTML();
}

function toggleYoYYear(year) {
  if (year === 'all') {
    yoySelectedYears = new Set(yoySeasons.map(s => s.year));
  } else if (yoySelectedYears.has(year)) {
    if (yoySelectedYears.size > 1) yoySelectedYears.delete(year); // always keep one
  } else {
    yoySelectedYears.add(year);
  }
  renderYearOverYearHTML();
}

function yoySparkline(vals, higherBetter) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined && !isNaN(v));
  if (pts.length < 2) return '';
  const W = 72, H = 22, P = 3;
  const ys = pts.map(p => +p[1]), min = Math.min(...ys), max = Math.max(...ys);
  const x = i => P + i * (W - 2*P) / Math.max(1, vals.length - 1);
  const y = v => max === min ? H/2 : H - P - (v - min) * (H - 2*P) / (max - min);
  const d = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(+v).toFixed(1)}`).join(' ');
  const first = +pts[0][1], last = +pts[pts.length-1][1];
  const up = last > first;
  const col = higherBetter === null ? 'var(--muted2)' : (up === higherBetter ? 'var(--good)' : 'var(--danger)');
  const [li, lv] = pts[pts.length-1];
  return `<svg class="yoy-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${d}" fill="none" stroke="${col}" stroke-width="1.6"/><circle cx="${x(li)}" cy="${y(+lv)}" r="2.4" fill="${col}"/></svg>`;
}

function renderYearOverYearHTML() {
  const container = document.getElementById('history-content');
  const seasons = yoySeasons.filter(s => yoySelectedYears.has(s.year));
  const first = seasons[0];
  const last = seasons[seasons.length-1];
  const allOn = seasons.length === yoySeasons.length;
  const multi = seasons.length > 1;

  const yearButtons = `
    <div class="loc-filter-row" style="margin-bottom:1.25rem">
      <span class="loc-filter-label">Seasons:</span>
      <button class="loc-filter-btn${allOn?' active':''}" onclick="toggleYoYYear('all')">All</button>
      ${yoySeasons.map(s => `<button class="loc-filter-btn${yoySelectedYears.has(s.year)?' active':''}" onclick="toggleYoYYear('${s.year}')">${s.year}</button>`).join('')}
    </div>`;

  const colgroup = `<colgroup><col class="yoy-c-label">${seasons.map(()=>'<col>').join('')}<col class="yoy-c-trend"></colgroup>`;
  const yearHead = seasons.map(s => `<th class="yoy-year">${s.year}</th>`).join('');
  const trendHead = `<th class="yoy-trend-hd">${multi ? `${first.year} → ${last.year}` : ''}</th>`;

  // fmt: value -> display string. higherBetter: true / false / null (no judgement)
  function row(label, getVal, fmt, higherBetter, d = 1) {
    const vals = seasons.map(s => { const v = getVal(s); return (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v; });
    const cells = vals.map(v => `<td class="v-num">${v === null ? '<span class="yoy-na">—</span>' : fmt(v)}</td>`).join('');
    let trend = '';
    if (multi) {
      const a = vals[0], b = vals[vals.length-1];
      let delta = '';
      if (a !== null && b !== null && higherBetter !== null) {
        const diff = b - a;
        const tol = d >= 3 ? 0.005 : d === 2 ? 0.05 : 0.25;
        if (Math.abs(diff) < tol) delta = '<span class="yoy-flat">—</span>';
        else {
          const cls = (diff > 0) === higherBetter ? 'delta-good' : 'delta-bad';
          const txt = d >= 3 ? Math.abs(diff).toFixed(3).replace(/^0/, '') : Math.abs(diff).toFixed(d);
          delta = `<span class="${cls}">${diff > 0 ? '▲' : '▼'}${txt}</span>`;
        }
      }
      trend = `<div class="yoy-trend">${yoySparkline(vals, higherBetter)}${delta}</div>`;
    }
    return `<tr><td class="yoy-label">${label}</td>${cells}<td>${trend}</td></tr>`;
  }
  const pct1 = v => v.toFixed(1) + '%';
  const dec2 = v => v.toFixed(2);
  const dec1 = v => v.toFixed(1);
  const int  = v => String(Math.round(v));
  const x3   = v => v.toFixed(3).replace(/^0/, '');
  const org  = (s, k) => s.orgStats && s.orgStats[k] != null ? s.orgStats[k] : null;

  const summaryTable = `
    <div class="section-hd" style="margin-bottom:.5rem">Season summary</div>
    <div class="table-scroll">
    <table class="data-table yoy-table">
      ${colgroup}
      <thead><tr><th>Stat</th>${yearHead}${trendHead}</tr></thead>
      <tbody>
        <tr class="yoy-group"><td colspan="${seasons.length+2}">Workload</td></tr>
        ${row('Outings', s=>s.agg.outingCount, int, null)}
        ${row('IP', s=>s.agg.outs ? s.agg.outs/3 : null, v => fmtIP(Math.round(v*3)), null)}
        ${row('Pitches', s=>s.agg.totalPitches || null, int, null)}
        <tr class="yoy-group"><td colspan="${seasons.length+2}">Run prevention</td></tr>
        ${row('FIP',  s=>org(s,'fip')  ?? s.agg.fip,  dec2, false, 2)}
        ${row('WHIP', s=>org(s,'whip') ?? s.agg.whip, dec2, false, 2)}
        <tr class="yoy-group"><td colspan="${seasons.length+2}">Strikeouts &amp; walks</td></tr>
        ${row('K%',     s=>org(s,'kPct')  ?? s.agg.kPct,  pct1, true)}
        ${row('BB%',    s=>org(s,'bbPct') ?? s.agg.bbPct, pct1, false)}
        ${row('K%-BB%', s=>org(s,'kMinusBB') ?? s.agg.kMinusBB, pct1, true)}
        <tr class="yoy-group"><td colspan="${seasons.length+2}">Stuff</td></tr>
        ${row('Whiff%', s=>org(s,'swingWhiffPct') ?? s.agg.whiffPct, pct1, true)}
        ${row('CSW%',   s=>s.agg.cswPct, pct1, true)}
        ${row('FB velo', s=>s.agg.fbVelo, dec1, true)}
      </tbody>
    </table>
    </div>`;

  // Arsenal — one block per pitch, one row per metric
  const allPT = [...new Set(seasons.flatMap(s => Object.keys(s.agg.pitchStats)))]
    .filter(pt => pt !== 'OTHER' && seasons.some(s => (s.agg.pitchStats[pt]?.usagePct || 0) >= 1))
    .sort((a, b) => Math.max(...seasons.map(s => s.agg.pitchStats[b]?.count || 0)) - Math.max(...seasons.map(s => s.agg.pitchStats[a]?.count || 0)));
  const P = (pt, k) => s => s.agg.pitchStats[pt]?.[k] ?? null;
  const inch = v => v.toFixed(1) + '"';
  const arsenalBody = allPT.map(pt => `
      <tr class="yoy-pitch-hd"><td colspan="${seasons.length+2}"><span class="pitch-chip"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span></td></tr>
      ${row('Usage',   P(pt,'usagePct'), pct1, null)}
      ${row('Velo',    P(pt,'avgVelo'),  dec1, true)}
      ${row('Spin',    P(pt,'avgSpin'),  int,  null)}
      ${row('IVB',     P(pt,'avgIVB'),   inch, null)}
      ${row('HB',      P(pt,'avgHB'),    inch, null)}
      ${row('Whiff%',  P(pt,'whiffPct'), pct1, true)}
      ${row('CSW%',    P(pt,'cswPct'),   pct1, true)}
      ${row('xwOBA',   P(pt,'avgXwoba'), x3,   false, 3)}
      ${row('Hard hit%', P(pt,'hardHitPct'), pct1, false)}`).join('');

  const arsenalTable = `
    <div class="section-hd" style="margin:1.75rem 0 .5rem">Arsenal by season</div>
    <div class="table-scroll">
    <table class="data-table yoy-table">
      ${colgroup}
      <thead><tr><th>Metric</th>${yearHead}${trendHead}</tr></thead>
      <tbody>${arsenalBody}</tbody>
    </table>
    </div>
    <div class="chart-footnote">Whiff% = whiffs per swing · xwOBA on balls in play · Trend compares the first and last selected seasons (green = better)</div>`;

  container.innerHTML = yearButtons + summaryTable + arsenalTable;
}

function populateCompareSelectors() {
  const sorted = [...athleteOutings].sort((a,b)=>b.date.localeCompare(a.date));
  const options = sorted.map(o => `<option value="${o.id}">${formatDate(o.date)} vs. ${o.opponent||'Unknown'}</option>`).join('');
  ['compare-sel-1','compare-sel-2'].forEach((id,i) => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Select outing...</option>' + options;
    if (sorted[i]) sel.value = sorted[i].id;
  });
  renderComparison();
}

function renderComparison() {
  const id1 = document.getElementById('compare-sel-1').value;
  const id2 = document.getElementById('compare-sel-2').value;
  const container = document.getElementById('compare-result');
  if (!id1 || !id2 || id1 === id2) {
    container.innerHTML = '<div class="empty-state">Select two different outings to compare.</div>';
    return;
  }
  const o1 = athleteOutings.find(o=>o.id===id1);
  const o2 = athleteOutings.find(o=>o.id===id2);
  if (!o1||!o2) return;

  let pm1={},pm2={};
  try { pm1 = typeof o1.pitch_stats==='object' ? o1.pitch_stats : JSON.parse(o1.pitch_stats_json||'{}'); } catch(e){}
  try { pm2 = typeof o2.pitch_stats==='object' ? o2.pitch_stats : JSON.parse(o2.pitch_stats_json||'{}'); } catch(e){}

  const allPT = [...new Set([...Object.keys(pm1),...Object.keys(pm2)])];
  const t1 = Object.values(pm1).reduce((a,s)=>a+(s.count||0),0);
  const t2 = Object.values(pm2).reduce((a,s)=>a+(s.count||0),0);

  const w1 = o1.whiffs||0, w2 = o2.whiffs||0;
  const t1p = o1.total_pitches||1, t2p = o2.total_pitches||1;

  container.innerHTML = `
    <div class="chart-grid-2" style="margin-bottom:1rem">
      ${[{o:o1,t:t1,pm:pm1},{o:o2,t:t2,pm:pm2}].map(({o,t,pm},i)=>`
        <div class="chart-card">
          <div class="chart-card-title">${formatDate(o.date)} — vs. ${o.opponent||'—'}</div>
          <div style="display:flex;gap:1.5rem;margin-bottom:.75rem;flex-wrap:wrap">
            ${[
              {v:o.total_pitches||0,l:'Pitches'},
              {v:(o.whiffSwPct != null ? o.whiffSwPct.toFixed(1)+'%' : '—'),l:'Whiff%'},
              {v:o.strikeouts||0,l:'K'},
              {v:o.walks||0,l:'BB'},
            ].map(k=>`<div class="kpi"><div class="kpi-val mono" style="font-size:18px">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('')}
          </div>
          <div>${Object.entries(pm).sort((a,b)=>b[1].count-a[1].count).map(([pt,s])=>{
            const pct = t ? Math.round(s.count/t*100) : 0;
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px">
              <span style="width:28px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">${pt}</span>
              <div style="flex:1;background:var(--border);height:4px;border-radius:2px">
                <div style="width:${pct}%;height:4px;border-radius:2px;background:${pc(pt)}"></div>
              </div>
              <span class="v-num" style="font-size:10px;width:30px;text-align:right">${pct}%</span>
              <span style="font-size:10px;color:var(--muted);width:50px">W:${s.whiffPct != null ? s.whiffPct+'%' : '—'}</span>
            </div>`;
          }).join('')}</div>
        </div>`).join('')}
    </div>
    <div class="section-hd" style="margin-bottom:.75rem">Pitch mix delta (${o2.date} vs ${o1.date})</div>
    ${allPT.map(pt=>{
      const u1 = t1 ? (pm1[pt]?.count||0)/t1*100 : 0;
      const u2 = t2 ? (pm2[pt]?.count||0)/t2*100 : 0;
      const d = u2-u1;
      if (Math.abs(d) < 1) return '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:12px">
        <span class="pitch-chip" style="min-width:90px"><span class="pitch-dot" style="background:${pc(pt)}"></span>${pn(pt)}</span>
        <span class="v-num" style="min-width:45px">${u1.toFixed(0)}%</span>
        <span style="color:var(--muted)">→</span>
        <span class="v-num" style="min-width:45px">${u2.toFixed(0)}%</span>
        <span class="${d>0?'delta-good':'delta-bad'}" style="font-size:11px">${d>0?'▲':'▼'}${Math.abs(d).toFixed(1)}pp</span>
      </div>`;
    }).join('')}
  `;
}

/* ==================== OPEN IN ANALYZER ==================== */
function openInAnalyzer() {
  window.open('index.html', '_blank');
}

/* ==================== MODAL ==================== */
function openModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').style.display = 'none';
  pendingOutingData = null;
}

/* ==================== TOAST ==================== */
function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type==='success'?'✓':'⚠'}</span> ${msg}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
