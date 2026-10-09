export const UserRoles = {
  STUDENT: "STUDENT",
  PARENT: "PARENT",
  TEACHER: "TEACHER",
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  ADMIN: "ADMIN",
} as const;

export type UserRole = (typeof UserRoles)[keyof typeof UserRoles];

export const AuthProviders = {
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  GOOGLE: "GOOGLE",
} as const;

export type AuthProvider = (typeof AuthProviders)[keyof typeof AuthProviders];

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const AuthConstants = {
  /**
   * Length of the verification code. Fixed at 4 digits to match the four OTP
   * input boxes in the MyBrainBud authentication design.
   */
  OTP_LENGTH: 4,
  /** bcrypt cost factor used for all password hashing. */
  BCRYPT_ROUNDS: 12,
  /**
   * Single message returned for every OTP verification failure (wrong code,
   * expired code, exhausted attempts, unknown challenge) so that responses do
   * not leak the state of a verification challenge.
   */
  OTP_INVALID_MESSAGE: "Invalid or expired verification code.",
  /** Generic message that never reveals whether an account exists. */
  ACCOUNT_DISCOVERY_SAFE_MESSAGE:
    "If an account with that information exists, a message has been sent.",
} as const;
