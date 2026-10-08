import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as auth from "@/lib/auth";
import { addCompany } from "@/lib/data";
import { getDb } from "@/lib/db";
import { freshDb } from "./helpers";

const PASSWORD = "correct horse battery";
let acme: number;
let founder: auth.User;
const realNow = auth.clock.now;

const later = (ms: number) => {
  const t = Date.now() + ms;
  auth.clock.now = () => new Date(t);
};

beforeEach(async () => {
  await freshDb();
  acme = await addCompany({ name: "Acme" });
  founder = await auth.createUser({ email: "Jo@Acme.example ", name: "Jo  Founder", role: "founder", companyId: acme, password: PASSWORD });
});
afterEach(() => {
  auth.clock.now = realNow;
});

describe("passwords", () => {
  it("hash with a salt and verify", async () => {
    const stored = await auth.hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
    expect(await auth.verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await auth.verifyPassword("wrong password", stored)).toBe(false);
    expect(await auth.hashPassword(PASSWORD)).not.toBe(stored);
    expect(await auth.verifyPassword(PASSWORD, null)).toBe(false);
    expect(await auth.verifyPassword(PASSWORD, "garbage")).toBe(false);
  });
});

describe("users", () => {
  it("normalise and validate", async () => {
    expect([founder.email, founder.name, founder.companyId]).toEqual(["jo@acme.example", "Jo Founder", acme]);
    await expect(auth.createUser({ email: "JO@acme.example", name: "X", role: "founder", companyId: acme })).rejects.toThrow("already an account");
    await expect(auth.createUser({ email: "x@y.example", name: "X", role: "founder" })).rejects.toThrow("company");
    await expect(auth.createUser({ email: "not-an-email", name: "X", role: "admin" })).rejects.toThrow("valid email");
    await expect(auth.createUser({ email: "x@y.example", name: "X", role: "admin", password: "short" })).rejects.toThrow("at least");
  });

  it("admins have no company", async () => {
    const admin = await auth.createUser({ email: "a@fund.example", name: "Ann", role: "admin", companyId: acme, password: PASSWORD });
    expect(admin.companyId).toBeNull();
  });

  it("can't deactivate the last admin", async () => {
    const admin = await auth.createUser({ email: "a@fund.example", name: "Ann", role: "admin", password: PASSWORD });
    await expect(auth.setActive(admin.id, false)).rejects.toThrow("last admin");
    await auth.createUser({ email: "b@fund.example", name: "Bo", role: "admin", password: PASSWORD });
    await auth.setActive(admin.id, false);
    expect(await auth.countAdmins()).toBe(1);
  });

  it("change password and sign out other sessions", async () => {
    const { token } = await auth.createSession(founder.id);
    await expect(auth.changePassword(founder.id, "wrong password", "new password 123")).rejects.toThrow("current password");
    await auth.changePassword(founder.id, PASSWORD, "new password 123");
    expect(await auth.authenticate(founder.email, "new password 123")).toEqual(founder);
    expect(await auth.sessionUser(token)).toBeNull();
  });
});

describe("sign-in", () => {
  it("accepts the right password only, without revealing which emails exist", async () => {
    expect(await auth.authenticate("  JO@acme.example", PASSWORD)).toEqual(founder);
    for (const [email, pw] of [["jo@acme.example", "wrong password"], ["nobody@x.example", PASSWORD], ["", ""]]) {
      await expect(auth.authenticate(email, pw)).rejects.toThrow("Incorrect email or password");
    }
  });

  it("locks an account after repeated failures", async () => {
    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i++) {
      await expect(auth.authenticate(founder.email, "wrong password")).rejects.toThrow("Incorrect");
    }
    await expect(auth.authenticate(founder.email, PASSWORD)).rejects.toThrow("Too many failed attempts");
    later(auth.LOCKOUT_MS + 60_000);
    expect(await auth.authenticate(founder.email, PASSWORD)).toEqual(founder);
  });

  it("refuses deactivated accounts and ends their sessions", async () => {
    await auth.createUser({ email: "a@fund.example", name: "Ann", role: "admin", password: PASSWORD });
    const { token } = await auth.createSession(founder.id);
    expect(await auth.sessionUser(token)).toEqual(founder);
    await auth.setActive(founder.id, false);
    expect(await auth.sessionUser(token)).toBeNull();
    await expect(auth.authenticate(founder.email, PASSWORD)).rejects.toThrow("Incorrect");
    await auth.setActive(founder.id, true);
    expect(await auth.getUser(founder.id)).toEqual(founder);
  });
});

describe("sessions", () => {
  it("expire and can be ended", async () => {
    const { token } = await auth.createSession(founder.id);
    expect(await auth.sessionUser(token)).toEqual(founder);
    expect(await auth.sessionUser("made-up-token")).toBeNull();
    expect(await auth.sessionUser(undefined)).toBeNull();
    later(auth.SESSION_LIFETIME_DAYS * 86_400_000 + 1000);
    expect(await auth.sessionUser(token)).toBeNull();
    auth.clock.now = realNow;
    const second = await auth.createSession(founder.id);
    await auth.endSession(second.token);
    expect(await auth.sessionUser(second.token)).toBeNull();
  });

  it("store only token hashes", async () => {
    const { token } = await auth.createSession(founder.id);
    const invite = await auth.createInvite(founder.id);
    const db = await getDb();
    const stored = [
      ...(await db.query<{ token_hash: string }>("SELECT token_hash FROM sessions")),
      ...(await db.query<{ token_hash: string }>("SELECT token_hash FROM invites")),
    ].map((r) => r.token_hash);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(invite);
  });
});

describe("invites", () => {
  it("let the person set a password once", async () => {
    const user = await auth.createUser({ email: "new@acme.example", name: "New Founder", role: "founder", companyId: acme });
    await expect(auth.authenticate(user.email, PASSWORD)).rejects.toThrow();
    const token = await auth.createInvite(user.id);
    expect(await auth.inviteUser(token)).toEqual(user);
    await expect(auth.acceptInvite(token, "short")).rejects.toThrow("at least");
    expect(await auth.acceptInvite(token, PASSWORD)).toEqual(user);
    expect(await auth.authenticate(user.email, PASSWORD)).toEqual(user);
    await expect(auth.acceptInvite(token, "another password")).rejects.toThrow("isn't valid");
  });

  it("stop working when replaced, expired, or the account is deactivated", async () => {
    const first = await auth.createInvite(founder.id);
    const second = await auth.createInvite(founder.id);
    await expect(auth.inviteUser(first)).rejects.toThrow("isn't valid");
    expect(await auth.inviteUser(second)).toEqual(founder);

    later((auth.INVITE_LIFETIME_DAYS + 1) * 86_400_000);
    await expect(auth.inviteUser(second)).rejects.toThrow("expired");
    auth.clock.now = realNow;

    await auth.createUser({ email: "a@fund.example", name: "Ann", role: "admin", password: PASSWORD });
    const third = await auth.createInvite(founder.id);
    await auth.setActive(founder.id, false);
    await expect(auth.inviteUser(third)).rejects.toThrow();
  });

  it("listing shows who has set a password", async () => {
    await auth.createUser({ email: "pending@acme.example", name: "Pending", role: "founder", companyId: acme });
    const users = Object.fromEntries((await auth.listUsers()).map((u) => [u.email, u]));
    expect(users["jo@acme.example"]).toMatchObject({ company: "Acme", hasPassword: true });
    expect(users["pending@acme.example"].hasPassword).toBe(false);
  });
});
