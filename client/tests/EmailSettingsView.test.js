import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  emailSettings: {
    get: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        host: "smtp.example.com",
        port: 587,
        secure: false,
        fromAddress: "noreply@example.com",
        fromName: "RBU Leasing",
        credentialsConfigured: false,
        source: "env",
      }),
    ),
    save: vi.fn((data) =>
      Promise.resolve({ ...data, credentialsConfigured: false, source: "db" }),
    ),
    test: vi.fn(() => Promise.resolve({ ok: true, delivered: true })),
  },
}));

import EmailSettingsView from "../src/views/EmailSettingsView.vue";
import { emailSettings } from "../src/lib/resource.js";

function mountView() {
  return mount(EmailSettingsView);
}
function findBtn(w, label) {
  return w.findAll("button").find((b) => b.text() === label);
}

describe("EmailSettingsView", () => {
  beforeEach(() => {
    emailSettings.get.mockClear();
    emailSettings.save.mockClear();
    emailSettings.test.mockClear();
  });

  it("loads settings on mount and fills the form", async () => {
    const w = mountView();
    await flushPromises();
    expect(emailSettings.get).toHaveBeenCalled();
    expect(w.find("#host").element.value).toBe("smtp.example.com");
    expect(w.find("#port").element.value).toBe("587");
    expect(w.find("#fromAddress").element.value).toBe("noreply@example.com");
    expect(w.find("#fromName").element.value).toBe("RBU Leasing");
    expect(w.find("#enabled").element.checked).toBe(true);
    expect(w.find("#secure").element.checked).toBe(false);
  });

  it("shows credentials-configured and source as plain info, with a neutral hint when there are no credentials", async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain("No"); // credentialsConfigured: false
    expect(w.text()).toContain("env"); // source
    expect(w.text()).toContain("without authentication");
    // Neutral, not an error — and must not block Save or Test.
    expect(w.find(".error").exists()).toBe(false);
    expect(findBtn(w, "Save").attributes("disabled")).toBeUndefined();
  });

  it("hides the no-credentials hint once a username is configured", async () => {
    emailSettings.get.mockResolvedValueOnce({
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      secure: true,
      fromAddress: "noreply@example.com",
      fromName: "RBU Leasing",
      credentialsConfigured: true,
      source: "db",
    });
    const w = mountView();
    await flushPromises();
    expect(w.text()).not.toContain("without authentication");
    expect(w.find("#secure").element.checked).toBe(true);
  });

  it("saves the edited values", async () => {
    const w = mountView();
    await flushPromises();
    await w.find("#host").setValue("smtp.new.com");
    await w.find("#port").setValue(2525);
    await w.find("#fromAddress").setValue("new@example.com");
    await w.find("#fromName").setValue("New Name");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(emailSettings.save).toHaveBeenCalledWith({
      enabled: true,
      host: "smtp.new.com",
      port: 2525,
      secure: false,
      fromAddress: "new@example.com",
      fromName: "New Name",
    });
    expect(w.text()).toContain("Settings saved");
  });

  it("surfaces a server error message when saving fails", async () => {
    emailSettings.save.mockRejectedValueOnce({ response: { data: { error: "Host unreachable" } } });
    const w = mountView();
    await flushPromises();
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(w.find(".error").text()).toBe("Host unreachable");
  });

  it("sends a test email to the given address and shows the result", async () => {
    const w = mountView();
    await flushPromises();
    await w.find("#testTo").setValue("check@example.com");
    await findBtn(w, "Send test email").trigger("click");
    await flushPromises();
    expect(emailSettings.test).toHaveBeenCalledWith("check@example.com");
    expect(w.text()).toContain("delivered");
  });

  it("shows the failure reason when the test send does not deliver", async () => {
    emailSettings.test.mockResolvedValueOnce({ ok: false, delivered: false, error: "Connection refused" });
    const w = mountView();
    await flushPromises();
    await w.find("#testTo").setValue("check@example.com");
    await findBtn(w, "Send test email").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Connection refused");
  });

  it("surfaces a server error message when loading fails", async () => {
    emailSettings.get.mockRejectedValueOnce({ response: { data: { error: "Forbidden" } } });
    const w = mountView();
    await flushPromises();
    expect(w.find(".error").text()).toBe("Forbidden");
  });

  it("never exposes an SMTP credential input — credentials live only in server env", async () => {
    const w = mountView();
    await flushPromises();

    // No password field, ever.
    expect(w.find('input[type="password"]').exists()).toBe(false);

    // No field whose id/name/placeholder, or associated <label>, implies a
    // username or password — the UI must never collect SMTP credentials.
    const inputs = w.findAll("input");
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const el = input.element;
      const label = w.find(`label[for="${el.id}"]`);
      const haystack = [el.id, el.getAttribute("name"), el.getAttribute("placeholder"), label.exists() ? label.text() : ""]
        .join(" ")
        .toLowerCase();
      expect(haystack).not.toMatch(/user|pass/);
    }
  });
});
