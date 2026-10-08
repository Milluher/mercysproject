"use client";

import { useState } from "react";

/** A read-only link with a Copy button. */
export function CopyField({ value, note }: { value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
        <button
          type="button"
          className="btn shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}
