import { z } from "zod";

const examType = z.enum(
  ["WAEC", "JAMB", "NECO", "GCE"],
  "examType must be one of: WAEC, JAMB, NECO, GCE"
);

const studyYear = z.enum(
  ["YEAR_1", "YEAR_2", "YEAR_3", "YEAR_4", "YEAR_5", "YEAR_6"],
  "studyYear must be one of: YEAR_1, YEAR_2, YEAR_3, YEAR_4, YEAR_5, YEAR_6"
);

export const setExamSchema = z.object({
  examType,
});

export const setYearSchema = z.object({
  studyYear,
});

export const setSubjectsSchema = z.object({
  subjectIds: z
    .array(z.string().min(1, "subjectIds must contain non-empty subject ids"))
    .min(1, "Select at least one subject")
    .max(10, "You can select at most 10 subjects"),
});

export type SetExamDto = z.infer<typeof setExamSchema>;
export type SetYearDto = z.infer<typeof setYearSchema>;
export type SetSubjectsDto = z.infer<typeof setSubjectsSchema>;