import { Router } from "express";
import * as ctrl from "../controllers/ownerController.js";
import { verifyJwt, requireWrite, requireRole, requireStaff } from "../middleware/auth.js";

const router = Router();
router.use(verifyJwt);
router.get("/me", requireRole("UNIT_OWNER"), ctrl.me); // must precede "/:id"
// Unscoped (ALL owners) picker for the approval link-picker — must precede
// "/:id" too, and is intentionally narrower than requireStaff: a VIEWER has
// no reason to link approvals to owners.
router.get("/linkable", requireRole("ADMIN", "LEASING_OFFICER"), ctrl.linkable);
router.get("/", requireStaff, ctrl.list);
router.get("/:id/profile", requireStaff, ctrl.profile);
router.get("/:id", requireStaff, ctrl.get);
router.post("/", requireWrite, ctrl.create);
router.patch("/:id/assign", requireRole("ADMIN"), ctrl.assign);
router.patch("/:id", requireWrite, ctrl.update);
router.delete("/:id", requireWrite, ctrl.remove);
export default router;
