/**
 * WORDLESS — Worker entry point (Milestone 4).
 * API gateway + public renderer. Routes are registered on the kernel
 * router; handlers call module services, never D1 directly.
 *
 * Public pages (home, posts, pages, archives) are served by the fallback
 * in fetch(): any GET that matches no API route is resolved through the
 * permalink resolver. Anonymous GETs are cached in the Cache API
 * (Cache-Control: public, max-age=60); logged-in traffic is never cached.
 *
 * The admin is a React SPA (admin/, Vite build to admin/dist/admin/)
 * served from Static Assets at /admin. API + public-site routes keep
 * priority; asset requests that miss fall back to /admin/index.html.
 */
import { createWordPressApi } from "./compat/wordpress";
import { adaptD1, nowIso } from "./db";
import type { Db } from "./db";
import type { Env } from "./env";
import { WordlessError } from "./kernel/errors";
import { jsonError, jsonOk, readJsonBody, Router } from "./kernel/router";
import { intInRange, requireString } from "./kernel/validate";
import { logActivity, listActivity } from "./modules/activity/service";
import {
  createConversionJob,
  getConversionJob,
  listConversionJobs,
  runConversionJob,
} from "./modules/conversion/service";
import { CONVERSION_FIXTURES, MAX_PHP_BYTES } from "./modules/conversion/types";
import { bundledExtension } from "./modules/extensions/registry";
import { installExtension, listExtensions } from "./modules/extensions/service";
import {
  buildSessionCookie,
  clearSessionCookie,
  login as loginUser,
  parseSessionCookie,
  revokeSession,
  userFromSession,
} from "./modules/auth/service";
import { createComment, listApprovedThreaded, listComments, setCommentStatus, deleteComment } from "./modules/comments/service";
import { rssFeed, robotsTxt, sitemapXml } from "./modules/feeds/service";
import { siteHealth } from "./modules/health/service";
import {
  addMenuItem,
  createMenu,
  deleteMenu,
  getMenuLocations,
  listMenuItems,
  listMenus,
  removeMenuItem,
  resolveMenuByLocation,
  setMenuLocation,
  updateMenuItem,
} from "./modules/menus/service";
import {
  deleteMedia,
  findMediaByKey,
  getMediaRecord,
  listMedia,
  updateMediaAlt,
  uploadMedia,
} from "./modules/media/service";
import { R2MediaStorage } from "./modules/media/storage";
import { getOption } from "./modules/options/service";
import {
  getPermalinkStructure,
  postUrl,
  resolvePath,
  resolvePostById,
  setPermalinkStructure,
} from "./modules/permalinks/service";
import {
  createPost,
  deletePost,
  getPostBySlug,
  listPosts,
  restorePost,
  trashPost,
  updatePost,
} from "./modules/posts/service";
import type { PostStatus } from "./modules/posts/types";
import {
  renderDateArchive,
  renderHome,
  renderNotFound,
  renderPage,
  renderSearchPage,
  renderSingle,
  renderTermArchive,
} from "./modules/render/service";
import {
  diffRevisions,
  getRevision,
  listRevisions,
  restoreRevision,
  saveAutosave,
} from "./modules/revisions/service";
import { searchPosts } from "./modules/search/service";
import {
  addPostTerm,
  createTerm,
  deleteTerm,
  getPostTerms,
  getTerm,
  listTerms,
  removePostTerm,
  setPostTerms,
  updateTerm,
} from "./modules/terms/service";
import { userCan } from "./modules/users/capabilities";
import type { AuthUser } from "./env";
import { getSettings, updateSettings } from "./modules/settings/service";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserRole,
} from "./modules/users/service";
import { isRole } from "./modules/users/capabilities";

const VERSION = "0.4.0";

/**
 * Pinned upstream source for each conversion fixture. Fixtures fetch from
 * these URLs at job time so no GPL PHP is ever copied into the repo; the
 * tag is pinned (6.9.1) so a fixture conversion is reproducible. The local
 * reference copy (WordPress 7.1.5) differs only in the ABSPATH guard
 * (`exit;` vs `die();`) — the converter treats both the same way.
 */
const FIXTURE_SOURCE_URLS: Record<string, string> = {
  "hello-dolly": "https://raw.githubusercontent.com/WordPress/WordPress/6.9.1/wp-content/plugins/hello.php",
};

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function parseIdParam(value: string | undefined, field: string): number {
  const n = Number(value ?? "");
  if (!Number.isInteger(n) || n < 1) throw new WordlessError("bad_request", 400, `Invalid ${field}.`);
  return n;
}

async function log(db: Db, user: AuthUser | null, action: string, objectType: string, objectId: number): Promise<void> {
  try {
    await logActivity(db, { actorId: user?.id ?? 0, action, objectType, objectId });
  } catch {
    // Audit logging must never break the request it records.
  }
}

function buildRouter(): Router {
  const router = new Router();

  // ---------------------------------------------------------- health/activity
  router.get("/api/health", () => {
    return jsonOk({ status: "ok", version: VERSION, time: nowIso() });
  });

  router.get("/api/site-health", async ({ env }) => {
    return jsonOk(await siteHealth(adaptD1(env.DB), env, VERSION));
  });

  router.get(
    "/api/activity",
    async ({ env, url }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listActivity(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  // ------------------------------------------------------------------- posts
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
      const post = await createPost(db, {
        title: body.title as string,
        content: body.content as string | undefined,
        excerpt: body.excerpt as string | undefined,
        slug: body.slug as string | undefined,
        status: body.status as PostStatus | undefined,
        type: body.type as string | undefined,
        authorId: user?.id ?? 0,
      });
      await log(db, user, "post.create", "post", post.id);
      return jsonOk(post, 201);
    },
    { capability: "edit_posts" },
  );

  router.put(
    "/api/posts/:id",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "post id");
      const body = await readJsonBody<Record<string, unknown>>(request);
      const post = await updatePost(db, id, {
        title: body.title as string | undefined,
        content: body.content as string | undefined,
        excerpt: body.excerpt as string | undefined,
        slug: body.slug as string | undefined,
        status: body.status as PostStatus | undefined,
        type: body.type as string | undefined,
        parentId: body.parentId as number | undefined,
      });
      await log(db, user, "post.update", "post", post.id);
      return jsonOk(post);
    },
    { capability: "edit_posts" },
  );

  router.post(
    "/api/posts/:id/trash",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const post = await trashPost(db, parseIdParam(params.id, "post id"));
      await log(db, user, "post.trash", "post", post.id);
      return jsonOk(post);
    },
    { capability: "delete_posts" },
  );

  router.post(
    "/api/posts/:id/restore",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const post = await restorePost(db, parseIdParam(params.id, "post id"));
      await log(db, user, "post.restore", "post", post.id);
      return jsonOk(post);
    },
    { capability: "edit_posts" },
  );

  router.delete(
    "/api/posts/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "post id");
      const deleted = await deletePost(db, id);
      await log(db, user, "post.delete", "post", id);
      return jsonOk({ deleted });
    },
    { capability: "delete_posts" },
  );

  router.get("/api/posts/:slug", async ({ params, env, user }) => {
    const db = adaptD1(env.DB);
    const slug = params.slug ?? "";
    const post = await getPostBySlug(db, slug);
    if (!post) throw new WordlessError("not_found", 404, `No post found with slug "${params.slug}".`);
    // Drafts and private posts are visible only to logged-in users.
    if (post.status !== "publish" && user === null) {
      throw new WordlessError("unauthorized", 401, "Authentication required to view this post.");
    }
    return jsonOk(post);
  });

  // --------------------------------------------------------------- revisions
  router.get(
    "/api/posts/:id/revisions",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await listRevisions(db, parseIdParam(params.id, "post id")));
    },
    { requireAuth: true },
  );

  router.post(
    "/api/posts/:id/autosave",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const revision = await saveAutosave(db, parseIdParam(params.id, "post id"), user?.id ?? 0, {
        title: body.title as string | undefined,
        content: body.content as string | undefined,
        excerpt: body.excerpt as string | undefined,
      });
      return jsonOk(revision);
    },
    { capability: "edit_posts" },
  );

  router.get(
    "/api/revisions/:id",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await getRevision(db, parseIdParam(params.id, "revision id")));
    },
    { requireAuth: true },
  );

  router.get(
    "/api/revisions/:from/diff/:to",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(
        await diffRevisions(db, parseIdParam(params.from, "revision id"), parseIdParam(params.to, "revision id")),
      );
    },
    { requireAuth: true },
  );

  router.post(
    "/api/revisions/:id/restore",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const post = await restoreRevision(db, parseIdParam(params.id, "revision id"));
      await log(db, user, "post.revision_restore", "post", post.id);
      return jsonOk(post);
    },
    { capability: "edit_posts" },
  );

  // ------------------------------------------------------------------- terms
  router.get("/api/terms", async ({ url, env }) => {
    const db = adaptD1(env.DB);
    const taxonomy = url.searchParams.get("taxonomy") ?? "category";
    const parentParam = url.searchParams.get("parent");
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
    return jsonOk(
      await listTerms(db, taxonomy, {
        parentId: parentParam !== null ? Number(parentParam) : undefined,
        page,
        perPage,
      }),
    );
  });

  router.post(
    "/api/terms",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const term = await createTerm(db, {
        name: body.name as string,
        slug: body.slug as string | undefined,
        taxonomy: body.taxonomy as string,
        description: body.description as string | undefined,
        parentId: body.parentId as number | undefined,
      });
      await log(db, user, "term.create", "term", term.termTaxonomyId);
      return jsonOk(term, 201);
    },
    { capability: "manage_categories" },
  );

  router.get("/api/terms/:id", async ({ env, params }) => {
    const db = adaptD1(env.DB);
    return jsonOk(await getTerm(db, parseIdParam(params.id, "term id")));
  });

  router.put(
    "/api/terms/:id",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const term = await updateTerm(db, parseIdParam(params.id, "term id"), {
        name: body.name as string | undefined,
        slug: body.slug as string | undefined,
        description: body.description as string | undefined,
        parentId: body.parentId as number | undefined,
      });
      await log(db, user, "term.update", "term", term.termTaxonomyId);
      return jsonOk(term);
    },
    { capability: "manage_categories" },
  );

  router.delete(
    "/api/terms/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "term id");
      await deleteTerm(db, id);
      await log(db, user, "term.delete", "term", id);
      return jsonOk({ deleted: true });
    },
    { capability: "manage_categories" },
  );

  router.get("/api/posts/:id/terms", async ({ env, params, url }) => {
    const db = adaptD1(env.DB);
    return jsonOk(await getPostTerms(db, parseIdParam(params.id, "post id"), url.searchParams.get("taxonomy") ?? undefined));
  });

  router.post(
    "/api/posts/:id/terms",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const terms = await setPostTerms(
        db,
        parseIdParam(params.id, "post id"),
        requireString(body.taxonomy, "taxonomy"),
        (body.termIds as number[] | undefined) ?? [],
      );
      await log(db, user, "post.terms_set", "post", parseIdParam(params.id, "post id"));
      return jsonOk(terms);
    },
    { capability: "edit_posts" },
  );

  router.delete(
    "/api/posts/:id/terms/:termId",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const terms = await removePostTerm(
        db,
        parseIdParam(params.id, "post id"),
        parseIdParam(params.termId, "term id"),
      );
      await log(db, user, "post.term_remove", "post", parseIdParam(params.id, "post id"));
      return jsonOk(terms);
    },
    { capability: "edit_posts" },
  );

  // ---------------------------------------------------------------- comments
  router.get(
    "/api/comments",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const postParam = url.searchParams.get("postId");
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(
        await listComments(db, {
          postId: postParam !== null ? Number(postParam) : undefined,
          status: (url.searchParams.get("status") as never) ?? undefined,
          page,
          perPage,
        }),
      );
    },
    { capability: "moderate_comments" },
  );

  router.get("/api/posts/:slug/comments", async ({ env, params }) => {
    const db = adaptD1(env.DB);
    const post = await getPostBySlug(db, params.slug ?? "");
    if (!post) throw new WordlessError("not_found", 404, "Post not found.");
    return jsonOk(await listApprovedThreaded(db, post.id));
  });

  router.post("/api/posts/:slug/comments", async ({ request, env, user, params }) => {
    const db = adaptD1(env.DB);
    const post = await getPostBySlug(db, params.slug ?? "");
    if (!post) throw new WordlessError("not_found", 404, "Post not found.");
    const body = await readJsonBody<Record<string, unknown>>(request);
    const comment = await createComment(
      db,
      {
        postId: post.id,
        author: String(body.author ?? ""),
        authorEmail: String(body.author_email ?? ""),
        authorUrl: String(body.author_url ?? ""),
        content: String(body.content ?? ""),
        parentId: body.parentId !== undefined ? Number(body.parentId) : undefined,
        userId: user?.id ?? 0,
        authorIp: request.headers.get("CF-Connecting-IP") ?? "",
        honeypot: String(body.website ?? body.honeypot ?? ""),
      },
      { canModerate: user !== null && userCan(user, "moderate_comments") },
    );
    await log(db, user, "comment.create", "comment", comment.id);
    return jsonOk(comment, 201);
  });

  router.post("/api/comments/:id/approve", async ({ env, user, params }) => {
    const db = adaptD1(env.DB);
    const comment = await setCommentStatus(db, parseIdParam(params.id, "comment id"), "approved");
    await log(db, user, "comment.approve", "comment", comment.id);
    return jsonOk(comment);
  }, { capability: "moderate_comments" });

  router.post("/api/comments/:id/spam", async ({ env, user, params }) => {
    const db = adaptD1(env.DB);
    const comment = await setCommentStatus(db, parseIdParam(params.id, "comment id"), "spam");
    await log(db, user, "comment.spam", "comment", comment.id);
    return jsonOk(comment);
  }, { capability: "moderate_comments" });

  router.post("/api/comments/:id/trash", async ({ env, user, params }) => {
    const db = adaptD1(env.DB);
    const comment = await setCommentStatus(db, parseIdParam(params.id, "comment id"), "trash");
    await log(db, user, "comment.trash", "comment", comment.id);
    return jsonOk(comment);
  }, { capability: "moderate_comments" });

  router.delete(
    "/api/comments/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "comment id");
      await deleteComment(db, id);
      await log(db, user, "comment.delete", "comment", id);
      return jsonOk({ deleted: true });
    },
    { capability: "moderate_comments" },
  );

  // ------------------------------------------------------------------- menus
  router.get(
    "/api/menus",
    async ({ env }) => jsonOk(await listMenus(adaptD1(env.DB))),
    { requireAuth: true },
  );

  router.post(
    "/api/menus",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const menu = await createMenu(db, requireString(body.name, "name", { max: 200 }));
      await log(db, user, "menu.create", "menu", menu.id);
      return jsonOk(menu, 201);
    },
    { capability: "edit_theme_options" },
  );

  // Registered before /api/menus/:id so "locations" is not read as an id.
  router.get(
    "/api/menus/locations",
    async ({ env }) => jsonOk(await getMenuLocations(adaptD1(env.DB))),
    { requireAuth: true },
  );

  router.post(
    "/api/menus/locations",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const locations = await setMenuLocation(
        db,
        requireString(body.location, "location"),
        body.menuId === null || body.menuId === undefined ? null : Number(body.menuId),
      );
      await log(db, user, "menu.location_set", "menu", 0);
      return jsonOk(locations);
    },
    { capability: "edit_theme_options" },
  );

  router.get("/api/menus/location/:location", async ({ env, params }) => {
    return jsonOk(await resolveMenuByLocation(adaptD1(env.DB), params.location ?? ""));
  });

  router.delete(
    "/api/menus/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "menu id");
      await deleteMenu(db, id);
      await log(db, user, "menu.delete", "menu", id);
      return jsonOk({ deleted: true });
    },
    { capability: "edit_theme_options" },
  );

  router.get(
    "/api/menus/:id/items",
    async ({ env, params }) => jsonOk(await listMenuItems(adaptD1(env.DB), parseIdParam(params.id, "menu id"))),
    { requireAuth: true },
  );

  router.post(
    "/api/menus/:id/items",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const item = await addMenuItem(db, parseIdParam(params.id, "menu id"), {
        title: body.title as string,
        type: body.type as never,
        url: body.url as string | undefined,
        objectId: body.objectId as number | undefined,
        parentId: body.parentId as number | undefined,
        position: body.position as number | undefined,
      });
      await log(db, user, "menu.item_add", "menu", parseIdParam(params.id, "menu id"));
      return jsonOk(item, 201);
    },
    { capability: "edit_theme_options" },
  );

  router.put(
    "/api/menus/:id/items/:itemId",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const item = await updateMenuItem(
        db,
        parseIdParam(params.id, "menu id"),
        parseIdParam(params.itemId, "menu item id"),
        {
          title: body.title as string | undefined,
          url: body.url as string | undefined,
          parentId: body.parentId as number | undefined,
          position: body.position as number | undefined,
        },
      );
      await log(db, user, "menu.item_update", "menu", parseIdParam(params.id, "menu id"));
      return jsonOk(item);
    },
    { capability: "edit_theme_options" },
  );

  router.delete(
    "/api/menus/:id/items/:itemId",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const menuId = parseIdParam(params.id, "menu id");
      await removeMenuItem(db, menuId, parseIdParam(params.itemId, "menu item id"));
      await log(db, user, "menu.item_remove", "menu", menuId);
      return jsonOk({ deleted: true });
    },
    { capability: "edit_theme_options" },
  );

  // ------------------------------------------------------------------ search
  router.get("/api/search", async ({ url, env }) => {
    const db = adaptD1(env.DB);
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
    return jsonOk(
      await searchPosts(db, url.searchParams.get("q") ?? "", {
        page,
        perPage,
        type: url.searchParams.get("type") ?? undefined,
      }),
    );
  });

  // -------------------------------------------------------------- permalinks
  router.get("/api/permalinks", async ({ env }) => {
    return jsonOk({ structure: await getPermalinkStructure(adaptD1(env.DB)) });
  });

  router.put(
    "/api/permalinks",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const structure = await setPermalinkStructure(db, requireString(body.structure, "structure"));
      await log(db, user, "settings.permalink", "option", 0);
      return jsonOk({ structure });
    },
    { capability: "manage_options" },
  );

  // --------------------------------------------------------------------- media
  router.get(
    "/api/media",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(
        await listMedia(db, {
          page,
          perPage,
          mimeType: url.searchParams.get("mime") ?? undefined,
        }),
      );
    },
    { capability: "upload_files" },
  );

  router.post(
    "/api/media",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new WordlessError("bad_request", 400, 'Upload requires a multipart "file" field.');
      }
      const title = typeof form.get("title") === "string" ? (form.get("title") as string) : undefined;
      const alt = typeof form.get("alt") === "string" ? (form.get("alt") as string) : undefined;
      const data = new Uint8Array(await file.arrayBuffer());
      const record = await uploadMedia(db, new R2MediaStorage(env.MEDIA), {
        filename: file.name,
        mimeType: file.type,
        data,
        authorId: user?.id ?? 0,
        title,
        alt,
      });
      await log(db, user, "media.upload", "media", record.id);
      return jsonOk(record, 201);
    },
    { capability: "upload_files" },
  );

  router.get(
    "/api/media/:id",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      const record = await getMediaRecord(db, parseIdParam(params.id, "media id"));
      if (!record) throw new WordlessError("not_found", 404, "Media item not found.");
      return jsonOk(record);
    },
    { capability: "upload_files" },
  );

  router.put(
    "/api/media/:id",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const record = await updateMediaAlt(db, parseIdParam(params.id, "media id"), String(body.alt ?? ""));
      await log(db, user, "media.alt_update", "media", record.id);
      return jsonOk(record);
    },
    { capability: "upload_files" },
  );

  router.delete(
    "/api/media/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "media id");
      const deleted = await deleteMedia(db, new R2MediaStorage(env.MEDIA), id);
      await log(db, user, "media.delete", "media", id);
      return jsonOk({ deleted });
    },
    { capability: "upload_files" },
  );

  // Serve a stored object: GET /media/<object-key> (flat keys, no slashes).
  router.get("/media/:key", async ({ env, params }) => {
    const db = adaptD1(env.DB);
    const key = params.key ?? "";
    const record = await findMediaByKey(db, key);
    if (!record) throw new WordlessError("not_found", 404, "Media file not found.");
    const stored = await new R2MediaStorage(env.MEDIA).get(key);
    if (!stored) throw new WordlessError("not_found", 404, "Media file not found.");
    return new Response(stored.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": record.mimeType,
        // Object keys are UUID-prefixed and immutable: cache aggressively.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  // ------------------------------------------------------------ conversion (M4)
  // A conversion job runs the static PHP → TypeScript pipeline on one
  // uploaded file or on the hello-dolly fixture. In local dev the job
  // runs synchronously inside the request; in production a Queue/Workflow
  // consumer calls the same runConversionJob(db, jobId). The uploaded PHP
  // is NEVER executed — see src/conversion/safety.ts.
  router.post(
    "/api/conversion/jobs",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const contentType = request.headers.get("Content-Type") ?? "";
      let input: { filename: string; source?: string; fixture?: string };
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new WordlessError("bad_request", 400, 'Upload requires a multipart "file" field.');
        }
        input = { filename: file.name, source: await file.text() };
      } else {
        const body = await readJsonBody<Record<string, unknown>>(request);
        if (typeof body.fixture === "string") {
          input = { filename: "hello.php", fixture: body.fixture };
        } else {
          input = {
            filename: requireString(body.filename, "filename", { max: 200 }),
            source: requireString(body.source, "source", { max: MAX_PHP_BYTES + 100 }),
          };
        }
      }
      const created = await createConversionJob(db, input);
      const locale = await getOption<string>(db, "site_locale", "en_US");
      const wp = createWordPressApi({ db, currentUser: user ?? null, locale });
      const finished = await runConversionJob(db, created.id, {
        resolveFixture: async (fixture) => {
          const known = CONVERSION_FIXTURES[fixture];
          if (known === undefined) {
            throw new WordlessError("bad_request", 400, `Unknown conversion fixture "${fixture}".`);
          }
          const sourceUrl = FIXTURE_SOURCE_URLS[fixture];
          if (sourceUrl === undefined) {
            throw new WordlessError("bad_request", 400, `Fixture "${fixture}" has no pinned upstream source.`);
          }
          const res = await fetch(sourceUrl);
          if (!res.ok) {
            throw new WordlessError(
              "bad_gateway",
              502,
              `Could not fetch the ${fixture} fixture source (upstream HTTP ${res.status}). Try uploading the PHP file instead.`,
            );
          }
          return { source: await res.text(), filename: known.filename };
        },
        onSuccess: async (report) => {
          // A bundled extension (hello-dolly) is installed and activated
          // in this request: the hook registry is a module-level
          // singleton, so its hooks register for this isolate. A cold
          // start does not re-activate extensions — per-request extension
          // loading at Worker startup is a later milestone.
          const bundled = bundledExtension(report.extension.slug);
          if (bundled === undefined) return;
          await installExtension(db, {
            slug: bundled.slug,
            name: bundled.name,
            version: bundled.version,
            kind: "plugin",
            source: `conversion:${created.id}`,
            status: "active",
          });
          bundled.activate(wp);
        },
      });
      await log(db, user, "conversion.job", "job", 0);
      return jsonOk(finished, 201);
    },
    { capability: "install_plugins" },
  );

  router.get(
    "/api/conversion/jobs",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listConversionJobs(db, { page, perPage }));
    },
    { capability: "install_plugins" },
  );

  router.get(
    "/api/conversion/jobs/:id",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await getConversionJob(db, params.id ?? ""));
    },
    { capability: "install_plugins" },
  );

  // ------------------------------------------------------------ extensions (M4)
  // Installed extensions (wl_extensions). The conversion job installs a
  // bundled extension on success; this list is what the admin shows.
  router.get(
    "/api/extensions",
    async ({ env }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await listExtensions(db));
    },
    { capability: "install_plugins" },
  );

  // -------------------------------------------------------------------- auth
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
    await log(db, result.user, "auth.login", "user", result.user.id);
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

  router.post(
    "/api/auth/logout",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const token = parseSessionCookie(request.headers.get("Cookie"));
      if (token) await revokeSession(db, token);
      if (user) await log(db, user, "auth.logout", "user", user.id);
      const response = jsonOk({ loggedOut: true });
      response.headers.set("Set-Cookie", clearSessionCookie());
      return response;
    },
    { requireAuth: true },
  );

  router.get(
    "/api/auth/me",
    async ({ user }) => {
      // requireAuth guarantees user is non-null; the guard above is the check.
      return jsonOk({
        user: {
          id: user!.id,
          login: user!.login,
          email: user!.email,
          displayName: user!.displayName,
          role: user!.role,
        },
      });
    },
    { requireAuth: true },
  );

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

  // ---------------------------------------------------------------- settings
  router.get(
    "/api/settings",
    async ({ env }) => jsonOk(await getSettings(adaptD1(env.DB))),
    { requireAuth: true },
  );

  router.put(
    "/api/settings",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const settings = await updateSettings(db, body);
      await log(db, user, "settings.update", "option", 0);
      return jsonOk(settings);
    },
    { capability: "manage_options" },
  );

  // --------------------------------------------------------------------- users
  router.get(
    "/api/users",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listUsers(db, { page, perPage }));
    },
    { capability: "edit_users" },
  );

  router.post(
    "/api/users",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const created = await createUser(db, {
        login: body.login as string,
        email: body.email as string,
        password: body.password as string,
        displayName: body.displayName as string | undefined,
        role: isRole(body.role) ? body.role : undefined,
      });
      await log(db, user, "user.create", "user", created.id);
      return jsonOk(created, 201);
    },
    { capability: "edit_users" },
  );

  router.put(
    "/api/users/:id/role",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (!isRole(body.role)) {
        throw new WordlessError("bad_request", 400, 'Field "role" must be a valid role.');
      }
      const updated = await setUserRole(db, parseIdParam(params.id, "user id"), body.role);
      await log(db, user, "user.role_change", "user", updated.id);
      return jsonOk(updated);
    },
    { capability: "edit_users" },
  );

  router.delete(
    "/api/users/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "user id");
      const deleted = await deleteUser(db, id);
      await log(db, user, "user.delete", "user", id);
      return jsonOk({ deleted });
    },
    { capability: "edit_users" },
  );

  router.post(
    "/api/users/:id/reset-password",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "user id");
      // The temporary password is returned ONCE in this response. It is
      // never logged and never stored in plaintext (only the hash is).
      const { user: updated, temporaryPassword } = await resetUserPassword(db, id);
      await log(db, user, "user.password_reset", "user", id);
      return jsonOk({ user: updated, temporaryPassword });
    },
    { capability: "edit_users" },
  );

  // ------------------------------------------------------- feeds + sitemap
  router.get("/feed", async ({ env }) => {
    const xml = await rssFeed(adaptD1(env.DB));
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
  });

  router.get("/sitemap.xml", async ({ env }) => {
    const xml = await sitemapXml(adaptD1(env.DB));
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8" } });
  });

  router.get("/robots.txt", async ({ env }) => {
    const txt = await robotsTxt(adaptD1(env.DB));
    return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  });

  // ------------------------------------------------------------- public site
  router.get("/", async ({ env, url }) => {
    const db = adaptD1(env.DB);
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const rendered = await renderHome(db, page);
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/search", async ({ env, url }) => {
    const db = adaptD1(env.DB);
    const q = url.searchParams.get("q") ?? "";
    if (q.trim().length === 0) {
      const rendered = await renderHome(db, 1);
      return htmlResponse(rendered.html, rendered.status);
    }
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const rendered = await renderSearchPage(db, q, page);
    return htmlResponse(rendered.html, rendered.status);
  });

  // The admin is a React SPA served from Static Assets (see fetch() below);
  // there is no server-rendered admin shell anymore (M3 removed admin-shell.ts).

  return router;
}

/** Public GET fallback: resolve the path through permalinks. */
async function handlePublicGet(db: Db, url: URL): Promise<Response> {
  const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
  const plainId = url.searchParams.get("p");
  if (plainId !== null) {
    const post = await resolvePostById(db, Number(plainId));
    if (post) {
      const rendered = post.type === "page" ? await renderPage(db, post) : await renderSingle(db, post);
      return htmlResponse(rendered.html, rendered.status);
    }
    const notFoundPage = await renderNotFound(db);
    return htmlResponse(notFoundPage.html, 404);
  }
  const resolved = await resolvePath(db, url.pathname);
  switch (resolved.kind) {
    case "redirect":
      return new Response(null, { status: 301, headers: { Location: resolved.target } });
    case "home": {
      const rendered = await renderHome(db, page);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "post": {
      const rendered = await renderSingle(db, resolved.post);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "page": {
      const rendered = await renderPage(db, resolved.post);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "term": {
      const rendered = await renderTermArchive(db, resolved.term, page);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "date-archive": {
      const rendered = await renderDateArchive(db, resolved.year, resolved.month, page);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "not-found": {
      const rendered = await renderNotFound(db);
      return htmlResponse(rendered.html, 404);
    }
  }
}

/** Public comment submission from the rendered form: /{slug}/comments. */
async function handlePublicCommentPost(request: Request, db: Db, url: URL, user: AuthUser | null): Promise<Response> {
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const slug = segments.length === 2 ? segments[0] : undefined;
  if (slug === undefined || segments[1] !== "comments") {
    const notFoundPage = await renderNotFound(db);
    return htmlResponse(notFoundPage.html, 404);
  }
  const post = await getPostBySlug(db, slug);
  if (!post) {
    const notFoundPage = await renderNotFound(db);
    return htmlResponse(notFoundPage.html, 404);
  }
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    let author = "";
    let authorEmail = "";
    let authorUrl = "";
    let content = "";
    let parentId = 0;
    let honeypot = "";
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      author = String(form.get("author") ?? "");
      authorEmail = String(form.get("author_email") ?? "");
      authorUrl = String(form.get("author_url") ?? "");
      content = String(form.get("content") ?? "");
      parentId = Number(form.get("parent_id") ?? 0);
      honeypot = String(form.get("website") ?? "");
    } else {
      const body = await readJsonBody<Record<string, unknown>>(request);
      author = String(body.author ?? "");
      authorEmail = String(body.author_email ?? "");
      authorUrl = String(body.author_url ?? "");
      content = String(body.content ?? "");
      parentId = Number(body.parentId ?? 0);
      honeypot = String(body.website ?? body.honeypot ?? "");
    }
    const comment = await createComment(
      db,
      {
        postId: post.id,
        author,
        authorEmail,
        authorUrl,
        content,
        parentId: Number.isInteger(parentId) && parentId > 0 ? parentId : undefined,
        userId: user?.id ?? 0,
        authorIp: request.headers.get("CF-Connecting-IP") ?? "",
        honeypot,
      },
      { canModerate: user !== null && userCan(user, "moderate_comments") },
    );
    await log(db, user, "comment.create", "comment", comment.id);
    const postLink = await postUrl(db, post);
    return new Response(null, { status: 303, headers: { Location: `${postLink}#comments` } });
  } catch (err) {
    const message = err instanceof WordlessError ? err.message : "Could not save your comment.";
    const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return new Response(
      `<!DOCTYPE html><html><head><title>Comment error</title></head><body><h1>Could not save your comment</h1><p>${safe}</p><p><a href="/">Go home</a></p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

/** Serve the React admin SPA from Static Assets (admin/dist/admin/). */
async function serveAdmin(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return htmlResponse(
      "<!DOCTYPE html><html><head><title>Wordless admin</title></head><body><h1>Admin build not found</h1><p>The admin SPA has not been built yet. Run <code>npm run build:admin</code> and restart the dev server.</p></body></html>",
      503,
    );
  }
  const url = new URL(request.url);
  try {
    // Fetcher is typed against the Workers Request/Response, not the DOM
    // lib's — the cast is safe: both are the same runtime objects.
    const asset = (await env.ASSETS.fetch(
      request as unknown as Parameters<Env["ASSETS"]["fetch"]>[0],
    )) as unknown as Response;
    if (asset.status !== 404) return asset;
    // Missing asset file: client routes (hash routing means these are rare)
    // fall back to the SPA entry point; missing files under /admin/assets/
    // stay 404 so broken bundles are visible instead of masked.
    if (url.pathname.startsWith("/admin/assets/")) return asset;
    return (await env.ASSETS.fetch(
      new Request(new URL("/admin/index.html", url), request) as unknown as Parameters<
        Env["ASSETS"]["fetch"]
      >[0],
    )) as unknown as Response;
  } catch {
    return htmlResponse(
      "<!DOCTYPE html><html><head><title>Wordless admin</title></head><body><h1>Admin unavailable</h1><p>The admin SPA could not be loaded. Run <code>npm run build:admin</code> and restart the dev server.</p></body></html>",
      503,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const db = adaptD1(env.DB);
      const token = parseSessionCookie(request.headers.get("Cookie"));
      const user = await userFromSession(db, token);
      const url = new URL(request.url);

      // The admin SPA lives under /admin and is served from Static Assets
      // before any routing — API and public-site routes never reach it.
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        return serveAdmin(request, env);
      }

      // Anonymous public GETs are cacheable; never cache API/admin/logged-in traffic.
      const cacheable =
        request.method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/admin") &&
        token === null;
      if (cacheable) {
        try {
          // `caches.default` is a Workers extension; the TS DOM lib does not
          // declare it, so it is reached through a narrow cast.
          const cache = (caches as unknown as { default: Cache }).default;
          const cached = await cache.match(request);
          if (cached) return cached;
        } catch {
          // Cache API unavailable (e.g. some local runtimes) — serve uncached.
        }
      }

      let response = await buildRouter().handle(request, env, user);

      // Public fallback: anything that is not an API/admin route is a site URL.
      if (response.status === 404 && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/admin")) {
        if (request.method === "GET") {
          response = await handlePublicGet(db, url);
        } else if (request.method === "POST" && url.pathname.endsWith("/comments")) {
          response = await handlePublicCommentPost(request, db, url, user);
        }
      }

      if (cacheable && response.status === 200) {
        try {
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", "public, max-age=60");
          const cacheableResponse = new Response(response.body, { status: response.status, headers });
          const cache = (caches as unknown as { default: Cache }).default;
          await cache.put(request, cacheableResponse.clone());
          return cacheableResponse;
        } catch {
          // Cache write failures must not break the response.
        }
      }
      return response;
    } catch (err) {
      if (err instanceof WordlessError) {
        return jsonError(err.code, err.status, err.message);
      }
      console.error("Unhandled worker error", err);
      return jsonError("internal_error", 500, "An unexpected error occurred.");
    }
  },
};
