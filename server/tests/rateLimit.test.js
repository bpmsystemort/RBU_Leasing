import { describe, it, expect, vi } from "vitest";
import { rateLimit } from "../src/middleware/rateLimit.js";

// Focused unit test against the middleware itself, not the login/signup
// routes — tripping a real cap through supertest would mean firing dozens of
// HTTP requests just to exercise one branch. Driving the returned middleware
// function directly with mock req/res/next is simpler and is the actual unit
// under test (authRoutes.js just wires this up with a generous production cap).
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
