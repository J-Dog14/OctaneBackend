"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, type ColDef, type IRowNode } from "ag-grid-community";
import Link from "next/link";
import { TextInput, Checkbox, Group } from "@mantine/core";
import { AthleteUpdateEmailButton } from "./AthleteUpdateEmailButton";
import { octaneTheme } from "../ag-grid-theme";

ModuleRegistry.registerModules([AllCommunityModule]);

type AthleteRow = {
  athlete_uuid: string;
  name: string;
  gender: string | null;
  age_group: string | null;
  email?: string | null;
  pitching_session_count: number;
  athletic_screen_session_count: number;
  proteus_session_count: number;
  mobility_session_count: number;
  readiness_screen_session_count: number;
  arm_action_session_count: number;
  hitting_session_count: number;
  curveball_test_session_count: number;
};

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()).then((d) => d.items ?? []);

type SyncResult = {
  total: number;
  checked: number;
  matched: number;
  alreadyLinked: number;
  notFound: number;
  errors: number;
  errorDetails?: { name: string; email: string; error: string }[];
};

export function AthletesGrid() {
  const gridRef = useRef<AgGridReact<AthleteRow>>(null);
  const [filterText, setFilterText] = useState("");
  const [filterNonApp, setFilterNonApp] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const { data: rowData = null, isLoading: loading } = useSWR<AthleteRow[]>(
    "/api/dashboard/athletes?limit=10000",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const columnDefs = useMemo<ColDef<AthleteRow>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        flex: 2,
        minWidth: 150,
        pinned: "left",
        cellRenderer: ({ data }: { data: AthleteRow }) => (
          <Link href={`/dashboard/athletes/${data.athlete_uuid}`}>{data.name}</Link>
        ),
      },
      {
        headerName: "Gender",
        field: "gender",
        flex: 1,
        minWidth: 80,
        valueFormatter: ({ value }) => (value as string | null) ?? "—",
      },
      {
        headerName: "Age Group",
        field: "age_group",
        flex: 1,
        minWidth: 100,
        valueFormatter: ({ value }) => (value as string | null) ?? "—",
      },
      {
        headerName: "Email",
        field: "email",
        flex: 2,
        minWidth: 180,
        cellRenderer: ({ value }: { value: string | null | undefined }) =>
          value ? (
            <span>{value}</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>no email</span>
          ),
      },
      { headerName: "Pitching",        field: "pitching_session_count",          flex: 1, minWidth: 90  },
      { headerName: "Athletic Screen", field: "athletic_screen_session_count",    flex: 1, minWidth: 130 },
      { headerName: "Proteus",         field: "proteus_session_count",            flex: 1, minWidth: 90  },
      { headerName: "Mobility",        field: "mobility_session_count",           flex: 1, minWidth: 90  },
      { headerName: "Readiness",       field: "readiness_screen_session_count",   flex: 1, minWidth: 100 },
      { headerName: "Arm Action",      field: "arm_action_session_count",         flex: 1, minWidth: 110 },
      { headerName: "Hitting",         field: "hitting_session_count",            flex: 1, minWidth: 80  },
      { headerName: "Curveball",       field: "curveball_test_session_count",     flex: 1, minWidth: 100 },
      {
        headerName: "",
        colId: "actions",
        width: 160,
        sortable: false,
        resizable: false,
        pinned: "right",
        cellRenderer: ({ data }: { data: AthleteRow }) => (
          <Group gap={6} h="100%" align="center" wrap="nowrap">
            <Link href={`/dashboard/athletes/${data.athlete_uuid}`}>View</Link>
            {(!data.email || data.email === "") && (
              <AthleteUpdateEmailButton athleteUuid={data.athlete_uuid} name={data.name} />
            )}
          </Group>
        ),
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true }), []);

  const onGridReady = useCallback(() => {}, []);

  const runBulkEmailMatch = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/dashboard/athletes/bulk-email-match", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
    } finally {
      setSyncing(false);
    }
  }, []);

  const isExternalFilterPresent = useCallback(() => filterNonApp, [filterNonApp]);

  const doesExternalFilterPass = useCallback(
    ({ data }: IRowNode<AthleteRow>) => {
      if (!filterNonApp) return true;
      return !data?.email;
    },
    [filterNonApp]
  );

  return (
    <>
      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search athletes…"
          value={filterText}
          onChange={(e) => {
            const val = e.target.value;
            setFilterText(val);
            gridRef.current?.api?.setGridOption("quickFilterText", val);
          }}
          style={{ maxWidth: 280 }}
          size="sm"
        />
        <Checkbox
          label="Non-app athletes only"
          checked={filterNonApp}
          onChange={(e) => {
            setFilterNonApp(e.target.checked);
            setTimeout(() => gridRef.current?.api?.onFilterChanged(), 0);
          }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={runBulkEmailMatch}
          disabled={syncing}
          style={{ padding: "0.35rem 0.75rem", fontSize: "13px" }}
        >
          {syncing ? "Syncing…" : "Sync Octane Match"}
        </button>
        {syncResult && (
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {syncResult.matched} matched · {syncResult.notFound} not found · {syncResult.alreadyLinked} already linked
            {syncResult.errors > 0 && ` · ${syncResult.errors} errors`}
          </span>
        )}
        {syncResult?.errorDetails && syncResult.errorDetails.length > 0 && (
          <div style={{ fontSize: "12px", color: "var(--color-error, #e03131)", marginTop: "0.25rem", width: "100%" }}>
            {syncResult.errorDetails.map((e, i) => (
              <div key={i}>{e.name} ({e.email}): {e.error}</div>
            ))}
          </div>
        )}
      </Group>

      <div style={{ height: "calc(100vh - 300px)", minHeight: 400 }}>
        <AgGridReact
          theme={octaneTheme}
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          onGridReady={onGridReady}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          pagination
          paginationPageSize={50}
          loading={loading}
          suppressMovableColumns={false}
          suppressCellFocus
        />
      </div>
    </>
  );
}
