import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { SessionsContent } from "./SessionsContent";

/**
 * Trackman sessions (games and bullpens) and saved screenshot reports for one
 * athlete, with per-pitch-type averages and xArsenal grades. ?athlete=<uuid>.
 */
export default async function PitchIntelSessionsPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const { athlete } = await searchParams;
  const athleteId = athlete && /^[A-Za-z0-9-]{1,64}$/.test(athlete) ? athlete : null;
  return (
    <AdminGuard>
      <SessionsContent athleteUuid={athleteId} />
    </AdminGuard>
  );
}
