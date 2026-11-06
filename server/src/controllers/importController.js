import { analyzeWorkbook, commitWorkbook } from "../services/portfolioImportService.js";
import { InvalidReferenceError } from "../lib/errors.js";

export async function preview(req, res, next) {
  try { if (!req.file) throw new InvalidReferenceError("An .xlsx file is required"); res.json(await analyzeWorkbook(req.file.buffer)); }
  catch (err) { next(err); }
}
export async function commit(req, res, next) {
  try { if (!req.file) throw new InvalidReferenceError("An .xlsx file is required"); res.json(await commitWorkbook(req.file.buffer)); }
  catch (err) { next(err); }
}
