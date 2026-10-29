import { importWorkbook } from "../services/portfolioImportService.js";
import { InvalidReferenceError } from "../lib/errors.js";

export async function portfolio(req, res, next) {
  try {
    if (!req.file) throw new InvalidReferenceError("An .xlsx file is required");
    res.json(await importWorkbook(req.file.buffer));
  } catch (err) { next(err); }
}
