/**
 * A fictional demo portfolio so the app has data to show. Used when SEED_DEMO=true and the
 * database has no companies yet, and by `npm run seed`.
 *
 * Writes through the database handle it is given (it runs while the app's database is still
 * being prepared), inside one transaction holding an advisory lock, so two servers starting at
 * the same time can't both seed.
 */
import type { Db } from "./db";
import { addMonths, isoDate, lastMonth, saveValues } from "./data";
import { hashPassword } from "./auth";

const MONTHS_OF_HISTORY = 15;

// Each scenario exercises a different warning sign on the dashboard. Cash is solved backwards so
// each company ends on `endRunway` months of runway (or `endCash` when cash-flow positive).
const DEMO_COMPANIES = [
  { name: "Lumen Health", sector: "Healthtech", stage: "Series A", invested: 3_000_000, ownership: 12, mrr: 60_000, growth: 0.09, endRunway: 20, burn: 260_000, burnGrowth: 0.02, headcount: 24 },
  { name: "Cargoline", sector: "Logistics", stage: "Seed", invested: 1_200_000, ownership: 15, mrr: 18_000, growth: 0.05, endRunway: 4.5, burn: 170_000, burnGrowth: 0.03, headcount: 11 },
  { name: "Fernly", sector: "Consumer", stage: "Seed", invested: 800_000, ownership: 10, mrr: 45_000, growth: 0.04, endRunway: 10, burn: 95_000, burnGrowth: 0, headcount: 9, declineLast: 3 },
  { name: "Quanta Ledger", sector: "Fintech", stage: "Series B", invested: 5_000_000, ownership: 8, mrr: 420_000, growth: 0.06, endCash: 14_000_000, burn: -20_000, burnGrowth: 0, headcount: 68 },
  { name: "Atlas Robotics", sector: "Deep tech", stage: "Series A", invested: 4_000_000, ownership: 11, mrr: 25_000, growth: 0.07, endRunway: 22, burn: 380_000, burnGrowth: 0.01, headcount: 31, burnSpike: true },
  { name: "Nimbus Learning", sector: "Edtech", stage: "Seed", invested: 1_000_000, ownership: 14, mrr: 30_000, growth: 0.05, endRunway: 14, burn: 110_000, burnGrowth: 0.02, headcount: 13, staleMonths: 4 },
  { name: "Verdant Grid", sector: "Climate", stage: "Series A", invested: 3_500_000, ownership: 9.5, mrr: 95_000, growth: 0.08, endRunway: 24, burn: 300_000, burnGrowth: 0.02, headcount: 27 },
  { name: "Pathwise", sector: "HR tech", stage: "Pre-seed", invested: 400_000, ownership: 18, mrr: 6_000, growth: 0.12, endRunway: 16, burn: 55_000, burnGrowth: 0.03, headcount: 5 },
] as const;

// Answers to the demo board pack's free-text question.
const DEMO_RISKS: Record<string, string> = {
  "Lumen Health": "Hospital procurement cycles slipping into next year",
  Fernly: "Churn among customers acquired through the spring promotion",
  "Quanta Ledger": "New banking regulation could delay two enterprise launches",
  "Atlas Robotics": "Supplier lead times for actuators are now 20 weeks",
  "Verdant Grid": "Grid-connection approvals in two pilot regions",
};

// Demo sign-ins, printed in the README. Only ever for this fictional data.
export const DEMO_ADMIN = { name: "Demo Admin", email: "admin@demo.fund", password: "demo-admin-password" };
export const DEMO_FOUNDER_PASSWORD = "demo-founder-password";
export const DEMO_FOUNDERS: Record<string, { name: string; email: string }> = {
  "Lumen Health": { name: "Ada Okafor", email: "ada@lumenhealth.example" },
  Cargoline: { name: "Ravi Menon", email: "ravi@cargoline.example" },
  Fernly: { name: "Sofia Lindqvist", email: "sofia@fernly.example" },
  "Quanta Ledger": { name: "Tomás Rivera", email: "tomas@quantaledger.example" },
  "Atlas Robotics": { name: "Mei Chen", email: "mei@atlasrobotics.example" },
  "Nimbus Learning": { name: "Kwame Asante", email: "kwame@nimbuslearning.example" }, // invited, hasn't signed in
  "Verdant Grid": { name: "Lena Fischer", email: "lena@verdantgrid.example" },
  Pathwise: { name: "Noor Haddad", email: "noor@pathwise.example" },
};

/** Small deterministic PRNG (mulberry32) so the demo data is the same on every run. */
function random(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { uniform: (lo: number, hi: number) => lo + (hi - lo) * next(), int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), next };
}

const minDate = (a: string, b: string) => (a < b ? a : b);

export async function seedDemoIfEmpty(db: Db, today = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(724501)");
    const [{ n }] = await tx.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM companies");
    if (n > 0) return false;
    await seedDemo(tx, today);
    return true;
  });
}

async function seedDemo(db: Db, today: Date): Promise<void> {
  const rng = random(7);
  const todayIso = isoDate(today);
  const last = lastMonth(today);
  const first = addMonths(last, -(MONTHS_OF_HISTORY - 1));
  const ids = new Map<string, number>();

  for (const spec of DEMO_COMPANIES) {
    const [{ id }] = await db.query<{ id: number }>(
      `INSERT INTO companies (name, sector, stage, invested_on, amount_invested, ownership_pct)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [spec.name, spec.sector, spec.stage, addMonths(first, -3), spec.invested, spec.ownership],
    );
    ids.set(spec.name, id);

    let mrr: number = spec.mrr;
    let burn: number = spec.burn;
    let headcount: number = spec.headcount;
    const months = MONTHS_OF_HISTORY - ("staleMonths" in spec ? spec.staleMonths : 0);
    const rows: { month: string; mrr: number; burn: number; headcount: number }[] = [];
    for (let i = 0; i < months; i++) {
      const monthsLeft = months - i;
      if (i > 0) {
        let growth = spec.growth + rng.uniform(-0.02, 0.02);
        if ("declineLast" in spec && monthsLeft <= spec.declineLast) growth = -rng.uniform(0.06, 0.12);
        mrr *= 1 + growth;
        burn *= 1 + spec.burnGrowth + rng.uniform(-0.02, 0.02);
        if ("burnSpike" in spec && monthsLeft === 1) burn *= 1.45;
        if (rng.next() < 0.25) headcount += 1;
      }
      rows.push({ month: addMonths(first, i), mrr, burn, headcount });
    }
    let cash = "endCash" in spec ? spec.endCash : spec.endRunway * rows.at(-1)!.burn;
    for (const row of [...rows].reverse()) {
      await saveValues(
        id,
        row.month,
        {
          revenue: Math.round(row.mrr),
          burn: Math.round(row.burn),
          cash: Math.round(cash),
          headcount: row.headcount,
          customers: Math.max(1, Math.round(row.mrr / rng.uniform(900, 1100))),
        },
        minDate(`${addMonths(row.month, 1).slice(0, 8)}${String(rng.int(3, 12)).padStart(2, "0")}`, todayIso),
        db,
      );
      cash += row.burn; // cash at the end of the previous month
    }
  }

  // A monthly update request answered by every company except the one that stopped reporting.
  const allIds = [...ids.values()].sort((a, b) => a - b);
  const [{ id: monthly }] = await db.query<{ id: number }>(
    `INSERT INTO update_requests (title, month, fields, company_ids, due_on, created_on)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING id`,
    [`${new Date(`${last}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} monthly update`, last,
      JSON.stringify(["revenue", "burn", "cash", "headcount", "customers", "notes"]), JSON.stringify(allIds), `${todayIso.slice(0, 8)}15`, todayIso],
  );
  await db.query(
    `INSERT INTO request_responses (request_id, company_id, submitted_on)
     SELECT $1, company_id, submitted_on FROM updates WHERE month = $2`,
    [monthly, last],
  );

  // Custom metrics and a quarterly board pack using them, answered by five companies.
  const metric = async (name: string, kind: string, help = "") =>
    (await db.query<{ id: number }>("INSERT INTO custom_metrics (name, kind, help, created_on) VALUES ($1, $2, $3, $4) RETURNING id", [name, kind, help, todayIso]))[0].id;
  const margin = await metric("Gross margin", "percent", "Revenue minus cost of goods sold, as a percentage of revenue");
  const nps = await metric("Net promoter score", "integer", "From -100 to 100");
  const risk = await metric("Biggest risk next quarter", "text");

  const [{ id: boardPack }] = await db.query<{ id: number }>(
    `INSERT INTO update_requests (title, month, fields, company_ids, due_on, created_on)
     VALUES ('Q3 board pack', $1, $2::jsonb, $3::jsonb, $4, $5) RETURNING id`,
    [last, JSON.stringify(["cash", `custom:${margin}`, `custom:${nps}`, `custom:${risk}`]), JSON.stringify(allIds), `${todayIso.slice(0, 8)}28`, todayIso],
  );
  for (const [name, riskText] of Object.entries(DEMO_RISKS)) {
    const companyId = ids.get(name)!;
    let level = rng.uniform(45, 78);
    for (let i = -5; i <= 0; i++) {
      const month = addMonths(last, i);
      level += rng.uniform(-1.5, 2.0);
      await saveValues(companyId, month, { [`custom:${margin}`]: Math.round(level * 10) / 10 }, minDate(`${addMonths(month, 1).slice(0, 8)}08`, todayIso), db);
    }
    await saveValues(companyId, last, { [`custom:${nps}`]: rng.int(20, 65), [`custom:${risk}`]: riskText }, todayIso, db);
    await db.query("INSERT INTO request_responses (request_id, company_id, submitted_on) VALUES ($1, $2, $3)", [boardPack, companyId, todayIso]);
  }

  // Demo accounts. Nimbus Learning's founder has been invited but hasn't set a password.
  await db.query("INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'admin', $3)", [
    DEMO_ADMIN.email, DEMO_ADMIN.name, await hashPassword(DEMO_ADMIN.password),
  ]);
  const founderHash = await hashPassword(DEMO_FOUNDER_PASSWORD);
  for (const [company, person] of Object.entries(DEMO_FOUNDERS)) {
    await db.query("INSERT INTO users (email, name, role, company_id, password_hash) VALUES ($1, $2, 'founder', $3, $4)", [
      person.email, person.name, ids.get(company), company === "Nimbus Learning" ? null : founderHash,
    ]);
  }
}
