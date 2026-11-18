/**
 * WORDLESS — Worker entry point (Milestone 1).
 * API gateway + public renderer shell. Routes are registered on the kernel
 * router; handlers call module services, never D1 directly.
 */
import { adminHtml } from "./admin-shell";
import { adaptD1, nowIso } from "./db";
import type { Env } from "./env";
import { WordlessError } from "./kernel/errors";
import { jsonError, jsonOk, readJsonBody, Router } from "./kernel/router";
import { intInRange, requireString } from "./kernel/validate";
import {
  buildSessionCookie,
  clearSessionCookie,
  login as loginUser,
  parseSessionCookie,
  revokeSession,
  userFromSession,
} from "./modules/auth/service";
import { getOption } from "./modules/options/service";
import { createPost, getPostBySlug, listPosts } from "./modules/posts/service";
import type { PostStatus } from "./modules/posts/types";

const VERSION = "0.1.0";

function buildRouter(): Router {
  const router = new Router();

  router.get("/api/health", () => {
    return jsonOk({ status: "ok", version: VERSION, time: nowIso() });
  });

  router.get("/api/posts", async ({ url, env }) => {
    const db = adaptD1(env.DB);
    const statusParam = url.searchParams.get("status");
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
    const result = await listPosts(db, {
      status: statusParam !== null ? (statusParam as PostStatus) : undefined,
      type: url.searchParams.get("type") ?? undefined,
      page,
      perPage,
    });
    return jsonOk(result);
  });

  router.post(
    "/api/posts",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      // user is non-null here: the route requires the edit_posts capability.
      const post = await createPost(db, {
        title: body.title as string,
        content: body.content as string | undefined,
        excerpt: body.excerpt as string | undefined,
        slug: body.slug as string | undefined,
        status: body.status as PostStatus | undefined,
        type: body.type as string | undefined,
        authorId: user?.id ?? 0,
      });
      return jsonOk(post, 201);
    },
    { capability: "edit_posts" },
  );

  router.get("/api/posts/:slug", async ({ params, env, user }) => {
    const db = adaptD1(env.DB);
    const slug = params.slug ?? "";
    const post = await getPostBySlug(db, slug);
    if (!post) throw new WordlessError("not_found", 404, `No post found with slug "${params.slug}".`);
    // Drafts and private posts are visible only to logged-in users in M1.
    if (post.status !== "publish" && user === null) {
      throw new WordlessError("unauthorized", 401, "Authentication required to view this post.");
    }
    return jsonOk(post);
  });

  router.post("/api/auth/login", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const body = await readJsonBody<Record<string, unknown>>(request);
    const loginName = requireString(body.login, "login", { max: 60 });
    const password = requireString(body.password, "password", { max: 200 });
    const result = await loginUser(db, loginName, password, {
      userAgent: request.headers.get("User-Agent") ?? undefined,
    });
    if (!result) {
      // Deliberately generic: do not reveal whether the login or password was wrong.
      throw new WordlessError("unauthorized", 401, "Invalid login or password.");
    }
    const response = jsonOk({
      user: {
        id: result.user.id,
        login: result.user.login,
        email: result.user.email,
        displayName: result.user.displayName,
        role: result.user.role,
      },
    });
    response.headers.set("Set-Cookie", buildSessionCookie(result.token));
    return response;
  });

  router.post("/api/auth/logout", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const token = parseSessionCookie(request.headers.get("Cookie"));
    if (token) await revokeSession(db, token);
    const response = jsonOk({ loggedOut: true });
    response.headers.set("Set-Cookie", clearSessionCookie());
    return response;
  });

  router.get(
    "/api/options/:key",
    async ({ params, env }) => {
      const db = adaptD1(env.DB);
      const key = params.key ?? "";
      const value = await getOption<unknown>(db, key, null);
      return jsonOk({ key, value });
    },
    { requireAuth: true },
  );

  router.get("/", () => {
    return new Response(adminHtml(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  return router;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const db = adaptD1(env.DB);
      const token = parseSessionCookie(request.headers.get("Cookie"));
      const user = await userFromSession(db, token);
      return await buildRouter().handle(request, env, user);
    } catch (err) {
      if (err instanceof WordlessError) {
        return jsonError(err.code, err.status, err.message);
      }
      console.error("Unhandled worker error", err);
      return jsonError("internal_error", 500, "An unexpected error occurred.");
    }
  },
};
