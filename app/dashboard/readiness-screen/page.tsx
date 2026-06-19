import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { ReadinessScreenContent } from "./ReadinessScreenContent";

export default function ReadinessScreenPage() {
  return (
    <AdminGuard>
      <ReadinessScreenContent />
    </AdminGuard>
  );
}
