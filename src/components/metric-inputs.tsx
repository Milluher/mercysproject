import type { MetricField } from "@/lib/fields";

const STEP: Record<string, string> = { money: "1", integer: "1", number: "any", percent: "0.1" };

/**
 * One input per metric, named by the metric key so actions can read them back.
 * Numeric metrics sit in two columns; text metrics follow as full-width text areas.
 */
export function MetricInputs({ fields, optional = false }: { fields: MetricField[]; optional?: boolean }) {
  const numeric = fields.filter((f) => f.kind !== "text");
  const texts = fields.filter((f) => f.kind === "text");
  const required = (f: MetricField) => !optional && f.required;
  return (
    <>
      {numeric.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {numeric.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                name={f.key}
                type="number"
                inputMode="decimal"
                step={STEP[f.kind]}
                min={f.allowNegative ? undefined : 0}
                required={required(f)}
                placeholder={required(f) ? "Required" : "Optional"}
                className="input"
              />
              {f.help && <p className="hint">{f.help}</p>}
            </div>
          ))}
        </div>
      )}
      {texts.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={f.key}>
            {f.label}
          </label>
          <textarea
            id={f.key}
            name={f.key}
            rows={3}
            required={required(f)}
            placeholder={f.key === "notes" ? "Key wins, risks, and where the fund can help" : required(f) ? "Required" : "Optional"}
            className="input"
          />
          {f.help && <p className="hint">{f.help}</p>}
        </div>
      ))}
    </>
  );
}
