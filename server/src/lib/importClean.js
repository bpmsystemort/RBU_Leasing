export function rowOffset(firstCell) {
  return typeof firstCell === "number" ? 1 : 0;
}

const NULLISH = new Set(["", "-", "n/a", "na", "none"]);

export function text(v) {
  if (v == null) return null;
  let s = typeof v === "object" && v.text ? v.text : String(v);
  s = s.trim();
  if (NULLISH.has(s.toLowerCase())) return null;
  return s || null;
}

export function money(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/php/gi, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Full name or any 3+ letter abbreviation of it (Sep, Sept, Septem...); 0 when not a month, so a typo is never guessed.
const monthOf = (w) => { w = w.toLowerCase(); return w.length >= 3 ? MONTHS.findIndex((n) => n.startsWith(w)) + 1 : 0; };

// UTC midnight (the same instant Excel date cells arrive as), or null when the day does not exist.
function ymd(y, m, d) {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null;
}

// Free-text dates: 2025-11-29, 29 Nov 2025, November 29, 2025, Nov 29 2025, 11/29/2025, 29/11/2025.
// Numeric d/m/y is month-first unless a part can only be a day. Anything else is null, never a guess.
function parseDateText(raw) {
  const s = raw.trim().replace(/\s+/g, " ");
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    return a > 12 ? ymd(y, b, a) : ymd(y, a, b);
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})$/)) && monthOf(m[2])) return ymd(+m[3], monthOf(m[2]), +m[1]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? ?(\d{4})$/)) && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
  return null;
}

export function toDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)) : null; // Excel serial day
  if (typeof v === "object" && v?.result != null) return toDate(v.result); // formula cell
  return typeof v === "string" ? parseDateText(v) : null;
}

export function leaseStatus(endDate, now) {
  return endDate.getTime() >= now.getTime() ? "ACTIVE" : "EXPIRED";
}

export function key(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
