/**
 * Ticket priority helpers — ordering + tone mapping (reuses the DESIGN_SYSTEM
 * tone vocabulary so priority pills match the rest of the app).
 */
import type { Tone } from "@/config/status-map";
import type { TicketPriority } from "./types";

export const PRIORITY_ORDER: TicketPriority[] = ["urgent", "high", "medium", "low"];

const PRIORITY_TONE: Record<TicketPriority, Tone> = {
  urgent: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Sort rank (0 = most urgent). */
export function priorityRank(p: TicketPriority): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i === -1 ? PRIORITY_ORDER.length : i;
}

export function priorityTone(p: TicketPriority): Tone {
  return PRIORITY_TONE[p] ?? "neutral";
}

export function priorityLabel(p: TicketPriority): string {
  return PRIORITY_LABEL[p] ?? p;
}
