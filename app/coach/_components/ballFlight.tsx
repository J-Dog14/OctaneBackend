"use client";

/**
 * Ball-flight views shared by TM + 3D (with the arm) and the Pitching tab (ball only):
 * - HitterViewPanel: true perspective from the catcher / batter's eye.
 * - PitcherViewPanel: true perspective from just behind the pitcher on the mound.
 * - SpinBall: the ball itself spins in flight about the axis implied by its own flight
 *   (geometry.ts spinAxisFromFlight), with the axis drawn through it.
 * Field frame (ft): origin at the back tip of the plate, +Y toward the mound, +Z up,
 * +X = hitter's right (= first-base side).
 */

import { Text } from "@mantine/core";
import {
  PLATE_FRONT_FT,
  RUBBER_FT,
  cameraBasis,
  flightAt,
  hitterCamera,
  perspectiveProject,
  rotateAbout,
  type Camera,
  type FlightPath,
  type V3,
} from "@/lib/coach/armFlight/geometry";

export interface FlightBall {
  key: string;
  color: string;
  flight: { path: FlightPath; flightMs: number };
  spin: { rpm: number | null; eff: number | null; tilt: string | null; axis: V3 | null } | null;
  /** Optional arm stick (shoulder → elbow → wrist → hand) at a time, in field ft (TM + 3D only). */
  arm?: (ms: number) => V3[] | null;
}

export type Batter = "R" | "L" | "C";

/** Strike zone (17 in + ball overlap ≈ ±0.83 ft wide, 1.5–3.5 ft high) at the front of the plate. */
export const ZONE: V3[] = [
  [-0.83, PLATE_FRONT_FT, 1.5],
  [0.83, PLATE_FRONT_FT, 1.5],
  [0.83, PLATE_FRONT_FT, 3.5],
  [-0.83, PLATE_FRONT_FT, 3.5],
];

/** The zone split into 9: its 4 inner lines. */
export const ZONE_THIRDS: Array<[V3, V3]> = [
  [[-0.83 / 3, PLATE_FRONT_FT, 1.5], [-0.83 / 3, PLATE_FRONT_FT, 3.5]],
  [[0.83 / 3, PLATE_FRONT_FT, 1.5], [0.83 / 3, PLATE_FRONT_FT, 3.5]],
  [[-0.83, PLATE_FRONT_FT, 1.5 + 2 / 3], [0.83, PLATE_FRONT_FT, 1.5 + 2 / 3]],
  [[-0.83, PLATE_FRONT_FT, 1.5 + 4 / 3], [0.83, PLATE_FRONT_FT, 1.5 + 4 / 3]],
];

const PLATE: V3[] = [
  [-0.708, PLATE_FRONT_FT, 0],
  [0.708, PLATE_FRONT_FT, 0],
  [0.708, 0.708, 0],
  [0, 0, 0],
  [-0.708, 0.708, 0],
];

/** Spin is shown this much slower than real (a 2400 rpm ball turns ~17 times in flight). */
export const SPIN_SLOW = 0.18;

export const spinAngle = (rpm: number | null, ballMs: number) => (rpm && ballMs > 0 ? 2 * Math.PI * (rpm / 60) * (ballMs / 1000) * SPIN_SLOW : 0);

/** Fit points into a w×h box (equal scale on both axes), y up. */
export function fitter(points: Array<[number, number]>, w: number, h: number, pad = 24) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-6), (h - 2 * pad) / Math.max(y1 - y0, 1e-6));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return (p: [number, number]): [number, number] => [w / 2 + (p[0] - cx) * s, h / 2 - (p[1] - cy) * s];
}

const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const pl = (xs: Array<[number, number]>) => xs.map((p) => p.join(",")).join(" ");

// ---------------------------------------------------------------------------
// Spinning ball
// ---------------------------------------------------------------------------

/**
 * The ball itself, spinning: a baseball at (x, y) with radius R as seen from a camera (basis
 * r = screen right, u = screen up, f = viewing direction), its red seam turned by `angle` about the
 * spin `axis` (right-hand rule), and the axis poking out both sides in the pitch color (the half
 * behind the ball faint). Below ~4 px the seam can't be read, so it's a plain ball.
 */
export function SpinBall({
  x,
  y,
  R,
  axis,
  basis,
  angle,
  color,
}: {
  x: number;
  y: number;
  R: number;
  axis: V3 | null;
  basis: { r: V3; u: V3; f: V3 };
  angle: number;
  color: string;
}) {
  if (!axis || R < 4) {
    return <circle cx={x} cy={y} r={R} fill="#f5f8fa" stroke={color} strokeWidth={2} />;
  }
  // Two unit vectors perpendicular to the axis.
  const seed: V3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1n = [axis[1] * seed[2] - axis[2] * seed[1], axis[2] * seed[0] - axis[0] * seed[2], axis[0] * seed[1] - axis[1] * seed[0]] as V3;
  const l = Math.hypot(...e1n) || 1;
  const e1: V3 = [e1n[0] / l, e1n[1] / l, e1n[2] / l];
  const e2: V3 = [axis[1] * e1[2] - axis[2] * e1[1], axis[2] * e1[0] - axis[0] * e1[2], axis[0] * e1[1] - axis[1] * e1[0]];
  const P = (p: V3): [number, number] => [x + dot3(p, basis.r) * R, y - dot3(p, basis.u) * R];
  const front = (p: V3) => dot3(p, basis.f) < 0; // facing the camera

  /** A curve on the sphere split into front / back runs. */
  const runs = (pts: V3[]) => {
    const out: Array<{ front: boolean; pts: Array<[number, number]> }> = [];
    for (const p of pts) {
      const f = front(p);
      const last = out[out.length - 1];
      if (last && last.front === f) last.pts.push(P(p));
      else out.push({ front: f, pts: last ? [last.pts[last.pts.length - 1]!, P(p)] : [P(p)] });
    }
    return out;
  };
  // Baseball seam (the "tennis-ball curve", exactly on the unit sphere), with the spin axis through
  // the two seam-free patches, turned by `angle` about the axis.
  const N = 96;
  const k = 0.22;
  const c = 2 * Math.sqrt(k * (1 - k));
  const a1 = rotateAbout(e1, axis, angle);
  const a2 = rotateAbout(e2, axis, angle);
  const seam = Array.from({ length: N + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / N;
    const sx = (1 - k) * Math.cos(t) + k * Math.cos(3 * t);
    const sy = (1 - k) * Math.sin(t) - k * Math.sin(3 * t);
    const sz = c * Math.sin(2 * t);
    return [0, 1, 2].map((j) => sx * a1[j]! + sy * a2[j]! + sz * axis[j]!) as V3;
  });
  const L = 1.6;
  const tipA = P([axis[0] * L, axis[1] * L, axis[2] * L]);
  const tipB = P([-axis[0] * L, -axis[1] * L, -axis[2] * L]);
  const sw = Math.max(1, Math.min(2.2, R / 7));

  return (
    <g pointerEvents="none">
      {/* axis behind the ball */}
      <line x1={tipA[0]} y1={tipA[1]} x2={tipB[0]} y2={tipB[1]} stroke={color} strokeOpacity={0.45} strokeWidth={1.5} />
      <circle cx={x} cy={y} r={R} fill="#f5f2ea" stroke={color} strokeWidth={2} />
      {runs(seam).map((r, i) =>
        r.front || R >= 10 ? (
          <polyline key={i} points={pl(r.pts)} fill="none" stroke="#c0392b" strokeWidth={r.front ? sw : 0.8} opacity={r.front ? 0.95 : 0.18} strokeLinecap="round" />
        ) : null,
      )}
      {/* axis in front of the ball: only the half pointing at the camera */}
      {(() => {
        const out = front(axis) ? tipA : tipB;
        const mid = P([0, 0, 0]);
        return <line x1={mid[0]} y1={mid[1]} x2={out[0]} y2={out[1]} stroke={color} strokeWidth={2} strokeLinecap="round" />;
      })()}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shared drawing for the two perspective views
// ---------------------------------------------------------------------------

function makeProjector(cam: Camera, fitPts: V3[], W: number, H: number) {
  const pr = (p: V3) => perspectiveProject(p, cam);
  const pts = fitPts.map(pr).filter((q): q is [number, number] => !!q);
  if (pts.length < 3) return null;
  const toScreen = fitter(pts, W, H, 30);
  const S = (p: V3) => {
    const q = pr(p);
    return q ? toScreen(q) : null;
  };
  /** True perspective size of a baseball (2.9 in across) at p, kept readable. */
  const ballRadius = (p: V3) => {
    const c0 = S(p);
    const c1 = S([p[0] + 0.121, p[1], p[2]]);
    const r = c0 && c1 ? Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) : 3;
    return Math.min(18, Math.max(2.5, r));
  };
  /** Camera basis looking at p (so the ball is shaded/oriented as seen along the actual line of sight). */
  const basisAt = (p: V3) => cameraBasis({ ...cam, target: p });
  return { S, ballRadius, basisAt };
}

function Balls({
  balls,
  focusKey,
  ms,
  S,
  ballRadius,
  basisAt,
  trailOnly,
}: {
  balls: FlightBall[];
  focusKey: string | null;
  ms: number;
  S: (p: V3) => [number, number] | null;
  ballRadius: (p: V3) => number;
  basisAt: (p: V3) => { r: V3; u: V3; f: V3 };
  trailOnly: boolean;
}) {
  const ordered = [...balls].sort((a, b) => Number(a.key === focusKey) - Number(b.key === focusKey));
  const many = balls.length > 1;
  return (
    <>
      {ordered.map((t) => {
        const focused = t.key === focusKey;
        const op = !many || focused ? 1 : 0.4;
        const path = trailOnly ? [] : (t.flight.path.map((p) => S([p[1], p[2], p[3]])).filter(Boolean) as Array<[number, number]>);
        const flownPts = t.flight.path.filter((p) => p[0] <= ms).map((p) => [p[1], p[2], p[3]] as V3);
        if (ms > 0 && ms < t.flight.flightMs) flownPts.push(flightAt(t.flight.path, ms));
        const flown = flownPts.map(S).filter(Boolean) as Array<[number, number]>;
        const ballP = ms >= 0 ? flightAt(t.flight.path, ms) : null;
        const ball = ballP ? S(ballP) : null;
        const arm = t.arm?.(ms)?.map(S).filter(Boolean) as Array<[number, number]> | undefined;
        const end = t.flight.path[t.flight.path.length - 1]!;
        const endS = S([end[1], end[2], end[3]]);
        return (
          <g key={t.key} opacity={op}>
            {path.length > 1 && (
              <>
                {/* faint light underlay so dark pitch colors (cutter brown) still read */}
                <polyline points={pl(path)} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2.5} />
                <polyline points={pl(path)} fill="none" stroke={t.color} strokeOpacity={0.5} strokeWidth={1.5} />
              </>
            )}
            {flown.length > 1 && (
              <>
                <polyline points={pl(flown)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={focused ? 5 : 4} />
                <polyline points={pl(flown)} fill="none" stroke={t.color} strokeWidth={focused ? 3 : 2.5} />
              </>
            )}
            {arm && arm.length === 4 && <polyline points={pl(arm)} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
            {ball && ballP && (
              <SpinBall x={ball[0]} y={ball[1]} R={ballRadius(ballP)} axis={t.spin?.axis ?? null} basis={basisAt(ballP)} angle={spinAngle(t.spin?.rpm ?? null, ms)} color={t.color} />
            )}
            {endS && ms >= t.flight.flightMs && <circle cx={endS[0]} cy={endS[1]} r={5} fill={t.color} stroke="#f5f8fa" strokeWidth={1} />}
          </g>
        );
      })}
    </>
  );
}

function ZoneAndPlate({ S, plate = false }: { S: (p: V3) => [number, number] | null; plate?: boolean }) {
  const zs = ZONE.map(S).filter(Boolean) as Array<[number, number]>;
  const ps = plate ? (PLATE.map(S).filter(Boolean) as Array<[number, number]>) : [];
  return (
    <>
      {ps.length === 5 && <polygon points={pl(ps)} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />}
      {zs.length === 4 && <polygon points={pl(zs)} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />}
      {ZONE_THIRDS.map(([a, b], i) => {
        const p = S(a);
        const q = S(b);
        return p && q ? <line key={`zq${i}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="rgba(255,255,255,0.2)" strokeWidth={1} /> : null;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hitter's view
// ---------------------------------------------------------------------------

export function HitterViewPanel({ balls, focusKey, ms, batter, emptyText }: { balls: FlightBall[]; focusKey: string | null; ms: number; batter: Batter; emptyText?: string }) {
  const W = 560;
  const H = 440;
  const rel = balls.map((t) => t.flight.path[0]!);
  const target: V3 = rel.length
    ? [rel.reduce((a, r) => a + r[1], 0) / rel.length, rel.reduce((a, r) => a + r[2], 0) / rel.length, rel.reduce((a, r) => a + r[3], 0) / rel.length]
    : [0, 54, 5.5];
  // Aim between the release window and the zone so both stay in frame.
  const cam = hitterCamera(batter, [target[0] * 0.5, 30, (target[2] + 2.5) / 2]);
  const fitPts: V3[] = [...ZONE, ...balls.flatMap((t) => t.flight.path.map((p) => [p[1], p[2], p[3]] as V3))];
  const proj = balls.length ? makeProjector(cam, fitPts, W, H) : null;
  if (!proj) {
    return (
      <Text size="sm" c="dimmed" py="xl" ta="center">
        {emptyText ?? "No ball flight to draw (needs release point, plate location and break)."}
      </Text>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden" }} role="img" aria-label="Hitter's view of the pitches">
      <ZoneAndPlate S={proj.S} />
      <Balls balls={balls} focusKey={focusKey} ms={ms} S={proj.S} ballRadius={proj.ballRadius} basisAt={proj.basisAt} trailOnly={false} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pitcher's view (ball only)
// ---------------------------------------------------------------------------

/**
 * From just behind and above the release point on the mound, looking straight down the line to the plate.
 * Ground lanes (1 ft) and 5-ft cross lines run to the plate, so the plate and zone sit ~55 ft out at
 * true scale; balls leave a trail behind them only.
 */
export function PitcherViewPanel({ balls, focusKey, ms, emptyText }: { balls: FlightBall[]; focusKey: string | null; ms: number; emptyText?: string }) {
  const W = 560;
  const H = 440;
  const rel = balls.map((t) => t.flight.path[0]!);
  const r: V3 = rel.length
    ? [rel.reduce((a, q) => a + q[1], 0) / rel.length, rel.reduce((a, q) => a + q[2], 0) / rel.length, rel.reduce((a, q) => a + q[3], 0) / rel.length]
    : [0, 54.5, 5.6];
  // Same spot as TM + 3D's "Pitcher" preset: ~6.5 ft behind the release point and a touch above it,
  // looking straight down the line to the plate (3° down), so the release is near the middle of the
  // picture and the plate sits ~55 ft out at true scale.
  const eye: V3 = [r[0], r[1] + 6.5, r[2] + 0.35];
  const cam: Camera = { eye, target: [r[0], eye[1] - 60, eye[2] - 60 * Math.tan((3 * Math.PI) / 180)], focal: 1 };
  // Frame: the zone, the plate and every flight (from right behind the release they all sit in a
  // narrow cone, so this zooms in on the tunnel).
  const fitPts: V3[] = [...ZONE, ...PLATE, ...balls.flatMap((t) => t.flight.path.map((p) => [p[1], p[2], p[3]] as V3))];
  const proj = balls.length ? makeProjector(cam, fitPts, W, H) : null;
  if (!proj) {
    return (
      <Text size="sm" c="dimmed" py="xl" ta="center">
        {emptyText ?? "No ball flight to draw (needs release point, plate location and break)."}
      </Text>
    );
  }
  const { S } = proj;
  const yMax = eye[1] - 1; // ground lines stop short of the camera
  const seg = (a: V3, b: V3) => {
    const p = S(a);
    const q = S(b);
    return p && q ? { x1: p[0], y1: p[1], x2: q[0], y2: q[1] } : null;
  };
  const lanes: Array<{ a: V3; b: V3; stroke: string; dash?: string }> = [];
  for (let x = -3; x <= 3; x++) lanes.push({ a: [x, 0, 0], b: [x, yMax, 0], stroke: "rgba(255,255,255,0.07)" });
  for (let y = 0; y <= yMax; y += 5) lanes.push({ a: [-3, y, 0], b: [3, y, 0], stroke: "rgba(255,255,255,0.07)" });
  lanes.push({ a: [0, PLATE_FRONT_FT, 0], b: [0, Math.min(RUBBER_FT, yMax), 0], stroke: "rgba(127,200,169,0.6)", dash: "6 4" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden" }} role="img" aria-label="Pitcher's view of the pitches">
      {lanes.map((g, i) => {
        const l = seg(g.a, g.b);
        return l ? <line key={i} {...l} stroke={g.stroke} strokeWidth={1} strokeDasharray={g.dash} /> : null;
      })}
      <ZoneAndPlate S={S} plate />
      <Balls balls={balls} focusKey={focusKey} ms={ms} S={S} ballRadius={proj.ballRadius} basisAt={proj.basisAt} trailOnly />
    </svg>
  );
}
