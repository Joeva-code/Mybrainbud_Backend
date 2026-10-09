import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import { AuthConstants } from "../constants";
import { UnauthorizedError } from "../utils/errors";
import { RegisterDto } from "../types/auth.types";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
  extractCode,
} from "../test-utils/fake-prisma";

const dto: RegisterDto = {
  firstName: "Ada",
  email: "ada@example.com",
  password: "SecurePass@123",
  role: "STUDENT",
  acceptTerms: true,
};

describe("OTP verification and resend", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let delivery: ReturnType<typeof createFakeDelivery>;
  let service: AuthService;

  const lastCode = () => extractCode(delivery.sent[delivery.sent.length - 1]);

  beforeEach(async () => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    delivery = createFakeDelivery();
    const otpService = new OtpService(fake as unknown as PrismaClient, delivery);
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
    await service.register(dto);
  });

  it("verifies the correct code, marks the user verified, and issues a session", async () => {
    const result = await service.verifyOtp({ email: dto.email, code: lastCode() });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.isVerified).toBe(true);
    expect(db.users[0].isVerified).toBe(true);
    expect(db.sessions).toHaveLength(1);
    expect(db.otps[0].verifiedAt).not.toBeNull();
    expect(db.otps[0].attempts).toBe(1);
  });

  it("rejects an incorrect code with a generic error", async () => {
    const wrong = lastCode() === "0000" ? "1111" : "0000";
    await expect(
      service.verifyOtp({ email: dto.email, code: wrong })
    ).rejects.toThrow(AuthConstants.OTP_INVALID_MESSAGE);
    expect(db.users[0].isVerified).toBe(false);
    expect(db.sessions).toHaveLength(0);
    expect(db.otps[0].attempts).toBe(1);
  });

  it("rejects an expired code", async () => {
    db.otps[0].expiresAt = new Date(Date.now() - 1000);
    await expect(
      service.verifyOtp({ email: dto.email, code: lastCode() })
    ).rejects.toThrow(UnauthorizedError);
    expect(db.users[0].isVerified).toBe(false);
    expect(db.otps[0].attempts).toBe(0); // expired codes are not even claimed
  });

  it("rejects a reused code after successful verification", async () => {
    const code = lastCode();
    await service.verifyOtp({ email: dto.email, code });
    await expect(service.verifyOtp({ email: dto.email, code })).rejects.toThrow(
      AuthConstants.OTP_INVALID_MESSAGE
    );
    expect(db.sessions).toHaveLength(1); // no extra session was issued
  });

  it("enforces the attempt limit — correct code fails after exhaustion", async () => {
    const correct = lastCode();
    const wrong = correct === "0000" ? "1111" : "0000";
    for (let i = 0; i < env.otpMaxAttempts; i++) {
      await expect(
        service.verifyOtp({ email: dto.email, code: wrong })
      ).rejects.toThrow(AuthConstants.OTP_INVALID_MESSAGE);
    }
    expect(db.otps[0].attempts).toBe(env.otpMaxAttempts);
    // Even the correct code must now be rejected.
    await expect(service.verifyOtp({ email: dto.email, code: correct })).rejects.toThrow(
      AuthConstants.OTP_INVALID_MESSAGE
    );
    expect(db.users[0].isVerified).toBe(false);
  });

  it("rejects verification when there is no active challenge", async () => {
    await expect(
      service.verifyOtp({ email: "stranger@example.com", code: "1234" })
    ).rejects.toThrow(AuthConstants.OTP_INVALID_MESSAGE);
  });

  it("rejects a code issued to a different destination", async () => {
    await service.register({ ...dto, email: "other@example.com" });
    const otherCode = lastCode();
    await expect(
      service.verifyOtp({ email: dto.email, code: otherCode })
    ).rejects.toThrow(AuthConstants.OTP_INVALID_MESSAGE);
  });

  it("handles concurrent verification — only one request can consume the code", async () => {
    const code = lastCode();
    const original = fake.otpVerification.updateMany;
    let calls = 0;
    fake.otpVerification.updateMany = (async (args: Parameters<typeof original>[0]) => {
      calls += 1;
      // Simulate losing the consume race to a concurrent request.
      if (calls === 2) return { count: 0 };
      return original(args);
    }) as typeof fake.otpVerification.updateMany;

    await expect(service.verifyOtp({ email: dto.email, code })).rejects.toThrow(
      AuthConstants.OTP_INVALID_MESSAGE
    );
    expect(db.users[0].isVerified).toBe(false);
    expect(db.sessions).toHaveLength(0);
  });

  it("silently enforces the resend cooldown (no new code issued)", async () => {
    const before = delivery.sent.length;
    const result = await service.resendOtp({ email: dto.email });
    expect(result.cooldownSeconds).toBe(env.otpResendCooldownSeconds);
    expect(delivery.sent).toHaveLength(before); // nothing sent during cooldown
    expect(db.otps).toHaveLength(1);
  });

  it("supersedes the previous code once the cooldown has passed", async () => {
    const oldCode = lastCode();
    db.otps[0].createdAt = new Date(Date.now() - (env.otpResendCooldownSeconds + 1) * 1000);

    await service.resendOtp({ email: dto.email });
    expect(delivery.sent).toHaveLength(2);
    expect(db.otps).toHaveLength(1); // old active code was deleted

    // The invalidated old code must fail, the new code must work.
    await expect(service.verifyOtp({ email: dto.email, code: oldCode })).rejects.toThrow(
      AuthConstants.OTP_INVALID_MESSAGE
    );
    await service.verifyOtp({ email: dto.email, code: lastCode() });
    expect(db.users[0].isVerified).toBe(true);
  });

  it("returns a generic response for unknown accounts and sends nothing", async () => {
    const result = await service.resendOtp({ email: "nobody@example.com" });
    expect(result.cooldownSeconds).toBe(env.otpResendCooldownSeconds);
    expect(delivery.sent).toHaveLength(1); // unchanged — only the registration send
  });

  it("does not resend to already verified accounts", async () => {
    await service.verifyOtp({ email: dto.email, code: lastCode() });
    db.otps[0].createdAt = new Date(Date.now() - (env.otpResendCooldownSeconds + 1) * 1000);
    const before = delivery.sent.length;
    await service.resendOtp({ email: dto.email });
    expect(delivery.sent).toHaveLength(before);
  });

  it("enforces the hourly resend cap", async () => {
    // Backdate the current challenge beyond the cooldown, then fill the
    // hourly window with recent challenges so the cap blocks delivery.
    db.otps[0].createdAt = new Date(Date.now() - (env.otpResendCooldownSeconds + 1) * 1000);
    for (let i = 0; i < env.otpMaxResendsPerHour; i++) {
      db.otps.push({ ...db.otps[0], id: `filler-${i}`, createdAt: new Date() });
    }
    const before = delivery.sent.length;
    await service.resendOtp({ email: dto.email });
    expect(delivery.sent).toHaveLength(before);
  });
});
