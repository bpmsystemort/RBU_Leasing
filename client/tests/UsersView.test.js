import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  listUsers: vi.fn(() => Promise.resolve([
    { id: "u1", name: "Super Admin", email: "admin@rbu.local", role: "ADMIN", createdAt: "2026-08-01T00:00:00Z" },
    { id: "u2", name: "Front Desk", email: "frontdesk", role: "LEASING_OFFICER", password: "pw123456", createdAt: "2026-08-02T00:00:00Z" },
  ])),
  createUser: vi.fn(() => Promise.resolve({ email: "frontdesk", role: "LEASING_OFFICER" })),
  updateUser: vi.fn(() => Promise.resolve({})),
  deleteUser: vi.fn(() => Promise.resolve()),
  accounts: {
    suspend: vi.fn(() => Promise.resolve({})),
    restore: vi.fn(() => Promise.resolve({})),
  },
}));

import UsersView from "../src/views/UsersView.vue";
import { createUser, listUsers, updateUser, deleteUser, accounts } from "../src/lib/resource.js";

const RouterLinkStub = { props: ["to"], template: "<a class='rl'><slot/></a>" };
function mountView() {
  return mount(UsersView, { global: { stubs: { RouterLink: RouterLinkStub } } });
}
function findBtn(w, label) {
  return w.findAll("button").find((b) => b.text() === label);
}

describe("UsersView", () => {
  beforeEach(() => {
    createUser.mockClear(); listUsers.mockClear(); updateUser.mockClear(); deleteUser.mockClear();
    accounts.suspend.mockClear(); accounts.restore.mockClear();
  });

  it("lists credentials with friendly role labels", async () => {
    const w = mountView();
    await flushPromises();
    expect(listUsers).toHaveBeenCalled();
    expect(w.text()).toContain("admin@rbu.local");
    expect(w.text()).toContain("Super Admin"); // ADMIN label
    expect(w.text()).toContain("O-Lease"); // LEASING_OFFICER label
  });

  // The system checks a password; it cannot tell you one. The API no longer
  // returns it, and the screen must not show one even if a row somehow carries it.
  it("shows no password column or reveal control, even if a row still carries one", async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find("thead").text()).not.toContain("Password");
    expect(w.find(".pw__eye").exists()).toBe(false);
    expect(w.find(".pw__val").exists()).toBe(false);
    expect(w.text()).not.toContain("pw123456");
  });

  it("tells the admin a password cannot be viewed again once saved", async () => {
    const w = mountView();
    await flushPromises();
    await findBtn(w, "New account").trigger("click");
    expect(w.find(".modal").text()).toContain("cannot be viewed again");
  });

  // Reset is the replacement for the reveal: an admin who needs to give someone
  // access sets a new password, and says so on the form.
  it("labels the password field as a reset when editing a login", async () => {
    const w = mountView();
    await flushPromises();
    const editButtons = w.findAll("button").filter((b) => b.text() === "Edit");
    await editButtons[1].trigger("click");
    const label = w.find('label[for="password"]').text();
    expect(label).toContain("New password");
    expect(label).toContain("leave blank to keep");
  });

  it("offers exactly the four roles in the dropdown", async () => {
    const w = mountView();
    await flushPromises();
    await findBtn(w, "New account").trigger("click");
    const opts = w.find("#role").findAll("option").map((o) => o.text());
    expect(opts).toEqual(["O-Lease", "Lessor", "Lessee", "Super Admin"]);
  });

  it("creates a login with the default O-Lease role", async () => {
    const w = mountView();
    await flushPromises();
    await findBtn(w, "New account").trigger("click");
    await w.find("#name").setValue("Front Desk");
    await w.find("#email").setValue("frontdesk");
    await w.find("#password").setValue("pw123456");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(createUser).toHaveBeenCalledWith({
      name: "Front Desk", email: "frontdesk", password: "pw123456", role: "LEASING_OFFICER",
    });
    expect(listUsers).toHaveBeenCalledTimes(2); // reloaded after create
  });

  it("edits a login (blank password is omitted)", async () => {
    const w = mountView();
    await flushPromises();
    const editButtons = w.findAll("button").filter((b) => b.text() === "Edit");
    await editButtons[1].trigger("click");
    await w.find("#name").setValue("Reception");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(updateUser).toHaveBeenCalledWith("u2", { name: "Reception", email: "frontdesk", role: "LEASING_OFFICER" });
  });

  // Reset is how access is recovered now, so a rejected password must say why
  // instead of the bare "Validation failed" the server's envelope carries.
  it("shows why a reset password was rejected, not just that validation failed", async () => {
    updateUser.mockRejectedValueOnce({ response: { status: 400, data: {
      error: "Validation failed",
      details: [{ path: "password", message: "Password must be at least 6 characters" }],
    } } });
    const w = mountView();
    await flushPromises();
    const editButtons = w.findAll("button").filter((b) => b.text() === "Edit");
    await editButtons[1].trigger("click");
    await w.find("#password").setValue("abc12");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(w.find(".modal .error").text()).toBe("Password must be at least 6 characters");
  });

  it("deletes a login after confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const w = mountView();
    await flushPromises();
    const delButtons = w.findAll("button").filter((b) => b.text() === "Delete");
    await delButtons[1].trigger("click");
    await flushPromises();
    expect(deleteUser).toHaveBeenCalledWith("u2");
    vi.unstubAllGlobals();
  });

  it("disables Delete for the super admin", async () => {
    const w = mountView();
    await flushPromises();
    const delButtons = w.findAll("button").filter((b) => b.text() === "Delete");
    expect(delButtons[0].attributes("disabled")).toBeDefined();
    expect(delButtons[1].attributes("disabled")).toBeUndefined();
  });

  it("shows a Suspended badge and a Restore button on a suspended row, and restores it", async () => {
    listUsers.mockResolvedValueOnce([
      { id: "u3", name: "Dormant User", email: "dormant", role: "LEASING_OFFICER", status: "SUSPENDED", password: "pw123456", createdAt: "2026-08-03T00:00:00Z" },
    ]);
    const w = mountView();
    await flushPromises();
    const row = w.findAll("tbody tr")[0];
    expect(row.text()).toContain("Suspended");
    const restoreBtn = findBtn(row, "Restore");
    expect(restoreBtn).toBeTruthy();
    await restoreBtn.trigger("click");
    await flushPromises();
    expect(accounts.restore).toHaveBeenCalledWith("u3");
    expect(listUsers).toHaveBeenCalledTimes(2); // reloaded after restore
  });

  it("shows a Suspend button on an approved row and suspends it", async () => {
    const w = mountView();
    await flushPromises();
    const row = w.findAll("tbody tr")[1]; // Front Desk — approved, no special status
    expect(row.text()).not.toContain("Suspended");
    const suspendBtn = findBtn(row, "Suspend");
    expect(suspendBtn).toBeTruthy();
    await suspendBtn.trigger("click");
    await flushPromises();
    expect(accounts.suspend).toHaveBeenCalledWith("u2");
    expect(listUsers).toHaveBeenCalledTimes(2); // reloaded after suspend
  });
});
