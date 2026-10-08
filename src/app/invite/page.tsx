import Link from "next/link";

import { acceptInvite } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { AuthCard } from "@/components/auth-card";
import { AuthError, inviteUser, MIN_PASSWORD_LENGTH, type User } from "@/lib/auth";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  let user: User;
  try {
    user = await inviteUser(token);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return (
      <AuthCard title="Invite link">
        <p className="alert alert-critical">{e.message}</p>
        <Link className="btn" href="/login">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Welcome, ${user.name.split(" ")[0]}`}
      subtitle={
        <>
          Choose a password for <strong>{user.email}</strong>. You&apos;ll use it to sign in from now on.
        </>
      }
    >
      <ActionForm action={acceptInvite} submitLabel="Set password and sign in" submitClass="btn btn-primary w-full" resetOnSuccess={false}>
        <input type="hidden" name="token" value={token} />
        <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <div>
          <label className="label" htmlFor="password">
            New password
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
