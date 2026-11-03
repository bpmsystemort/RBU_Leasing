import { describe, it, expect } from "vitest";
import {
  LEASING_STAGES, STAGE_KEYS, stageByKey, isFinalStage, nextStageKey, prevStageKey,
} from "../../shared/leasingStages.js";
import {
  SCHEDULABLE_STAGES, SCHEDULABLE_STAGE_KEYS, APPOINTMENT_STATUSES, isSchedulableStage,
} from "../../shared/leasingStages.js";

describe("Leasing stage engine (lessor flow)", () => {
  it("has the seven lessor stages in order", () => {
    expect(STAGE_KEYS).toEqual([
      "INQUIRY", "UNIT_VIEWING", "SEND_REQUIREMENTS", "APPROVAL",
      "UNIT_INSPECTION", "PHOTOSHOOT", "CONTRACT_SIGNING",
    ]);
  });

  it("marks Contract Signing as the terminal stage, not Photoshoot", () => {
    expect(isFinalStage("CONTRACT_SIGNING")).toBe(true);
    expect(isFinalStage("PHOTOSHOOT")).toBe(false);
    expect(nextStageKey("PHOTOSHOOT")).toBe("CONTRACT_SIGNING");
    expect(nextStageKey("CONTRACT_SIGNING")).toBe(null);
  });

  it("rests Photoshoot at Awaiting Prospect when no tenant has appeared", () => {
    expect(stageByKey("PHOTOSHOOT").statuses).toContain("Awaiting Prospect");
    expect(stageByKey("PHOTOSHOOT").done).toBe("Completed"); // waiting is not done
  });

  it("does not make Contract Signing schedulable", () => {
    expect(SCHEDULABLE_STAGE_KEYS).toEqual(["UNIT_VIEWING", "UNIT_INSPECTION", "PHOTOSHOOT"]);
    expect(isSchedulableStage("CONTRACT_SIGNING")).toBe(false);
    expect(stageByKey("CONTRACT_SIGNING").done).toBe("Signed");
  });

  it("exposes the done status used to advance each stage", () => {
    expect(stageByKey("INQUIRY").done).toBe("Qualified");
    expect(stageByKey("SEND_REQUIREMENTS").done).toBe("Complete");
    expect(stageByKey("APPROVAL").done).toBe("Approved");
    expect(stageByKey("UNIT_INSPECTION").done).toBe("Passed");
    expect(stageByKey("PHOTOSHOOT").done).toBe("Completed");
  });

  it("allows Inquiry to be marked Skipped", () => {
    expect(stageByKey("INQUIRY").statuses).toContain("Skipped");
  });

  it("no longer knows about Key Turnover", () => {
    expect(STAGE_KEYS).not.toContain("KEY_TURNOVER");
    expect(stageByKey("KEY_TURNOVER")).toBeUndefined();
    expect(isSchedulableStage("KEY_TURNOVER")).toBe(false);
  });

  it("runs Unit Inspection straight into Photoshoot", () => {
    expect(nextStageKey("UNIT_INSPECTION")).toBe("PHOTOSHOOT");
    expect(prevStageKey("PHOTOSHOOT")).toBe("UNIT_INSPECTION");
  });
});

describe("schedulable stages", () => {
  it("exposes the three schedulable stages with valid outcomes", () => {
    expect(SCHEDULABLE_STAGE_KEYS).toEqual(["UNIT_VIEWING", "UNIT_INSPECTION", "PHOTOSHOOT"]);
    for (const key of SCHEDULABLE_STAGE_KEYS) {
      const stage = LEASING_STAGES.find((s) => s.key === key);
      const cfg = SCHEDULABLE_STAGES[key];
      expect(stage.statuses).toContain(cfg.defaultOutcome);
      for (const o of cfg.outcomeOptions || []) expect(stage.statuses).toContain(o);
    }
    expect(isSchedulableStage("UNIT_INSPECTION")).toBe(true);
    expect(isSchedulableStage("INQUIRY")).toBe(false);
  });
  it("appointment statuses are the standard lifecycle", () => {
    expect(APPOINTMENT_STATUSES).toEqual(["Proposed", "Confirmed", "Scheduled", "Rescheduled", "Completed", "Cancelled", "No-show"]);
  });
});
