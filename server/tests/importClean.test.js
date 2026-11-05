import { describe, it, expect } from "vitest";
import { rowOffset, text, money, toDate, leaseStatus, key } from "../src/lib/importClean.js";

describe("importClean", () => {
  it("detects a leading row-index number", () => {
    expect(rowOffset(1)).toBe(1);
    expect(rowOffset("AAD")).toBe(0);
    expect(rowOffset(null)).toBe(0);
  });
  it("cleans text and null-ish placeholders", () => {
    expect(text("  Ibiza ")).toBe("Ibiza");
    expect(text("n/a")).toBeNull();
    expect(text("-")).toBeNull();
    expect(text("")).toBeNull();
  });
  it("parses money from numbers and messy strings", () => {
    expect(money(24000)).toBe(24000);
    expect(money("100,000.00 php")).toBe(100000);
    expect(money("2 months")).toBeNull();
  });
  it("parses dates", () => {
    expect(toDate(new Date(2026, 0, 1)).getFullYear()).toBe(2026);
    expect(toDate("2026-06-15").getMonth()).toBe(5);
    expect(toDate("garbage")).toBeNull();
  });
  it("reads text dates in any common format as the same UTC day", () => {
    const want = Date.UTC(2025, 10, 29);
    for (const s of ["2025-11-29", "2025/11/29", "November 29, 2025", "Nov 29 2025", "Nov. 29, 2025", "29 Nov 2025", "29 November 2025", "29th November 2025", "11/29/2025", "29/11/2025", "11-29-2025", "29.11.2025", "11/29/25", "  November 29,2025 ", "NOVEMBER 29, 2025"]) {
      expect(toDate(s)?.getTime(), s).toBe(want);
    }
    expect(toDate("Sept 5, 2025").getTime()).toBe(Date.UTC(2025, 8, 5));
  });
  it("treats an ambiguous numeric date as month-first and a >12 part as the day", () => {
    expect(toDate("03/04/2026").getTime()).toBe(Date.UTC(2026, 2, 4));
    expect(toDate("13/04/2026").getTime()).toBe(Date.UTC(2026, 3, 13));
  });
  it("reads Excel serial numbers", () => {
    expect(toDate(46000).getTime()).toBe(Date.UTC(2025, 11, 9));
  });
  it("rejects dates that do not exist or are not dates", () => {
    for (const s of ["February 29, 2025", "31 Apr 2026", "13/13/2026", "Unit 12", "Octobet 5, 2025", "Npvember 5, 2025", "", "1 year", "garbage"]) expect(toDate(s), s).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(12)).toBeNull();
  });
  it("derives lease status from end date", () => {
    const now = new Date(2026, 7, 7);
    expect(leaseStatus(new Date(2027, 0, 1), now)).toBe("ACTIVE");
    expect(leaseStatus(new Date(2025, 0, 1), now)).toBe("EXPIRED");
  });
  it("normalizes dedup keys", () => {
    expect(key("  Marybeth   Monis ")).toBe(key("marybeth monis"));
  });
});
