/**
 * The metrics a fund admin can request from portfolio companies.
 *
 * Built-in metrics live in columns of the `updates` table and drive the dashboard's KPIs and
 * warning signs. Custom metrics are defined by the admin; their keys look like "custom:<id>"
 * and their values live in the `custom_values` table.
 */

export type MetricKind = "number" | "integer" | "percent" | "money" | "text";

/** Types an admin can choose for a custom metric, with the label suffix each gets. */
export const CUSTOM_KINDS: Record<MetricKind, { label: string; suffix: string }> = {
  number: { label: "Number", suffix: "" },
  integer: { label: "Whole number", suffix: "" },
  percent: { label: "Percentage", suffix: " (%)" },
  money: { label: "Money", suffix: " ($)" },
  text: { label: "Text", suffix: "" },
};

export interface MetricField {
  key: string; // built-in: column in `updates`; custom: "custom:<id>"
  label: string;
  kind: MetricKind;
  help: string;
  allowNegative: boolean;
  required: boolean; // whether a request for this metric must be answered
}

export const BUILT_IN_KEYS = ["revenue", "burn", "cash", "headcount", "customers", "notes"] as const;
export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];

export const METRIC_FIELDS: Record<BuiltInKey, MetricField> = {
  revenue: { key: "revenue", label: "Monthly recurring revenue ($)", kind: "money", help: "", allowNegative: false, required: true },
  burn: {
    key: "burn",
    label: "Net burn this month ($)",
    kind: "money",
    help: "Cash out minus cash in. Enter a negative number if the company was cash-flow positive.",
    allowNegative: true,
    required: true,
  },
  cash: { key: "cash", label: "Cash in bank at month end ($)", kind: "money", help: "", allowNegative: false, required: true },
  headcount: { key: "headcount", label: "Headcount (full-time)", kind: "integer", help: "", allowNegative: false, required: true },
  customers: { key: "customers", label: "Paying customers", kind: "integer", help: "", allowNegative: false, required: true },
  notes: { key: "notes", label: "Highlights, lowlights and asks", kind: "text", help: "", allowNegative: false, required: false },
};

/** What a standard monthly update asks for. */
export const DEFAULT_FIELDS: string[] = [...BUILT_IN_KEYS];

export function isBuiltIn(key: string): key is BuiltInKey {
  return (BUILT_IN_KEYS as readonly string[]).includes(key);
}

export function customId(key: string): number | null {
  return key.startsWith("custom:") ? Number(key.slice("custom:".length)) : null;
}

/** The form field for an admin-defined metric. Negative values are allowed (margins, NPS). */
export function customField(id: number, name: string, kind: MetricKind, help = ""): MetricField {
  return { key: `custom:${id}`, label: name + CUSTOM_KINDS[kind].suffix, kind, help, allowNegative: true, required: true };
}

/** Keys in catalogue order, rejecting unknown or empty selections. */
export function validateFields(keys: string[], catalogue: Map<string, MetricField>): string[] {
  const unknown = keys.filter((k) => !catalogue.has(k));
  if (unknown.length) throw new UserError(`Unknown metric fields: ${unknown.sort().join(", ")}`);
  if (!keys.length) throw new UserError("Select at least one metric to request");
  return [...catalogue.keys()].filter((k) => keys.includes(k));
}

/** An error whose message is safe and useful to show to the person using the app. */
export class UserError extends Error {}
