/**
 * Minimal fetch wrapper for the Wordless JSON envelope
 * `{ ok, data, error }`. Same-origin credentials so the session cookie
 * (`wordless_session`) is sent. Throws ApiError on non-OK responses.
 */
import type { MediaItem, Settings, User } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, `Request failed (${res.status}).`);
  }
  if (!res.ok || !body.ok) {
    throw new ApiError(res.status, body.error?.message ?? `Request failed (${res.status}).`);
  }
  return body.data as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
  },
  put<T>(path: string, data: unknown): Promise<T> {
    return request<T>(path, { method: "PUT", body: JSON.stringify(data) });
  },
  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },

  me(): Promise<{ user: User }> {
    return request<{ user: User }>("/api/auth/me");
  },
  login(login: string, password: string): Promise<{ user: User }> {
    return request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
  },
  logout(): Promise<{ loggedOut: boolean }> {
    return request<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" });
  },

  getSettings(): Promise<Settings> {
    return request<Settings>("/api/settings");
  },
  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
  },

  /** Multipart media upload (no JSON content-type; the browser sets it). */
  async uploadMedia(file: File, opts?: { title?: string; alt?: string }): Promise<MediaItem> {
    const form = new FormData();
    form.append("file", file);
    if (opts?.title) form.append("title", opts.title);
    if (opts?.alt) form.append("alt", opts.alt);
    const res = await fetch("/api/media", { method: "POST", credentials: "same-origin", body: form });
    const body = (await res.json()) as Envelope<MediaItem>;
    if (!res.ok || !body.ok) {
      throw new ApiError(res.status, body.error?.message ?? `Upload failed (${res.status}).`);
    }
    return body.data as MediaItem;
  },
};
