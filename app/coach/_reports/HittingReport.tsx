"use client";

/**
 * In-app version of the hitting-swing-breakdown PDF: cover → checkpoint
 * scorecard → kinematic sequence + front-leg timing → segment walk (Head →
 * Trunk → Trunk–Pelvis → Pelvis → Arms → Legs/Knee → Bat) → posture & tilt →
 * the read. Same report design system as the pitching report, with the
 * hitting skill's light-blue accent.
 */

import { useState } from "react";
import useSWR from "swr";
import { Alert, Group, Loader, Select, Text } from "@mantine/core";
import type { HittingReport as Report, SegmentBlock } from "@/lib/coach/hitting/report";
import type { Checkpoint, SeqSeg, SwingMetrics } from "@/lib/coach/hitting/extract";
import { EVENT_LABEL, SEQ_SEGS } from "@/lib/coach/hitting/extract";
import type { Status } from "@/lib/coach/biomech/framework";
import { fmtDate, swrOpts } from "../_components/fetcher";
import s from "./biomechReport.module.css";
import h from "./hittingReport.module.css";

export const hittingReportKey = (uuid: string, date?: string | null) =>
  `/api/coach/athletes/${encodeURIComponent(uuid)}/hitting-report${date ? `?date=${date}` : ""}`;

const STATUS: Record<Status, { bg: string; fg: string; label: string }> = {
  best: { bg: "#5FBF5F", fg: "#0A0A0A", label: "Dialed" },
  good: { bg: "#7BC97B", fg: "#0A0A0A", label: "Solid" },
  warn: { bg: "#E8A04C", fg: "#0A0A0A", label: "Watch" },
  bad: { bg: "#E26464", fg: "#FFFFFF", label: "Flag" },
  neutral: { bg: "#6B7479", fg: "#FFFFFF", label: "Info" },
};

function Chip({ status }: { status: Status }) {
  const c = STATUS[status];
  return (
    <span className={s.chip} style={{ background: c.bg, color: c.fg }}>
      {c.label}
    </span>
  );
}

// Validated categorical slots (dark surface): blue, orange, aqua, yellow. Every mark is also labelled.
const SEG: Record<SeqSeg, { label: string; color: string }> = {
  pelvis: { label: "Pelvis", color: "#3987e5" },
  thorax: { label: "Thorax", color: "#d95926" },
  hand: { label: "Lead hand", color: "#199e70" },
  bat: { label: "Bat", color: "#c98500" },
};

const f0 = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v.toFixed(0) : "—");
const f1 = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v.toFixed(1) : "—");

function heightText(inches: number | null): string | null {
  if (inches == null || !Number.isFinite(inches) || inches < 40) return null;
  const ft = Math.floor(inches / 12);
  return `${ft}'${Math.round(inches - ft * 12)}"`;
}

/** Peak speed bars (magnitude building outward) and a timeline of when each peak fires between foot-down and contact. */
function SequenceChart({ m }: { m: SwingMetrics }) {
  const seq = m.sequence;
  const W = 760;
  const max = Math.max(1, ...SEQ_SEGS.map((k) => seq.peaks[k] ?? 0));
  const barH = 26;
  const gap = 12;
  const left = 96;
  const right = 90;
  const bw = W - left - right;
  const barsH = SEQ_SEGS.length * (barH + gap);
  const tl = { top: barsH + 54, h: 70 };
  const anyPct = SEQ_SEGS.some((k) => seq.pctWindow[k] != null);
  const H = anyPct ? tl.top + tl.h + 60 : barsH + 10;
  const x = (pct: number) => left + (Math.max(-30, Math.min(110, pct)) / 100) * bw;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={h.chart} role="img" aria-label="Kinematic sequence: peak angular velocity and timing">
      {SEQ_SEGS.map((k, i) => {
        const v = seq.peaks[k];
        const y = i * (barH + gap);
        return (
          <g key={k}>
            <text x={left - 10} y={y + barH / 2 + 4} textAnchor="end" fill="#F5F8FA" fontSize={12} fontWeight={600}>{SEG[k].label}</text>
            <rect x={left} y={y} width={bw} height={barH} fill="#1e1e1e" rx={3} />
            {v != null && <rect x={left} y={y} width={(v / max) * bw} height={barH} fill={SEG[k].color} rx={3} />}
            <text x={left + (v != null ? (v / max) * bw : 0) + 8} y={y + barH / 2 + 4} fill="#F5F8FA" fontSize={12} fontWeight={700}>
              {v != null ? `${v.toFixed(0)} °/s` : "—"}
            </text>
          </g>
        );
      })}
      {anyPct && (
        <g>
          <text x={left} y={tl.top - 22} fill="#A8B5BD" fontSize={11} letterSpacing="0.12em">WHEN EACH PEAK FIRES · LEAD FOOT DOWN → CONTACT</text>
          <line x1={x(0)} x2={x(100)} y1={tl.top + tl.h / 2} y2={tl.top + tl.h / 2} stroke="#5BC0EB" strokeOpacity={0.5} strokeWidth={2} />
          {[0, 100].map((p) => (
            <g key={p}>
              <line x1={x(p)} x2={x(p)} y1={tl.top + 8} y2={tl.top + tl.h - 8} stroke="#5BC0EB" strokeWidth={2} />
              <text x={x(p)} y={tl.top + 2} textAnchor="middle" fill="#A8B5BD" fontSize={10}>{p === 0 ? "Foot down" : "Contact"}</text>
            </g>
          ))}
          {(() => {
            // Peaks often fire within a few % of each other: labels sit in evenly spaced slots (in firing order) with leader lines to their dots.
            const cy = tl.top + tl.h / 2;
            const fired = SEQ_SEGS.filter((k2) => seq.pctWindow[k2] != null).sort((a, b) => seq.pctWindow[a]! - seq.pctWindow[b]!);
            const slotW = bw / Math.max(fired.length, 1);
            return fired.map((k2, i) => {
              const p = seq.pctWindow[k2]!;
              const lx = left + slotW * (i + 0.5);
              const ly = tl.top + tl.h + 34;
              return (
                <g key={k2}>
                  <path d={`M${x(p)},${cy + 8} L${x(p)},${cy + 18} L${lx},${ly - 14}`} fill="none" stroke={SEG[k2].color} strokeOpacity={0.6} />
                  <circle cx={x(p)} cy={cy} r={7} fill={SEG[k2].color} stroke="#0a0a0a" strokeWidth={2}>
                    <title>{`${SEG[k2].label} peak at ${p.toFixed(0)}% of foot-down → contact`}</title>
                  </circle>
                  <text x={lx} y={ly} textAnchor="middle" fill={SEG[k2].color} fontSize={12} fontWeight={700}>{SEG[k2].label} · {p.toFixed(0)}%</text>
                  <text x={lx} y={ly + 14} textAnchor="middle" fill="#A8B5BD" fontSize={10}>
                    {seq.lagMs[k2] != null ? (k2 === "pelvis" ? "reference" : `${seq.lagMs[k2]! >= 0 ? "+" : ""}${seq.lagMs[k2]!.toFixed(0)} ms vs pelvis`) : ""}
                  </text>
                </g>
              );
            });
          })()}
        </g>
      )}
    </svg>
  );
}

const fmtCell = (v: number | null, unit: string) => (v != null && Number.isFinite(v) ? `${v.toFixed(unit === "°/s" ? 0 : 1)}` : "—");

function SegmentTable({ seg }: { seg: SegmentBlock }) {
  const hasComp = seg.rows.some((r) => r.X != null || r.Y != null || r.Z != null);
  const cols: Array<"X" | "Y" | "Z"> = hasComp ? (["X", "Y", "Z"] as const).filter((c) => seg.rows.some((r) => r[c] != null)) : [];
  return (
    <div className={h.segCard}>
      <div className={h.segTitle}>{seg.title}</div>
      <div className={h.segDesc}>{seg.description}</div>
      {seg.rows.length > 0 && (
        <table className={h.segTable}>
          <thead>
            <tr>
              <th>Event</th>
              {hasComp ? cols.map((c) => <th key={c}>{c} ({seg.unit})</th>) : <th>{seg.unit === "°" ? "Angle (°)" : seg.unit}</th>}
            </tr>
          </thead>
          <tbody>
            {seg.rows.map((r) => (
              <tr key={r.event}>
                <td>{r.label}</td>
                {hasComp ? cols.map((c) => <td key={c}>{fmtCell(r[c], seg.unit)}</td>) : <td>{fmtCell(r.value, seg.unit)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {seg.peaks.length > 0 && (
        <div className={h.segPeaks}>
          {seg.peaks.map((p) => (
            <span key={p.label}>
              {p.label}: <b>{p.value.toFixed(0)} {p.unit}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckpointCard({ c }: { c: Checkpoint }) {
  return (
    <div className={s.cylCard} style={{ alignItems: "flex-start" }}>
      <div className={s.cylNum} style={{ fontSize: 12 }}>{c.id.replace("CP", "")}</div>
      <div className={s.cylBody}>
        <div className={s.cylName}>{c.label}</div>
        <div className={s.cylValue}>{c.valueText}</div>
        <div className={s.cylBench}>Target: {c.target}</div>
        <div className={s.cylBench}>{c.note}</div>
        {c.basis && <div className={h.basis}>{c.basis}</div>}
      </div>
      <Chip status={c.status} />
    </div>
  );
}

/** In-app version of the hitting-swing-breakdown PDF, rebuilt from the warehouse on every load. */
export function HittingReport({ athleteUuid }: { athleteUuid: string }) {
  const [date, setDate] = useState<string | null>(null);
  const { data: r, error, isLoading } = useSWR<Report>(hittingReportKey(athleteUuid, date), { ...swrOpts, keepPreviousData: true });

  if (isLoading && !r) return <Loader size="sm" />;
  if (error && !r) return <Alert color="red">{error.message}</Alert>;
  if (!r) return null;

  const m = r.metrics;
  const seq = m.sequence;
  const size = [heightText(r.athlete.heightIn), r.athlete.weightLb ? `${Math.round(r.athlete.weightLb)} lb` : null].filter(Boolean).join(" / ");
  const k = m.knee;
  const graded = m.checkpoints.filter((c) => c.status !== "neutral");
  const inBand = graded.filter((c) => c.status === "best" || c.status === "good").length;
  const bat = m.bat3d;
  const tiltEvents = Object.keys(m.tilt.trunk);

  return (
    <div>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          Swing-checkpoint framework (hitting-swing-breakdown), rebuilt from the warehouse. No percentiles: there&apos;s no 8ctane hitting benchmark cohort yet — the Metrics explorer has database percentiles.
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

      <div className={`${s.report} ${h.theme}`}>
        {/* COVER */}
        <div className={s.cover}>
          <div className={s.coverRule} />
          <div className={s.brand}>8ctane · Hitting Report</div>
          <h1 className={s.name}>{r.athlete.name}</h1>
          <div className={s.tagline}>Hitter · Swing Breakdown</div>
          <div className={s.coverMain}>
            <div>
              <div className={s.veloNum}>{f1(m.bat.mean)}</div>
              <div className={s.veloLabel}>Mean Bat Speed — MPH</div>
            </div>
            <div className={s.overall}>
              <div className={s.overallNum}>
                {inBand}
                <span style={{ fontSize: 28, color: "var(--mid)" }}>/{graded.length}</span>
              </div>
              <div>
                <div className={s.overallPct}>Checkpoints in band</div>
                <div className={s.overallSub}>{m.n} swing{m.n === 1 ? "" : "s"} averaged</div>
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
              <div className={s.statLabel}>Hand Speed</div>
              <div className={s.statValue}>{m.handSpeedMph != null ? `${m.handSpeedMph.toFixed(1)} mph` : "—"}</div>
            </div>
          </div>
          <div className={s.coverRuleBottom} />
          <div className={s.coverFooter}>
            <b>B_Young Biomechanics</b> · Qualisys · Visual3D · 8ctane Swing Checkpoints
          </div>
        </div>

        {r.read.flags.map((f) => (
          <div key={f} className={s.flag}>
            <b>Capture note</b>
            {f}
          </div>
        ))}

        {/* 01 SUMMARY */}
        <div className={s.section}>
          <div className={s.sectionHead}>01 — Session Summary</div>
          <div className={s.sectionTitle}>The Read</div>
          <p>{r.read.summary}</p>
        </div>

        {/* 02 BAT SPEED */}
        <div className={s.section}>
          <div className={s.sectionHead}>02 — Bat Speed</div>
          <div className={s.sectionTitle}>Swing-by-Swing</div>
          <div className={s.veloStrip}>
            {m.swings.map((w, i) => (
              <div key={w.trial} className={s.veloCell}>
                <div className={s.veloCellNum}>{f1(w.batSpeedMph)}</div>
                <div className={s.veloCellLabel}>Swing #{i + 1}</div>
              </div>
            ))}
          </div>
          <div className={s.veloSummary}>
            <div>
              <div className={s.veloSummaryNum}>{m.bat.mean != null ? m.bat.mean.toFixed(2) : "—"}</div>
              <div className={s.veloSummaryLabel}>Mean MPH (model bat speed)</div>
            </div>
            <div className={s.veloSummaryMeta}>
              <div>SD <b>{m.bat.sd.toFixed(2)}</b> mph</div>
              {m.bat.min != null && m.bat.max != null && <div>Range {m.bat.min.toFixed(1)}–{m.bat.max.toFixed(1)} mph</div>}
            </div>
          </div>
        </div>

        {/* 03 CHECKPOINTS */}
        <div className={s.section}>
          <div className={s.sectionHead}>03 — Framework</div>
          <div className={s.sectionTitle}>Checkpoint Scorecard</div>
          <div className={s.cylGrid}>
            {m.checkpoints.map((c) => <CheckpointCard key={c.id} c={c} />)}
          </div>
        </div>

        {/* 04 SEQUENCE */}
        <div className={s.section}>
          <div className={s.sectionHead}>04 — Kinematic Sequence</div>
          <div className={s.sectionTitle}>Energy Out to the Barrel</div>
          <SequenceChart m={m} />
          <div className={h.seqMeta}>
            <div>
              <span>Order (most common)</span>
              <b>{seq.modalOrder.length ? seq.modalOrder.map((k2) => SEG[k2].label).join(" → ") : "—"}</b>
            </div>
            <div>
              <span>In proper order</span>
              <b>{seq.properRate != null ? `${Math.round(seq.properRate * 100)}% of ${seq.timedSwings} swings` : "—"}</b>
            </div>
            <div>
              <span>Speed gain pelvis → thorax → hand → bat</span>
              <b>{[seq.ampPelvisThorax, seq.ampThoraxHand, seq.ampHandBat].map((a) => (a != null ? `×${a.toFixed(2)}` : "—")).join("  ")}</b>
            </div>
            <div>
              <span>Foot down → contact</span>
              <b>{seq.lfdToContactMs != null ? `${seq.lfdToContactMs.toFixed(0)} ms` : "—"}</b>
            </div>
          </div>
          {(k.flexLfd != null || k.velLfd != null) && (
            <div className={s.releasePhase} style={{ marginTop: 18 }}>
              <div className={s.rpCell}>
                <div className={s.rpLabel}>Front Leg · Knee Flexion</div>
                <div className={s.rpValue}>{f0(k.flexLfd)}° → {f0(k.flexContact)}°</div>
                <div className={s.rpMeta}>foot-down → contact · {k.extension != null ? `${k.extension.toFixed(0)}° of extension` : ""} · target ~45° → ~0°{k.source === "swing1" ? " · swing 1 only (per-swing values not stored)" : ""}{k.extMaxAngle != null ? ` · straightest ${k.extMaxAngle.toFixed(0)}° (all swings)` : ""}</div>
              </div>
              <div className={s.rpCell}>
                <div className={s.rpLabel}>Front Leg · Extension Speed at Plant</div>
                <div className={s.rpValue}>{k.velLfd != null ? `${Math.abs(k.velLfd).toFixed(0)} °/s` : "—"}</div>
                <div className={s.rpMeta}>how fast the knee is already straightening when the foot lands{k.storedExtMax != null ? ` · stored max ${Math.abs(k.storedExtMax).toFixed(0)} °/s` : ""}</div>
              </div>
            </div>
          )}
        </div>

        {/* 05 SEGMENTS */}
        <div className={s.section}>
          <div className={s.sectionHead}>05 — Top of the Chain to the Bat</div>
          <div className={s.sectionTitle}>Segment Walk</div>
          <p className={h.muted}>Each segment&apos;s value at the swing events, averaged over the swings (as exported by Visual3D).</p>
          <div className={h.groupGrid}>
            {r.groups.map((g) => (
              // Single-segment groups pair up two to a row; multi-segment groups take the full width.
              <div key={g.title} className={h.group} style={g.segments.length > 1 ? { gridColumn: "1 / -1" } : undefined}>
                <div className={h.groupHead}>{g.title}</div>
                <div className={h.groupIntro}>{g.intro}</div>
                <div className={g.segments.length > 1 ? h.segGrid : undefined}>
                  {g.segments.map((seg) => <SegmentTable key={seg.key} seg={seg} />)}
                </div>
              </div>
            ))}
          </div>
          <div className={h.group}>
            <div className={h.groupHead}>Bat</div>
            <div className={h.groupIntro}>Barrel path and presentation at contact.</div>
            <div className={h.batGrid}>
              {[
                ["Bat speed", m.bat.mean != null ? `${m.bat.mean.toFixed(1)} mph` : null],
                ["Peak bat angular velocity", seq.peaks.bat != null ? `${seq.peaks.bat.toFixed(0)} °/s` : null],
                ["Vertical attack angle", bat.verticalAttack != null ? `${bat.verticalAttack.toFixed(1)}°` : null],
                ["Horizontal attack angle", bat.horizontalAttack != null ? `${bat.horizontalAttack.toFixed(1)}°` : null],
                ["Bat angle @ contact · frontal", bat.frontal != null ? `${bat.frontal.toFixed(1)}°` : null],
                ["Bat angle @ contact · sagittal", bat.sagittal != null ? `${bat.sagittal.toFixed(1)}°` : null],
                ["Bat angle @ contact · transverse", bat.transversal != null ? `${bat.transversal.toFixed(1)}°` : null],
                ["Bat travelled distance", bat.travelled != null ? `${bat.travelled.toFixed(2)} m` : null],
              ]
                .filter(([, v]) => v != null)
                .map(([label, v]) => (
                  <div key={label} className={h.batCell}>
                    <div className={h.batLabel}>{label}</div>
                    <div className={h.batValue}>{v}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* 06 POSTURE */}
        <div className={s.section}>
          <div className={s.sectionHead}>06 — Posture</div>
          <div className={s.sectionTitle}>Trunk &amp; Pelvis Tilt</div>
          {m.tilt.available ? (
            <>
              {!m.tilt.ok && <div className={s.flag}><b>Tilt not confirmed</b>{m.tilt.messages.join(" ")}</div>}
              <div className={s.tableWrap}>
                <table className={s.detail} style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th style={{ textAlign: "center" }}>Trunk tilt from vertical</th>
                      <th style={{ textAlign: "center" }}>Pelvis tilt from vertical</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiltEvents.map((ev) => (
                      <tr key={ev}>
                        <td className={s.dmLabel}>{EVENT_LABEL[ev] ?? ev}</td>
                        <td className={s.dmValue}>{m.tilt.trunk[ev] != null ? `${m.tilt.trunk[ev]!.toFixed(0)}°` : "—"}</td>
                        <td className={s.dmValue}>{m.tilt.pelvis[ev] != null ? `${m.tilt.pelvis[ev]!.toFixed(0)}°` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={h.muted} style={{ marginTop: 10 }}>
                Tilt from vertical = arccos(cos X · cos Y): the frame-proof lean of each segment. The magnitude is reliable; direction depends on the lab frame. Not a pass/fail checkpoint.
              </p>
            </>
          ) : (
            <p className={h.muted}>
              This export stores only one component of the trunk and pelvis angles, so tilt from vertical (which needs X and Y) can&apos;t be computed. The raw X value is not forward/back tilt and isn&apos;t shown.
            </p>
          )}
        </div>

        {/* 07 FINDINGS */}
        <div className={`${s.section} ${s.findingsGrid}`}>
          <div className={s.working}>
            <div className={s.sectionHead}>07 — Strengths</div>
            <div className={s.sectionTitle}>What&apos;s Working</div>
            {r.read.whatsWorking.length === 0 ? (
              <p>No checkpoints read in band yet.</p>
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
            <div className={s.sectionHead}>08 — Focus</div>
            <div className={s.sectionTitle}>Focus Areas</div>
            {r.read.focusAreas.length === 0 ? (
              <p>Nothing reads out of band.</p>
            ) : (
              r.read.focusAreas.map((f) => (
                <div key={f.heading} className={s.finding}>
                  <h4>{f.heading}</h4>
                  <p>{f.body}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {r.read.drills.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionHead}>09 — Plan</div>
            <div className={s.sectionTitle}>Drills</div>
            <ol className={s.recList}>
              {r.read.drills.map((f) => (
                <li key={f.heading} className={s.recItem}>
                  <span className={s.recBold}>{f.heading} — </span>
                  {f.body}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className={s.bottomLine}>
          <div className={s.sectionHead}>{r.read.drills.length ? "10" : "09"} — Development</div>
          <div className={s.sectionTitle}>Bottom Line</div>
          <p>{r.read.bottomLine}</p>
        </div>

        <div className={s.footnote}>
          Written automatically from the 8ctane swing checkpoints (thresholds and coaching language from the hitting-swing-breakdown skill), using the
          per-swing values the warehouse stores ({r.variableCount} variables). The skill&apos;s per-segment time-series graphs need the raw Visual3D export; for those, and a
          fully written read, run the skill on the capture.
        </div>
      </div>
    </div>
  );
}
