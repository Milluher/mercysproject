"use server";
/**
 * Server actions: everything the app's forms do.
 *
 * Each action is reachable by a direct HTTP request, not just from the app's own forms, so each
 * one checks who is signed in and what they may do before touching anything. Founders' company
 * always comes from their account, never from the submitted form.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as auth from "@/lib/auth";
import {
  addCompany,
  addCustomMetric,
  createRequest,
  deleteCustomMetric,
  deleteRequest,
  fieldCatalogue,
  getRequest,
  listUpdates,
  monthStart,
  saveValues,
  submitRequestResponse,
  type Values,
} from "@/lib/data";
import { UserError, type MetricField } from "@/lib/fields";
import { addDerived, companyFlags } from "@/lib/metrics";
import { appUrl, finishSession, requireAdmin, requireUser, safeNext, startSession } from "@/lib/session";

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
  link?: string; // a one-time link to show (invites)
  flags?: string[]; // warning signs raised by a submission (fund team only)
  nonce?: number; // changes on every success, so forms can reset themselves
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const int = (form: FormData, name: string) => {
  const n = Number(form.get(name));
  return Number.isInteger(n) ? n : null;
};

/** Run an action, turning expected problems into a message for the form. */
async function attempt(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return { ok: true, nonce: Date.now(), ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e; // redirects, notFound and real bugs
  }
}

// --- Sign-in, invites and first-run setup ---------------------------------------------

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  let user: auth.User;
  try {
    user = await auth.authenticate(text(form, "email"), String(form.get("password") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await startSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  await finishSession();
  redirect("/login");
}

export async function acceptInvite(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The passwords don't match." };
  let user: auth.User;
  try {
    user = await auth.acceptInvite(text(form, "token"), password);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await startSession(user.id);
  redirect("/");
}

/** Create the first admin. Only works while there are no admins, and only with the SETUP_TOKEN. */
export async function setupAdmin(_: FormState, form: FormData): Promise<FormState> {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 12) return { error: "Setup is disabled. Set a SETUP_TOKEN of at least 12 characters first." };
  if ((await auth.countAdmins()) > 0) return { error: "Setup is already complete. Sign in instead." };
  const { timingSafeEqual, createHash } = await import("node:crypto");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(digest(text(form, "token")), digest(expected))) return { error: "That setup code is incorrect." };
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The passwords don't match." };
  let user: auth.User;
  try {
    user = await auth.createUser({ email: text(form, "email"), name: text(form, "name"), role: "admin", password });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await startSession(user.id);
  redirect("/");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const next = String(form.get("new") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "The new passwords don't match." };
  return attempt(async () => {
    await auth.changePassword(user.id, String(form.get("current") ?? ""), next);
    await startSession(user.id); // changing the password signed out every session, including this one
    return { message: "Password changed. Other devices have been signed out." };
  });
}

// --- Submitting figures ---------------------------------------------------------------

/** Read metric inputs (named by metric key) from a form. Blank → null; bad numbers are an error. */
function readValues(form: FormData, fields: MetricField[]): Values {
  const values: Values = {};
  for (const f of fields) {
    const raw = text(form, f.key);
    if (raw === "") {
      values[f.key] = null;
    } else if (f.kind === "text") {
      values[f.key] = raw;
    } else {
      const n = Number(raw.replace(/[,$%\s]/g, ""));
      if (!Number.isFinite(n)) throw new UserError(`${f.label} must be a number`);
      if (!f.allowNegative && n < 0) throw new UserError(`${f.label} can't be negative`);
      if (f.kind === "integer" && !Number.isInteger(n)) throw new UserError(`${f.label} must be a whole number`);
      values[f.key] = n;
    }
  }
  return values;
}

async function flagMessages(companyId: number): Promise<string[]> {
  const history = addDerived(await listUpdates(companyId));
  return companyFlags(history, new Date()).map((f) => `${f.severity}|${f.metric}: ${f.message}`);
}

export async function submitRequest(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    const request = await getRequest(int(form, "request") ?? -1);
    if (!request) throw new UserError("That update request no longer exists");
    // Founders answer for their own company only, whatever the form says.
    const companyId = auth.isAdmin(user) ? int(form, "company") : user.companyId;
    if (companyId == null || !request.companyIds.includes(companyId)) throw new UserError("This request isn't for that company");
    const catalogue = await fieldCatalogue();
    const fields = request.fields.map((k) => catalogue.get(k)).filter((f): f is MetricField => !!f);
    await submitRequestResponse(request.id, companyId, readValues(form, fields));
    revalidatePath("/", "layout");
    return { message: "Thanks! Your figures have been received.", flags: auth.isAdmin(user) ? await flagMessages(companyId) : undefined };
  });
}

export async function submitGeneral(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    const companyId = auth.isAdmin(user) ? int(form, "company") : user.companyId;
    if (companyId == null) throw new UserError("Choose a company");
    const month = text(form, "month");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("Choose the reporting month");
    if (`${month}-01` > monthStart(new Date())) throw new UserError("The reporting month can't be in the future");
    const values = readValues(form, [...(await fieldCatalogue()).values()]);
    if (Object.values(values).every((v) => v == null)) throw new UserError("Fill in at least one metric");
    await saveValues(companyId, `${month}-01`, values);
    revalidatePath("/", "layout");
    return { message: "Update saved.", flags: auth.isAdmin(user) ? await flagMessages(companyId) : undefined };
  });
}

// --- Fund admin: requests, metrics, companies -------------------------------------------

export async function createRequestAction(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    const month = text(form, "month");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("Choose the reporting month");
    await createRequest({
      title: text(form, "title"),
      month: `${month}-01`,
      fields: form.getAll("fields").map(String),
      companyIds: form.getAll("companies").map(Number).filter(Number.isInteger),
      dueOn: text(form, "due") || null,
    });
    revalidatePath("/requests");
    return { message: `Created “${text(form, "title")}”. Share its link from the list below.` };
  });
}

export async function deleteRequestAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id != null) await deleteRequest(id);
  revalidatePath("/requests");
}

export async function addCustomMetricAction(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    await addCustomMetric(text(form, "name"), text(form, "kind"), text(form, "help"));
    revalidatePath("/requests");
    return { message: `Added “${text(form, "name")}”.` };
  });
}

export async function deleteCustomMetricAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id != null) {
    try {
      await deleteCustomMetric(id);
    } catch (e) {
      if (!(e instanceof UserError)) throw e; // the button only shows for unused metrics
    }
  }
  revalidatePath("/requests");
}

export async function addCompanyAction(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    const num = (k: string) => (text(form, k) === "" ? null : Number(text(form, k)));
    await addCompany({
      name: text(form, "name"),
      sector: text(form, "sector"),
      stage: text(form, "stage"),
      investedOn: text(form, "investedOn") || null,
      amountInvested: num("amountInvested"),
      ownershipPct: num("ownershipPct"),
    });
    revalidatePath("/", "layout");
    return { message: `Added ${text(form, "name")}.` };
  });
}

// --- Fund admin: people -------------------------------------------------------------------

export async function addPerson(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    const role = text(form, "role") === "admin" ? "admin" : "founder";
    const user = await auth.createUser({ email: text(form, "email"), name: text(form, "name"), role, companyId: int(form, "company") });
    const token = await auth.createInvite(user.id);
    revalidatePath("/people");
    return { message: `Added ${user.name}. Send them this link to choose a password and sign in.`, link: await appUrl(`/invite?token=${token}`) };
  });
}

export async function newInvite(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    const token = await auth.createInvite(int(form, "id") ?? -1);
    return { link: await appUrl(`/invite?token=${token}`) };
  });
}

export async function setActiveAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireAdmin();
  return attempt(async () => {
    const id = int(form, "id") ?? -1;
    const active = text(form, "active") === "true";
    if (id === me.id && !active) throw new UserError("You can't deactivate yourself");
    await auth.setActive(id, active);
    revalidatePath("/people");
  });
}
