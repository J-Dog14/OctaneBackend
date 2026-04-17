import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { ReportsContent } from "./ReportsContent";

export default function ReportsPage() {
  return (
    <AdminGuard>
      <ReportsContent />
    </AdminGuard>
  );
}
