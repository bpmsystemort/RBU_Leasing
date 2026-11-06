import { Router } from "express";
import * as ctrl from "../controllers/ownerInviteController.js";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();
router.post("/", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), ctrl.create);
// Public: the owner reaches this from the emailed link, before they have any account.
router.get("/:token", ctrl.get);
router.post("/:token/accept", rateLimit({ max: 10 }), ctrl.accept);
export default router;
