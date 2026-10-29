import { notFound } from "next/navigation";
import { ClientProfile } from "../../_components/clientHub/ClientProfile";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <ClientProfile clientId={id} />;
}
