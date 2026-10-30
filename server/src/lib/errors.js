export class AppError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") { super(message, 404, "NOT_FOUND"); }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") { super(message, 409, "CONFLICT"); }
}

export class InvalidReferenceError extends AppError {
  constructor(message = "Invalid reference") { super(message, 400, "INVALID_REFERENCE"); }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") { super(message, 400, "VALIDATION"); }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") { super(message, 403, "FORBIDDEN"); }
}

export class GoneError extends AppError {
  constructor(message = "Gone") { super(message, 410, "GONE"); }
}
