import { Router } from "express";
import authRoutes from "./auth.routes";
import studentRoutes from "./student.routes";
import onboardingRoutes from "./onboarding.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/students", studentRoutes);
router.use("/onboarding", onboardingRoutes);

export default router;
