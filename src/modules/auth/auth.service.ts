import { PrismaClient, User } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { UnauthorizedError, ConflictError, NotFoundError, BadRequestError } from "../../utils/errors";
import { ApiError } from "../../utils/errors";

export interface RegisterDto {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  role?: "STUDENT" | "PARENT" | "TEACHER" | "SCHOOL_ADMIN" | "ADMIN";
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string;
    role: string;
    isVerified: boolean;
    isActive: boolean;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
}

export class AuthService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private generateAccessToken(payload: JwtPayload): string {
    const options: SignOptions = {
      expiresIn: env.jwtAccessExpiresIn as any,
    };
    return jwt.sign(payload, env.jwtAccessSecret, options);
  }

  private generateRefreshToken(payload: { sessionId: string; userId: string }): string {
    const options: SignOptions = {
      expiresIn: env.jwtRefreshExpiresIn as any,
    };
    return jwt.sign(payload, env.jwtRefreshSecret, options);
  }

  private hashToken(token: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private getAccessTokenExpiry(): Date {
    const expiresIn = env.jwtAccessExpiresIn;
    // Parse time string like "15m", "1h", "7d"
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 15 * 60 * 1000); // default 15 min
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
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7 days
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
    if (!match) return 7 * 24 * 60 * 60; // 7 days
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
    if (!match) return 15 * 60; // 15 minutes
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
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictError("User with this email already exists");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user
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

    // If user is a student, create student profile
    if (user.role === "STUDENT") {
      await this.prisma.studentProfile.create({
        data: {
          userId: user.id,
        },
      });
    } else if (user.role === "PARENT") {
      await this.prisma.parentProfile.create({
        data: {
          userId: user.id,
        },
      });
    } else if (user.role === "TEACHER") {
      await this.prisma.teacherProfile.create({
        data: {
          userId: user.id,
        },
      });
    }

    // Create session and return tokens
    return this.createSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    // Find user
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

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create session and return tokens
    return this.createSession(user);
  }

  async createSession(user: User): Promise<AuthResponse> {
    const sessionId = uuidv4();

    // Generate tokens
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

    // Store session in database (hash the refresh token)
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
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, env.jwtRefreshSecret) as unknown as {
        userId: string;
        sessionId: string;
      };

      // Find session
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

      // Verify token hash
      if (session.tokenHash !== this.hashToken(refreshToken)) {
        throw new UnauthorizedError("Invalid session token");
      }

      // Find user
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedError("User not found or inactive");
      }

      // Revoke old session
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      // Create new session
      return this.createSession(user);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError("Invalid refresh token");
      }
      throw error;
    }
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    // Revoke the specific session
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
    // Revoke all sessions for the user
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
      // Verify access token
      const decoded = jwt.verify(token, env.jwtAccessSecret) as unknown as JwtPayload;

      // Find session
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

      // Find user
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