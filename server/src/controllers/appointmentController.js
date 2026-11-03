import * as svc from "../services/appointmentService.js";
import { scheduleSchema, rescheduleSchema, completeSchema, cancelSchema, proposeSchema } from "../validation/appointment.js";

export async function mine(req, res, next) {
  try { res.json(await svc.listMine(req.user)); } catch (e) { next(e); }
}
export async function forTransaction(req, res, next) {
  try { res.json(await svc.listForTransaction(req.user, req.params.txnId)); } catch (e) { next(e); }
}
export async function schedule(req, res, next) {
  try {
    const body = scheduleSchema.parse(req.body);
    res.status(201).json(await svc.scheduleAppointment(req.user, req.params.txnId, req.params.stage, body));
  } catch (e) { next(e); }
}
export async function reschedule(req, res, next) {
  try { res.json(await svc.reschedule(req.user, req.params.id, rescheduleSchema.parse(req.body))); } catch (e) { next(e); }
}
export async function complete(req, res, next) {
  try { res.json(await svc.complete(req.user, req.params.id, completeSchema.parse(req.body))); } catch (e) { next(e); }
}
export async function cancel(req, res, next) {
  try { res.json(await svc.cancel(req.user, req.params.id, cancelSchema.parse(req.body))); } catch (e) { next(e); }
}
export async function confirm(req, res, next) {
  try { res.json(await svc.confirmViewing(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function propose(req, res, next) {
  try { res.json(await svc.proposeViewing(req.user, req.params.id, proposeSchema.parse(req.body))); } catch (e) { next(e); }
}
