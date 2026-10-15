import { notFound } from "next/navigation";
import { AthleteView } from "../../_components/AthleteView";

export default async function CoachAthletePage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(uuid)) notFound();
  return <AthleteView athleteUuid={uuid} />;
}
