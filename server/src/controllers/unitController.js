import * as service from "../services/unitService.js";
import { releaseUnitBlock } from "../services/leasingTransactionService.js";
import { unitCreateSchema, unitUpdateSchema, unitRejectSchema } from "../validation/unit.js";

export async function list(req, res, next) {
  try {
    const { ownerId, status, estateId, towerId, approvalStatus, needsStatusReview } = req.query;
    res.json(await service.listUnitsForUser(req.user, { ownerId, status, estateId, towerId, approvalStatus, needsStatusReview }));
  } catch (e) { next(e); }
}
export async function get(req, res, next) {
  try { res.json(await service.getUnitForUser(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function create(req, res, next) {
  try {
    if (req.user.role === "UNIT_OWNER") req.body.ownerId = req.user.unitOwnerId;
    const data = unitCreateSchema.parse(req.body);
    res.status(201).json(await service.createUnitForUser(req.user, data));
  } catch (e) { next(e); }
}
export async function update(req, res, next) {
  try {
    const data = unitUpdateSchema.parse(req.body);
    res.json(await service.updateUnit(req.user, req.params.id, data));
  } catch (e) { next(e); }
}
export async function submit(req, res, next) {
  try { res.json(await service.submitUnit(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function approve(req, res, next) {
  try { res.json(await service.approveUnit(req.params.id, req.user)); } catch (e) { next(e); }
}
export async function reject(req, res, next) {
  try {
    const { remarks } = unitRejectSchema.parse(req.body);
    res.json(await service.rejectUnit(req.params.id, remarks));
  } catch (e) { next(e); }
}
export async function setUnavailable(req, res, next) {
  try { res.json(await service.setUnavailable(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function restore(req, res, next) {
  try { res.json(await service.restoreUnit(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function releaseBlock(req, res, next) {
  try { res.json(await releaseUnitBlock(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function remove(req, res, next) {
  try { await service.removeUnit(req.params.id); res.status(204).end(); } catch (e) { next(e); }
}
