export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details?: Record<string, unknown>) {
    super(409, 'CONFLICT', message, details)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request') {
    super(400, 'VALIDATION_ERROR', message)
  }
}
