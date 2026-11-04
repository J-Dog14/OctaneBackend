"use client";

/**
 * TM + 3D → Arm through release, "Solid" style (experimental): the throwing arm as solid bones in
 * WebGL (three.js), anchored on the arm markers frame by frame.
 *
 * Bones are simple solids, not anatomical meshes (no licensing question; swap in real meshes later):
 * - Humerus: shoulder joint center → elbow center, with a head and the two condyles. The shoulder
 *   marker sits on the acromion, so the joint center is taken ~2 in below it (approximate).
 * - Ulna: medial elbow → ulnar wrist marker. Radius: lateral elbow → radial wrist marker. Drawn
 *   separately, so pronation shows as the radius rolling over the ulna.
 * - Hand: palm from the wrist center to the hand marker, fingers and thumb in a fixed grip pose
 *   (one hand marker can't say what the fingers do). Lefties: the palm side is mirrored, which is
 *   the only place handedness matters for these symmetric shapes.
 *
 * Renders on demand (prop change or camera drag), not in a loop. three.js is only downloaded when
 * this view is opened (React.lazy in ArmFlightView).
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ArmTrial } from "@/lib/coach/armFlight/load";
import { poseAt } from "@/lib/coach/armFlight/pose";
import { PLATE_FRONT_FT, RUBBER_FT, flightAt, orbitBasis, spinAxisFromFlight, type Orbit, type V3 } from "@/lib/coach/armFlight/geometry";
import { SPIN_SLOW } from "./ballFlight";

const BONE = "#ece4d2";
const FOV = 35;
const ASPECT = 560 / 440;

// --- small vector helpers (field frame, ft) ---------------------------------
const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
const Y = new THREE.Vector3(0, 1, 0);

/** Put a unit-height, Y-aligned mesh between a and b (its +Y end at b). */
function between(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const len = Math.max(1e-4, d.length());
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y, d.divideScalar(len));
  m.scale.set(1, len, 1);
}

type Rig = {
  trial: ArmTrial;
  root: THREE.Group;
  parts: Record<string, THREE.Mesh>;
  fingers: Array<{ a: THREE.Mesh; b: THREE.Mesh; j: THREE.Mesh; tip: THREE.Mesh; off: number; len: number }>;
  thumb: { a: THREE.Mesh; b: THREE.Mesh; j: THREE.Mesh; tip: THREE.Mesh };
  palmLen: number;
  wristW: number;
  ball: THREE.Group;
  seam: THREE.Group;
  trail: THREE.Line;
  spinAxis: THREE.Vector3 | null;
  rpm: number | null;
};

function buildRig(t: ArmTrial, color: string, focused: boolean, many: boolean, geos: Geos): Rig {
  const faded = many && !focused;
  const mat = new THREE.MeshStandardMaterial({
    color: faded ? new THREE.Color(color).lerp(new THREE.Color(BONE), 0.35) : BONE,
    roughness: 0.55,
    metalness: 0.0,
    transparent: faded,
    opacity: faded ? 0.3 : 1,
    depthWrite: !faded,
  });
  const root = new THREE.Group();
  const mk = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, mat);
    root.add(m);
    return m;
  };
  // Sizes from this trial's own markers (first frame).
  const p0 = poseAt(t, t.frames[0]![0]);
  const wristW = v(p0.radius).distanceTo(v(p0.ulna));
  const palmLen = Math.max(0.18, v(p0.wrist).distanceTo(v(p0.hand)));
  const parts: Record<string, THREE.Mesh> = {
    humShaft: mk(geos.humShaft),
    humHead: mk(geos.humHead),
    condyles: mk(geos.condyles),
    ulna: mk(geos.ulna),
    olecranon: mk(geos.olecranon),
    radius: mk(geos.radius),
    radHead: mk(geos.radHead),
    palm: mk(geos.palm),
  };
  const seg = () => ({ a: mk(geos.finger), b: mk(geos.fingerTip), j: mk(geos.knuckle), tip: mk(geos.knuckle) });
  const fingers = [
    { off: -0.36, len: 0.92 }, // index (radial side)
    { off: -0.12, len: 1.0 },
    { off: 0.12, len: 0.95 },
    { off: 0.36, len: 0.76 }, // pinky
  ].map((f) => ({ ...seg(), ...f }));
  const thumb = seg();

  // Ball: white sphere + red seam, turned about the spin axis from the flight.
  const ball = new THREE.Group();
  const seam = new THREE.Group();
  ball.add(new THREE.Mesh(geos.ball, new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 0.6, transparent: faded, opacity: faded ? 0.5 : 1 })));
  seam.add(new THREE.Mesh(geos.seam, new THREE.MeshStandardMaterial({ color: "#c0392b", roughness: 0.6 })));
  ball.add(seam);
  root.add(ball);
  const trail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: faded ? 0.5 : 0.9 }),
  );
  root.add(trail);
  const axis = t.flight && t.tm ? spinAxisFromFlight(t.flight.path, t.tm.spinEff) : null;
  return { trial: t, root, parts, fingers, thumb, palmLen, wristW, ball, seam, trail, spinAxis: axis ? v(axis) : null, rpm: t.tm?.spinRate ?? null };
}

function poseRig(r: Rig, ms: number, ballMs: number, lefty: boolean) {
  const q = poseAt(r.trial, ms);
  const sh = v(q.shoulder);
  const eL = v(q.elbowLat);
  const eM = v(q.elbowMed);
  const eC = lerpV(eL, eM, 0.5);
  const wR = v(q.radius);
  const wU = v(q.ulna);
  const wC = lerpV(wR, wU, 0.5);
  const hand = v(q.hand);
  const P = r.parts;

  // Humerus. Joint center ~2 in below the acromion marker.
  const gh = sh.clone().add(new THREE.Vector3(0, 0, -0.16));
  between(P.humShaft!, gh, eC);
  P.humHead!.position.copy(gh);
  between(P.condyles!, lerpV(eM, eL, 0.08), lerpV(eL, eM, 0.08));
  // Ulna (medial) and radius (lateral), each pulled a little in from the skin markers.
  const uProx = lerpV(eM, eC, 0.35);
  const uDist = lerpV(wU, wC, 0.25);
  between(P.ulna!, uProx, uDist);
  P.olecranon!.position.copy(uProx);
  const rProx = lerpV(eL, eC, 0.3);
  const rDist = lerpV(wR, wC, 0.2);
  between(P.radius!, rProx, rDist);
  P.radHead!.position.copy(rProx);

  // Hand frame: y = wrist center → hand marker, x = radial → ulnar, z = palm side.
  const y = hand.clone().sub(wC).normalize();
  const x0 = wU.clone().sub(wR);
  const x = x0.sub(y.clone().multiplyScalar(x0.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).multiplyScalar(lefty ? 1 : -1);
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  P.palm!.position.copy(lerpV(wC, hand, 0.5));
  P.palm!.quaternion.setFromRotationMatrix(basis);
  P.palm!.scale.set(r.wristW * 1.15, r.palmLen, 1);
  const fingerLen = r.palmLen * 0.85;
  const dirAt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return y.clone().multiplyScalar(Math.cos(a)).add(z.clone().multiplyScalar(Math.sin(a)));
  };
  // Fixed grip: first segment 30° toward the palm, second 75°.
  for (const f of r.fingers) {
    const base = hand.clone().add(x.clone().multiplyScalar(f.off * r.wristW * 1.1));
    const L = fingerLen * f.len;
    const j1 = base.clone().addScaledVector(dirAt(30), L * 0.55);
    const tip = j1.clone().addScaledVector(dirAt(75), L * 0.45);
    between(f.a, base, j1);
    between(f.b, j1, tip);
    f.j.position.copy(j1);
    f.tip.position.copy(tip);
  }
  // Thumb: from the radial side of the wrist, toward the palm side and forward.
  const tb = wC.clone().addScaledVector(x, -0.45 * r.wristW).addScaledVector(y, r.palmLen * 0.2);
  const td = y.clone().multiplyScalar(0.55).add(z.clone().multiplyScalar(0.65)).add(x.clone().multiplyScalar(-0.2)).normalize();
  const tj = tb.clone().addScaledVector(td, r.palmLen * 0.45);
  const td2 = y.clone().multiplyScalar(0.75).add(z.clone().multiplyScalar(0.45)).add(x.clone().multiplyScalar(0.25)).normalize();
  const tt = tj.clone().addScaledVector(td2, r.palmLen * 0.32);
  between(r.thumb.a, tb, tj);
  between(r.thumb.b, tj, tt);
  r.thumb.j.position.copy(tj);
  r.thumb.tip.position.copy(tt);

  // Ball + trail (after release only), seam turned about the spin axis.
  const fl = r.trial.flight;
  if (fl && ballMs > 0) {
    r.ball.visible = true;
    r.ball.position.copy(v(flightAt(fl.path, ballMs)));
    if (r.spinAxis && r.rpm) {
      const ang = 2 * Math.PI * (r.rpm / 60) * (ballMs / 1000) * SPIN_SLOW;
      r.seam.quaternion.setFromAxisAngle(r.spinAxis, ang);
    }
    const pts: number[] = [];
    for (const p of fl.path) {
      if (p[0] >= ballMs) break;
      pts.push(p[1], p[2], p[3]);
    }
    const b = flightAt(fl.path, ballMs);
    pts.push(b[0], b[1], b[2]);
    r.trail.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    r.trail.geometry.computeBoundingSphere();
    r.trail.visible = pts.length >= 6;
  } else {
    r.ball.visible = false;
    r.trail.visible = false;
  }
}

type Geos = Record<"humShaft" | "humHead" | "condyles" | "ulna" | "olecranon" | "radius" | "radHead" | "palm" | "finger" | "fingerTip" | "knuckle" | "ball" | "seam", THREE.BufferGeometry>;

function makeGeos(): Geos {
  // Unit-height cylinders along +Y; radiusTop is the +Y (distal) end.
  const cyl = (top: number, bottom: number) => new THREE.CylinderGeometry(top, bottom, 1, 18, 1);
  const sphere = (r: number) => new THREE.SphereGeometry(r, 20, 14);
  // Seam: the tennis-ball curve on the ball's surface (axis = local Z, seam-free patches there).
  const k = 0.22;
  const c = 2 * Math.sqrt(k * (1 - k));
  const R = 0.121 * 1.01;
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 96 }, (_, i) => {
      const t = (2 * Math.PI * i) / 96;
      return new THREE.Vector3(((1 - k) * Math.cos(t) + k * Math.cos(3 * t)) * R, ((1 - k) * Math.sin(t) - k * Math.sin(3 * t)) * R, c * Math.sin(2 * t) * R);
    }),
    true,
  );
  return {
    humShaft: cyl(0.045, 0.06),
    humHead: sphere(0.085),
    condyles: cyl(0.05, 0.055),
    ulna: cyl(0.03, 0.055),
    olecranon: sphere(0.06),
    radius: cyl(0.05, 0.034),
    radHead: sphere(0.045),
    palm: new THREE.BoxGeometry(1, 1, 0.075),
    finger: cyl(0.026, 0.03),
    fingerTip: cyl(0.022, 0.026),
    knuckle: sphere(0.03),
    ball: sphere(0.121),
    seam: new THREE.TubeGeometry(curve, 160, 0.012, 6, true),
  };
}

/** Field context: ground lanes, center line, rubber, plate and zone (registered), or a local grid. */
function buildContext(registered: boolean, center: THREE.Vector3, zMin: number): THREE.Group {
  const g = new THREE.Group();
  const lines = (pts: number[], color: string, opacity: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
  };
  if (registered) {
    const grid: number[] = [];
    for (let x = -3; x <= 3; x++) grid.push(x, 0, 0, x, 63, 0);
    for (let y = 0; y <= 60; y += 5) grid.push(-3, y, 0, 3, y, 0);
    lines(grid, "#ffffff", 0.08);
    lines([0, PLATE_FRONT_FT, 0.002, 0, RUBBER_FT, 0.002], "#7fc8a9", 0.6);
    const plate = new THREE.Shape([
      new THREE.Vector2(-0.708, PLATE_FRONT_FT),
      new THREE.Vector2(0.708, PLATE_FRONT_FT),
      new THREE.Vector2(0.708, 0.708),
      new THREE.Vector2(0, 0),
      new THREE.Vector2(-0.708, 0.708),
    ]);
    const plateMesh = new THREE.Mesh(new THREE.ShapeGeometry(plate), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35 }));
    plateMesh.position.z = 0.003;
    g.add(plateMesh);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.02), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3 }));
    rubber.position.set(0, RUBBER_FT + 0.25, 0.01);
    g.add(rubber);
    const y = PLATE_FRONT_FT;
    const zone = [-0.83, 1.5, 0.83, 1.5, 0.83, 1.5, 0.83, 3.5, 0.83, 3.5, -0.83, 3.5, -0.83, 3.5, -0.83, 1.5];
    const thirds = [-0.83 / 3, 1.5, -0.83 / 3, 3.5, 0.83 / 3, 1.5, 0.83 / 3, 3.5, -0.83, 1.5 + 2 / 3, 0.83, 1.5 + 2 / 3, -0.83, 1.5 + 4 / 3, 0.83, 1.5 + 4 / 3];
    const toXYZ = (xs: number[]) => xs.flatMap((val, i) => (i % 2 === 0 ? [val] : [y, val]));
    lines(toXYZ(zone), "#ffffff", 0.5);
    lines(toXYZ(thirds), "#ffffff", 0.2);
  } else {
    const z0 = zMin - 0.25;
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    const grid: number[] = [];
    for (let k = -3; k <= 3; k++) grid.push(cx + k, cy - 3, z0, cx + k, cy + 3, z0, cx - 3, cy + k, z0, cx + 3, cy + k, z0);
    lines(grid, "#ffffff", 0.08);
  }
  return g;
}

export function ArmSkeleton3D({
  trials,
  focusKey,
  keyOf,
  colorOf,
  ms,
  ballMs,
  lefty,
  registered,
  orbit,
  zoom,
}: {
  trials: ArmTrial[];
  focusKey: string | null;
  keyOf: (t: ArmTrial) => string;
  colorOf: (t: ArmTrial) => string;
  ms: number;
  ballMs: number;
  lefty: boolean;
  registered: boolean;
  /** Camera direction (the view presets); the picture can also be dragged / scrolled freely. */
  orbit: Orbit;
  zoom: number;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const S = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    world: THREE.Group;
    geos: Geos;
    rigs: Rig[];
    center: THREE.Vector3;
    radius: number;
    cloud: THREE.Vector3[];
    render: () => void;
  } | null>(null);
  // Latest clock for the rebuild effect (kept in sync by the pose effect below).
  const clock = useRef({ ms, ballMs, lefty });

  // One-time setup.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.borderRadius = "8px";
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#ffffff", "#3a3f47", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-20, 40, 60);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.05, 400);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.zoomSpeed = 0.8;
    const world = new THREE.Group();
    scene.add(world);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const w = el.clientWidth || 560;
      renderer.setSize(w, w / ASPECT, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "auto";
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    S.current = { renderer, scene, camera, controls, world, geos: makeGeos(), rigs: [], center: new THREE.Vector3(), radius: 1, cloud: [], render };
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      S.current = null;
    };
  }, []);

  // Rebuild rigs + context when the pitches change.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    // Free the old rigs' materials and per-rig geometry (the shared bone shapes stay).
    const shared = new Set<THREE.BufferGeometry>(Object.values(s.geos));
    s.world.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
    s.world.clear();
    const many = trials.length > 1;
    // Focused last so it draws over the faded ones.
    const ordered = [...trials].sort((a, b) => Number(keyOf(a) === focusKey) - Number(keyOf(b) === focusKey));
    s.rigs = ordered.map((t) => buildRig(t, colorOf(t), keyOf(t) === focusKey, many, s.geos));
    for (const r of s.rigs) s.world.add(r.root);
    // Frame on elbow → hand over every frame (as the line view does).
    const box = new THREE.Box3();
    s.cloud = [];
    for (const t of trials) for (const f of t.frames) for (let k = 2; k <= 6; k++) s.cloud.push(v(f[k] as V3));
    for (const p of s.cloud) box.expandByPoint(p);
    box.getCenter(s.center);
    s.radius = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2);
    s.world.add(buildContext(registered, s.center, box.min.z));
    const { ms: m, ballMs: bm, lefty: lh } = clock.current;
    for (const r of s.rigs) poseRig(r, m, bm, lh);
    s.render();
  }, [trials, focusKey, keyOf, colorOf, registered]);

  // Camera from the view preset + zoom.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const b = orbitBasis(orbit);
    const r = v(b.r);
    const u = v(b.u);
    const f = new THREE.Vector3().crossVectors(u, r); // viewing direction
    // Fit the elbow → hand cloud from this angle (as the line view does): the camera distance that
    // keeps every point inside ~88% of the frame.
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180) * 0.88;
    const tanH = tanV * ASPECT;
    let fit = 1;
    for (const p of s.cloud) {
      const d = p.clone().sub(s.center);
      fit = Math.max(fit, Math.abs(d.dot(r)) / tanH - d.dot(f), Math.abs(d.dot(u)) / tanV - d.dot(f));
    }
    const dist = fit / zoom;
    s.camera.position.copy(s.center).addScaledVector(f, -dist);
    s.controls.target.copy(s.center);
    s.camera.near = Math.max(0.02, dist / 200);
    s.camera.updateProjectionMatrix();
    s.controls.update();
    s.render();
  }, [orbit, zoom, trials]);

  // Pose every frame of playback.
  useEffect(() => {
    const s = S.current;
    clock.current = { ms, ballMs, lefty };
    if (!s) return;
    for (const r of s.rigs) poseRig(r, ms, ballMs, lefty);
    s.render();
  }, [ms, ballMs, lefty]);

  return <div ref={host} style={{ width: "100%", aspectRatio: `${ASPECT}`, background: "rgba(255,255,255,0.02)", borderRadius: 8, cursor: "grab" }} />;
}
