"use client";

import { Badge, Card, Group, Text, Select } from "@mantine/core";

type AthleteItem = { athlete_uuid: string; name: string };

interface Props {
  searchResults: AthleteItem[];
  addAthleteQuery: string;
  onSearchChange: (q: string) => void;
  loadingSearch: boolean;
  trackedUuids: string[];
  currentUuid: string;
  knownNames: Record<string, string>;
  onSelect: (uuid: string) => void;
  onSetCurrent: (uuid: string) => void;
  onRemove: (uuid: string) => void;
}

export function AthleteSelectionPanel({
  searchResults,
  addAthleteQuery,
  onSearchChange,
  loadingSearch,
  trackedUuids,
  currentUuid,
  knownNames,
  onSelect,
  onSetCurrent,
  onRemove,
}: Props) {
  return (
    <Card>
      <Text fw={600} size="sm" mb="xs">Select athlete</Text>
      <Select
        placeholder="Search by name…"
        data={searchResults.map((a) => ({ value: a.athlete_uuid, label: a.name }))}
        searchable
        searchValue={addAthleteQuery}
        onSearchChange={onSearchChange}
        onChange={(uuid) => {
          if (!uuid) return;
          onSelect(uuid);
        }}
        value={null}
        nothingFoundMessage={loadingSearch ? "Searching…" : "No athletes found"}
        w={280}
        size="sm"
        mb="sm"
        clearable
      />

      <Text fw={600} size="sm" mb={6}>Selected athlete</Text>
      {trackedUuids.length === 0 ? (
        <Text c="dimmed" size="sm">Search for an athlete above to get started.</Text>
      ) : (
        <Group gap={6} wrap="wrap">
          {trackedUuids.map((uuid) => {
            const name = knownNames[uuid] ?? uuid.slice(0, 8);
            const isCurrent = currentUuid === uuid;
            return (
              <Badge
                key={uuid}
                variant={isCurrent ? "light" : "outline"}
                color={isCurrent ? "octaneBlue" : "gray"}
                size="lg"
                style={{ cursor: "pointer" }}
                onClick={() => onSetCurrent(uuid)}
                rightSection={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(uuid);
                    }}
                    style={{ all: "unset", cursor: "pointer", lineHeight: 1, marginLeft: 2 }}
                    aria-label={`Remove ${name}`}
                  >
                    ×
                  </button>
                }
              >
                {name}
              </Badge>
            );
          })}
        </Group>
      )}
    </Card>
  );
}
