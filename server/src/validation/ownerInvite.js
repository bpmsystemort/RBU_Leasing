import { z } from "zod";

export const createInviteSchema = z.object({
  unitOwnerId: z.string(),
  email: z.string().email(),
});

export const acceptSchema = z.object({
  password: z.string().min(8),
});
