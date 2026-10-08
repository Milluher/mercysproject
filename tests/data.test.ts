import { beforeEach, describe, expect, it } from "vitest";

import {
  addCompany,
  addCustomMetric,
  createRequest,
  deleteCustomMetric,
  deleteRequest,
  fieldCatalogue,
  getRequest,
  listCompanies,
  listCustomMetrics,
  listCustomValues,
  listRequests,
  listUpdates,
  requestAnswers,
  submitRequestResponse,
  upsertUpdate,
} from "@/lib/data";
import { BUILT_IN_KEYS } from "@/lib/fields";
import { addDerived, latestSnapshot, portfolioFlags } from "@/lib/metrics";
import { freshDb } from "./helpers";

const SEPT = "2026-09-01";
let acme: number;

beforeEach(async () => {
  await freshDb();
  acme = await addCompany({ name: "Acme" });
});

describe("companies and updates", () => {
  it("rejects duplicate and empty company names", async () => {
    await expect(addCompany({ name: "acme" })).rejects.toThrow("already in the portfolio");
    await expect(addCompany({ name: "  " })).rejects.toThrow("required");
  });

  it("merges partial updates for the same month and normalises the month", async () => {
    await upsertUpdate(acme, "2026-09-15", { revenue: 1, burn: 1, cash: 1, headcount: 1 });
    await upsertUpdate(acme, SEPT, { revenue: 2 });
    const [row] = await listUpdates();
    expect(row.month).toBe(SEPT);
    expect([row.revenue, row.cash]).toEqual([2, 1]);
  });
});

describe("update requests", () => {
  it("stores fields in catalogue order", async () => {
    const id = await createRequest({ title: "  Q3 board pack ", month: "2026-09-17", fields: ["cash", "revenue"], companyIds: [acme] });
    const r = (await getRequest(id))!;
    expect([r.title, r.month, r.fields, r.companyIds, r.responses.size]).toEqual(["Q3 board pack", SEPT, ["revenue", "cash"], [acme], 0]);
  });

  it.each([
    ["", ["revenue"], true, "title"],
    ["Update", [], true, "at least one metric"],
    ["Update", ["revenue", "ebitda"], true, "Unknown metric"],
    ["Update", ["revenue"], false, "at least one company"],
  ])("validates a request (%s %j)", async (title, fields, withCompany, message) => {
    await expect(createRequest({ title, month: SEPT, fields, companyIds: withCompany ? [acme] : [] })).rejects.toThrow(message);
  });

  it("requires every requested metric except notes", async () => {
    const id = await createRequest({ title: "Cash", month: SEPT, fields: ["cash", "burn", "notes"], companyIds: [acme] });
    await expect(submitRequestResponse(id, acme, { cash: 100 })).rejects.toThrow("Net burn");
    await submitRequestResponse(id, acme, { cash: 100, burn: 10 });
    expect((await getRequest(id))!.responses.has(acme)).toBe(true);
  });

  it("rejects answers from a company that wasn't asked", async () => {
    const other = await addCompany({ name: "Other" });
    const id = await createRequest({ title: "Cash", month: SEPT, fields: ["cash"], companyIds: [acme] });
    await expect(submitRequestResponse(id, other, { cash: 1 })).rejects.toThrow("not asked");
  });

  it("only saves requested metrics", async () => {
    const id = await createRequest({ title: "Revenue", month: SEPT, fields: ["revenue"], companyIds: [acme] });
    await submitRequestResponse(id, acme, { revenue: 500, cash: 999 });
    const [row] = await listUpdates();
    expect([row.revenue, row.cash]).toEqual([500, null]);
  });

  it("adds up partial requests for the same month", async () => {
    const r1 = await createRequest({ title: "Revenue", month: SEPT, fields: ["revenue", "notes"], companyIds: [acme] });
    const r2 = await createRequest({ title: "Cash", month: SEPT, fields: ["cash", "burn"], companyIds: [acme] });
    await submitRequestResponse(r1, acme, { revenue: 500, notes: "Good month" });
    await submitRequestResponse(r2, acme, { cash: 10_000, burn: 1_000 });
    const rows = await listUpdates();
    expect(rows).toHaveLength(1);
    expect([rows[0].revenue, rows[0].cash, rows[0].burn, rows[0].notes]).toEqual([500, 10_000, 1_000, "Good month"]);
    expect(addDerived(rows)[0].runwayMonths).toBe(10);
  });

  it("replaces figures and response date on resubmission", async () => {
    const id = await createRequest({ title: "Revenue", month: SEPT, fields: ["revenue"], companyIds: [acme] });
    await submitRequestResponse(id, acme, { revenue: 500 }, "2026-10-02");
    await submitRequestResponse(id, acme, { revenue: 550 }, "2026-10-04");
    expect((await listUpdates())[0].revenue).toBe(550);
    expect([...(await getRequest(id))!.responses]).toEqual([[acme, "2026-10-04"]]);
  });

  it("keeps submitted figures when a request is deleted", async () => {
    const id = await createRequest({ title: "Revenue", month: SEPT, fields: ["revenue"], companyIds: [acme] });
    await submitRequestResponse(id, acme, { revenue: 500 });
    await deleteRequest(id);
    expect(await getRequest(id)).toBeNull();
    expect(await listUpdates()).toHaveLength(1);
  });
});

describe("custom metrics", () => {
  it("join the catalogue after the built-in metrics", async () => {
    const id = await addCustomMetric("  Gross   margin ", "percent", "As % of revenue");
    const catalogue = await fieldCatalogue();
    expect([...catalogue.keys()].slice(0, BUILT_IN_KEYS.length)).toEqual([...BUILT_IN_KEYS]);
    expect(catalogue.get(`custom:${id}`)).toMatchObject({ label: "Gross margin (%)", kind: "percent", help: "As % of revenue" });
  });

  it.each([
    ["", "number", "needs a name"],
    ["NPS", "colour", "Unknown metric type"],
    ["Paying customers", "integer", "already a metric"],
  ])("validate %j", async (name, kind, message) => {
    await expect(addCustomMetric(name, kind)).rejects.toThrow(message);
  });

  it("have unique names ignoring case", async () => {
    await addCustomMetric("NPS", "integer");
    await expect(addCustomMetric("nps", "number")).rejects.toThrow("already a metric");
  });

  it("round-trip through a request, including required text answers", async () => {
    const margin = await addCustomMetric("Gross margin", "percent");
    const risk = await addCustomMetric("Biggest risk", "text");
    const keys = [`custom:${margin}`, `custom:${risk}`, "cash"];
    const id = await createRequest({ title: "Board pack", month: SEPT, fields: keys, companyIds: [acme] });
    await expect(submitRequestResponse(id, acme, { [keys[0]]: 61.5, cash: 1000, [keys[1]]: "" })).rejects.toThrow("Biggest risk");
    await submitRequestResponse(id, acme, { [keys[0]]: 61.5, [keys[1]]: "Hiring", cash: 1000 });
    const answers = (await requestAnswers((await getRequest(id))!)).get(acme)!;
    expect([answers[keys[0]], answers[keys[1]], answers.cash]).toEqual([61.5, "Hiring", 1000]);
  });

  it("don't create empty KPI rows when only custom metrics are requested", async () => {
    const nps = await addCustomMetric("NPS", "integer");
    const id = await createRequest({ title: "NPS", month: SEPT, fields: [`custom:${nps}`], companyIds: [acme] });
    await submitRequestResponse(id, acme, { [`custom:${nps}`]: -10 }); // negative scores are valid
    expect(await listUpdates()).toHaveLength(0);
    expect((await listCustomValues())[0].valueNum).toBe(-10);
  });

  it("show answers only for companies that responded to that request", async () => {
    const other = await addCompany({ name: "Other" });
    const nps = await addCustomMetric("NPS", "integer");
    const id = await createRequest({ title: "NPS", month: SEPT, fields: [`custom:${nps}`, "revenue"], companyIds: [acme, other] });
    await submitRequestResponse(id, acme, { [`custom:${nps}`]: 40, revenue: 10 });
    await upsertUpdate(other, SEPT, { revenue: 99 }); // reported elsewhere, not to this request
    const answers = await requestAnswers((await getRequest(id))!);
    expect(answers.get(acme)![`custom:${nps}`]).toBe(40);
    expect(answers.get(other)!.revenue).toBeUndefined();
  });

  it("can only be deleted while unused", async () => {
    const unused = await addCustomMetric("Unused", "number");
    const used = await addCustomMetric("Used", "number");
    await createRequest({ title: "Uses it", month: SEPT, fields: [`custom:${used}`], companyIds: [acme] });
    await deleteCustomMetric(unused);
    expect((await fieldCatalogue()).has(`custom:${unused}`)).toBe(false);
    await expect(deleteCustomMetric(used)).rejects.toThrow("already used");
    expect((await listCustomMetrics()).map((m) => [m.name, m.requests])).toEqual([["Used", 1]]);
  });
});

describe("demo data", () => {
  it("covers every warning sign and both demo requests", async () => {
    await freshDb({ seedDemo: true });
    const today = new Date();
    expect(await listCompanies()).toHaveLength(8);
    const derived = addDerived(await listUpdates());
    const metrics = new Set(portfolioFlags(derived, today).map((f) => f.metric));
    expect([...metrics].sort()).toEqual(["Burn", "Efficiency", "Reporting", "Revenue", "Runway"]);
    expect(portfolioFlags(derived, today).some((f) => f.company === "Quanta Ledger")).toBe(false);
    expect(latestSnapshot(derived)).toHaveLength(8);

    const requests = Object.fromEntries((await listRequests()).map((r) => [r.title, r]));
    expect(requests["Q3 board pack"].responses.size).toBe(5);
    const monthly = Object.values(requests).find((r) => r.title.endsWith("monthly update"))!;
    expect(monthly.responses.size).toBe(7); // the stale company hasn't answered
  });
});
