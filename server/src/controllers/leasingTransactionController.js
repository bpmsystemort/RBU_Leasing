import * as service from "../services/leasingTransactionService.js";
import { InvalidReferenceError } from "../lib/errors.js";
import {
  txnCreateSchema, txnStatusSchema, txnStepSchema, txnLinkSchema, approvalDecisionSchema,
} from "../validation/leasingTransaction.js";

// --- staff ---
export async function list(req, res, next) {
  try { res.json(await service.listTransactions(req.user)); } catch (e) { next(e); }
}
export async function get(req, res, next) {
  try { res.json(await service.getTransaction(req.params.id)); } catch (e) { next(e); }
}
export async function create(req, res, next) {
  try {
    const data = txnCreateSchema.parse(req.body);
    res.status(201).json(await service.createTransaction(req.user, data));
  } catch (e) { next(e); }
}
export async function setStatus(req, res, next) {
  try {
    const data = txnStatusSchema.parse(req.body);
    res.json(await service.setStatus(req.user, req.params.id, data));
  } catch (e) { next(e); }
}
export async function advance(req, res, next) {
  try {
    const data = txnStepSchema.parse(req.body || {});
    res.json(await service.advance(req.user, req.params.id, data));
  } catch (e) { next(e); }
}
export async function returnStage(req, res, next) {
  try {
    const data = txnStepSchema.parse(req.body || {});
    res.json(await service.returnStage(req.user, req.params.id, data));
  } catch (e) { next(e); }
}
export async function link(req, res, next) {
  try {
    const data = txnLinkSchema.parse(req.body);
    res.json(await service.linkRecords(req.user, req.params.id, data));
  } catch (e) { next(e); }
}
export async function blockUnit(req, res, next) {
  try { res.json(await service.blockUnit(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function unblockUnit(req, res, next) {
  try { res.json(await service.unblockUnit(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function remove(req, res, next) {
  try { await service.deleteTransaction(req.params.id); res.status(204).end(); } catch (e) { next(e); }
}

// --- documents ---
export async function uploadDocument(req, res, next) {
  try {
    if (!req.file) throw new InvalidReferenceError("A file is required");
    const docType = req.body?.docType || null;
    res.status(201).json(await service.addDocument(req.user, req.params.id, req.file, docType));
  } catch (e) { next(e); }
}
export async function downloadDocument(req, res, next) {
  try {
    const doc = await service.getDocumentForDownload(req.user, req.params.id, req.params.docId);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.send(Buffer.from(doc.data));
  } catch (e) { next(e); }
}
export async function removeDocument(req, res, next) {
  try { await service.deleteDocument(req.user, req.params.id, req.params.docId); res.status(204).end(); } catch (e) { next(e); }
}

// --- approval routing ---
export async function listSteps(req, res, next) {
  try { res.json(await service.listApprovalSteps(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function decideStep(req, res, next) {
  try {
    const data = approvalDecisionSchema.parse(req.body);
    res.json(await service.decideApprovalStep(req.user, req.params.id, req.params.stepId, data));
  } catch (e) { next(e); }
}

// --- portal (lessee / lessor) ---
export async function listMine(req, res, next) {
  try { res.json(await service.listMine(req.user)); } catch (e) { next(e); }
}
export async function getMine(req, res, next) {
  try { res.json(await service.getMineTransaction(req.user, req.params.id)); } catch (e) { next(e); }
}
