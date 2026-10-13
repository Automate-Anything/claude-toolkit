"use client";

/**
 * Ticket board — a kanban of the status lifecycle. Reuses the shared
 * `KanbanBoard` (drag mechanics + emerald drop-zone + keyboard/touch move menu).
 *
 * Columns follow `TICKET_STATUS_ORDER`; a drag is committed optimistically via
 * `useSetTicketStatus`, but only after `canTransition` clears it — an illegal
 * drop is rejected (the card snaps back because we never mutate) with a toast.
 */
import * as React from "react";
import Link from "next/link";
import { MessageSquare, MoveRight, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { KanbanBoard, type KanbanColumn } from "@/components/ui/kanban-board";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { statusLabel, statusTone } from "@/config/status-map";
import { TICKET_STATUS_ORDER, canTransition } from "../../status";
import { useSetTicketStatus } from "../../hooks";
import type { TicketListItem, TicketStatus } from "../../types";
import { AssigneeChip, LabelChips, PriorityPill } from "../cells";

const COLUMNS: KanbanColumn[] = TICKET_STATUS_ORDER.map((status) => ({
  id: status,
  label: statusLabel("ticket", status),
  tone: statusTone("ticket", status),
}));

export function TicketBoard({
  items,
  canWrite,
}: {
  items: TicketListItem[];
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const setStatus = useSetTicketStatus();

  const move = React.useCallback(
    (item: TicketListItem, to: string) => {
      const next = to as TicketStatus;
      if (item.status === next) return;
      if (!canTransition(item.status, next)) {
        toast({
          title: "That status change isn't allowed",
          description: `A ticket in "${statusLabel("ticket", item.status)}" can't move straight to "${statusLabel("ticket", next)}".`,
          tone: "warning",
        });
        return;
      }
      setStatus.mutate({ id: item.id, status: next });
    },
    [setStatus, toast],
  );

  return (
    <KanbanBoard
      columns={COLUMNS}
      items={items}
      getId={(t) => t.id}
      getColumnId={(t) => t.status}
      onMove={move}
      readOnly={!canWrite}
      renderCard={(item, helpers) => {
        // Only legal destinations appear in the keyboard/touch move menu.
        const targets = helpers.targets.filter((col) =>
          canTransition(item.status, col.id as TicketStatus),
        );
        return (
          <div className="group relative rounded-lg border bg-surface p-3 shadow-sm transition-shadow duration-base ease-out hover:shadow-md focus-within:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs font-medium text-secondary">{item.number}</span>
              <div className="flex items-center gap-1">
                <PriorityPill priority={item.priority} />
                {canWrite && !helpers.isDragging && targets.length > 0 && (
                  <Menu
                    ariaLabel={`Move ${item.number}`}
                    icon={<MoveRight className="size-4" aria-hidden />}
                    heading="Move to"
                    items={targets.map((col) => ({
                      label: statusLabel("ticket", col.id as TicketStatus),
                      onSelect: () => helpers.onMove(col.id),
                    }))}
                    triggerClassName="relative z-10 size-7 [@media(pointer:coarse)]:size-11"
                  />
                )}
              </div>
            </div>

            <Link
              href={`/tickets/${item.id}`}
              className="mt-1.5 block rounded after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <h3 className="line-clamp-2 text-sm font-medium text-primary [overflow-wrap:anywhere]">
                {item.title}
              </h3>
            </Link>

            {item.labels.length > 0 && <LabelChips labels={item.labels} max={3} className="mt-2" />}

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <AssigneeChip name={item.assignee_name} className="min-w-0" />
              <div className="flex shrink-0 items-center gap-2.5 text-xs text-placeholder">
                {item.comment_count > 0 && (
                  <span className="inline-flex items-center gap-1" title={`${item.comment_count} comments`}>
                    <MessageSquare className="size-3.5" aria-hidden />
                    {item.comment_count}
                  </span>
                )}
                {item.attachment_count > 0 && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`${item.attachment_count} attachments`}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    {item.attachment_count}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      }}
      className={cn("h-full items-start")}
    />
  );
}
