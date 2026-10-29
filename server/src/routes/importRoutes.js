import { Router } from "express";
import multer from "multer";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import * as ctrl from "../controllers/importController.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === XLSX),
});

const router = Router();
router.use(verifyJwt);
router.post("/portfolio", requireRole("ADMIN"), upload.single("file"), ctrl.portfolio);
export default router;
