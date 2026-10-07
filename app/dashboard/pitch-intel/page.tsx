import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { PitchIntelContent } from "./PitchIntelContent";

/**
 * Pitch Intelligence: Baseball Savant data for linked athletes.
 * Admin-only while it holds linking and pull controls; the athlete report
 * tabs (Phase 5) will be open to all staff.
 */
export default function PitchIntelPage() {
  return (
    <AdminGuard>
      <PitchIntelContent />
    </AdminGuard>
  );
}
