export class ApiError extends Error {
  public statusCode: number;
  public errors?: any[];
  public isOperational: boolean;

  constructor(message: string, statusCode = 500, errors?: any[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;

    // Restore the prototype chain for the *actual* class being constructed so
    // `instanceof` works for every subclass (e.g. new UnauthorizedError() instanceof
    // UnauthorizedError === true).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad request", errors?: any[]) {
    super(message, 400, errors);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Validation failed", errors?: any[]) {
    super(message, 422, errors);
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = "Service temporarily unavailable") {
    super(message, 503);
  }
}