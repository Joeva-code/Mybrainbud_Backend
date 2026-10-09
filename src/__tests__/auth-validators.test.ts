import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  verifyOtpSchema,
  googleAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  emailSchema,
} from "../validators/auth.validator";

const validRegister = {
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@example.com",
  password: "SecurePass@123",
  acceptTerms: true,
};

describe("auth validators", () => {
  describe("registerSchema", () => {
    it("accepts a valid registration payload", () => {
      const parsed = registerSchema.parse(validRegister);
      expect(parsed.role).toBe("STUDENT"); // default role
    });

    it("rejects missing first name", () => {
      const result = registerSchema.safeParse({ ...validRegister, firstName: "" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = registerSchema.safeParse({ ...validRegister, email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects weak passwords", () => {
      expect(registerSchema.safeParse({ ...validRegister, password: "short1!A" }).success).toBe(true);
      expect(registerSchema.safeParse({ ...validRegister, password: "alllowercase1!" }).success).toBe(false);
      expect(registerSchema.safeParse({ ...validRegister, password: "ALLUPPERCASE1!" }).success).toBe(false);
      expect(registerSchema.safeParse({ ...validRegister, password: "NoDigits!!" }).success).toBe(false);
      expect(registerSchema.safeParse({ ...validRegister, password: "NoSpecial123" }).success).toBe(false);
      expect(registerSchema.safeParse({ ...validRegister, password: "Ab1!" }).success).toBe(false);
    });

    it("requires the terms to be accepted", () => {
      expect(registerSchema.safeParse({ ...validRegister, acceptTerms: false }).success).toBe(false);
      const without = { ...validRegister } as Record<string, unknown>;
      delete without.acceptTerms;
      expect(registerSchema.safeParse(without).success).toBe(false);
    });

    it("rejects privileged roles for public registration", () => {
      expect(registerSchema.safeParse({ ...validRegister, role: "ADMIN" }).success).toBe(false);
      expect(registerSchema.safeParse({ ...validRegister, role: "SCHOOL_ADMIN" }).success).toBe(false);
    });

    it("allows non-privileged roles", () => {
      expect(registerSchema.safeParse({ ...validRegister, role: "PARENT" }).success).toBe(true);
      expect(registerSchema.safeParse({ ...validRegister, role: "TEACHER" }).success).toBe(true);
    });
  });

  describe("loginSchema", () => {
    it("accepts valid credentials", () => {
      expect(
        loginSchema.safeParse({ email: "a@b.com", password: "x" }).success
      ).toBe(true);
    });

    it("rejects invalid email or empty password", () => {
      expect(loginSchema.safeParse({ email: "bad", password: "x" }).success).toBe(false);
      expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    });
  });

  describe("refreshTokenSchema", () => {
    it("accepts body token or cookie-only requests", () => {
      expect(refreshTokenSchema.safeParse({ refreshToken: "abc" }).success).toBe(true);
      expect(refreshTokenSchema.safeParse({}).success).toBe(true); // cookie fallback
    });
  });

  describe("verifyOtpSchema", () => {
    it("requires exactly a 4-digit code", () => {
      expect(verifyOtpSchema.safeParse({ email: "a@b.com", code: "1234" }).success).toBe(true);
      expect(verifyOtpSchema.safeParse({ email: "a@b.com", code: "123" }).success).toBe(false);
      expect(verifyOtpSchema.safeParse({ email: "a@b.com", code: "12345" }).success).toBe(false);
      expect(verifyOtpSchema.safeParse({ email: "a@b.com", code: "12ab" }).success).toBe(false);
      expect(verifyOtpSchema.safeParse({ email: "a@b.com", code: "" }).success).toBe(false);
    });
  });

  describe("googleAuthSchema", () => {
    it("requires a credential", () => {
      expect(googleAuthSchema.safeParse({ credential: "token" }).success).toBe(true);
      expect(googleAuthSchema.safeParse({}).success).toBe(false);
      expect(googleAuthSchema.safeParse({ credential: "" }).success).toBe(false);
    });
  });

  describe("password reset validators", () => {
    it("validates forgot-password email", () => {
      expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: "bad" }).success).toBe(false);
      expect(emailSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    });

    it("validates reset-password token and password", () => {
      expect(
        resetPasswordSchema.safeParse({ token: "abc", password: "SecurePass@123" }).success
      ).toBe(true);
      expect(resetPasswordSchema.safeParse({ token: "", password: "SecurePass@123" }).success).toBe(false);
      expect(resetPasswordSchema.safeParse({ token: "abc", password: "weak" }).success).toBe(false);
    });
  });
});
