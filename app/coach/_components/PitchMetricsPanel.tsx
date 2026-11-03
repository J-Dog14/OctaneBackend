"use client";

/**
 * Mechanics + Flight: numbers for what's drawn beside it — the one pitch, or the average of
 * every selected pitch. Sized to sit next to the arm and hitter's views without scrolling.
 * Top: TrackMan in a 4 × 3 grid (xArsenal first). Bottom: biomechanics by segment, X / Y / Z
 * at foot contact, MER, release and +100 ms, with a positions ↔ angular velocities switch.
 */

import { useState } from "react";
import { Group, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import type { SyncPitch } from "@/lib/coach/pitchSync";
import type { ArmTrial } from "@/lib/coach/armFlight/load";
import { SEG_AXES, SEG_EVENTS, SEGMENTS, segKey } from "@/lib/coach/pitchSegments";
import { fmt } from "./fetcher";

function mean(xs: Array<number | null | undefined>): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const signed = (v: number | null, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt(v, digits)}`);

function Stat({ label, value, unit, help }: { label: string; value: React.ReactNode; unit?: string; help?: string }) {
  const body = (
    <div style={{ minWidth: 0 }}>
      <Text size="11px" c="dimmed" lh={1.15} truncate>
        {label}
      </Text>
      <Text component="div" fw={600} size="sm" lh={1.3}>
        {value}
        {unit && value !== "—" ? (
          <Text span size="10px" c="dimmed" fw={400}>
            {" "}
            {unit}
          </Text>
        ) : null}
      </Text>
    </div>
  );
  return help ? (
    <Tooltip label={help} multiline w={260} withArrow>
      {body}
    </Tooltip>
  ) : (
    body
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Group
      justify="space-between"
      align="center"
      wrap="nowrap"
      style={{
        borderBottom: "1px solid var(--border)",
        paddingBottom: 3,
        minHeight: 26,
      }}
    >
      <Text fw={700} size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: 0.6 }}>
        {children}
      </Text>
      {right}
    </Group>
  );
}

/** Why a pitch has no xArsenal grade, in words. */
export function xaReason(p: SyncPitch, status: { state: string; message: string | null } | null): string {
  if (!p.tm) return "No TrackMan pitch paired.";
  if (p.tm.xa?.score != null) return "";
  if (p.tm.xaMissing.length) return `Not graded: TrackMan didn't read ${p.tm.xaMissing.join(", ")} on this pitch.`;
  if (status && status.state !== "ok" && status.message) return status.message;
  if (p.tm.xa) return "The xArsenal service returned no grade for this pitch.";
  return "Not graded yet (run npm run pi:grade).";
}

const CELL = {
  textAlign: "right",
  paddingLeft: 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
} as const;

/** Fixed column widths so every card lines up under the shared event header and nothing spills. */
function SegTable({ children }: { children: React.ReactNode }) {
  return (
    <table
      style={{
        width: "100%",
        tableLayout: "fixed",
        borderCollapse: "collapse",
        fontSize: 11,
        lineHeight: "15px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <colgroup>
        <col style={{ width: "12%" }} />
        {SEG_EVENTS.map((e) => (
          <col key={e.id} style={{ width: `${88 / SEG_EVENTS.length}%` }} />
        ))}
      </colgroup>
      {children}
    </table>
  );
}

export function PitchMetricsPanel({
  pitches,
  names,
  arms,
  xaStatus,
}: {
  pitches: SyncPitch[];
  names: string[];
  arms: Array<ArmTrial | null>;
  xaStatus: { state: string; message: string | null } | null;
}) {
  const [mode, setMode] = useState<"angle" | "velocity">("angle");
  const n = pitches.length;
  if (!n) return null;
  const multi = n > 1;
  const paired = pitches.filter((p) => p.tm);
  const fl = (id: string) => mean(paired.map((p) => p.flight[id] ?? null));
  const f = (id: string, d = 1) => fmt(fl(id), d);
  const xaScores = paired.map((p) => p.tm!.xa?.score ?? null).filter((x): x is number => x != null);
  const xa = mean(xaScores);
  const stuff = mean(paired.map((p) => p.tm!.xa?.stuffPlus ?? null));
  const strides = arms.map((a) => a?.stride ?? null);
  const scope = multi ? `avg of ${n}` : (names[0] ?? "");

  return (
    <Stack gap={8}>
      {/* TRACKMAN */}
      <SectionTitle
        right={
          <Tooltip label={names.join(", ")} disabled={!multi} multiline w={260} withArrow>
            <Text size="xs" c="dimmed" truncate maw={220}>
              {scope}
              {multi && paired.length < n ? ` (${paired.length} with TrackMan)` : ""}
            </Text>
          </Tooltip>
        }
      >
        TrackMan
      </SectionTitle>
      {!paired.length ? (
        <Text size="sm" c="dimmed">
          No TrackMan pitch paired with {multi ? "these 3D trials" : "this 3D trial"}.
        </Text>
      ) : (
        <SimpleGrid cols={4} spacing={8} verticalSpacing={6}>
          <Stat
            label="xArsenal"
            help={
              xa != null
                ? `xArsenal v3 per pitch${multi ? `, averaged over ${xaScores.length} graded` : ""}. 50 = MLB average for the shape.${stuff != null ? ` 8-Stuff+ ${Math.round(stuff)}.` : ""}`
                : [...new Set(paired.map((p) => xaReason(p, xaStatus)))].join(" ")
            }
            value={xa == null ? "—" : String(Math.round(xa))}
            unit={stuff != null ? `Stuff+ ${Math.round(stuff)}` : undefined}
          />
          <Stat label="Velo" value={f("velo")} unit="mph" />
          <Stat label="Spin" value={f("spin", 0)} unit="rpm" />
          <Stat label="Extension" value={f("extension")} unit="ft" />
          <Stat label="HB (arm +)" value={f("hbArm")} unit="in" help="Horizontal break, arm side +" />
          <Stat label="IVB" value={f("ivb")} unit="in" />
          <Stat label="Spin eff" value={f("spinEff", 0)} unit="%" />
          <Stat label="Gyro" value={f("gyro", 0)} unit="°" />
          <Stat label="HAA" value={f("haa")} unit="°" />
          <Stat label="VAA" value={f("vaa")} unit="°" />
          <Stat label="Release side" value={f("relSideArm", 2)} unit="ft" help="Arm side +" />
          <Stat label="Release ht" value={f("relHeight", 2)} unit="ft" />
        </SimpleGrid>
      )}

      {/* BIOMECHANICS */}
      <SectionTitle
        right={
          <Group gap={10} wrap="nowrap">
            {(
              [
                ["angle", "Positions"],
                ["velocity", "Ang. velocities"],
              ] as const
            ).map(([v, label]) => (
              <UnstyledButton
                key={v}
                onClick={() => setMode(v)}
                aria-pressed={mode === v}
                style={{
                  fontSize: 11,
                  letterSpacing: 0.3,
                  color: mode === v ? "var(--mantine-color-text)" : "var(--mantine-color-dimmed)",
                  fontWeight: mode === v ? 600 : 400,
                  borderBottom: `1px solid ${mode === v ? "currentColor" : "transparent"}`,
                  paddingBottom: 1,
                }}
              >
                {label}
              </UnstyledButton>
            ))}
          </Group>
        }
      >
        Biomechanics
      </SectionTitle>
      <Group justify="space-between" gap={16} wrap="wrap" style={{ fontSize: 12, rowGap: 2, padding: "0 20px 0 14px" }}>
        <Tooltip label="Visual3D STRIDE_LENGTH" withArrow>
          <span>
            <Text span size="xs" c="dimmed">
              Stride{" "}
            </Text>
            <Text span size="sm" fw={600}>
              {fmt(mean(pitches.map((p) => p.mech.strideLength ?? null)), 1)}
            </Text>
            <Text span size="10px" c="dimmed">
              {" "}
              in
            </Text>
          </span>
        </Tooltip>
        <Tooltip label="Stride length as a % of the athlete's height (Visual3D STRIDE_LENGTH_MEAN_PERCENT)" withArrow>
          <span>
            <Text span size="xs" c="dimmed">
              Stride{" "}
            </Text>
            <Text span size="sm" fw={600}>
              {fmt(mean(pitches.map((p) => p.mech.stridePct ?? null)), 0)}
            </Text>
            <Text span size="10px" c="dimmed">
              % ht
            </Text>
          </span>
        </Tooltip>
        <Tooltip
          multiline
          w={260}
          withArrow
          label="Lead ankle at foot contact vs the drive ankle at max knee height, against the line to home plate. + = closed (lands toward the throwing-arm side), − = open."
        >
          <span>
            <Text span size="xs" c="dimmed">
              Direction{" "}
            </Text>
            <Text span size="sm" fw={600}>
              {signed(mean(strides.map((s) => s?.closedIn ?? null)))}
            </Text>
            <Text span size="10px" c="dimmed">
              {" "}
              in ({signed(mean(strides.map((s) => s?.angleDeg ?? null)))}°)
            </Text>
          </span>
        </Tooltip>
        <Tooltip
          multiline
          w={260}
          withArrow
          label="Pelvis center of mass path from max knee height to foot contact vs the line to home plate. + = closed (toward the throwing-arm side), − = open."
        >
          <span>
            <Text span size="xs" c="dimmed">
              COM drift{" "}
            </Text>
            <Text span size="sm" fw={600}>
              {signed(mean(pitches.map((p) => p.mech.comDriftDeg ?? null)))}
            </Text>
            <Text span size="10px" c="dimmed">
              °
            </Text>
          </span>
        </Tooltip>
      </Group>
      <SimpleGrid cols={2} spacing={6} verticalSpacing={4}>
        {/* One event header per column of cards (the cards share its column widths). */}
        {[0, 1].map((i) => (
          // same side padding + border as the cards so the columns line up
          <div key={`h${i}`} style={{ padding: "0 7px" }}>
            <SegTable>
              <thead>
                <tr>
                  <th />
                  {SEG_EVENTS.map((e) => (
                    <th
                      key={e.id}
                      title={e.long}
                      style={{
                        ...CELL,
                        fontWeight: 600,
                        color: "var(--mantine-color-dimmed)",
                      }}
                    >
                      {e.label}
                    </th>
                  ))}
                </tr>
              </thead>
            </SegTable>
          </div>
        ))}
        {SEGMENTS.map((s) => {
          const variable = mode === "angle" ? s.angle : s.velocity;
          if (!variable) return null;
          const rows = SEG_AXES.map((a) => ({
            a,
            vals: SEG_EVENTS.map((e) => mean(pitches.map((p) => p.seg[segKey(variable, e.id, a)] ?? null))),
          })).filter((r) => r.vals.some((v) => v != null));
          if (!rows.length) return null;
          return (
            <div
              key={s.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 6px 3px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  lineHeight: "16px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.label}
                <span
                  style={{
                    color: "var(--mantine-color-dimmed)",
                    fontWeight: 400,
                  }}
                >
                  {" "}
                  {mode === "angle" ? "°" : "°/s"}
                </span>
              </div>
              <SegTable>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.a}>
                      <td style={{ fontWeight: 600 }} title={s.hint?.[r.a] ?? (r.a === "X" ? "sagittal" : r.a === "Y" ? "frontal" : "transverse")}>
                        {r.a}
                      </td>
                      {r.vals.map((v, i) => (
                        <td key={i} style={CELL}>
                          {fmt(v, mode === "angle" ? 1 : 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </SegTable>
            </div>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
