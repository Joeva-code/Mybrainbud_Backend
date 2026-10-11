import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { OtpPurpose, Prisma, PrismaClient, User } from "@prisma/client";
import { env } from "../config/env";
import { AuthConstants } from "../constants";
import { ApiError, ServiceUnavailableError, UnauthorizedError } from "../utils/errors";
import { DeliveryProvider, ensureDeliveryConfigured, getDeliveryProvider } from "./delivery";
import { PendingRegistrationData } from "../types/auth.types";

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

/**
 * Generates a professional HTML email template for verification codes.
 * Includes plain-text fallback.
 */
function generateVerificationEmail(
  code: string,
  expiryMinutes: number
): { text: string; html: string } {
  const text = `Your MyBrainBud verification code is: ${code}\n\n` +
    `It expires in ${expiryMinutes} minutes. ` +
    `If you did not request this code, you can safely ignore this message.`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyBrainBud Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <!-- Header -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0;">
              <h1 style="margin: 0; color: #1a1a2e; font-size: 24px; font-weight: 600;">MyBrainBud</h1>
              <p style="margin: 8px 0 0; color: #666; font-size: 14px;">Email Verification</p>
            </td>
          </tr>
        </table>

        <!-- Content -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 30px 0;">
          <tr>
            <td style="color: #333; font-size: 16px; line-height: 1.6;">
              <p style="margin: 0 0 16px;">Hello,</p>
              <p style="margin: 0 0 16px;">Thank you for signing up for MyBrainBud. Please use the verification code below to complete your registration:</p>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding: 20px 0;">
              <div style="display: inline-block; background-color: #1a1a2e; color: #ffffff; padding: 16px 32px; border-radius: 8px; letter-spacing: 8px; font-size: 28px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                ${code}
              </div>
            </td>
          </tr>
          <tr>
            <td style="color: #666; font-size: 14px; line-height: 1.6; text-align: center;">
              <p style="margin: 0 0 8px;">This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
              <p style="margin: 0;">If you did not request this code, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>

        <!-- Security Notice -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e0e0e0; padding-top: 20px;">
          <tr>
            <td style="color: #888; font-size: 12px; line-height: 1.5; text-align: center;">
              <p style="margin: 0 0 8px;"><strong>Security Notice:</strong> Never share this code with anyone. MyBrainBud will never ask for your verification code via phone, email, or any other channel.</p>
              <p style="margin: 0;">If you're having trouble, please contact our support team.</p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding-top: 20px;">
          <tr>
            <td style="color: #999; font-size: 12px; text-align: center;">
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} MyBrainBud. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { text, html };
}

export interface OtpIssueResult {
  expiresAt: Date;
  code?: string;
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
      const { text, html } = generateVerificationEmail(code, env.otpExpiryMinutes);
      await this.delivery.send({
        to: normalizedDestination,
        subject: "Your MyBrainBud verification code",
        text,
        html,
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

    return { expiresAt, code: env.nodeEnv !== "production" ? code : undefined };
  }

  /**
   * Issues a fresh challenge with registration data stored in the verification
   * record. The user account is created only after OTP verification.
   */
  async issueAndSendWithRegistrationData(
    destination: string,
    purpose: OtpPurpose,
    registrationData: PendingRegistrationData
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
        userId: null, // No user yet - will be created after verification
        destination: normalizedDestination,
        purpose,
        codeHash: hashOtpCode(code, normalizedDestination),
        expiresAt,
        registrationData: registrationData as any,
      },
    });

    try {
      const { text, html } = generateVerificationEmail(code, env.otpExpiryMinutes);
      await this.delivery.send({
        to: normalizedDestination,
        subject: "Your MyBrainBud verification code",
        text,
        html,
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

    return { expiresAt, code: env.nodeEnv !== "production" ? code : undefined };
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

    // Check for pending registration (no user created yet)
    const purpose = OtpPurpose.REGISTRATION;
    const activeWhere = {
      destination: email,
      purpose,
      verifiedAt: null,
    };

    const latest = await this.prisma.otpVerification.findFirst({
      where: activeWhere,
      orderBy: { createdAt: "desc" },
    });

    const hasPendingRegistration = latest?.registrationData && !latest.userId;
    const isExistingUser = user?.email && !user.isVerified && user.isActive;

    if (!hasPendingRegistration && !isExistingUser) {
      return { cooldownSeconds: env.otpResendCooldownSeconds };
    }

    const now = Date.now();
    const withinCooldown =
      latest !== null &&
      now - latest.createdAt.getTime() < env.otpResendCooldownSeconds * 1000;

    const hourAgo = new Date(now - 60 * 60 * 1000);
    const recentCount = await this.prisma.otpVerification.count({
      where: { destination: email, purpose, createdAt: { gte: hourAgo } },
    });

    if (withinCooldown || recentCount >= env.otpMaxResendsPerHour) {
      // Enforced silently to keep the response account-discovery safe.
      return { cooldownSeconds: env.otpResendCooldownSeconds };
    }

    try {
      if (hasPendingRegistration && latest) {
        // Resend for pending registration - use stored registration data
        const registrationData = latest.registrationData as unknown as PendingRegistrationData;
        await this.issueAndSendWithRegistrationData(email, purpose, registrationData);
      } else if (isExistingUser && user) {
        // Resend for existing unverified user
        await this.issueAndSend(user.id!, user.email!, purpose);
      }
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
  ): Promise<{ user: User | null; registrationData: PendingRegistrationData | null }> {
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
      ? await client.user.findUnique({ where: { id: record.userId as string } })
      : null;

    const registrationData = record.registrationData as unknown as PendingRegistrationData | null;

    return { user, registrationData };
  }
}

