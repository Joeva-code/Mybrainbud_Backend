export type OnboardingExamType = "WAEC" | "JAMB" | "NECO" | "GCE";

export type OnboardingStudyYear =
  | "YEAR_1"
  | "YEAR_2"
  | "YEAR_3"
  | "YEAR_4"
  | "YEAR_5"
  | "YEAR_6";

export interface OnboardingExamOption {
  type: OnboardingExamType;
  name: string;
}

export interface OnboardingYearOption {
  value: OnboardingStudyYear;
  label: string;
}

export interface OnboardingSubjectOption {
  id: string;
  name: string;
  code: string;
}

export interface OnboardingOptionsResponse {
  exams: OnboardingExamOption[];
  years: OnboardingYearOption[];
  subjects: OnboardingSubjectOption[];
}

export interface OnboardingSelectedSubject {
  id: string;
  name: string;
  code: string;
}

export type OnboardingStep = "EXAM" | "YEAR" | "SUBJECTS" | "COMPLETE";

export interface OnboardingStateResponse {
  currentStep: OnboardingStep;
  exam: { type: OnboardingExamType; name: string } | null;
  studyYear: OnboardingStudyYear | null;
  subjects: OnboardingSelectedSubject[];
  onboardingComplete: boolean;
}

export interface SetExamResponse {
  exam: { type: OnboardingExamType; name: string };
  currentStep: OnboardingStep;
}

export interface SetYearResponse {
  studyYear: OnboardingStudyYear;
  currentStep: OnboardingStep;
}

export interface SetSubjectsResponse {
  subjects: OnboardingSelectedSubject[];
  currentStep: OnboardingStep;
}

export interface CompleteOnboardingResponse {
  onboardingComplete: boolean;
  profileComplete: boolean;
}