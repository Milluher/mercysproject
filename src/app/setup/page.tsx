import Link from "next/link";
import { connection } from "next/server";

import { setupAdmin } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { AuthCard } from "@/components/auth-card";
import { countAdmins, MIN_PASSWORD_LENGTH } from "@/lib/auth";

/** First-run setup: create the first fund admin, using the SETUP_TOKEN from the hosting settings. */
export default async function SetupPage() {
  await connection(); // render per request: whether an admin exists changes at runtime
  if ((await countAdmins()) > 0) {
    return (
      <AuthCard title="Setup is complete" subtitle="An admin account already exists.">
        <Link className="btn btn-primary w-full" href="/login">
          Sign in
        </Link>
      </AuthCard>
    );
  }
  if (!process.env.SETUP_TOKEN || process.env.SETUP_TOKEN.length < 12) {
    return (
      <AuthCard title="Set up the first admin">
        <p className="text-sm text-ink-2">
          To create the first account, add an environment variable named <code className="font-mono">SETUP_TOKEN</code> with a long random
          value (at least 12 characters) in your hosting settings, redeploy, and come back to this page. On Vercel: Project → Settings →
          Environment Variables.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Set up the first admin" subtitle="Create the fund's first account. You can add everyone else from the People page afterwards.">
      <ActionForm action={setupAdmin} submitLabel="Create admin and sign in" submitClass="btn btn-primary w-full" resetOnSuccess={false}>
        <div>
          <label className="label" htmlFor="token">
            Setup code
          </label>
          <input id="token" name="token" type="password" autoComplete="off" required className="input" />
          <p className="hint">The SETUP_TOKEN value from your hosting settings.</p>
        </div>
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input id="name" name="name" autoComplete="name" required className="input" />
        </div>
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
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required className="input" />
          <p className="hint">At least {MIN_PASSWORD_LENGTH} characters</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
        </div>
      </ActionForm>
    </AuthCard>
  );
}
