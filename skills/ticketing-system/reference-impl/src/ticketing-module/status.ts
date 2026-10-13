/**
 * Ticket status lifecycle — the single client-side source of truth for legal
 * transitions. MUST mirror the SQL `ticket_transition_ok` (migration 0259); the
 * board/detail UI uses it to show only valid next states and to guard optimistic
 * drag-drop before the RPC round-trips.
 */
import type { TicketStatus } from "./types";

export const TICKET_STATUS_ORDER: TicketStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "in_review",
  "needs_client_input",
  "blocked",
  "done",
  "wont_do",
];

/** from → allowed next states (mirrors ticket_transition_ok in 0259). */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["triaged", "in_progress", "blocked", "wont_do"],
  triaged: ["in_progress", "needs_client_input", "blocked", "wont_do"],
  in_progress: ["in_review", "needs_client_input", "blocked", "wont_do"],
  in_review: ["done", "in_progress"],
  needs_client_input: ["in_progress", "triaged"],
  blocked: ["in_progress", "triaged", "wont_do"],
  done: ["in_progress"],
  wont_do: ["in_progress"],
};

/** Can a ticket move from `from` to `to`? (Same status is treated as a no-op = allowed.) */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The states a ticket in `from` may move to (excludes itself). */
export function nextStatuses(from: TicketStatus): TicketStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Reopening = leaving a resolved/verify state back into active work. */
export function isReopen(from: TicketStatus, to: TicketStatus): boolean {
  return (from === "in_review" || from === "done") && to === "in_progress";
}

/** Terminal/resolved states. */
export function isResolved(status: TicketStatus): boolean {
  return status === "done" || status === "wont_do";
}
