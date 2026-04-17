import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { UaisMaintenanceContent } from "./UaisMaintenanceContent";

export default function UaisMaintenancePage() {
  return (
    <AdminGuard>
      <UaisMaintenanceContent />
    </AdminGuard>
  );
}
