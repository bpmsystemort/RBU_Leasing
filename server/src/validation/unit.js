import { z } from "zod";

export const unitCreateSchema = z.object({
  ownerId: z.string().min(1),
  unitNumber: z.string().min(1),
  towerId: z.string().nullish(),
  building: z.string().nullish(),
  floor: z.string().nullish(),
  slotNo: z.string().nullish(),
  type: z.string().nullish(),
  sizeSqm: z.coerce.number().nonnegative().nullish(),
  // Optional: base rent is captured at the lease level, not on the unit. The
  // service defaults it to 0 so registration works without it.
  baseRent: z.coerce.number().nonnegative().nullish(),
  // BLOCKED and OCCUPIED are pipeline-driven; only VACANT/UNAVAILABLE are manual.
  status: z.enum(["VACANT", "UNAVAILABLE"]).optional(),
  submit: z.boolean().optional(),
});

export const unitUpdateSchema = unitCreateSchema.partial();

export const unitRejectSchema = z.object({ remarks: z.string().min(1, "A remark is required") });

export const assignOwnerSchema = z.object({
  toOwnerId: z.string().min(1),
  reason: z.string().trim().max(500).nullish(),
});
