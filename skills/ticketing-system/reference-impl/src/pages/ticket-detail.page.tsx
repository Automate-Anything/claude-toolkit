import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getSessionContext } from "@/lib/auth/session";
import { canWrite } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { TicketDetail } from "@/modules/ticketing/components/detail/ticket-detail";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const session = await getSessionContext();

  if (!session || session.role === "contractor" || session.isCustomer) {
    return (
      <EmptyState
        icon={Lock}
        title="You don't have access to tickets"
        description="The ticket tracker is for internal staff. If you think this is a mistake, reach out to an administrator."
        action={
          <Link href="/dashboard" className={buttonClassName({ variant: "outline" })}>
            Back to dashboard
          </Link>
        }
      />
    );
  }

  return (
    <TicketDetail
      id={numericId}
      canWrite={canWrite(session.role)}
      currentUserId={session.userId}
    />
  );
}
