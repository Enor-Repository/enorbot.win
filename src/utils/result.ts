/**
 * Result type for error handling without exceptions.
 * All service functions return Result<T>, never throw.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Create a successful result
 */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

/**
 * Create a failed result
 */
export function err<T>(error: string): Result<T> {
  return { ok: false, error }
}
