/** Companies, monthly KPI updates, custom metrics and update requests. */
import "server-only";

import { getDb, type Db } from "./db";
import {
  CUSTOM_KINDS,
  METRIC_FIELDS,
  UserError,
  customField,
  customId,
  isBuiltIn,
  validateFields,
  type MetricField,
  type MetricKind,
} from "./fields";
import type { UpdateRow } from "./metrics";

export type Values = Record<string, number | string | null | undefined>;

/** Local calendar date as ISO text, e.g. "2026-10-08". */
export function isoDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First day of the month of an ISO date or Date, e.g. "2026-09-17" → "2026-09-01". */
export function monthStart(d: string | Date): string {
  return (typeof d === "string" ? d : isoDate(d)).slice(0, 7) + "-01";
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export const lastMonth = (today = new Date()) => addMonths(monthStart(today), -1);

// --- Companies --------------------------------------------------------------------

export interface Company {
  id: number;
  name: string;
  sector: string;
  stage: string;
  invested_on: string | null;
  amount_invested: number | null;
  ownership_pct: number | null;
}

export async function listCompanies(): Promise<Company[]> {
  return (await getDb()).query<Company>("SELECT * FROM companies ORDER BY name");
}

export async function getCompany(id: number): Promise<Company | null> {
  const [row] = await (await getDb()).query<Company>("SELECT * FROM companies WHERE id = $1", [id]);
  return row ?? null;
}

export async function addCompany(input: {
  name: string;
  sector?: string;
  stage?: string;
  investedOn?: string | null;
  amountInvested?: number | null;
  ownershipPct?: number | null;
}): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new UserError("Company name is required");
  const db = await getDb();
  const [exists] = await db.query("SELECT 1 FROM companies WHERE lower(name) = lower($1)", [name]);
  if (exists) throw new UserError(`${name} is already in the portfolio`);
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO companies (name, sector, stage, invested_on, amount_invested, ownership_pct)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, input.sector?.trim() ?? "", input.stage ?? "", input.investedOn ?? null, input.amountInvested ?? null, input.ownershipPct ?? null],
  );
  return row.id;
}

// --- Monthly updates ----------------------------------------------------------------

export async function listUpdates(companyId?: number): Promise<UpdateRow[]> {
  const rows = await (await getDb()).query<Record<string, unknown>>(
    `SELECT u.*, c.name AS company FROM updates u JOIN companies c ON c.id = u.company_id
     ${companyId == null ? "" : "WHERE u.company_id = $1"}
     ORDER BY c.name, u.month`,
    companyId == null ? [] : [companyId],
  );
  return rows.map((r) => ({
    companyId: r.company_id as number,
    company: r.company as string,
    month: r.month as string,
    revenue: r.revenue as number | null,
    burn: r.burn as number | null,
    cash: r.cash as number | null,
    headcount: r.headcount as number | null,
    customers: r.customers as number | null,
    notes: r.notes as string | null,
    submittedOn: r.submitted_on as string,
  }));
}

/**
 * Save a company's built-in figures for a month. Values left undefined/null keep whatever is
 * already stored, so several partial requests for the same month add up to one complete update.
 */
export async function upsertUpdate(
  companyId: number,
  month: string,
  values: Partial<Record<"revenue" | "burn" | "cash" | "headcount" | "customers" | "notes", number | string | null>>,
  submittedOn = isoDate(),
  db?: Db,
): Promise<void> {
  db ??= await getDb();
  const v = (k: keyof typeof values) => values[k] ?? null;
  await db.query(
    `INSERT INTO updates (company_id, month, revenue, burn, cash, headcount, customers, notes, submitted_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (company_id, month) DO UPDATE SET
       revenue = COALESCE(EXCLUDED.revenue, updates.revenue),
       burn = COALESCE(EXCLUDED.burn, updates.burn),
       cash = COALESCE(EXCLUDED.cash, updates.cash),
       headcount = COALESCE(EXCLUDED.headcount, updates.headcount),
       customers = COALESCE(EXCLUDED.customers, updates.customers),
       notes = COALESCE(EXCLUDED.notes, updates.notes),
       submitted_on = EXCLUDED.submitted_on`,
    [companyId, monthStart(month), v("revenue"), v("burn"), v("cash"), v("headcount"), v("customers"), v("notes"), submittedOn],
  );
}

// --- Custom metrics -------------------------------------------------------------------

export interface CustomMetric {
  id: number;
  name: string;
  kind: MetricKind;
  help: string;
  key: string;
  requests: number; // how many requests ask for it
  answers: number; // how many values have been submitted
}

export async function listCustomMetrics(): Promise<CustomMetric[]> {
  const db = await getDb();
  const metrics = await db.query<Omit<CustomMetric, "key" | "requests">>(
    `SELECT m.id, m.name, m.kind, m.help,
            (SELECT COUNT(*)::int FROM custom_values v WHERE v.metric_id = m.id) AS answers
     FROM custom_metrics m ORDER BY lower(m.name)`,
  );
  const requestFields = (await db.query<{ fields: string[] }>("SELECT fields FROM update_requests")).map((r) => r.fields);
  return metrics.map((m) => ({
    ...m,
    key: `custom:${m.id}`,
    requests: requestFields.filter((f) => f.includes(`custom:${m.id}`)).length,
  }));
}

export async function addCustomMetric(name: string, kind: string, help = ""): Promise<number> {
  name = name.split(/\s+/).filter(Boolean).join(" ");
  if (!name) throw new UserError("A custom metric needs a name");
  if (!(kind in CUSTOM_KINDS)) throw new UserError(`Unknown metric type: ${kind}`);
  const label = (name + CUSTOM_KINDS[kind as MetricKind].suffix).toLowerCase();
  const catalogue = await fieldCatalogue();
  const names = (await listCustomMetrics()).map((m) => m.name.toLowerCase());
  if ([...catalogue.values()].some((f) => f.label.toLowerCase() === label) || names.includes(name.toLowerCase())) {
    throw new UserError(`There is already a metric called “${name}”`);
  }
  const [row] = await (await getDb()).query<{ id: number }>(
    "INSERT INTO custom_metrics (name, kind, help, created_on) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, kind, help.trim(), isoDate()],
  );
  return row.id;
}

/** Delete a custom metric that no request uses and nobody has answered. */
export async function deleteCustomMetric(id: number): Promise<void> {
  const metric = (await listCustomMetrics()).find((m) => m.id === id);
  if (!metric) return;
  if (metric.requests || metric.answers) {
    throw new UserError(`“${metric.name}” is already used in a request, so it can't be deleted`);
  }
  await (await getDb()).query("DELETE FROM custom_metrics WHERE id = $1", [id]);
}

/** Every metric that can be requested: built-in ones first, then custom ones by name. */
export async function fieldCatalogue(): Promise<Map<string, MetricField>> {
  const rows = await (await getDb()).query<{ id: number; name: string; kind: MetricKind; help: string }>(
    "SELECT id, name, kind, help FROM custom_metrics ORDER BY lower(name)",
  );
  return new Map<string, MetricField>([
    ...Object.values(METRIC_FIELDS).map((f) => [f.key, f] as const),
    ...rows.map((r) => [`custom:${r.id}`, customField(r.id, r.name, r.kind, r.help)] as const),
  ]);
}

export interface CustomValue {
  companyId: number;
  company: string;
  month: string;
  metricId: number;
  key: string;
  metric: string;
  kind: MetricKind;
  valueNum: number | null;
  valueText: string | null;
}

export async function listCustomValues(companyId?: number): Promise<CustomValue[]> {
  const rows = await (await getDb()).query<Record<string, unknown>>(
    `SELECT v.company_id, c.name AS company, v.month, v.metric_id, m.name AS metric, m.kind, v.value_num, v.value_text
     FROM custom_values v JOIN companies c ON c.id = v.company_id JOIN custom_metrics m ON m.id = v.metric_id
     ${companyId == null ? "" : "WHERE v.company_id = $1"}
     ORDER BY c.name, lower(m.name), v.month`,
    companyId == null ? [] : [companyId],
  );
  return rows.map((r) => ({
    companyId: r.company_id as number,
    company: r.company as string,
    month: r.month as string,
    metricId: r.metric_id as number,
    key: `custom:${r.metric_id}`,
    metric: r.metric as string,
    kind: r.kind as MetricKind,
    valueNum: r.value_num as number | null,
    valueText: r.value_text as string | null,
  }));
}

/** Save built-in and custom metric values for a company's month. Blank values are left unchanged. */
export async function saveValues(companyId: number, month: string, values: Values, submittedOn = isoDate(), db?: Db): Promise<void> {
  db ??= await getDb();
  const builtIn: Record<string, number | string | null> = {};
  const custom: [number, number | string][] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") continue;
    if (isBuiltIn(key)) builtIn[key] = value;
    else if (customId(key) != null) custom.push([customId(key)!, value]);
  }
  if (Object.keys(builtIn).length) await upsertUpdate(companyId, month, builtIn, submittedOn, db);
  if (!custom.length) return;
  const kinds = new Map(
    (await db.query<{ id: number; kind: MetricKind }>("SELECT id, kind FROM custom_metrics")).map((r) => [r.id, r.kind]),
  );
  for (const [metricId, value] of custom) {
    const kind = kinds.get(metricId);
    if (!kind) continue; // deleted since the form was shown
    await db.query(
      `INSERT INTO custom_values (company_id, month, metric_id, value_num, value_text, submitted_on)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, month, metric_id) DO UPDATE SET
         value_num = EXCLUDED.value_num, value_text = EXCLUDED.value_text, submitted_on = EXCLUDED.submitted_on`,
      [companyId, monthStart(month), metricId, kind === "text" ? null : Number(value), kind === "text" ? String(value) : null, submittedOn],
    );
  }
}

// --- Update requests ------------------------------------------------------------------

export interface UpdateRequest {
  id: number;
  title: string;
  month: string;
  fields: string[];
  companyIds: number[];
  dueOn: string | null;
  createdOn: string;
  responses: Map<number, string>; // company id → date submitted
}

export async function createRequest(input: {
  title: string;
  month: string;
  fields: string[];
  companyIds: number[];
  dueOn?: string | null;
}): Promise<number> {
  const title = input.title.trim();
  if (!title) throw new UserError("A request needs a title");
  if (!input.companyIds.length) throw new UserError("Select at least one company");
  const fields = validateFields(input.fields, await fieldCatalogue());
  const [row] = await (await getDb()).query<{ id: number }>(
    `INSERT INTO update_requests (title, month, fields, company_ids, due_on, created_on)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING id`,
    [
      title,
      monthStart(input.month),
      JSON.stringify(fields),
      JSON.stringify([...new Set(input.companyIds)].sort((a, b) => a - b)),
      input.dueOn || null,
      isoDate(),
    ],
  );
  return row.id;
}

/** Remove a request and its response log. Figures already submitted are kept. */
export async function deleteRequest(id: number): Promise<void> {
  await (await getDb()).query("DELETE FROM update_requests WHERE id = $1", [id]);
}

/** All requests, newest first, with which companies have responded. */
export async function listRequests(): Promise<UpdateRequest[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>("SELECT * FROM update_requests ORDER BY id DESC");
  const responses = await db.query<{ request_id: number; company_id: number; submitted_on: string }>(
    "SELECT request_id, company_id, submitted_on FROM request_responses",
  );
  return rows.map((r) => ({
    id: r.id as number,
    title: r.title as string,
    month: r.month as string,
    fields: r.fields as string[],
    companyIds: r.company_ids as number[],
    dueOn: r.due_on as string | null,
    createdOn: r.created_on as string,
    responses: new Map(responses.filter((x) => x.request_id === r.id).map((x) => [x.company_id, x.submitted_on])),
  }));
}

export async function getRequest(id: number): Promise<UpdateRequest | null> {
  return (await listRequests()).find((r) => r.id === id) ?? null;
}

/** Save a company's answers to a request and record that it has responded. */
export async function submitRequestResponse(requestId: number, companyId: number, values: Values, submittedOn = isoDate()): Promise<void> {
  const request = await getRequest(requestId);
  if (!request) throw new UserError("That update request no longer exists");
  if (!request.companyIds.includes(companyId)) throw new UserError("This company was not asked for this update");
  const catalogue = await fieldCatalogue();
  const fields = request.fields.map((k) => catalogue.get(k)).filter((f): f is MetricField => !!f);
  const missing = fields.filter((f) => f.required && (values[f.key] == null || values[f.key] === ""));
  if (missing.length) throw new UserError(`Missing values for: ${missing.map((f) => f.label).join(", ")}`);

  const answers = Object.fromEntries(fields.map((f) => [f.key, values[f.key]]));
  await (await getDb()).transaction(async (tx) => {
    await saveValues(companyId, request.month, answers, submittedOn, tx);
    await tx.query(
      `INSERT INTO request_responses (request_id, company_id, submitted_on) VALUES ($1, $2, $3)
       ON CONFLICT (request_id, company_id) DO UPDATE SET submitted_on = EXCLUDED.submitted_on`,
      [requestId, companyId, submittedOn],
    );
  });
}

/**
 * Each asked company's answers for the request's month, per requested metric. Companies that
 * haven't responded get blanks, even if they reported some of the same figures another way.
 */
export async function requestAnswers(request: UpdateRequest): Promise<Map<number, Values>> {
  const updates = (await listUpdates()).filter((u) => u.month === request.month);
  const custom = (await listCustomValues()).filter((v) => v.month === request.month);
  const answers = new Map<number, Values>();
  for (const companyId of request.companyIds) {
    const row: Values = {};
    if (request.responses.has(companyId)) {
      const update = updates.find((u) => u.companyId === companyId);
      for (const key of request.fields) {
        if (isBuiltIn(key)) row[key] = update ? (update[key] as number | string | null) : null;
        else {
          const v = custom.find((c) => c.companyId === companyId && c.key === key);
          row[key] = v ? (v.kind === "text" ? v.valueText : v.valueNum) : null;
        }
      }
    }
    answers.set(companyId, row);
  }
  return answers;
}
