/**
 * Typed application errors.
 *
 * Every failure the client can be expected to handle is an `AppError` with a
 * stable machine-readable `code`. The client switches on `code`; `message` is
 * for humans and may be reworded or translated without breaking anything.
 * Anything that is NOT an AppError reaching the error middleware is treated as
 * a bug: it is logged with a stack and reported to the client as a generic 500
 * so internal details never leak.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'BRANCH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'UNPROCESSABLE'
  | 'INSUFFICIENT_STOCK'
  | 'PERIOD_CLOSED'
  | 'JOURNAL_UNBALANCED'
  | 'ACCOUNT_IN_USE'
  | 'STALE_VERSION'
  | 'RATE_LIMITED'
  | 'OFFLINE_CONFLICT'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  BRANCH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  UNPROCESSABLE: 422,
  INSUFFICIENT_STOCK: 409,
  PERIOD_CLOSED: 409,
  JOURNAL_UNBALANCED: 422,
  ACCOUNT_IN_USE: 409,
  STALE_VERSION: 409,
  RATE_LIMITED: 429,
  OFFLINE_CONFLICT: 409,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  /** Field-level detail, e.g. `{ email: 'Already in use' }`. */
  details?: Record<string, string | string[]>;
  /** Underlying error, kept for logging but never serialised to the client. */
  cause?: unknown;
  /** Seconds to wait, for RATE_LIMITED. */
  retryAfter?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string | string[]>;
  readonly retryAfter?: number;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message: string, details?: AppErrorOptions['details']) =>
  new AppError('UNPROCESSABLE', message, { details });

export const notFound = (what: string, id?: string) =>
  new AppError('NOT_FOUND', id ? `${what} "${id}" was not found` : `${what} was not found`);

export const conflict = (message: string) => new AppError('CONFLICT', message);

export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', message);

export const validation = (message: string, details?: AppErrorOptions['details']) =>
  new AppError('VALIDATION_FAILED', message, { details });

export const internal = (message = 'An unexpected error occurred', cause?: unknown) =>
  new AppError('INTERNAL', message, { cause });
