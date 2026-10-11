export interface RegisterDto {
  /** Single-field name from the current design; split into firstName/lastName. */
  name?: string;
  /** Legacy split fields, still supported for backward compatibility. */
  firstName?: string;
  lastName?: string;
  email: string;
  password: string;
  /** Frontend-only confirmation; validated but never persisted. */
  confirmPassword?: string;
  /** Public registration may only create non-privileged roles. */
  role?: "STUDENT" | "PARENT" | "TEACHER";
  /** Must be true — the registration UI requires accepting the terms. */
  acceptTerms: boolean;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface VerifyOtpDto {
  email: string;
  code: string;
}

export interface ResendOtpDto {
  email: string;
}

/** Continues an incomplete (unverified) email signup by re-issuing the OTP. */
export interface ResumeSignupDto {
  email: string;
}

export interface PendingRegistrationData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string | null;
  role: string;
}

export interface GoogleAuthDto {
  credential: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
  isVerified: boolean;
  isActive: boolean;
}

/** Verification challenge details returned by registration (no secrets). */
export interface VerificationChallenge {
  /** Masked destination, e.g. "j***@example.com". */
  destination: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  /** OTP code (only in development mode). */
  code?: string;
}

/** Registration response — the account is NOT created yet; verification required. */
export interface RegistrationResult {
  verification: VerificationChallenge;
}

export interface AuthResponse {
  user: UserProfile;
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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
