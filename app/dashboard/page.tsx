export const dynamic = "force-dynamic";

import Link from "next/link";
import { getRecentAthletes } from "@/lib/dashboard/athletes";

export default async function DashboardPage() {
  const recentAthletes = await getRecentAthletes(20);

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>
        Dashboard
      </h1>
      <p className="text-muted" style={{ marginBottom: "2rem" }}>
        Overview and quick actions for athletes and payloads.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <Link
          href="/dashboard/athletes"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card" style={{ height: "100%" }}>
            <div className="text-muted" style={{ fontSize: "12px", marginBottom: "4px" }}>
              Athletes
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)" }}>
              Browse all
            </div>
            <p className="text-muted" style={{ margin: "0.5rem 0 0", fontSize: "13px" }}>
              Search and view athlete data and session counts.
            </p>
          </div>
        </Link>
      </div>

      <section className="card">
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
          Recently modified athletes
        </h2>
        {recentAthletes.length === 0 ? (
          <p className="text-muted">No athletes in the database yet.</p>
        ) : (
          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Age group</th>
                  <th>Pitching</th>
                  <th>Athletic screen</th>
                  <th>Last modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentAthletes.map((a) => (
                  <tr key={a.athlete_uuid}>
                    <td>{a.name}</td>
                    <td>{a.gender ?? "—"}</td>
                    <td>{a.age_group ?? "—"}</td>
                    <td>{a.pitching_session_count}</td>
                    <td>{a.athletic_screen_session_count}</td>
                    <td className="text-muted" style={{ fontSize: "12px" }}>
                      {a.updated_at
                        ? new Date(a.updated_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      <Link href={`/dashboard/athletes/${a.athlete_uuid}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: "1rem" }}>
          <Link href="/dashboard/athletes" className="btn-primary" style={{ display: "inline-block" }}>
            View all athletes
          </Link>
        </div>
      </section>
    </div>
  );
}
