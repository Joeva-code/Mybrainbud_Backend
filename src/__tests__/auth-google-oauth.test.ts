import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { env } from "../config/env";
import {
  createGoogleOAuthClient,
  getGoogleAuthorizationUrl,
  GoogleVerifiedProfile,
} from "../services/google-auth.service";
import {
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
  sub: "google-sub-xyz",
  email: "grace@example.com",
  firstName: "Grace",
  lastName: "Hopper",
};

/**
 * Google OAuth 2.0 redirect (authorization-code) flow — service layer.
 *
 * The service is exercised through an injected `exchangeGoogleCode` so the
 * tests never reach Google; the shared provisioning logic is identical to the
 * ID-token flow and is covered end-to-end in auth-google.test.ts.
 */
describe("Google OAuth 2.0 redirect sign-in", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let service: AuthService;
  let exchangeMock: jest.Mock;

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    exchangeMock = jest.fn().mockResolvedValue(profile);
    const otpService = new OtpService(fake as unknown as PrismaClient, createFakeDelivery());
    service = new AuthService(fake as unknown as PrismaClient, {
      otpService,
      exchangeGoogleCode: exchangeMock,
    });
  });

  it("exchanges the code and provisions a verified account + session", async () => {
    const result = await service.googleOAuth("auth-code-123");

    expect(exchangeMock).toHaveBeenCalledWith("auth-code-123");
    expect(result.accessToken).toBeDefined();
    expect(result.user.email).toBe("grace@example.com");
    expect(result.user.isVerified).toBe(true);
    expect(db.users).toHaveLength(1);
    expect(db.users[0].authProvider).toBe("GOOGLE");
    expect(db.users[0].passwordHash).toBeNull();
    expect(db.profiles).toEqual([{ userId: db.users[0].id, kind: "STUDENT" }]);
    expect(db.sessions).toHaveLength(1);
  });

  it("signs in an existing Google account without creating a duplicate", async () => {
    await fake.user.create({
      data: {
        firstName: "Grace",
        email: "grace@example.com",
        authProvider: "GOOGLE",
        isVerified: true,
      },
    });

    const result = await service.googleOAuth("auth-code-123");

    expect(result.accessToken).toBeDefined();
    expect(db.users).toHaveLength(1);
    expect(db.sessions).toHaveLength(1);
    expect(db.users[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it("refuses to take over an existing password-based account", async () => {
    await fake.user.create({
      data: {
        firstName: "Grace",
        email: "grace@example.com",
        passwordHash: "some-hash",
        authProvider: "EMAIL",
        isVerified: true,
      },
    });

    await expect(service.googleOAuth("auth-code-123")).rejects.toThrow(ForbiddenError);
    expect(db.sessions).toHaveLength(0);
  });

  it("propagates code-exchange failures as 401 without side effects", async () => {
    exchangeMock.mockRejectedValue(new UnauthorizedError("Invalid Google authorization code"));
    await expect(service.googleOAuth("bad-code")).rejects.toThrow(UnauthorizedError);
    expect(db.users).toHaveLength(0);
    expect(db.sessions).toHaveLength(0);
  });

  it("maps provisioning races to a conflict", async () => {
    db.throwUniqueOnUserCreate = true;
    await expect(service.googleOAuth("auth-code-123")).rejects.toThrow(
      "User with this email already exists"
    );
  });
});

describe("Google OAuth client configuration", () => {
  const original = {
    id: env.googleClientId,
    secret: env.googleClientSecret,
    callback: env.googleCallbackUrl,
  };

  afterEach(() => {
    (env as { googleClientId?: string }).googleClientId = original.id;
    (env as { googleClientSecret?: string }).googleClientSecret = original.secret;
    (env as { googleCallbackUrl?: string }).googleCallbackUrl = original.callback;
  });

  it("fails safely with 503 when Google OAuth credentials are missing", () => {
    (env as { googleClientId?: string }).googleClientId = undefined;
    (env as { googleClientSecret?: string }).googleClientSecret = undefined;
    (env as { googleCallbackUrl?: string }).googleCallbackUrl = undefined;
    expect(() => createGoogleOAuthClient()).toThrow(ServiceUnavailableError);
  });

  it("builds a consent URL carrying the client id, callback, scopes, and state", () => {
    (env as { googleClientId?: string }).googleClientId = "test-client-id.apps.googleusercontent.com";
    (env as { googleClientSecret?: string }).googleClientSecret = "test-secret";
    (env as { googleCallbackUrl?: string }).googleCallbackUrl =
      "https://api.example.com/api/auth/google/callback";

    const url = getGoogleAuthorizationUrl("state-token");

    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(url).toContain("client_id=test-client-id.apps.googleusercontent.com");
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent("https://api.example.com/api/auth/google/callback")}`
    );
    expect(url).toContain("state=state-token");
    expect(url).toContain("scope=openid");
    expect(url).toContain("prompt=select_account");
  });
});
