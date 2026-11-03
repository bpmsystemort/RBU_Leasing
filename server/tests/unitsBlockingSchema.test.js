import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables, factory } from "./helpers.js";

beforeEach(async () => { await resetCrudTables(); });

function makeTransaction(over = {}) {
  return prisma.leasingTransaction.create({
    data: { reference: `RBU-2026-${Math.random().toString().slice(2, 8)}`, stage: "inquiry", status: "New", ...over },
  });
}

describe("Units & Blocking schema", () => {
  it("a unit can be created BLOCKED or UNAVAILABLE", async () => {
    const owner = await factory.owner();
    const blocked = await factory.unit(owner.id, { unitNumber: "B1", status: "BLOCKED" });
    const unavailable = await factory.unit(owner.id, { unitNumber: "U1", status: "UNAVAILABLE" });
    expect(blocked.status).toBe("BLOCKED");
    expect(unavailable.status).toBe("UNAVAILABLE");
  });

  it("blockedByTransactionId accepts a real transaction and is nulled when it is deleted", async () => {
    const owner = await factory.owner();
    const txn = await makeTransaction();
    const unit = await factory.unit(owner.id, { status: "BLOCKED", blockedByTransactionId: txn.id });
    expect(unit.blockedByTransactionId).toBe(txn.id);

    await prisma.leasingTransaction.delete({ where: { id: txn.id } });
    const after = await prisma.unit.findUnique({ where: { id: unit.id } });
    expect(after.blockedByTransactionId).toBeNull();
    expect(after.status).toBe("BLOCKED");
  });

  it("a UnitAssignmentEvent can be written and goes away with its unit", async () => {
    const owner = await factory.owner();
    const other = await factory.owner({ name: "Other" });
    const unit = await factory.unit(owner.id);
    const ev = await prisma.unitAssignmentEvent.create({
      data: { unitId: unit.id, fromOwnerId: owner.id, toOwnerId: other.id, actorName: "Admin", reason: "test" },
    });
    expect(ev.createdAt).toBeInstanceOf(Date);

    await prisma.unit.delete({ where: { id: unit.id } });
    expect(await prisma.unitAssignmentEvent.count({ where: { id: ev.id } })).toBe(0);
  });

  it("deleting the toOwner of an event is refused (Restrict)", async () => {
    const owner = await factory.owner();
    const other = await factory.owner({ name: "Other" });
    const unit = await factory.unit(owner.id);
    await prisma.unitAssignmentEvent.create({ data: { unitId: unit.id, toOwnerId: other.id } });
    await expect(prisma.unitOwner.delete({ where: { id: other.id } })).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.unitOwner.count({ where: { id: other.id } })).toBe(1);
  });
});
