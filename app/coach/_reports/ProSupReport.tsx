"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Group, Loader, Select, Text } from "@mantine/core";
import type { ProSupReport as Report } from "@/lib/coach/proSup";
import { fmtDate, swrOpts } from "../_components/fetcher";

// Colors from uais/python/proSupTest/report_generation.py
const ACCENT = "#4887a8";
const MUTED = "#586c7b";
const SHADOW = "#0a0d10";
const PAGE = "#0e1116";

const pctColor = (p: number) => (p < 33 ? "red" : p < 67 ? "yellow" : "limegreen");

/** Plotly donut from ring_gauge(): hole 0.78, clockwise from 12 o'clock, "NN%" in the middle. */
function RingGauge({ pct, size }: { pct: number | null; size: number }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const r = 50;
  const width = r * (1 - 0.78);
  const mid = r - width / 2;
  const circ = 2 * Math.PI * mid;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
      <circle cx={50} cy={50} r={mid} fill="none" stroke="#303030" strokeWidth={width} />
      {p > 0 && (
        <circle
          cx={50}
          cy={50}
          r={mid}
          fill="none"
          stroke={pctColor(p)}
          strokeWidth={width}
          strokeDasharray={`${(p / 100) * circ} ${circ}`}
          transform="rotate(-90 50 50)"
        />
      )}
      <text x={50} y={50} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={13} fontWeight={700}>
        {`${Math.floor(p)}%`}
      </text>
      <title>{pct == null ? "No percentile" : `${Math.floor(p)}th percentile`}</title>
    </svg>
  );
}

/** rom_bars(): the three interval cumulative ROMs, current interval highlighted. */
function RomBars({ values, highlight }: { values: Array<number | null>; highlight: number }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const w = 110;
  const h = 110;
  const slot = w / 3;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      {values.map((v, i) => {
        const bh = ((v ?? 0) / max) * (h - 2);
        return (
          <rect key={i} x={i * slot + slot * 0.05} y={h - bh} width={slot * 0.9} height={bh} fill={i === highlight ? ACCENT : MUTED}>
            <title>{`${["0–10", "10–20", "20–30"][i]} s: ${v == null ? "—" : v.toFixed(1)}°`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "#000",
  border: "1px solid #fff",
  borderRadius: 10,
  boxShadow: `4px 4px 0 ${SHADOW}`,
  display: "flex",
  alignItems: "center",
  gap: 24,
};
const label: React.CSSProperties = { fontStyle: "italic", fontWeight: 700, color: ACCENT };
const line: React.CSSProperties = { fontStyle: "italic", fontSize: 16, color: "#fff", display: "grid", gridTemplateColumns: "160px auto", lineHeight: 1.6 };

const n1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

/** In-app version of the pro-sup PDF, rebuilt from the warehouse on every load. */
export function ProSupReport({ athleteUuid }: { athleteUuid: string }) {
  const [date, setDate] = useState<string | null>(null);
  const key = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pro-sup-report${date ? `?date=${date}` : ""}`;
  const { data: r, error, isLoading } = useSWR<Report>(key, { ...swrOpts, keepPreviousData: true });

  if (isLoading && !r) return <Loader size="sm" />;
  if (error && !r) return <Alert color="red">{error.message}</Alert>;
  if (!r) return null;

  return (
    <div>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          Percentiles vs every pro-sup test in the database ({r.populationN}).
        </Text>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Select
            size="xs"
            w={190}
            data={r.sessions.map((d) => ({ value: d, label: `Test ${fmtDate(d)}` }))}
            value={r.sessionDate}
            onChange={(d) => d && setDate(d)}
            allowDeselect={false}
          />
        </Group>
      </Group>

      <div style={{ position: "relative", background: PAGE, maxWidth: 820, borderRadius: 8, padding: "26px 40px 36px 46px", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, width: 8, background: ACCENT }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ fontStyle: "italic", fontWeight: 700, fontSize: 22, lineHeight: 1.4, color: "#fff" }}>
            <div>Name: {r.athlete.name}</div>
            <div>Test Date: {r.sessionDate}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coach/8ctane-logo.png" alt="8ctane Baseball" style={{ width: 180, height: "auto" }} />
        </div>
        <div style={{ height: 2, background: ACCENT, margin: "12px -20px 26px -26px" }} />

        <div style={{ ...card, padding: "18px 40px 18px 170px", justifyContent: "space-between", marginBottom: 34 }}>
          <div>
            <div style={{ ...label, fontSize: 30 }}>Score</div>
            <div style={{ fontStyle: "italic", fontWeight: 700, fontSize: 58, lineHeight: 1.1, color: "#fff" }}>{n1(r.score)}</div>
          </div>
          <div style={{ marginRight: 90 }}>
            <RingGauge pct={r.scorePercentile} size={130} />
          </div>
        </div>

        {r.intervals.map((iv, i) => (
          <div key={iv.title} style={{ ...card, padding: "20px 28px 20px 50px", marginBottom: 34, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ minWidth: 270 }}>
              <div style={{ ...label, fontSize: 22, marginBottom: 8 }}>{iv.title}</div>
              <div style={line}>
                <span>Cumulative ROM:</span>
                <span>{n1(iv.cumulativeRom)}°</span>
              </div>
              <div style={line}>
                <span>Fatigue Index:</span>
                <span>{n1(iv.fatigueIndex)}%</span>
              </div>
              <div style={line}>
                <span>ROM:</span>
                <span>{n1(iv.forearmRom)}°</span>
              </div>
            </div>
            <RomBars values={r.romBars} highlight={i} />
            <RingGauge pct={iv.percentile} size={110} />
          </div>
        ))}
      </div>
    </div>
  );
}
