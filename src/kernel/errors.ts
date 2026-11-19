/**
 * Typed errors. Handlers translate WordlessError into the JSON envelope;
 * stack traces are never sent to clients.
 */
export class WordlessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "WordlessError";
    this.code = code;
    this.status = status;
  }
}

export function badRequest(message: string, code = "bad_request"): WordlessError {
  return new WordlessError(code, 400, message);
}

export function unauthorized(message = "Authentication required", code = "unauthorized"): WordlessError {
  return new WordlessError(code, 401, message);
}

export function forbidden(message = "You do not have permission to do that", code = "forbidden"): WordlessError {
  return new WordlessError(code, 403, message);
}

export function notFound(message = "Not found", code = "not_found"): WordlessError {
  return new WordlessError(code, 404, message);
}

export function conflict(message: string, code = "conflict"): WordlessError {
  return new WordlessError(code, 409, message);
}

/** Every stub in M1 throws this — never silently pretend a feature works. */
export function stubError(feature: string): WordlessError {
  return new WordlessError(
    "not_implemented",
    501,
    `STUB: ${feature} is not implemented yet. See README.md for the stub list.`,
  );
}
