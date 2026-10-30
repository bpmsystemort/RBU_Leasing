// In-memory fixed-window rate limiter — no new dependency. Keyed by `key(req)`
// (defaults to the caller's IP); once a window's hit count reaches `max`, further
// requests in that window get a 429 until the window resets.
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, key = (req) => req.ip } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const k = key(req); const now = Date.now();
    const rec = hits.get(k);
    if (!rec || now > rec.reset) { hits.set(k, { count: 1, reset: now + windowMs }); return next(); }
    if (rec.count >= max) return res.status(429).json({ error: "Too many requests, try again later", code: "RATE_LIMITED" });
    rec.count++; next();
  };
}
