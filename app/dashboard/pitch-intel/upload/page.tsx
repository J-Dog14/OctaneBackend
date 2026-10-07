import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { UploadContent } from "./UploadContent";

/** Pitch Intelligence uploads: Trackman files, Savant CSVs and screenshots. */
export default function PitchIntelUploadPage() {
  return (
    <AdminGuard>
      <UploadContent />
    </AdminGuard>
  );
}
