import { Router } from "express";
import { StudentController } from "../controllers/student.controller";
import { authenticate } from "../middleware/auth.middleware";
import { restrictTo } from "../middleware/role.middleware";
import { validate } from "../validators";
import { updateProfileSchema, addSubjectSchema } from "../validators/student.validator";
import { StudentService } from "../services/student.service";
import prisma from "../lib/prisma";

const studentService = new StudentService(prisma);
const studentController = new StudentController(studentService);

const router = Router();

router.use(authenticate());

router.get(
  "/profile",
  restrictTo("STUDENT"),
  studentController.getProfile
);

router.patch(
  "/profile",
  restrictTo("STUDENT"),
  validate(updateProfileSchema),
  studentController.updateProfile
);

router.get(
  "/subjects",
  restrictTo("STUDENT"),
  studentController.getSubjects
);

router.post(
  "/subjects",
  restrictTo("STUDENT"),
  validate(addSubjectSchema),
  studentController.addSubject
);

router.delete(
  "/subjects/:subjectId",
  restrictTo("STUDENT"),
  studentController.removeSubject
);

router.get(
  "/subjects/all",
  restrictTo("STUDENT"),
  studentController.getAllSubjects
);

export default router;
