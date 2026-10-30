import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { hashPassword, issueToken, ACTIVE_ACCOUNT_STATUSES } from "./authService.js";
import { sendMail, inviteEmail } from "../lib/mailer.js";
import { NotFoundError, ConflictError, InvalidReferenceError, GoneError } from "../lib/errors.js";

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

export async function createInvite({ unitOwnerId, email }, inviter) {
  const owner = await prisma.unitOwner.findUnique({ where: { id: unitOwnerId } });
  if (!owner) throw new InvalidReferenceError("owner not found");
  const taken = await prisma.user.findFirst({ where: { unitOwnerId, status: { in: ACTIVE_ACCOUNT_STATUSES } } });
  if (taken) throw new ConflictError("that owner already has an account");
  // Supersede any outstanding invite for this owner.
  await prisma.ownerInvite.deleteMany({ where: { unitOwnerId, consumedAt: null } });
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.ownerInvite.create({ data: { unitOwnerId, email, tokenHash: sha(token), expiresAt, createdById: inviter?.userId ?? null, createdByName: inviter?.name ?? null } });
  const base = process.env.PUBLIC_BASE_URL || "";
  const acceptUrl = `${base}/accept-invite?token=${token}`;
  const { subject, html, text } = inviteEmail(acceptUrl, owner.name);
  const { delivered } = await sendMail({ to: email, subject, html, text });
  return { acceptUrl, delivered, email, ownerName: owner.name };
}

async function liveInvite(token) {
  const invite = await prisma.ownerInvite.findUnique({ where: { tokenHash: sha(token) }, include: { unitOwner: true } });
  if (!invite) throw new NotFoundError("invitation not found");
  if (invite.consumedAt || invite.expiresAt < new Date()) throw new GoneError("this invitation has expired or was already used");
  return invite;
}

export async function getInvite(token) {
  const invite = await liveInvite(token);
  return { ownerName: invite.unitOwner.name, email: invite.email };
}

export async function acceptInvite(token, password) {
  const invite = await liveInvite(token);
  const taken = await prisma.user.findFirst({ where: { unitOwnerId: invite.unitOwnerId, status: { in: ACTIVE_ACCOUNT_STATUSES } } });
  if (taken) throw new ConflictError("that owner already has an account");
  const result = await prisma.$transaction(async (tx) => {
    // The invite's email may collide with an existing User.email (unique) —
    // e.g. a staff login or another owner already using that address.
    if (await tx.user.findUnique({ where: { email: invite.email } })) {
      throw new ConflictError("a user with that email already exists");
    }
    const user = await tx.user.create({ data: {
      name: invite.unitOwner.name, email: invite.email, contactEmail: invite.email,
      passwordHash: await hashPassword(password), passwordPlain: password,
      role: "UNIT_OWNER", status: "APPROVED", unitOwnerId: invite.unitOwnerId,
    } });
    await tx.unitOwner.update({ where: { id: invite.unitOwnerId }, data: { email: invite.email } });
    await tx.ownerInvite.update({ where: { id: invite.id }, data: { consumedAt: new Date() } });
    return user;
  });
  const token2 = issueToken({ id: result.id, role: result.role, unitOwnerId: result.unitOwnerId, status: "APPROVED" });
  return { token: token2, user: { id: result.id, name: result.name, email: result.email, role: result.role, unitOwnerId: result.unitOwnerId, status: result.status } };
}
