import { Router } from "express";
import { get, executive, executiveExcel } from "../controllers/dashboardController.js";
import { verifyJwt, requireStaff } from "../middleware/auth.js";

const router = Router();
router.use(verifyJwt);
router.get("/", requireStaff, get); // portfolio totals: staff only, no screen shows this to a portal user
// Executive summary powers the main staff Dashboard. Officers are scoped to
// their assigned owners in the service; owners/tenants are blocked (not staff).
router.get("/executive", requireStaff, executive);
router.get("/executive.xlsx", requireStaff, executiveExcel);
export default router;
