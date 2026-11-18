/**
 * Method + pattern router with per-route auth/role guards.
 * Every response uses the JSON envelope { ok, data, error }.
 */
import { WordlessError, forbidden, notFound, unauthorized } from "./errors";
import type { AuthUser, Env } from "../env";
import { userCan } from "../modules/users/capabilities";

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  user: AuthUser | null;
}

export type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

export interface RouteOptions {
  /** Route requires a logged-in user. */
  requireAuth?: boolean;
  /** WordPress-style capability the user must hold (implies requireAuth). */
  capability?: string;
}

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
  requireAuth: boolean;
  capability?: string;
}

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data, error: null }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function jsonError(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, data: null, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function splitPath(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, "").split("/").filter((s) => s.length > 0);
}

function matchSegments(routeSegments: string[], pathSegments: string[]): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i];
    const pathSeg = pathSegments[i];
    if (routeSeg === undefined || pathSeg === undefined) return null;
    if (routeSeg.startsWith(":")) {
      params[routeSeg.slice(1)] = decodeURIComponent(pathSeg);
    } else if (routeSeg !== pathSeg) {
      return null;
    }
  }
  return params;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler, opts: RouteOptions = {}): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(pattern),
      handler,
      requireAuth: opts.requireAuth ?? opts.capability !== undefined,
      capability: opts.capability,
    });
  }

  get(pattern: string, handler: RouteHandler, opts: RouteOptions = {}): void {
    this.add("GET", pattern, handler, opts);
  }

  post(pattern: string, handler: RouteHandler, opts: RouteOptions = {}): void {
    this.add("POST", pattern, handler, opts);
  }

  async handle(request: Request, env: Env, user: AuthUser | null): Promise<Response> {
    const url = new URL(request.url);
    const pathSegments = splitPath(url.pathname);
    const method = request.method.toUpperCase();

    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, pathSegments);
      if (params === null) continue;
      pathMatched = true;
      if (route.method !== method) continue;

      if (route.requireAuth && user === null) {
        return jsonError("unauthorized", 401, "Authentication required.");
      }
      if (route.capability !== undefined && (user === null || !userCan(user, route.capability))) {
        return jsonError("forbidden", 403, "You do not have permission to do that.");
      }

      try {
        return await route.handler({ request, env, url, params, user });
      } catch (err) {
        if (err instanceof WordlessError) {
          return jsonError(err.code, err.status, err.message);
        }
        // Never leak internals (stack traces) to clients.
        console.error("Unhandled route error", err);
        return jsonError("internal_error", 500, "An unexpected error occurred.");
      }
    }

    if (pathMatched) {
      return jsonError("method_not_allowed", 405, `Method ${method} is not allowed on this route.`);
    }
    return jsonError("not_found", 404, "Route not found.");
  }
}

/** Parse a JSON request body, raising a 400 on invalid JSON. */
export async function readJsonBody<T>(request: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new WordlessError("bad_request", 400, "Request body must be valid JSON.");
  }
  return parsed as T;
}

export { forbidden, notFound, unauthorized };
