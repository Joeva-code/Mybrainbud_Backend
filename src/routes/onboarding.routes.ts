import { Router } from "express";
import { OnboardingController } from "../controllers/onboarding.controller";
import { authenticate } from "../middleware/auth.middleware";
import { restrictTo } from "../middleware/role.middleware";
import { validate } from "../validators";
import {
  setExamSchema,
  setSubjectsSchema,
  setYearSchema,
} from "../validators/onboarding.validator";
import { OnboardingService } from "../services/onboarding.service";
import prisma from "../lib/prisma";

const onboardingService = new OnboardingService(prisma);
const onboardingController = new OnboardingController(onboardingService);

const router = Router();

router.use(authenticate());

router.get(
  "/options",
  restrictTo("STUDENT"),
  onboardingController.getOptions
);

router.get("/", restrictTo("STUDENT"), onboardingController.getState);

router.put(
  "/exam",
  restrictTo("STUDENT"),
  validate(setExamSchema),
  onboardingController.setExam
);

router.put(
  "/year",
  restrictTo("STUDENT"),
  validate(setYearSchema),
  onboardingController.setYear
);

router.put(
  "/subjects",
  restrictTo("STUDENT"),
  validate(setSubjectsSchema),
  onboardingController.setSubjects
);

router.post("/complete", restrictTo("STUDENT"), onboardingController.complete);

export default router;