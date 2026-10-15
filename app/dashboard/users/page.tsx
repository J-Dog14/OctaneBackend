"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Paper, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { AdminGuard } from "@/app/dashboard/AdminGuard";

type Role = "user" | "coach" | "admin";
type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  lastSignInAt: number | null;
};

const ROLE_OPTIONS = [
  { value: "user", label: "Staff" },
  { value: "coach", label: "Coach" },
  { value: "admin", label: "Admin" },
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
};

function UsersContent() {
  const { data, error, isLoading, mutate } = useSWR<{ users: UserRow[] }>("/api/dashboard/users", fetcher);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function setRole(userId: string, role: Role) {
    setSaving(userId);
    setSaveError(null);
    try {
      const res = await fetch("/api/dashboard/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSaving(null);
    }
  }

  const q = query.trim().toLowerCase();
  const users = (data?.users ?? []).filter(
    (u) => !q || u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q)
  );

  return (
    <Stack gap="md" maw={960}>
      <div>
        <Title order={2}>Users</Title>
        <Text c="dimmed" size="sm">
          Roles are stored in Clerk (publicMetadata.role). Staff see the backend, Coaches see only the coach view,
          Admins see everything. Changes apply on the user&apos;s next page load.
        </Text>
      </div>

      {error && <Alert color="red">{error.message}</Alert>}
      {saveError && <Alert color="red" withCloseButton onClose={() => setSaveError(null)}>{saveError}</Alert>}

      <TextInput placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.currentTarget.value)} maw={320} />

      <Paper withBorder>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Last sign-in</Table.Th>
              <Table.Th>Role</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">Loading…</Text></Table.Td></Table.Tr>
            )}
            {!isLoading && users.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">No users found.</Text></Table.Td></Table.Tr>
            )}
            {users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name ?? <Text c="dimmed" size="sm">—</Text>}</Table.Td>
                <Table.Td>{u.email ?? "—"}</Table.Td>
                <Table.Td>
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : <Badge variant="light" color="gray">Never</Badge>}
                </Table.Td>
                <Table.Td>
                  <SegmentedControl
                    size="xs"
                    data={ROLE_OPTIONS}
                    value={u.role}
                    disabled={saving === u.id}
                    onChange={(v) => v !== u.role && setRole(u.id, v as Role)}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

export default function UsersPage() {
  return (
    <AdminGuard>
      <UsersContent />
    </AdminGuard>
  );
}
