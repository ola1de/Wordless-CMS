/** Small validation helpers used by routes and services. */
import { badRequest } from "./errors";

export function requireString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`Field "${field}" is required and must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (opts.min !== undefined && trimmed.length < opts.min) {
    throw badRequest(`Field "${field}" must be at least ${opts.min} characters.`);
  }
  if (opts.max !== undefined && trimmed.length > opts.max) {
    throw badRequest(`Field "${field}" must be at most ${opts.max} characters.`);
  }
  return trimmed;
}

export function optionalString(value: unknown, field: string, max = 10000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`Field "${field}" must be a string.`);
  if (value.length > max) throw badRequest(`Field "${field}" must be at most ${max} characters.`);
  return value;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function requireSlug(value: unknown, field: string): string {
  const s = requireString(value, field, { max: 200 }).toLowerCase();
  if (!isValidSlug(s)) {
    throw badRequest(`Field "${field}" must be a URL slug (lowercase letters, digits and hyphens only).`);
  }
  return s;
}

/** Parse a query-string integer with bounds; returns `fallback` when absent. */
export function intInRange(value: string | null, field: string, min: number, max: number, fallback: number): number {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`Query parameter "${field}" must be an integer.`);
  if (n < min || n > max) throw badRequest(`Query parameter "${field}" must be between ${min} and ${max}.`);
  return n;
}

export function requireInt(value: unknown, field: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`Field "${field}" must be an integer.`);
  }
  if (value < min || value > max) throw badRequest(`Field "${field}" must be between ${min} and ${max}.`);
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireEmail(value: unknown, field: string): string {
  const s = requireString(value, field, { max: 100 });
  if (!EMAIL_RE.test(s)) throw badRequest(`Field "${field}" must be a valid email address.`);
  return s.toLowerCase();
}
