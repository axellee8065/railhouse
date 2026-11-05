export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_AMOUNT"
  | "AUTH_REQUIRED"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_TOKEN_REUSED"
  | "FORBIDDEN_SCOPE"
  | "ENV_MISMATCH"
  | "SESSION_NOT_FOUND"
  | "BET_NOT_FOUND"
  | "ROUND_NOT_FOUND"
  | "INSUFFICIENT_FUNDS"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "BET_ALREADY_SETTLED"
  | "BET_NOT_CANCELLABLE"
  | "BET_NOT_RESERVED"
  | "BET_IN_FLIGHT"
  | "SESSION_CLOSED"
  | "CURRENCY_MISMATCH"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "LEDGER_UNAVAILABLE"
  | "OPERATOR_NOT_FOUND"
  | "PAYOUT_CAP_EXCEEDED";

const STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_AMOUNT: 400,
  AUTH_REQUIRED: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_TOKEN_REUSED: 401,
  FORBIDDEN_SCOPE: 403,
  ENV_MISMATCH: 403,
  SESSION_NOT_FOUND: 404,
  BET_NOT_FOUND: 404,
  ROUND_NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  BET_ALREADY_SETTLED: 409,
  BET_NOT_CANCELLABLE: 409,
  BET_NOT_RESERVED: 409,
  BET_IN_FLIGHT: 409,
  SESSION_CLOSED: 409,
  CURRENCY_MISMATCH: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  LEDGER_UNAVAILABLE: 503,
  OPERATOR_NOT_FOUND: 401,
  PAYOUT_CAP_EXCEEDED: 400,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.details = details;
  }
}

export function errorEnvelope(
  err: ApiError,
  requestId: string,
): { error: { code: string; message: string; request_id: string; details?: Record<string, unknown> } } {
  return {
    error: {
      code: err.code,
      message: err.message,
      request_id: requestId,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
