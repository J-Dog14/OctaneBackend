"use client";

/**
 * Mechanics + Flight → top panel: the throwing arm (upper arm, forearm, wrist, hand) from max
 * layback through release, next to the hitter's view of the same pitches in flight. Both panels
 * share one clock (ms from ball release) so the hand, the release point and the ball line up.
 *
 * Which pitches are drawn is owned by PitchSyncView (shared with the table and chart below):
 * one focused pitch (default: first thrown), every pitch of one type, or all pitches with the
 * focused one on top.
 *
 * Geometry lives in lib/coach/armFlight/geometry.ts (field frame: +X hitter's right, +Y toward the
 * mound, +Z up, ft). The arm is moved into that frame with the session's 3D ↔ TrackMan release fit.
 * The arm view is an orthographic orbit camera: presets, or drag to rotate.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import useSWR from "swr";
import { ActionIcon, Alert, Group, Loader, SegmentedControl, Select, SimpleGrid, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { PITCH_COLORS } from "@/lib/pitch-intel/pitch-types";
import type { ArmFlightData, ArmTrial } from "@/lib/coach/armFlight/load";
import { poseAt, type Pose } from "@/lib/coach/armFlight/pose";
import type { SyncPitch } from "@/lib/coach/pitchSync";
import {
  PLATE_FRONT_FT,
  RUBBER_FT,
  VIEW_PRESETS,
  flightAt,
  orbitBasis,
  spinAxisFromFlight,
  sub,
  type Basis,
  type Orbit,
  type V3,
} from "@/lib/coach/armFlight/geometry";
import { PITCH_CATEGORY_SHORT } from "@/lib/coach/biomech/pitchCategory";
import { fmt, fmtDate, swrOpts } from "./fetcher";
import { trialKey } from "./pitchSyncNames";
import { PitchPicker } from "./PitchPicker";
import { PitchMetricsPanel } from "./PitchMetricsPanel";
import { HitterViewPanel, SpinBall, ZONE_THIRDS, spinAngle, type Batter, type FlightBall } from "./ballFlight";

// three.js is only downloaded when the Solid style is opened.
const ArmSkeleton3D = lazy(() => import("./ArmSkeleton3D").then((m) => ({ default: m.ArmSkeleton3D })));

const NO_TM_COLOR = "#9aa4ab";
const colorOf = (t: ArmTrial) => (t.tm ? PITCH_COLORS[t.tm.code] : NO_TM_COLOR);
// ---------------------------------------------------------------------------
// Arm panel (orbit camera)
// ---------------------------------------------------------------------------

type ViewId = keyof typeof VIEW_PRESETS | "free";
const VIEW_OPTIONS: Array<{ value: ViewId; label: string }> = [
  { value: "pitcher", label: "Pitcher" },
  { value: "hitter", label: "Hitter" },
  { value: "side", label: "Side" },
  { value: "top", label: "Overhead" },
  { value: "free", label: "3D" },
];
const VIEW_HELP: Record<ViewId, string> = {
  pitcher: "From behind the pitcher, looking toward the plate",
  hitter: "From home plate, looking at the pitcher",
  side: "From the third-base side (home to the right)",
  top: "From above, plate at the top",
  free: "Drag the picture to rotate · double-click to go back to the pitcher's view",
};
const FREE_START: Orbit = { az: 215, el: 22 };
const clampZoom = (z: number) => Math.min(6, Math.max(0.35, z));

const dotv = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function ArmPanel({
  trials,
  focusKey,
  ms,
  orbit,
  onOrbit,
  onReset,
  showTmRelease,
  registered,
  ballMs,
  zoom,
  onZoom,
}: {
  trials: ArmTrial[];
  focusKey: string | null;
  ms: number;
  /** Clock for the ball (the arm stops at the end of its window; the ball keeps flying to the plate). */
  ballMs: number;
  /** Zoom on top of the fitted view (1 = fit). Mouse wheel / pinch-trackpad over the picture, or the +/− buttons. */
  zoom: number;
  onZoom: (z: number) => void;

  orbit: Orbit;
  onOrbit: (o: Orbit) => void;
  onReset: () => void;
  showTmRelease: boolean;
  /** Arm is in field coordinates (3D ↔ TrackMan registration worked): x = 0 is the line from the rubber to the plate. */
  registered: boolean;
}) {
  const W = 560;
  const H = 440;

  // Elbow → hand over the whole window (every frame of every shown trial), centered on its 3D box,
  // so the picture doesn't jump while playing. The upper arm runs off the edge on purpose.
  const cloud = useMemo(() => {
    const pts: V3[] = [];
    for (const t of trials) for (const f of t.frames) for (let k = 2; k <= 6; k++) pts.push(f[k] as V3);
    if (!pts.length) return null;
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i]!)) + Math.max(...pts.map((p) => p[i]!))) / 2) as V3;
    const rel = pts.map((p) => sub(p, c));
    return { c, pts: rel, radius: Math.max(0.05, ...rel.map((d) => Math.hypot(d[0], d[1], d[2]))), zMin: Math.min(...pts.map((p) => p[2])) };
  }, [trials]);
  const basis: Basis = useMemo(() => orbitBasis(orbit), [orbit]);
  // Perspective camera orbiting the arm at a fixed distance (about where you'd stand right behind
  // the pitcher), so near things are big and far things small: the plate is drawn where it really
  // is, ~55 ft away, at true scale.
  const cam = useMemo(() => {
    if (!cloud) return null;
    const f = cross3(basis.u, basis.r); // viewing direction
    const dist = Math.max(6, 3.5 * cloud.radius);
    const eye: V3 = [cloud.c[0] - f[0] * dist, cloud.c[1] - f[1] * dist, cloud.c[2] - f[2] * dist];
    // Zoom: fit the arm cloud as seen from the current angle, in every view (presets and free drag
    // alike). The fit changes continuously with the angle, so a drag starts exactly at the preset's
    // framing and eases from there - no jump when you leave a preset - and the arm never leaves the frame.
    let mx = 1e-3;
    let my = 1e-3;
    for (const d of cloud.pts) {
      const z = dist + dotv(d, f);
      mx = Math.max(mx, Math.abs(dotv(d, basis.r)) / z);
      my = Math.max(my, Math.abs(dotv(d, basis.u)) / z);
    }
    const k = Math.min((W / 2 - 24) / mx, (H / 2 - 24) / my);
    return { f, eye, k: k * zoom };
  }, [cloud, basis, zoom]);

  // Wheel zoom. React's onWheel is passive, so it can't stop the page from scrolling: attach natively.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef({ zoom, onZoom });
  useEffect(() => {
    zoomRef.current = { zoom, onZoom };
  }, [zoom, onZoom]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom: z, onZoom: set } = zoomRef.current;
      set(clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag to rotate (batched to one update per animation frame).
  const drag = useRef<{ x: number; y: number; o: Orbit } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<Orbit | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, o: orbit };
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    pending.current = { az: (((g.o.az - dx * 0.5) % 360) + 360) % 360, el: Math.max(0, Math.min(89, g.o.el + dy * 0.4)) };
    if (raf.current == null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (pending.current) onOrbit(pending.current);
      });
    }
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  if (!cloud || !cam) return null;
  const NEAR = 0.3;
  const depth = (p: V3) => dotv(sub(p, cam.eye), cam.f);
  const P = (p: V3): [number, number] => {
    const d = sub(p, cam.eye);
    const z = Math.max(NEAR, dotv(d, cam.f));
    return [W / 2 + (dotv(d, basis.r) / z) * cam.k, H / 2 - (dotv(d, basis.u) / z) * cam.k];
  };
  /** Segment clipped to the part in front of the camera (null if none of it is). */
  const clip = (a: V3, b: V3): { x1: number; y1: number; x2: number; y2: number } | null => {
    const da = depth(a);
    const db = depth(b);
    if (da < NEAR && db < NEAR) return null;
    const cut = (p: V3, q: V3, dp: number, dq: number): V3 => {
      const t = (NEAR - dp) / (dq - dp);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    };
    const a2 = da < NEAR ? cut(a, b, da, db) : a;
    const b2 = db < NEAR ? cut(b, a, db, da) : b;
    const [x1, y1] = P(a2);
    const [x2, y2] = P(b2);
    return { x1, y1, x2, y2 };
  };
  const visible = (ps: V3[]) => ps.every((p) => depth(p) > NEAR);
  const pts = (ps: V3[]) => ps.map((p) => P(p).join(",")).join(" ");
  const viewDir = cross3(basis.u, basis.r);
  /** 0 = forearm box seen edge-on, 1 = seen face-on. */
  const facing = (q: Pose) => {
    const n = cross3(sub(q.ulna, q.elbowMed), sub(q.radius, q.elbowLat));
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 1e-9 ? Math.abs(dotv(n, viewDir)) / len : 0;
  };
  const line = (a: V3, b: V3) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    return { x1, y1, x2, y2 };
  };

  // Orientation legend: a small 3D axis set seen through the same camera (in perspective, so an axis
  // pointing into the screen gets shorter and fainter), on a patch of ground. Field axes: plate = −Y,
  // first-base side = +X (the hitter's right), up = +Z.
  // Same heading as the camera but looked at from at least 25° above, so the ground patch reads
  // as a surface even when the camera is at eye level (left/right and into/out of screen unchanged).
  const lb = orbitBasis({ az: orbit.az, el: Math.max(orbit.el, 25) });
  const fwd = cross3(lb.u, lb.r); // legend viewing direction
  const gx = 58;
  const gy = H - 52;
  const GL = 30;
  const GD = 3.2; // legend camera distance, in axis lengths: lower = stronger perspective
  const gz = (v: V3): [number, number] => {
    const s = GD / (GD + dotv(v, fwd));
    return [gx + dotv(v, lb.r) * GL * s, gy - dotv(v, lb.u) * GL * s];
  };
  const legendAxes = (
    [
      { v: [0, -1, 0] as V3, label: "plate", color: "#7fc8a9" },
      { v: [1, 0, 0] as V3, label: "1B", color: "#e2b363" },
      { v: [0, 0, 1] as V3, label: "up", color: "rgba(255,255,255,0.8)" },
    ]
  )
    .map((a) => ({ ...a, tip: gz(a.v), depth: dotv(a.v, fwd) }))
    .sort((a, b) => b.depth - a.depth); // farthest first, nearest drawn on top
  const legendFloor = ([[-0.7, -0.7, 0], [0.7, -0.7, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0]] as V3[]).map(gz);

  // Focused trial last so it draws on top.
  const ordered = [...trials].sort((a, b) => Number(trialKey(a) === focusKey) - Number(trialKey(b) === focusKey));
  const many = trials.length > 1;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden", cursor: dragging ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
      role="img"
      aria-label="Throwing arm through release (drag to rotate, scroll to zoom)"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onReset}
    >
      {/* Context, drawn behind the arm. With the arm placed on the field (TrackMan registration):
          the ground (z = 0) from the rubber to the plate with 1-ft lanes and 5-ft cross lines, the
          rubber-to-plate center line, home plate and the strike zone at their real spots (so from the
          pitcher's view they sit ~55 ft out, at true scale), each pitch's flight, and a plumb line from
          the release point. Without registration: a local 1-ft grid under the arm. */}
      {(() => {
        const segs: Array<{ a: V3; b: V3; stroke: string; w: number; dash?: string }> = [];
        const focus = ordered[ordered.length - 1];
        const relHand = focus ? poseAt(focus, 0).hand : null;
        if (registered) {
          for (let x = -3; x <= 3; x++) segs.push({ a: [x, 0, 0], b: [x, 63, 0], stroke: "rgba(255,255,255,0.07)", w: 1 });
          for (let y = 0; y <= 60; y += 5) segs.push({ a: [-3, y, 0], b: [3, y, 0], stroke: "rgba(255,255,255,0.07)", w: 1 });
          segs.push({ a: [0, RUBBER_FT, 0], b: [0, PLATE_FRONT_FT, 0], stroke: "rgba(127,200,169,0.6)", w: 1.5, dash: "6 4" });
        } else {
          const z0 = cloud.zMin - 0.25;
          const cx = Math.round(cloud.c[0]);
          const cy = Math.round(cloud.c[1]);
          for (let k = -3; k <= 3; k++) {
            segs.push({ a: [cx + k, cy - 3, z0], b: [cx + k, cy + 3, z0], stroke: "rgba(255,255,255,0.07)", w: 1 });
            segs.push({ a: [cx - 3, cy + k, z0], b: [cx + 3, cy + k, z0], stroke: "rgba(255,255,255,0.07)", w: 1 });
          }
        }
        const plate: V3[] = [
          [-0.708, PLATE_FRONT_FT, 0],
          [0.708, PLATE_FRONT_FT, 0],
          [0.708, 0.708, 0],
          [0, 0, 0],
          [-0.708, 0.708, 0],
        ];
        const zone: V3[] = [
          [-0.83, PLATE_FRONT_FT, 1.5],
          [0.83, PLATE_FRONT_FT, 1.5],
          [0.83, PLATE_FRONT_FT, 3.5],
          [-0.83, PLATE_FRONT_FT, 3.5],
        ];
        const rubber: V3[] = [
          [-1, RUBBER_FT, 0],
          [1, RUBBER_FT, 0],
          [1, RUBBER_FT + 0.5, 0],
          [-1, RUBBER_FT + 0.5, 0],
        ];
        const plateLabel = registered && visible(plate) ? P([0.9, 0.7, 0]) : null;
        const plumbBase: V3 | null = relHand ? [relHand[0], relHand[1], registered ? 0 : cloud.zMin - 0.25] : null;
        return (
          <g pointerEvents="none">
            {segs.map((g, i) => {
              const l = clip(g.a, g.b);
              return l ? <line key={i} {...l} stroke={g.stroke} strokeWidth={g.w} strokeDasharray={g.dash} /> : null;
            })}
            {registered && visible(rubber) && <polygon points={pts(rubber)} fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />}
            {registered && visible(plate) && <polygon points={pts(plate)} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.75)" strokeWidth={1} />}
            {registered && visible(zone) && <polygon points={pts(zone)} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />}
            {registered &&
              visible(zone) &&
              ZONE_THIRDS.map(([a, b], i) => <line key={`zq${i}`} {...clip(a, b)!} stroke="rgba(255,255,255,0.18)" strokeWidth={0.8} />)}
            {plateLabel && (
              <text x={Math.min(plateLabel[0] + 4, W - 70)} y={Math.max(plateLabel[1], 12)} fontSize={10} fill="rgba(255,255,255,0.55)">
                home plate
              </text>
            )}
            {/* Ball flight: only the part the ball has already traveled (a trail behind it), so nothing is
                drawn ahead of the ball. All shown pitches; highlighted one on top. */}
            {registered &&
              ordered.map((t) => {
                if (!t.flight || ballMs <= 0) return null;
                const focused = trialKey(t) === focusKey;
                const path = t.flight.path;
                const lines = [];
                for (let i = 1; i < path.length; i++) {
                  const a = path[i - 1]!;
                  if (a[0] >= ballMs) break;
                  const b = path[i]!;
                  // Last piece stops at the ball.
                  const end: V3 = b[0] > ballMs ? flightAt(path, ballMs) : [b[1], b[2], b[3]];
                  const l = clip([a[1], a[2], a[3]], end);
                  if (l) lines.push(<line key={i} {...l} stroke={colorOf(t)} strokeOpacity={focused || !many ? 0.85 : 0.5} strokeWidth={focused || !many ? 1.8 : 1.3} />);
                }
                const ball = ballMs >= 0 ? flightAt(path, ballMs) : null;
                return (
                  <g key={`fl-${trialKey(t)}`}>
                    {lines}
                    {ball && depth(ball) > NEAR && (
                      <g opacity={focused || !many ? 1 : 0.55}>
                        <SpinBall
                          x={P(ball)[0]}
                          y={P(ball)[1]}
                          R={Math.max(2, Math.min(14, (0.121 * cam.k) / depth(ball)))}
                          axis={trialSpinAxis(t)}
                          basis={{ r: basis.r, u: basis.u, f: viewDir }}
                          angle={spinAngle(t.tm?.spinRate ?? null, ballMs)}
                          color={colorOf(t)}
                        />
                      </g>
                    )}
                  </g>
                );
              })}
            {relHand && plumbBase && (
              <>
                {(() => {
                  const l = clip(relHand, plumbBase);
                  return l ? <line {...l} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="2 3" /> : null;
                })()}
                {depth(plumbBase) > NEAR && <circle cx={P(plumbBase)[0]} cy={P(plumbBase)[1]} r={2.5} fill="rgba(255,255,255,0.45)" />}
              </>
            )}
          </g>
        );
      })()}
      {ordered.map((t) => {
        const c = colorOf(t);
        const focused = trialKey(t) === focusKey;
        const op = !many || focused ? 1 : 0.32;
        const trail = t.frames.filter((f) => f[0] <= ms).map((f) => P(f[6] as V3));
        const now = poseAt(t, ms);
        return (
          <g key={trialKey(t)} opacity={op}>
            {trail.length > 1 && <polyline points={trail.map((p) => p.join(",")).join(" ")} fill="none" stroke={c} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="3 3" />}
            {/* Upper arm: both elbow markers to the shoulder. */}
            <polygon points={pts([now.shoulder, now.elbowLat, now.elbowMed])} fill="#c8d0d5" fillOpacity={0.08} stroke="#c8d0d5" strokeOpacity={0.55} strokeWidth={1.5} strokeLinejoin="round" />
            {/* Forearm box (Joey's wiring): radius wrist - medial elbow, ulna wrist - lateral elbow, elbow - elbow, wrist - wrist.
                Shaded by how square it faces the camera, so the twist through pronation reads as a change in shade. */}
            <polygon points={pts([now.radius, now.elbowMed, now.elbowLat, now.ulna])} fill={c} fillOpacity={0.18 + 0.5 * facing(now)} stroke="rgba(255,255,255,0.5)" strokeWidth={3} strokeLinejoin="round" />
            <polygon points={pts([now.radius, now.elbowMed, now.elbowLat, now.ulna])} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
            {/* Hand: both wrist markers to the hand marker. */}
            <polygon points={pts([now.radius, now.ulna, now.hand])} fill={c} fillOpacity={0.45} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} strokeLinejoin="round" />
            <line {...line(now.radius, now.ulna)} stroke="#f5f8fa" strokeWidth={3.5} strokeLinecap="round" />
            {(
              [
                [now.elbowLat, "#c8d0d5", 3.5, "lateral elbow"],
                [now.elbowMed, "#8f9aa1", 3.5, "medial elbow"],
                [now.ulna, "#8f9aa1", 3.5, "ulnar side of the wrist"],
                [now.radius, "#f5f8fa", 4.5, "radial side of the wrist"],
                [now.hand, c, 5, "hand"],
              ] as Array<[V3, string, number, string]>
            ).map(([p, fill, r, title]) => (
              <circle key={title} cx={P(p)[0]} cy={P(p)[1]} r={r} fill={fill} stroke={fill === c ? "#f5f8fa" : c} strokeWidth={1.5}>
                <title>{title}</title>
              </circle>
            ))}
            {showTmRelease && t.flight && (!many || focused) && (() => {
              const r = t.flight!.path[0]!;
              const [x, y] = P([r[1], r[2], r[3]]);
              return (
                <g stroke="#f5f8fa" strokeWidth={2}>
                  <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
                  <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} />
                </g>
              );
            })()}
          </g>
        );
      })}
      <g fontSize={10} pointerEvents="none">
        <polygon points={legendFloor.map((p) => p.join(",")).join(" ")} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
        {legendAxes.map((a) => {
          const away = a.depth > 0.25; // pointing into the screen
          const short = Math.hypot(a.tip[0] - gx, a.tip[1] - gy) < 14; // pointing (nearly) straight into / out of the screen
          const op = away ? 0.55 : 0.95;
          // Label just past the tip, pushed outward from the origin.
          const dx = a.tip[0] - gx;
          const dy = a.tip[1] - gy;
          const n = Math.hypot(dx, dy) || 1;
          // Short (end-on) axes get their label below-right of the origin, clear of the other two.
          const lx = short ? gx + 8 : a.tip[0] + (dx / n) * 6;
          const ly = short ? gy + 16 : a.tip[1] + (dy / n) * 6 + 3;
          return (
            <g key={a.label} opacity={op}>
              <line x1={gx} y1={gy} x2={a.tip[0]} y2={a.tip[1]} stroke={a.color} strokeWidth={away ? 1.5 : 2.2} strokeDasharray={away ? "3 2" : undefined} />
              <circle cx={a.tip[0]} cy={a.tip[1]} r={away ? 2 : 2.8} fill={a.color} />
              <text x={lx} y={ly} fill={a.color} textAnchor={!short && dx < -2 ? "end" : "start"}>
                {a.label}
                {short ? (a.depth > 0 ? " (into screen)" : " (toward you)") : ""}
              </text>
            </g>
          );
        })}
        <circle cx={gx} cy={gy} r={1.8} fill="rgba(255,255,255,0.8)" />
      </g>
    </svg>
  );
}

/** Spin axis of a paired pitch, from its own TrackMan flight (null without a flight or with no measurable bend). */
function trialSpinAxis(t: ArmTrial): V3 | null {
  return t.flight && t.tm ? spinAxisFromFlight(t.flight.path, t.tm.spinEff) : null;
}

/** An arm trial as a ball for the shared flight views (with its arm stick for the hitter's view). */
function toFlightBall(t: ArmTrial): FlightBall | null {
  if (!t.flight) return null;
  const last = t.frames[t.frames.length - 1]![0];
  return {
    key: trialKey(t),
    color: colorOf(t),
    flight: t.flight,
    spin: t.tm ? { rpm: t.tm.spinRate, eff: t.tm.spinEff, tilt: t.tm.tilt, axis: trialSpinAxis(t) } : null,
    arm: (m) => {
      const q = poseAt(t, Math.min(m, last));
      return [q.shoulder, q.elbow, q.wrist, q.hand];
    },
  };
}

// ---------------------------------------------------------------------------

/** Playback: the arm phase runs at the chosen slow-motion speed; from release on, the whole ball
 *  flight plays in about this much real time (or faster at a faster speed), so the hitter's view
 *  follows the arm straight away instead of crawling through 400+ ms of flight. */
const FLIGHT_PLAY_MS = 900;
/** Play starts this long before MER (the data window starts 60 ms before; scrub back for it). */
const LEAD_IN_MS = 20;
/** Slider track: the arm phase (start → release) gets the first half, the flight the second. */
const TRACK = 1000;

export function ArmFlightView({
  athleteUuid,
  date,
  pitches,
  names,
  selected,
  focusKey,
  onPick,
  onSelect,
  xaStatus,
}: {
  athleteUuid: string;
  date: string | null;
  /** Throw order. */
  pitches: SyncPitch[];
  names: Map<string, string>;
  selected: string[];
  focusKey: string | null;
  onPick: (key: string) => void;
  onSelect: (keys: string[]) => void;
  xaStatus: { state: string; message: string | null } | null;
}) {
  const url = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pitch-sync/arm${date ? `?date=${date}` : ""}`;
  const { data: d, error, isLoading } = useSWR<ArmFlightData>(url, { ...swrOpts, keepPreviousData: true });

  const [viewId, setViewId] = useState<ViewId>("pitcher");
  const [armStyle, setArmStyle] = useState<"lines" | "solid">("lines");
  const [zoom, setZoom] = useState(1);
  const [orbit, setOrbit] = useState<Orbit>(VIEW_PRESETS.pitcher);
  const [batter, setBatter] = useState<Batter>("C");
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("0.05");
  const raf = useRef<number | null>(null);

  const byKey = useMemo(() => new Map((d?.trials ?? []).map((t) => [trialKey(t), t])), [d]);
  const shown = useMemo(() => selected.map((k) => byKey.get(k)).filter((t): t is ArmTrial => !!t), [selected, byKey]);
  const focusArm = (focusKey ? byKey.get(focusKey) : undefined) ?? null;
  const focusPitch = pitches.find((p) => trialKey(p) === focusKey) ?? pitches[0] ?? null;
  const selectedPitches = useMemo(() => pitches.filter((p) => selected.includes(trialKey(p))), [pitches, selected]);

  const tMin = shown.length ? Math.min(...shown.map((t) => t.frames[0]![0])) : -100;
  const playStart = shown.length ? Math.max(tMin, Math.min(...shown.map((t) => t.merMs)) - LEAD_IN_MS) : tMin;
  const tMax = Math.max(1, shown.length ? Math.max(...shown.map((t) => t.flight?.flightMs ?? t.frames[t.frames.length - 1]![0])) : 100);
  const merMs = focusArm ? focusArm.merMs : shown[0]?.merMs ?? -30;
  const armEnd = shown.length ? Math.max(...shown.map((t) => t.frames[t.frames.length - 1]![0])) : 0;
  const toU = (m: number) => (m <= 0 ? (TRACK / 2) * (1 - m / Math.min(tMin, -1)) : TRACK / 2 + (TRACK / 2) * Math.min(1, m / tMax));
  const fromU = (u: number) => (u <= TRACK / 2 ? Math.min(tMin, -1) * (1 - u / (TRACK / 2)) : ((u - TRACK / 2) / (TRACK / 2)) * tMax);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      setMs((m) => {
        // Slow motion through the whole arm window (MER → release → follow-through), then the rest of
        // the flight speeds up so it still takes about FLIGHT_PLAY_MS.
        const rate = m < armEnd ? Number(speed) : Math.max(Number(speed), Math.max(1, tMax - armEnd) / FLIGHT_PLAY_MS);
        const n = m + dt * rate;
        if (n >= tMax) {
          setPlaying(false);
          return tMax;
        }
        return n;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, tMax, armEnd]);

  if (isLoading && !d) return <Loader size="sm" />;
  if (error && !d) return <Alert color="red">{error.message}</Alert>;
  if (!d || !focusPitch) return null;

  const pickView = (v: ViewId) => {
    setViewId(v);
    setOrbit(v === "free" ? FREE_START : VIEW_PRESETS[v]);
    setZoom(1);
  };
  const fk = focusArm ? trialKey(focusArm) : null;
  const phase = ms < merMs ? "before MER" : ms < 0 ? "MER → release" : ms <= 0.5 ? "release" : "ball in flight";
  const msClamped = Math.max(tMin, Math.min(ms, tMax));
  const noArm = selected.filter((k) => !byKey.has(k));

  return (
    <Stack gap="sm" id="arm-flight" style={{ scrollMarginTop: 80 }}>
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <PitchPicker pitches={pitches} names={names} selected={selected} focusKey={focusKey} onPick={onPick} onSelect={onSelect} />
        <Text size="xs" c="dimmed">
          {selected.length === 1 ? "1 pitch shown" : `${selected.length} pitches shown, highlighted one on top`} · ◀ ▶ step through every pitch in throw order
        </Text>
      </Group>
      {noArm.length > 0 && (
        <Text size="xs" c="orange">
          No arm marker data for {noArm.map((k) => names.get(k) ?? k).join(", ")}.
        </Text>
      )}

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" style={{ alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <Group justify="space-between" mb={4} wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Text fw={600} size="sm">Arm through release</Text>
              <Tooltip label="Solid = experimental 3D bones anchored on the arm markers" withArrow>
                <SegmentedControl size="xs" value={armStyle} onChange={(v) => setArmStyle(v as "lines" | "solid")} data={[{ value: "lines", label: "Lines" }, { value: "solid", label: "Solid" }]} />
              </Tooltip>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Group gap={2} wrap="nowrap">
                <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>
                  −
                </ActionIcon>
                <Tooltip label="Reset zoom (or scroll over the picture)" withArrow>
                  <Text size="xs" c="dimmed" w={34} ta="center" style={{ cursor: "pointer", fontVariantNumeric: "tabular-nums" }} onClick={() => setZoom(1)}>
                    {zoom.toFixed(1)}×
                  </Text>
                </Tooltip>
                <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>
                  +
                </ActionIcon>
              </Group>
              <Tooltip label={VIEW_HELP[viewId]} withArrow>
                <SegmentedControl size="xs" value={viewId} onChange={(v) => pickView(v as ViewId)} data={VIEW_OPTIONS} />
              </Tooltip>
            </Group>
          </Group>
          {shown.length && armStyle === "solid" ? (
            <Suspense fallback={<Loader size="sm" />}>
              <ArmSkeleton3D
                trials={shown}
                focusKey={fk}
                keyOf={trialKey}
                colorOf={colorOf}
                ms={Math.min(msClamped, armEnd)}
                ballMs={msClamped}
                lefty={d.throws === "L"}
                registered={!!d.registration}
                orbit={orbit}
                zoom={zoom}
              />
            </Suspense>
          ) : shown.length ? (
            <ArmPanel
              trials={shown}
              focusKey={fk}
              ms={Math.min(msClamped, armEnd)}
              ballMs={msClamped}
              orbit={orbit}
              onOrbit={(o) => {
                setOrbit(o);
                setViewId("free");
              }}
              onReset={() => pickView(viewId === "free" ? "pitcher" : viewId)}
              showTmRelease={!!d.registration}
              registered={!!d.registration}
              zoom={zoom}
              onZoom={setZoom}
            />
          ) : (
            <Text size="sm" c="dimmed" py="xl" ta="center">No arm marker data for the selected pitch.</Text>
          )}
          {armStyle === "solid" ? (
            <Text size="xs" c="dimmed" mt={4}>
              Experimental. Drag to rotate, scroll to zoom, right-drag to pan; a view button resets the camera. Bones are simple solids placed on the markers: humerus
              (shoulder joint ~2 in below the acromion marker), ulna on the medial side, radius on the lateral side (it rolls over the ulna as the forearm pronates),
              hand from the wrist to the hand marker with the fingers in a fixed grip.
            </Text>
          ) : (
            <Text size="xs" c="dimmed" mt={4}>
              Drag to rotate, scroll to zoom, double-click to reset. Forearm box = the marker wiring (radial wrist → medial elbow, ulnar wrist → lateral elbow); it shades
              lighter as it turns face-on, so pronation shows as the box twisting. White bar + white dot = radial side of the wrist. Gray = upper arm. Dotted
              = hand path.{d.registration ? " × = TrackMan release point." : ""}
            </Text>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <Group justify="space-between" mb={4} wrap="nowrap">
            <Text fw={600} size="sm">Hitter&apos;s view</Text>
            <SegmentedControl size="xs" value={batter} onChange={(v) => setBatter(v as Batter)} data={[{ value: "C", label: "Catcher" }, { value: "R", label: "RHB eye" }, { value: "L", label: "LHB eye" }]} />
          </Group>
          {d.registration ? (
            <HitterViewPanel
              balls={shown.map(toFlightBall).filter((b): b is FlightBall => !!b)}
              focusKey={fk}
              ms={msClamped}
              batter={batter}
              emptyText={`No TrackMan flight to draw for ${shown.length === 1 ? "this pitch" : "these pitches"} (needs release point, plate location and break).`}
            />
          ) : (
            <Text size="sm" c="dimmed">Needs at least two paired pitches with a TrackMan release point.</Text>
          )}
          <Text size="xs" c="dimmed" mt={4}>
            True perspective from behind the plate (or the batter&apos;s eye): the ball barely moves on screen for most of its flight, then rushes in. Paths come from
            TrackMan release point, plate location, IVB and HB (velo-only reads aren&apos;t drawn).
          </Text>
        </div>
        <div style={{ minWidth: 0 }}>
          <PitchMetricsPanel
            pitches={selectedPitches}
            names={selectedPitches.map((p) => names.get(trialKey(p)) ?? "")}
            arms={selectedPitches.map((p) => byKey.get(trialKey(p)) ?? null)}
            xaStatus={xaStatus}
          />
        </div>
      </SimpleGrid>

      <Group gap="sm" align="center" wrap="nowrap">
        <ActionIcon
          variant="light"
          size="lg"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && (msClamped >= tMax || msClamped < playStart)) setMs(playStart);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "❚❚" : "▶"}
        </ActionIcon>
        <div style={{ flex: 1 }}>
          <Slider
            min={0}
            max={TRACK}
            step={1}
            value={Math.round(toU(msClamped))}
            onChange={(u) => {
              setPlaying(false);
              setMs(fromU(u));
            }}
            label={(u) => {
              const m = Math.round(fromU(u));
              return `${m >= 0 ? "+" : ""}${m} ms`;
            }}
            marks={[
              { value: Math.round(toU(merMs)), label: "MER" },
              { value: TRACK / 2, label: "Release" },
              ...(tMax > 200 ? [{ value: TRACK, label: "Plate" }] : []),
            ]}
          />
        </div>
        <Tooltip label="Slow motion for the arm, from just before MER through release and follow-through. After the arm finishes, the rest of the ball flight plays in about a second." withArrow>
          <Select
            size="xs"
            w={110}
            value={speed}
            onChange={(v) => v && setSpeed(v)}
            data={[
              { value: "0.02", label: "1/50 speed" },
              { value: "0.05", label: "1/20 speed" },
              { value: "0.2", label: "1/5 speed" },
            ]}
            allowDeselect={false}
          />
        </Tooltip>
      </Group>
      <Text size="sm">
        <b>{msClamped >= 0 ? "+" : ""}{Math.round(msClamped)} ms</b> from release · {phase}
        {ms >= armEnd && Number(speed) < (tMax - armEnd) / FLIGHT_PLAY_MS ? " · flight sped up" : ""}
        {shown.some((t) => t.merSource !== "event")
          ? shown.some((t) => t.merSource === "default")
            ? " · events not stored yet: release from peak hand speed, MER 35 ms before it"
            : " · events not stored yet: release from peak hand speed, MER/foot contact from V3D timing"
          : ""}
      </Text>
      <Text size="xs" c="dimmed">
        {d.throws === "L" ? "LHP" : "RHP"} · {d.side} arm markers · capture {fmtDate(d.sessionDate)} ·{" "}
        {d.registration
          ? `3D and TrackMan lined up on ${d.registration.n} release points (typical gap ${fmt(d.registration.rmsFt * 12, 1)} in).`
          : "not enough TrackMan release points to place the arm on the field, so the arm is shown on its own."}
        {d.skipped.length > 0 ? ` No arm data: ${d.skipped.map((s) => `${PITCH_CATEGORY_SHORT[s.category]} #${s.trialIndex} (${s.reason})`).join(", ")}.` : ""}
      </Text>
    </Stack>
  );
}
