import { Router } from "express";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/settingsController.js";

const r = Router();
r.use(verifyJwt);
r.get("/email", requireRole("ADMIN"), ctrl.getEmail);
r.put("/email", requireRole("ADMIN"), ctrl.putEmail);
r.post("/email/test", requireRole("ADMIN"), rateLimit({ max: 10 }), ctrl.testEmail);
export default r;
