import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/authRoutes.js";
import ownerRoutes from "./routes/ownerRoutes.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import unitRoutes from "./routes/unitRoutes.js";
import leaseRoutes from "./routes/leaseRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import estateRoutes from "./routes/estateRoutes.js";
import towerRoutes from "./routes/towerRoutes.js";
import requirementRoutes from "./routes/requirementRoutes.js";
import lessorRequirementRoutes from "./routes/lessorRequirementRoutes.js";
import lesseeRequirementRoutes from "./routes/lesseeRequirementRoutes.js";
import inquiryRoutes from "./routes/inquiryRoutes.js";
import lessorInfoSheetRoutes from "./routes/lessorInfoSheetRoutes.js";
import lesseeInfoSheetRoutes from "./routes/lesseeInfoSheetRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import cmsFormRoutes from "./routes/cmsFormRoutes.js";
import { cmsPageFormRouter, pageFormRouter } from "./routes/pageFormRoutes.js";
import leasingTransactionRoutes from "./routes/leasingTransactionRoutes.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import unitListingRoutes from "./routes/unitListingRoutes.js";
import publicUnitRoutes from "./routes/publicUnitRoutes.js";
import { publicEstateRouter, publicTowerRouter } from "./routes/publicReferenceRoutes.js";
import { auditMiddleware } from "./middleware/audit.js";
import { errorHandler } from "./middleware/error.js";
import { prisma } from "./lib/prisma.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // Sits ahead of every guard so monitoring needs no credentials, and reaches
  // the database rather than answering from a literal: this used to report
  // `{ ok: true }` unconditionally, so it stayed green through an outage where
  // every data endpoint was returning 500. The error is logged, never returned
  // — a health check is a public endpoint and a database error names the user
  // and the failure mode.
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: "up" });
    } catch (e) {
      console.error("Health check failed — database unreachable:", e.message);
      res.status(503).json({ ok: false, db: "down" });
    }
  });
  app.use(auditMiddleware); // records every successful mutating action
  app.use("/api/auth", authRoutes);
  app.use("/api/owners", ownerRoutes);
  app.use("/api/tenants", tenantRoutes);
  app.use("/api/units", unitRoutes);
  app.use("/api/leases", leaseRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/estates", estateRoutes);
  app.use("/api/towers", towerRoutes);
  app.use("/api/requirements", requirementRoutes);
  app.use("/api/lessor-requirements", lessorRequirementRoutes);
  app.use("/api/lessee-requirements", lesseeRequirementRoutes);
  app.use("/api/inquiries", inquiryRoutes);
  app.use("/api/lessor-info-sheets", lessorInfoSheetRoutes);
  app.use("/api/lessee-info-sheets", lesseeInfoSheetRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/import", importRoutes);
  app.use("/api/cms/forms", cmsFormRoutes);
  app.use("/api/cms/page-forms", cmsPageFormRouter);
  app.use("/api/page-forms", pageFormRouter);
  app.use("/api/leasing-transactions", leasingTransactionRoutes);
  app.use("/api/appointments", appointmentRoutes);
  app.use("/api/unit-listings", unitListingRoutes);
  app.use("/api/public/units", publicUnitRoutes);
  app.use("/api/public/estates", publicEstateRouter);
  app.use("/api/public/towers", publicTowerRouter);

  // Production: serve the built Vue client as a single deployable. The API
  // routes above take precedence; any other GET falls back to index.html so
  // client-side routing works. Gated on NODE_ENV so tests are unaffected.
  if (process.env.NODE_ENV === "production") {
    const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
    // Fingerprinted assets may cache indefinitely, but the HTML shell must never
    // be cached — otherwise a browser keeps loading an old build's routing (e.g.
    // landing on the sign-in page instead of the public Inquiry page).
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
      },
    }));
    // A request for a build artefact that no longer exists must fail as a
    // missing file. Falling back to index.html answers it with HTML and a 200,
    // which the browser then tries to execute as JavaScript — the app dies
    // silently on a blank page and the network tab shows nothing but successes.
    // That is exactly what a client holding a previous build's cached index.html
    // asks for, so this is the difference between "your cache is stale" and an
    // afternoon of debugging.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      if (req.path.startsWith("/assets/")) return next();
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
