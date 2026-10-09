import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { OtpPurpose, Prisma, PrismaClient, User } from "@prisma/client";
import { env } from "../config/env";
import { AuthConstants } from "../constants";
import { ApiError, ServiceUnavailableError, UnauthorizedError } from "../utils/errors";
import { DeliveryProvider, ensureDeliveryConfigured, getDeliveryProvider } from "./delivery";

/** Any Prisma client (standalone or interactive-transaction client). */
export type OtpClient = Prisma.TransactionClient | PrismaClient;

/** Generates a cryptographically secure fixed-length numeric code (4 digits by design). */
export function generateOtpCode(): string {
  const max = 10 ** AuthConstants.OTP_LENGTH;
  return randomInt(0, max).toString().padStart(AuthConstants.OTP_LENGTH, "0");
}

/**
 * Hashes an OTP with a server-side pepper (JWT access secret) so a leaked
 * database dump alone cannot be used to brute-force short codes offline.
 */
export function hashOtpCode(code: string, destination: string): string {
  return createHmac("sha256", env.jwtAccessSecret)
    .update(`${destination.trim().toLowerCase()}:${code}`)
    .digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface OtpIssueResult {
  expiresAt: Date;
}

export interface ResendResult {
  cooldownSeconds: number;
}

/**
 * OTP generation, storage, delivery, and verification.
 *
 * Security properties:
 * - Codes are 4-digit, generated with a CSPRNG, stored only as HMAC hashes.
 * - Challenges are bound to user + destination + purpose.
 * - Active codes are superseded (deleted) when a new code is issued.
 * - Verification atomically claims an attempt, so concurrent requests cannot
 *   consume the same code twice and the attempt limit cannot be bypassed.
 * - Every failure returns the same generic error message.
 */
export class OtpService {
  constructor(
    private prisma: PrismaClient,
    private delivery: DeliveryProvider = getDeliveryProvider()
  ) {}


  /**
   * Issues a fresh challenge (superseding any active one) and delivers the
   * code. If delivery fails, the challenge is removed so a code that was
   * never delivered cannot be used.
   */
  async issueAndSend(
    userId: string,
    destination: string,
    purpose: OtpPurpose
  ): Promise<OtpIssueResult> {
    ensureDeliveryConfigured();

    const normalizedDestination = destination.trim().toLowerCase();
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);
    const activeWhere = {
      destination: normalizedDestination,
      purpose,
      verifiedAt: null,
    };

    // Supersede any previous active code for this challenge.
    await this.prisma.otpVerification.deleteMany({ where: activeWhere });
    await this.prisma.otpVerification.create({
      data: {
        userId,
        destination: normalizedDestination,
        purpose,
        codeHash: hashOtpCode(code, normalizedDestination),
        expiresAt,
      },
    });

    try {
      await this.delivery.send({
        to: normalizedDestination,
        subject: "Your MyBrainBud verification code",
        text:
          `Your MyBrainBud verification code is: ${code}\n\n` +
          `It expires in ${env.otpExpiryMinutes} minutes. ` +
          `If you did not request this code, you can safely ignore this message.`,
      });
    } catch (error) {
      // Remove the undelivered challenge so it cannot be misused.
      try {
        await this.prisma.otpVerification.deleteMany({ where: activeWhere });
      } catch {
        console.error("[OtpService] Failed to clean up undelivered challenge");
      }
      throw error instanceof ApiError
        ? error
        : new ServiceUnavailableError("Verification code delivery failed. Please try again.");
    }

    return { expiresAt };
  }

  /**
   * Resends a registration verification code.
   *
   * The response is intentionally generic and identical whether or not the
   * account exists, is already verified, or is inside the cooldown window —
   * so the endpoint cannot be used to enumerate accounts. Cooldown and hourly
   * caps are enforced silently by skipping delivery.
   */
  async resend(params: { email: string }): Promise<ResendResult> {
    // Fails with the same 503 for every caller when delivery is not configured.
    ensureDeliveryConfigured();

    const email = params.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (!user?.email || user.isVerified || !user.isActive) {
      return { cooldownSeconds: env.otpResendCooldownSeconds };
    }

    const purpose = OtpPurpose.REGISTRATION;
    const activeWhere = {
      destination: user.email,
      purpose,
      verifiedAt: null,
    };

    const latest = await this.prisma.otpVerification.findFirst({
      where: activeWhere,
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const withinCooldown =
      latest !== null &&
      now - latest.createdAt.getTime() < env.otpResendCooldownSeconds * 1000;

    const hourAgo = new Date(now - 60 * 60 * 1000);
    const recentCount = await this.prisma.otpVerification.count({
      where: { destination: user.email, purpose, createdAt: { gte: hourAgo } },
    });

    if (withinCooldown || recentCount >= env.otpMaxResendsPerHour) {
      // Enforced silently to keep the response account-discovery safe.
      return { cooldownSeconds: env.otpResendCooldownSeconds };
    }

    try {
      await this.issueAndSend(user.id, user.email, purpose);
    } catch {
      // Never leak delivery failures (or account existence) through this
      // response; log server-side without any secrets.
      console.error("[OtpService] Failed to deliver resend request");
    }

    return { cooldownSeconds: env.otpResendCooldownSeconds };
  }

  /**
   * Verifies and consumes a code inside the caller's transaction.
   *
   * Throws a single generic UnauthorizedError for every failure mode:
   * unknown challenge, expired code, wrong code, exhausted attempts, or a
   * code already consumed by a concurrent request.
   */
  async consumeCode(
    client: OtpClient,
    params: { destination: string; purpose: OtpPurpose; code: string }
  ): Promise<User> {
    const destination = params.destination.trim().toLowerCase();
    const now = new Date();

    const record = await client.otpVerification.findFirst({
      where: { destination, purpose: params.purpose, verifiedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedError(AuthConstants.OTP_INVALID_MESSAGE);
    }

    // Atomically claim one attempt. Guards against expired, superseded, and
    // attempt-exhausted records even under concurrent requests.
    const claimed = await client.otpVerification.updateMany({
      where: {
        id: record.id,
        verifiedAt: null,
        attempts: { lt: env.otpMaxAttempts },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedError(AuthConstants.OTP_INVALID_MESSAGE);
    }

    if (!hashesMatch(record.codeHash, hashOtpCode(params.code, destination))) {
      throw new UnauthorizedError(AuthConstants.OTP_INVALID_MESSAGE);
    }

    // Consume exactly once — a concurrent verifier loses this race safely.
    const consumed = await client.otpVerification.updateMany({
      where: { id: record.id, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new UnauthorizedError(AuthConstants.OTP_INVALID_MESSAGE);
    }

    const user = record.userId
      ? await client.user.findUnique({ where: { id: record.userId } })
      : null;
    if (!user) {
      throw new UnauthorizedError(AuthConstants.OTP_INVALID_MESSAGE);
    }

    return user;
  }
}

