import { Router } from "express";
import {
  login, register, signup, me, users, editUser, removeUser,
  pendingAccounts, approve, reject, revise, application, resubmit,
  suspend, restore,
} from "../controllers/authController.js";
import { verifyJwt, verifyJwtAllowPending, requireRole } from "../middleware/auth.js";

const router = Router();
router.post("/login", login);
// Public self-registration for lessors/lessees.
router.post("/signup", signup);
router.post("/register", verifyJwt, requireRole("ADMIN"), register);
// Account approval queue — the owner asked for ADMIN or O-Lease.
router.get("/pending", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), pendingAccounts);
router.patch("/pending/:id/approve", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), approve);
router.patch("/pending/:id/reject", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), reject);
router.patch("/pending/:id/revise", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), revise);
router.get("/users", verifyJwt, requireRole("ADMIN"), users);
router.patch("/users/:id", verifyJwt, requireRole("ADMIN"), editUser);
router.delete("/users/:id", verifyJwt, requireRole("ADMIN"), removeUser);
// Suspend/restore are reversible, lower-stakes than edit/delete, so — like
// the approval queue — ADMIN or LEASING_OFFICER may act on them.
router.patch("/users/:id/suspend", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), suspend);
router.patch("/users/:id/restore", verifyJwt, requireRole("ADMIN", "LEASING_OFFICER"), restore);
router.get("/me", verifyJwt, me);
// The only two routes a non-approved account may reach.
router.get("/application", verifyJwtAllowPending, application);
router.patch("/application", verifyJwtAllowPending, resubmit);
export default router;
