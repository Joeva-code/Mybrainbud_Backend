import { Request, Response, NextFunction } from "express";

export function validationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // This is a placeholder - actual validation will be done via Zod schemas
  // in the route handlers using the validate function from validators/index.ts
  next();
}