"use client";

import { useMemo, useEffect, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, type ColDef } from "ag-grid-community";
import Link from "next/link";
import { octaneTheme } from "./ag-grid-theme";
import type { RecentAthlete } from "@/lib/dashboard/athletes";

ModuleRegistry.registerModules([AllCommunityModule]);

export function RecentAthletesGrid({ athletes }: { athletes: RecentAthlete[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const columnDefs = useMemo<ColDef<RecentAthlete>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        flex: 2,
        minWidth: 140,
        cellRenderer: ({ data }: { data: RecentAthlete }) => (
          <Link href={`/dashboard/athletes/${data.athlete_uuid}`}>{data.name}</Link>
        ),
      },
      {
        headerName: "Gender",
        field: "gender",
        flex: 1,
        minWidth: 80,
        valueFormatter: ({ value }) => value ?? "—",
      },
      {
        headerName: "Age Group",
        field: "age_group",
        flex: 1,
        minWidth: 100,
        valueFormatter: ({ value }) => value ?? "—",
      },
      {
        headerName: "Pitching",
        field: "pitching_session_count",
        flex: 1,
        minWidth: 90,
      },
      {
        headerName: "Athletic Screen",
        field: "athletic_screen_session_count",
        flex: 1,
        minWidth: 130,
      },
      {
        headerName: "Last Data Added",
        field: "last_data_at",
        flex: 1,
        minWidth: 130,
        valueFormatter: ({ value }) =>
          value ? new Date(value as Date | string).toLocaleDateString() : "—",
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true }),
    []
  );

  if (!mounted) return <div style={{ height: 300 }} />;

  return (
    <div style={{ height: 300 }}>
      <AgGridReact
        theme={octaneTheme}
        rowData={athletes}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        suppressMovableColumns
        suppressCellFocus
      />
    </div>
  );
}
