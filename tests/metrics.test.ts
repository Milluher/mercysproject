import { describe, expect, it } from "vitest";

import {
  addDerived,
  companyFlags,
  DEFAULT_THRESHOLDS,
  healthStatus,
  latestSnapshot,
  portfolioFlags,
  runwayMonths,
  type UpdateRow,
} from "@/lib/metrics";

const TODAY = new Date(2026, 9, 7); // 7 Oct 2026

function history(
  company = "Acme",
  { revenue = [100, 110, 121], burn = [50, 50, 50], cash = [1000, 950, 900], start = "2026-07-01" }: Partial<Record<"revenue" | "burn" | "cash", (number | null)[]>> & { start?: string } = {},
): UpdateRow[] {
  const [y, m] = start.split("-").map(Number);
  return revenue.map((r, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return {
      companyId: company.length,
      company,
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      revenue: r,
      burn: burn[i],
      cash: cash[i],
      headcount: 5,
      customers: null,
      notes: null,
      submittedOn: start,
    };
  });
}

const flagsFor = (rows: UpdateRow[], today = TODAY, t = DEFAULT_THRESHOLDS) =>
  new Set(companyFlags(addDerived(rows), today, t).map((f) => `${f.metric}:${f.severity}`));

describe("metrics", () => {
  it("computes runway", () => {
    expect(runwayMonths(1200, 100)).toBe(12);
    expect(runwayMonths(1200, 0)).toBe(Infinity);
    expect(runwayMonths(1200, -50)).toBe(Infinity);
    expect(runwayMonths(-10, 100)).toBe(0);
    expect(runwayMonths(null, 100)).toBeNull();
  });

  it("derives growth, runway and ARR per company", () => {
    const d = addDerived(history());
    expect(d[1].revenueGrowth).toBeCloseTo(0.1);
    expect(d[0].revenueGrowth).toBeNull();
    expect(d[2].runwayMonths).toBe(18);
    expect(d[0].arr).toBe(1200);
    const two = addDerived([...history("A", { revenue: [100, 200, 300] }), ...history("B", { revenue: [50, 50, 50] })]);
    expect(two.find((r) => r.company === "B")!.revenueGrowth).toBeNull(); // never compared against A
  });

  it("computes the burn multiple over 3 months", () => {
    const d = addDerived(history("Acme", { revenue: [100, 100, 100, 200], burn: [50, 60, 70, 80], cash: [5000, 5000, 5000, 5000], start: "2026-06-01" }));
    expect(d[3].burnMultiple).toBeCloseTo(210 / 1200);
    const flat = addDerived(history("Acme", { revenue: [100, 100, 100, 100], burn: [50, 50, 50, 50], cash: [5000, 5000, 5000, 5000], start: "2026-06-01" }));
    expect(flat[3].burnMultiple).toBeNull();
    const profitable = addDerived(history("Acme", { revenue: [100, 120, 140, 160], burn: [-10, -10, -10, -10], cash: [5000, 5000, 5000, 5000], start: "2026-06-01" }));
    expect(profitable[3].burnMultiple).toBeNull();
  });

  it("flags nothing for a healthy company", () => {
    expect(flagsFor(history("Acme", { cash: [5000, 4950, 4900] })).size).toBe(0);
  });

  it.each([
    [250, "Runway:critical"],
    [500, "Runway:serious"],
    [0, "Runway:critical"],
  ])("flags runway with %d cash", (cash, expected) => {
    expect(flagsFor(history("Acme", { cash: [5000, 5000, cash] }))).toContain(expected);
  });

  it("doesn't flag runway for a profitable company", () => {
    expect(flagsFor(history("Acme", { burn: [-10, -10, -10], cash: [100, 110, 120] })).size).toBe(0);
  });

  it("flags revenue declines", () => {
    expect(flagsFor(history("Acme", { revenue: [100, 95, 90], cash: [5000, 5000, 5000] }))).toContain("Revenue:serious");
    expect(flagsFor(history("Acme", { revenue: [100, 110, 95], cash: [5000, 5000, 5000] }))).toContain("Revenue:warning");
    expect(flagsFor(history("Acme", { revenue: [100, 110, 105], cash: [5000, 5000, 5000] })).size).toBe(0);
  });

  it("flags burn spikes", () => {
    expect(flagsFor(history("Acme", { burn: [50, 50, 70], cash: [5000, 5000, 5000] }))).toContain("Burn:warning");
  });

  it("flags missed reports", () => {
    const rows = history("Acme", { cash: [5000, 5000, 5000] }); // latest report is September
    expect(flagsFor(rows, new Date(2026, 9, 7))).not.toContain("Reporting:warning");
    expect(flagsFor(rows, new Date(2026, 10, 7))).not.toContain("Reporting:warning");
    expect(flagsFor(rows, new Date(2026, 11, 7))).toContain("Reporting:warning");
  });

  it("sorts portfolio flags and computes health", () => {
    const rows = [
      ...history("Healthy", { cash: [5000, 5000, 5000] }),
      ...history("Burning", { burn: [50, 50, 70], cash: [5000, 5000, 5000] }),
      ...history("Broke", { cash: [500, 300, 100] }),
    ];
    const flags = portfolioFlags(addDerived(rows), TODAY);
    expect(flags[0].severity).toBe("critical");
    expect(Object.fromEntries(healthStatus(flags, ["Healthy", "Burning", "Broke"]))).toEqual({
      Healthy: "good",
      Burning: "warning",
      Broke: "critical",
    });
  });

  it("doesn't carry an old burn multiple into a month where revenue stopped growing", () => {
    const rows = history("Acme", { revenue: [100, 110, 120, 130, 125, 120, 115], burn: Array(7).fill(50), cash: Array(7).fill(5000), start: "2026-03-01" });
    const derived = addDerived(rows);
    expect(derived[3].burnMultiple).not.toBeNull(); // growing then
    const [snap] = latestSnapshot(derived);
    expect(snap.burnMultiple).toBeNull(); // ARR fell over the last 3 months
    expect(flagsFor(rows)).not.toContain("Efficiency:warning");
  });

  it("carries forward figures a partial update didn't include", () => {
    const rows = history("Acme", { revenue: [400, 500], burn: [1000, null], cash: [12000, null], start: "2026-08-01" });
    const [snap] = latestSnapshot(addDerived(rows));
    expect(snap.month).toBe("2026-09-01");
    expect(snap.revenue).toBe(500);
    expect(snap.cash).toBe(12000);
    expect(snap.runwayMonths).toBe(12);
  });
});
