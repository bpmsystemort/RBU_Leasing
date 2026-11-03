import { z } from "zod";

// The client sends "" (not undefined) for a field the admin cleared — treat
// that as "unset" rather than a value to validate, so clearing a field
// persists as null instead of 400ing.
const emptyToNull = (v) => (v === "" ? null : v);

export const emailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.preprocess(emptyToNull, z.string().nullable().optional()),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  fromAddress: z.preprocess(emptyToNull, z.string().email().nullable().optional()),
  fromName: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

export const testSchema = z.object({
  to: z.string().email(),
});
