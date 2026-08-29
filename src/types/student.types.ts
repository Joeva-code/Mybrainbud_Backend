export interface StudentProfileResponse {
  id: string;
  userId: string;
  classLevel: "JSS1" | "JSS2" | "JSS3" | "SS1" | "SS2" | "SS3" | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY" | null;
  dateOfBirth: string | null;
  schoolName: string | null;
  profileComplete: boolean;
  targetExam: {
    id: string;
    type: "BECE" | "WAEC" | "NECO" | "JAMB";
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileDto {
  classLevel?: "JSS1" | "JSS2" | "JSS3" | "SS1" | "SS2" | "SS3";
  gender?: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
  dateOfBirth?: string;
  schoolName?: string;
  targetExamId?: string;
}

export interface SubjectResponse {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
}

export interface StudentSubjectResponse {
  id: string;
  studentId: string;
  subject: SubjectResponse;
  isActive: boolean;
  createdAt: string;
}

export interface AddSubjectDto {
  subjectId: string;
}
