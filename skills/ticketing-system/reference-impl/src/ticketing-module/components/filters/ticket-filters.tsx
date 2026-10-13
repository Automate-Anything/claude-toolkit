"use client";

/**
 * Ticket filter bar. Search + multi-select facets (status / priority / type),
 * single-select assignee / label / linked-record, and a "Mine" toggle. Dense and
 * wrapping on desktop; on mobile everything but search collapses behind a
 * "Filters" disclosure so the bar stays a single compact row.
 */
import * as React from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { statusLabel } from "@/config/status-map";
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES, TICKET_LINKED_TYPES } from "../../schema";
import { priorityLabel } from "../../priority";
import type {
  TicketFilters as Filters,
  TicketLabel,
  TicketLinkedType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from "../../types";
import type { MentionableProfile } from "@/lib/db";
import { ticketTypeLabel } from "../cells";

const LINKED_LABEL: Record<TicketLinkedType, string> = {
  project: "Project",
  proposal: "Proposal",
  customer: "Customer",
  document: "Document",
};

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

export function TicketFilters({
  filters,
  onChange,
  searchInput,
  onSearchInput,
  labels,
  assignees,
  canSeeMine,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  labels: TicketLabel[];
  assignees: MentionableProfile[];
  canSeeMine: boolean;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const activeCount =
    (filters.status?.length ?? 0) +
    (filters.priority?.length ?? 0) +
    (filters.type?.length ?? 0) +
    (filters.assignee_id ? 1 : 0) +
    (filters.label_id ? 1 : 0) +
    (filters.linked_entity_type ? 1 : 0) +
    (filters.mine ? 1 : 0);

  function clearAll() {
    onChange({});
    onSearchInput("");
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search row — always visible. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder"
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder="Search tickets…"
            aria-label="Search tickets"
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="md"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          className="shrink-0 sm:hidden"
          leftIcon={<SlidersHorizontal className="size-4" aria-hidden />}
        >
          Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
        </Button>
      </div>

      {/* Facets — inline on ≥sm, collapsible on mobile. */}
      <div className={cn("flex-wrap items-center gap-2", mobileOpen ? "flex" : "hidden sm:flex")}>
        <MultiFacet
          label="Status"
          options={TICKET_STATUSES.map((s) => ({ value: s, label: statusLabel("ticket", s) }))}
          selected={filters.status ?? []}
          onToggle={(v) => onChange({ ...filters, status: toggle(filters.status, v as TicketStatus) })}
        />
        <MultiFacet
          label="Priority"
          options={TICKET_PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) }))}
          selected={filters.priority ?? []}
          onToggle={(v) =>
            onChange({ ...filters, priority: toggle(filters.priority, v as TicketPriority) })
          }
        />
        <MultiFacet
          label="Type"
          options={TICKET_TYPES.map((t) => ({ value: t, label: ticketTypeLabel(t) }))}
          selected={filters.type ?? []}
          onToggle={(v) => onChange({ ...filters, type: toggle(filters.type, v as TicketType) })}
        />

        <Select
          aria-label="Filter by assignee"
          value={filters.assignee_id ?? ""}
          onChange={(e) => onChange({ ...filters, assignee_id: e.target.value || null })}
          className="w-auto min-w-[9rem]"
        >
          <option value="">Any assignee</option>
          {assignees.map((a) => (
            <option key={a.profile_id} value={a.profile_id}>
              {a.full_name || a.email || "Unnamed"}
            </option>
          ))}
        </Select>

        {labels.length > 0 && (
          <Select
            aria-label="Filter by label"
            value={filters.label_id != null ? String(filters.label_id) : ""}
            onChange={(e) =>
              onChange({ ...filters, label_id: e.target.value ? Number(e.target.value) : null })
            }
            className="w-auto min-w-[8rem]"
          >
            <option value="">Any label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}

        <Select
          aria-label="Filter by linked record"
          value={filters.linked_entity_type ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              linked_entity_type: (e.target.value || null) as TicketLinkedType | null,
            })
          }
          className="w-auto min-w-[8rem]"
        >
          <option value="">Any record</option>
          {TICKET_LINKED_TYPES.map((t) => (
            <option key={t} value={t}>
              {LINKED_LABEL[t]}
            </option>
          ))}
        </Select>

        {canSeeMine && (
          <Button
            variant={filters.mine ? "primary" : "outline"}
            size="md"
            aria-pressed={!!filters.mine}
            onClick={() => onChange({ ...filters, mine: !filters.mine })}
            leftIcon={<User className="size-4" aria-hidden />}
          >
            Mine
          </Button>
        )}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-secondary transition-colors duration-fast ease-out hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/** A checkbox-list popover facet (multi-select). Closes on outside click / Esc. */
function MultiFacet({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "inline-flex h-11 items-center gap-1.5 rounded-md border bg-surface px-3 text-sm shadow-sm transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [@media(pointer:coarse)]:min-h-[44px]",
          count > 0
            ? "border-focus text-primary"
            : "border-[color:var(--border)] text-secondary hover:text-primary",
        )}
      >
        {label}
        {count > 0 && (
          <span className="grid min-w-[1.25rem] place-items-center rounded-full bg-active px-1.5 text-xs font-semibold text-brand">
            {count}
          </span>
        )}
        <ChevronDown className="size-4 text-placeholder" aria-hidden />
      </button>

      {open && (
        <div
          role="group"
          aria-label={`${label} filter`}
          className="absolute left-0 top-full z-30 mt-1 flex max-h-72 min-w-[13rem] animate-scale-in flex-col overflow-y-auto rounded-lg border bg-elevated p-1 shadow-lg"
        >
          {options.map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => onToggle(opt.value)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-primary transition-colors duration-fast ease-out hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    active ? "border-primary bg-primary text-on-primary" : "border-strong",
                  )}
                  aria-hidden
                >
                  {active && <Check className="size-3" />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
