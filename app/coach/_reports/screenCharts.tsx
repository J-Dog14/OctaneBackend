"use client";

/**
 * SVG charts for the athletic screen report, drawn to match pdf_report.py
 * (panel #373e43, white axes, #2c99d4 population, red athlete marks).
 */

import type { BarPanel, HistBin, MovementPage, PowerCurves, Ring } from "@/lib/coach/athleticScreen/compute";

export const PANEL = "#373e43";
export const BLUE = "#2c99d4";
const GRID = "rgba(255,255,255,0.2)";
const AXIS = "#ffffff";
const TICK = { fill: "#ffffff", fontSize: 11 } as const;

type Scale = (v: number) => number;
const linear = (d0: number, d1: number, r0: number, r1: number): Scale => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function niceTicks(lo: number, hi: number, count = 6): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
const tickFmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v)}` : Math.abs(v) >= 10 ? `${+v.toFixed(1)}` : `${+v.toFixed(2)}`);

function Frame({
  w, h, m, title, xs, ys, xTicks, yTicks, xLabel, yLabel, children, yGrid = true, xGrid = false,
}: {
  w: number; h: number; m: { l: number; r: number; t: number; b: number }; title?: string;
  xs: Scale; ys: Scale; xTicks: number[]; yTicks: number[]; xLabel?: string; yLabel?: string;
  children: React.ReactNode; yGrid?: boolean; xGrid?: boolean;
}) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {title && (
        <text x={w / 2} y={18} textAnchor="middle" fill="#fff" fontSize={17} fontWeight={700}>
          {title}
        </text>
      )}
      <rect x={m.l} y={m.t} width={w - m.l - m.r} height={h - m.t - m.b} fill={PANEL} stroke={AXIS} strokeWidth={1} />
      {yGrid && yTicks.map((t) => <line key={`gy${t}`} x1={m.l} x2={w - m.r} y1={ys(t)} y2={ys(t)} stroke={GRID} />)}
      {xGrid && xTicks.map((t) => <line key={`gx${t}`} x1={xs(t)} x2={xs(t)} y1={m.t} y2={h - m.b} stroke={GRID} />)}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={xs(t)} y={h - m.b + 14} textAnchor="middle" {...TICK}>
          {tickFmt(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`y${t}`} x={m.l - 5} y={ys(t) + 4} textAnchor="end" {...TICK}>
          {tickFmt(t)}
        </text>
      ))}
      {xLabel && (
        <text x={(m.l + w - m.r) / 2} y={h - 4} textAnchor="middle" fill="#fff" fontSize={11}>
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text transform={`translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)`} textAnchor="middle" fill="#fff" fontSize={11}>
          {yLabel}
        </text>
      )}
      <svg x={m.l} y={m.t} width={w - m.l - m.r} height={h - m.t - m.b} overflow="hidden">
        <g transform={`translate(${-m.l} ${-m.t})`}>{children}</g>
      </svg>
    </svg>
  );
}

/** Population histogram with the athlete's mean (pink) and max/min (red) — pdf_report.bar_graph / slv_bar_graph. */
export function HistogramPanel({ panel }: { panel: BarPanel }) {
  const w = 560;
  const h = 300;
  const m = { l: 42, r: 10, t: 28, b: 26 };
  const bins: HistBin[] = panel.bins;
  if (!bins.length) return <EmptyPanel title={panel.label} text="No population data" />;
  const lines: Array<{ x: number; color: string; label: string }> = [];
  const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(panel.decimals));
  if (panel.left || panel.right) {
    if (panel.left?.mean) lines.push({ x: panel.left.mean, color: "#1a5f8a", label: `Left Mean: ${fmt(panel.left.mean)}` });
    if (panel.right?.mean) lines.push({ x: panel.right.mean, color: "#d62728", label: `Right Mean: ${fmt(panel.right.mean)}` });
  } else {
    if (panel.mean != null) lines.push({ x: panel.mean, color: "pink", label: `Mean: ${fmt(panel.mean)}` });
    if (panel.extreme != null) lines.push({ x: panel.extreme, color: "#d62728", label: `${panel.extremeLabel}: ${fmt(panel.extreme)}` });
  }
  const lo = Math.min(bins[0]!.x0, ...lines.map((l) => l.x));
  const hi = Math.max(bins[bins.length - 1]!.x1, ...lines.map((l) => l.x));
  const pad = (hi - lo) * 0.03;
  const xs = linear(lo - pad, hi + pad, m.l, w - m.r);
  const maxC = Math.max(...bins.map((b) => b.count));
  const ys = linear(0, maxC * 1.08, h - m.b, m.t);
  const summary = panel.left || panel.right
    ? [`Percentile (Mean):`, `L: ${Math.floor(panel.left?.percentile ?? 0)}th  R: ${Math.floor(panel.right?.percentile ?? 0)}th`]
    : [`Percentile: ${Math.floor(panel.percentile ?? 0)}th`, `Mean: ${fmt(panel.mean)}`, `${panel.extremeLabel}: ${fmt(panel.extreme)}`];
  return (
    <Frame w={w} h={h} m={m} title={panel.label} xs={xs} ys={ys} xTicks={niceTicks(lo, hi)} yTicks={niceTicks(0, maxC, 4)} yLabel="Frequency">
      {bins.map((b, i) => {
        const bw = (xs(b.x1) - xs(b.x0)) * 0.8;
        const cx = (xs(b.x0) + xs(b.x1)) / 2;
        return (
          <rect key={i} x={cx - bw / 2} y={ys(b.count)} width={bw} height={ys(0) - ys(b.count)} fill={BLUE} fillOpacity={0.6} stroke={BLUE} strokeWidth={0.5}>
            <title>{`${tickFmt(b.x0)}–${tickFmt(b.x1)}: ${b.count} athletes`}</title>
          </rect>
        );
      })}
      {lines.map((l) => (
        <line key={l.label} x1={xs(l.x)} x2={xs(l.x)} y1={m.t} y2={h - m.b} stroke={l.color} strokeWidth={2.5} strokeDasharray="7 5" opacity={0.9}>
          <title>{l.label}</title>
        </line>
      ))}
      <g fontSize={14} fill="#fff" textAnchor="end">
        {summary.map((t, i) => (
          <text key={t} x={w - m.r - 8} y={m.t + 18 + i * 17}>
            {t}
          </text>
        ))}
      </g>
      {(panel.left || panel.right) && (
        <g fontSize={11} fill="#fff">
          {lines.map((l, i) => (
            <g key={l.label} transform={`translate(${w - m.r - 150} ${m.t + 58 + i * 15})`}>
              <line x1={0} x2={18} y1={-4} y2={-4} stroke={l.color} strokeWidth={2.5} strokeDasharray="5 3" />
              <text x={24} y={0}>
                {l.label}
              </text>
            </g>
          ))}
        </g>
      )}
    </Frame>
  );
}

export function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ background: PANEL, border: "1px solid #fff", color: "rgba(255,255,255,0.7)", padding: 18, textAlign: "center", minHeight: 160 }}>
      <div style={{ fontWeight: 700, color: "#fff", marginBottom: 8 }}>{title}</div>
      {text}
    </div>
  );
}

/** pdf_report.fv_scatter / slv_fv_scatter. */
export function FvScatter({ fv }: { fv: MovementPage["fv"] }) {
  const w = 640;
  const h = 420;
  const m = { l: 50, r: 12, t: 28, b: 38 };
  const pts = fv.population;
  if (!pts.length) return <EmptyPanel title="Force–Velocity Scatter" text="No population data" />;
  const fx = [...pts.map((p) => p[0]), ...fv.athlete.map((a) => a.force)];
  const vy = [...pts.map((p) => p[1]), ...fv.athlete.map((a) => a.vel)];
  const [x0, x1] = [Math.min(...fx), Math.max(...fx)];
  const [y0, y1] = [Math.min(...vy), Math.max(...vy)];
  const px = (x1 - x0) * 0.04;
  const py = (y1 - y0) * 0.05;
  const xs = linear(x0 - px, x1 + px, m.l, w - m.r);
  const ys = linear(y0 - py, y1 + py, h - m.b, m.t);
  return (
    <Frame w={w} h={h} m={m} title="Force–Velocity Scatter" xs={xs} ys={ys} xTicks={niceTicks(x0, x1)} yTicks={niceTicks(y0, y1)} xLabel="Force @ PP (N)" yLabel="Vel @ PP (m/s)" xGrid>
      {pts.map(([f, v], i) => (
        <circle key={i} cx={xs(f)} cy={ys(v)} r={4.2} fill={BLUE} fillOpacity={0.4} />
      ))}
      {fv.meanForce != null && <line x1={xs(fv.meanForce)} x2={xs(fv.meanForce)} y1={m.t} y2={h - m.b} stroke="gray" strokeWidth={2} strokeDasharray="7 5" opacity={0.7} />}
      {fv.meanVel != null && <line x1={m.l} x2={w - m.r} y1={ys(fv.meanVel)} y2={ys(fv.meanVel)} stroke="gray" strokeWidth={2} strokeDasharray="7 5" opacity={0.7} />}
      {fv.athlete.map((a) => (
        <circle key={a.label} cx={xs(a.force)} cy={ys(a.vel)} r={7.5} fill={a.color} fillOpacity={0.9} stroke="#fff" strokeWidth={1.5}>
          <title>{`${a.label}: ${Math.round(a.force)} N · ${a.vel.toFixed(2)} m/s`}</title>
        </circle>
      ))}
      {fv.ppPercentile != null && (
        <g fontSize={12} fill="#fff" textAnchor="end">
          <text x={w - m.r - 8} y={m.t + 16}>PP Percentile:</text>
          <text x={w - m.r - 8} y={m.t + 31}>{`${Math.round(fv.ppPercentile)}th`}</text>
        </g>
      )}
      {fv.athlete.length > 1 && (
        <g fontSize={11} fill="#fff">
          {fv.athlete.map((a, i) => (
            <g key={a.label} transform={`translate(${m.l + 12} ${m.t + 16 + i * 16})`}>
              <circle cx={5} cy={-4} r={5} fill={a.color} stroke="#fff" />
              <text x={16} y={0}>{a.label}</text>
            </g>
          ))}
        </g>
      )}
    </Frame>
  );
}

const ringColor = (p: number) => (p < 33 ? "red" : p < 67 ? "yellow" : "limegreen");

/** pdf_report.joint_radial: percentile ring, counter-clockwise from the top. */
export function PercentileRing({ ring }: { ring: Ring }) {
  const size = 170;
  const c = size / 2;
  const r = 66;
  const p = ring.percentile / 100;
  const end = (Math.PI / 2) + p * 2 * Math.PI;
  const sx = c;
  const sy = c - r;
  const ex = c + r * Math.cos(end);
  const ey = c - r * Math.sin(end);
  const large = p > 0.5 ? 1 : 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: 190, height: "auto", display: "block", margin: "0 auto" }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#303030" strokeWidth={10} />
      {p >= 0.999 ? (
        <circle cx={c} cy={c} r={r} fill="none" stroke={ringColor(ring.percentile)} strokeWidth={20} opacity={0.9} />
      ) : p > 0 ? (
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 0 ${ex} ${ey}`} fill="none" stroke={ringColor(ring.percentile)} strokeWidth={20} opacity={0.9} />
      ) : null}
      <text x={c} y={c - 2} textAnchor="middle" fill="#fff" fontSize={30} fontWeight={700}>
        {Math.floor(ring.percentile)}
      </text>
      <text x={c} y={c + 22} textAnchor="middle" fill="#fff" fontSize={14}>
        {ring.value == null ? "—" : `${ring.value.toFixed(1)} ${ring.unit}`}
      </text>
      <title>{`${ring.side ? `${ring.side} leg ` : ""}${ring.label} @ peak power: ${Math.floor(ring.percentile)}th percentile`}</title>
    </svg>
  );
}

/** pdf_report.radar_chart / slv_radar_chart: 6 percentile axes, 20th–100th rings. */
export function ScreenRadar({ labels, series }: MovementPage["radar"]) {
  // Wide viewBox so the axis labels outside the circle never clip.
  const W = 680;
  const H = 470;
  const cx = W / 2;
  const cy = H / 2;
  const R = 160;
  const n = labels.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number) => [cx + R * v * Math.cos(ang(i)), cy + R * v * Math.sin(ang(i))] as const;
  const colors = series.length > 1 ? [["#d62728", 0.55], [BLUE, 0.55]] : [[BLUE, 0.25]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 620, height: "auto", display: "block", margin: "0 auto" }}>
      <circle cx={cx} cy={cy} r={R} fill={PANEL} stroke="#fff" />
      {[0.2, 0.4, 0.6, 0.8].map((v) => (
        <circle key={v} cx={cx} cy={cy} r={R * v} fill="none" stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
      ))}
      {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <text key={v} x={cx + 4} y={cy - R * v + 10} fill="#fff" fontSize={9}>
          {`${Math.round(v * 100)}th`}
        </text>
      ))}
      {labels.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />;
      })}
      {series.map((s, si) => {
        const [col, op] = colors[si] ?? colors[0]!;
        const poly = s.values.map((v, i) => pt(i, v).join(",")).join(" ");
        const stroke = series.length > 1 ? (col as string) : BLUE;
        const fill = series.length > 1 ? (col as string) : "#d62728";
        return (
          <g key={s.name}>
            <polygon points={poly} fill={fill} fillOpacity={op as number} stroke={stroke} strokeWidth={series.length > 1 ? 3 : 2.5} />
            {s.values.map((v, i) => {
              const [x, y] = pt(i, v);
              return (
                <circle key={i} cx={x} cy={y} r={3} fill={stroke}>
                  <title>{`${s.name} · ${labels[i]}: ${Math.round(v * 100)}th`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
      {labels.map((l, i) => {
        const [x, y] = pt(i, 1.14);
        const cos = Math.cos(ang(i));
        return (
          <text key={l} x={x} y={y + 4} textAnchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"} fill="#fff" fontSize={17}>
            {l}
          </text>
        );
      })}
      {series.length > 1 && (
        <g fontSize={11} fill="#fff">
          {series.map((s, i) => (
            <g key={s.name} transform={`translate(${W - 110} ${18 + i * 16})`}>
              <rect x={0} y={-9} width={14} height={10} fill={(colors[i] ?? colors[0]!)[0] as string} />
              <text x={20} y={0}>{s.name}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/** pdf_report.power_curve / slv_power_curve. */
export function PowerCurvePanel({ power }: { power: PowerCurves }) {
  const w = 640;
  const h = 300;
  const m = { l: 56, r: 12, t: 28, b: 36 };
  const slv = !!(power.left || power.right);
  const all = slv ? [...(power.left?.trials ?? []), ...(power.right?.trials ?? [])] : power.trials;
  const maxP = Math.max(1, ...all.flat());
  const minP = Math.min(0, ...all.flat());
  const xs = linear(0, 1, m.l, w - m.r);
  const ys = linear(minP, maxP * 1.05, h - m.b, m.t);
  const path = (c: number[]) => c.map((p, i) => `${i ? "L" : "M"}${xs(power.t[i]!).toFixed(1)},${ys(p).toFixed(1)}`).join("");
  const legend: Array<{ label: string; color: string }> = slv
    ? [...(power.left?.mean ? [{ label: "Left Mean", color: BLUE }] : []), ...(power.right?.mean ? [{ label: "Right Mean", color: "#ff0000" }] : [])]
    : [{ label: "Mean Power", color: "#ff0000" }, ...(power.rise ? [{ label: "10-90% rise", color: "#00ff00" }] : [])];
  return (
    <Frame w={w} h={h} m={m} title="Power Curve" xs={xs} ys={ys} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={niceTicks(minP, maxP, 5)} xLabel="Normalized Time" yLabel="Power (W)" xGrid>
      {all.map((c, i) => (
        <path key={i} d={path(c)} fill="none" stroke={BLUE} strokeWidth={1.5} strokeOpacity={0.6} strokeDasharray="6 4" />
      ))}
      {!slv && power.mean && <path d={path(power.mean)} fill="none" stroke="#ff0000" strokeWidth={3.5} />}
      {slv && power.left?.mean && <path d={path(power.left.mean)} fill="none" stroke={BLUE} strokeWidth={3.5} />}
      {slv && power.right?.mean && <path d={path(power.right.mean)} fill="none" stroke="#ff0000" strokeWidth={3.5} />}
      {!slv && power.rise && (
        <line x1={xs(power.rise.t10)} y1={ys(power.rise.p10)} x2={xs(power.rise.t90)} y2={ys(power.rise.p90)} stroke="#00ff00" strokeWidth={3} opacity={0.7} />
      )}
      <g fontSize={11} fill="#fff">
        <rect x={w - m.r - 128} y={m.t + 6} width={120} height={8 + legend.length * 15} fill={PANEL} stroke="#fff" />
        {legend.map((l, i) => (
          <g key={l.label} transform={`translate(${w - m.r - 120} ${m.t + 19 + i * 15})`}>
            <line x1={0} x2={18} y1={-4} y2={-4} stroke={l.color} strokeWidth={3} />
            <text x={24} y={0}>{l.label}</text>
          </g>
        ))}
      </g>
    </Frame>
  );
}
