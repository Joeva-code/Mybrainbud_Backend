import { Router } from "express";
import { register, login, refreshToken, logout, logoutAll, getMe } from "../controllers/auth.controller";
import { registerSchema, loginSchema, refreshTokenSchema } from "../validators/auth.validator";
import { validate } from "../validators";
import { authenticate } from "../middleware/auth.middleware";
import prisma from "../lib/prisma";
import { AuthService } from "../services/auth.service";

const authService = new AuthService(prisma);

const router = Router();

router.post("/register", validate(registerSchema), register(authService));

router.post("/login", validate(loginSchema), login(authService));

router.post("/refresh", validate(refreshTokenSchema), refreshToken(authService));

router.get("/me", authenticate(), getMe());

router.post("/logout", authenticate(), logout(authService));

router.post("/logout-all", authenticate(), logoutAll(authService));

export default router;
