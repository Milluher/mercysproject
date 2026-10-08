import {
  addCompanyAction,
  addCustomMetricAction,
  createRequestAction,
  deleteCustomMetricAction,
  deleteRequestAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyField } from "@/components/copy-field";
import { listUsers } from "@/lib/auth";
import { fieldCatalogue, isoDate, lastMonth, listCompanies, listCustomMetrics, listRequests, requestAnswers } from "@/lib/data";
import { CUSTOM_KINDS, DEFAULT_FIELDS } from "@/lib/fields";
import { dayLabel, formatValue, monthLabel } from "@/lib/format";
import { appUrl, requireAdmin } from "@/lib/session";

export default async function RequestsPage() {
  await requireAdmin();
  const [companies, catalogue, customMetrics, requests, users] = await Promise.all([
    listCompanies(),
    fieldCatalogue(),
    listCustomMetrics(),
    listRequests(),
    listUsers(),
  ]);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const today = isoDate();
  const defaultMonth = lastMonth().slice(0, 7);

  // Whether each company has a founder who can sign in and answer.
  const founderAccess = (companyId: number) => {
    const people = users.filter((u) => u.role === "founder" && u.active && u.companyId === companyId);
    const canSignIn = people.filter((u) => u.hasPassword).length;
    if (canSignIn) return `✅ ${canSignIn} can sign in`;
    return people.length ? "✉️ Invite not accepted" : "⚠️ No founder account";
  };

  const cards = await Promise.all(
    requests.map(async (r) => ({ request: r, answers: await requestAnswers(r), link: await appUrl(`/submit?request=${r.id}`) })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h1">Update requests</h1>
        <p className="caption mt-1">
          Ask portfolio companies for the metrics you need. The title becomes the title of the form founders fill in, and they only see the
          metrics you request.
        </p>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">Custom metrics ({customMetrics.length})</summary>
        <div className="mt-4 space-y-5">
          <p className="caption">
            Define your own metrics, like gross margin or NPS, to request alongside the built-in ones. Answers show up in each request&apos;s
            table and on the company&apos;s page.
          </p>
          <ActionForm action={addCustomMetricAction} submitLabel="Add metric" submitClass="btn">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="metric-name">
                  Metric name
                </label>
                <input id="metric-name" name="name" required maxLength={60} placeholder="e.g. Gross margin" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="metric-kind">
                  Type
                </label>
                <select id="metric-kind" name="kind" className="input">
                  {Object.entries(CUSTOM_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="metric-help">
                Note for founders (optional)
              </label>
              <input id="metric-help" name="help" placeholder="e.g. Revenue minus cost of goods sold, as a % of revenue" className="input" />
            </div>
          </ActionForm>
          {customMetrics.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {customMetrics.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold">{catalogue.get(m.key)?.label}</p>
                    {m.help && <p className="caption">{m.help}</p>}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="caption">
                      {CUSTOM_KINDS[m.kind].label} · in {m.requests} request{m.requests === 1 ? "" : "s"} · {m.answers} answer
                      {m.answers === 1 ? "" : "s"}
                    </span>
                    {!m.requests && !m.answers && (
                      <form action={deleteCustomMetricAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn btn-danger">Delete</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {companies.length === 0 ? (
        <p className="alert alert-info">Add a portfolio company first (bottom of this page).</p>
      ) : (
        <section className="card">
          <h2 className="h2 mb-4">New request</h2>
          <ActionForm action={createRequestAction} submitLabel="Create request">
            <div>
              <label className="label" htmlFor="title">
                Title
              </label>
              <input id="title" name="title" required maxLength={120} placeholder={`${monthLabel(lastMonth(), true)} monthly update`} className="input" />
              <p className="hint">Founders see this as the title of their form.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="month">
                  Reporting month
                </label>
                <input id="month" name="month" type="month" required defaultValue={defaultMonth} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="due">
                  Due date (optional)
                </label>
                <input id="due" name="due" type="date" min={today} className="input" />
              </div>
            </div>
            <fieldset>
              <legend className="label">Metrics to request</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[...catalogue.values()].map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="fields" value={f.key} defaultChecked={DEFAULT_FIELDS.includes(f.key)} />
                    {f.label}
                    {f.key.startsWith("custom:") && <span className="caption">· custom</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Companies</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {companies.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="companies" value={c.id} defaultChecked />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="h2">Requests</h2>
        {cards.length === 0 && <p className="caption">No update requests yet.</p>}
        {cards.map(({ request: r, answers, link }) => {
          const asked = r.companyIds.filter((c) => names.has(c));
          const responded = asked.filter((c) => r.responses.has(c));
          const overdue = r.dueOn != null && r.dueOn < today;
          const fields = r.fields.map((k) => catalogue.get(k)).filter((f) => !!f);
          // Companies still to respond first, then alphabetical.
          const ordered = [...asked].sort((a, b) => Number(r.responses.has(a)) - Number(r.responses.has(b)) || names.get(a)!.localeCompare(names.get(b)!));
          const pending = asked.filter((c) => !r.responses.has(c)).map((c) => names.get(c)!);
          return (
            <article key={r.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{r.title}</h3>
                  <p className="caption">
                    Reporting month {monthLabel(r.month, true)}
                    {r.dueOn && ` · due ${dayLabel(r.dueOn)}${overdue && pending.length ? " (overdue)" : ""}`} · created {dayLabel(r.createdOn)}
                  </p>
                </div>
                <details className="relative">
                  <summary className="btn cursor-pointer list-none">Delete</summary>
                  <div className="absolute right-0 z-10 mt-2 w-64 space-y-2 rounded-lg border border-line bg-white p-3 text-sm shadow-lg">
                    <p>Delete this request? Figures companies already submitted are kept.</p>
                    <form action={deleteRequestAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn btn-danger w-full">Delete request</button>
                    </form>
                  </div>
                </details>
              </div>
              <p className="text-sm">
                <strong>Metrics:</strong> {fields.map((f) => f.label).join(" · ")}
              </p>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={responded.length} aria-valuemax={asked.length}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${asked.length ? (100 * responded.length) / asked.length : 0}%` }} />
                </div>
                <p className="caption mt-1">
                  {responded.length} of {asked.length} companies responded
                </p>
              </div>
              <div>
                <p className="label">Link for founders</p>
                <CopyField value={link} note="Each founder signs in and sees this form for their own company." />
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status</th>
                      {fields.map((f) => (
                        <th key={f.key}>{f.label}</th>
                      ))}
                      <th title="Founders need an account to answer. Add them on the People page.">Founder access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((c) => (
                      <tr key={c}>
                        <td className="font-medium whitespace-nowrap">{names.get(c)}</td>
                        <td className="whitespace-nowrap">
                          {r.responses.has(c) ? `✅ Responded ${dayLabel(r.responses.get(c)!)}` : overdue ? "⚠️ Overdue" : "⏳ Waiting"}
                        </td>
                        {fields.map((f) => (
                          <td key={f.key} className={f.kind === "text" ? "min-w-48" : "num"}>
                            {formatValue(f, answers.get(c)?.[f.key])}
                          </td>
                        ))}
                        <td className="whitespace-nowrap">{founderAccess(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pending.length > 0 && <p className="caption">Still waiting on: {pending.sort().join(", ")}</p>}
            </article>
          );
        })}
      </section>

      <details className="card">
        <summary className="cursor-pointer font-semibold">Add a portfolio company</summary>
        <div className="mt-4">
          <ActionForm action={addCompanyAction} submitLabel="Add company" submitClass="btn">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="c-name">
                  Company name
                </label>
                <input id="c-name" name="name" required className="input" />
              </div>
              <div>
                <label className="label" htmlFor="c-sector">
                  Sector
                </label>
                <input id="c-sector" name="sector" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="c-stage">
                  Stage
                </label>
                <select id="c-stage" name="stage" className="input">
                  {["Pre-seed", "Seed", "Series A", "Series B", "Series C+"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="c-date">
                  Investment date
                </label>
                <input id="c-date" name="investedOn" type="date" defaultValue={today} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="c-amount">
                  Amount invested ($)
                </label>
                <input id="c-amount" name="amountInvested" type="number" min={0} step={1} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="c-own">
                  Ownership (%)
                </label>
                <input id="c-own" name="ownershipPct" type="number" min={0} max={100} step={0.1} className="input" />
              </div>
            </div>
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
