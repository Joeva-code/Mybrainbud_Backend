import { Request, Response, NextFunction } from "express";
import { OnboardingService } from "../services/onboarding.service";
import { success } from "../utils/response";
import {
  SetExamDto,
  SetSubjectsDto,
  SetYearDto,
} from "../validators/onboarding.validator";

export class OnboardingController {
  private service: OnboardingService;

  constructor(service: OnboardingService) {
    this.service = service;
  }

  getOptions = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const options = await this.service.getOptions();
      return success(res, "Onboarding options retrieved", options);
    } catch (error) {
      next(error);
    }
  };

  getState = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const state = await this.service.getState(userId);
      return success(res, "Onboarding state retrieved", state);
    } catch (error) {
      next(error);
    }
  };

  setExam = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const dto: SetExamDto = req.body;
      const result = await this.service.setExam(userId, dto);
      return success(res, "Exam selection saved", result);
    } catch (error) {
      next(error);
    }
  };

  setYear = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const dto: SetYearDto = req.body;
      const result = await this.service.setYear(userId, dto);
      return success(res, "Study year saved", result);
    } catch (error) {
      next(error);
    }
  };

  setSubjects = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const dto: SetSubjectsDto = req.body;
      const result = await this.service.setSubjects(userId, dto);
      return success(res, "Subject selection saved", result);
    } catch (error) {
      next(error);
    }
  };

  complete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const result = await this.service.complete(userId);
      return success(res, "Onboarding completed", result);
    } catch (error) {
      next(error);
    }
  };
}