import type { z } from 'zod';
import type { ApiError } from '../api/contract.js';

export type ApiErrorCode = ApiError['error']['code'];

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  no_campaign: 409,
  model_error: 502,
  not_authenticated: 401,
  internal: 500,
};

/**
 * A failure with a code the client can branch on.
 *
 * Bare error strings force the browser to pattern-match on prose, which breaks
 * the moment the wording changes. The code set lives in the contract, so both
 * sides agree on what can go wrong.
 */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }

  get status(): number {
    return STATUS[this.code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Parse untrusted input, or fail with a 400 the client can read. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new ApiFailure('bad_request', detail);
}

/** Map anything thrown into a structured failure. */
export function toApiFailure(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  const message = err instanceof Error ? err.message : String(err);
  // The model client throws this exact shape when the token is missing or
  // rejected; surface it as auth rather than a generic upstream failure.
  if (/not signed in|not logged in|OAuth access token is invalid/i.test(message)) {
    return new ApiFailure('not_authenticated', message);
  }
  if (err instanceof Error && err.name === 'ModelCallError') {
    return new ApiFailure('model_error', message);
  }
  return new ApiFailure('internal', message);
}
