import { notFound } from "next/navigation";

import { CompanyPicker } from "@/components/company-picker";
import { MetricLineChart } from "@/components/charts";
import { isAdmin } from "@/lib/auth";
import { fieldCatalogue, getCompany, listCompanies, listCustomValues, listUpdates } from "@/lib/data";
import { dayLabel, formatValue, money, monthLabel, pct, runway, STATUS } from "@/lib/format";
import { addDerived, companyFlags, withLastKnown, worstSeverity } from "@/lib/metrics";
import { requireUser } from "@/lib/session";

/**
 * One company's KPIs, trends, custom metrics and founder notes. The fund team can view any
 * company; founders only their own (anything else is a 404), and never see the fund's warning
 * signs, health status or investment details.
 */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  if (!isAdmin(user) && user.companyId !== id) notFound();
  const company = await getCompany(id);
  if (!company) notFound();
  const admin = isAdmin(user);

  const [history, customValues, catalogue, companies] = await Promise.all([
    listUpdates(id).then(addDerived),
    listCustomValues(id),
    fieldCatalogue(),
    admin ? listCompanies() : Promise.resolve([]),
  ]);

  const picker = admin && <CompanyPicker companies={companies.map((c) => ({ id: c.id, name: c.name }))} current={id} />;
  if (!history.length) {
    return (
      <div className="space-y-6">
        {picker}
        <h1 className="h1">{company.name}</h1>
        <p className="alert alert-info">No figures yet. They&apos;ll appear here once the first update is submitted.</p>
      </div>
    );
  }

  // Figures a partial update request didn't ask for show their last known value.
  const known = withLastKnown(history);
  const latest = known.at(-1)!;
  const prev = known.at(-2);
  const flags = admin ? companyFlags(history, new Date()) : [];
  const worst = worstSeverity(flags);

  const details = [company.sector, company.stage];
  if (admin) {
    if (company.amount_invested) details.push(`${money(company.amount_invested)} invested`);
    if (company.ownership_pct) details.push(`${company.ownership_pct}% ownership`);
    details.push(`${STATUS[worst].icon} ${STATUS[worst].label}`);
  }
  details.push(`last report ${monthLabel(latest.month)}`);

  const delta = (key: "burn" | "headcount") =>
    prev && latest[key] != null && prev[key] != null ? (latest[key] as number) - (prev[key] as number) : null;
  const burnDelta = delta("burn");
  const headDelta = delta("headcount");
  const tiles: { label: string; value: string; change?: string; good?: boolean }[] = [
    { label: "MRR", value: money(latest.revenue), change: latest.revenueGrowth == null ? undefined : pct(latest.revenueGrowth), good: (latest.revenueGrowth ?? 0) >= 0 },
    { label: "Net burn", value: money(latest.burn), change: burnDelta == null ? undefined : `${burnDelta >= 0 ? "+" : ""}${money(burnDelta)}`, good: (burnDelta ?? 0) <= 0 },
    { label: "Cash", value: money(latest.cash) },
    { label: "Runway", value: runway(latest.runwayMonths) },
    { label: "Headcount", value: latest.headcount == null ? "–" : String(latest.headcount), change: headDelta == null ? undefined : `${headDelta >= 0 ? "+" : ""}${headDelta}` },
  ];

  const series = (key: "revenue" | "burn" | "cash" | "headcount") => history.map((r) => ({ month: r.month, value: r[key] }));
  const customKeys = [...new Set(customValues.map((v) => v.key))].filter((k) => catalogue.has(k));
  const notes = history.filter((r) => r.notes?.trim()).reverse();

  return (
    <div className="space-y-8">
      {picker}
      <div>
        <h1 className="h1">{company.name}</h1>
        <p className="caption mt-1">{details.filter(Boolean).join(" · ")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <p className="caption">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</p>
            {t.change && (
              <p className={`mt-1 text-xs font-medium ${t.good === undefined ? "text-ink-2" : t.good ? "text-emerald-700" : "text-red-700"}`}>{t.change}</p>
            )}
          </div>
        ))}
      </div>

      {flags.length > 0 && (
        <div className="space-y-2">
          {flags.map((f) => (
            <p key={f.metric} className={`alert alert-${f.severity}`}>
              {STATUS[f.severity].icon} {STATUS[f.severity].label} — {f.metric}: {f.message}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            ["Monthly recurring revenue", "revenue", "money"],
            ["Net burn", "burn", "money"],
            ["Cash in bank", "cash", "money"],
            ["Headcount", "headcount", "integer"],
          ] as const
        ).map(([label, key, kind]) => (
          <div key={key} className="card">
            <p className="mb-2 text-sm font-semibold">{label}</p>
            <MetricLineChart data={series(key)} kind={kind} label={label} />
          </div>
        ))}
      </div>

      {customKeys.length > 0 && (
        <section className="space-y-4">
          <h2 className="h2">Custom metrics</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {customKeys
              .filter((k) => catalogue.get(k)!.kind !== "text")
              .map((key) => {
                const field = catalogue.get(key)!;
                const values = customValues.filter((v) => v.key === key);
                const last = values.at(-1)!;
                return (
                  <div key={key} className="card">
                    <p className="text-sm font-semibold">
                      {field.label}
                      <span className="caption font-normal">
                        {" "}
                        · latest {formatValue(field, last.valueNum)} ({monthLabel(last.month)})
                      </span>
                    </p>
                    {values.length > 1 ? (
                      <MetricLineChart data={values.map((v) => ({ month: v.month, value: v.valueNum }))} kind={field.kind} label={field.label} />
                    ) : (
                      // A single month is a number, not a trend.
                      <p className="mt-2 text-3xl font-semibold tracking-tight">{formatValue(field, last.valueNum)}</p>
                    )}
                  </div>
                );
              })}
          </div>
          {customKeys
            .filter((k) => catalogue.get(k)!.kind === "text")
            .map((key) => (
              <div key={key} className="card">
                <p className="mb-2 text-sm font-semibold">{catalogue.get(key)!.label}</p>
                <ul className="space-y-1 text-sm">
                  {customValues
                    .filter((v) => v.key === key)
                    .reverse()
                    .map((v) => (
                      <li key={v.month}>
                        <strong>{monthLabel(v.month)}</strong> — {v.valueText}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-3">
          <h2 className="h2">Founder notes</h2>
          <div className="card space-y-2 text-sm">
            {notes.map((r) => (
              <p key={r.month}>
                <strong>{monthLabel(r.month)}</strong> — {r.notes}
              </p>
            ))}
          </div>
        </section>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Monthly data</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">MRR</th>
                <th className="num">MoM growth</th>
                <th className="num">Net burn</th>
                <th className="num">Cash</th>
                <th className="num">Runway</th>
                <th className="num">Headcount</th>
                <th className="num">Customers</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap">{monthLabel(r.month)}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className="num">{pct(r.revenueGrowth)}</td>
                  <td className="num">{money(r.burn)}</td>
                  <td className="num">{money(r.cash)}</td>
                  <td className="num whitespace-nowrap">{runway(r.runwayMonths)}</td>
                  <td className="num">{r.headcount ?? "–"}</td>
                  <td className="num">{r.customers ?? "–"}</td>
                  <td className="whitespace-nowrap">{dayLabel(r.submittedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
