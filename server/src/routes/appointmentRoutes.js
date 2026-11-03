import { Router } from "express";
import { verifyJwt, requireWrite } from "../middleware/auth.js";
import * as ctrl from "../controllers/appointmentController.js";

const r = Router();
r.use(verifyJwt);
r.get("/mine", ctrl.mine);
r.get("/transaction/:txnId", ctrl.forTransaction);
r.post("/transaction/:txnId/:stage", requireWrite, ctrl.schedule);
r.patch("/:id/reschedule", requireWrite, ctrl.reschedule);
r.patch("/:id/complete", requireWrite, ctrl.complete);
r.patch("/:id/cancel", requireWrite, ctrl.cancel);
// No requireWrite: a UNIT_OWNER (the lessor) must reach these too. The
// service enforces access via assertCanAccess plus a handshake role check.
r.patch("/:id/confirm", ctrl.confirm);
r.patch("/:id/propose", ctrl.propose);
export default r;
