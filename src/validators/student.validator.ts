import { z } from "zod";

export const updateProfileSchema = z.object({
  classLevel: z.enum(["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"]).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional(),
  dateOfBirth: z.string().optional(),
  schoolName: z.string().max(255).optional(),
  targetExamId: z.string().uuid().optional(),
});

export const addSubjectSchema = z.object({
  subjectId: z.string().uuid("Invalid subject ID"),
});
