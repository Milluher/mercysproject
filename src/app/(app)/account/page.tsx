import { changePassword, signOut } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { isAdmin, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { getCompany } from "@/lib/data";
import { requireUser } from "@/lib/session";

export default async function AccountPage() {
  const user = await requireUser();
  const company = user.companyId ? await getCompany(user.companyId) : null;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="h1">Account</h1>
      <div className="card text-sm">
        <p className="font-semibold">{user.name}</p>
        <p className="text-ink-2">{user.email}</p>
        <p className="text-ink-2">{isAdmin(user) ? "Fund team (admin)" : `Founder · ${company?.name}`}</p>
        <form action={signOut} className="mt-3">
          <button className="btn">Sign out</button>
        </form>
      </div>
      <section className="card">
        <h2 className="h2 mb-4">Change password</h2>
        <ActionForm action={changePassword} submitLabel="Change password">
          <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
          {(
            [
              ["current", "Current password", "current-password"],
              ["new", "New password", "new-password"],
              ["confirm", "Confirm new password", "new-password"],
            ] as const
          ).map(([name, label, autoComplete]) => (
            <div key={name}>
              <label className="label" htmlFor={name}>
                {label}
              </label>
              <input
                id={name}
                name={name}
                type="password"
                autoComplete={autoComplete}
                minLength={name === "current" ? undefined : MIN_PASSWORD_LENGTH}
                required
                className="input"
              />
            </div>
          ))}
        </ActionForm>
      </section>
    </div>
  );
}
