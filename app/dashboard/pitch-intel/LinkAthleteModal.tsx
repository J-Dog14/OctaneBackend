"use client";

import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Stepper, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { SavantPlayer } from "@/lib/pitch-intel/savant/client";
import type { AthleteSuggestion } from "@/lib/pitch-intel/links";

interface Props {
  opened: boolean;
  onClose: () => void;
  onLinked: (athleteName: string) => void;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <UnstyledButton onClick={onClick} w="100%">
      <Paper withBorder p="sm" radius="md" style={{ borderColor: selected ? "var(--mantine-color-blue-6)" : undefined, borderWidth: selected ? 2 : 1 }}>
        {children}
      </Paper>
    </UnstyledButton>
  );
}

/**
 * Three-step link flow:
 *   1. search Savant (name, MLB ID or Savant URL) and pick the player
 *   2. pick the matching athlete from the closest d_athletes names
 *   3. confirm -> link saved, backfill starts, nightly pulls from then on
 */
export function LinkAthleteModal({ opened, onClose, onLinked }: Props) {
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<SavantPlayer[] | null>(null);
  const [player, setPlayer] = useState<SavantPlayer | null>(null);
  const [matches, setMatches] = useState<AthleteSuggestion[] | null>(null);
  const [athlete, setAthlete] = useState<AthleteSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep(0);
    setQuery("");
    setPlayers(null);
    setPlayer(null);
    setMatches(null);
    setAthlete(null);
    setError(null);
    setLoading(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setPlayers(null);
    setPlayer(null);
    try {
      const { players } = await getJson<{ players: SavantPlayer[] }>(`/api/dashboard/pitch-intel/savant-search?q=${encodeURIComponent(query.trim())}`);
      setPlayers(players);
      if (players.length === 1) setPlayer(players[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function toAthleteStep() {
    if (!player) return;
    setStep(1);
    setLoading(true);
    setError(null);
    setMatches(null);
    setAthlete(null);
    try {
      const { matches } = await getJson<{ matches: AthleteSuggestion[] }>(`/api/dashboard/pitch-intel/athlete-matches?name=${encodeURIComponent(player.name)}`);
      setMatches(matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matching failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!player || !athlete) return;
    setLoading(true);
    setError(null);
    try {
      await getJson("/api/dashboard/pitch-intel/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteUuid: athlete.athlete_uuid,
          player: { id: player.id, name: player.name, throws: player.throws, league: player.league, isMlb: player.isMlb },
        }),
      });
      onLinked(athlete.name);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Link athlete to Baseball Savant" size="lg">
      <Stepper active={step} size="sm" allowNextStepsSelect={false} onStepClick={(s) => s < step && setStep(s)}>
        <Stepper.Step label="Savant player">
          <Stack gap="sm" mt="md">
            <Group align="flex-end" gap="xs">
              <TextInput
                flex={1}
                label="Pitcher"
                placeholder="Name, MLB ID or Savant player URL"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                data-autofocus
              />
              <Button onClick={search} loading={loading} disabled={query.trim().length < 2}>
                Search
              </Button>
            </Group>
            {players && players.length === 0 && (
              <Text size="sm" c="dimmed">
                No Savant players found. Try the full name or paste the Savant player URL.
              </Text>
            )}
            {players?.map((p) => (
              <Choice key={p.id} selected={player?.id === p.id} onClick={() => setPlayer(p)}>
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={500}>{p.name}</Text>
                    <Text size="xs" c="dimmed">
                      {[p.team, p.league, p.lastYear ? `last season ${p.lastYear}` : null].filter(Boolean).join(" · ")}
                    </Text>
                  </div>
                  <Group gap={6} wrap="nowrap">
                    {p.position && <Badge variant="light">{p.position}</Badge>}
                    <Text size="xs" c="dimmed">
                      {p.id}
                    </Text>
                  </Group>
                </Group>
              </Choice>
            ))}
            <Group justify="flex-end">
              <Button onClick={toAthleteStep} disabled={!player}>
                Next
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Our athlete">
          <Stack gap="sm" mt="md">
            <Text size="sm">
              Closest athletes in the database to <b>{player?.name}</b>. Pick the right one.
            </Text>
            {loading && <Loader size="sm" />}
            {matches?.map((m) => (
              <Choice key={m.athlete_uuid} selected={athlete?.athlete_uuid === m.athlete_uuid} onClick={() => !m.linked_to && setAthlete(m)}>
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={500} c={m.linked_to ? "dimmed" : undefined}>
                      {m.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[m.age_group, m.date_of_birth ? `DOB ${m.date_of_birth}` : null].filter(Boolean).join(" · ") || "—"}
                      {m.linked_to ? ` · already linked to ${m.linked_to.source_player_name}` : ""}
                    </Text>
                  </div>
                  <Badge color={m.score >= 95 ? "green" : m.score >= 85 ? "yellow" : "gray"} variant="light">
                    {m.score}% match
                  </Badge>
                </Group>
              </Choice>
            ))}
            <Text size="xs" c="dimmed">
              Not listed? Add the athlete on the Athletes page first, then link them here.
            </Text>
            <Group justify="space-between">
              <Button variant="default" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)} disabled={!athlete}>
                Next
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Confirm">
          <Stack gap="sm" mt="md">
            <Text size="sm">
              Link <b>{athlete?.name}</b> to Savant player <b>{player?.name}</b> ({player?.id}
              {player?.throws ? `, ${player.throws}HP` : ""}).
            </Text>
            <Text size="sm" c="dimmed">
              This pulls the current and previous two seasons now, then picks up new games every night.
            </Text>
            <Group justify="space-between">
              <Button variant="default" onClick={() => setStep(1)} disabled={loading}>
                Back
              </Button>
              <Button onClick={confirm} loading={loading}>
                Link and pull data
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
      </Stepper>

      {error && (
        <Alert color="red" mt="md">
          {error}
        </Alert>
      )}
    </Modal>
  );
}
