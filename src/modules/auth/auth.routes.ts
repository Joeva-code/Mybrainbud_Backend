import { Router } from "express";
import { register, login, refreshToken, logout, logoutAll, getMe } from "./auth.controller";
import { registerSchema, loginSchema, refreshTokenSchema } from "./auth.validation";
import { validate } from "../../validators";
import { authenticate } from "../../middleware/auth.middleware";

const router = Router();

// Import prisma client
import prisma from "../../lib/prisma";
import { AuthService } from "./auth.service";

// Initialize service
const authService = new AuthService(prisma);

// Public routes
router.post("/register", validate(registerSchema), register(authService));

router.post("/login", validate(loginSchema), login(authService));

router.post(
  "/refresh",
  validate(refreshTokenSchema),
  refreshToken(authService)
);

// Protected routes (require authentication)
router.get("/me", authenticate(), getMe(authService));

router.post("/logout", authenticate(), logout(authService));

router.post("/logout-all", authenticate(), logoutAll(authService));

export default router;