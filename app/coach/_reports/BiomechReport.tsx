"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Group, Loader, Select, Text } from "@mantine/core";
import type { BiomechReport as Report } from "@/lib/coach/biomech/report";
import type { CylinderCard, CylinderPercentiles, Status } from "@/lib/coach/biomech/framework";
import { fmtDate, swrOpts } from "../_components/fetcher";
import s from "./biomechReport.module.css";

const STATUS: Record<Status, { bg: string; fg: string; label: string }> = {
  best: { bg: "#5FBF5F", fg: "#0A0A0A", label: "Elite" },
  good: { bg: "#7BC97B", fg: "#0A0A0A", label: "Strength" },
  warn: { bg: "#E8A04C", fg: "#0A0A0A", label: "Watch" },
  bad: { bg: "#E26464", fg: "#FFFFFF", label: "Flag" },
  neutral: { bg: "#6B7479", fg: "#FFFFFF", label: "—" },
};

function Chip({ status }: { status: Status }) {
  const c = STATUS[status];
  return (
    <span className={s.chip} style={{ background: c.bg, color: c.fg }}>
      {c.label}
    </span>
  );
}

const PB = "#B0E0E6";
const PB_DEEP = "#7BB4C7";
const PB_GLOW = "#D8EEF6";

/** 8-axis cohort-percentile radar, same geometry as the PDF's spider_svg. */
function SpiderChart({ pct, cards }: { pct: CylinderPercentiles | null; cards: CylinderCard[] }) {
  const size = 440;
  const padX = 160;
  const padY = 90;
  const w = size + padX * 2;
  const h = size + padY * 2;
  const cx = w / 2;
  const cy = h / 2;
  const R = size * 0.36;
  const angles = cards.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / cards.length);
  const val = (c: CylinderCard) => c.percentile ?? 0;
  const pts = cards.map((c, i) => [cx + R * (val(c) / 100) * Math.cos(angles[i]!), cy + R * (val(c) / 100) * Math.sin(angles[i]!)] as const);
  const ring = (p: number) => angles.map((a) => `${(cx + R * (p / 100) * Math.cos(a)).toFixed(1)},${(cy + R * (p / 100) * Math.sin(a)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cohort percentile by cylinder">
      {[
        [25, 0.1],
        [50, 0.18],
        [75, 0.1],
        [100, 0.25],
      ].map(([p, o]) => (
        <polygon key={p} points={ring(p!)} fill="none" stroke={PB} strokeOpacity={o} strokeWidth={1} />
      ))}
      {[25, 50, 75].map((p) => (
        <text key={p} x={cx + R * (p / 100) + 6} y={cy + 3} fill={PB_DEEP} fontSize={8} opacity={0.5}>
          {p}
        </text>
      ))}
      {angles.map((a, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} stroke={PB} strokeOpacity={0.18} />
      ))}
      {pct && (
        <>
          <polygon points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill={PB} fillOpacity={0.32} stroke={PB} strokeWidth={2} />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={4} fill={PB_GLOW} stroke="#0A0A0A" strokeWidth={1.5}>
              <title>{`Cyl ${cards[i]!.num} ${cards[i]!.name}: ${cards[i]!.percentile ?? "—"} %ile`}</title>
            </circle>
          ))}
        </>
      )}
      {cards.map((c, i) => {
        const a = angles[i]!;
        const lr = R + 38;
        const lx = cx + lr * Math.cos(a);
        const ly = cy + lr * Math.sin(a);
        const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        return (
          <g key={c.key} fontFamily="Inter, sans-serif">
            <text x={lx} y={ly} textAnchor={anchor} fill={PB} fontSize={9} fontWeight={600} letterSpacing="0.1em">
              CYL {c.num}
            </text>
            <text x={lx} y={ly + 12} textAnchor={anchor} fill="#F5F8FA" fontSize={11} fontWeight={700}>
              {c.short}
            </text>
            <text x={lx} y={ly + 26} textAnchor={anchor} fill={PB_GLOW} fontSize={14} fontWeight={800}>
              {c.percentile ?? "—"}
              <tspan fontSize={9} fill="#A8B5BD" fontWeight={500}>
                %ile
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const PRON_LABEL: Record<string, { text: string; cls: string; flag: string }> = {
  cut_risk: { text: "CUT RISK (delayed)", cls: "cutRisk", flag: "" },
  run_bias: { text: "RUN BIAS (early)", cls: "runBias", flag: "amber" },
  clean: { text: "CLEAN", cls: "", flag: "clean" },
};
const IR_LABEL: Record<string, { text: string; cls: string; flag: string }> = {
  cut_risk: { text: "CUT RISK", cls: "cutRisk", flag: "" },
  borderline: { text: "BORDERLINE", cls: "", flag: "amber" },
  clean: { text: "CLEAN", cls: "", flag: "clean" },
};

function heightText(inches: number | null): string | null {
  if (inches == null || !Number.isFinite(inches) || inches < 40) return null;
  const ft = Math.floor(inches / 12);
  return `${ft}'${Math.round(inches - ft * 12)}"`;
}

/** In-app version of the biomech-pitching-breakdown PDF, rebuilt from the warehouse on every load. */
export function BiomechReport({ athleteUuid }: { athleteUuid: string }) {
  const [date, setDate] = useState<string | null>(null);
  const key = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/biomech-report${date ? `?date=${date}` : ""}`;
  const { data: r, error, isLoading } = useSWR<Report>(key, { ...swrOpts, keepPreviousData: true });

  if (isLoading && !r) return <Loader size="sm" />;
  if (error && !r) return <Alert color="red">{error.message}</Alert>;
  if (!r) return null;

  const m = r.metrics;
  const v = m.velocity;
  const rp = m.releasePhase;
  const pron = rp.pronationFlag ? PRON_LABEL[rp.pronationFlag]! : null;
  const ir = rp.irFlag ? IR_LABEL[rp.irFlag]! : null;
  const size = [heightText(r.athlete.heightIn), r.athlete.weightLb ? `${Math.round(r.athlete.weightLb)} lb` : null].filter(Boolean).join(" / ");

  return (
    <div>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          8-Cylinder framework, rebuilt from the warehouse. Percentiles vs each pitcher&apos;s latest capture ({r.cohortN} pitchers).
        </Text>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Select
            size="xs"
            w={190}
            data={r.sessions.map((d) => ({ value: d, label: `Capture ${fmtDate(d)}` }))}
            value={r.sessionDate}
            onChange={(d) => d && setDate(d)}
            allowDeselect={false}
          />
        </Group>
      </Group>

      <div className={s.report}>
        {/* COVER */}
        <div className={s.cover}>
          <div className={s.coverRule} />
          <div className={s.brand}>8ctane · Biomechanics Report</div>
          <h1 className={s.name}>{r.athlete.name}</h1>
          <div className={s.tagline}>{r.athlete.handed === "LHP" ? "Left-Handed Pitcher" : r.athlete.handed === "RHP" ? "Right-Handed Pitcher" : "Pitcher"}</div>
          <div className={s.coverMain}>
            <div>
              <div className={s.veloNum}>{v.mean != null ? v.mean.toFixed(1) : "—"}</div>
              <div className={s.veloLabel}>Mean Fastball — MPH</div>
            </div>
            <div className={s.overall}>
              <div className={s.overallNum}>{r.percentiles?.overall ?? "—"}</div>
              <div>
                <div className={s.overallPct}>Overall %ile</div>
                <div className={s.overallSub}>vs cohort (n={r.cohortN})</div>
              </div>
            </div>
          </div>
          <div className={s.stats}>
            <div>
              <div className={s.statLabel}>Age</div>
              <div className={s.statValue}>{r.athlete.age ?? "—"}</div>
            </div>
            <div>
              <div className={s.statLabel}>Height / Weight</div>
              <div className={s.statValue}>{size || "—"}</div>
            </div>
            <div>
              <div className={s.statLabel}>Test Date</div>
              <div className={s.statValue}>{fmtDate(r.sessionDate)}</div>
            </div>
            <div>
              <div className={s.statLabel}>Captures</div>
              <div className={s.statValue}>{v.throws.length} fastballs</div>
            </div>
          </div>
          <div className={s.coverRuleBottom} />
          <div className={s.coverFooter}>
            <b>B_Young Biomechanics</b> · Qualisys · Visual3D · 8-Cylinder Framework
          </div>
        </div>

        {r.read.flags.map((f) => (
          <div key={f} className={s.flag}>
            <b>Capture note</b>
            {f}
          </div>
        ))}

        {(rp.pronationOffsetMs != null || rp.pctIrBeforeRelease != null) && (
          <div className={s.releasePhase}>
            <div className={`${s.rpCell} ${pron?.cls ? s[pron.cls] : ""}`}>
              <div className={s.rpLabel}>Pronation Vel Offset</div>
              <div className={s.rpValue}>{rp.pronationOffsetMs != null ? `${rp.pronationOffsetMs >= 0 ? "+" : ""}${Math.round(rp.pronationOffsetMs)} ms` : "—"}</div>
              <div className={s.rpMeta}>+25 to +50 ms is clean · &gt; 60 delayed = cut · &lt; 0 early = run</div>
              {pron && <div className={`${s.rpFlag} ${pron.flag ? s[pron.flag] : ""}`}>{pron.text}</div>}
            </div>
            <div className={`${s.rpCell} ${ir?.cls ? s[ir.cls] : ""}`}>
              <div className={s.rpLabel}>% IR Before Release</div>
              <div className={s.rpValue}>{rp.pctIrBeforeRelease != null ? `${Math.round(rp.pctIrBeforeRelease)}%` : "—"}</div>
              <div className={s.rpMeta}>&lt; 50% is clean · 50–55% borderline · &gt; 55% flags cut</div>
              {ir && <div className={`${s.rpFlag} ${ir.flag ? s[ir.flag] : ""}`}>{ir.text}</div>}
            </div>
          </div>
        )}

        {/* 01 PROFILE */}
        <div className={s.section}>
          <div className={s.sectionHead}>01 — Profile Snapshot</div>
          <div className={s.sectionTitle}>Cohort Position</div>
          <div className={s.radarWrap}>
            <SpiderChart pct={r.percentiles} cards={r.cards} />
            {!r.percentiles && <Text size="sm" c="dimmed">Not enough pitchers in the database yet for percentiles.</Text>}
            <div>
              <div className={s.pill}>
                <span className={s.pillNum}>{r.percentiles?.overall ?? "—"}</span>
                <span className={s.pillLabel}>Overall Percentile</span>
              </div>
            </div>
          </div>
        </div>

        {/* 02 SUMMARY */}
        <div className={s.section}>
          <div className={s.sectionHead}>02 — Session Summary</div>
          <div className={s.sectionTitle}>The Read</div>
          {r.read.archetype && <div className={s.archetype}>{r.read.archetype.name}</div>}
          <p>{r.read.summary}</p>
        </div>

        {/* 03 VELOCITY */}
        <div className={s.section}>
          <div className={s.sectionHead}>03 — Velocity</div>
          <div className={s.sectionTitle}>Throw-by-Throw</div>
          <div className={s.veloStrip}>
            {v.throws.map((t) => (
              <div key={t.trial} className={s.veloCell}>
                <div className={s.veloCellNum}>{t.velocity != null ? t.velocity.toFixed(1) : "—"}</div>
                <div className={s.veloCellLabel}>FB #{t.trial}</div>
              </div>
            ))}
          </div>
          <div className={s.veloSummary}>
            <div>
              <div className={s.veloSummaryNum}>{v.mean != null ? v.mean.toFixed(2) : "—"}</div>
              <div className={s.veloSummaryLabel}>Mean MPH</div>
            </div>
            <div className={s.veloSummaryMeta}>
              <div>
                SD <b>{v.sd.toFixed(2)}</b> mph
              </div>
              <div>{v.count} fastballs with velocity</div>
            </div>
          </div>
        </div>

        {/* 04 CYLINDERS */}
        <div className={s.section}>
          <div className={s.sectionHead}>04 — Framework</div>
          <div className={s.sectionTitle}>The 8 Cylinders</div>
          <div className={s.cylGrid}>
            {r.cards.map((c) => (
              <div key={c.key} className={s.cylCard}>
                <div className={s.cylNum}>{c.num}</div>
                <div className={s.cylBody}>
                  <div className={s.cylName}>{c.name}</div>
                  <div className={s.cylValue}>{c.valueText}</div>
                  <div className={s.cylBench}>{c.benchmarkText}</div>
                </div>
                {c.percentile != null && (
                  <div className={s.cylPct}>
                    <div className={s.cylPctNum}>{c.percentile}</div>
                    <div className={s.cylPctLabel}>%ILE</div>
                  </div>
                )}
                <Chip status={c.status} />
              </div>
            ))}
          </div>
        </div>

        {/* 05 METRICS */}
        <div className={s.section}>
          <div className={s.sectionHead}>05 — Detail</div>
          <div className={s.sectionTitle}>Underlying Metrics</div>
          <div className={s.tableWrap}>
            <table className={s.detail}>
              <thead>
                <tr>
                  <th />
                  <th>Metric</th>
                  <th style={{ textAlign: "center" }}>Value</th>
                  <th>Reference</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.details.map((d) => (
                  <tr key={d.label}>
                    <td className={s.dmGroup}>{d.group}</td>
                    <td className={s.dmLabel}>{d.label}</td>
                    <td className={s.dmValue}>{d.valueText}</td>
                    <td className={s.dmRef}>{d.refText}</td>
                    <td className={s.dmStatus}>
                      <Chip status={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 06 FINDINGS */}
        <div className={`${s.section} ${s.findingsGrid}`}>
          <div className={s.working}>
            <div className={s.sectionHead}>06 — Strengths</div>
            <div className={s.sectionTitle}>What&apos;s Working</div>
            {r.read.whatsWorking.length === 0 ? (
              <p>No cylinder reads in band yet.</p>
            ) : (
              r.read.whatsWorking.map((f) => (
                <div key={f.heading} className={s.finding}>
                  <h4>{f.heading}</h4>
                  <p>{f.body}</p>
                </div>
              ))
            )}
          </div>
          <div className={s.leaking}>
            <div className={s.sectionHead}>07 — Leaks</div>
            <div className={s.sectionTitle}>Where Velocity Is Leaking</div>
            {r.read.whereLeaking.length === 0 ? (
              <p>Nothing reads out of band.</p>
            ) : (
              r.read.whereLeaking.map((f) => (
                <div key={f.heading} className={s.finding}>
                  <h4>{f.heading}</h4>
                  <p>{f.body}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 08 RECOMMENDATIONS */}
        <div className={s.section}>
          <div className={s.sectionHead}>08 — Plan</div>
          <div className={s.sectionTitle}>Recommendations</div>
          <ol className={s.recList}>
            {r.read.recommendations.map((f) => (
              <li key={f.heading} className={s.recItem}>
                <span className={s.recBold}>{f.heading} — </span>
                {f.body}
              </li>
            ))}
          </ol>
        </div>

        {/* BOTTOM LINE */}
        <div className={s.bottomLine}>
          <div className={s.sectionHead}>09 — Diagnosis</div>
          <div className={s.sectionTitle}>Bottom Line</div>
          <p>{r.read.bottomLine}</p>
        </div>

        <div className={s.footnote}>
          Written automatically from the 8-Cylinder framework (benchmarks, archetypes and coaching language from the biomech-pitching-breakdown skill). It updates when new captures land. For a fully written read with staff notes, run the skill.
        </div>
      </div>
    </div>
  );
}
