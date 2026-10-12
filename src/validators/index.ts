import { ZodError } from "zod";
import { ValidationError } from "../utils/errors";

export function validate(schema: any) {
  return (req: any, res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = (error as any).issues.map((err: any) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        throw new ValidationError("Validation failed", errors);
      }
      throw error;
    }
  };
}

export function validateParams(schema: any) {
  return (req: any, res: any, next: any) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = (error as any).issues.map((err: any) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        throw new ValidationError("Validation failed", errors);
      }
      throw error;
    }
  };
}

export function validateQuery(schema: any) {
  return (req: any, res: any, next: any) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = (error as any).issues.map((err: any) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        throw new ValidationError("Validation failed", errors);
      }
      throw error;
    }
  };
}

export * from "./auth.validator";
export * from "./student.validator";
export * from "./onboarding.validator";
