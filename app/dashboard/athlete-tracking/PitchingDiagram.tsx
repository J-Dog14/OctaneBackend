"use client";

/**
 * PitchingDiagram v2 — Anatomical SVG diagrams for pitching report sections.
 *
 * Visual language: detailed skeletal figure with long colored axis arrows
 * (yellow = primary measurement, blue = secondary/reference), matching the
 * style of professional motion-capture biomechanics platforms.
 *
 * Only rendered for sections where a visual meaningfully aids understanding.
 * Returns null for sections that don't need one.
 */

import React from "react";

// ── Color palette ──────────────────────────────────────────────────────────
const BG   = "#0f1419";
const BG2  = "#1a2332";
const BDR  = "#243044";
// Bone / skeletal figure colors
const BONE    = "#b0c4d8";       // main bone segment color (light blue-gray)
const BONE_DK = "#718fa8";       // darker tone for depth
const BONE_LT = "rgba(200,225,245,0.9)"; // highlight on joint face
// Axis arrow colors (matching the skeleton renders uploaded)
const YLW  = "#fbbf24";          // yellow: primary measurement axis
const BLU  = "#3b82f6";          // blue: secondary / reference axis
// Annotation colors
const GRN  = "#22c55e";
const RED  = "#ef4444";
const WHT  = "#e8f1f8";
const DIM  = "#8b9db0";
const MUT  = "#4a5a6a";

// ── Wrapper SVG ────────────────────────────────────────────────────────────
function D({
  children,
  w = 240,
  h = 190,
}: {
  children: React.ReactNode;
  w?: number;
  h?: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      style={{
        display: "block",
        flexShrink: 0,
        maxWidth: w,
        /* height derived from viewBox aspect ratio automatically */
        borderRadius: 10,
        border: `1px solid ${BDR}`,
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Radial gradient for joints — sphere effect */}
        <radialGradient id="jg" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="rgba(210,235,255,0.9)" />
          <stop offset="60%" stopColor={BONE} />
          <stop offset="100%" stopColor={BONE_DK} />
        </radialGradient>
        <radialGradient id="jgB" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="rgba(120,180,255,0.95)" />
          <stop offset="60%" stopColor="#4a90d9" />
          <stop offset="100%" stopColor="#2563be" />
        </radialGradient>
        <radialGradient id="jgY" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="rgba(255,240,120,0.95)" />
          <stop offset="60%" stopColor={YLW} />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
        {/* Arrow markers */}
        <marker id="ay" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
          <polygon points="0,1 0,9 10,5" fill={YLW} />
        </marker>
        <marker id="ab" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
          <polygon points="0,1 0,9 10,5" fill={BLU} />
        </marker>
        <marker id="ag" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
          <polygon points="0,1 0,9 10,5" fill={GRN} />
        </marker>
        <marker id="aw" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <polygon points="0,1 0,7 8,4" fill={WHT} />
        </marker>
        {/* Glow filter for axis arrows */}
        <filter id="glow-y" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-b" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width={w} height={h} fill={BG} rx={9} />
      {children}
    </svg>
  );
}

// ── SVG primitives ─────────────────────────────────────────────────────────

/** Anatomical bone segment — thick rounded line with highlight sheen */
function Seg({
  x1, y1, x2, y2, w = 9, color = BONE, dimmed = false,
}: {
  x1: number; y1: number; x2: number; y2: number;
  w?: number; color?: string; dimmed?: boolean;
}) {
  const op = dimmed ? 0.4 : 1;
  return (
    <>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op}
      />
      {/* Highlight sheen on top surface */}
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="rgba(255,255,255,0.18)" strokeWidth={w * 0.38}
        strokeLinecap="round" opacity={op}
      />
    </>
  );
}

/** Skeletal joint — sphere appearance */
function Jnt({
  cx, cy, r = 7, grad = "jg",
}: {
  cx: number; cy: number; r?: number; grad?: string;
}) {
  return <circle cx={cx} cy={cy} r={r} fill={`url(#${grad})`} />;
}

/** Axis arrow — long colored directional vector (like in motion-capture software) */
function Axis({
  x1, y1, x2, y2, color, markerId, width = 3, glow = false,
}: {
  x1: number; y1: number; x2: number; y2: number;
  color: string; markerId: string; width?: number; glow?: boolean;
}) {
  const filterId = glow ? (color === YLW ? "glow-y" : "glow-b") : undefined;
  return (
    <>
      {/* Shadow / glow layer */}
      {glow && (
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={width + 3} strokeLinecap="round"
          opacity={0.25} filter={`url(#${filterId})`}
        />
      )}
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={width}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
        filter={glow ? `url(#${filterId})` : undefined}
      />
      {/* Small disc at tail end */}
      <circle cx={x1} cy={y1} r={width * 0.9} fill={color} opacity={0.7} />
    </>
  );
}

/** Arc path string (SVG angles: 0=right, clockwise) */
function arcP(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const r2d = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(r2d(a1));
  const y1 = cy + r * Math.sin(r2d(a1));
  const x2 = cx + r * Math.cos(r2d(a2));
  const y2 = cy + r * Math.sin(r2d(a2));
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

/** Text label */
function Lbl({
  x, y, s, fill = WHT, size = 9, weight = "normal",
  anchor = "middle",
}: {
  x: number; y: number; s: string; fill?: string; size?: number;
  weight?: "normal" | "600" | "700"; anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x} y={y}
      textAnchor={anchor}
      fill={fill}
      fontSize={size}
      fontWeight={weight}
      fontFamily="'DM Sans', system-ui, -apple-system, sans-serif"
    >
      {s}
    </text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE FIGURE PARTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pitcher at foot-plant, side view facing left.
 * All coords are in a 240×190 space. `highlight` tints specific segments.
 */
function PitcherFootPlant({
  highlight = "none",
  dimLegs = false,
  dimArms = false,
  showRibcage = true,
}: {
  highlight?: "leadLeg" | "torso" | "arm" | "none";
  dimLegs?: boolean;
  dimArms?: boolean;
  showRibcage?: boolean;
}) {
  // ── Key joint positions ──────────────────────────────────────────────────
  // Lead leg (front, toward home plate = left side)
  const lfx = 65,  lfy = 176;  // lead foot
  const lkx = 82,  lky = 136;  // lead knee
  const lhx = 106, lhy = 100;  // lead hip

  // Trail leg (back, rubber side)
  const trhx = 122, trhy = 96;
  const trkx = 148, trky = 124;
  const trfx = 164, trfy = 158;

  // Torso / spine
  const pelCx = 114, pelCy = 98;   // pelvis center
  const spMid = { x: 116, y: 76 }; // mid-spine
  const shCx  = 118, shCy = 52;    // shoulder center (between two shoulders)

  // Shoulders
  const lShx = 104, lShy = 50; // lead/glove shoulder
  const rShx = 132, rShy = 50; // trail/throw shoulder

  // Throwing arm (going up-right at foot plant / early cocking)
  const rElx = 158, rEly = 36;
  const rHndX = 180, rHndY = 24;

  // Glove arm (forward / extending toward plate)
  const lElx = 80,  lEly = 62;
  const lHndX = 66, lHndY = 72;

  // Head
  const hx = 116, hy = 32;

  const legColor  = highlight === "leadLeg" ? "#3b82f6" : BONE;
  const torsoColor = highlight === "torso" ? "#06b6d4" : BONE;
  const armColor  = highlight === "arm" ? YLW : BONE;

  return (
    <>
      {/* ── Trail leg ── */}
      <Seg x1={trhx} y1={trhy} x2={trkx} y2={trky} w={11} color={BONE} dimmed={dimLegs} />
      <Seg x1={trkx} y1={trky} x2={trfx} y2={trfy} w={9}  color={BONE} dimmed={dimLegs} />
      <Jnt cx={trkx} cy={trky} r={7} />
      <Jnt cx={trfx} cy={trfy} r={5} />

      {/* ── Pelvis shape ── */}
      <ellipse
        cx={pelCx} cy={pelCy + 4}
        rx={14} ry={9}
        fill={torsoColor} fillOpacity={0.35}
        stroke={torsoColor} strokeWidth={1.2} opacity={0.6}
      />

      {/* ── Lead leg (highlighted for lead-leg-grf) ── */}
      <Seg x1={lhx}  y1={lhy}  x2={lkx} y2={lky} w={12} color={legColor} />
      <Seg x1={lkx}  y1={lky}  x2={lfx} y2={lfy} w={10} color={legColor} />
      <Jnt cx={lhx}  cy={lhy}  r={8} grad={highlight === "leadLeg" ? "jgB" : "jg"} />
      <Jnt cx={lkx}  cy={lky}  r={7.5} grad={highlight === "leadLeg" ? "jgB" : "jg"} />
      <Jnt cx={lfx}  cy={lfy}  r={5.5} />

      {/* ── Spine / torso ── */}
      <Seg x1={pelCx} y1={pelCy} x2={shCx} y2={shCy} w={8} color={torsoColor} />

      {/* ── Ribcage (optional) ── */}
      {showRibcage && (
        <ellipse
          cx={114} cy={68}
          rx={14} ry={17}
          fill="none"
          stroke={BONE_DK} strokeWidth={1.2}
          opacity={0.5}
        />
      )}

      {/* ── Shoulder girdle ── */}
      <Seg x1={lShx} y1={lShy} x2={rShx} y2={rShy} w={7} color={BONE} dimmed={dimArms} />

      {/* ── Glove / lead arm ── */}
      <Seg x1={lShx} y1={lShy} x2={lElx} y2={lEly} w={8}  color={BONE} dimmed={dimArms} />
      <Seg x1={lElx} y1={lEly} x2={lHndX} y2={lHndY} w={6} color={BONE} dimmed={dimArms} />
      <Jnt cx={lElx} cy={lEly}   r={5.5} />
      <Jnt cx={lHndX} cy={lHndY} r={4} />

      {/* ── Throw arm ── */}
      <Seg x1={rShx} y1={rShy} x2={rElx} y2={rEly} w={8}  color={armColor} dimmed={dimArms} />
      <Seg x1={rElx} y1={rEly} x2={rHndX} y2={rHndY} w={6} color={armColor} dimmed={dimArms} />
      <Jnt cx={rElx} cy={rEly}   r={5.5} grad={highlight === "arm" ? "jgY" : "jg"} />
      <Jnt cx={rHndX} cy={rHndY} r={4}  grad={highlight === "arm" ? "jgY" : "jg"} />

      {/* ── Shoulder joints ── */}
      <Jnt cx={lShx} cy={lShy} r={6} />
      <Jnt cx={rShx} cy={rShy} r={6} grad={highlight === "arm" ? "jgY" : "jg"} />
      <Jnt cx={pelCx} cy={pelCy} r={6} />

      {/* ── Head ── */}
      <ellipse
        cx={hx} cy={hy}
        rx={12} ry={13}
        fill={BG2} stroke={BONE} strokeWidth={2}
      />
      <ellipse
        cx={hx - 2} cy={hy - 3}
        rx={5} ry={6}
        fill="rgba(200,220,240,0.12)"
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGRAMS
// ─────────────────────────────────────────────────────────────────────────────

/** Lead Leg Block & Ground Reaction Force */
function LeadLegGrfDiagram() {
  const gnd = 178;

  return (
    <D w={240} h={192}>
      {/* Ground */}
      <line x1={28} y1={gnd} x2={212} y2={gnd} stroke={BDR} strokeWidth={1.5} />
      <rect x={28} y={gnd} width={184} height={6} fill={MUT} opacity={0.25} rx={1} />

      {/* ── Body figure ── */}
      <PitcherFootPlant highlight="leadLeg" />

      {/* ── YELLOW AXIS: GRF vector, upward from lead foot ── */}
      {/* Shadow under foot */}
      <ellipse cx={65} cy={179} rx={14} ry={4} fill="rgba(251,191,36,0.15)" />
      <Axis
        x1={65} y1={174}
        x2={65} y2={82}
        color={YLW} markerId="ay" width={3.5} glow
      />
      <Lbl x={50} y={128} s="GRF" fill={YLW} size={10} weight="700" anchor="middle" />

      {/* ── BLUE AXIS: Knee flexion arc reference ── */}
      {/* Thigh axis line (through femur) */}
      <Axis
        x1={106} y1={98}
        x2={82}  y2={136}
        color={BLU} markerId="ab" width={2.5}
      />
      {/* Shin axis (from knee through tibia) */}
      <line x1={82} y1={136} x2={65} y2={178} stroke={BLU} strokeWidth={2} strokeDasharray="4,3" opacity={0.6} />

      {/* Knee angle arc */}
      <path
        d={arcP(82, 136, 24, 100, 152)}
        fill="rgba(59,130,246,0.12)"
        stroke={BLU}
        strokeWidth={2}
      />
      <Lbl x={112} y={148} s="θ" fill={BLU} size={12} weight="700" anchor="middle" />

      {/* Labels */}
      <Lbl x={120} y={14} s="LEAD LEG BLOCK + GRF" fill={DIM} size={8.5} weight="600" />
      <Lbl x={65}  y={188} s="Lead Foot" fill={DIM} size={7.5} anchor="middle" />

      {/* +/− guide */}
      <rect x={150} y={90} width={76} height={52} rx={5} fill={BG2} opacity={0.9} />
      <Lbl x={188} y={105} s="+ More GRF" fill={GRN} size={8} weight="600" />
      <Lbl x={188} y={116} s="= Better Force" fill={DIM} size={7.5} />
      <Lbl x={188} y={131} s="+ Knee Ext." fill={YLW} size={8} weight="600" />
      <Lbl x={188} y={142} s="= Stronger Block" fill={DIM} size={7.5} />
    </D>
  );
}

/** Hip-Shoulder Separation — top-down with colored axis vectors */
function HipShoulderSeparationDiagram() {
  const cx = 118, cy = 96;
  const toR = (d: number) => (d * Math.PI) / 180;

  // Pelvis axis: rotated open ~22° from horizontal toward home plate (left)
  const pelvisAngle = -22;
  const pLen = 56;
  const px1 = cx + pLen * Math.cos(toR(pelvisAngle + 180));
  const py1 = cy + pLen * Math.sin(toR(pelvisAngle + 180));
  const px2 = cx + pLen * Math.cos(toR(pelvisAngle));
  const py2 = cy + pLen * Math.sin(toR(pelvisAngle));

  // Shoulder axis: more closed ~12° from horizontal
  const shoulderAngle = 12;
  const sLen = 44;
  const sx1 = cx + sLen * Math.cos(toR(shoulderAngle + 180));
  const sy1 = cy + sLen * Math.sin(toR(shoulderAngle + 180));
  const sx2 = cx + sLen * Math.cos(toR(shoulderAngle));
  const sy2 = cy + sLen * Math.sin(toR(shoulderAngle));

  // Separation arc
  const arcR = 32;

  return (
    <D w={240} h={172}>
      <Lbl x={120} y={14} s="HIP–SHOULDER SEPARATION (top-down)" fill={DIM} size={8.5} weight="600" />

      {/* Movement direction indicator */}
      <Lbl x={26} y={cy - 4} s="⌂" fill={MUT} size={14} anchor="middle" />
      <line x1={36} y1={cy} x2={54} y2={cy} stroke={MUT} strokeWidth={1} strokeDasharray="3,2" />
      <Lbl x={26} y={cy + 14} s="Home" fill={MUT} size={7} anchor="middle" />

      {/* Body spine (from above) */}
      <line x1={cx} y1={cy - 56} x2={cx} y2={cy + 56} stroke={MUT} strokeWidth={1} strokeDasharray="5,3" />

      {/* Ribcage outline from above */}
      <ellipse
        cx={cx} cy={cy - 10}
        rx={22} ry={16}
        fill={BG2} stroke={BONE_DK} strokeWidth={1.2} opacity={0.55}
      />
      {/* Pelvis from above */}
      <ellipse
        cx={cx} cy={cy + 16}
        rx={18} ry={10}
        fill={BG2} stroke={BONE_DK} strokeWidth={1.2} opacity={0.55}
      />

      {/* ── BLUE AXIS: Pelvis rotation vector ── */}
      <Axis x1={px1} y1={py1} x2={px2} y2={py2} color={BLU} markerId="ab" width={3.5} glow />
      <Axis x1={px2} y1={py2} x2={px1} y2={py1} color={BLU} markerId="ab" width={3.5} />
      {/* Hip joint dots */}
      <Jnt cx={px1} cy={py1} r={5.5} grad="jgB" />
      <Jnt cx={px2} cy={py2} r={5.5} grad="jgB" />
      <Lbl x={px1 - 4} y={py1 + 13} s="Pelvis" fill={BLU} size={8.5} weight="600" />

      {/* ── YELLOW AXIS: Shoulder rotation vector ── */}
      <Axis x1={sx1} y1={sy1} x2={sx2} y2={sy2} color={YLW} markerId="ay" width={3} glow />
      <Axis x1={sx2} y1={sy2} x2={sx1} y2={sy1} color={YLW} markerId="ay" width={3} />
      {/* Shoulder joint dots */}
      <Jnt cx={sx1} cy={sy1} r={5} grad="jgY" />
      <Jnt cx={sx2} cy={sy2} r={5} grad="jgY" />
      <Lbl x={sx2 + 4} y={sy2 + 12} s="Shoulders" fill={YLW} size={8.5} weight="600" anchor="start" />

      {/* Separation arc (between the two axes) */}
      <path
        d={arcP(cx, cy, arcR, pelvisAngle, shoulderAngle)}
        fill="rgba(34,197,94,0.12)"
        stroke={GRN}
        strokeWidth={2.5}
        strokeDasharray="3,2"
      />
      <Lbl x={cx + arcR + 12} y={cy - 4} s="HSS" fill={GRN} size={11} weight="700" anchor="start" />

      {/* Spine center */}
      <Jnt cx={cx} cy={cy} r={5.5} />

      {/* + guide */}
      <Lbl x={120} y={162} s="+ Larger angle = more elastic energy stored" fill={DIM} size={7.5} />
    </D>
  );
}

/** Horizontal Abduction (Scap Load) — top-down overhead view */
function HorizontalAbductionDiagram() {
  const cx = 120, cy = 88;
  const toR = (d: number) => (d * Math.PI) / 180;

  // Throw arm trailing behind body (positive abduction = more behind)
  const throwDeg = 36;  // degrees below horizontal = trailing behind
  const armLen   = 58;

  const throwX = cx + armLen * Math.cos(toR(throwDeg));
  const throwY = cy + armLen * Math.sin(toR(throwDeg));

  // Neutral position (arm straight out to the side = 0°)
  const neutX = cx + armLen * Math.cos(toR(0));
  const neutY = cy + armLen * Math.sin(toR(0));

  // Lead arm forward-left
  const leadDeg = 202;
  const leadLen  = 46;
  const leadX = cx + leadLen * Math.cos(toR(leadDeg));
  const leadY = cy + leadLen * Math.sin(toR(leadDeg));

  return (
    <D w={240} h={172}>
      <Lbl x={120} y={14} s="HORIZONTAL ABDUCTION (top-down)" fill={DIM} size={8.5} weight="600" />

      {/* Pitcher motion direction */}
      <Lbl x={cx} y={28} s="⌂  Home Plate" fill={MUT} size={8} anchor="middle" />
      <line x1={cx} y1={32} x2={cx} y2={46} stroke={MUT} strokeWidth={1} strokeDasharray="3,2" markerEnd="url(#aw)" />

      {/* Body midline */}
      <line x1={cx} y1={46} x2={cx} y2={cy + 48} stroke={MUT} strokeWidth={1} strokeDasharray="5,3" />
      <Lbl x={cx + 4} y={cy + 54} s="Body line" fill={MUT} size={7} anchor="start" />

      {/* Torso / body oval from above */}
      <ellipse
        cx={cx} cy={cy}
        rx={18} ry={30}
        fill={BG2} stroke={BONE_DK} strokeWidth={1.5} opacity={0.6}
      />

      {/* Lead arm (glove, forward) */}
      <Seg x1={cx} y1={cy - 8} x2={leadX} y2={leadY} w={8} color={BONE} />
      <Jnt cx={leadX} cy={leadY} r={5} />
      <Lbl x={leadX - 3} y={leadY + 12} s="Glove" fill={DIM} size={7.5} anchor="middle" />

      {/* Neutral arm dashed reference */}
      <line
        x1={cx} y1={cy - 8}
        x2={neutX} y2={cy - 8}
        stroke={DIM} strokeWidth={1.8} strokeDasharray="4,3"
      />
      <Lbl x={neutX + 4} y={cy - 10} s="Neutral" fill={DIM} size={7.5} anchor="start" />

      {/* Abduction arc */}
      <path
        d={arcP(cx, cy - 8, 34, 0, throwDeg)}
        fill="rgba(251,191,36,0.1)"
        stroke={YLW}
        strokeWidth={2}
      />

      {/* ── YELLOW AXIS: Throw arm trailing ── */}
      <Axis
        x1={cx} y1={cy - 8}
        x2={throwX} y2={throwY + 4}
        color={YLW} markerId="ay" width={4} glow
      />
      <Jnt cx={throwX} cy={throwY + 4} r={6} grad="jgY" />
      <Lbl x={throwX + 5} y={throwY + 6} s="Throw Arm" fill={YLW} size={8.5} weight="600" anchor="start" />

      {/* Shoulder joint */}
      <Jnt cx={cx} cy={cy - 8} r={7} />

      {/* +/− labels */}
      <Lbl x={throwX + 8}  y={throwY + 22} s="+ More Trailing" fill={GRN} size={8} weight="600" anchor="start" />
      <Lbl x={cx + 38} y={cy - 20} s="− Less Trailing" fill={RED} size={8} anchor="start" />

      <Lbl x={120} y={162} s="Arm trailing body @ foot plant = scap loaded" fill={DIM} size={7.5} />
    </D>
  );
}

/** Shoulder External Rotation — arm detail with layback arc and timing bar */
function ShoulderExternalRotationDiagram() {
  // Torso block
  const sjx = 85, sjy = 65; // shoulder joint

  // Upper arm pointing down-forward at foot plant
  const elx = 112, ely = 102; // elbow

  // Forearm at MAX external rotation (layback — pointing back and up)
  const erx = 156, ery = 76; // hand at max ER
  // Forearm neutral (pointing straight up from elbow)
  const nx = 112, ny = 60; // neutral hand position

  return (
    <D w={240} h={186}>
      <Lbl x={120} y={14} s="SHOULDER EXTERNAL ROTATION" fill={DIM} size={8.5} weight="600" />

      {/* Torso/shoulder block */}
      <rect x={38} y={32} width={52} height={44} rx={7} fill={BG2} stroke={BONE_DK} strokeWidth={2} />
      {/* Ribcage hint */}
      <ellipse cx={64} cy={54} rx={16} ry={18} fill="none" stroke={BONE_DK} strokeWidth={1} opacity={0.4} />
      <Lbl x={64} y={58} s="Torso" fill={DIM} size={8.5} />

      {/* Shoulder joint */}
      <Jnt cx={sjx} cy={sjy} r={8} />

      {/* ── Upper arm (humerus) ── */}
      <Seg x1={sjx} y1={sjy} x2={elx} y2={ely} w={11} color={BONE} />
      <Jnt cx={elx} cy={ely} r={7} grad="jgY" />

      {/* Neutral forearm reference (dashed) */}
      <line
        x1={elx} y1={ely}
        x2={nx}  y2={ny}
        stroke={DIM} strokeWidth={2} strokeDasharray="4,3"
      />
      <Jnt cx={nx} cy={ny} r={4} />
      <Lbl x={nx - 4} y={ny - 6} s="Neutral" fill={DIM} size={7.5} anchor="end" />

      {/* ── YELLOW AXIS: Forearm at max ER ── */}
      <Axis x1={elx} y1={ely} x2={erx} y2={ery} color={YLW} markerId="ay" width={4} glow />
      <Jnt cx={erx} cy={ery} r={5.5} grad="jgY" />
      <Lbl x={erx + 5} y={ery + 2} s="Hand" fill={YLW} size={8.5} weight="600" anchor="start" />

      {/* ER arc between neutral and max ER */}
      <path
        d={arcP(elx, ely, 28, -104, -46)}
        fill="rgba(251,191,36,0.12)"
        stroke={YLW}
        strokeWidth={2.5}
      />
      <Lbl x={elx + 32} y={ely - 28} s="Max ER" fill={YLW} size={9} weight="700" anchor="middle" />
      <Lbl x={elx + 32} y={ely - 16} s="≥ 180°" fill={GRN} size={9} anchor="middle" />

      {/* ── Arm timing zone bar ── */}
      <rect x={18} y={115} width={202} height={56} rx={6} fill={BG2} stroke={BDR} strokeWidth={1} />
      <Lbl x={119} y={129} s="Arm Timing @ Foot Plant" fill={DIM} size={8} weight="600" />
      {/* LATE */}
      <rect x={22}  y={133} width={56}  height={32} rx={4} fill="rgba(239,68,68,0.18)" />
      <Lbl x={50}  y={150} s="LATE"    fill={RED} size={8.5} weight="700" />
      <Lbl x={50}  y={161} s="< 33°"   fill={DIM} size={7.5} />
      {/* ON TIME */}
      <rect x={82}  y={133} width={74}  height={32} rx={4} fill="rgba(34,197,94,0.18)" />
      <Lbl x={119} y={150} s="ON TIME" fill={GRN} size={8.5} weight="700" />
      <Lbl x={119} y={161} s="33 – 77°" fill={DIM} size={7.5} />
      {/* EARLY */}
      <rect x={160} y={133} width={56}  height={32} rx={4} fill="rgba(239,68,68,0.18)" />
      <Lbl x={188} y={150} s="EARLY"   fill={RED} size={8.5} weight="700" />
      <Lbl x={188} y={161} s="> 77°"   fill={DIM} size={7.5} />
    </D>
  );
}

/** Kinematic Sequence — colored body segments with numbered flow */
function KinematicSequenceDiagram() {
  const gnd = 176;

  // Segment colors
  const seg = {
    pelvis: "#3b82f6",
    torso:  "#06b6d4",
    arm:    "#fbbf24",
    hand:   "#f97316",
  };

  // Key joints — pitcher at release, facing left
  const lfx = 64,  lfy = gnd;
  const lkx = 80,  lky = 138;
  const lhx = 104, lhy = 102;

  const rhx = 122, rhy = 98;
  const trkx = 148, trky = 124;
  const trfx = 164, trfy = gnd - 12;

  const pelCx = 113, pelCy = 100;
  const shCx  = 116, shCy  = 56;
  const hx    = 117, hy    = 34;

  // Throw arm near release
  const rShx = 130, rShy = 54;
  const relx = 160, rely = 40;
  const rHndX = 186, rHndY = 28;

  // Glove arm
  const lShx = 102, lShy = 55;
  const lElx = 78,  lEly = 68;

  return (
    <D w={240} h={192}>
      {/* Legend */}
      <rect x={6} y={5} width={228} height={17} rx={4} fill="rgba(0,0,0,0.3)" />
      <circle cx={20}  cy={13.5} r={4} fill={seg.pelvis} />
      <Lbl x={26}  y={17.5} s="Pelvis ①" size={8}   fill={seg.pelvis} anchor="start" />
      <circle cx={84}  cy={13.5} r={4} fill={seg.torso} />
      <Lbl x={90}  y={17.5} s="Torso ②"  size={8}   fill={seg.torso}  anchor="start" />
      <circle cx={148} cy={13.5} r={4} fill={seg.arm} />
      <Lbl x={154} y={17.5} s="Arm ③"    size={8}   fill={seg.arm}    anchor="start" />
      <circle cx={196} cy={13.5} r={4} fill={seg.hand} />
      <Lbl x={202} y={17.5} s="④"        size={8}   fill={seg.hand}   anchor="start" />

      {/* Ground */}
      <line x1={32} y1={gnd} x2={210} y2={gnd} stroke={BDR} strokeWidth={1.5} />
      <rect x={32} y={gnd} width={178} height={5} fill={MUT} opacity={0.2} rx={1} />

      {/* Trail leg (muted) */}
      <Seg x1={rhx} y1={rhy} x2={trkx} y2={trky} w={11} color={BONE_DK} />
      <Seg x1={trkx} y1={trky} x2={trfx} y2={trfy} w={9}  color={BONE_DK} />
      <Jnt cx={trkx} cy={trky} r={6.5} />
      <Jnt cx={trfx} cy={trfy} r={5} />

      {/* Lead leg (muted) */}
      <Seg x1={lhx} y1={lhy} x2={lkx} y2={lky} w={11} color={BONE_DK} />
      <Seg x1={lkx} y1={lky} x2={lfx} y2={lfy} w={9}  color={BONE_DK} />
      <Jnt cx={lkx} cy={lky} r={6.5} />
      <Jnt cx={lfx} cy={lfy} r={5} />

      {/* Glove arm (muted) */}
      <Seg x1={lShx} y1={lShy} x2={lElx} y2={lEly} w={7} color={BONE_DK} />
      <Jnt cx={lElx} cy={lEly} r={5} />

      {/* ── SEGMENT 1: PELVIS ── */}
      <Seg x1={lhx} y1={lhy} x2={rhx} y2={rhy} w={13} color={seg.pelvis} />
      {/* Pelvis rotation arc */}
      <path d={arcP(pelCx, pelCy, 18, 50, 100)} fill="none" stroke={seg.pelvis} strokeWidth={2} strokeDasharray="2,2" />
      <Jnt cx={pelCx} cy={pelCy} r={7} grad="jgB" />
      <Lbl x={pelCx - 24} y={pelCy + 18} s="①" size={12} fill={seg.pelvis} weight="700" />

      {/* ── SEGMENT 2: TORSO ── */}
      <Seg x1={pelCx} y1={pelCy} x2={shCx} y2={shCy} w={10} color={seg.torso} />
      {/* Ribcage hint */}
      <ellipse cx={114} cy={74} rx={13} ry={17} fill="none" stroke={seg.torso} strokeWidth={1} opacity={0.4} />
      {/* Torso rotation arc */}
      <path d={arcP(shCx, shCy, 14, -175, -110)} fill="none" stroke={seg.torso} strokeWidth={2} strokeDasharray="2,2" />
      <Jnt cx={shCx} cy={shCy} r={6} />
      <Lbl x={shCx - 18} y={shCy - 7} s="②" size={12} fill={seg.torso} weight="700" />

      {/* ── Shoulder bar ── */}
      <Seg x1={lShx} y1={lShy} x2={rShx} y2={rShy} w={7} color={BONE_DK} />

      {/* ── SEGMENT 3: UPPER ARM ── */}
      <Seg x1={rShx} y1={rShy} x2={relx} y2={rely} w={10} color={seg.arm} />
      {/* Arm rotation arc */}
      <path d={arcP(relx, rely, 12, -175, -120)} fill="none" stroke={seg.arm} strokeWidth={1.8} strokeDasharray="2,2" />
      <Jnt cx={rShx} cy={rShy} r={6}   grad="jgY" />
      <Jnt cx={relx} cy={rely} r={6.5} grad="jgY" />
      <Lbl x={rShx + 14} y={rShy - 10} s="③" size={12} fill={seg.arm} weight="700" />

      {/* ── SEGMENT 4: FOREARM / HAND ── */}
      <Seg x1={relx} y1={rely} x2={rHndX} y2={rHndY} w={8} color={seg.hand} />
      <Jnt cx={rHndX} cy={rHndY} r={6.5} />
      {/* Ball */}
      <circle cx={rHndX + 12} cy={rHndY - 4} r={7.5} fill="none" stroke={seg.hand} strokeWidth={2} strokeDasharray="2,2" />
      <Lbl x={rHndX + 16} y={rHndY - 8} s="④" size={12} fill={seg.hand} weight="700" />

      {/* ── Head ── */}
      <ellipse cx={hx} cy={hy} rx={12} ry={13} fill={BG2} stroke={BONE} strokeWidth={2} />
      <ellipse cx={hx - 2} cy={hy - 3} rx={5} ry={6} fill="rgba(200,220,240,0.10)" />

      {/* Flow caption */}
      <Lbl x={120} y={186} s="Ground → Pelvis → Torso → Arm → Ball" fill={DIM} size={7.5} />
    </D>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map of sectionId → diagram component.
 * Sections not listed here return null (no diagram shown).
 */
const DIAGRAM_MAP: Record<string, () => React.ReactElement> = {
  "lead-leg-grf":               LeadLegGrfDiagram,
  "hip-shoulder-separation":    HipShoulderSeparationDiagram,
  "horizontal-abduction":       HorizontalAbductionDiagram,
  "shoulder-external-rotation": ShoulderExternalRotationDiagram,
  "kinematic-sequence":         KinematicSequenceDiagram,
};

/**
 * Returns true if a diagram exists for the given section ID.
 * Use this for conditional layout decisions — avoids the JSX-always-truthy pitfall.
 */
export function hasPitchingDiagram(sectionId: string): boolean {
  return sectionId in DIAGRAM_MAP;
}

/**
 * Renders an anatomical SVG diagram for the given pitching section.
 * Returns null if no diagram is defined — sections without diagrams
 * render their title/description at full width as normal.
 */
export function PitchingDiagram({ sectionId }: { sectionId: string }) {
  const Component = DIAGRAM_MAP[sectionId];
  if (!Component) return null;
  return <Component />;
}
