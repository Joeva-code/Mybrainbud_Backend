import { z } from "zod";

/**
 * The registration form in the MyBrainBud design uses a single "Name" field.
 * We accept either:
 *   - `name` (single field, e.g. "John Doe"), which is split into
 *     firstName/lastName before persistence, or
 *   - the original `firstName` (+ optional `lastName`) fields, kept for
 *     backward compatibility with existing clients.
 * `confirmPassword` is a frontend/request-validation concern only and is
 * never persisted.
 */
const passwordRule = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const registerSchema = z
  .object({
    // Single-field name from the current design.
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    // Legacy split fields (still supported for backward compatibility).
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    email: z.string().email("Invalid email address"),
    password: passwordRule,
    // Frontend-only confirmation; validated here so the UI gets a precise
    // error, but it is never stored.
    confirmPassword: z.string().optional(),
    // Public registration may only create non-privileged roles. ADMIN and
    // SCHOOL_ADMIN accounts require an explicitly authorized provisioning path.
    role: z.enum(["STUDENT", "PARENT", "TEACHER"]).default("STUDENT"),
    // The registration design includes a terms/consent checkbox.
    acceptTerms: z
      .boolean()
      .refine((accepted) => accepted === true, "You must accept the terms and conditions"),
  })
  // A name must be supplied in one form or the other.
  .refine((data) => Boolean(data.name || data.firstName), {
    message: "Name is required",
    path: ["name"],
  })
  // When confirmPassword is sent it must match the password.
  .refine((data) => data.confirmPassword === undefined || data.confirmPassword === data.password, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// Refresh tokens may be supplied in the body (existing contract) or via the
// httpOnly refreshToken cookie; the controller falls back to the cookie.
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required").optional(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().regex(/^\d{4}$/, "Verification code must be 4 digits"),
});

export const googleAuthSchema = z.object({
  // Google Identity Services ID token ("credential" in the GIS response).
  credential: z.string().min(1, "Google credential is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

export const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
});
