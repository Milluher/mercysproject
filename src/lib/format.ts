/** Display formatting shared by server and client components. */
import type { MetricField } from "./fields";
import type { Severity } from "./metrics";

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  for (const [threshold, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= threshold) return `${sign}$${(abs / threshold).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function runway(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return value === Infinity ? "Profitable" : `${value.toFixed(1)} mo`;
}

export function multiple(value: number | null | undefined): string {
  return value == null ? "–" : `${value.toFixed(1)}x`;
}

export function formatValue(field: Pick<MetricField, "kind">, value: number | string | null | undefined): string {
  if (value == null || value === "" || (typeof value === "number" && Number.isNaN(value))) return "–";
  if (typeof value === "string") return value;
  switch (field.kind) {
    case "money":
      return money(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "integer":
      return Math.round(value).toLocaleString("en-US");
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

/** "2026-09-01" → "Sep 2026" (or "September 2026" with long=true). */
export function monthLabel(iso: string, long = false): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    year: "numeric",
  });
}

/** "2026-10-07" → "07 Oct 2026". */
export function dayLabel(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(`${iso.slice(0, 10)}T00:00:00`) : iso;
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

export const STATUS: Record<Severity, { icon: string; label: string; tone: string }> = {
  critical: { icon: "🔴", label: "Critical", tone: "critical" },
  serious: { icon: "🟠", label: "Serious", tone: "serious" },
  warning: { icon: "🟡", label: "Warning", tone: "warning" },
  good: { icon: "🟢", label: "Healthy", tone: "good" },
};

export function statusLabel(s: Severity): string {
  return `${STATUS[s].icon} ${STATUS[s].label}`;
}
