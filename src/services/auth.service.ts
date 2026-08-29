import { PrismaClient, User } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";
import { env } from "../config/env";
import { UnauthorizedError, ConflictError, NotFoundError } from "../utils/errors";
import { RegisterDto, LoginDto, AuthResponse, JwtPayload } from "../types/auth.types";

export class AuthService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
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

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictError("User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        role: dto.role || "STUDENT",
        authProvider: "EMAIL",
      },
    });

    if (user.role === "STUDENT") {
      await this.prisma.studentProfile.create({
        data: { userId: user.id },
      });
    } else if (user.role === "PARENT") {
      await this.prisma.parentProfile.create({
        data: { userId: user.id },
      });
    } else if (user.role === "TEACHER") {
      await this.prisma.teacherProfile.create({
        data: { userId: user.id },
      });
    }

    return this.createSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.createSession(user);
  }

  async createSession(user: User): Promise<AuthResponse> {
    const sessionId = uuidv4();

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

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.getRefreshTokenExpiry(),
      },
    });

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email!,
        role: user.role,
        isVerified: user.isVerified,
        isActive: user.isActive,
      },
      accessToken,
      refreshToken,
      expiresIn: this.getAccessTokenMaxAgeSeconds(),
    };
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
