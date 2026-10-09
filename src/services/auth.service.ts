import { OtpPurpose, Prisma, PrismaClient, User } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env";
import { AuthConstants } from "../constants";
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../utils/errors";
import {
  RegisterDto,
  LoginDto,
  AuthResponse,
  JwtPayload,
  RegistrationResult,
  UserProfile,
  VerifyOtpDto,
  ResendOtpDto,
  GoogleAuthDto,
} from "../types/auth.types";
import { OtpService, ResendResult } from "./otp.service";
import { ensureDeliveryConfigured } from "./delivery";
import { GoogleVerifiedProfile, verifyGoogleIdToken } from "./google-auth.service";

/** Masks an email for display, e.g. "john@example.com" -> "j***@example.com". */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export interface AuthServiceDeps {
  otpService?: OtpService;
  verifyGoogleIdToken?: (idToken: string) => Promise<GoogleVerifiedProfile>;
}

export class AuthService {
  private prisma: PrismaClient;
  private otpService: OtpService;
  private verifyGoogle: (idToken: string) => Promise<GoogleVerifiedProfile>;

  constructor(prisma: PrismaClient, deps: AuthServiceDeps = {}) {
    this.prisma = prisma;
    this.otpService = deps.otpService ?? new OtpService(prisma);
    this.verifyGoogle = deps.verifyGoogleIdToken ?? verifyGoogleIdToken;
  }

  private generateAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, env.jwtAccessSecret, {
      expiresIn: env.jwtAccessExpiresIn,
    } as SignOptions);
  }

  private generateRefreshToken(payload: { sessionId: string; userId: string }): string {
    return jwt.sign(payload, env.jwtRefreshSecret, {
      expiresIn: env.jwtRefreshExpiresIn,
    } as SignOptions);
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private getAccessTokenExpiry(): Date {
    const expiresIn = env.jwtAccessExpiresIn;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 15 * 60 * 1000);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + value * ms[unit]);
  }

  private getRefreshTokenExpiry(): Date {
    const expiresIn = env.jwtRefreshExpiresIn;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + value * ms[unit]);
  }

  getRefreshTokenMaxAgeMs(): number {
    const expiresIn = env.jwtRefreshExpiresIn;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]);
    const unit = match[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * ms[unit];
  }

  private getRefreshTokenMaxAgeSeconds(): number {
    const expiresIn = env.jwtRefreshExpiresIn;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60;
    const value = parseInt(match[1]);
    const unit = match[2];
    const seconds: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };
    return value * seconds[unit];
  }

  private getAccessTokenMaxAgeSeconds(): number {
    const expiresIn = env.jwtAccessExpiresIn;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 15 * 60;
    const value = parseInt(match[1]);
    const unit = match[2];
    const seconds: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };
    return value * seconds[unit];
  }

  async register(dto: RegisterDto): Promise<RegistrationResult> {
    // Fail fast (503) before touching the database when delivery is not
    // configured for this environment.
    ensureDeliveryConfigured();

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (existingUser) {
      throw new ConflictError("User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, AuthConstants.BCRYPT_ROUNDS);

    // User + role-specific profile are created atomically so a partial
    // failure can never leave orphaned records.
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName ? dto.lastName.trim() : null,
            email,
            passwordHash,
            role: dto.role || "STUDENT",
            authProvider: "EMAIL",
            isVerified: false,
          },
        });

        if (created.role === "STUDENT") {
          await tx.studentProfile.create({ data: { userId: created.id } });
        } else if (created.role === "PARENT") {
          await tx.parentProfile.create({ data: { userId: created.id } });
        } else if (created.role === "TEACHER") {
          await tx.teacherProfile.create({ data: { userId: created.id } });
        }

        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("User with this email already exists");
      }
      throw error;
    }

    try {
      const { expiresAt } = await this.otpService.issueAndSend(
        user.id,
        email,
        OtpPurpose.REGISTRATION
      );
      return {
        user: this.toUserProfile(user),
        verification: {
          destination: maskEmail(email),
          expiresInSeconds: Math.max(
            0,
            Math.round((expiresAt.getTime() - Date.now()) / 1000)
          ),
          resendCooldownSeconds: env.otpResendCooldownSeconds,
        },
      };
    } catch (error) {
      // Never leave behind an account that cannot receive its verification
      // code — the transaction rolled back for profile creation, so removing
      // the user cascades away profiles and challenges.
      try {
        await this.prisma.user.delete({ where: { id: user.id } });
      } catch {
        console.error(
          "[AuthService] Failed to clean up account after delivery failure"
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.trim().toLowerCase(), mode: "insensitive" },
      },
    });

    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("Account is inactive. Please contact support.");
    }

    if (!user.passwordHash) {
      throw new UnauthorizedError("Please login using your social account");
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Unverified accounts must complete OTP verification before a session
    // is issued. Checked after the password to avoid leaking account state
    // to unauthenticated callers.
    if (!user.isVerified) {
      throw new ForbiddenError(
        "Account not verified. Please verify your email before signing in."
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.createSession(user);
  }

  private toUserProfile(user: User): UserProfile {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? "",
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
    };
  }

  async createSession(
    user: User,
    client: Prisma.TransactionClient = this.prisma
  ): Promise<AuthResponse> {
    const sessionId = randomUUID();

    const accessTokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email!,
      role: user.role,
      sessionId,
    };

    const accessToken = this.generateAccessToken(accessTokenPayload);
    const refreshToken = this.generateRefreshToken({
      userId: user.id,
      sessionId,
    });

    await client.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    return {
      user: this.toUserProfile(user),
      accessToken,
      refreshToken,
      expiresIn: this.getAccessTokenMaxAgeSeconds(),
    };
  }

  /**
   * Verifies an OTP challenge and, only on success, marks the contact method
   * verified and issues the first authenticated session — all atomically.
   */
  async verifyOtp(dto: VerifyOtpDto): Promise<AuthResponse> {
    const destination = dto.email.trim().toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      let user = await this.otpService.consumeCode(tx, {
        destination,
        purpose: OtpPurpose.REGISTRATION,
        code: dto.code,
      });

      if (!user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact support.");
      }

      if (!user.isVerified) {
        user = await tx.user.update({
          where: { id: user.id },
          data: { isVerified: true, lastLoginAt: new Date() },
        });
      }

      return this.createSession(user, tx);
    });
  }

  /** Requests a resend of the registration verification code (generic response). */
  async resendOtp(dto: ResendOtpDto): Promise<ResendResult> {
    return this.otpService.resend({ email: dto.email });
  }

  /**
   * Signs in (or provisions) an account from a verified Google ID token.
   * Existing password-based accounts are never silently linked or taken over.
   */
  async googleAuth(dto: GoogleAuthDto): Promise<AuthResponse> {
    const profile = await this.verifyGoogle(dto.credential);
    const email = profile.email.trim().toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (existing) {
      if (existing.authProvider !== "GOOGLE") {
        throw new ForbiddenError(
          "This email already has a password-based account. Please sign in with your email and password."
        );
      }
      if (!existing.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact support.");
      }
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastLoginAt: new Date() },
      });
      return this.createSession(existing);
    }

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            firstName: profile.firstName,
            lastName: profile.lastName ?? null,
            role: "STUDENT",
            authProvider: "GOOGLE",
            // Google only yields email_verified=true tokens (enforced by
            // verifyGoogleIdToken), so the contact method is verified.
            isVerified: true,
            passwordHash: null,
          },
        });
        await tx.studentProfile.create({ data: { userId: created.id } });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("User with this email already exists");
      }
      throw error;
    }

    return this.createSession(user);
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    try {
      const decoded = jwt.verify(refreshToken, env.jwtRefreshSecret) as unknown as {
        userId: string;
        sessionId: string;
      };

      const session = await this.prisma.session.findUnique({
        where: { id: decoded.sessionId },
      });

      if (!session) {
        throw new UnauthorizedError("Invalid session");
      }

      if (session.revokedAt) {
        throw new UnauthorizedError("Session has been revoked");
      }

      if (new Date() > session.expiresAt) {
        throw new UnauthorizedError("Session has expired");
      }

      if (session.tokenHash !== this.hashToken(refreshToken)) {
        throw new UnauthorizedError("Invalid session token");
      }

      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedError("User not found or inactive");
      }

      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      return this.createSession(user);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError("Invalid refresh token");
      }
      throw error;
    }
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundError("Session not found");
    }

    if (session.userId !== userId) {
      throw new UnauthorizedError("Unauthorized");
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async validateSession(token: string): Promise<{ user: User; sessionId: string }> {
    try {
      const decoded = jwt.verify(token, env.jwtAccessSecret) as unknown as JwtPayload;

      const session = await this.prisma.session.findUnique({
        where: { id: decoded.sessionId },
      });

      if (!session) {
        throw new UnauthorizedError("Session not found");
      }

      if (session.revokedAt) {
        throw new UnauthorizedError("Session has been revoked");
      }

      if (new Date() > session.expiresAt) {
        throw new UnauthorizedError("Session has expired");
      }

      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedError("User not found or inactive");
      }

      return { user, sessionId: decoded.sessionId };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError("Access token has expired");
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError("Invalid access token");
      }
      throw error;
    }
  }
}
