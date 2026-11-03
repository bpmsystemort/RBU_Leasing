import { Router } from "express";
import * as ctrl from "../controllers/unitController.js";
import { verifyJwt, requireWrite, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(verifyJwt);
// Staff see all (filtered); a UNIT_OWNER is auto-scoped to their own units. Tenants are blocked.
router.get("/", requireRole("ADMIN", "LEASING_OFFICER", "VIEWER", "UNIT_OWNER"), ctrl.list);
// Staff and the owning lessor only. This returns the owner, the rent and the
// officer's internal review remarks, and an unpublished or rejected unit is
// deliberately absent from the public listing — a tenant reads units there.
router.get("/:id", requireRole("ADMIN", "LEASING_OFFICER", "VIEWER", "UNIT_OWNER"), ctrl.get);
router.post("/", requireRole("ADMIN", "LEASING_OFFICER", "UNIT_OWNER"), ctrl.create);
router.patch("/:id", requireRole("ADMIN", "LEASING_OFFICER", "UNIT_OWNER"), ctrl.update);
router.patch("/:id/submit", requireRole("ADMIN", "LEASING_OFFICER", "UNIT_OWNER"), ctrl.submit);
router.patch("/:id/approve", requireWrite, ctrl.approve);
router.patch("/:id/reject", requireWrite, ctrl.reject);
router.delete("/:id", requireWrite, ctrl.remove);
export default router;
