import { Request, Response, NextFunction } from "express";
import { ApiError, ConflictError, NotFoundError } from "../utils/errors";
import { failure } from "../utils/response";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error(err);

  if (err instanceof ApiError) {
    return failure(res, err.message, err.statusCode, err.errors);
  }

  if (err.name === "PrismaClientKnownRequestError") {
    const code = err.code;
    if (code === "P2002") {
      return failure(res, "Unique constraint violation", 409);
    }
    if (code === "P2025") {
      return failure(res, "Record not found", 404);
    }
    return failure(res, "Database error", 500);
  }

  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    return failure(res, "Validation failed", 400, errors);
  }

  return failure(res, "Internal server error", 500);
}

class ZodError extends Error {
  errors: any[];
  constructor(errors: any[]) {
    super("ZodError");
    this.errors = errors;
  }
}