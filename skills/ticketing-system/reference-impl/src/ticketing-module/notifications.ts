/**
 * Ticket notification routing — the pure decision the SQL side effect encodes
 * (0260 ticket_notify_assignment / ticket_email_for), extracted so it can be
 * unit-tested without a database. Given an assignee's email and the ticket
 * config, it returns the address that actually receives the email: the shared
 * dev inbox for a dev-team member, else the assignee's own address.
 */
export interface TicketNotifyConfig {
  /** The address dev-team assignments are emailed to (default effi@automateanything.ai). */
  devNotifyEmail: string;
  /** The dev-team login emails; an assignee in this set is a "dev". */
  devEmails: string[];
}

/** Is this address one of the configured dev-team logins? (case-insensitive) */
export function isDevEmail(email: string | null | undefined, config: TicketNotifyConfig): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  return config.devEmails.some((e) => e.trim().toLowerCase() === lower);
}

/**
 * The email address that should receive an assignment/reopen/comment
 * notification for a given assignee. Dev-team assignees route to the shared dev
 * inbox; everyone else to their own address.
 */
export function resolveAssignmentEmail(
  assigneeEmail: string | null | undefined,
  config: TicketNotifyConfig,
): string | null {
  if (isDevEmail(assigneeEmail, config)) return config.devNotifyEmail;
  return assigneeEmail ? assigneeEmail.trim() : null;
}
