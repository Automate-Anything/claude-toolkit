"use client";

/**
 * Ticket detail. One-round-trip read via `useTicketDetail`; every inline control
 * is optimistic through its own mutation hook and disabled for read-only roles.
 * Status changes are limited to the legal `nextStatuses` (with a "reopen" label
 * when leaving a resolved state) so an illegal transition can't even be picked.
 */
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  BellOff,
  CalendarClock,
  Link2,
  MessageSquare,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/badge";
import { DataField, DetailSection } from "@/components/ui/detail-section";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/lib/markdown";
import { statusLabel } from "@/config/status-map";
import {
  useAssignTicket,
  useSetTicketStatus,
  useTicketAssignees,
  useTicketDetail,
  useTicketLabels,
  useUpdateTicket,
  useWatchTicket,
} from "../../hooks";
import { isReopen, nextStatuses } from "../../status";
import { priorityLabel } from "../../priority";
import { labelColorClass } from "../../labels";
import { TICKET_LINKED_TYPES, TICKET_PRIORITIES, TICKET_TYPES } from "../../schema";
import type {
  TicketDetail as TicketDetailType,
  TicketLinkedType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from "../../types";
import { AssigneeChip, PriorityPill, ticketTypeLabel } from "../cells";
import { TicketAttachments } from "./ticket-attachments";
import { TicketComments } from "./ticket-comments";
import { TicketTimeline } from "./ticket-timeline";

const LINKED_LABEL: Record<TicketLinkedType, string> = {
  project: "Project",
  proposal: "Proposal",
  customer: "Customer",
  document: "Document",
};
const LINKED_ROUTE: Record<TicketLinkedType, string> = {
  project: "/projects",
  proposal: "/proposals",
  customer: "/customers",
  document: "/documents",
};

function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function TicketDetail({
  id,
  canWrite,
  currentUserId,
}: {
  id: number;
  canWrite: boolean;
  currentUserId: string | null;
}) {
  const query = useTicketDetail(id);

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <div role="alert">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this ticket"
          description="It may have been removed, or something went wrong reaching the server."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return <DetailView detail={query.data} canWrite={canWrite} currentUserId={currentUserId} />;
}

function DetailView({
  detail,
  canWrite,
  currentUserId,
}: {
  detail: TicketDetailType;
  canWrite: boolean;
  currentUserId: string | null;
}) {
  const update = useUpdateTicket(detail.id);
  const setStatus = useSetTicketStatus();
  const assign = useAssignTicket();
  const watch = useWatchTicket(detail.id);
  const { data: assignees = [] } = useTicketAssignees();
  const { data: allLabels = [] } = useTicketLabels();

  // Optimistic local mirror of the editable fields — re-synced whenever the
  // server row changes (`updated_at`), so a change shows instantly but the
  // canonical value always wins.
  const [status, setStatusDraft] = React.useState<TicketStatus>(detail.status);
  const [priority, setPriority] = React.useState<TicketPriority>(detail.priority);
  const [type, setType] = React.useState<TicketType>(detail.type);
  const [assigneeId, setAssigneeId] = React.useState<string | null>(detail.assignee_id);
  const [due, setDue] = React.useState<string>(detail.due_date ?? "");
  const [linkedType, setLinkedType] = React.useState<string>(detail.linked_entity_type ?? "");
  const [linkedId, setLinkedId] = React.useState<string>(
    detail.linked_entity_id != null ? String(detail.linked_entity_id) : "",
  );
  const [labelIds, setLabelIds] = React.useState<number[]>(detail.labels.map((l) => l.id));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    setStatusDraft(detail.status);
    setPriority(detail.priority);
    setType(detail.type);
    setAssigneeId(detail.assignee_id);
    setDue(detail.due_date ?? "");
    setLinkedType(detail.linked_entity_type ?? "");
    setLinkedId(detail.linked_entity_id != null ? String(detail.linked_entity_id) : "");
    setLabelIds(detail.labels.map((l) => l.id));
  }, [detail.updated_at, detail.id]);

  const watching = currentUserId != null && detail.watchers.some((w) => w.profile_id === currentUserId);

  const statusOptions = React.useMemo(() => {
    const nexts = nextStatuses(detail.status);
    return [detail.status, ...nexts];
  }, [detail.status]);

  function changeStatus(next: TicketStatus) {
    if (next === detail.status) return;
    setStatusDraft(next);
    setStatus.mutate({ id: detail.id, status: next });
  }

  function changePriority(next: TicketPriority) {
    setPriority(next);
    update.mutate({ priority: next });
  }
  function changeType(next: TicketType) {
    setType(next);
    update.mutate({ type: next });
  }
  function changeAssignee(next: string) {
    const value = next || null;
    setAssigneeId(value);
    const name = assignees.find((a) => a.profile_id === value)?.full_name ?? null;
    assign.mutate({ id: detail.id, assigneeId: value, assigneeName: name });
  }
  function changeDue(next: string) {
    setDue(next);
    update.mutate({ due_date: next || null });
  }
  function commitLinked(nextType: string, nextId: string) {
    if (!nextType) {
      update.mutate({ linked_entity_type: null, linked_entity_id: null });
      return;
    }
    const numeric = nextId.trim() ? Number(nextId.trim()) : null;
    update.mutate({
      linked_entity_type: nextType as TicketLinkedType,
      linked_entity_id: numeric && numeric > 0 ? numeric : null,
    });
  }
  function toggleLabel(labelId: number) {
    const next = labelIds.includes(labelId)
      ? labelIds.filter((x) => x !== labelId)
      : [...labelIds, labelId];
    setLabelIds(next);
    update.mutate({ label_ids: next });
  }

  const linkedHref =
    detail.linked_entity_type && detail.linked_entity_id
      ? `${LINKED_ROUTE[detail.linked_entity_type]}/${detail.linked_entity_id}`
      : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Back link */}
      <Link
        href="/tickets"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-secondary transition-colors duration-fast ease-out hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All tickets
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm font-medium text-secondary">{detail.number}</span>
            <StatusBadge domain="ticket" value={status} />
            <PriorityPill priority={priority} />
          </div>
          <h1 className="mt-1.5 break-words font-display text-2xl font-semibold text-primary sm:text-3xl [overflow-wrap:anywhere]">
            {detail.title}
          </h1>
        </div>

        <Button
          variant={watching ? "secondary" : "outline"}
          onClick={() => watch.mutate(!watching)}
          disabled={currentUserId == null || watch.isPending}
          aria-pressed={watching}
          leftIcon={watching ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        >
          {watching ? "Watching" : "Watch"}
        </Button>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main */}
        <div className="flex min-w-0 flex-col gap-5">
          <DetailSection title="Description">
            {detail.body.trim() ? (
              <Markdown source={detail.body} />
            ) : (
              <p className="text-sm text-placeholder">No description provided.</p>
            )}
          </DetailSection>

          <DetailSection
            title="Attachments"
            action={
              detail.attachments.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary">
                  <Paperclip className="size-3.5" aria-hidden />
                  {detail.attachments.length}
                </span>
              ) : undefined
            }
          >
            <TicketAttachments
              ticketId={detail.id}
              attachments={detail.attachments}
              canWrite={canWrite}
            />
          </DetailSection>

          <DetailSection
            title="Comments"
            action={
              detail.comments.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary">
                  <MessageSquare className="size-3.5" aria-hidden />
                  {detail.comments.length}
                </span>
              ) : undefined
            }
          >
            <TicketComments ticketId={detail.id} comments={detail.comments} canWrite={canWrite} />
          </DetailSection>

          <DetailSection title="Activity">
            <TicketTimeline events={detail.events} />
          </DetailSection>
        </div>

        {/* Sidebar — inline editable details. */}
        <aside className="flex flex-col gap-5">
          <DetailSection title="Details" bodyClassName="flex flex-col gap-4">
            {/* Status */}
            <div>
              <Label htmlFor="ticket-status">Status</Label>
              {canWrite ? (
                <Select
                  id="ticket-status"
                  value={status}
                  onChange={(e) => changeStatus(e.target.value as TicketStatus)}
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel("ticket", s)}
                      {s !== detail.status && isReopen(detail.status, s) ? " (reopen)" : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="mt-1">
                  <StatusBadge domain="ticket" value={status} />
                </div>
              )}
            </div>

            {/* Priority */}
            <div>
              <Label htmlFor="ticket-priority">Priority</Label>
              {canWrite ? (
                <Select
                  id="ticket-priority"
                  value={priority}
                  onChange={(e) => changePriority(e.target.value as TicketPriority)}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="mt-1">
                  <PriorityPill priority={priority} />
                </div>
              )}
            </div>

            {/* Type */}
            <div>
              <Label htmlFor="ticket-type">Type</Label>
              {canWrite ? (
                <Select
                  id="ticket-type"
                  value={type}
                  onChange={(e) => changeType(e.target.value as TicketType)}
                >
                  {TICKET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ticketTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="mt-1 text-sm text-primary">{ticketTypeLabel(type)}</p>
              )}
            </div>

            {/* Assignee */}
            <div>
              <Label htmlFor="ticket-assignee">Assignee</Label>
              {canWrite ? (
                <Select
                  id="ticket-assignee"
                  value={assigneeId ?? ""}
                  onChange={(e) => changeAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignees.map((a) => (
                    <option key={a.profile_id} value={a.profile_id}>
                      {a.full_name || a.email || "Unnamed"}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="mt-1">
                  <AssigneeChip name={detail.assignee_name} />
                </div>
              )}
            </div>

            {/* Due date */}
            <div>
              <Label htmlFor="ticket-due">Due date</Label>
              {canWrite ? (
                <Input
                  id="ticket-due"
                  type="date"
                  value={due}
                  onChange={(e) => changeDue(e.target.value)}
                />
              ) : (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary">
                  {detail.due_date ? (
                    <>
                      <CalendarClock className="size-3.5 text-secondary" aria-hidden />
                      {detail.due_date}
                    </>
                  ) : (
                    <span className="text-placeholder">—</span>
                  )}
                </p>
              )}
            </div>

            {/* Labels */}
            <div>
              <Label htmlFor="ticket-labels-group">Labels</Label>
              {canWrite ? (
                allLabels.length > 0 ? (
                  <div id="ticket-labels-group" className="flex flex-wrap gap-1.5">
                    {allLabels.map((label) => {
                      const active = labelIds.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleLabel(label.id)}
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-opacity duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                            labelColorClass(label.color),
                            active
                              ? "ring-2 ring-[color:var(--border-focus)] ring-offset-1 ring-offset-[color:var(--bg-surface)]"
                              : "opacity-60 hover:opacity-100",
                          )}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-placeholder">No labels defined yet.</p>
                )
              ) : detail.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.labels.map((label) => (
                    <span
                      key={label.id}
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                        labelColorClass(label.color),
                      )}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-placeholder">—</p>
              )}
            </div>

            {/* Linked record */}
            <div>
              <Label htmlFor="ticket-linked-type">Linked record</Label>
              {canWrite ? (
                <div className="flex flex-col gap-2">
                  <Select
                    id="ticket-linked-type"
                    value={linkedType}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLinkedType(v);
                      if (!v) {
                        setLinkedId("");
                        commitLinked("", "");
                      }
                    }}
                  >
                    <option value="">None</option>
                    {TICKET_LINKED_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {LINKED_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                  {linkedType && (
                    <Input
                      aria-label="Linked record ID"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="Record ID"
                      value={linkedId}
                      onChange={(e) => setLinkedId(e.target.value)}
                      onBlur={() => commitLinked(linkedType, linkedId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitLinked(linkedType, linkedId);
                        }
                      }}
                    />
                  )}
                </div>
              ) : linkedHref ? (
                <Link
                  href={linkedHref}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                >
                  <Link2 className="size-3.5" aria-hidden />
                  {LINKED_LABEL[detail.linked_entity_type!]} #{detail.linked_entity_id}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-placeholder">—</p>
              )}
              {canWrite && linkedHref && (
                <Link
                  href={linkedHref}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  <Link2 className="size-3" aria-hidden />
                  Open {LINKED_LABEL[detail.linked_entity_type!].toLowerCase()}
                </Link>
              )}
            </div>
          </DetailSection>

          <DetailSection title="Meta" bodyClassName="grid grid-cols-1 gap-4">
            <DataField label="Reporter">{detail.reporter_name ?? undefined}</DataField>
            <DataField label="Watchers">
              {detail.watchers.length > 0
                ? detail.watchers.map((w) => w.full_name).filter(Boolean).join(", ") ||
                  `${detail.watchers.length}`
                : undefined}
            </DataField>
            <DataField label="Created">{fullDate(detail.created_at)}</DataField>
            <DataField label="Last updated">{fullDate(detail.updated_at)}</DataField>
            {detail.resolved_at && (
              <DataField label="Resolved">{fullDate(detail.resolved_at)}</DataField>
            )}
          </DetailSection>
        </aside>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <span role="status" className="sr-only">
        Loading ticket…
      </span>
      <span className="skeleton h-4 w-24 rounded" />
      <span className="skeleton h-9 w-2/3 rounded" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="skeleton h-40 w-full rounded-lg" />
          ))}
        </div>
        <span className="skeleton h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}
