import { Response } from "express";

export interface SuccessResponse<T = any> {
  success: true;
  message: string;
  data?: T;
}

export interface ErrorResponse {
  success: false;
  message: string;
  errors?: any[];
  stack?: string;
}

export function success<T>(res: Response, message: string, data?: T, statusCode = 200): Response {
  const response: SuccessResponse<T> = {
    success: true,
    message,
    data,
  };
  return res.status(statusCode).json(response);
}

export function created<T>(res: Response, message: string, data?: T): Response {
  return success(res, message, data, 201);
}

export function failure(res: Response, message: string, statusCode = 400, errors?: any[]): Response {
  const response: ErrorResponse = {
    success: false,
    message,
  };

  if (errors && errors.length > 0) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
}