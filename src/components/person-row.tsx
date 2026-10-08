"use client";

import { useActionState } from "react";

import { newInvite, setActiveAction, type FormState } from "@/app/actions";
import { FormMessages } from "./action-form";

export interface PersonView {
  id: number;
  name: string;
  email: string;
  company: string | null;
  active: boolean;
  hasPassword: boolean;
  lastLogin: string | null; // already formatted
  isMe: boolean;
}

/** One account on the People page, with its invite/reset and (de)activate buttons. */
export function PersonRow({ person }: { person: PersonView }) {
  const [inviteState, inviteAction, invitePending] = useActionState(newInvite, {} as FormState);
  const [activeState, activeAction, activePending] = useActionState(setActiveAction, {} as FormState);

  const status = !person.active
    ? "⛔ Deactivated"
    : !person.hasPassword
      ? "✉️ Invite not accepted yet"
      : person.lastLogin
        ? `✅ Last signed in ${person.lastLogin}`
        : "✅ Active";

  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {person.name}
            {person.isMe && <span className="caption font-normal"> (you)</span>}
          </p>
          <p className="text-sm text-ink-2">
            {person.email}
            {person.company && ` · ${person.company}`}
          </p>
        </div>
        <p className="caption">{status}</p>
        <div className="flex gap-2">
          {person.active && (
            <form action={inviteAction}>
              <input type="hidden" name="id" value={person.id} />
              <button className="btn" disabled={invitePending} title="Make a new single-use link; older links stop working">
                {person.hasPassword ? "Reset link" : "New invite"}
              </button>
            </form>
          )}
          {!person.isMe && (
            <form action={activeAction}>
              <input type="hidden" name="id" value={person.id} />
              <input type="hidden" name="active" value={String(!person.active)} />
              <button className={`btn ${person.active ? "btn-danger" : ""}`} disabled={activePending}>
                {person.active ? "Deactivate" : "Reactivate"}
              </button>
            </form>
          )}
        </div>
      </div>
      {inviteState.link && (
        <p className="text-sm">
          Send this link to {person.name} so they can {person.hasPassword ? "reset their password" : "choose a password and sign in"}:
        </p>
      )}
      <FormMessages state={{ ...inviteState, message: undefined }} />
      <FormMessages state={{ error: activeState.error }} />
    </li>
  );
}
