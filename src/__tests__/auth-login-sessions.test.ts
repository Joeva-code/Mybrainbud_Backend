import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
} from "../test-utils/fake-prisma";

const PASSWORD = "SecurePass@123";

describe("login, sessions, refresh, and logout", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let service: AuthService;

  const seedUser = async (
    overrides: Partial<{ email: string; isVerified: boolean; isActive: boolean; role: string }> = {}
  ) => {
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    return fake.user.create({
      data: {
        firstName: "Jane",
        lastName: "Doe",
        email: overrides.email ?? "jane@example.com",
        passwordHash,
        role: overrides.role ?? "STUDENT",
        authProvider: "EMAIL",
        isVerified: overrides.isVerified ?? true,
        isActive: overrides.isActive ?? true,
      },
    });
  };

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    const otpService = new OtpService(fake as unknown as PrismaClient, createFakeDelivery());
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
  });

  describe("login", () => {
    it("logs in with valid credentials and issues a session", async () => {
      const user = await seedUser();
      const result = await service.login({ email: "jane@example.com", password: PASSWORD });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.id).toBe(user.id);
      expect(db.users[0].lastLoginAt).toBeInstanceOf(Date);
      expect(db.sessions).toHaveLength(1);
    });

    it("finds accounts case-insensitively", async () => {
      await seedUser({ email: "Jane.Doe@Example.com" });
      const result = await service.login({ email: "jane.doe@example.com", password: PASSWORD });
      expect(result.user.email).toBe("Jane.Doe@Example.com");
    });

    it("rejects an unknown email and a wrong password with the same message", async () => {
      await seedUser();
      const unknown = await service
        .login({ email: "nobody@example.com", password: PASSWORD })
        .catch((e: Error) => e);
      const wrong = await service
        .login({ email: "jane@example.com", password: "WrongPass@123" })
        .catch((e: Error) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedError);
      expect(wrong).toBeInstanceOf(UnauthorizedError);
      expect((unknown as Error).message).toBe((wrong as Error).message);
      expect(db.sessions).toHaveLength(0);
    });

    it("blocks unverified accounts with 403 semantics", async () => {
      await seedUser({ isVerified: false });
      await expect(
        service.login({ email: "jane@example.com", password: PASSWORD })
      ).rejects.toThrow(ForbiddenError);
      expect(db.sessions).toHaveLength(0);
    });

    it("blocks inactive accounts", async () => {
      await seedUser({ isActive: false });
      await expect(
        service.login({ email: "jane@example.com", password: PASSWORD })
      ).rejects.toThrow("Account is inactive. Please contact support.");
    });

    it("rejects password login for social-only accounts", async () => {
      await fake.user.create({
        data: {
          firstName: "Sam",
          email: "sam@example.com",
          passwordHash: null,
          authProvider: "GOOGLE",
          isVerified: true,
        },
      });
      await expect(
        service.login({ email: "sam@example.com", password: PASSWORD })
      ).rejects.toThrow("Please login using your social account");
    });
  });

  describe("validateSession (access tokens)", () => {
    it("accepts a valid access token", async () => {
      await seedUser();
      const { accessToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      const { user, sessionId } = await service.validateSession(accessToken);
      expect(user.email).toBe("jane@example.com");
      expect(sessionId).toBeDefined();
    });

    it("rejects an expired access token", async () => {
      const user = await seedUser();
      const expired = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          sessionId: "any-session",
        },
        env.jwtAccessSecret,
        { expiresIn: "-1s" }
      );
      await expect(service.validateSession(expired)).rejects.toThrow(
        "Access token has expired"
      );
    });

    it("rejects a token signed with the wrong secret", async () => {
      const user = await seedUser();
      const forged = jwt.sign(
        { userId: user.id, email: user.email, role: user.role, sessionId: "x" },
        "not-the-real-secret"
      );
      await expect(service.validateSession(forged)).rejects.toThrow("Invalid access token");
    });

    it("rejects revoked sessions", async () => {
      await seedUser();
      const { accessToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      db.sessions.forEach((s) => (s.revokedAt = new Date()));
      await expect(service.validateSession(accessToken)).rejects.toThrow(
        "Session has been revoked"
      );
    });

    it("rejects expired session rows", async () => {
      await seedUser();
      const { accessToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      db.sessions[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.validateSession(accessToken)).rejects.toThrow(
        "Session has expired"
      );
    });
  });

  describe("refreshToken", () => {
    it("rotates the refresh token and revokes the old session", async () => {
      await seedUser();
      const { refreshToken: oldToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      const oldSessionId = db.sessions[0].id;

      const refreshed = await service.refreshToken(oldToken);

      expect(refreshed.refreshToken).not.toBe(oldToken);
      expect(db.sessions).toHaveLength(2);
      expect(db.sessions.find((s) => s.id === oldSessionId)?.revokedAt).not.toBeNull();
      expect(db.sessions[1].revokedAt).toBeNull();
    });

    it("rejects replay of a rotated (revoked) refresh token", async () => {
      await seedUser();
      const { refreshToken: oldToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      await service.refreshToken(oldToken);
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedError);
    });

    it("rejects a refresh token signed with the wrong secret", async () => {
      await seedUser();
      const forged = jwt.sign(
        { userId: db.users[0].id, sessionId: "nope" },
        "not-the-real-secret"
      );
      await expect(service.refreshToken(forged)).rejects.toThrow("Invalid refresh token");
    });

    it("rejects refresh for an expired session row", async () => {
      await seedUser();
      const { refreshToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      db.sessions[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        "Session has expired"
      );
    });

    it("rejects refresh when the stored token hash does not match", async () => {
      await seedUser();
      const { refreshToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      db.sessions[0].tokenHash = "deadbeef";
      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        "Invalid session token"
      );
    });

    it("rejects refresh for inactive users", async () => {
      const user = await seedUser();
      const { refreshToken } = await service.login({
        email: "jane@example.com",
        password: PASSWORD,
      });
      user.isActive = false;
      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        "User not found or inactive"
      );
    });
  });

  describe("logout", () => {
    it("revokes only the current session", async () => {
      await seedUser();
      const first = await service.login({ email: "jane@example.com", password: PASSWORD });
      const second = await service.login({ email: "jane@example.com", password: PASSWORD });

      await service.logout(db.sessions[0].id, db.users[0].id);

      expect(db.sessions.filter((s) => s.revokedAt !== null)).toHaveLength(1);
      await expect(service.validateSession(first.accessToken)).rejects.toThrow(
        UnauthorizedError
      );
      await expect(service.validateSession(second.accessToken)).resolves.toBeDefined();
    });

    it("rejects logout for a session owned by another user", async () => {
      await seedUser();
      await service.login({ email: "jane@example.com", password: PASSWORD });
      await expect(service.logout(db.sessions[0].id, "someone-else")).rejects.toThrow(
        UnauthorizedError
      );
    });

    it("rejects logout for an unknown session", async () => {
      await expect(service.logout("missing-session", "user")).rejects.toThrow(
        NotFoundError
      );
    });

    it("logout-all revokes every session for the user", async () => {
      await seedUser();
      const a = await service.login({ email: "jane@example.com", password: PASSWORD });
      const b = await service.login({ email: "jane@example.com", password: PASSWORD });

      await service.logoutAll(db.users[0].id);

      expect(db.sessions.every((s) => s.revokedAt !== null)).toBe(true);
      await expect(service.validateSession(a.accessToken)).rejects.toThrow(
        UnauthorizedError
      );
      await expect(service.validateSession(b.accessToken)).rejects.toThrow(
        UnauthorizedError
      );
    });
  });
});
