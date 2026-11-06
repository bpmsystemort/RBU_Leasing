import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(1),
  // Login identifier: a plain username or an email address.
  email: z.string().min(3),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["ADMIN", "LEASING_OFFICER", "VIEWER", "UNIT_OWNER", "TENANT"]).optional(),
  unitOwnerId: z.string().nullish(),
  tenantId: z.string().nullish(),
});

// The unit a lessor may describe while applying. Whitelisted explicitly: this
// arrives from an unauthenticated endpoint, so anything not named here — an
// ownerId, an approvalStatus — must never reach the database.
export const pendingUnitSchema = z.object({
  estateId: z.string().min(1).optional(),
  towerId: z.string().min(1).optional(),
  unitNumber: z.string().min(1, "Unit number is required"),
  floor: z.string().optional(),
  slotNo: z.string().optional(),
  type: z.string().optional(),
  baseRent: z.coerce.number().min(0).optional(),
}).strip();

// Public self-registration — lessors/lessees only.
export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(3), // login username; may or may not be an address
  // Required: the approver has to be able to contact the applicant, and this
  // becomes the linked Owner/Tenant record's email on approval.
  contactEmail: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["UNIT_OWNER", "TENANT"]),
  consent: z.literal(true),
  unit: pendingUnitSchema.optional(),
});

// Approving a PENDING UNIT_OWNER may optionally link to an owner already in
// the system (e.g. imported from the legacy portfolio) instead of minting a
// new one. Omitted/undefined keeps today's behavior of creating a new owner.
export const approveSchema = z.object({
  existingUnitOwnerId: z.string().optional(),
});

export const rejectAccountSchema = z.object({
  reason: z.string().min(1, "A reason is required"),
});

export const reviseAccountSchema = z.object({
  // Required: "For Revision" with no explanation is the failure mode this
  // status exists to prevent — the applicant would not know what to change.
  remarks: z.string().min(1, "Remarks are required"),
});

// Resubmission from the application status page. `.strip()` on pendingUnitSchema
// drops unknown unit keys; naming `unit` as the only field here is what stops a
// restricted session setting role, status or unitOwnerId on itself.
//
// `unit` is optional: a TENANT application never has one to resubmit, and a
// UNIT_OWNER who never described one (the old account-first path allowed
// skipping it) must still be able to resubmit as-is. authService.resubmitApplication
// is what refuses to let a lessor blank out a unit they already have.
export const resubmitSchema = z.object({
  unit: pendingUnitSchema.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().min(3).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  role: z.enum(["ADMIN", "LEASING_OFFICER", "VIEWER", "UNIT_OWNER", "TENANT"]).optional(),
});
