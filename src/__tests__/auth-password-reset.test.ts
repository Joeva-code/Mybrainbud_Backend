import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PasswordResetService, hashResetToken } from "../services/password-reset.service";
import { env } from "../config/env";
import { BadRequestError, ServiceUnavailableError } from "../utils/errors";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
  extractResetToken,
} from "../test-utils/fake-prisma";

describe("password reset", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let delivery: ReturnType<typeof createFakeDelivery>;
  let service: PasswordResetService;

  const seedUser = async () => {
    const passwordHash = await bcrypt.hash("OldPass@123", 12);
    return fake.user.create({
      data: {
        firstName: "Jane",
        email: "jane@example.com",
        passwordHash,
        authProvider: "EMAIL",
        isVerified: true,
      },
    });
  };

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    delivery = createFakeDelivery();
    service = new PasswordResetService(fake as unknown as PrismaClient, delivery);
  });

  it("returns a generic response and sends nothing for unknown accounts", async () => {
    await expect(service.requestReset("nobody@example.com")).resolves.toBeUndefined();
    expect(db.resets).toHaveLength(0);
    expect(delivery.sent).toHaveLength(0);
  });

  it("stores only a hash of the reset token and delivers it once", async () => {
    const user = await seedUser();
    await service.requestReset("jane@example.com");

    expect(db.resets).toHaveLength(1);
    expect(db.resets[0].userId).toBe(user.id);
    expect(delivery.sent).toHaveLength(1);

    const token = extractResetToken(delivery.sent[0]);
    expect(token).toHaveLength(64); // 256-bit random value
    expect(db.resets[0].tokenHash).not.toBe(token);
    expect(db.resets[0].tokenHash).toBe(hashResetToken(token));
    expect(db.resets[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("resets the password, marks the token used, and revokes all sessions", async () => {
    const user = await seedUser();
    await service.requestReset("jane@example.com");
    const token = extractResetToken(delivery.sent[0]);

    // Seed two active sessions.
    db.sessions.push(
      {
        id: "s1",
        userId: user.id,
        tokenHash: "h1",
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
        revokedAt: null,
      },
      {
        id: "s2",
        userId: user.id,
        tokenHash: "h2",
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
        revokedAt: null,
      }
    );

    await service.resetPassword({ token, password: "NewPass@123" });

    const updated = db.users[0];
    expect(await bcrypt.compare("NewPass@123", updated.passwordHash!)).toBe(true);
    expect(await bcrypt.compare("OldPass@123", updated.passwordHash!)).toBe(false);
    expect(db.resets[0].usedAt).toBeInstanceOf(Date);
    expect(db.sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it("rejects an invalid token with a generic message", async () => {
    await seedUser();
    await expect(
      service.resetPassword({ token: "a".repeat(64), password: "NewPass@123" })
    ).rejects.toThrow(BadRequestError);
    expect(db.users[0].passwordHash).toBeDefined();
  });

  it("rejects a reused token", async () => {
    await seedUser();
    await service.requestReset("jane@example.com");
    const token = extractResetToken(delivery.sent[0]);

    await service.resetPassword({ token, password: "NewPass@123" });
    await expect(
      service.resetPassword({ token, password: "Another@123" })
    ).rejects.toThrow("Invalid or expired reset token.");
    // The original reset must remain in effect.
    expect(await bcrypt.compare("NewPass@123", db.users[0].passwordHash!)).toBe(true);
  });

  it("rejects an expired token", async () => {
    await seedUser();
    await service.requestReset("jane@example.com");
    const token = extractResetToken(delivery.sent[0]);
    db.resets[0].expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.resetPassword({ token, password: "NewPass@123" })
    ).rejects.toThrow("Invalid or expired reset token.");
  });

  it("fails safely with the same 503 for known and unknown accounts when delivery is unconfigured", async () => {
    const original = env.emailDeliveryProvider;
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = "none";
    try {
      await expect(service.requestReset("unknown@example.com")).rejects.toThrow(
        ServiceUnavailableError
      );
      await seedUser();
      await expect(service.requestReset("jane@example.com")).rejects.toThrow(
        ServiceUnavailableError
      );
      expect(db.resets).toHaveLength(0); // nothing written when delivery is unavailable
    } finally {
      (env as { emailDeliveryProvider: string }).emailDeliveryProvider = original;
    }
  });

  it("keeps the generic response even when a delivery attempt fails", async () => {
    await seedUser();
    delivery.failNext = true;
    // Transient failures must not change the outward response (enumeration safety).
    await expect(service.requestReset("jane@example.com")).resolves.toBeUndefined();
    expect(delivery.sent).toHaveLength(0);
  });
});
