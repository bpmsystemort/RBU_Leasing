import { prisma } from "../lib/prisma.js";
import { NotFoundError, InvalidReferenceError, ConflictError, ForbiddenError } from "../lib/errors.js";
import {
  SCHEDULABLE_STAGES, isSchedulableStage, stageByKey, stageIndex, isFinalStage,
} from "../../../shared/leasingStages.js";
import { assertCanAccess } from "./leasingTransactionService.js";

async function resolveName(user) {
  if (user?.userId) {
    const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    if (u) return u.name || u.email || null;
  }
  return null;
}
async function logEvent(transactionId, actor, message, stage) {
  await prisma.transactionEvent.create({
    data: { transactionId, actorId: actor?.userId || null, actorName: await resolveName(actor), actorRole: actor?.role || null, stage: stage || null, message },
  });
}
// Write a stage's status into the transaction: always stageData[stage].status;
// top-level status only when it is the current stage.
async function syncStageStatus(txn, stage, status) {
  const stageData = { ...(txn.stageData || {}) };
  stageData[stage] = { ...(stageData[stage] || {}), status };
  const patch = { stageData };
  if (stage === txn.stage) { patch.status = status; if (isFinalStage(stage)) patch.finalStatus = status; }
  await prisma.leasingTransaction.update({ where: { id: txn.id }, data: patch });
}

export async function listForTransaction(user, txnId) {
  await assertCanAccess(user, txnId); // 404 if not staff/owner/tenant
  return prisma.appointment.findMany({ where: { transactionId: txnId }, orderBy: { stage: "asc" } });
}
export async function listMine(user) {
  let where = null;
  if (user?.role === "TENANT" && user.tenantId) where = { transaction: { tenantId: user.tenantId } };
  else if (user?.role === "UNIT_OWNER" && user.unitOwnerId) where = { transaction: { unitOwnerId: user.unitOwnerId } };
  if (!where) return [];
  return prisma.appointment.findMany({
    where, orderBy: { scheduledAt: "asc" },
    include: { transaction: { select: { id: true, reference: true } } },
  });
}
export async function scheduleAppointment(user, txnId, stage, body) {
  if (!isSchedulableStage(stage)) throw new InvalidReferenceError(`"${stage}" is not a schedulable stage`);
  const txn = await prisma.leasingTransaction.findUnique({ where: { id: txnId } });
  if (!txn) throw new NotFoundError("Transaction not found");
  if (stageIndex(stage) < stageIndex(txn.stage) && (txn.stageData?.[stage]?.completedAt)) {
    throw new ConflictError("That stage is already completed");
  }
  // A unit viewing is proposed to the lessor for confirmation; every other
  // schedulable visit is booked outright by staff.
  const viewing = stage === "UNIT_VIEWING";
  const status = viewing ? "Proposed" : "Scheduled";
  const appt = await prisma.appointment.upsert({
    where: { transactionId_stage: { transactionId: txnId, stage } },
    create: {
      transactionId: txnId, stage, status,
      scheduledAt: new Date(body.scheduledAt), location: body.location ?? null, notes: body.notes ?? null,
      proposedByRole: viewing ? user?.role ?? null : null,
      createdById: user?.userId || null, createdByName: await resolveName(user),
    },
    update: {
      status, scheduledAt: new Date(body.scheduledAt), location: body.location ?? null, notes: body.notes ?? null,
      proposedByRole: viewing ? user?.role ?? null : null, confirmedAt: null,
    },
  });
  await syncStageStatus(txn, stage, status);
  await logEvent(txnId, user, `${stageByKey(stage).label} ${viewing ? "proposed" : "scheduled"} for ${new Date(body.scheduledAt).toISOString()}`, stage);
  return appt;
}

async function loadAppt(id) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw new NotFoundError("Appointment not found");
  return appt;
}
async function txnOf(appt) {
  const txn = await prisma.leasingTransaction.findUnique({ where: { id: appt.transactionId } });
  if (!txn) throw new NotFoundError("Transaction not found");
  return txn;
}

export async function reschedule(user, id, body) {
  const appt = await loadAppt(id);
  if (appt.stage === "UNIT_VIEWING") throw new ConflictError("Use propose to change a viewing time");
  if (["Completed", "Cancelled"].includes(appt.status)) throw new ConflictError("This appointment is closed");
  const txn = await txnOf(appt);
  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: "Rescheduled", scheduledAt: new Date(body.scheduledAt), location: body.location ?? appt.location, notes: body.notes ?? appt.notes, rescheduleCount: { increment: 1 } },
  });
  await syncStageStatus(txn, appt.stage, "Scheduled");
  await logEvent(txn.id, user, `${stageByKey(appt.stage).label} rescheduled to ${new Date(body.scheduledAt).toISOString()}`, appt.stage);
  return updated;
}

// The two "sides" of a viewing handshake: the lessor, and everyone on staff.
function sideOf(role) {
  return role === "UNIT_OWNER" ? "lessor" : "staff";
}
const HANDSHAKE_ROLES = ["ADMIN", "LEASING_OFFICER", "UNIT_OWNER"];

// Confirm the OTHER side's proposed viewing time.
export async function confirmViewing(user, id) {
  if (!HANDSHAKE_ROLES.includes(user?.role)) throw new ForbiddenError("Not allowed to confirm this viewing");
  const appt = await loadAppt(id);
  const txn = await txnOf(appt);
  await assertCanAccess(user, txn.id); // 404 unless staff or THIS txn's owner
  if (appt.stage !== "UNIT_VIEWING") throw new ConflictError("Only a unit viewing is confirmed this way");
  if (appt.status !== "Proposed") throw new ConflictError("This viewing is not awaiting confirmation");
  if (sideOf(appt.proposedByRole) === sideOf(user.role)) {
    throw new ConflictError("Awaiting the other party's confirmation, not yours");
  }
  const updated = await prisma.appointment.update({ where: { id }, data: { status: "Confirmed", confirmedAt: new Date() } });
  await syncStageStatus(txn, appt.stage, "Confirmed");
  await logEvent(txn.id, user, `Unit Viewing confirmed for ${new Date(appt.scheduledAt).toISOString()}`, appt.stage);
  return updated;
}

// Propose a different viewing time (either side), flipping whose turn it is.
export async function proposeViewing(user, id, body) {
  if (!HANDSHAKE_ROLES.includes(user?.role)) throw new ForbiddenError("Not allowed to propose a viewing time");
  const appt = await loadAppt(id);
  const txn = await txnOf(appt);
  await assertCanAccess(user, txn.id);
  if (appt.stage !== "UNIT_VIEWING") throw new ConflictError("Only a unit viewing is proposed this way");
  if (["Completed", "Cancelled"].includes(appt.status)) throw new ConflictError("This viewing is closed");
  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: "Proposed", proposedByRole: user.role, confirmedAt: null,
      scheduledAt: new Date(body.scheduledAt), location: body.location ?? appt.location, notes: body.notes ?? appt.notes,
    },
  });
  await syncStageStatus(txn, appt.stage, "Proposed");
  await logEvent(txn.id, user, `Unit Viewing time proposed for ${new Date(body.scheduledAt).toISOString()}`, appt.stage);
  return updated;
}

export async function complete(user, id, body) {
  const appt = await loadAppt(id);
  if (appt.status === "Completed") throw new ConflictError("Already completed");
  if (appt.status === "Cancelled") throw new ConflictError("This appointment was cancelled");
  const cfg = SCHEDULABLE_STAGES[appt.stage];
  const outcome = body.outcome || cfg.defaultOutcome;
  const allowed = cfg.outcomeOptions ?? [cfg.defaultOutcome];
  if (!allowed.includes(outcome)) throw new InvalidReferenceError(`"${outcome}" is not a valid result for this stage`);
  const txn = await txnOf(appt);
  const updated = await prisma.appointment.update({ where: { id }, data: { status: "Completed", outcome } });
  // The shoot itself completed — but with nobody in view the stage rests at
  // Awaiting Prospect, so the board tells "live and being marketed" apart from
  // "just shot".
  const stageStatus = appt.stage === "PHOTOSHOOT" && outcome === "Completed" && !txn.tenantId
    ? "Awaiting Prospect"
    : outcome;
  await syncStageStatus(txn, appt.stage, stageStatus);
  await logEvent(txn.id, user, `${stageByKey(appt.stage).label} completed — ${outcome}`, appt.stage);
  return updated;
}
export async function cancel(user, id, body) {
  const appt = await loadAppt(id);
  if (["Completed", "Cancelled"].includes(appt.status)) throw new ConflictError("This appointment is closed");
  const status = body.status || "Cancelled";
  const txn = await txnOf(appt);
  const updated = await prisma.appointment.update({ where: { id }, data: { status, reason: body.reason ?? null } });
  await syncStageStatus(txn, appt.stage, "Pending");
  await logEvent(txn.id, user, `${stageByKey(appt.stage).label} ${status.toLowerCase()}${body.reason ? ` — ${body.reason}` : ""}`, appt.stage);
  return updated;
}
