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
router.patch("/:id/unavailable", requireWrite, ctrl.setUnavailable);
router.patch("/:id/restore", requireWrite, ctrl.restore);
router.patch("/:id/release-block", requireWrite, ctrl.releaseBlock);
router.patch("/:id/mark-reviewed", requireWrite, ctrl.markReviewed);
// Moving a unit to another owner is an admin decision; the history is readable by staff.
router.patch("/:id/assign-owner", requireRole("ADMIN"), ctrl.assignOwner);
router.get("/:id/assignments", requireRole("ADMIN", "LEASING_OFFICER", "VIEWER"), ctrl.assignments);
router.delete("/:id", requireWrite, ctrl.remove);
export default router;
