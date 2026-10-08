/**
 * Accounts, passwords, invites and sessions.
 *
 * Two roles: "admin" (the fund team, sees everything) and "founder" (tied to one company and
 * sees only that company). Founders get a single-use invite link and choose their own password.
 * Only SHA-256 hashes of invite and session tokens are stored, so a database leak doesn't hand
 * out working links or sign-ins.
 */
import "server-only";

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getDb } from "./db";
import { UserError } from "./fields";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const INVITE_LIFETIME_DAYS = 14;
export const SESSION_LIFETIME_DAYS = 30;
const SCRYPT = { N: 2 ** 14, r: 8, p: 1 }; // RFC 7914 interactive-login parameters

/** Overridable clock so tests can step past lockouts and expiries. */
export const clock = { now: () => new Date() };

export class AuthError extends UserError {}

export type Role = "admin" | "founder";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  companyId: number | null;
}

export const isAdmin = (u: Pick<User, "role">) => u.role === "admin";

// --- Passwords and tokens -------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, digest] = stored?.split("$") ?? [];
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const candidate = await scrypt(password, Buffer.from(salt, "hex"), 32, SCRYPT);
  const expected = Buffer.from(digest, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

let dummyHash: Promise<string> | undefined;
/** A real hash to check against when an email is unknown, so both cases take the same time. */
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

export function checkPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.trim() !== password) throw new AuthError("Passwords can't start or end with a space");
}

const newToken = () => randomBytes(24).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function normaliseEmail(email: string): string {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address");
  return email;
}

// --- Users ------------------------------------------------------------------------------

type UserRow = { id: number; email: string; name: string; role: Role; company_id: number | null };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, companyId: r.company_id });

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  companyId?: number | null;
  password?: string;
}): Promise<User> {
  const email = normaliseEmail(input.email);
  const name = input.name.split(/\s+/).filter(Boolean).join(" ");
  if (!name) throw new AuthError("Enter the person's name");
  if (input.role !== "admin" && input.role !== "founder") throw new AuthError(`Unknown role: ${input.role}`);
  const companyId = input.role === "founder" ? (input.companyId ?? null) : null;
  if (input.role === "founder" && companyId == null) throw new AuthError("Choose the founder's company");
  if (input.password !== undefined) checkPasswordStrength(input.password);

  const db = await getDb();
  if ((await db.query("SELECT 1 FROM users WHERE email = $1", [email])).length) {
    throw new AuthError(`There is already an account for ${email}`);
  }
  const [row] = await db.query<UserRow>(
    `INSERT INTO users (email, name, role, company_id, password_hash) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, company_id`,
    [email, name, input.role, companyId, input.password ? await hashPassword(input.password) : null],
  );
  return toUser(row);
}

/** An active account by id, or null if it doesn't exist or was deactivated. */
export async function getUser(id: number): Promise<User | null> {
  const [row] = await (await getDb()).query<UserRow>(
    "SELECT id, email, name, role, company_id FROM users WHERE id = $1 AND active",
    [id],
  );
  return row ? toUser(row) : null;
}

export interface UserListing extends User {
  company: string | null;
  active: boolean;
  hasPassword: boolean;
  lastLogin: Date | null;
}

export async function listUsers(): Promise<UserListing[]> {
  const rows = await (await getDb()).query<UserRow & { company: string | null; active: boolean; has_password: boolean; last_login: Date | null }>(
    `SELECT u.id, u.email, u.name, u.role, u.company_id, c.name AS company, u.active,
            u.password_hash IS NOT NULL AS has_password, u.last_login
     FROM users u LEFT JOIN companies c ON c.id = u.company_id
     ORDER BY u.role DESC, c.name, u.name`,
  );
  return rows.map((r) => ({ ...toUser(r), company: r.company, active: r.active, hasPassword: r.has_password, lastLogin: r.last_login }));
}

export async function countAdmins(): Promise<number> {
  const [row] = await (await getDb()).query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active");
  return row.n;
}

/** Deactivate (or restore) an account. Deactivation ends the person's sessions and invites at once. */
export async function setActive(userId: number, active: boolean): Promise<void> {
  const db = await getDb();
  const [row] = await db.query<{ role: Role; active: boolean }>("SELECT role, active FROM users WHERE id = $1", [userId]);
  if (!row) throw new AuthError("No such account");
  if (!active && row.role === "admin" && row.active) {
    const [{ n }] = await db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1",
      [userId],
    );
    if (n === 0) throw new AuthError("You can't deactivate the last admin");
  }
  await db.query("UPDATE users SET active = $1 WHERE id = $2", [active, userId]);
  if (!active) {
    await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await db.query("UPDATE invites SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL", [clock.now(), userId]);
  }
}

export async function changePassword(userId: number, current: string, next: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = $1 AND active", [userId]);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new AuthError("Your current password is incorrect");
  checkPasswordStrength(next);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(next), userId]);
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]); // sign out everywhere else
}

// --- Sign-in ---------------------------------------------------------------------------

/** Check an email and password. Repeated failures lock the account for a while. */
export async function authenticate(emailInput: string, password: string): Promise<User> {
  const generic = new AuthError("Incorrect email or password");
  let email: string;
  try {
    email = normaliseEmail(emailInput);
  } catch {
    throw generic;
  }
  const db = await getDb();
  const now = clock.now();
  const [row] = await db.query<UserRow & { password_hash: string | null; active: boolean; failed_logins: number; locked_until: Date | null }>(
    `SELECT id, email, name, role, company_id, password_hash, active, failed_logins, locked_until
     FROM users WHERE email = $1`,
    [email],
  );
  if (!row) {
    await verifyPassword(password, await getDummyHash()); // don't reveal which emails exist
    throw generic;
  }
  if (row.locked_until && new Date(row.locked_until) > now) {
    throw new AuthError("Too many failed attempts. Try again in a few minutes.");
  }
  if (!row.active || !(await verifyPassword(password, row.password_hash))) {
    const failed = row.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCKOUT_MS) : null;
    await db.query("UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3", [lock ? 0 : failed, lock, row.id]);
    throw generic;
  }
  await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = $1 WHERE id = $2", [now, row.id]);
  return toUser(row);
}

// --- Sessions ----------------------------------------------------------------------------

/** Start a session; returns the token for the session cookie. */
export async function createSession(userId: number): Promise<{ token: string; expires: Date }> {
  const token = newToken();
  const expires = new Date(clock.now().getTime() + SESSION_LIFETIME_DAYS * 86_400_000);
  await (await getDb()).query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hashToken(token), userId, expires]);
  return { token, expires };
}

/** The active user a session token belongs to, or null if the session is unknown, expired or the account deactivated. */
export async function sessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [row] = await (await getDb()).query<UserRow>(
    `SELECT u.id, u.email, u.name, u.role, u.company_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.active`,
    [hashToken(token), clock.now()],
  );
  return row ? toUser(row) : null;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (token) await (await getDb()).query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

// --- Invites -----------------------------------------------------------------------------

/**
 * A new single-use token for the person to set their password. Earlier unused invites stop
 * working. Only the hash is stored, so a link can't be shown again; make a new one instead.
 */
export async function createInvite(userId: number): Promise<string> {
  const db = await getDb();
  if (!(await db.query("SELECT 1 FROM users WHERE id = $1 AND active", [userId])).length) {
    throw new AuthError("No active account to invite");
  }
  const now = clock.now();
  const token = newToken();
  await db.query("UPDATE invites SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL", [now, userId]);
  await db.query("INSERT INTO invites (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    new Date(now.getTime() + INVITE_LIFETIME_DAYS * 86_400_000),
  ]);
  return token;
}

/** The account an invite token is for, if the token is still valid. */
export async function inviteUser(token: string): Promise<User> {
  const [row] = await (await getDb()).query<UserRow & { expires_at: Date; used_at: Date | null; active: boolean }>(
    `SELECT u.id, u.email, u.name, u.role, u.company_id, i.expires_at, i.used_at, u.active
     FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row || row.used_at || !row.active) throw new AuthError("This invite link isn't valid any more. Ask the fund for a new one.");
  if (new Date(row.expires_at) < clock.now()) throw new AuthError("This invite link has expired. Ask the fund for a new one.");
  return toUser(row);
}

/** Set the account's password from an invite, use the invite up, and end any old sessions. */
export async function acceptInvite(token: string, password: string): Promise<User> {
  const user = await inviteUser(token);
  checkPasswordStrength(password);
  const hash = await hashPassword(password);
  const now = clock.now();
  await (await getDb()).transaction(async (tx) => {
    // Claim the invite first, so two simultaneous submissions can't both use it.
    const claimed = await tx.query("UPDATE invites SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL RETURNING 1", [now, hashToken(token)]);
    if (!claimed.length) throw new AuthError("This invite link isn't valid any more. Ask the fund for a new one.");
    await tx.query(
      "UPDATE users SET password_hash = $1, failed_logins = 0, locked_until = NULL, last_login = $2 WHERE id = $3",
      [hash, now, user.id],
    );
    await tx.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  });
  return user;
}
