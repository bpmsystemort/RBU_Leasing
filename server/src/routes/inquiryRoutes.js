import { Router } from "express";
import * as ctrl from "../controllers/inquiryController.js";
import { verifyJwt, requireRole, requireWrite } from "../middleware/auth.js";
import { inquiryLimiter } from "../middleware/rateLimit.js";

const router = Router();
// Public: anyone can submit an inquiry from the landing page.
router.post("/", inquiryLimiter, ctrl.create);
// Staff only from here on.
router.get("/", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER", "VIEWER"), ctrl.list);
router.patch("/:id/assign", verifyJwt, requireRole("ADMIN"), ctrl.assign);
// O-Lease self-assign / release (admin may also use these).
router.patch("/:id/accept", verifyJwt, requireRole("LEASING_OFFICER", "ADMIN"), ctrl.accept);
router.patch("/:id/release", verifyJwt, requireRole("LEASING_OFFICER", "ADMIN"), ctrl.release);
router.patch("/:id", verifyJwt, requireWrite, ctrl.update);
router.delete("/:id", verifyJwt, requireWrite, ctrl.remove);
export default router;
