/**
 * Ticketing — read queries (client + server callable). Thin wrappers over the
 * typed `createDb` layer so the board/list/detail can each load their own slice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { createDb } from "@/lib/db";
import type { TicketDetail, TicketFilters, TicketLabel, TicketListResult } from "./types";

export type Db = SupabaseClient<Database>;

/** Filtered feed + per-status counts (one round-trip). */
export function getTickets(sb: Db, filters: TicketFilters = {}): Promise<TicketListResult> {
  return createDb(sb).getTickets(filters);
}

/** One ticket with all its relations. */
export function getTicketDetail(sb: Db, id: number): Promise<TicketDetail> {
  return createDb(sb).getTicketDetail(id);
}

/** The shared label library. */
export function listTicketLabels(sb: Db): Promise<TicketLabel[]> {
  return createDb(sb).listTicketLabels();
}
