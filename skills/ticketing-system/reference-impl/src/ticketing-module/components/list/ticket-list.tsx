"use client";

/**
 * Ticket list — the dense, sortable table view. Reuses the window-virtualized
 * `DataTable` (sticky header ≥768px, stacked cards below it). Sorting is applied
 * client-side over the already-fetched feed (dev ticket volumes are small, and
 * the board/list share one query).
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn, type SortState } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { statusLabel } from "@/config/status-map";
import { priorityRank } from "../../priority";
import type { TicketListItem } from "../../types";
import { AssigneeChip, LabelChips, PriorityPill, TypeCell, ticketTypeLabel } from "../cells";

/** Short, stable "updated" label; full timestamp in the title attribute. */
function updatedLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - then) / 3_600_000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compare(a: TicketListItem, b: TicketListItem, column: string): number {
  switch (column) {
    case "number":
      return a.number.localeCompare(b.number, undefined, { numeric: true });
    case "title":
      return a.title.localeCompare(b.title);
    case "type":
      return ticketTypeLabel(a.type).localeCompare(ticketTypeLabel(b.type));
    case "priority":
      return priorityRank(a.priority) - priorityRank(b.priority);
    case "status":
      return statusLabel("ticket", a.status).localeCompare(statusLabel("ticket", b.status));
    case "assignee":
      return (a.assignee_name ?? "~").localeCompare(b.assignee_name ?? "~");
    case "updated":
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    default:
      return 0;
  }
}

export function TicketList({ items }: { items: TicketListItem[] }) {
  const [sort, setSort] = React.useState<SortState>({ column: "updated", dir: "desc" });

  const rows = React.useMemo(() => {
    const sorted = [...items].sort((a, b) => compare(a, b, sort.column));
    return sort.dir === "asc" ? sorted : sorted.reverse();
  }, [items, sort]);

  const columns = React.useMemo<DataTableColumn<TicketListItem>[]>(
    () => [
      {
        id: "number",
        header: "Ticket",
        sortKey: "number",
        width: "minmax(110px,0.7fr)",
        cell: (t) => (
          <Link
            href={`/tickets/${t.id}`}
            className="font-mono text-xs font-medium text-secondary transition-colors duration-fast ease-out after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.number}
          </Link>
        ),
      },
      {
        id: "title",
        header: "Title",
        sortKey: "title",
        width: "minmax(0,2.4fr)",
        cell: (t) => (
          <span className="min-w-0">
            <span className="block truncate font-medium text-primary">{t.title}</span>
            {t.labels.length > 0 && <LabelChips labels={t.labels} max={3} className="mt-1" />}
          </span>
        ),
      },
      {
        id: "type",
        header: "Type",
        sortKey: "type",
        width: "minmax(0,1fr)",
        cell: (t) => <TypeCell type={t.type} />,
      },
      {
        id: "priority",
        header: "Priority",
        sortKey: "priority",
        width: "120px",
        cell: (t) => <PriorityPill priority={t.priority} />,
      },
      {
        id: "status",
        header: "Status",
        sortKey: "status",
        width: "minmax(0,1fr)",
        cell: (t) => <StatusBadge domain="ticket" value={t.status} />,
      },
      {
        id: "assignee",
        header: "Assignee",
        sortKey: "assignee",
        width: "minmax(0,1.1fr)",
        cell: (t) => <AssigneeChip name={t.assignee_name} className="min-w-0" />,
      },
      {
        id: "updated",
        header: "Updated",
        sortKey: "updated",
        width: "110px",
        align: "right",
        cell: (t) => (
          <time
            dateTime={t.updated_at}
            title={new Date(t.updated_at).toLocaleString()}
            className="text-xs text-secondary"
          >
            {updatedLabel(t.updated_at)}
          </time>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      label="Tickets"
      rows={rows}
      columns={columns}
      rowKey={(t) => t.id}
      sort={sort}
      onSortChange={setSort}
      rowHeight={60}
      cardHeight={150}
      renderCard={(t) => <TicketCard ticket={t} />}
    />
  );
}

function TicketCard({ ticket }: { ticket: TicketListItem }) {
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-surface p-3.5 shadow-sm transition-shadow duration-base ease-out",
        "hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [@media(pointer:coarse)]:min-h-[44px]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium text-secondary">{ticket.number}</span>
        <StatusBadge domain="ticket" value={ticket.status} />
      </div>
      <p className="text-sm font-medium text-primary [overflow-wrap:anywhere]">{ticket.title}</p>
      {ticket.labels.length > 0 && <LabelChips labels={ticket.labels} max={4} />}
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
        <PriorityPill priority={ticket.priority} />
        <AssigneeChip name={ticket.assignee_name} className="min-w-0" />
      </div>
    </Link>
  );
}
