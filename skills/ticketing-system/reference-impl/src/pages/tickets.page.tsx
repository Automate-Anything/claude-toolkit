import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getSessionContext } from "@/lib/auth/session";
import { canWrite } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { TicketsShell } from "@/modules/ticketing/components/shell/tickets-shell";

export const metadata: Metadata = {
  title: "Tickets",
  description:
    "The internal ticket tracker — bugs, feature requests, and questions with status, priority, assignees, and comments.",
};

export default async function TicketsPage() {
  const session = await getSessionContext();

  // Ticketing is internal dev-support: contractors (and customer logins) don't
  // get it. Everyone else reads; write access follows the app's write roles.
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
    <Suspense
      fallback={<div className="h-[30rem] animate-pulse rounded-xl border bg-surface shadow-sm" />}
    >
      <TicketsShell canWrite={canWrite(session.role)} currentUserId={session.userId} />
    </Suspense>
  );
}
