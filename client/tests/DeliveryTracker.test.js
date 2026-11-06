import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DeliveryTracker from "../src/components/DeliveryTracker.vue";

describe("DeliveryTracker (parcel-style tracker)", () => {
  it("renders a hero with the tracking number and 7 milestones", () => {
    const w = mount(DeliveryTracker, { props: { reference: "RBU-2026-000001", currentStage: "APPROVAL", status: "Under Review" } });
    expect(w.find(".hero__ref").text()).toBe("RBU-2026-000001");
    expect(w.findAll(".ms")).toHaveLength(7);
    const ms = w.findAll(".ms");
    expect(ms[0].classes()).toContain("done");     // Inquiry
    expect(ms[3].classes()).toContain("current");  // Approval (index 3)
    expect(ms[4].classes()).toContain("upcoming"); // Unit Inspection
  });

  it("shows a delivered state when the contract is Signed", () => {
    const w = mount(DeliveryTracker, { props: { reference: "RBU-2026-000002", currentStage: "CONTRACT_SIGNING", status: "Signed", finalStatus: "Signed" } });
    expect(w.find(".hero__state").text()).toContain("Signed");
    expect(w.find(".hero__state").classes()).toContain("delivered");
    expect(w.findAll(".bar__seg.on")).toHaveLength(7);
  });

  it("can hide the hero (timeline only)", () => {
    const w = mount(DeliveryTracker, { props: { currentStage: "UNIT_INSPECTION", showHero: false } });
    expect(w.find(".hero").exists()).toBe(false);
    expect(w.findAll(".ms")).toHaveLength(7);
  });
});
