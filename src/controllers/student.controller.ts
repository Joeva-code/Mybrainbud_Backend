import { Request, Response, NextFunction } from "express";
import { StudentService } from "../services/student.service";
import { success } from "../utils/response";
import { UpdateProfileDto, AddSubjectDto } from "../types/student.types";

export class StudentController {
  private service: StudentService;

  constructor(service: StudentService) {
    this.service = service;
  }

  getProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const profile = await this.service.getProfile(userId);
      return success(res, "Student profile retrieved", profile);
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const dto: UpdateProfileDto = req.body;
      const profile = await this.service.updateProfile(userId, dto);
      return success(res, "Student profile updated", profile);
    } catch (error) {
      next(error);
    }
  };

  getSubjects = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const subjects = await this.service.getSubjects(userId);
      return success(res, "Student subjects retrieved", subjects);
    } catch (error) {
      next(error);
    }
  };

  addSubject = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const dto: AddSubjectDto = req.body;
      const result = await this.service.addSubject(userId, dto.subjectId);
      return success(res, "Subject added to student", result, 201);
    } catch (error) {
      next(error);
    }
  };

  removeSubject = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const subjectId = req.params.subjectId as string;
      await this.service.removeSubject(userId, subjectId);
      return success(res, "Subject removed from student");
    } catch (error) {
      next(error);
    }
  };

  getAllSubjects = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const subjects = await this.service.getAllSubjects();
      return success(res, "All subjects retrieved", subjects);
    } catch (error) {
      next(error);
    }
  };
}
