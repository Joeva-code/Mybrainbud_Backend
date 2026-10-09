import { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../utils/errors";

export function restrictTo(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // The auth middleware should have already set req.user
    const authReq = req as any;

    if (!authReq.user) {
      return next(new ForbiddenError("Authentication required"));
    }

    if (!authReq.user.role) {
      return next(new ForbiddenError("User role not defined"));
    }

    if (!roles.includes(authReq.user.role)) {
      return next(
        new ForbiddenError(
          `Insufficient permissions. Required roles: ${roles.join(", ")}`
        )
      );
    }

    next();
  };
}

export function allowIf(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as any;

    if (!authReq.user) {
      return next(new ForbiddenError("Authentication required"));
    }

    if (!roles.includes(authReq.user.role)) {
      return next(
        new ForbiddenError(
          `Insufficient permissions. Required roles: ${roles.join(", ")}`
        )
      );
    }

    next();
  };
}

export const requireStudent = restrictTo("STUDENT");
export const requireParent = restrictTo("PARENT");
export const requireTeacher = restrictTo("TEACHER");
export const requireSchoolAdmin = restrictTo("SCHOOL_ADMIN");
export const requireAdmin = restrictTo("ADMIN");

export const requireStudentOrParent = allowIf("STUDENT", "PARENT");
export const requireTeacherOrAdmin = allowIf("TEACHER", "ADMIN");
export const requireStaff = allowIf("TEACHER", "SCHOOL_ADMIN", "ADMIN");
export const requireAdminOrSchoolAdmin = allowIf("ADMIN", "SCHOOL_ADMIN");