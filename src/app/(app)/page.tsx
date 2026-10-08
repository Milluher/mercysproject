import Link from "next/link";
import { redirect } from "next/navigation";

import { RunwayChart } from "@/components/charts";
import { isAdmin } from "@/lib/auth";
import { listCompanies, listUpdates } from "@/lib/data";
import { dayLabel, monthLabel, money, multiple, runway, STATUS } from "@/lib/format";
import { addDerived, DEFAULT_THRESHOLDS, healthStatus, latestSnapshot, portfolioFlags, SEVERITIES } from "@/lib/metrics";
import { requireUser } from "@/lib/session";

export default async function OverviewPage() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/submit");

  const [companies, updates] = await Promise.all([listCompanies(), listUpdates()]);
  if (!updates.length) {
    return (
      <div className="space-y-4">
        <h1 className="h1">Portfolio KPI dashboard</h1>
        <p className="alert alert-info">
          No KPI updates yet. Add companies and ask for figures on <Link className="underline" href="/requests">Update requests</Link>.
        </p>
      </div>
    );
  }

  const today = new Date();
  const derived = addDerived(updates);
  const snapshot = latestSnapshot(derived);
  const flags = portfolioFlags(derived, today);
  const status = healthStatus(flags, snapshot.map((s) => s.company));
  const info = new Map(companies.map((c) => [c.name, c]));

  const finiteRunway = snapshot.map((s) => s.runwayMonths).filter((r): r is number => r != null && r !== Infinity).sort((a, b) => a - b);
  const median = finiteRunway.length ? finiteRunway[Math.floor((finiteRunway.length - 1) / 2)] : null;
  const attention = [...status.values()].filter((s) => s === "serious" || s === "critical").length;
  const rows = [...snapshot].sort(
    (a, b) => SEVERITIES.indexOf(status.get(b.company)!) - SEVERITIES.indexOf(status.get(a.company)!) || a.company.localeCompare(b.company),
  );
  const burning = snapshot
    .filter((s) => s.runwayMonths != null && s.runwayMonths !== Infinity)
    .sort((a, b) => a.runwayMonths! - b.runwayMonths!)
    .map((s) => ({ company: s.company, runway: s.runwayMonths! }));
  const profitable = snapshot.filter((s) => s.runwayMonths === Infinity).map((s) => s.company);
  const watch = flags.filter((f) => f.severity === "warning");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h1">Portfolio KPI dashboard</h1>
        <p className="caption mt-1">
          Latest reported month per company · {snapshot.length} companies · as of {dayLabel(today)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Portfolio ARR", money(snapshot.reduce((sum, s) => sum + (s.arr ?? 0), 0)), "Sum of each company's latest MRR × 12"],
          ["Companies", String(snapshot.length), ""],
          ["Need attention", String(attention), "Companies with a serious or critical warning"],
          ["Median runway", runway(median), "Across companies still burning cash"],
        ].map(([label, value, help]) => (
          <div key={label} className="card" title={help || undefined}>
            <p className="caption">{label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="h2">Warning signs</h2>
        {flags.length === 0 && <p className="alert alert-success">No warning signs across the portfolio.</p>}
        {flags
          .filter((f) => f.severity !== "warning")
          .map((f) => (
            <p key={`${f.company}-${f.metric}`} className={`alert alert-${f.severity}`}>
              {STATUS[f.severity].icon} {STATUS[f.severity].label} —{" "}
              <Link className="font-semibold underline-offset-2 hover:underline" href={`/company/${f.companyId}`}>
                {f.company}
              </Link>{" "}
              · {f.metric}: {f.message}
            </p>
          ))}
        {watch.length > 0 && (
          <div className="card">
            <p className="mb-2 text-sm font-semibold">Keep an eye on</p>
            <ul className="space-y-1 text-sm">
              {watch.map((f) => (
                <li key={`${f.company}-${f.metric}`}>
                  {STATUS.warning.icon}{" "}
                  <Link className="font-semibold underline-offset-2 hover:underline" href={`/company/${f.companyId}`}>
                    {f.company}
                  </Link>{" "}
                  · {f.metric}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Companies</h2>
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Sector</th>
                <th>Stage</th>
                <th className="num">MRR</th>
                <th className="num">MoM growth</th>
                <th className="num" title="Negative = cash-flow positive">
                  Net burn
                </th>
                <th className="num">Cash</th>
                <th className="num">Runway</th>
                <th className="num" title="Net burn ÷ net new ARR over the last 3 months. Above 3x is costly growth.">
                  Burn multiple
                </th>
                <th className="num">Headcount</th>
                <th>Last report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = status.get(s.company)!;
                return (
                  <tr key={s.company} className="hover:bg-plane">
                    <td className="font-medium whitespace-nowrap">
                      <Link className="hover:underline" href={`/company/${s.companyId}`}>
                        {s.company}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      {STATUS[st].icon} {STATUS[st].label}
                    </td>
                    <td>{info.get(s.company)?.sector}</td>
                    <td className="whitespace-nowrap">{info.get(s.company)?.stage}</td>
                    <td className="num">{money(s.revenue)}</td>
                    <td className="num">{s.revenueGrowth == null ? "–" : `${s.revenueGrowth >= 0 ? "+" : ""}${(s.revenueGrowth * 100).toFixed(1)}%`}</td>
                    <td className="num">{money(s.burn)}</td>
                    <td className="num">{money(s.cash)}</td>
                    <td className="num whitespace-nowrap">{runway(s.runwayMonths)}</td>
                    <td className="num">{multiple(s.burnMultiple)}</td>
                    <td className="num">{s.headcount ?? "–"}</td>
                    <td className="whitespace-nowrap">{monthLabel(s.month)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="h2">Runway by company</h2>
        <div className="card">
          {burning.length ? (
            <RunwayChart data={burning} critical={DEFAULT_THRESHOLDS.runwayCriticalMonths} serious={DEFAULT_THRESHOLDS.runwaySeriousMonths} />
          ) : (
            <p className="caption">No company is currently burning cash.</p>
          )}
          {profitable.length > 0 && <p className="caption mt-2">Not shown, cash-flow positive: {profitable.join(", ")}</p>}
        </div>
      </section>
    </div>
  );
}
