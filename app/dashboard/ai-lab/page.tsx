import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { AiLabContent } from "./AiLabContent";

export default function AiLabPage() {
  return (
    <AdminGuard>
      <AiLabContent />
    </AdminGuard>
  );
}
