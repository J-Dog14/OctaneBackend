import { notFound } from "next/navigation";
import { DownloadView } from "../../../_components/DownloadView";

export default async function CoachDownloadPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(uuid)) notFound();
  return <DownloadView athleteUuid={uuid} />;
}
