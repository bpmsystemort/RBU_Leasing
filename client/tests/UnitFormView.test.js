import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

const UNIT = {
  id: "u1", ownerId: "o1", towerId: "tw1", tower: { id: "tw1", estateId: "e1" },
  unitNumber: "12A", floor: "3", slotNo: "", type: "1BR",
};

vi.mock("../src/lib/resource.js", () => ({
  units: {
    get: vi.fn(() => Promise.resolve(UNIT)),
    update: vi.fn(() => Promise.resolve({})),
    create: vi.fn(() => Promise.resolve({})),
  },
  owners: { list: vi.fn(() => Promise.resolve([{ id: "o1", name: "Ana Owner" }, { id: "o2", name: "Ben Owner" }])) },
  estates: { list: vi.fn(() => Promise.resolve([{ id: "e1", name: "Estate One" }])) },
  towers: { list: vi.fn(() => Promise.resolve([{ id: "tw1", name: "Tower One" }])) },
}));

import UnitFormView from "../src/views/UnitFormView.vue";
import { units } from "../src/lib/resource.js";
import { useAuthStore } from "../src/stores/auth.js";

const Blank = { render: () => null };
async function mountForm(path, role = "ADMIN") {
  setActivePinia(createPinia());
  useAuthStore().setSession({ token: "t", user: { role } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/app/units/new", component: UnitFormView },
      { path: "/app/units/:id", component: UnitFormView },
      { path: "/app/units", component: Blank },
      { path: "/app/unit-assignments", component: Blank },
    ],
  });
  router.push(path);
  await router.isReady();
  const w = mount(UnitFormView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("UnitFormView owner field", () => {
  beforeEach(() => {
    units.get.mockClear();
    units.update.mockClear();
    units.create.mockClear();
  });

  it("locks the owner when editing, points an admin to Unit-Owner Assignments, and still sends the unchanged owner", async () => {
    const w = await mountForm("/app/units/u1");
    const select = w.find("#ownerId");
    expect(select.element.disabled).toBe(true);
    expect(select.element.value).toBe("o1");
    const note = w.find(".owner-note");
    expect(note.text().replace(/\s+/g, " ")).toBe("To change the owner use Unit-Owner Assignments");
    const link = note.find("a");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe("/app/unit-assignments?unit=u1");

    await w.find("form").trigger("submit");
    await flushPromises();
    expect(units.update).toHaveBeenCalledTimes(1);
    expect(units.update.mock.calls[0][0]).toBe("u1");
    expect(units.update.mock.calls[0][1]).toMatchObject({ ownerId: "o1", unitNumber: "12A" });
  });

  it("shows the note without a link to anyone who is not an admin", async () => {
    const w = await mountForm("/app/units/u1", "LEASING_OFFICER");
    expect(w.find("#ownerId").element.disabled).toBe(true);
    expect(w.find(".owner-note").text().replace(/\s+/g, " ")).toBe("To change the owner use Unit-Owner Assignments");
    expect(w.find(".owner-note a").exists()).toBe(false);
  });

  it("leaves the owner selectable, with no note, when creating a unit", async () => {
    const w = await mountForm("/app/units/new");
    expect(w.find("#ownerId").element.disabled).toBe(false);
    expect(w.find(".owner-note").exists()).toBe(false);
    expect(units.get).not.toHaveBeenCalled();
  });
});
