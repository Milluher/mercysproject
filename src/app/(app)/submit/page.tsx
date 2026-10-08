import Link from "next/link";

import { submitGeneral, submitRequest } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MetricInputs } from "@/components/metric-inputs";
import { isAdmin } from "@/lib/auth";
import { fieldCatalogue, getCompany, lastMonth, listCompanies, listRequests, monthStart } from "@/lib/data";
import type { MetricField } from "@/lib/fields";
import { dayLabel, monthLabel } from "@/lib/format";
import { requireUser } from "@/lib/session";

/**
 * Submitting figures. Founders see the requests sent to their company and only ever submit for
 * that company (taken from their account by the server action, not from this form). The fund
 * team can answer any request for any company, or enter a general update.
 */
export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ request?: string; general?: string }> }) {
  const user = await requireUser();
  const admin = isAdmin(user);
  const query = await searchParams;
  const [allRequests, companies, catalogue] = await Promise.all([listRequests(), listCompanies(), fieldCatalogue()]);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const requests = admin ? allRequests : allRequests.filter((r) => r.companyIds.includes(user.companyId!));
  const myCompany = admin ? null : await getCompany(user.companyId!);

  // --- One request's form -------------------------------------------------------------
  if (query.request) {
    const request = requests.find((r) => r.id === Number(query.request));
    if (!request) {
      return (
        <div className="space-y-4">
          <h1 className="h1">Submit an update</h1>
          <p className="alert alert-serious">
            {admin ? "That update request no longer exists." : "That request link isn't for your company or no longer exists."}
          </p>
          <Link className="btn" href="/submit">
            See your requests
          </Link>
        </div>
      );
    }
    const fields = request.fields.map((k) => catalogue.get(k)).filter((f): f is MetricField => !!f);
    const asked = request.companyIds.filter((c) => names.has(c));
    const answeredOn = !admin ? request.responses.get(user.companyId!) : undefined;
    return (
      <div className="max-w-3xl space-y-6">
        <Link className="caption hover:underline" href="/submit">
          ← All requests
        </Link>
        <div>
          <h1 className="h1">{request.title}</h1>
          <p className="mt-2 text-sm text-ink-2">
            {myCompany && (
              <>
                <strong>{myCompany.name}</strong> ·{" "}
              </>
            )}
            Reporting month: <strong>{monthLabel(request.month, true)}</strong>
            {request.dueOn && (
              <>
                {" "}
                · Due <strong>{dayLabel(request.dueOn)}</strong>
              </>
            )}
          </p>
        </div>
        {answeredOn && <p className="alert alert-info">Already submitted on {dayLabel(answeredOn)}. Submitting again replaces those figures.</p>}
        <div className="card">
          <ActionForm action={submitRequest} submitLabel="Submit">
            <input type="hidden" name="request" value={request.id} />
            {admin && (
              <div className="max-w-sm">
                <label className="label" htmlFor="company">
                  Company
                </label>
                <select id="company" name="company" className="input">
                  {asked.map((c) => (
                    <option key={c} value={c}>
                      {names.get(c)}
                      {request.responses.has(c) ? " ✅" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <MetricInputs fields={fields} />
          </ActionForm>
        </div>
      </div>
    );
  }

  // --- General update ---------------------------------------------------------------------
  if (query.general) {
    return (
      <div className="max-w-3xl space-y-6">
        <Link className="caption hover:underline" href="/submit">
          ← All requests
        </Link>
        <div>
          <h1 className="h1">General update</h1>
          <p className="caption mt-1">Fill in any metrics for any month. Blank fields keep whatever was already saved for that month.</p>
        </div>
        <div className="card">
          <ActionForm action={submitGeneral} submitLabel="Submit update">
            <div className="grid gap-4 sm:grid-cols-2">
              {admin ? (
                <div>
                  <label className="label" htmlFor="company">
                    Company
                  </label>
                  <select id="company" name="company" className="input">
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <p className="label">Company</p>
                  <p className="py-2 text-sm">{myCompany?.name}</p>
                </div>
              )}
              <div>
                <label className="label" htmlFor="month">
                  Reporting month
                </label>
                <input id="month" name="month" type="month" required defaultValue={lastMonth().slice(0, 7)} max={monthStart(new Date()).slice(0, 7)} className="input" />
              </div>
            </div>
            <MetricInputs fields={[...catalogue.values()]} optional />
          </ActionForm>
        </div>
      </div>
    );
  }

  // --- The list of requests -----------------------------------------------------------------
  const done = (r: (typeof requests)[number]) => (admin ? r.companyIds.every((c) => r.responses.has(c)) : r.responses.has(user.companyId!));
  const ordered = [...requests].sort((a, b) => Number(done(a)) - Number(done(b)) || b.id - a.id);
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="h1">{admin ? "Submit an update" : myCompany?.name}</h1>
        <p className="caption mt-1">{admin ? "Answer a request on a company's behalf, or enter a general update." : "Updates the fund has asked you for"}</p>
      </div>
      {!admin && ordered.length === 0 && <p className="alert alert-info">The fund hasn&apos;t asked you for anything right now.</p>}
      <ul className="space-y-3">
        {ordered.map((r) => {
          const answeredOn = admin ? undefined : r.responses.get(user.companyId!);
          return (
            <li key={r.id}>
              <Link href={`/submit?request=${r.id}`} className="card flex items-center justify-between gap-4 transition hover:border-brand">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="caption">
                    {monthLabel(r.month, true)}
                    {r.dueOn && ` · due ${dayLabel(r.dueOn)}`}
                    {admin && ` · ${r.responses.size} of ${r.companyIds.length} responded`}
                  </p>
                </div>
                <span className="shrink-0 text-sm">
                  {admin ? "Open →" : answeredOn ? `✅ Submitted ${dayLabel(answeredOn)}` : <span className="btn btn-primary">Fill in</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/submit?general=1" className="btn">
        General update (any metrics, any month)
      </Link>
    </div>
  );
}
