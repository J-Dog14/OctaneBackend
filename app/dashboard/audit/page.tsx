import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { AuditContent } from "./AuditContent";

export default function AuditPage() {
  return (
    <AdminGuard>
      <AuditContent />
    </AdminGuard>
  );
}
