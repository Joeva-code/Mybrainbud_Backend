import { PrismaClient } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../utils/errors";
import {
  CompleteOnboardingResponse,
  OnboardingExamType,
  OnboardingOptionsResponse,
  OnboardingStateResponse,
  OnboardingStep,
  OnboardingStudyYear,
  SetExamResponse,
  SetSubjectsResponse,
  SetYearResponse,
} from "../types/onboarding.types";
import {
  SetExamDto,
  SetSubjectsDto,
  SetYearDto,
} from "../validators/onboarding.validator";

/**
 * Static step-1 choices from the Figma onboarding flow. These are kept in the
 * API (rather than read from the Exam table) so the client always receives the
 * four supported options regardless of seed state; `setExam` lazily creates a
 * matching Exam row when it is missing.
 */
const EXAM_OPTIONS: ReadonlyArray<{
  type: OnboardingExamType;
  name: string;
}> = [
  { type: "WAEC", name: "West African Examinations Council (WAEC)" },
  { type: "JAMB", name: "Joint Admissions and Matriculation Board (JAMB)" },
  { type: "NECO", name: "National Examinations Council (NECO)" },
  { type: "GCE", name: "General Certificate of Education (GCE)" },
];

const YEAR_OPTIONS: ReadonlyArray<{
  value: OnboardingStudyYear;
  label: string;
}> = [
  { value: "YEAR_1", label: "Year 1" },
  { value: "YEAR_2", label: "Year 2" },
  { value: "YEAR_3", label: "Year 3" },
  { value: "YEAR_4", label: "Year 4" },
  { value: "YEAR_5", label: "Year 5" },
  { value: "YEAR_6", label: "Year 6" },
];

export class OnboardingService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Step choices for the wizard: exams, years, and active subjects. */
  async getOptions(): Promise<OnboardingOptionsResponse> {
    const subjects = await this.prisma.subject.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });

    return {
      exams: EXAM_OPTIONS.map((exam) => ({ ...exam })),
      years: YEAR_OPTIONS.map((year) => ({ ...year })),
      subjects,
    };
  }

  /** Full onboarding state so the client can resume at the right step. */
  async getState(userId: string): Promise<OnboardingStateResponse> {
    return this.loadState(userId);
  }

  /** Step 1 — save the examination the student is writing. */
  async setExam(userId: string, dto: SetExamDto): Promise<SetExamResponse> {
    await this.getProfile(userId);

    let exam = await this.prisma.exam.findUnique({
      where: { type: dto.examType },
    });

    // Self-heal: the migration seeds WAEC/JAMB/NECO/GCE, but keep the flow
    // working on databases where those rows are missing.
    if (!exam) {
      const option = EXAM_OPTIONS.find((e) => e.type === dto.examType)!;
      exam = await this.prisma.exam.create({
        data: { type: option.type, name: option.name },
      });
    }

    await this.prisma.studentProfile.update({
      where: { userId },
      data: { targetExamId: exam.id },
    });

    const state = await this.loadState(userId);
    if (!state.exam) {
      throw new BadRequestError("Failed to save the exam selection");
    }
    return { exam: state.exam, currentStep: state.currentStep };
  }

  /** Step 2 — save the student's year of study. */
  async setYear(userId: string, dto: SetYearDto): Promise<SetYearResponse> {
    await this.getProfile(userId);

    await this.prisma.studentProfile.update({
      where: { userId },
      data: { studyYear: dto.studyYear },
    });

    const state = await this.loadState(userId);
    if (!state.studyYear) {
      throw new BadRequestError("Failed to save the study year");
    }
    return { studyYear: state.studyYear, currentStep: state.currentStep };
  }

  /**
   * Step 3 — replace the student's subject selection (full replacement so the
   * checkboxes can be toggled freely). Hard-deletes previous rows, including
   * soft-deleted ones, to avoid unique-constraint conflicts on re-selection.
   */
  async setSubjects(
    userId: string,
    dto: SetSubjectsDto
  ): Promise<SetSubjectsResponse> {
    const profile = await this.getProfile(userId);
    const subjectIds = [...new Set(dto.subjectIds)];

    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds }, isActive: true },
      select: { id: true },
    });

    if (subjects.length !== subjectIds.length) {
      throw new BadRequestError(
        "One or more selected subjects are invalid or inactive"
      );
    }

    await this.prisma.studentSubject.deleteMany({
      where: { studentId: profile.id },
    });
    await this.prisma.studentSubject.createMany({
      data: subjectIds.map((subjectId) => ({
        studentId: profile.id,
        subjectId,
      })),
    });

    const state = await this.loadState(userId);
    return { subjects: state.subjects, currentStep: state.currentStep };
  }

  /**
   * Finish screen — marks onboarding complete once exam, year, and subjects
   * are all set. `profileComplete` reflects the separate, fuller profile
   * requirements maintained by StudentService (class level, gender, DOB, ...).
   */
  async complete(userId: string): Promise<CompleteOnboardingResponse> {
    const state = await this.loadState(userId);

    const missing: string[] = [];
    if (!state.exam) missing.push("exam");
    if (!state.studyYear) missing.push("studyYear");
    if (state.subjects.length === 0) missing.push("subjects");

    if (missing.length > 0) {
      throw new BadRequestError(
        `Onboarding cannot be completed yet: missing ${missing.join(", ")}`
      );
    }

    const profile = await this.prisma.studentProfile.update({
      where: { userId },
      data: { onboardingComplete: true },
    });

    return {
      onboardingComplete: profile.onboardingComplete,
      profileComplete: profile.profileComplete,
    };
  }

  private async getProfile(userId: string) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }
    return profile;
  }

  private async loadState(userId: string): Promise<OnboardingStateResponse> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: {
        targetExam: { select: { id: true, type: true, name: true } },
        subjects: {
          where: { isActive: true },
          include: {
            subject: { select: { id: true, name: true, code: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    const exam = profile.targetExam
      ? {
          type: profile.targetExam.type as OnboardingExamType,
          name: profile.targetExam.name,
        }
      : null;
    const studyYear = (profile.studyYear as OnboardingStudyYear | null) ?? null;
    const subjects = profile.subjects.map((ss) => ({
      id: ss.subject.id,
      name: ss.subject.name,
      code: ss.subject.code,
    }));

    const currentStep: OnboardingStep = profile.onboardingComplete
      ? "COMPLETE"
      : !exam
        ? "EXAM"
        : !studyYear
          ? "YEAR"
          : subjects.length === 0
            ? "SUBJECTS"
            : "COMPLETE";

    return {
      currentStep,
      exam,
      studyYear,
      subjects,
      onboardingComplete: profile.onboardingComplete,
    };
  }
}