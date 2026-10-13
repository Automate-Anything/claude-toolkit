"use server";

/**
 * Ticketing — server actions (the write boundary).
 *
 * Each action Zod-parses its input, calls the typed `createDb` wrapper (which
 * hits a SECURITY DEFINER RPC that owns authorization), then revalidates the
 * affected routes. Returns the shared `ActionResult<T>` discriminated union. The
 * RPCs enforce permissions; actions add validation + friendly errors + cache
 * revalidation and never trust the client.
 */
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createDb } from "@/lib/db";
import { getSessionContext } from "@/lib/auth/session";
import type { Database } from "@/types/db";
import type { TicketComment } from "./types";
import {
  assignSchema,
  commentSchema,
  createTicketSchema,
  fieldErrorsFrom,
  setStatusSchema,
  updateTicketSchema,
  upsertLabelSchema,
} from "./schema";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function serverClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>;
}
async function db() {
  return createDb(await serverClient());
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[ticketing] action error:", message);
  if (/not authorized|permission|42501/i.test(message)) return "You don't have permission to do that.";
  if (/cannot move a ticket|P0001/i.test(message)) return "That status change isn't allowed from here.";
  if (/not found|P0002/i.test(message)) return "That ticket no longer exists. Refresh and try again.";
  if (/required|23502/i.test(message)) return "Please fill in the required fields.";
  return fallback;
}

function invalidationError(): { ok: false; error: string } {
  return { ok: false, error: "Please fix the highlighted fields." };
}

function revalidateTicket(id?: number | null): void {
  revalidatePath("/tickets");
  if (id != null) revalidatePath(`/tickets/${id}`);
}

async function requireSession(): Promise<ActionResult<never> | null> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  return null;
}

async function run<T>(fn: () => Promise<T>, fallback: string): Promise<ActionResult<T>> {
  const noSession = await requireSession();
  if (noSession) return noSession;
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: friendlyError(error, fallback) };
  }
}

export async function createTicketAction(
  input: unknown,
): Promise<ActionResult<{ id: number; number: string }>> {
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    const created = await (await db()).createTicket(parsed.data as Record<string, unknown>);
    revalidateTicket(created.id);
    return created;
  }, "Couldn't create the ticket.");
}

export async function updateTicketAction(id: number, input: unknown): Promise<ActionResult<null>> {
  const parsed = updateTicketSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    await (await db()).updateTicket(id, parsed.data as Record<string, unknown>);
    revalidateTicket(id);
    return null;
  }, "Couldn't save the ticket.");
}

export async function setTicketStatusAction(id: number, input: unknown): Promise<ActionResult<null>> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    await (await db()).setTicketStatus(id, parsed.data.status, parsed.data.note ?? null);
    revalidateTicket(id);
    return null;
  }, "Couldn't change the status.");
}

export async function assignTicketAction(id: number, input: unknown): Promise<ActionResult<null>> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    await (await db()).assignTicket(id, parsed.data.assignee_id);
    revalidateTicket(id);
    return null;
  }, "Couldn't assign the ticket.");
}

export async function addTicketCommentAction(
  id: number,
  input: unknown,
): Promise<ActionResult<TicketComment>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    const comment = await (await db()).addTicketComment(id, parsed.data.body);
    revalidateTicket(id);
    return comment;
  }, "Couldn't post the comment.");
}

export async function upsertTicketLabelAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  const parsed = upsertLabelSchema.safeParse(input);
  if (!parsed.success) return { ...invalidationError(), fieldErrors: fieldErrorsFrom(parsed.error) };
  return run(async () => {
    const label = await (await db()).upsertTicketLabel(
      parsed.data.id ?? null,
      parsed.data.name,
      parsed.data.color,
    );
    revalidateTicket();
    return label;
  }, "Couldn't save the label.");
}

export async function watchTicketAction(id: number, watch: boolean): Promise<ActionResult<null>> {
  return run(async () => {
    const layer = await db();
    if (watch) await layer.watchTicket(id);
    else await layer.unwatchTicket(id);
    revalidateTicket(id);
    return null;
  }, "Couldn't update your watch setting.");
}
