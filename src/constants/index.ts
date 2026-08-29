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
