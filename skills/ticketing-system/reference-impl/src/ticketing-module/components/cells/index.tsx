/**
 * Ticketing — small shared display cells reused by the board, list and detail.
 * Kept deliberately DRY: only the primitives all three surfaces render.
 *
 * Pure presentational (no hooks / no client-only APIs) so they compose into
 * either a server or client tree; tokens only, never a raw color.
 */
import * as React from "react";
import {
  Bug,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleHelp,
  Equal,
  Lightbulb,
  Sparkles,
  Tag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { priorityLabel, priorityTone } from "../../priority";
import { labelColorClass } from "../../labels";
import type { TicketLabel, TicketPriority, TicketType } from "../../types";

// ── Priority ────────────────────────────────────────────────────────────────
const PRIORITY_ICON: Record<TicketPriority, LucideIcon> = {
  urgent: ChevronsUp,
  high: ChevronUp,
  medium: Equal,
  low: ChevronDown,
};

/** Priority as an icon + label pill (status is never color-only). */
export function PriorityPill({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  return (
    <Badge tone={priorityTone(priority)} icon={PRIORITY_ICON[priority]} className={className}>
      {priorityLabel(priority)}
    </Badge>
  );
}

// ── Type ──────────────────────────────────────────────────────────────────
const TYPE_ICON: Record<TicketType, LucideIcon> = {
  bug: Bug,
  feature_request: Lightbulb,
  question: CircleHelp,
  future_plan: Sparkles,
};

const TYPE_LABEL: Record<TicketType, string> = {
  bug: "Bug",
  feature_request: "Feature request",
  question: "Question",
  future_plan: "Future plan",
};

export function ticketTypeLabel(type: TicketType): string {
  return TYPE_LABEL[type] ?? type;
}

/** Type as a muted icon + label (neutral — type isn't a status). */
export function TypeCell({ type, className }: { type: TicketType; className?: string }) {
  const Icon = TYPE_ICON[type] ?? CircleHelp;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-secondary", className)}>
      <Icon className="size-4 shrink-0 text-placeholder" aria-hidden />
      {ticketTypeLabel(type)}
    </span>
  );
}

// ── Labels ────────────────────────────────────────────────────────────────
/** Colored label chips; collapses the overflow into a "+N" chip. */
export function LabelChips({
  labels,
  max = 3,
  className,
}: {
  labels: TicketLabel[];
  max?: number;
  className?: string;
}) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const extra = labels.length - shown.length;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((label) => (
        <span
          key={label.id}
          className={cn(
            "inline-flex max-w-[10rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            labelColorClass(label.color),
          )}
        >
          <Tag className="size-2.5 shrink-0" aria-hidden />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-secondary">
          +{extra}
        </span>
      )}
    </span>
  );
}

// ── Assignee ────────────────────────────────────────────────────────────────
/** Circular initials avatar (decorative — the name sits beside it). */
export function Avatar({
  name,
  size = "sm",
  className,
}: {
  name: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const label = name?.trim();
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-secondary",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-[11px]",
        className,
      )}
      aria-hidden
    >
      {label ? initials(label) : <UserRound className="size-3.5" aria-hidden />}
    </span>
  );
}

/** Assignee avatar + name, or a muted "Unassigned" when null. */
export function AssigneeChip({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  if (!name?.trim()) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm text-placeholder", className)}>
        <Avatar name={null} />
        Unassigned
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm text-primary", className)}>
      <Avatar name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}
