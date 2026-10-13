/**
 * Ticketing module — read shapes.
 *
 * These mirror the jsonb returned by the 0259 read RPCs (get_tickets /
 * get_ticket_detail / list_ticket_labels), which aren't in the generated
 * `Database` types. Hand-modelled here; the `createDb` wrappers cast to them.
 */

export type TicketType = "bug" | "feature_request" | "question" | "future_plan";
export type TicketPriority = "urgent" | "high" | "medium" | "low";
export type TicketStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "in_review"
  | "needs_client_input"
  | "blocked"
  | "done"
  | "wont_do";

/** A record a ticket can be linked to. */
export type TicketLinkedType = "project" | "proposal" | "customer" | "document";

export interface TicketLabel {
  id: number;
  name: string;
  color: string;
}

export interface TicketListItem {
  id: number;
  number: string;
  title: string;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  linked_entity_type: TicketLinkedType | null;
  linked_entity_id: number | null;
  due_date: string | null;
  updated_at: string;
  labels: TicketLabel[];
  attachment_count: number;
  comment_count: number;
}

export interface TicketWatcher {
  profile_id: string;
  full_name: string | null;
}

export interface TicketAttachment {
  id: number;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
}

export interface TicketComment {
  id: number;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

export interface TicketEvent {
  id: number;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface TicketDetail {
  id: number;
  number: string;
  title: string;
  body: string;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  reporter_id: string | null;
  reporter_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  linked_entity_type: TicketLinkedType | null;
  linked_entity_id: number | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  labels: TicketLabel[];
  watchers: TicketWatcher[];
  attachments: TicketAttachment[];
  comments: TicketComment[];
  events: TicketEvent[];
}

/** get_tickets envelope: the filtered feed + per-status counts for the board. */
export interface TicketListResult {
  items: TicketListItem[];
  counts: Partial<Record<TicketStatus, number>>;
}

/** Filters accepted by get_tickets (all optional). */
export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  type?: TicketType[];
  assignee_id?: string | null;
  label_id?: number | null;
  linked_entity_type?: TicketLinkedType | null;
  mine?: boolean;
  q?: string;
}

/** Assignee picker option. */
export interface TicketAssigneeOption {
  profile_id: string;
  full_name: string | null;
  email: string | null;
}
