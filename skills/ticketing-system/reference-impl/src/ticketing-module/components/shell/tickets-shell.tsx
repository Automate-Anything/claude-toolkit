"use client";

/**
 * Tickets workspace shell. Owns the header (count + New ticket), the Board/List
 * toggle (persisted per-browser), the filter bar with a 150ms-debounced search,
 * and the shared `useTickets` feed that both views render. Board and list share
 * one query so switching views is instant and never re-fetches.
 */
import * as React from "react";
import { LayoutGrid, List as ListIcon, Plus, SearchX, TicketX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  useTickets,
  useTicketAssignees,
  useTicketLabels,
} from "../../hooks";
import type { TicketFilters as Filters } from "../../types";
import { TicketFilters } from "../filters/ticket-filters";
import { TicketBoard } from "../board/ticket-board";
import { TicketList } from "../list/ticket-list";
import { NewTicketModal } from "../new/new-ticket-modal";

type View = "board" | "list";
const VIEW_KEY = "client:tickets:view";

function readStoredView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === "board" || raw === "list") return raw;
  } catch {
    /* private-mode / disabled storage — non-fatal */
  }
  return "board";
}

export function TicketsShell({
  canWrite,
  currentUserId,
}: {
  canWrite: boolean;
  currentUserId: string | null;
}) {
  const [view, setView] = React.useState<View>("board");
  const [filters, setFilters] = React.useState<Filters>({});
  const [searchInput, setSearchInput] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 150);

  // Restore the persisted view once, after mount (avoids an SSR/client mismatch).
  React.useEffect(() => setView(readStoredView()), []);
  const changeView = React.useCallback((next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const activeFilters = React.useMemo<Filters>(
    () => ({ ...filters, q: debouncedSearch || undefined }),
    [filters, debouncedSearch],
  );

  const query = useTickets(activeFilters);
  const { data: labels = [] } = useTicketLabels();
  const { data: assignees = [] } = useTicketAssignees();

  const items = query.data?.items ?? [];
  const counts = query.data?.counts ?? {};
  const total = React.useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0),
    [counts],
  );
  const hasFilters =
    Object.values(filters).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== false)) ||
    debouncedSearch.length > 0;

  const initialLoading = query.isPending;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-2xl font-semibold text-primary sm:text-3xl">Tickets</h1>
          {query.data && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-secondary">
              {total}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={changeView} />
          {canWrite && (
            <Button onClick={() => setCreating(true)} leftIcon={<Plus className="size-4" aria-hidden />}>
              New ticket
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <TicketFilters
        filters={filters}
        onChange={setFilters}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        labels={labels}
        assignees={assignees}
        canSeeMine={currentUserId != null}
      />

      {/* Content */}
      {initialLoading ? (
        view === "board" ? (
          <BoardSkeleton />
        ) : (
          <ListSkeleton />
        )
      ) : query.isError ? (
        <div role="alert">
          <EmptyState
            icon={TriangleAlert}
            title="Couldn't load tickets"
            description="Something went wrong reaching the server. Check your connection and try again."
            action={
              <Button variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="No tickets match"
            description="Try a different search or clear the filters to see everything."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setFilters({});
                  setSearchInput("");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={TicketX}
            title="No tickets yet"
            description={
              canWrite
                ? "File the first ticket to start tracking bugs, requests, and questions."
                : "Nothing has been filed yet."
            }
            action={
              canWrite ? (
                <Button onClick={() => setCreating(true)} leftIcon={<Plus className="size-4" aria-hidden />}>
                  New ticket
                </Button>
              ) : undefined
            }
          />
        )
      ) : view === "board" ? (
        <TicketBoard items={items} canWrite={canWrite} />
      ) : (
        <TicketList items={items} />
      )}

      {canWrite && <NewTicketModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex rounded-md border bg-surface p-0.5 shadow-sm"
    >
      {(
        [
          { id: "board" as const, label: "Board", Icon: LayoutGrid },
          { id: "list" as const, label: "List", Icon: ListIcon },
        ]
      ).map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [@media(pointer:coarse)]:min-h-[40px]",
              active ? "bg-active text-brand" : "text-secondary hover:text-primary",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading tickets…
      </span>
      <div className="flex gap-4 overflow-hidden" aria-hidden>
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="min-w-[16rem] flex-1">
            <span className="skeleton mb-2.5 block h-4 w-24 rounded" />
            <div className="flex flex-col gap-2.5 rounded-lg bg-muted p-2.5">
              {Array.from({ length: 3 }).map((_, card) => (
                <span key={card} className="skeleton block h-24 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading tickets…
      </span>
      <div className="overflow-hidden rounded-lg border bg-surface" aria-hidden>
        <div className="border-b bg-muted px-4 py-2.5">
          <span className="skeleton block h-3.5 w-28 rounded" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            <span className="skeleton h-4 w-20 rounded" />
            <span className="skeleton h-4 flex-1 rounded" />
            <span className="skeleton h-5 w-20 rounded-full" />
            <span className="skeleton h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}
