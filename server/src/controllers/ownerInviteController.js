import * as service from "../services/ownerInviteService.js";
import { createInviteSchema, acceptSchema } from "../validation/ownerInvite.js";

export async function create(req, res, next) {
  try {
    const data = createInviteSchema.parse(req.body);
    res.status(201).json(await service.createInvite(data, req.user));
  } catch (e) { next(e); }
}

export async function get(req, res, next) {
  try { res.json(await service.getInvite(req.params.token)); } catch (e) { next(e); }
}

export async function accept(req, res, next) {
  try {
    const { password } = acceptSchema.parse(req.body);
    res.json(await service.acceptInvite(req.params.token, password));
  } catch (e) { next(e); }
}
