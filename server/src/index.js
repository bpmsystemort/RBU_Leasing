import "./env.js";
import { createApp } from "./app.js";

// Refuse to start without the settings the app cannot work without. A missing
// JWT_SECRET used to boot fine and then fail every sign-in with a 500, and a
// missing DATABASE_URL only surfaced as 500s on the first data request.
const missing = ["JWT_SECRET", "DATABASE_URL"].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`RBU Leasing cannot start: ${missing.join(", ")} not set. Check server/.env.`);
  process.exit(1);
}
if (process.env.JWT_SECRET === "change-me-in-prod") {
  console.warn("WARNING: JWT_SECRET is still the example value from .env.example — anyone can forge a login token. Set a long random secret.");
}

const app = createApp();
const port = process.env.PORT || 4000;
if (!process.env.PORT) console.warn(`PORT is not set in server/.env — falling back to ${port}.`);

// Express 5 hands a listen failure (port in use, no permission) to this
// callback instead of throwing. Ignoring it logged "RBU Leasing on :<port>" for
// a server that never started, then let the process exit quietly.
app.listen(port, (err) => {
  if (err) {
    console.error(`RBU Leasing failed to listen on :${port} — ${err.code || ""} ${err.message}`);
    process.exit(1);
  }
  console.log(`RBU Leasing on :${port} (${process.env.NODE_ENV || "development"})`);
});
