import { prisma } from "../lib/prisma.js";

// Track in-flight audit writes so tests can await them deterministically.
const pending = new Set();

const ENTITY = {
  owners: "Owner",
  tenants: "Tenant",
  units: "Unit",
  leases: "Lease",
  inquiries: "Inquiry",
  "info-sheets": "Info Sheet",
  requirements: "Requirement",
  auth: "Account",
  estates: "Estate",
  towers: "Tower",
  "leasing-transactions": "Transaction",
  "lessor-requirements": "Lessor Requirement",
  "owner-invites": "Owner Invite",
};

// Derive a human action + entity from the request path/method.
function classify(path, method) {
  const segs = path.replace(/^\/api\//, "").split("/"); // e.g. ["units", "<id>", "approve"]
  const group = segs[0];
  const entity = ENTITY[group] || group;

  if (group === "cms") {
    // Nested one level deeper: /api/cms/forms/:id or /api/cms/page-forms/:role/:pageKey
    const isPage = segs[1] === "page-forms";
    const id = isPage ? [segs[2], segs[3]].filter(Boolean).join("/") : (segs[2] || null);
    let action;
    if (method === "POST") action = "create";
    else if (method === "PATCH" || method === "PUT") action = "update";
    else if (method === "DELETE") action = "delete";
    else action = method.toLowerCase();
    return { entity: isPage ? "Page Form" : "Form", action, entityId: id };
  }

  if (group === "page-forms") {
    // Runtime submissions: /api/page-forms/mine/:pageKey
    return {
      entity: "Form Response",
      action: method === "PUT" ? "submit" : method.toLowerCase(),
      entityId: segs[2] || null,
    };
  }

  if (group === "auth") {
    const kind = segs[1];
    if (kind === "login") return { entity: "Account", action: "login", entityId: null };
    if (kind === "register") return { entity: "Account", action: "register", entityId: null };
    if (kind === "users") return { entity: "Account", action: method === "DELETE" ? "delete" : "update", entityId: segs[2] || null };
    return { entity: "Account", action: method.toLowerCase(), entityId: null };
  }

  if (group === "lessor-requirements") {
    // Routes: POST /mine/:key, POST /:ownerId/:key (upload); PATCH /:id/review; GET .../download
    const seg1 = segs[1];
    let action;
    if (segs[2] === "review") action = "review";
    else if (method === "POST") action = "upload";
    else action = method.toLowerCase();
    return { entity: "Lessor Requirement", action, entityId: seg1 === "mine" ? null : seg1 };
  }

  if (group === "owner-invites") {
    // Routes: POST / (create); POST /:token/accept. segs[1] is the raw,
    // single-use invite token — it must never be persisted into AuditLog, so
    // entityId is always null here rather than falling through to the
    // generic segs[1] handling below.
    const action = segs[2] === "accept" ? "accept" : (method === "POST" ? "create" : method.toLowerCase());
    return { entity: "Owner Invite", action, entityId: null };
  }

  const sub = segs[2]; // approve | reject | assign | submit | review
  let action;
  if (sub) action = sub;
  else if (method === "POST") action = "create";
  else if (method === "PATCH" || method === "PUT") action = "update";
  else if (method === "DELETE") action = "delete";
  else action = method.toLowerCase();

  const entityId = segs[1] && segs[1] !== "me" ? segs[1] : null;
  return { entity, action, entityId };
}

async function record(req, res, body, path) {
  const { entity, action, entityId } = classify(path, req.method);

  // Actor: the authenticated user, or — for login — the account that just signed in.
  let actorId = req.user?.userId || null;
  let actorRole = req.user?.role || null;
  let actorName = null;

  if (action === "login" && body?.user) {
    actorId = body.user.id;
    actorRole = body.user.role;
    actorName = body.user.name || body.user.email || null;
  } else if (actorId) {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } });
    actorName = u?.name || u?.email || null;
  }

  await prisma.auditLog.create({
    data: {
      actorId, actorName, actorRole, action, entity,
      entityId: entityId || body?.id || null,
      method: req.method,
      path,
    },
  });
}

// Records every successful mutating API call. The write is kicked off (but not
// awaited) as the response is sent, so it never blocks or fails a request; the
// returned promise is tracked so tests can flush it deterministically.
export function auditMiddleware(req, res, next) {
  if (!req.path.startsWith("/api") || req.path === "/api/health") return next();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();

  // Capture the original path now — once inside the mounted router, req.path is stripped.
  const fullPath = (req.originalUrl || req.url).split("?")[0];

  let body;
  let done = false;
  function trigger() {
    if (done) return;
    done = true;
    if (res.statusCode >= 400) return; // only successful actions
    const p = record(req, res, body, fullPath).catch(() => {});
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  const origJson = res.json.bind(res);
  res.json = (payload) => { body = payload; return origJson(payload); };
  const origEnd = res.end.bind(res);
  res.end = (...args) => { const r = origEnd(...args); trigger(); return r; };

  next();
}

export async function flushAudits() {
  await Promise.allSettled([...pending]);
}
