import { Router } from "express";
import multer from "multer";
import * as ctrl from "../controllers/leasingTransactionController.js";
import { verifyJwt, requireRole, requireWrite } from "../middleware/auth.js";

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

const router = Router();
router.use(verifyJwt);

// Portal users (lessee / lessor) read their own transactions.
router.get("/mine", ctrl.listMine);
router.get("/mine/:id", ctrl.getMine);

// Documents + approval routing — access is enforced per-transaction in the
// service (staff, or the linked lessee/lessor). Upload/download open to both;
// recording an approval decision is write-staff only.
router.post("/:id/documents", upload.single("file"), ctrl.uploadDocument);
router.get("/:id/documents/:docId/download", ctrl.downloadDocument);
router.delete("/:id/documents/:docId", ctrl.removeDocument);
router.get("/:id/approval-steps", ctrl.listSteps);
router.patch("/:id/approval-steps/:stepId", requireWrite, ctrl.decideStep);

// Staff operational tracker.
router.get("/", requireRole("ADMIN", "LEASING_OFFICER", "VIEWER"), ctrl.list);
router.post("/", requireWrite, ctrl.create);
router.get("/:id", requireRole("ADMIN", "LEASING_OFFICER", "VIEWER"), ctrl.get);
router.patch("/:id/status", requireWrite, ctrl.setStatus);
router.patch("/:id/advance", requireWrite, ctrl.advance);
router.patch("/:id/return", requireWrite, ctrl.returnStage);
router.patch("/:id/link", requireWrite, ctrl.link);
router.patch("/:id/block", requireWrite, ctrl.blockUnit);
router.patch("/:id/unblock", requireWrite, ctrl.unblockUnit);
router.delete("/:id", requireRole("ADMIN"), ctrl.remove);

export default router;
