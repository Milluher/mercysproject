import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { AuthCard } from "@/components/auth-card";
import { countAdmins } from "@/lib/auth";
import { currentUser, safeNext } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);

  if ((await countAdmins()) === 0) {
    return (
      <AuthCard title="Welcome" subtitle="There are no accounts yet.">
        <Link className="btn btn-primary w-full" href="/setup">
          Set up the first admin
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in">
      <ActionForm action={signIn} submitLabel="Sign in" submitClass="btn btn-primary w-full" resetOnSuccess={false}>
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
      </ActionForm>
      <p className="caption">Forgotten your password? Ask the fund team for a new sign-in link.</p>
    </AuthCard>
  );
}
