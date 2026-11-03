import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/api.js", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: [{ id: "1" }] })),
    post: vi.fn(() => Promise.resolve({ data: { id: "2" } })),
    patch: vi.fn(() => Promise.resolve({ data: { id: "3" } })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

import { api } from "../src/lib/api.js";
import { resource, appointments, unitListings, publicUnits, units, leasingTransactions } from "../src/lib/resource.js";

describe("resource factory", () => {
  it("list() GETs the path with params and returns data", async () => {
    const r = resource("/owners");
    const data = await r.list({ ownerId: "x" });
    expect(api.get).toHaveBeenCalledWith("/owners", { params: { ownerId: "x" } });
    expect(data).toEqual([{ id: "1" }]);
  });
  it("get() GETs path/:id", async () => {
    await resource("/owners").get("abc");
    expect(api.get).toHaveBeenCalledWith("/owners/abc");
  });
  it("create() POSTs the path", async () => {
    await resource("/owners").create({ name: "A" });
    expect(api.post).toHaveBeenCalledWith("/owners", { name: "A" });
  });
  it("update() PATCHes path/:id", async () => {
    await resource("/units").update("u1", { baseRent: 1 });
    expect(api.patch).toHaveBeenCalledWith("/units/u1", { baseRent: 1 });
  });
  it("remove() DELETEs path/:id", async () => {
    await resource("/units").remove("u1");
    expect(api.delete).toHaveBeenCalledWith("/units/u1");
  });
});

describe("appointments", () => {
  it("appointments wrapper hits the right endpoints", async () => {
    await appointments.forTransaction("t1");
    expect(api.get).toHaveBeenCalledWith("/appointments/transaction/t1");
    await appointments.mine();
    expect(api.get).toHaveBeenCalledWith("/appointments/mine");
    await appointments.schedule("t1", "UNIT_INSPECTION", { scheduledAt: "x" });
    expect(api.post).toHaveBeenCalledWith("/appointments/transaction/t1/UNIT_INSPECTION", { scheduledAt: "x" });
    await appointments.reschedule("a1", { scheduledAt: "y" });
    expect(api.patch).toHaveBeenCalledWith("/appointments/a1/reschedule", { scheduledAt: "y" });
    await appointments.complete("a1", { outcome: "Passed" });
    expect(api.patch).toHaveBeenCalledWith("/appointments/a1/complete", { outcome: "Passed" });
    await appointments.cancel("a1", { reason: "n/a" });
    expect(api.patch).toHaveBeenCalledWith("/appointments/a1/cancel", { reason: "n/a" });
  });
});

describe("unitListings + publicUnits", () => {
  it("unitListings + publicUnits wrappers hit the right endpoints", async () => {
    await unitListings.listAll();
    expect(api.get).toHaveBeenCalledWith("/unit-listings");
    await unitListings.get("u1");
    expect(api.get).toHaveBeenCalledWith("/unit-listings/u1");
    await unitListings.update("u1", { headline: "x" });
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1", { headline: "x" });
    await unitListings.reorder("u1", ["a", "b"]);
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1/photos/reorder", { orderedIds: ["a", "b"] });
    await unitListings.setCover("u1", "p1");
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1/cover", { photoId: "p1" });
    await unitListings.publish("u1");
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1/publish");
    await unitListings.unpublish("u1");
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1/unpublish");
    await unitListings.caption("u1", "p1", "hello");
    expect(api.patch).toHaveBeenCalledWith("/unit-listings/u1/photos/p1", { caption: "hello" });
    await unitListings.deletePhoto("u1", "p1");
    expect(api.delete).toHaveBeenCalledWith("/unit-listings/u1/photos/p1");
    expect(unitListings.staffImageUrl("u1", "p1")).toBe("/api/unit-listings/u1/photos/p1/image");
    await publicUnits.list({ type: "2BR" });
    expect(api.get).toHaveBeenCalledWith("/public/units", { params: { type: "2BR" } });
    await publicUnits.get("u1");
    expect(api.get).toHaveBeenCalledWith("/public/units/u1");
    expect(publicUnits.photoUrl("p1")).toBe("/api/public/units/photo/p1");
  });

  it("addPhoto uploads via FormData", async () => {
    const file = new Blob(["x"]);
    await unitListings.addPhoto("u1", file);
    expect(api.post).toHaveBeenCalledWith("/unit-listings/u1/photos", expect.any(FormData));
  });
});

describe("unit availability, ownership and blocking clients", () => {
  it("units.* hits the availability, assignment and history endpoints", async () => {
    await units.setUnavailable("u1");
    expect(api.patch).toHaveBeenCalledWith("/units/u1/unavailable");
    await units.restore("u1");
    expect(api.patch).toHaveBeenCalledWith("/units/u1/restore");
    await units.releaseBlock("u1");
    expect(api.patch).toHaveBeenCalledWith("/units/u1/release-block");
    const res = await units.assignOwner("u1", { toOwnerId: "o2", reason: "Sold" });
    expect(api.patch).toHaveBeenCalledWith("/units/u1/assign-owner", { toOwnerId: "o2", reason: "Sold" });
    expect(res).toEqual({ id: "3" });
    const history = await units.assignments("u1");
    expect(api.get).toHaveBeenCalledWith("/units/u1/assignments");
    expect(history).toEqual([{ id: "1" }]);
  });

  it("leasingTransactions.blockUnit / unblockUnit PATCH the block and unblock paths", async () => {
    await leasingTransactions.blockUnit("t1");
    expect(api.patch).toHaveBeenCalledWith("/leasing-transactions/t1/block");
    await leasingTransactions.unblockUnit("t1");
    expect(api.patch).toHaveBeenCalledWith("/leasing-transactions/t1/unblock");
  });
});
