/**
 * Ticket notification-routing tests — the pure decision behind the SQL
 * side-effect (0260). A dev-team assignee routes to the shared dev inbox
 * (effi@automateanything.ai); a non-dev (Client staffer hand-back) routes to
 * their own address. Case-insensitive.
 */
import { describe, expect, it } from "vitest";
import { isDevEmail, resolveAssignmentEmail, type TicketNotifyConfig } from "../notifications";

const config: TicketNotifyConfig = {
  devNotifyEmail: "effi@automateanything.ai",
  devEmails: ["effi6060@gmail.com", "effie@automateanything.ai", "effi@allautomateanything.com"],
};

describe("isDevEmail", () => {
  it("matches dev logins case-insensitively", () => {
    expect(isDevEmail("effi6060@gmail.com", config)).toBe(true);
    expect(isDevEmail("EFFI6060@GMAIL.COM", config)).toBe(true);
    expect(isDevEmail("  effie@automateanything.ai ", config)).toBe(true);
  });
  it("rejects non-dev and empty", () => {
    expect(isDevEmail("staff@client.example", config)).toBe(false);
    expect(isDevEmail(null, config)).toBe(false);
    expect(isDevEmail("", config)).toBe(false);
  });
});

describe("resolveAssignmentEmail", () => {
  it("routes any dev login to the shared dev inbox", () => {
    expect(resolveAssignmentEmail("effi6060@gmail.com", config)).toBe("effi@automateanything.ai");
    expect(resolveAssignmentEmail("effi@allautomateanything.com", config)).toBe(
      "effi@automateanything.ai",
    );
  });
  it("routes a staffer hand-back to their own address", () => {
    expect(resolveAssignmentEmail("staff@client.example", config)).toBe(
      "staff@client.example",
    );
  });
  it("returns null when there is no address", () => {
    expect(resolveAssignmentEmail(null, config)).toBeNull();
  });
});
