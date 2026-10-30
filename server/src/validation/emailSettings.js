import { z } from "zod";

export const emailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().optional().nullable(),
  port: z.number().int().optional(),
  secure: z.boolean().optional(),
  fromAddress: z.string().email().optional().nullable(),
  fromName: z.string().optional().nullable(),
});

export const testSchema = z.object({
  to: z.string().email(),
});
