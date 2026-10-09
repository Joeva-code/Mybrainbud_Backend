import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { AuthConstants } from "../constants";
import { BadRequestError } from "../utils/errors";
import { ensureDeliveryConfigured, getDeliveryProvider, DeliveryProvider } from "./delivery";

/** Hashes a reset token for at-rest storage (tokens are never stored in plaintext). */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Password reset via emailed single-use token.
 *
 * - Requesting a reset always returns the same generic response, whether or
 *   not the account exists (account-enumeration safe).
 * - Tokens are 256-bit random values, stored only as SHA-256 hashes.
 * - Tokens expire (RESET_TOKEN_EXPIRY_MINUTES, default 30), are single-use,
 *   and carry an attempt counter.
 * - A successful reset revokes every active session for the user.
 * - Reset tokens are never logged or returned in API responses (the only
 *   copy is delivered to the account's own email via the delivery provider).
 */
export class PasswordResetService {
  constructor(
    private prisma: PrismaClient,
    private delivery: DeliveryProvider = getDeliveryProvider()
  ) {}

  async requestReset(emailRaw: string): Promise<void> {
    // Pre-check runs before any account lookup so an unavailable provider
    // fails identically for known and unknown accounts (no enumeration).
    ensureDeliveryConfigured();

    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (user?.email && user.isActive) {
      const token = randomBytes(32).toString("hex");
      try {
        await this.prisma.$transaction([
          this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
          this.prisma.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: hashResetToken(token),
              expiresAt: new Date(Date.now() + env.resetTokenExpiryMinutes * 60 * 1000),
            },
          }),
        ]);

        await this.delivery.send({
          to: user.email,
          subject: "MyBrainBud password reset",
          text:
            `A password reset was requested for your MyBrainBud account.\n\n` +
            `Use this token to reset your password: ${token}\n\n` +
            `It expires in ${env.resetTokenExpiryMinutes} minutes and can only be used once. ` +
            `If you did not request this, you can safely ignore this message.`,
        });
      } catch {
        // Storage/delivery failures must never change the outward response,
        // otherwise the endpoint could be used to probe for accounts.
        console.error("[PasswordReset] Failed to process password reset request");
      }
    }
    // Deliberately identical response for existing and unknown accounts.
  }

  async resetPassword(params: { token: string; password: string }): Promise<void> {
    const invalid = new BadRequestError("Invalid or expired reset token.");
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(params.token) },
    });

    const now = new Date();
    if (!record || record.usedAt || record.expiresAt.getTime() <= now.getTime()) {
      throw invalid;
    }

    // Claim an attempt atomically; the unique-hash lookup already guarantees
    // the token is correct, this guards replay/expiry races.
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        attempts: { lt: env.resetTokenMaxAttempts },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw invalid;
    }

    const passwordHash = await bcrypt.hash(params.password, AuthConstants.BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) {
        throw invalid; // Already used by a concurrent request — roll back.
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      // A password reset must terminate every existing session.
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
