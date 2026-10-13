/**
 * Ticket label colors. Keys are stored in `ticket_labels.color`; each maps to an
 * existing DESIGN_SYSTEM soft/token class pair (never raw hex — the design
 * system forbids it), so labels stay theme-aware in light and dark.
 */
export const LABEL_COLORS = ["emerald", "amber", "rose", "sky", "slate"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

const SLATE_CLASS = "bg-muted text-secondary";
const LABEL_CLASS: Record<string, string> = {
  emerald: "bg-success-soft text-success",
  amber: "bg-warning-soft text-warning",
  rose: "bg-danger-soft text-danger",
  sky: "bg-info-soft text-info",
  slate: SLATE_CLASS,
};

/** Token classes for a label chip; unknown colors fall back to the neutral slate. */
export function labelColorClass(color: string | null | undefined): string {
  return LABEL_CLASS[color ?? "slate"] ?? SLATE_CLASS;
}

/** A human label for a color swatch in the label editor. */
export function labelColorName(color: LabelColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}
