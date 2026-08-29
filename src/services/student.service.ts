import { PrismaClient } from "@prisma/client";
import { NotFoundError, BadRequestError } from "../utils/errors";
import {
  UpdateProfileDto,
  StudentProfileResponse,
  StudentSubjectResponse,
  SubjectResponse,
} from "../types/student.types";

export class StudentService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getProfile(userId: string): Promise<StudentProfileResponse> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: {
        targetExam: {
          select: {
            id: true,
            type: true,
            name: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    return {
      id: profile.id,
      userId: profile.userId,
      classLevel: profile.classLevel,
      gender: profile.gender,
      dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
      schoolName: profile.schoolName,
      profileComplete: profile.profileComplete,
      targetExam: profile.targetExam
        ? {
            id: profile.targetExam.id,
            type: profile.targetExam.type as "BECE" | "WAEC" | "NECO" | "JAMB",
            name: profile.targetExam.name,
          }
        : null,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto
  ): Promise<StudentProfileResponse> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    if (dto.targetExamId) {
      const exam = await this.prisma.exam.findUnique({
        where: { id: dto.targetExamId },
      });
      if (!exam) {
        throw new BadRequestError("Invalid target exam");
      }
    }

    const updatedProfile = await this.prisma.studentProfile.update({
      where: { userId },
      data: {
        classLevel: dto.classLevel,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        schoolName: dto.schoolName,
        targetExamId: dto.targetExamId,
        profileComplete: this.checkProfileComplete({
          ...profile,
          ...dto,
        }),
      },
      include: {
        targetExam: {
          select: {
            id: true,
            type: true,
            name: true,
          },
        },
      },
    });

    return {
      id: updatedProfile.id,
      userId: updatedProfile.userId,
      classLevel: updatedProfile.classLevel,
      gender: updatedProfile.gender,
      dateOfBirth: updatedProfile.dateOfBirth?.toISOString() ?? null,
      schoolName: updatedProfile.schoolName,
      profileComplete: updatedProfile.profileComplete,
      targetExam: updatedProfile.targetExam
        ? {
            id: updatedProfile.targetExam.id,
            type: updatedProfile.targetExam.type as "BECE" | "WAEC" | "NECO" | "JAMB",
            name: updatedProfile.targetExam.name,
          }
        : null,
      createdAt: updatedProfile.createdAt.toISOString(),
      updatedAt: updatedProfile.updatedAt.toISOString(),
    };
  }

  private checkProfileComplete(data: {
    classLevel?: string | null;
    gender?: string | null;
    dateOfBirth?: string | Date | null;
    schoolName?: string | null;
    targetExamId?: string | null;
  }): boolean {
    return !!(
      data.classLevel &&
      data.gender &&
      data.dateOfBirth &&
      data.schoolName &&
      data.targetExamId
    );
  }

  async getSubjects(userId: string): Promise<StudentSubjectResponse[]> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    const studentSubjects = await this.prisma.studentSubject.findMany({
      where: {
        studentId: profile.id,
        isActive: true,
      },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return studentSubjects.map((ss) => ({
      id: ss.id,
      studentId: ss.studentId,
      subject: {
        id: ss.subject.id,
        name: ss.subject.name,
        code: ss.subject.code,
        description: ss.subject.description,
        isActive: ss.subject.isActive,
      },
      isActive: ss.isActive,
      createdAt: ss.createdAt.toISOString(),
    }));
  }

  async addSubject(userId: string, subjectId: string): Promise<StudentSubjectResponse> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
    });

    if (!subject) {
      throw new NotFoundError("Subject not found");
    }

    if (!subject.isActive) {
      throw new BadRequestError("Subject is not active");
    }

    const existing = await this.prisma.studentSubject.findUnique({
      where: {
        studentId_subjectId: {
          studentId: profile.id,
          subjectId,
        },
      },
    });

    if (existing) {
      if (existing.isActive) {
        throw new BadRequestError("Subject already added");
      }
      const reactivated = await this.prisma.studentSubject.update({
        where: { id: existing.id },
        data: { isActive: true },
        include: {
          subject: {
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
              isActive: true,
            },
          },
        },
      });

      return {
        id: reactivated.id,
        studentId: reactivated.studentId,
        subject: {
          id: reactivated.subject.id,
          name: reactivated.subject.name,
          code: reactivated.subject.code,
          description: reactivated.subject.description,
          isActive: reactivated.subject.isActive,
        },
        isActive: reactivated.isActive,
        createdAt: reactivated.createdAt.toISOString(),
      };
    }

    const studentSubject = await this.prisma.studentSubject.create({
      data: {
        studentId: profile.id,
        subjectId,
      },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
          },
        },
      },
    });

    return {
      id: studentSubject.id,
      studentId: studentSubject.studentId,
      subject: {
        id: studentSubject.subject.id,
        name: studentSubject.subject.name,
        code: studentSubject.subject.code,
        description: studentSubject.subject.description,
        isActive: studentSubject.subject.isActive,
      },
      isActive: studentSubject.isActive,
      createdAt: studentSubject.createdAt.toISOString(),
    };
  }

  async removeSubject(userId: string, subjectId: string): Promise<void> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError("Student profile not found");
    }

    const studentSubject = await this.prisma.studentSubject.findUnique({
      where: {
        studentId_subjectId: {
          studentId: profile.id,
          subjectId,
        },
      },
    });

    if (!studentSubject) {
      throw new NotFoundError("Subject not found in student subjects");
    }

    await this.prisma.studentSubject.update({
      where: { id: studentSubject.id },
      data: { isActive: false },
    });
  }

  async getAllSubjects(): Promise<SubjectResponse[]> {
    const subjects = await this.prisma.subject.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    return subjects;
  }
}
