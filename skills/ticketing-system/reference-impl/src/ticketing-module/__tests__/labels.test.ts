/**
 * Ticket label + priority helper tests. Labels resolve to real DESIGN_SYSTEM
 * token classes (never raw hex); priorities map to the shared tone vocabulary
 * and sort urgent-first.
 */
import { describe, expect, it } from "vitest";
import { labelColorClass, LABEL_COLORS } from "../labels";
import { priorityRank, priorityTone, PRIORITY_ORDER } from "../priority";

describe("labelColorClass", () => {
  it("maps every known color to a token class pair (no raw hex)", () => {
    for (const c of LABEL_COLORS) {
      const cls = labelColorClass(c);
      expect(cls).toMatch(/text-/);
      expect(cls).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
  it("falls back to slate for unknown/empty colors", () => {
    expect(labelColorClass("chartreuse")).toBe(labelColorClass("slate"));
    expect(labelColorClass(null)).toBe(labelColorClass("slate"));
  });
});

describe("priority", () => {
  it("ranks urgent first and low last", () => {
    expect(priorityRank("urgent")).toBeLessThan(priorityRank("high"));
    expect(priorityRank("high")).toBeLessThan(priorityRank("medium"));
    expect(priorityRank("medium")).toBeLessThan(priorityRank("low"));
    expect(PRIORITY_ORDER[0]).toBe("urgent");
  });
  it("maps to sensible tones", () => {
    expect(priorityTone("urgent")).toBe("danger");
    expect(priorityTone("high")).toBe("warning");
    expect(priorityTone("medium")).toBe("info");
    expect(priorityTone("low")).toBe("neutral");
  });
});
