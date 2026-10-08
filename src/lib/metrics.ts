/**
 * KPI calculations and warning-sign detection for portfolio companies.
 * Pure functions over plain rows, so they can be unit tested without a database or UI.
 */

export const SEVERITIES = ["good", "warning", "serious", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Thresholds {
  runwayCriticalMonths: number; // below this: needs cash now
  runwaySeriousMonths: number; // below this: should be raising
  revenueDropPct: number; // single-month MRR drop that triggers a warning
  burnSpikePct: number; // MoM burn increase that triggers a warning
  burnMultipleHigh: number; // cash burned per $1 of net new ARR
  staleAfterMonths: number; // monthly reports missed before we chase
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  runwayCriticalMonths: 6,
  runwaySeriousMonths: 12,
  revenueDropPct: -0.1,
  burnSpikePct: 0.3,
  burnMultipleHigh: 3,
  staleAfterMonths: 2,
};

export interface UpdateRow {
  companyId: number;
  company: string;
  month: string; // first day of the month, ISO
  revenue: number | null;
  burn: number | null;
  cash: number | null;
  headcount: number | null;
  customers: number | null;
  notes: string | null;
  submittedOn: string;
}

export interface DerivedRow extends UpdateRow {
  arr: number | null;
  runwayMonths: number | null; // Infinity when cash-flow positive; null when not reported
  revenueGrowth: number | null;
  burnChange: number | null;
  burnMultiple: number | null;
}

export interface Flag {
  company: string;
  companyId: number;
  severity: Exclude<Severity, "good">;
  metric: string;
  message: string;
}

/** Months of cash left at the current burn. Infinity when cash-flow positive; null if unreported. */
export function runwayMonths(cash: number | null, burn: number | null): number | null {
  if (cash == null || burn == null) return null;
  if (burn <= 0) return Infinity;
  return Math.max(cash, 0) / burn;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

function groupByCompany<T extends { company: string; month: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of [...rows].sort((a, b) => a.company.localeCompare(b.company) || a.month.localeCompare(b.month))) {
    if (!groups.has(row.company)) groups.set(row.company, []);
    groups.get(row.company)!.push(row);
  }
  return groups;
}

/** Add runway, month-over-month growth and burn multiple to each company's month-by-month rows. */
export function addDerived(rows: UpdateRow[]): DerivedRow[] {
  const out: DerivedRow[] = [];
  for (const history of groupByCompany(rows).values()) {
    history.forEach((row, i) => {
      const prev = history[i - 1];
      const arr = row.revenue == null ? null : row.revenue * 12;
      // Burn multiple over a trailing 3-month window: net burn / net new ARR. Undefined when ARR
      // didn't grow, the company is cash-flow positive, or a month in the window is missing.
      let burnMultiple: number | null = null;
      if (i >= 3) {
        const window = history.slice(i - 2, i + 1).map((r) => r.burn);
        const before = history[i - 3].revenue;
        if (window.every((b) => b != null) && arr != null && before != null) {
          const burn3 = window.reduce((sum, b) => sum + b!, 0);
          const newArr = arr - before * 12;
          if (newArr > 0 && burn3 > 0) burnMultiple = burn3 / newArr;
        }
      }
      out.push({
        ...row,
        arr,
        runwayMonths: runwayMonths(row.cash, row.burn),
        revenueGrowth: prev ? pctChange(row.revenue, prev.revenue) : null,
        burnChange: prev ? pctChange(row.burn, prev.burn) : null,
        burnMultiple,
      });
    });
  }
  return out;
}

// Reported figures that stay meaningful when carried forward from an earlier month.
const CARRY_FORWARD = ["revenue", "arr", "burn", "cash", "headcount", "customers"] as const;

/**
 * Fill gaps left by partial update requests with the company's most recent reported figure.
 * Runway is recomputed from the filled-in cash and burn. The burn multiple is carried forward only
 * when the month lacked the figures to compute it, never when it was undefined because revenue
 * didn't grow. Month-over-month changes (growth, burn change) describe one month and aren't carried.
 */
export function withLastKnown(history: DerivedRow[]): DerivedRow[] {
  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month));
  const last: Partial<Record<(typeof CARRY_FORWARD)[number] | "burnMultiple", number>> = {};
  return sorted.map((row) => {
    const filled = { ...row };
    for (const key of CARRY_FORWARD) {
      if (filled[key] == null) filled[key] = last[key] ?? null;
      else last[key] = filled[key] as number;
    }
    filled.runwayMonths = runwayMonths(filled.cash, filled.burn);
    if (row.burnMultiple != null) last.burnMultiple = row.burnMultiple;
    else if (row.revenue == null || row.burn == null) filled.burnMultiple = last.burnMultiple ?? null;
    return filled;
  });
}

/** One row per company: its latest month, with missing figures taken from the last month that had them. */
export function latestSnapshot(derived: DerivedRow[]): DerivedRow[] {
  return [...groupByCompany(derived).values()].map((history) => withLastKnown(history).at(-1)!);
}

function monthsBetween(earlier: string, later: Date): number {
  const [y, m] = earlier.split("-").map(Number);
  return (later.getFullYear() - y) * 12 + (later.getMonth() + 1 - m);
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

/** Warning signs for one company, given its derived month-by-month history. */
export function companyFlags(history: DerivedRow[], today: Date, t: Thresholds = DEFAULT_THRESHOLDS): Flag[] {
  const known = withLastKnown(history);
  const latest = known.at(-1);
  if (!latest) return [];
  const flag = (severity: Flag["severity"], metric: string, message: string): Flag => ({
    company: latest.company,
    companyId: latest.companyId,
    severity,
    metric,
    message,
  });
  const flags: Flag[] = [];

  const runway = latest.runwayMonths;
  if (latest.cash != null && latest.cash <= 0 && latest.burn != null && latest.burn > 0) {
    flags.push(flag("critical", "Runway", "Out of cash"));
  } else if (runway != null && runway < t.runwayCriticalMonths) {
    flags.push(flag("critical", "Runway", `Only ${runway.toFixed(1)} months of cash left`));
  } else if (runway != null && runway < t.runwaySeriousMonths) {
    flags.push(flag("serious", "Runway", `${runway.toFixed(1)} months of runway: should be fundraising`));
  }

  const growth = known.map((r) => r.revenueGrowth).filter((g): g is number => g != null);
  if (growth.length >= 2 && growth.slice(-2).every((g) => g < 0)) {
    flags.push(flag("serious", "Revenue", "Revenue fell two months in a row"));
  } else if (growth.length >= 1 && growth.at(-1)! <= t.revenueDropPct) {
    flags.push(flag("warning", "Revenue", `Revenue down ${pct(growth.at(-1)!)} last month`));
  }

  if (latest.burnChange != null && latest.burnChange >= t.burnSpikePct && (latest.burn ?? 0) > 0) {
    flags.push(flag("warning", "Burn", `Burn up ${pct(latest.burnChange)} month over month`));
  }

  if (latest.burnMultiple != null && latest.burnMultiple > t.burnMultipleHigh) {
    flags.push(flag("warning", "Efficiency", `Burn multiple of ${latest.burnMultiple.toFixed(1)}x`));
  }

  // Last month's report is the newest one we can expect, so anything older counts as missed.
  const missed = monthsBetween(latest.month, today) - 1;
  if (missed >= t.staleAfterMonths) {
    flags.push(flag("warning", "Reporting", `No update since ${monthLabel(latest.month)} (${missed} reports missed)`));
  }
  return flags;
}

const rank = (s: Severity) => SEVERITIES.indexOf(s);

/** All flags across the portfolio, most urgent first. */
export function portfolioFlags(derived: DerivedRow[], today: Date, t: Thresholds = DEFAULT_THRESHOLDS): Flag[] {
  return [...groupByCompany(derived).values()]
    .flatMap((history) => companyFlags(history, today, t))
    .sort((a, b) => rank(b.severity) - rank(a.severity) || a.company.localeCompare(b.company));
}

/** Worst flag severity per company; "good" when a company has no flags. */
export function healthStatus(flags: Flag[], companies: string[]): Map<string, Severity> {
  const worst = new Map<string, Severity>(companies.map((c) => [c, "good"]));
  for (const f of flags) {
    if (rank(f.severity) > rank(worst.get(f.company) ?? "good")) worst.set(f.company, f.severity);
  }
  return worst;
}

export function worstSeverity(flags: Flag[]): Severity {
  return flags.reduce<Severity>((w, f) => (rank(f.severity) > rank(w) ? f.severity : w), "good");
}
