"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

import type { FormState } from "@/app/actions";
import { CopyField } from "./copy-field";

const SEVERITY_ICON: Record<string, string> = { critical: "🔴", serious: "🟠", warning: "🟡" };

/**
 * A form wired to a server action, showing the action's error or success message (plus any
 * one-time link or warning signs it returns). Resets its fields after each success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitClass = "btn btn-primary",
  className = "space-y-4",
  resetOnSuccess = true,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  submitClass?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.nonce && resetOnSuccess) ref.current?.reset();
  }, [state.nonce, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div>
        <button type="submit" className={submitClass} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </button>
      </div>
      <FormMessages state={state} />
    </form>
  );
}

export function FormMessages({ state }: { state: FormState }) {
  return (
    <div aria-live="polite" className="space-y-2 empty:hidden">
      {state.error && <p className="alert alert-critical">{state.error}</p>}
      {state.message && <p className="alert alert-success">{state.message}</p>}
      {state.link && <CopyField value={state.link} note="Works once and expires in 14 days. It won't be shown again, but you can make a new one." />}
      {state.flags && state.flags.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">These figures raise the following warning signs:</p>
          {state.flags.map((f) => {
            const [severity, message] = f.split("|");
            return (
              <p key={f} className={`alert alert-${severity}`}>
                {SEVERITY_ICON[severity]} {message}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
