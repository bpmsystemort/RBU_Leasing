import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { makeLimiter, LIMITS, rateLimit } from "../src/middleware/rateLimit.js";
import { hashPassword } from "../src/services/authService.js";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables } from "./helpers.js";
import { createApp } from "../src/app.js";

// The public endpoints — sign-in, sign-up, inquiry — take no token, so nothing
// else stops a script hammering them. These pin the throttle, and that it counts
// the right thing: only FAILED sign-ins, so a busy office is never locked out by
// its own successful logins.
const app = createApp();

describe("makeLimiter", () => {
  function appWith(limiter) {
    const a = express();
    a.use(express.json());
    a.post("/try", limiter, (req, res) => (req.body.ok ? res.json({ ok: true }) : res.status(401).json({ error: "nope" })));
    return a;
  }

  it("answers 429 with the app's own error shape once the limit is passed", async () => {
    const a = appWith(makeLimiter({ windowMs: 60_000, limit: 2, message: "Slow down.", skip: () => false }));
    expect((await request(a).post("/try").send({ ok: true })).status).toBe(200);
    expect((await request(a).post("/try").send({ ok: true })).status).toBe(200);
    const res = await request(a).post("/try").send({ ok: true });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Slow down." });
  });

  it("counts only failures when asked to, so successes never lock anyone out", async () => {
    const a = appWith(makeLimiter({ windowMs: 60_000, limit: 2, skipSuccessfulRequests: true, message: "Slow down.", skip: () => false }));
    for (let i = 0; i < 6; i++) expect((await request(a).post("/try").send({ ok: true })).status).toBe(200);
    expect((await request(a).post("/try").send({ ok: false })).status).toBe(401);
    expect((await request(a).post("/try").send({ ok: false })).status).toBe(401);
    // two failures used the allowance; the next attempt of any kind is refused
    expect((await request(a).post("/try").send({ ok: true })).status).toBe(429);
  });

  it("is switched off under the test runner so the rest of the suite is not throttled", async () => {
    const a = appWith(makeLimiter({ windowMs: 60_000, limit: 1, message: "Slow down." }));
    for (let i = 0; i < 4; i++) expect((await request(a).post("/try").send({ ok: true })).status).toBe(200);
  });
});

describe("the real public routes", () => {
  beforeEach(async () => { await resetCrudTables(); });
  afterEach(() => { delete process.env.RATE_LIMIT; });

  // Sends n requests and returns their statuses, so a test can say exactly which
  // ones were allowed and which refused.
  async function fire(n, send) {
    const out = [];
    for (let i = 0; i < n; i++) out.push((await send()).status);
    return out;
  }

  // The allowances are a decision, not an accident: a typo that sets one to 3
  // would lock people out, and one set to 3000 would stop nothing.
  it("keeps the allowances in a sensible range", () => {
    expect(LIMITS.login).toBeGreaterThanOrEqual(10);
    expect(LIMITS.login).toBeLessThanOrEqual(50);
    expect(LIMITS.signup).toBeGreaterThanOrEqual(10);
    expect(LIMITS.signup).toBeLessThanOrEqual(200);
    expect(LIMITS.inquiry).toBeGreaterThanOrEqual(20);
    expect(LIMITS.inquiry).toBeLessThanOrEqual(500);
  });

  // The whole point of counting only failures: nineteen wrong guesses, then one
  // real sign-in, must leave the allowance exactly where it was.
  it("counts failed sign-ins only: a success is free, and the boundary is exact", async () => {
    process.env.RATE_LIMIT = "on";
    await prisma.user.create({
      data: { name: "Rate Test", email: "rate-limit-user", passwordHash: await hashPassword("correct-pass-1"), role: "LEASING_OFFICER" },
    });
    const bad = () => request(app).post("/api/auth/login").send({ email: "nobody-here", password: "wrong-password" });
    const good = () => request(app).post("/api/auth/login").send({ email: "rate-limit-user", password: "correct-pass-1" });

    const beforeSuccess = await fire(LIMITS.login - 1, bad);
    expect(beforeSuccess.every((s) => s === 401)).toBe(true);        // not 500, not early 429

    expect((await good()).status).toBe(200);                          // free

    expect((await bad()).status).toBe(401);                           // the last allowed failure
    const refused = await bad();                                      // one past the allowance
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/too many/i);
    // and once refused, even the correct password waits
    expect((await good()).status).toBe(429);
  });

  it("throttles sign-up at its allowance", async () => {
    process.env.RATE_LIMIT = "on";
    const send = () => request(app).post("/api/auth/signup").send({});   // refused by validation, still counted
    const allowed = await fire(LIMITS.signup, send);
    expect(allowed.every((s) => s === 400)).toBe(true);
    expect((await send()).status).toBe(429);
  });

  it("throttles the public inquiry form at its allowance", async () => {
    process.env.RATE_LIMIT = "on";
    const send = () => request(app).post("/api/inquiries").send({});
    const allowed = await fire(LIMITS.inquiry, send);
    expect(allowed.every((s) => s === 400)).toBe(true);
    expect((await send()).status).toBe(429);
  });
});

// Focused unit test against the hand-rolled middleware itself (used by the
// owner-invite accept + admin email-test routes), driving the returned
// middleware directly with mock req/res/next.
describe("rateLimit middleware", () => {
  it("lets requests through under the cap, then returns 429 RATE_LIMITED once it's reached", () => {
    const limiter = rateLimit({ max: 2 });
    const req = { ip: "203.0.113.5" };
    const res = { status: vi.fn(() => res), json: vi.fn() };
    const next = vi.fn();

    // 1st request: under the cap.
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    // 2nd request: still under the cap (count reaches max, but isn't over it yet).
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();

    // 3rd request: cap reached — rejected, next() is not called again.
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "RATE_LIMITED" }));
  });
});
