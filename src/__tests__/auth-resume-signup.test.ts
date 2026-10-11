import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import { ForbiddenError, ServiceUnavailableError } from "../utils/errors";
import { RegisterDto } from "../types/auth.types";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
  extractCode,
} from "../test-utils/fake-prisma";

const PASSWORD = "SecurePass@123";

const validDto: RegisterDto = {
  name: "Grace Hopper",
  email: "grace@example.com",
  password: PASSWORD,
  role: "STUDENT",
  acceptTerms: true,
};

describe("signup completion lifecycle", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let delivery: ReturnType<typeof createFakeDelivery>;
  let service: AuthService;

  const lastCode = () => extractCode(delivery.sent[delivery.sent.length - 1]);

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    delivery = createFakeDelivery();
    const otpService = new OtpService(fake as unknown as PrismaClient, delivery);
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
  });

  it("a signup is NOT complete until the OTP is verified", async () => {
    // Registration alone must not issue a session or mark the user verified.
    const reg = await service.register(validDto);
    expect(reg.user.isVerified).toBe(false);
    expect("accessToken" in reg).toBe(false);
    expect(db.sessions).toHaveLength(0);
    expect(db.users[0].isVerified).toBe(false);

    // An unverified account cannot log in.
    await expect(
      service.login({ email: validDto.email, password: PASSWORD })
    ).rejects.toThrow(ForbiddenError);
    expect(db.sessions).toHaveLength(0);

    // Only OTP verification completes the signup and issues the first session.
    const result = await service.verifyOtp({ email: validDto.email, code: lastCode() });
    expect(result.user.isVerified).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(db.users[0].isVerified).toBe(true);
    expect(db.sessions).toHaveLength(1);
  });
});

describe("resumeSignup (continue an incomplete signup)", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let delivery: ReturnType<typeof createFakeDelivery>;
  let service: AuthService;

  const lastCode = () => extractCode(delivery.sent[delivery.sent.length - 1]);

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    delivery = createFakeDelivery();
    const otpService = new OtpService(fake as unknown as PrismaClient, delivery);
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
  });

  it("re-issues the OTP and returns a verification challenge to resume", async () => {
    // Start a signup, then "leave" before verifying.
    await service.register(validDto);
    expect(db.sessions).toHaveLength(0);
    const firstDeliveryCount = delivery.sent.length;

    // Simulate the user returning after the resend cooldown has elapsed by
    // back-dating the active challenge. This is the realistic "came back
    // later" path where resume must issue a fresh code.
    db.otps[0].createdAt = new Date(Date.now() - (env.otpResendCooldownSeconds + 5) * 1000);

    // Come back and resume — a new code is sent.
    const verification = await service.resumeSignup({ email: validDto.email });

    expect(verification.destination).toBe("g***@example.com");
    expect(verification.expiresInSeconds).toBeGreaterThan(0);
    expect(verification.resendCooldownSeconds).toBe(env.otpResendCooldownSeconds);
    expect(delivery.sent.length).toBe(firstDeliveryCount + 1);

    // The user can complete signup with the newly issued code.
    const result = await service.verifyOtp({ email: validDto.email, code: lastCode() });
    expect(result.user.isVerified).toBe(true);
    expect(db.sessions).toHaveLength(1);
  });

  it("never returns the user object or any tokens (signup stays incomplete)", async () => {
    await service.register(validDto);
    const verification = await service.resumeSignup({ email: validDto.email });

    // Only verification metadata — no user, no tokens.
    expect(Object.keys(verification).sort()).toEqual([
      "destination",
      "expiresInSeconds",
      "resendCooldownSeconds",
    ]);
    expect(db.sessions).toHaveLength(0);
  });

  it("is enumeration-safe: identical response shape whether or not a signup exists", async () => {
    // No pending account for this email.
    const unknown = await service.resumeSignup({ email: "nobody@example.com" });
    expect(delivery.sent).toHaveLength(0); // nothing was actually sent

    // A pending (unverified) account exists.
    await service.register(validDto);
    delivery.sent.length = 0; // ignore the registration send
    const pending = await service.resumeSignup({ email: validDto.email });

    // Both responses expose the same fields (no account-existence signal).
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(pending).sort());
    expect(unknown.destination).toBe("n***@example.com");
  });

  it("does not resume an already-verified account", async () => {
    await service.register(validDto);
    await service.verifyOtp({ email: validDto.email, code: lastCode() });
    delivery.sent.length = 0;
    db.otps.length = 0; // clear consumed challenge

    const verification = await service.resumeSignup({ email: validDto.email });

    // No new code is sent for an already-verified account.
    expect(delivery.sent).toHaveLength(0);
    expect(db.sessions).toHaveLength(1); // unchanged — no extra session issued
    expect(verification.destination).toBe("g***@example.com");
  });

  it("respects the resend cooldown (silently, without leaking account state)", async () => {
    await service.register(validDto);
    delivery.sent.length = 0;

    // Immediately resuming is within the cooldown window.
    const verification = await service.resumeSignup({ email: validDto.email });
    expect(delivery.sent).toHaveLength(0); // cooldown suppressed the send
    expect(verification.resendCooldownSeconds).toBe(env.otpResendCooldownSeconds);
    expect(verification.expiresInSeconds).toBeGreaterThan(0);
  });

  it("fails fast with 503 when no delivery provider is configured", async () => {
    const original = env.emailDeliveryProvider;
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = "none";
    try {
      await expect(service.resumeSignup({ email: validDto.email })).rejects.toThrow(
        ServiceUnavailableError
      );
    } finally {
      (env as { emailDeliveryProvider: string }).emailDeliveryProvider = original;
    }
  });

  it("does not resume a social (Google) account via the email OTP path", async () => {
    // A GOOGLE account has no password; the OTP resume path must not act on it.
    await fake.user.create({
      data: {
        firstName: "Ada",
        email: "ada@example.com",
        authProvider: "GOOGLE",
        isVerified: true,
      },
    });
    const verification = await service.resumeSignup({ email: "ada@example.com" });
    expect(delivery.sent).toHaveLength(0);
    expect(verification.destination).toBe("a***@example.com");
  });
});

