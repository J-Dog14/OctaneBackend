export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { buildAthleteReportPayload } from "@/lib/octane/reportPayload";
import { AthleteUpdateEmailButton } from "../AthleteUpdateEmailButton";

const COUNT_LABELS: Record<string, string> = {
  armAction: "Arm action",
  athleticScreen: "Athletic screen",
  mobility: "Mobility",
  proSup: "Pro sup",
  proteus: "Proteus",
  readinessScreen: "Readiness screen",
  kinematicsPitching: "Kinematics (pitching)",
  kinematicsHitting: "Kinematics (hitting)",
  curveballTest: "Curveball test",
};

export default async function AthleteDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  let payload;
  try {
    payload = await buildAthleteReportPayload(uuid);
  } catch (e) {
    notFound();
  }

  const { athlete, counts } = payload;

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/dashboard/athletes"
          className="text-muted"
          style={{ fontSize: "14px" }}
        >
          ← Back to athletes
        </Link>
      </div>
      <h1 style={{ marginBottom: "0.25rem", fontSize: "1.75rem" }}>
        {athlete.name}
      </h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem", fontSize: "14px" }}>
        {athlete.athleteUuid}
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Demographics
        </h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1.5rem", margin: 0 }}>
          <dt className="text-muted">DOB</dt>
          <dd>{athlete.dateOfBirth ? new Date(athlete.dateOfBirth).toLocaleDateString() : "—"}</dd>
          <dt className="text-muted">Gender</dt>
          <dd>{athlete.gender ?? "—"}</dd>
          <dt className="text-muted">Email</dt>
          <dd>{athlete.email ?? <span className="text-muted">no email</span>}</dd>
          <dt className="text-muted">Height</dt>
          <dd>{athlete.height ?? "—"}</dd>
          <dt className="text-muted">Weight</dt>
          <dd>{athlete.weight ?? "—"}</dd>
        </dl>
        {(!athlete.email || athlete.email === "") && (
          <div style={{ marginTop: "0.75rem" }}>
            <AthleteUpdateEmailButton athleteUuid={athlete.athleteUuid} name={athlete.name} />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Session counts (instances per table)
        </h2>
        <table>
          <thead>
            <tr>
              <th>Table / payload type</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(counts).map(([key, value]) => (
              <tr key={key}>
                <td>{COUNT_LABELS[key] ?? key}</td>
                <td>
                  <span className={value > 0 ? "text-accent" : "text-muted"}>
                    {value}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <Link
          href={`/dashboard/send-payload?athlete=${encodeURIComponent(athlete.athleteUuid)}`}
          className="btn-primary"
          style={{ display: "inline-block" }}
        >
          Send payload for this athlete
        </Link>
      </div>
    </div>
  );
}
