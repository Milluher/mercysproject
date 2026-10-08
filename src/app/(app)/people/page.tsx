import { addPerson } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { PersonRow } from "@/components/person-row";
import { listUsers } from "@/lib/auth";
import { listCompanies } from "@/lib/data";
import { dayLabel } from "@/lib/format";
import { requireAdmin } from "@/lib/session";

/** Fund admin: accounts for founders and the fund team. */
export default async function PeoplePage() {
  const me = await requireAdmin();
  const [users, companies] = await Promise.all([listUsers(), listCompanies()]);
  const view = (u: (typeof users)[number]) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    company: u.company,
    active: u.active,
    hasPassword: u.hasPassword,
    lastLogin: u.lastLogin ? dayLabel(new Date(u.lastLogin)) : null,
    isMe: u.id === me.id,
  });
  const founders = users.filter((u) => u.role === "founder");
  const team = users.filter((u) => u.role === "admin");
  const covered = new Set(founders.filter((u) => u.active).map((u) => u.companyId));
  const uncovered = companies.filter((c) => !covered.has(c.id)).map((c) => c.name);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="h1">People</h1>
        <p className="caption mt-1">
          Founders sign in to see their own company and answer the fund&apos;s requests. They never see other companies or the fund&apos;s
          warning signs. The fund team sees everything.
        </p>
      </div>

      <section className="card">
        <h2 className="h2 mb-4">Add a person</h2>
        <ActionForm action={addPerson} submitLabel="Add and create invite link">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" name="email" type="email" required className="input" />
            </div>
            <fieldset>
              <legend className="label">Role</legend>
              <div className="flex gap-4 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="role" value="founder" defaultChecked /> Founder
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="role" value="admin" /> Fund team (admin)
                </label>
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="company">
                Company (founders only)
              </label>
              <select id="company" name="company" className="input" defaultValue="">
                <option value="" disabled>
                  Choose a company
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </ActionForm>
      </section>

      {(
        [
          ["Founders", founders],
          ["Fund team", team],
        ] as const
      ).map(([heading, group]) => (
        <section key={heading} className="space-y-3">
          <h2 className="h2">
            {heading} ({group.filter((u) => u.active).length})
          </h2>
          {group.length === 0 && <p className="caption">No one yet.</p>}
          <ul className="space-y-3">
            {group.map((u) => (
              <PersonRow key={u.id} person={view(u)} />
            ))}
          </ul>
        </section>
      ))}
      {uncovered.length > 0 && <p className="caption">Companies with no founder account: {uncovered.join(", ")}</p>}
    </div>
  );
}
