/**
 * Ticket status transition tests. Locks the lifecycle contract the board and
 * detail UI enforce (and that MUST mirror ticket_transition_ok in 0259): legal
 * next-states, illegal jumps rejected, reopen detection, resolved detection.
 */
import { describe, expect, it } from "vitest";
import { canTransition, isReopen, isResolved, nextStatuses, TRANSITIONS } from "../status";
import type { TicketStatus } from "../types";

describe("canTransition", () => {
  it("allows the documented forward path", () => {
    expect(canTransition("new", "triaged")).toBe(true);
    expect(canTransition("triaged", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "in_review")).toBe(true);
    expect(canTransition("in_review", "done")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("new", "done")).toBe(false);
    expect(canTransition("new", "in_review")).toBe(false);
    expect(canTransition("done", "wont_do")).toBe(false);
    expect(canTransition("triaged", "done")).toBe(false);
  });

  it("allows reopening from in_review and done back into in_progress", () => {
    expect(canTransition("in_review", "in_progress")).toBe(true);
    expect(canTransition("done", "in_progress")).toBe(true);
  });

  it("treats a same-status move as an allowed no-op", () => {
    for (const s of Object.keys(TRANSITIONS) as TicketStatus[]) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it("supports the client-input hand-back loop", () => {
    expect(canTransition("in_progress", "needs_client_input")).toBe(true);
    expect(canTransition("needs_client_input", "in_progress")).toBe(true);
  });
});

describe("nextStatuses", () => {
  it("never includes the current status", () => {
    for (const s of Object.keys(TRANSITIONS) as TicketStatus[]) {
      expect(nextStatuses(s)).not.toContain(s);
    }
  });
});

describe("isReopen", () => {
  it("is true only for in_review/done → in_progress", () => {
    expect(isReopen("in_review", "in_progress")).toBe(true);
    expect(isReopen("done", "in_progress")).toBe(true);
    expect(isReopen("blocked", "in_progress")).toBe(false);
    expect(isReopen("in_progress", "in_review")).toBe(false);
  });
});

describe("isResolved", () => {
  it("is true for done and wont_do only", () => {
    expect(isResolved("done")).toBe(true);
    expect(isResolved("wont_do")).toBe(true);
    expect(isResolved("in_review")).toBe(false);
    expect(isResolved("blocked")).toBe(false);
  });
});
