"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Group, Loader, Select, Text } from "@mantine/core";
import type { AthleticScreenReport as Report } from "@/lib/coach/athleticScreen/report";
import type { MovementPage, TableRow, TierColor } from "@/lib/coach/athleticScreen/compute";
import { fmtDate, swrOpts } from "../_components/fetcher";
import { BLUE, EmptyPanel, FvScatter, HistogramPanel, PANEL, PercentileRing, PowerCurvePanel, ScreenRadar } from "./screenCharts";

/** Pastel tier fills from pdf_report.performance_table (hex blended 50% with white, alpha 0.5). */
function pastel(hex: string, alpha = 0.5): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * 0.5 + 255 * 0.5);
  return `rgba(${ch(16)}, ${ch(8)}, ${ch(0)}, ${alpha})`;
}
const TIER_FILL: Record<TierColor, string> = {
  Elite: pastel("#00ff00"),
  High: pastel("#90ee90"),
  Average: pastel("#808080"),
  "Below Average": pastel("#ffff00"),
  Low: pastel("#d62728"),
  kurtIn: pastel("#00ff00"),
  kurtOut: pastel("#d62728"),
  none: PANEL,
};

const cell: React.CSSProperties = { border: "1px solid #fff", padding: "7px 10px", textAlign: "center", color: "#fff", whiteSpace: "pre-line", fontSize: 13 };

function PerfTable({ rows }: { rows: TableRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: PANEL }}>
      <thead>
        <tr>
          {["Variable", "Athlete Value", "Tier / Threshold", "Ideal Values"].map((hd) => (
            <th key={hd} style={{ ...cell, fontWeight: 700 }}>
              {hd}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.variable}>
            <td style={cell}>{r.variable}</td>
            <td style={cell}>{r.value}</td>
            <td style={{ ...cell, background: TIER_FILL[r.tierColor], fontWeight: 700 }}>{r.tier}</td>
            <td style={cell}>{r.ideal}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TITLE_LINES: Record<string, [string, string]> = {
  DJ: ["Drop", "Jump"],
  CMJ: ["Counter", "Movement Jump"],
  PPU: ["Plyo", "Pushup"],
  SLV: ["Single Leg", "Vertical"],
};

/** Two columns like the PDF (DJ gets a 2×2 of histograms); one column on narrow screens. */
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "18px 28px" };

/** One movement page, laid out like the PDF page. */
function MovementSheet({ page, name, date }: { page: MovementPage; name: string; date: string }) {
  const [t1, t2] = TITLE_LINES[page.movement] ?? [page.title, ""];
  const slv = page.movement === "SLV";
  const left = page.rings.filter((r) => r.side === "Left");
  const right = page.rings.filter((r) => r.side === "Right");
  return (
    <section
      id={`screen-${page.movement}`}
      style={{ position: "relative", background: "#000", color: "#fff", padding: "22px 26px 28px 46px", borderRadius: 8, marginBottom: 24, overflow: "hidden", scrollMarginTop: 70 }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: BLUE }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
        <div style={{ fontStyle: "italic", fontWeight: 800, fontSize: "clamp(15px, 1.8vw, 22px)", lineHeight: 1.35 }}>
          <div>{name}</div>
          <div>{date}</div>
        </div>
        <div style={{ fontStyle: "italic", fontWeight: 800, fontSize: "clamp(26px, 3.6vw, 46px)", textAlign: "center", lineHeight: 1.05 }}>
          <div>{t1}</div>
          <div>{t2}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coach/8ctane-logo.png" alt="8ctane Baseball" style={{ maxWidth: 260, width: "100%", height: "auto" }} />
        </div>
      </div>
      <div style={{ height: 3, background: BLUE, margin: "12px 0 22px" }} />

      <div style={grid2}>
        {page.bars.map((b) => (
          <HistogramPanel key={b.metric} panel={b} />
        ))}
      </div>

      <div style={{ ...grid2, gap: 28, marginTop: 26, alignItems: "center" }}>
        <div style={{ gridColumn: "span 1" }}>
          <FvScatter fv={page.fv} />
        </div>
        <div style={{ textAlign: "center" }}>
          {slv ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                ["Left Leg", left],
                ["Right Leg", right],
              ].map(([label, rings]) => (
                <div key={label as string}>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>{label as string}</div>
                  {(rings as typeof left).map((r) => (
                    <div key={r.metric}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{r.label}</div>
                      <PercentileRing ring={r} />
                    </div>
                  ))}
                  {(rings as typeof left).length === 0 && <Text c="dimmed" size="sm">No trials</Text>}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>@ Peak Power</div>
              {page.rings.map((r) => (
                <div key={r.metric} style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{r.label}</div>
                  <PercentileRing ring={r} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={{ ...grid2, gap: 28, marginTop: 26, alignItems: "center" }}>
        <ScreenRadar labels={page.radar.labels} series={page.radar.series} />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {page.power ? <PowerCurvePanel power={page.power} /> : <EmptyPanel title="Power Curve" text="No stored power curve for this session. Curves are saved for screens processed after the power-curve table was added." />}
          <PerfTable rows={page.table} />
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
        {page.trials} trial{page.trials === 1 ? "" : "s"} averaged
      </div>
    </section>
  );
}

/** In-app version of the athletic screen PDF (pdf_report.py), rebuilt from the warehouse on every load. */
export function AthleticScreenReport({ athleteUuid }: { athleteUuid: string }) {
  const [date, setDate] = useState<string | null>(null);
  const key = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/athletic-screen-report${date ? `?date=${date}` : ""}`;
  const { data: r, error, isLoading } = useSWR<Report>(key, { ...swrOpts, keepPreviousData: true });

  if (isLoading && !r) return <Loader size="sm" />;
  if (error && !r) return <Alert color="red">{error.message}</Alert>;
  if (!r) return null;

  const usDate = (() => {
    const [y, mo, d] = r.sessionDate.split("-");
    return `${mo}/${d}/${y}`;
  })();

  return (
    <div>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap={6}>
          {r.pages.map((p) => (
            <a
              key={p.movement}
              href={`#screen-${p.movement}`}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none", fontSize: 13 }}
            >
              {p.movement}
            </a>
          ))}
          <Text size="sm" c="dimmed" ml="xs">
            {r.populationNote}
          </Text>
        </Group>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Select
            size="xs"
            w={190}
            data={r.sessions.map((d) => ({ value: d, label: `Screen ${fmtDate(d)}` }))}
            value={r.sessionDate}
            onChange={(d) => d && setDate(d)}
            allowDeselect={false}
          />
        </Group>
      </Group>
      {r.pages.length === 0 && <Text c="dimmed">No movements recorded on this date.</Text>}
      {r.pages.map((p) => (
        <MovementSheet key={p.movement} page={p} name={r.athlete.name} date={usDate} />
      ))}
    </div>
  );
}
