import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import {
  pickGoogleProfile,
  verifyGoogleIdToken,
  GoogleVerifiedProfile,
} from "../services/google-auth.service";
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../utils/errors";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
} from "../test-utils/fake-prisma";

const profile: GoogleVerifiedProfile = {
  sub: "google-sub-123",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
};

describe("Google sign-in", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let service: AuthService;
  let verifyMock: jest.Mock;

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    verifyMock = jest.fn().mockResolvedValue(profile);
    const otpService = new OtpService(fake as unknown as PrismaClient, createFakeDelivery());
    service = new AuthService(fake as unknown as PrismaClient, {
      otpService,
      verifyGoogleIdToken: verifyMock,
    });
  });

  it("creates a verified account, profile, and session on first-time sign-in", async () => {
    const result = await service.googleAuth({ credential: "valid-id-token" });

    expect(result.accessToken).toBeDefined();
    expect(result.user.email).toBe("ada@example.com");
    expect(result.user.isVerified).toBe(true);
    expect(db.users).toHaveLength(1);
    expect(db.users[0].authProvider).toBe("GOOGLE");
    expect(db.users[0].passwordHash).toBeNull();
    expect(db.profiles).toEqual([{ userId: db.users[0].id, kind: "STUDENT" }]);
    expect(db.sessions).toHaveLength(1);
    expect(verifyMock).toHaveBeenCalledWith("valid-id-token");
  });

  it("signs in an existing Google account without creating a duplicate", async () => {
    await fake.user.create({
      data: {
        firstName: "Ada",
        email: "ada@example.com",
        authProvider: "GOOGLE",
        isVerified: true,
      },
    });

    const result = await service.googleAuth({ credential: "valid-id-token" });

    expect(result.accessToken).toBeDefined();
    expect(db.users).toHaveLength(1);
    expect(db.sessions).toHaveLength(1);
    expect(db.users[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it("refuses to take over an existing password-based account", async () => {
    await fake.user.create({
      data: {
        firstName: "Ada",
        email: "ada@example.com",
        passwordHash: "some-hash",
        authProvider: "EMAIL",
        isVerified: true,
      },
    });

    await expect(service.googleAuth({ credential: "valid-id-token" })).rejects.toThrow(
      ForbiddenError
    );
    expect(db.sessions).toHaveLength(0); // no session was issued
  });

  it("propagates ID token verification failures as 401", async () => {
    verifyMock.mockRejectedValue(new UnauthorizedError("Invalid Google credentials"));
    await expect(service.googleAuth({ credential: "bad-token" })).rejects.toThrow(
      UnauthorizedError
    );
    expect(db.users).toHaveLength(0);
    expect(db.sessions).toHaveLength(0);
  });

  it("blocks inactive existing Google accounts", async () => {
    await fake.user.create({
      data: {
        firstName: "Ada",
        email: "ada@example.com",
        authProvider: "GOOGLE",
        isVerified: true,
        isActive: false,
      },
    });
    await expect(service.googleAuth({ credential: "valid-id-token" })).rejects.toThrow(
      "Account is inactive"
    );
  });

  it("maps provisioning races to a conflict", async () => {
    db.throwUniqueOnUserCreate = true;
    await expect(service.googleAuth({ credential: "valid-id-token" })).rejects.toThrow(
      ConflictError
    );
  });
});

describe("pickGoogleProfile (claim validation)", () => {
  it("accepts a verified email payload", () => {
    const result = pickGoogleProfile({
      sub: "abc",
      email: "User@Example.COM",
      email_verified: true,
      given_name: "User",
      family_name: "Example",
    });
    expect(result.email).toBe("user@example.com");
    expect(result.firstName).toBe("User");
    expect(result.lastName).toBe("Example");
  });

  it("rejects unverified emails", () => {
    expect(() =>
      pickGoogleProfile({ email: "a@b.com", email_verified: false })
    ).toThrow(UnauthorizedError);
  });

  it("rejects payloads without an email", () => {
    expect(() => pickGoogleProfile({ email_verified: true })).toThrow(UnauthorizedError);
    expect(() => pickGoogleProfile(undefined)).toThrow(UnauthorizedError);
  });

  it("falls back gracefully for missing names", () => {
    const result = pickGoogleProfile({ email: "a@b.com", email_verified: true });
    expect(result.firstName).toBe("User");
    expect(result.lastName).toBeUndefined();
  });
});

describe("verifyGoogleIdToken configuration", () => {
  it("fails safely with 503 when GOOGLE_CLIENT_ID is not configured", async () => {
    const original = env.googleClientId;
    (env as { googleClientId?: string }).googleClientId = undefined;
    try {
      await expect(verifyGoogleIdToken("some-token")).rejects.toThrow(
        ServiceUnavailableError
      );
    } finally {
      (env as { googleClientId?: string }).googleClientId = original;
    }
  });
});
