/**
 * Ticketing module — Zod input schemas for the server actions.
 *
 * The DEFINER RPCs own authorization; these validate shape/required fields and
 * surface friendly per-field errors. `fieldErrorsFrom` flattens a ZodError into
 * the `{ field: message }` map the action layer returns.
 */
import { z } from "zod";

export const TICKET_TYPES = ["bug", "feature_request", "question", "future_plan"] as const;
export const TICKET_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const TICKET_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "in_review",
  "needs_client_input",
  "blocked",
  "done",
  "wont_do",
] as const;
export const TICKET_LINKED_TYPES = ["project", "proposal", "customer", "document"] as const;

const uuid = z.string().uuid();
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .nullish();

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, "Give the ticket a title").max(300, "Title is too long"),
  body: z.string().max(20000).optional().default(""),
  type: z.enum(TICKET_TYPES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee_id: uuid.nullish(),
  linked_entity_type: z.enum(TICKET_LINKED_TYPES).nullish(),
  linked_entity_id: z.number().int().positive().nullish(),
  due_date: optionalDate,
  label_ids: z.array(z.number().int().positive()).optional(),
});

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1, "Give the ticket a title").max(300).optional(),
    body: z.string().max(20000).optional(),
    type: z.enum(TICKET_TYPES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    linked_entity_type: z.enum(TICKET_LINKED_TYPES).nullish(),
    linked_entity_id: z.number().int().positive().nullish(),
    due_date: optionalDate,
    label_ids: z.array(z.number().int().positive()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const setStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(20000).optional(),
});

export const assignSchema = z.object({
  assignee_id: uuid.nullable(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment").max(20000),
});

export const upsertLabelSchema = z.object({
  id: z.number().int().positive().nullish(),
  name: z.string().trim().min(1, "Name the label").max(60),
  color: z.string().trim().max(24).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
export type AssignInput = z.infer<typeof assignSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type UpsertLabelInput = z.infer<typeof upsertLabelSchema>;

/** Flatten a ZodError into a `{ field: firstMessage }` map for the UI. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
