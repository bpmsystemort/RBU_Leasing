import { createRequire } from "module";
import { text, money, toDate } from "./importClean.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const isYearSheet = (name) => /^\d{4}$/.test(String(name).trim());
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function headerCellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

// canonical field for a normalized header string (exact-ish matches)
const HEADER_FIELD = [
  [/^tower$/, "property"], [/^unit$/, "unitNumber"], [/^unit type$/, "unitType"],
  [/^level$/, "floor"], [/^slot ?no\.?$/, "slotNo"], [/^lessor$/, "lessor"], [/^lessee$/, "lessee"],
  [/^start contract period$/, "startDate"], [/^end contract period$/, "endDate"],
  [/^renewal period$/, "renewalText"], [/^monthly rent$/, "monthlyRent"], [/^advance rent$/, "advanceRent"],
  [/^security deposit$/, "securityDeposit"], [/^mode of payment$/, "modeOfPayment"],
  [/^service fee( paid)?$/, "serviceFee"], [/^source$/, "source"], [/^o-?lease$/, "managedBy"],
  [/^remarks$/, "remarks"],
];
const REQUIRED = ["unitNumber", "lessor", "lessee", "startDate", "endDate", "monthlyRent"];

// Scan the first rows to find the header row; return { map: {field: colIndex}, headerRow } or null.
function findHeader(ws) {
  const maxScan = Math.min(8, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    const vals = ws.getRow(r).values; // 1-indexed
    const map = {};
    for (let c = 1; c < vals.length; c++) {
      const h = norm(headerCellText(vals[c]));
      if (!h) continue;
      for (const [re, field] of HEADER_FIELD) { if (re.test(h) && map[field] === undefined) { map[field] = c; break; } }
    }
    const hasCore = map.unitNumber != null && map.lessor != null && map.lessee != null && map.monthlyRent != null;
    if (hasCore) {
      // Property column: explicit "Tower" header, else the column immediately left of "Unit" (Layout B blank header).
      if (map.property == null && map.unitNumber > 1) map.property = map.unitNumber - 1;
      return { map, headerRow: r };
    }
  }
  return null;
}

export async function parseFromBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  for (const ws of wb.worksheets) {
    if (!isYearSheet(ws.name)) continue;
    const found = findHeader(ws);
    if (!found) { sheets.push({ name: ws.name, ok: false, error: "No recognizable header row (need Unit, Lessor, Lessee, Monthly Rent).", headerRow: null, rows: [] }); continue; }
    const missing = REQUIRED.filter((f) => found.map[f] == null);
    if (missing.length) { sheets.push({ name: ws.name, ok: false, error: `Missing required columns: ${missing.join(", ")}`, headerRow: found.headerRow, rows: [] }); continue; }
    const { map, headerRow } = found;
    const at = (vals, f) => (map[f] != null ? vals[map[f]] : undefined);
    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values;
      rows.push({
        sheet: ws.name, row: r,
        managedBy: text(at(v, "managedBy")), property: text(at(v, "property")),
        unitNumber: text(at(v, "unitNumber")), unitType: text(at(v, "unitType")) || "OTHER",
        floor: text(at(v, "floor")), slotNo: text(at(v, "slotNo")),
        lessor: text(at(v, "lessor")), lessee: text(at(v, "lessee")),
        rawStart: at(v, "startDate") ?? null, rawEnd: at(v, "endDate") ?? null,
        startDate: toDate(at(v, "startDate")), endDate: toDate(at(v, "endDate")),
        renewalText: text(at(v, "renewalText")), monthlyRent: money(at(v, "monthlyRent")),
        advanceRent: text(at(v, "advanceRent")), securityDeposit: text(at(v, "securityDeposit")),
        modeOfPayment: text(at(v, "modeOfPayment")), serviceFee: text(at(v, "serviceFee")),
        source: text(at(v, "source")), remarks: text(at(v, "remarks")),
      });
    }
    sheets.push({ name: ws.name, ok: true, error: null, headerRow, rows });
  }
  return { sheets };
}
