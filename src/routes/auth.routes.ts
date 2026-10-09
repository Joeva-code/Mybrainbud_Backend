import { Router } from "express";
import {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  getMe,
  verifyOtp,
  resendOtp,
  googleAuth,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";
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
import { validate } from "../validators";
import { authenticate } from "../middleware/auth.middleware";
import prisma from "../lib/prisma";
import { AuthService } from "../services/auth.service";
import { PasswordResetService } from "../services/password-reset.service";

const authService = new AuthService(prisma);
const passwordResetService = new PasswordResetService(prisma);

const router = Router();

router.post("/register", validate(registerSchema), register(authService));

router.post("/login", validate(loginSchema), login(authService));

router.post("/refresh", validate(refreshTokenSchema), refreshToken(authService));

// Contact verification (registration journey)
router.post("/verify-otp", validate(verifyOtpSchema), verifyOtp(authService));

router.post("/resend-otp", validate(emailSchema), resendOtp(authService));

// Google sign-in (Google Identity Services ID token)
router.post("/google", validate(googleAuthSchema), googleAuth(authService));

// Password reset
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword(passwordResetService));

router.post("/reset-password", validate(resetPasswordSchema), resetPassword(passwordResetService));

router.get("/me", authenticate(), getMe());

router.post("/logout", authenticate(), logout(authService));

router.post("/logout-all", authenticate(), logoutAll(authService));

export default router;
