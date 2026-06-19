"use client";

import { useState } from "react";
import useSWR from "swr";
import { useAthleteSearch }          from "@/hooks";
import { AthleteSearchDropdown }     from "@/app/dashboard/reports/components/AthleteSearchDropdown";
import { MetricLineChart }           from "@/app/dashboard/athlete-tracking/MetricLineChart";
import { ReadinessGauge }            from "./components/ReadinessGauge";
import { SubScoreBars }              from "./components/SubScoreBars";
import { ScoreHistoryChart }         from "./components/ScoreHistoryChart";
import { TodayVsBaselineChart }      from "./components/TodayVsBaselineChart";
import { JumpTimeseriesChart }       from "./components/JumpTimeseriesChart";
import { FvScatterChart }            from "./components/FvScatterChart";
import { MovementStrategyPanel }     from "./components/MovementStrategyPanel";
import { TrialConsistencyChart }     from "./components/TrialConsistencyChart";
import { PowerCurvesPanel }          from "./components/PowerCurvesPanel";
import { FlagHeatmap }               from "./components/FlagHeatmap";
import type { ReadinessDashboardPayload } from "./types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatNum(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

function SectionHead({ num, title }: { num: string; title: string }) {
  return (
    <div className="section-head">
      <span className="eyebrow">{num}</span>
      <span className="section-title">{title}</span>
      <hr className="rule" />
    </div>
  );
}

function StatBox({ label, values }: { label: string; values: (number | null | undefined)[] }) {
  const cleaned = (values ?? []).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  if (cleaned.length === 0) {
    return (
      <div className="stat flat">
        <div className="stat-label">{label}</div>
        <div className="stat-value text-muted">—</div>
      </div>
    );
  }
  const latest = cleaned[cleaned.length - 1]!;
  const prev   = cleaned.length > 1 ? cleaned[cleaned.length - 2] : null;
  const delta  = prev !== null ? latest - prev : null;
  const dir    = delta === null ? "flat" : (delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat");
  const sign   = delta !== null && delta > 0 ? "+" : "";
  return (
    <div className={`stat ${dir}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{formatNum(latest)}</div>
      {delta !== null
        ? <div className={`stat-delta ${dir}`}>{sign}{formatNum(delta)} vs prev</div>
        : <div className="stat-delta flat">first session</div>
      }
    </div>
  );
}

export function ReadinessScreenContent() {
  const athleteSearch = useAthleteSearch();
  const [showLegacy, setShowLegacy] = useState(false);

  const athleteUuid = athleteSearch.athleteSelected?.athlete_uuid;

  const { data, isLoading, error } = useSWR<ReadinessDashboardPayload>(
    athleteUuid ? `/api/dashboard/readiness-screen?athleteUuid=${athleteUuid}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.4rem", fontSize: "1.75rem" }}>Readiness Screen</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Athlete readiness dashboard — composite score, jump metrics, isometric strength, grip, and power curves.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <AthleteSearchDropdown {...athleteSearch} />
      </div>

      {isLoading && (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Loading…</p>
      )}
      {error && (
        <p className="text-danger" style={{ fontSize: "0.9rem" }}>Failed to load data.</p>
      )}

      {data && (
        <>
          {/* ── 01 · Composite readiness ──────────────────────────────── */}
          <SectionHead num="01" title="Composite readiness" />

          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <ReadinessGauge
                score={data.latest_score?.composite_score ?? null}
                band={data.latest_score?.band ?? null}
                date={data.latest_score?.date ?? null}
              />
              <div style={{ flex: 1, minWidth: 200 }}>
                <SubScoreBars
                  cmj_z={data.latest_score?.cmj_z ?? null}
                  ppu_z={data.latest_score?.ppu_z ?? null}
                  iso_z={data.latest_score?.iso_z ?? null}
                  power_curve_z={data.latest_score?.power_curve_z ?? null}
                  grip_z={data.latest_score?.grip_z ?? null}
                  metrics_used={data.latest_score?.metrics_used ?? null}
                  scoring_tier={data.latest_score?.scoring_tier ?? null}
                />
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border-soft)", margin: "1.1rem 0 0.9rem" }} />

            <div>
              <p className="card-sub" style={{ marginBottom: "0.4rem" }}>Score history</p>
              <div className="plot-frame">
                <ScoreHistoryChart data={data.score_history} />
              </div>
            </div>
          </div>

          {data.today_vs_baseline.length > 0 && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-head">
                <h2>Today vs baseline</h2>
                <span className="card-sub">per-metric z-scores vs personal history or peer mean</span>
              </div>
              <div className="plot-frame">
                <TodayVsBaselineChart data={data.today_vs_baseline} />
              </div>
            </div>
          )}

          {/* ── 02 · Force-plate tests ────────────────────────────────── */}
          <SectionHead num="02" title="Force-plate tests" />

          {/* CMJ */}
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-head">
              <h2>Countermovement jump (CMJ)</h2>
            </div>
            <div className="plot-2">
              <div className="plot-frame">
                <JumpTimeseriesChart data={data.cmj.timeseries} kind="cmj" />
              </div>
              <div className="plot-frame">
                <FvScatterChart scatter={data.cmj.scatter} peers={data.cmj.peers} />
              </div>
            </div>
            <div className="stat-grid">
              <StatBox label="Jump height (in)" values={data.cmj.timeseries.map((d) => d.jump_height)} />
              <StatBox label="W/kg"             values={data.cmj.timeseries.map((d) => d.pp_w_per_kg)} />
              <StatBox label="F @ PP (N)"        values={data.cmj.timeseries.map((d) => d.force_at_pp)} />
              <StatBox label="V @ PP (m/s)"      values={data.cmj.timeseries.map((d) => d.vel_at_pp)} />
            </div>
            {data.movement_strategy.cmj.length > 0 && (
              <div style={{ marginTop: "1.1rem" }}>
                <div className="card-head">
                  <h2>Movement strategy</h2>
                  <span className="card-sub">mRSI · contraction time · ecc:con ratio · eccentric power</span>
                </div>
                <MovementStrategyPanel data={data.movement_strategy.cmj} kind="cmj" />
              </div>
            )}
          </div>

          {/* PPU */}
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-head">
              <h2>Plyometric push-up (PPU)</h2>
            </div>
            <div className="plot-2">
              <div className="plot-frame">
                <JumpTimeseriesChart data={data.ppu.timeseries} kind="ppu" />
              </div>
              <div className="plot-frame">
                <FvScatterChart scatter={data.ppu.scatter} peers={data.ppu.peers} />
              </div>
            </div>
            <div className="stat-grid">
              <StatBox label="Jump height (in)" values={data.ppu.timeseries.map((d) => d.jump_height)} />
              <StatBox label="W/kg"             values={data.ppu.timeseries.map((d) => d.pp_w_per_kg)} />
              <StatBox label="F @ PP (N)"        values={data.ppu.timeseries.map((d) => d.force_at_pp)} />
              <StatBox label="V @ PP (m/s)"      values={data.ppu.timeseries.map((d) => d.vel_at_pp)} />
            </div>
            {data.movement_strategy.ppu.length > 0 && (
              <div style={{ marginTop: "1.1rem" }}>
                <div className="card-head">
                  <h2>Movement strategy</h2>
                  <span className="card-sub">mRSI · contraction time</span>
                </div>
                <MovementStrategyPanel data={data.movement_strategy.ppu} kind="ppu" />
              </div>
            )}
          </div>

          {/* ── 03 · Trial consistency ────────────────────────────────── */}
          <SectionHead num="03" title="Trial consistency" />
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-head">
              <h2>Jump height per session</h2>
              <span className="card-sub">T1 vs T2 for CMJ and PPU</span>
            </div>
            <div className="plot-frame">
              <TrialConsistencyChart cmj={data.intra_session.cmj} ppu={data.intra_session.ppu} />
            </div>
          </div>

          {/* ── 04 · Isometric & grip ─────────────────────────────────── */}
          <SectionHead num="04" title="Isometric &amp; grip" />

          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-head">
              <h2>Isometric strength</h2>
              <label className="switch" style={{ marginLeft: "auto" }}>
                <input
                  type="checkbox"
                  checked={showLegacy}
                  onChange={(e) => setShowLegacy(e.target.checked)}
                />
                <span className="switch-track"><span className="switch-knob" /></span>
                Show I / T legacy
              </label>
            </div>
            <div className={showLegacy ? "plot-4" : "plot-2"}>
              <div className="plot-frame">
                <MetricLineChart
                  title="Y (scapular)"
                  data={data.iso.Y.data.map((d) => ({ date: d.date, value: d.avg_force }))}
                  unit="N"
                />
              </div>
              <div className="plot-frame">
                <MetricLineChart
                  title="IR90"
                  data={data.iso.IR90.data.map((d) => ({ date: d.date, value: d.avg_force }))}
                  unit="N"
                />
              </div>
              {showLegacy && (
                <>
                  <div className="plot-frame">
                    <MetricLineChart
                      title="I (legacy)"
                      data={data.iso.I.data.map((d) => ({ date: d.date, value: d.avg_force }))}
                      unit="N"
                    />
                  </div>
                  <div className="plot-frame">
                    <MetricLineChart
                      title="T (legacy)"
                      data={data.iso.T.data.map((d) => ({ date: d.date, value: d.avg_force }))}
                      unit="N"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="stat-grid">
              <StatBox label="Y avg force (N)"    values={data.iso.Y.data.map((d) => d.avg_force)} />
              <StatBox label="IR90 avg force (N)" values={data.iso.IR90.data.map((d) => d.avg_force)} />
            </div>
          </div>

          {data.grip.timeseries.length > 0 && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-head">
                <h2>Grip strength</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                <div className="plot-frame">
                  <MetricLineChart title="Left"  data={data.grip.timeseries.map((d) => ({ date: d.date, value: d.left_kg }))}  unit="kg" />
                </div>
                <div className="plot-frame">
                  <MetricLineChart title="Right" data={data.grip.timeseries.map((d) => ({ date: d.date, value: d.right_kg }))} unit="kg" />
                </div>
                <div className="plot-frame">
                  <MetricLineChart title="Max"   data={data.grip.timeseries.map((d) => ({ date: d.date, value: d.max_kg }))}   unit="kg" />
                </div>
              </div>
              <div className="stat-grid">
                <StatBox label="Left (kg)"   values={data.grip.timeseries.map((d) => d.left_kg)} />
                <StatBox label="Right (kg)"  values={data.grip.timeseries.map((d) => d.right_kg)} />
                <StatBox label="Max (kg)"    values={data.grip.timeseries.map((d) => d.max_kg)} />
                <StatBox label="Asymmetry %" values={data.grip.timeseries.map((d) => d.asymmetry_pct)} />
              </div>
            </div>
          )}

          {/* ── 05 · Power & trends ───────────────────────────────────── */}
          <SectionHead num="05" title="Power &amp; trends" />
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-head">
              <h2>Power curve trends</h2>
              <span className="card-sub">peak power · RPD · rise slope · FWHM · AUC</span>
            </div>
            <div className="plot-frame">
              <PowerCurvesPanel cmj={data.power_curves.CMJ} ppu={data.power_curves.PPU} />
            </div>
          </div>

          {/* ── 06 · Metric flags ─────────────────────────────────────── */}
          {data.flag_heatmap.dates.length > 0 && (
            <>
              <SectionHead num="06" title="Metric flags" />
              <div className="card" style={{ marginBottom: "1rem" }}>
                <div className="card-head">
                  <h2>14-day flag heatmap</h2>
                  <span className="card-sub">rise = improving · drop = declining · stable = within baseline</span>
                </div>
                <FlagHeatmap data={data.flag_heatmap} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
