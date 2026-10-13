"use client";

/**
 * Ticket audit timeline. `detail.events` carry more kinds than a pure status
 * history (assignment, priority, type, links, reopen…), so this is a small
 * dedicated list styled like the shared `StatusTimeline` (dot + connector) but
 * humanizing each event kind. Newest first.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, type Tone } from "@/config/status-map";
import { priorityLabel } from "../../priority";
import { ticketTypeLabel } from "../cells";
import type { TicketEvent, TicketPriority, TicketStatus, TicketType } from "../../types";

const toneDot: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-[var(--border-strong)]",
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A human sentence + a dot tone for one event. */
function describe(event: TicketEvent): { text: React.ReactNode; tone: Tone } {
  const { kind, from_value: from, to_value: to } = event;
  const statusName = (v: string | null) => (v ? statusLabel("ticket", v as TicketStatus) : "—");
  const arrow = (a: string, b: string) => (
    <>
      <span className="font-medium text-primary">{a}</span>
      <span className="mx-1 text-placeholder">→</span>
      <span className="font-medium text-primary">{b}</span>
    </>
  );

  switch (kind) {
    case "created":
      return { text: "created the ticket", tone: "info" };
    case "reopened":
      return { text: "reopened the ticket", tone: "warning" };
    case "status":
      return {
        text: <>changed status {arrow(statusName(from), statusName(to))}</>,
        tone: to ? statusTone("ticket", to) : "neutral",
      };
    case "assigned":
    case "assignee":
      return to
        ? { text: <>assigned to <span className="font-medium text-primary">{to}</span></>, tone: "info" }
        : { text: "unassigned the ticket", tone: "neutral" };
    case "priority":
      return {
        text: (
          <>
            changed priority{" "}
            {arrow(
              from ? priorityLabel(from as TicketPriority) : "—",
              to ? priorityLabel(to as TicketPriority) : "—",
            )}
          </>
        ),
        tone: "warning",
      };
    case "type":
      return {
        text: (
          <>
            changed type{" "}
            {arrow(
              from ? ticketTypeLabel(from as TicketType) : "—",
              to ? ticketTypeLabel(to as TicketType) : "—",
            )}
          </>
        ),
        tone: "neutral",
      };
    case "due_date":
    case "due":
      return to
        ? { text: <>set the due date to <span className="font-medium text-primary">{to}</span></>, tone: "neutral" }
        : { text: "cleared the due date", tone: "neutral" };
    case "label":
    case "labels":
      return { text: "updated the labels", tone: "neutral" };
    case "linked":
    case "link":
      return to
        ? { text: <>linked a {humanize(to)} record</>, tone: "neutral" }
        : { text: "updated the linked record", tone: "neutral" };
    default:
      return {
        text: from || to ? <>{humanize(kind)} {arrow(from ?? "—", to ?? "—")}</> : humanize(kind),
        tone: "neutral",
      };
  }
}

export function TicketTimeline({ events }: { events: TicketEvent[] }) {
  const ordered = React.useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [events],
  );

  if (ordered.length === 0) {
    return <p className="text-sm text-secondary">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative flex flex-col">
      {ordered.map((event, index) => {
        const { text, tone } = describe(event);
        const actor = event.actor_name?.trim();
        const isLast = index === ordered.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            <div className="relative flex flex-col items-center">
              <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", toneDot[tone])} aria-hidden />
              {!isLast && <span className="mt-1 w-px flex-1 bg-[var(--border)]" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-sm text-secondary">
                {actor && <span className="font-medium text-primary">{actor} </span>}
                {text}
              </p>
              <p className="mt-0.5 text-xs text-placeholder">
                <time dateTime={event.created_at}>{when(event.created_at)}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
