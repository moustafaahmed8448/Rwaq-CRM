import { notFound } from "next/navigation";
import ClientDetailPage from "./ClientDetailPage";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetailPage clientId={id} />;
}
