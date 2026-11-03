"use client";

/**
 * Pitching tab → Flight: every TrackMan / Savant pitch of a session drawn in flight, from the
 * pitcher's view (on the mound, ball only) and the hitter's view (catcher / batter's eye), with
 * the highlighted pitch's spin axis spinning in the corner. Same geometry as TM + 3D, no arm.
 *
 * Flights come from the pitch's own release point, plate location and break (geometry.ts
 * flightPath); pitches without that full read (velo-only) aren't drawn.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ActionIcon, Alert, Group, Loader, SegmentedControl, Select, SimpleGrid, Slider, Stack, Text, Tooltip } from "@mantine/core";
import type { PitchLog, PitchRow, PitchSessionRef } from "@/lib/coach/pitchLog";
import { PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import { flightPath, spinAxisFromFlight } from "@/lib/coach/armFlight/geometry";
import { fmt, fmtDate, swrOpts } from "./fetcher";
import { HitterViewPanel, PitcherViewPanel, type Batter, type FlightBall } from "./ballFlight";
import { PitchListPicker, type PickItem } from "./PitchPicker";

const base = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/pitches`;

function sessionLabel(s: PitchSessionRef): string {
  const what = s.source === "savant" ? `Game · Savant${s.detail ? ` ${s.detail}` : ""}` : s.kind === "game" ? "Game · Trackman" : "Bullpen · Trackman";
  return `${fmtDate(s.date)} · ${what} · ${s.pitches} P`;
}

/** The playback speeds: how long the ~0.4 s flight takes on screen. */
const SPEEDS = [
  { value: "1000", label: "≈1 s" },
  { value: "3000", label: "≈3 s" },
  { value: "real", label: "Real speed" },
];

function toBall(p: PitchRow): FlightBall | null {
  const flight = flightPath({
    veloMph: p.velo,
    relSide: p.relSide,
    relHeight: p.relHeight,
    extension: p.extension,
    plateSide: p.plateSide,
    plateHeight: p.plateHeight,
    ivbIn: p.ivb,
    hbIn: p.hb,
  });
  if (!flight) return null;
  return {
    key: p.id,
    color: PITCH_COLORS[p.type],
    flight,
    spin: { rpm: p.spin, eff: p.spinEff, tilt: p.tilt, axis: spinAxisFromFlight(flight.path, p.spinEff) },
  };
}

const groupLabel = (c: PitchCode) => {
  const l = PITCH_LABELS[c] ?? c;
  return l.endsWith("s") ? l : `${l}s`;
};

export function PitchFlightView({ athleteUuid }: { athleteUuid: string }) {
  const { data: sessData, error: sessErr, isLoading: sessLoading } = useSWR<{ sessions: PitchSessionRef[] }>(`${base(athleteUuid)}/sessions`, swrOpts);
  const sessions = useMemo(() => sessData?.sessions ?? [], [sessData]);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const active = sessionKey ?? sessions[0]?.key ?? null;
  const url = active ? `${base(athleteUuid)}?session=${encodeURIComponent(active)}` : null;
  const { data, error, isLoading } = useSWR<PitchLog>(url, { ...swrOpts, keepPreviousData: true });

  const rows = useMemo(() => data?.pitches ?? [], [data]);
  const ballById = useMemo(() => {
    const m = new Map<string, FlightBall>();
    for (const p of rows) {
      const b = toBall(p);
      if (b) m.set(p.id, b);
    }
    return m;
  }, [rows]);
  const drawable = useMemo(() => rows.filter((p) => ballById.has(p.id)), [rows, ballById]);
  /** Short names like TM + 3D: pitch type + its count within the type this session ("Sinker 4"). */
  const names = useMemo(() => {
    const n = new Map<PitchCode, number>();
    return new Map(drawable.map((p) => {
      const i = (n.get(p.type) ?? 0) + 1;
      n.set(p.type, i);
      return [p.id, `${PITCH_LABELS[p.type]} ${i}`];
    }));
  }, [drawable]);
  const pickItems: PickItem[] = useMemo(
    () => drawable.map((p) => ({ key: p.id, name: names.get(p.id) ?? "", color: PITCH_COLORS[p.type], group: p.type, groupLabel: groupLabel(p.type), velo: p.velo })),
    [drawable, names],
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  /** Pitches drawn (throw order); null = just the highlighted one. */
  const [picked, setPicked] = useState<string[] | null>(null);
  const [batter, setBatter] = useState<Batter>("C");
  const [speed, setSpeed] = useState("1000");
  const [ms, setMs] = useState<number | null>(null); // null = parked at the plate
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  // New session: back to the first pitch, all types, parked at the plate.
  const [shownUrl, setShownUrl] = useState(url);
  if (shownUrl !== url) {
    setShownUrl(url);
    setFocusId(null);
    setPicked(null);
    setMs(null);
    setPlaying(false);
  }

  const focus = drawable.find((p) => p.id === focusId) ?? drawable[0] ?? null;
  const selected = picked ?? (focus ? [focus.id] : []);
  const shownRows = drawable.filter((p) => selected.includes(p.id));
  const balls = shownRows.map((p) => ballById.get(p.id)!);
  const tMax = Math.max(1, ...balls.map((b) => b.flight.flightMs));
  const now = ms == null ? tMax : Math.min(ms, tMax);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (t: number) => {
      const dt = t - last;
      last = t;
      const rate = speed === "real" ? 1 : tMax / Number(speed);
      setMs((m) => {
        const n = (m ?? 0) + dt * rate;
        if (n >= tMax) {
          setPlaying(false);
          return null;
        }
        return n;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, tMax]);

  if (sessLoading) return <Loader size="sm" />;
  if (sessErr) return <Alert color="red">{sessErr.message}</Alert>;
  if (!sessions.length) return <Text c="dimmed">No pitch-by-pitch sessions yet.</Text>;

  // Same rules as TM + 3D: picking a pitch that's already in a multi-selection only moves the
  // highlight; otherwise the selection becomes that pitch.
  const pick = (id: string) => {
    setFocusId(id);
    if (!(selected.length > 1 && selected.includes(id))) setPicked([id]);
  };
  const select = (ids: string[]) => {
    setPicked(ids);
    if (ids.length && (!focus || !ids.includes(focus.id))) setFocusId(ids[0]!);
  };
  const missing = rows.length - drawable.length;
  const spinTxt = focus
    ? [
        focus.spin != null ? `${fmt(focus.spin, 0)} rpm` : null,
        focus.tilt,
        focus.spinEff != null ? `${fmt(focus.spinEff <= 1 ? focus.spinEff * 100 : focus.spinEff, 0)}% eff` : null,
        focus.ivb != null ? `IVB ${fmt(focus.ivb)}` : null,
        focus.hb != null ? `HB ${fmt(focus.hb)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Session"
          data={sessions.map((s) => ({ value: s.key, label: sessionLabel(s) }))}
          value={active}
          onChange={setSessionKey}
          w={360}
          allowDeselect={false}
          searchable
        />
        <div>
          <Text size="sm" fw={500} mb={4}>Pitches</Text>
          <PitchListPicker items={pickItems} selected={selected} focusKey={focus?.id ?? null} onPick={pick} onSelect={select} />
        </div>
      </Group>


      {error && !data ? (
        <Alert color="red">{error.message}</Alert>
      ) : isLoading && !data ? (
        <Loader size="sm" />
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" style={{ alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>
              <Group justify="space-between" mb={4} wrap="nowrap" h={28}>
                <Text fw={600} size="sm">Pitcher&apos;s view</Text>
              </Group>
              <PitcherViewPanel balls={balls} focusKey={focus?.id ?? null} ms={now} emptyText="No pitch in this session has the full TrackMan read (release point, plate location and break) to draw." />
              <Text size="xs" c="dimmed" mt={4}>
                From just behind the release point on the mound, looking down the line to the plate (true scale: the plate is ~55 ft out). The ball leaves a trail behind it.
              </Text>
            </div>
            <div style={{ minWidth: 0 }}>
              <Group justify="space-between" mb={4} wrap="nowrap" h={28}>
                <Text fw={600} size="sm">Hitter&apos;s view</Text>
                <SegmentedControl size="xs" value={batter} onChange={(v) => setBatter(v as Batter)} data={[{ value: "C", label: "Catcher" }, { value: "R", label: "RHB eye" }, { value: "L", label: "LHB eye" }]} />
              </Group>
              <HitterViewPanel balls={balls} focusKey={focus?.id ?? null} ms={now} batter={batter} emptyText="No pitch in this session has the full TrackMan read (release point, plate location and break) to draw." />
              <Text size="xs" c="dimmed" mt={4}>
                True perspective from behind the plate (or the batter&apos;s eye): the ball barely moves on screen for most of its flight, then rushes in.
              </Text>
            </div>
          </SimpleGrid>

          <Group gap="sm" align="center" wrap="nowrap">
            <ActionIcon
              variant="light"
              size="lg"
              aria-label={playing ? "Pause" : "Play"}
              disabled={!balls.length}
              onClick={() => {
                if (!playing && ms == null) setMs(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "❚❚" : "▶"}
            </ActionIcon>
            <div style={{ flex: 1 }}>
              <Slider
                min={0}
                max={Math.round(tMax)}
                step={1}
                value={Math.round(now)}
                onChange={(v) => {
                  setPlaying(false);
                  setMs(v >= tMax ? null : v);
                }}
                label={(v) => `+${v} ms`}
                marks={[
                  { value: 0, label: "Release" },
                  { value: Math.round(tMax), label: "Plate" },
                ]}
              />
            </div>
            <Tooltip label="How long the flight takes on screen" withArrow>
              <Select size="xs" w={110} value={speed} onChange={(v) => v && setSpeed(v)} data={SPEEDS} allowDeselect={false} />
            </Tooltip>
          </Group>
          <Text size="sm" mt={6}>
            {focus ? (
              <>
                <b>{names.get(focus.id)}{focus.velo != null ? ` · ${fmt(focus.velo)} MPH` : ""}</b>
                {spinTxt.length ? ` · ${spinTxt.join(" · ")}` : ""} · <b>+{Math.round(now)} ms</b> after release
              </>
            ) : null}
          </Text>
          <Text size="xs" c="dimmed">
            The ball spins in flight about the axis its own flight implies (the line through it, in the pitch color): the movement sets the spin direction,
            spin efficiency tips it toward the plate as gyro. Spin is shown ~5× slower than real so it can be followed.
            {missing > 0 ? ` ${missing} of ${rows.length} pitches have no full TrackMan read (velo only) and aren't drawn.` : ""}
          </Text>
        </>
      )}
    </Stack>
  );
}
