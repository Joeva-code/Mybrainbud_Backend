import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import {
  ConflictError,
  ServiceUnavailableError,
} from "../utils/errors";
import { RegisterDto } from "../types/auth.types";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
  extractCode,
} from "../test-utils/fake-prisma";

const validDto: RegisterDto = {
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@example.com",
  password: "SecurePass@123",
  role: "STUDENT",
  acceptTerms: true,
};

describe("AuthService.register", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let delivery: ReturnType<typeof createFakeDelivery>;
  let service: AuthService;

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    delivery = createFakeDelivery();
    const otpService = new OtpService(fake as unknown as PrismaClient, delivery);
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
  });

  it("creates an unverified account with profile, OTP challenge, and NO tokens", async () => {
    const result = await service.register(validDto);

    expect(result.user.email).toBe("john.doe@example.com");
    expect(result.user.isVerified).toBe(false);
    expect(result.user.role).toBe("STUDENT");
    // Registration must not issue a session before contact verification.
    expect("accessToken" in result).toBe(false);
    expect("refreshToken" in result).toBe(false);
    expect(db.sessions).toHaveLength(0);

    expect(result.verification.destination).toBe("j***@example.com");
    expect(result.verification.expiresInSeconds).toBeGreaterThan(0);
    expect(result.verification.resendCooldownSeconds).toBe(env.otpResendCooldownSeconds);

    expect(db.users).toHaveLength(1);
    expect(db.profiles).toEqual([{ userId: db.users[0].id, kind: "STUDENT" }]);
    expect(db.otps).toHaveLength(1);
    expect(delivery.sent).toHaveLength(1);

    // The stored value must be a hash, never the plaintext code.
    const code = extractCode(delivery.sent[0]);
    expect(db.otps[0].codeHash).not.toContain(code);
    expect(db.otps[0].destination).toBe("john.doe@example.com");
    expect(db.otps[0].purpose).toBe("REGISTRATION");
  });

  it("creates the correct profile for each allowed role", async () => {
    await service.register({ ...validDto, email: "p@x.com", role: "PARENT" });
    await service.register({ ...validDto, email: "t@x.com", role: "TEACHER" });
    expect(db.profiles.map((p) => p.kind).sort()).toEqual(["PARENT", "TEACHER"]);
  });

  it("normalizes the email address", async () => {
    const result = await service.register({
      ...validDto,
      email: "John.Doe@Example.COM",
    });
    expect(result.user.email).toBe("john.doe@example.com");
    expect(db.users[0].email).toBe("john.doe@example.com");
  });

  it("rejects duplicate accounts case-insensitively", async () => {
    await service.register(validDto);
    await expect(
      service.register({ ...validDto, email: "JOHN.DOE@EXAMPLE.COM" })
    ).rejects.toThrow(ConflictError);
    expect(db.users).toHaveLength(1);
  });

  it("maps unique-constraint races to a conflict", async () => {
    db.throwUniqueOnUserCreate = true;
    await expect(service.register(validDto)).rejects.toThrow(ConflictError);
  });

  it("propagates database transaction failures without creating records", async () => {
    db.failTransaction = true;
    await expect(service.register(validDto)).rejects.toThrow("Transaction failed");
    expect(db.users).toHaveLength(0);
    expect(delivery.sent).toHaveLength(0);
  });

  it("cleans up the account when verification delivery fails", async () => {
    delivery.failNext = true;
    await expect(service.register(validDto)).rejects.toThrow(ServiceUnavailableError);
    // No orphaned user, profile, or challenge may remain.
    expect(db.users).toHaveLength(0);
    expect(db.profiles).toHaveLength(0);
    expect(db.otps).toHaveLength(0);
    expect(db.sessions).toHaveLength(0);
  });

  it("fails fast with 503 when no delivery provider is configured", async () => {
    const original = env.emailDeliveryProvider;
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = "none";
    try {
      await expect(service.register(validDto)).rejects.toThrow(ServiceUnavailableError);
      expect(db.users).toHaveLength(0); // failed before any database write
      expect(delivery.sent).toHaveLength(0);
    } finally {
      (env as { emailDeliveryProvider: string }).emailDeliveryProvider = original;
    }
  });
});
