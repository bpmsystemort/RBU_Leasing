// Runs before any test module is imported (Vitest setupFiles). Vite has already
// loaded server/.env into process.env by now (pointing at the Dev DB); we force
// the dedicated test database on top so the destructive integration suite
// (resetCrudTables) never touches Dev data. override:true is required because
// dotenv will not replace an already-set variable otherwise.
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.test"),
  override: true,
});

// Safety: never let the destructive suite run against a non-test database. If
// .env.test is missing (so the override above did nothing), DATABASE_URL still
// points at Dev — abort loudly rather than wipe real data.
if (!/rbu_leasing_test/.test(process.env.DATABASE_URL || "")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL does not target rbu_leasing_test. " +
    "Create server/.env.test pointing at the test database (see server/.env for the format).",
  );
}

// Isolate the info-sheet mapper's saved layouts/templates away from real data.
process.env.INFO_SHEET_DATA_DIR = path.join(os.tmpdir(), "rbu-info-sheet-test-data");

// Never let the test suite open a real SMTP connection or send an email, even
// when server/.env has MAIL_* configured for Dev — unsetting MAIL_HOST forces
// the mailer's no-send fallback ({ delivered:false }) for every test.
delete process.env.MAIL_HOST;
