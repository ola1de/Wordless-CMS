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
import { listAgents } from "./ai/agents/registry";
import { addNote, deleteNote, listMemory, rebuildMemory } from "./ai/memory";
import { createAiTask, getAiTask, listAiTasks, runAiTask } from "./ai/orchestrator";
import {
  getProvider,
  getSelectedProviderId,
  listProviderInfo,
  resolveProvider,
  setSelectedProviderId,
} from "./ai/providers/index";
import { isProviderId } from "./ai/providers/types";
import { AI_MODE_DESCRIPTIONS } from "./ai/types";
import { createWordPressApi } from "./compat/wordpress";
import { adaptD1, nowIso } from "./db";
import type { Db } from "./db";
import type { Env } from "./env";
import { WordlessError } from "./kernel/errors";
import { jsonError, jsonOk, readJsonBody, Router } from "./kernel/router";
import { intInRange, requireString } from "./kernel/validate";
import { decideApproval, getAiMode, listApprovals, setAiMode } from "./modules/ai/service";
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
import { rssFeed, siteUrl } from "./modules/feeds/service";
import { getRobotsTxt, setRobotsTxt } from "./modules/seo/robots";
import { sitemapXml } from "./modules/seo/sitemap";
import { getPostSeo, setPostSeo } from "./modules/seo/meta";
import { analyzePostSeo } from "./modules/seo/analyze";
import { createRedirect, deleteRedirect, listRedirects, updateRedirect } from "./modules/seo/redirects";
import { deleteNotFound, listNotFound, logNotFound } from "./modules/seo/notfound";
import { contentCalendar, createFromTemplate, listTemplates } from "./modules/seo/studio";
import { importSeoMetadata } from "./modules/seo/import";
import { siteHealth } from "./modules/health/service";
import { getIntegrationConfig, setIntegrationConfig } from "./modules/integrations/config";
import { listIntegrations } from "./modules/integrations/registry";
import { listMailLog, sendMail } from "./modules/integrations/email";
import { getAnalyticsStatus } from "./modules/integrations/analytics";
import { cloudflareBindingStatus } from "./modules/integrations/cloudflare";
import {
  installExtensionFromZip,
  listMarketplaceExtensions,
  setMarketplaceExtensionStatus,
} from "./modules/integrations/marketplace";
import { createProduct, deleteProduct, getProduct, getProductBySlug, listProducts, updateProduct } from "./modules/commerce/products";
import { addToCart, cartCookieHeader, clearCart, getCart, newCartToken, parseCartCookie, setCartQuantity } from "./modules/commerce/cart";
import { createOrderFromCart, getOrder, listOrders, setOrderPayment, transitionOrder } from "./modules/commerce/orders";
import { handlePaymentWebhook, listWebhookLog } from "./modules/commerce/webhooks";
import {
  getPaymentMode,
  getSelectedPaymentProviderId,
  listPaymentProviders,
  resolvePaymentProvider,
  setPaymentMode,
  setSelectedPaymentProviderId,
} from "./modules/commerce/payments/index";
import { isPaymentProviderId } from "./modules/commerce/payments/types";
import { hmacHex } from "./modules/commerce/payments/hmac";
import type { OrderStatus } from "./modules/commerce/types";
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
  getPostById,
  getPostBySlug,
  listPosts,
  restorePost,
  trashPost,
  updatePost,
} from "./modules/posts/service";
import type { PostStatus } from "./modules/posts/types";
import {
  renderDateArchive,
  renderCartPage,
  renderCheckoutResult,
  renderHome,
  renderNotFound,
  renderPage,
  renderProductPage,
  renderShop,
  renderSingle,
  renderTermArchive,
  renderTestCheckout,
  renderSearchPage,
  type RenderOptions,
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
import {
  activateTheme,
  createPreview,
  deleteTheme,
  deleteVariation,
  getActiveThemeSlug,
  getActiveStylesheet,
  getPreview,
  getTheme,
  getThemeDetail,
  getVariation,
  importClassicTheme,
  importTheme,
  listThemes,
  saveVariation,
} from "./modules/themes/service";
import { getSettings, updateSettings } from "./modules/settings/service";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserRole,
} from "./modules/users/service";
import { isRole } from "./modules/users/capabilities";

const VERSION = "0.8.0";

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

/**
 * Best-effort comment notification (M8). Sends to the site's admin_email
 * via the email integration when one is configured; in test mode the
 * message is only logged in wl_mail_log (never claimed delivered). A
 * mail failure never breaks comment creation.
 */
async function notifyAdminOfComment(
  db: Db,
  env: Env,
  postTitle: string,
  commentAuthor: string,
  commentContent: string,
): Promise<void> {
  try {
    const adminEmail = await getOption<string>(db, "admin_email", "");
    if (adminEmail === "") return;
    const siteName = await getOption<string>(db, "blogname", "Wordless");
    await sendMail(db, env, {
      to: adminEmail,
      subject: `[${siteName}] New comment on "${postTitle}"`,
      text: `${commentAuthor} commented on "${postTitle}":\n\n${commentContent}`,
    });
  } catch {
    // Notifications are best-effort.
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
    // Numeric "slugs" are post IDs (the editor loads /api/posts/<id>).
    // This was missing before M7: the editor's load-by-ID 404'd.
    const post = /^\d+$/.test(slug) ? await getPostById(db, Number(slug)) : await getPostBySlug(db, slug);
    if (!post || post.status === "trash") {
      throw new WordlessError("not_found", 404, `No post found with slug "${params.slug}".`);
    }
    // Drafts and private posts are visible only to logged-in users.
    if (post.status !== "publish" && user === null) {
      throw new WordlessError("unauthorized", 401, "Authentication required to view this post.");
    }
    // M7: the post detail payload carries its SEO fields.
    return jsonOk({ ...post, seo: await getPostSeo(db, post.id) });
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
    await notifyAdminOfComment(db, env, post.title, comment.author, comment.content);
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

  // ------------------------------------------------------- ai (M6) providers
  // Workers AI is the DEFAULT and only required provider (user decision,
  // 2026-11-19). The list always says plainly which providers are
  // configured; nothing here pretends AI works when it does not.
  router.get(
    "/api/ai/providers",
    async ({ env }) => {
      const db = adaptD1(env.DB);
      return jsonOk({ providers: listProviderInfo(env), selected: await getSelectedProviderId(db) });
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/providers/select",
    async ({ request, env }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const selected = await setSelectedProviderId(db, body.provider);
      return jsonOk({ providers: listProviderInfo(env), selected });
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/providers/:id/test",
    async ({ env, params }) => {
      const id = params.id ?? "";
      if (!isProviderId(id)) throw new WordlessError("bad_request", 400, `Unknown AI provider "${id}".`);
      const provider = getProvider(id);
      // A probe never errors on "not configured" — it reports it.
      return jsonOk(await provider.test(env));
    },
    { capability: "manage_options" },
  );

  // ------------------------------------------------------------ ai (M6) mode
  router.get(
    "/api/ai/mode",
    async ({ env }) => {
      const mode = await getAiMode(adaptD1(env.DB));
      return jsonOk({ mode, description: AI_MODE_DESCRIPTIONS[mode] });
    },
    { capability: "manage_options" },
  );

  router.put(
    "/api/ai/mode",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const mode = await setAiMode(db, body.mode);
      await log(db, user, "ai.mode", "option", 0);
      return jsonOk({ mode, description: AI_MODE_DESCRIPTIONS[mode] });
    },
    { capability: "manage_options" },
  );

  // ---------------------------------------------------------- ai (M6) agents
  router.get(
    "/api/ai/agents",
    async ({ env }) => {
      const db = adaptD1(env.DB);
      const { configured } = await resolveProvider(db, env);
      return jsonOk(listAgents(configured));
    },
    { capability: "manage_options" },
  );

  // ----------------------------------------------------------- ai (M6) tasks
  // Tasks run synchronously inside the request in local dev (same pattern
  // as conversion jobs); in production a Queue/Workflow consumer calls
  // the same runAiTask(db, jobId, ctx).
  router.post(
    "/api/ai/tasks",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const created = await createAiTask(db, {
        agent: String(body.agent ?? ""),
        input: String(body.input ?? ""),
        mode: body.mode as never,
      });
      const finished = await runAiTask(db, created.id, { env, userId: user?.id ?? 0 });
      await log(db, user, "ai.task", "job", 0);
      return jsonOk(finished, 201);
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/ai/tasks",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listAiTasks(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/ai/tasks/:id",
    async ({ env, params }) => {
      return jsonOk(await getAiTask(adaptD1(env.DB), params.id ?? ""));
    },
    { capability: "manage_options" },
  );

  // ------------------------------------------------------- ai (M6) approvals
  router.get(
    "/api/ai/approvals",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const statusParam = url.searchParams.get("status");
      const status =
        statusParam === "pending" || statusParam === "approved" || statusParam === "rejected" ? statusParam : undefined;
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listApprovals(db, { status, page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/approvals/:id/approve",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const decided = await decideApproval(db, params.id ?? "", { approve: true, userId: user?.id ?? 0 });
      await log(db, user, "ai.approve", "approval", 0);
      return jsonOk(decided);
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/approvals/:id/reject",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
      const decided = await decideApproval(db, params.id ?? "", {
        approve: false,
        userId: user?.id ?? 0,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      await log(db, user, "ai.reject", "approval", 0);
      return jsonOk(decided);
    },
    { capability: "manage_options" },
  );

  // ---------------------------------------------------------- ai (M6) memory
  router.get(
    "/api/ai/memory",
    async ({ env }) => jsonOk(await listMemory(adaptD1(env.DB))),
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/memory/notes",
    async ({ request, env }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      return jsonOk(await addNote(db, String(body.text ?? "")), 201);
    },
    { capability: "manage_options" },
  );

  router.delete(
    "/api/ai/memory/notes/:id",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      const deleted = await deleteNote(db, parseIdParam(params.id, "note id"));
      return jsonOk({ deleted });
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/ai/memory/rebuild",
    async ({ env }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await rebuildMemory(db));
    },
    { capability: "manage_options" },
  );

  // ------------------------------------------------------------------ seo (M7)
  // Per-post SEO fields (edit_posts), analysis, robots, templates,
  // calendar, Yoast/Rank Math import, redirects and the 404 log.
  router.get(
    "/api/posts/:id/seo",
    async ({ env, params }) => {
      return jsonOk(await getPostSeo(adaptD1(env.DB), parseIdParam(params.id, "post id")));
    },
    { capability: "edit_posts" },
  );

  router.put(
    "/api/posts/:id/seo",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "post id");
      const body = await readJsonBody<Record<string, unknown>>(request);
      const seo = await setPostSeo(db, id, {
        title: body.title as string | undefined,
        description: body.description as string | undefined,
        focusKeyword: body.focusKeyword as string | undefined,
        canonical: body.canonical as string | undefined,
        noindex: body.noindex as boolean | undefined,
        ogTitle: body.ogTitle as string | undefined,
        ogDescription: body.ogDescription as string | undefined,
        ogImageId: body.ogImageId as number | undefined,
        twitterCard: body.twitterCard as never,
      });
      await log(db, user, "seo.update", "post", id);
      return jsonOk(seo);
    },
    { capability: "edit_posts" },
  );

  router.get(
    "/api/posts/:id/seo/analysis",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await analyzePostSeo(db, parseIdParam(params.id, "post id"), await siteUrl(db)));
    },
    { capability: "edit_posts" },
  );

  router.get(
    "/api/seo/robots",
    async ({ env }) => jsonOk({ robots: await getRobotsTxt(adaptD1(env.DB)) }),
    { capability: "manage_options" },
  );

  router.put(
    "/api/seo/robots",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const robots = await setRobotsTxt(db, requireString(body.robots, "robots", { max: 10000 }));
      await log(db, user, "seo.robots", "option", 0);
      return jsonOk({ robots });
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/seo/templates",
    async () => jsonOk(listTemplates()),
    { capability: "edit_posts" },
  );

  router.post(
    "/api/seo/templates/:slug/create",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
      const post = await createFromTemplate(db, params.slug ?? "", {
        authorId: user?.id ?? 0,
        title: typeof body.title === "string" ? body.title : undefined,
      });
      await log(db, user, "seo.template_create", "post", post.id);
      return jsonOk(post, 201);
    },
    { capability: "edit_posts" },
  );

  router.get(
    "/api/seo/calendar",
    async ({ env, url }) => {
      const days = intInRange(url.searchParams.get("days"), "days", 1, 90, 30);
      return jsonOk(await contentCalendar(adaptD1(env.DB), days));
    },
    { requireAuth: true },
  );

  router.post(
    "/api/seo/import",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (!Array.isArray(body.posts)) {
        throw new WordlessError("bad_request", 400, 'Import body must be an object with a "posts" array.');
      }
      const result = await importSeoMetadata(db, body.posts as never);
      await log(db, user, "seo.import", "option", 0);
      return jsonOk(result);
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/seo/redirects",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listRedirects(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/seo/redirects",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const redirect = await createRedirect(db, {
        oldPath: requireString(body.oldPath, "oldPath", { max: 500 }),
        newPath: requireString(body.newPath, "newPath", { max: 2000 }),
      });
      await log(db, user, "seo.redirect_create", "redirect", redirect.id);
      return jsonOk(redirect, 201);
    },
    { capability: "manage_options" },
  );

  router.put(
    "/api/seo/redirects/:id",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const redirect = await updateRedirect(db, parseIdParam(params.id, "redirect id"), {
        newPath: requireString(body.newPath, "newPath", { max: 2000 }),
      });
      await log(db, user, "seo.redirect_update", "redirect", redirect.id);
      return jsonOk(redirect);
    },
    { capability: "manage_options" },
  );

  router.delete(
    "/api/seo/redirects/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "redirect id");
      const deleted = await deleteRedirect(db, id);
      await log(db, user, "seo.redirect_delete", "redirect", id);
      return jsonOk({ deleted });
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/seo/404s",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listNotFound(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.delete(
    "/api/seo/404s",
    async ({ url, env, user }) => {
      const db = adaptD1(env.DB);
      const path = url.searchParams.get("path");
      if (path === null || path === "") {
        throw new WordlessError("bad_request", 400, 'Delete needs a "path" query parameter.');
      }
      const deleted = await deleteNotFound(db, path);
      await log(db, user, "seo.404_delete", "option", 0);
      return jsonOk({ deleted });
    },
    { capability: "manage_options" },
  );

  // ------------------------------------------------------- integrations (M8)
  // Registry + config (non-secret fields only — secrets are rejected
  // by setIntegrationConfig and live only in env/secrets), email log,
  // analytics status, Cloudflare binding status.
  router.get(
    "/api/integrations",
    async ({ env }) => jsonOk(await listIntegrations(adaptD1(env.DB), env)),
    { capability: "manage_options" },
  );

  router.get(
    "/api/integrations/:id/config",
    async ({ env, params }) => jsonOk(await getIntegrationConfig(adaptD1(env.DB), params.id ?? "")),
    { capability: "manage_options" },
  );

  router.put(
    "/api/integrations/:id/config",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const config = await setIntegrationConfig(db, params.id ?? "", body);
      await log(db, user, "integration.config", "option", 0);
      return jsonOk(config);
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/integrations/email/log",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listMailLog(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/integrations/analytics/status",
    async ({ env }) => jsonOk(await getAnalyticsStatus(adaptD1(env.DB))),
    { capability: "manage_options" },
  );

  router.get(
    "/api/integrations/cloudflare",
    async ({ env }) => jsonOk(cloudflareBindingStatus(env)),
    { capability: "manage_options" },
  );

  // ---------------------------------------------------------- marketplace (M8)
  // Skeleton: install extensions from a ZIP upload (wordless.json
  // manifest), list them, activate/deactivate. No remote directory.
  router.get(
    "/api/marketplace",
    async ({ env }) => jsonOk(await listMarketplaceExtensions(adaptD1(env.DB))),
    { capability: "install_plugins" },
  );

  router.post(
    "/api/marketplace/install",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new WordlessError("bad_request", 400, 'Install requires a multipart "file" field (.zip).');
      }
      const result = await installExtensionFromZip(
        db,
        new R2MediaStorage(env.MEDIA),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      await log(db, user, "marketplace.install", "extension", 0);
      return jsonOk(result, 201);
    },
    { capability: "install_plugins" },
  );

  router.post(
    "/api/marketplace/:slug/activate",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const extension = await setMarketplaceExtensionStatus(db, params.slug ?? "", "active");
      await log(db, user, "marketplace.activate", "extension", 0);
      return jsonOk(extension);
    },
    { capability: "install_plugins" },
  );

  router.post(
    "/api/marketplace/:slug/deactivate",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const extension = await setMarketplaceExtensionStatus(db, params.slug ?? "", "inactive");
      await log(db, user, "marketplace.deactivate", "extension", 0);
      return jsonOk(extension);
    },
    { capability: "install_plugins" },
  );

  // ------------------------------------------------------------ commerce (M8)
  // Products: public list/detail show published products only; drafts
  // and management need manage_options.
  router.get("/api/commerce/products", async ({ url, env, user }) => {
    const db = adaptD1(env.DB);
    const statusParam = url.searchParams.get("status");
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
    const isAdmin = user !== null && userCan(user, "manage_options");
    if (statusParam !== null && statusParam !== "published" && !isAdmin) {
      throw new WordlessError("forbidden", 403, "You do not have permission to do that.");
    }
    return jsonOk(
      await listProducts(db, {
        status: statusParam === "draft" ? "draft" : statusParam === "all" ? undefined : "published",
        page,
        perPage,
      }),
    );
  });

  router.post(
    "/api/commerce/products",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const product = await createProduct(db, body as never);
      await log(db, user, "product.create", "product", product.id);
      return jsonOk(product, 201);
    },
    { capability: "manage_options" },
  );

  router.get("/api/commerce/products/:id", async ({ env, user, params }) => {
    const db = adaptD1(env.DB);
    const product = await getProduct(db, parseIdParam(params.id, "product id"));
    if (product === null) throw new WordlessError("not_found", 404, "Product not found.");
    if (product.status !== "published" && !(user !== null && userCan(user, "manage_options"))) {
      throw new WordlessError("not_found", 404, "Product not found.");
    }
    return jsonOk(product);
  });

  router.put(
    "/api/commerce/products/:id",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "product id");
      const body = await readJsonBody<Record<string, unknown>>(request);
      const product = await updateProduct(db, id, body as never);
      await log(db, user, "product.update", "product", product.id);
      return jsonOk(product);
    },
    { capability: "manage_options" },
  );

  router.delete(
    "/api/commerce/products/:id",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const id = parseIdParam(params.id, "product id");
      const deleted = await deleteProduct(db, id);
      await log(db, user, "product.delete", "product", id);
      return jsonOk({ deleted });
    },
    { capability: "manage_options" },
  );

  // Cart: server-side, keyed by the `wordless_cart` cookie. The cookie
  // is set on the response when a cart is first created.
  router.get("/api/commerce/cart", async ({ env, request }) => {
    const db = adaptD1(env.DB);
    let token = parseCartCookie(request.headers.get("Cookie"));
    let created = false;
    if (token === null) {
      token = newCartToken();
      created = true;
    }
    const cart = await getCart(db, token);
    const response = jsonOk(cart);
    if (created) response.headers.set("Set-Cookie", cartCookieHeader(token));
    return response;
  });

  router.post("/api/commerce/cart", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const body = await readJsonBody<Record<string, unknown>>(request);
    let token = parseCartCookie(request.headers.get("Cookie"));
    let created = false;
    if (token === null) {
      token = newCartToken();
      created = true;
    }
    const cart = await addToCart(db, token, Number(body.productId), Number(body.quantity ?? 1));
    const response = jsonOk(cart);
    if (created) response.headers.set("Set-Cookie", cartCookieHeader(token));
    return response;
  });

  router.put("/api/commerce/cart", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const body = await readJsonBody<Record<string, unknown>>(request);
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token === null) throw new WordlessError("bad_request", 400, "The cart is empty.");
    return jsonOk(await setCartQuantity(db, token, Number(body.productId), Number(body.quantity ?? 0)));
  });

  router.delete("/api/commerce/cart", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token !== null) await clearCart(db, token);
    return jsonOk({ cleared: true });
  });

  // Checkout (API): creates a pending order from the cart, then starts
  // a payment with the selected provider. With no provider configured
  // this is a 503 — never a fake success.
  router.post("/api/commerce/checkout", async ({ request, env, user }) => {
    const db = adaptD1(env.DB);
    const body = await readJsonBody<Record<string, unknown>>(request);
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token === null) throw new WordlessError("bad_request", 400, "The cart is empty.");
    const order = await createOrderFromCart(db, token, {
      customerName: body.customerName,
      customerEmail: body.customerEmail,
    });
    const { provider } = await resolvePaymentProvider(db, env);
    const base = await siteUrl(db);
    const checkout = await provider.createCheckout(env, {
      order,
      siteUrl: base,
      successUrl: `${base}/shop/checkout/success?order=${order.id}`,
      cancelUrl: `${base}/shop/checkout/cancelled?order=${order.id}`,
    });
    const updated = await setOrderPayment(db, order.id, provider.id, checkout.reference);
    await log(db, user, "order.create", "order", 0);
    return jsonOk({ order: updated, checkoutUrl: checkout.checkoutUrl, reference: checkout.reference }, 201);
  });

  // Orders (admin).
  router.get(
    "/api/commerce/orders",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const statusParam = url.searchParams.get("status");
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      const status =
        statusParam === "pending" || statusParam === "paid" || statusParam === "fulfilled" || statusParam === "cancelled"
          ? (statusParam as OrderStatus)
          : undefined;
      return jsonOk(await listOrders(db, { status, page, perPage }));
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/commerce/orders/:id",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      const order = await getOrder(db, params.id ?? "");
      if (order === null) throw new WordlessError("not_found", 404, "Order not found.");
      return jsonOk(order);
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/commerce/orders/:id/transition",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const to = body.status;
      if (to !== "paid" && to !== "fulfilled" && to !== "cancelled") {
        throw new WordlessError("bad_request", 400, 'Field "status" must be "paid", "fulfilled" or "cancelled".');
      }
      const order = await transitionOrder(db, params.id ?? "", to as OrderStatus);
      await log(db, user, "order.transition", "order", 0);
      return jsonOk(order);
    },
    { capability: "manage_options" },
  );

  // Payment provider selection + status.
  router.get(
    "/api/commerce/payments/providers",
    async ({ env }) => jsonOk(listPaymentProviders(env)),
    { capability: "manage_options" },
  );

  router.get(
    "/api/commerce/payments/selected",
    async ({ env }) => {
      const db = adaptD1(env.DB);
      return jsonOk({
        provider: await getSelectedPaymentProviderId(db),
        mode: await getPaymentMode(db),
      });
    },
    { capability: "manage_options" },
  );

  router.post(
    "/api/commerce/payments/select",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const provider = await setSelectedPaymentProviderId(db, body.provider ?? null);
      const mode = body.mode !== undefined ? await setPaymentMode(db, body.mode) : await getPaymentMode(db);
      await log(db, user, "payment.select", "option", 0);
      return jsonOk({ provider, mode, providers: listPaymentProviders(env) });
    },
    { capability: "manage_options" },
  );

  router.get(
    "/api/commerce/webhooks/log",
    async ({ url, env }) => {
      const db = adaptD1(env.DB);
      const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
      const perPage = intInRange(url.searchParams.get("per_page"), "per_page", 1, 100, 20);
      return jsonOk(await listWebhookLog(db, { page, perPage }));
    },
    { capability: "manage_options" },
  );

  // Payment webhooks: no session auth — the provider signature IS the
  // auth (see src/modules/commerce/webhooks.ts). Always answer 200 for
  // verified-but-unactionable events so providers stop retrying.
  router.post("/api/commerce/webhooks/:provider", async ({ request, env, params }) => {
    const db = adaptD1(env.DB);
    const outcome = await handlePaymentWebhook(db, env, params.provider ?? "", request);
    if (outcome.httpStatus === 401) {
      return jsonError("webhook_rejected", 401, outcome.detail);
    }
    return jsonOk(outcome, outcome.httpStatus);
  });

  // ------------------------------------------------------------------ themes (M5)
  // Literal paths are registered before /api/themes/:slug so "active",
  // "import" and "preview" are never read as a slug (first match wins).
  router.get(
    "/api/themes",
    async ({ env }) => jsonOk(await listThemes(adaptD1(env.DB))),
    { capability: "edit_theme_options" },
  );

  router.get("/api/themes/active", async ({ env }) => {
    const db = adaptD1(env.DB);
    const slug = await getActiveThemeSlug(db);
    const theme = await getTheme(db, slug);
    const variation = await getVariation(db, slug);
    return jsonOk({ active: theme, variation });
  });

  router.post(
    "/api/themes/import",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new WordlessError("bad_request", 400, 'Import requires a multipart "file" field (.zip).');
      }
      const result = await importTheme(db, new R2MediaStorage(env.MEDIA), file.name, new Uint8Array(await file.arrayBuffer()));
      await log(db, user, "theme.import", "theme", 0);
      return jsonOk(result, 201);
    },
    { capability: "edit_theme_options" },
  );

  router.post(
    "/api/themes/import-classic",
    async ({ request, env, user }) => {
      const db = adaptD1(env.DB);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new WordlessError("bad_request", 400, 'Import requires a multipart "file" field (.zip).');
      }
      const result = await importClassicTheme(db, new R2MediaStorage(env.MEDIA), file.name, new Uint8Array(await file.arrayBuffer()));
      await log(db, user, "theme.import_classic", "theme", 0);
      return jsonOk(result, 201);
    },
    { capability: "edit_theme_options" },
  );

  router.post(
    "/api/themes/preview",
    async ({ request, env }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const slug = requireString(body.slug, "slug", { max: 100 });
      const settings = body.settings;
      if (settings === undefined || typeof settings !== "object" || settings === null) {
        throw new WordlessError("bad_request", 400, 'Preview requires a "settings" object.');
      }
      return jsonOk(await createPreview(db, slug, settings as Record<string, unknown>));
    },
    { capability: "edit_theme_options" },
  );

  router.get(
    "/api/themes/:slug",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk(await getThemeDetail(db, new R2MediaStorage(env.MEDIA), params.slug ?? ""));
    },
    { capability: "edit_theme_options" },
  );

  router.post(
    "/api/themes/:slug/activate",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const theme = await activateTheme(db, params.slug ?? "");
      await log(db, user, "theme.activate", "theme", 0);
      return jsonOk(theme);
    },
    { capability: "edit_theme_options" },
  );

  router.post(
    "/api/themes/:slug/delete",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const deleted = await deleteTheme(db, new R2MediaStorage(env.MEDIA), params.slug ?? "");
      await log(db, user, "theme.delete", "theme", 0);
      return jsonOk({ deleted });
    },
    { capability: "edit_theme_options" },
  );

  router.get(
    "/api/themes/:slug/variation",
    async ({ env, params }) => {
      const db = adaptD1(env.DB);
      return jsonOk({ variation: await getVariation(db, params.slug ?? "") });
    },
    { capability: "edit_theme_options" },
  );

  router.put(
    "/api/themes/:slug/variation",
    async ({ request, env, user, params }) => {
      const db = adaptD1(env.DB);
      const body = await readJsonBody<Record<string, unknown>>(request);
      const variation = await saveVariation(db, params.slug ?? "", {
        name: typeof body.name === "string" ? body.name : undefined,
        settings: (body.settings ?? {}) as Record<string, unknown>,
      });
      await log(db, user, "theme.variation_save", "theme", 0);
      return jsonOk(variation);
    },
    { capability: "edit_theme_options" },
  );

  router.delete(
    "/api/themes/:slug/variation",
    async ({ env, user, params }) => {
      const db = adaptD1(env.DB);
      const deleted = await deleteVariation(db, params.slug ?? "");
      await log(db, user, "theme.variation_reset", "theme", 0);
      return jsonOk({ deleted });
    },
    { capability: "edit_theme_options" },
  );

  // The active theme's stylesheet: generated theme.json CSS + style.css
  // (block themes) or the imported style.css (classic themes). Versioned
  // with the stylesheet hash (?v=…) so activation busts the cache; a
  // preview token (?wl_preview=…) applies unsaved variation overrides.
  router.get("/theme.css", async ({ env, url }) => {
    const db = adaptD1(env.DB);
    const { variation } = await resolveVariation(db, url);
    const { css } = await getActiveStylesheet(db, new R2MediaStorage(env.MEDIA), variation);
    return new Response(css, {
      status: 200,
      headers: { "Content-Type": "text/css; charset=utf-8" },
    });
  });

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
      // M8: email the temporary password when the email integration can
      // send; in test mode it is only logged in wl_mail_log. `emailed`
      // says whether the message reached the integration at all — the
      // password is still in this response, so the admin is not locked
      // out if mail is not configured.
      let emailed = false;
      try {
        const sent = await sendMail(db, env, {
          to: updated.email,
          subject: "Your Wordless password was reset",
          text: `Your password was reset by a site administrator. Your temporary password is: ${temporaryPassword}\n\nSign in and change it as soon as you can.`,
        });
        emailed = sent.delivered;
      } catch {
        emailed = false;
      }
      return jsonOk({ user: updated, temporaryPassword, emailed });
    },
    { capability: "edit_users" },
  );

  // -------------------------------------------------------------------- shop (M8)
  // Server-rendered storefront (no JavaScript). Literal routes are
  // registered before /shop/:slug so "cart" and "checkout" are never
  // mistaken for a product slug.
  router.get("/shop", async ({ url, env, request }) => {
    const db = adaptD1(env.DB);
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const rendered = await renderShop(db, page, await renderOpts(db, env, url, request));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/shop/cart", async ({ url, env, request }) => {
    const db = adaptD1(env.DB);
    let token = parseCartCookie(request.headers.get("Cookie"));
    let created = false;
    if (token === null) {
      token = newCartToken();
      created = true;
    }
    const notice = url.searchParams.get("notice") ?? undefined;
    const rendered = await renderCartPage(
      db,
      await getCart(db, token),
      await renderOpts(db, env, url, request),
      notice,
    );
    const response = htmlResponse(rendered.html, rendered.status);
    if (created) response.headers.set("Set-Cookie", cartCookieHeader(token));
    return response;
  });

  router.get("/shop/checkout/test", async ({ url, env, request }) => {
    const db = adaptD1(env.DB);
    const order = await getOrder(db, url.searchParams.get("order") ?? "");
    const reference = url.searchParams.get("reference") ?? "";
    if (order === null || reference === "") {
      const rendered = await renderNotFound(db, await renderOpts(db, env, url, request));
      return htmlResponse(rendered.html, 404);
    }
    const rendered = await renderTestCheckout(db, order, reference, await renderOpts(db, env, url, request));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/shop/checkout/success", async ({ url, env, request }) => {
    const db = adaptD1(env.DB);
    const order = await getOrder(db, url.searchParams.get("order") ?? "");
    const rendered = await renderCheckoutResult(db, order, await renderOpts(db, env, url, request));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/shop/checkout/cancelled", async ({ url, env, request }) => {
    const db = adaptD1(env.DB);
    const order = await getOrder(db, url.searchParams.get("order") ?? "");
    const rendered = await renderCheckoutResult(db, order, await renderOpts(db, env, url, request));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/shop/:slug", async ({ url, env, request, params }) => {
    const db = adaptD1(env.DB);
    const product = await getProductBySlug(db, params.slug ?? "");
    if (product === null || product.status !== "published") {
      const rendered = await renderNotFound(db, await renderOpts(db, env, url, request));
      return htmlResponse(rendered.html, 404);
    }
    const rendered = await renderProductPage(db, product, await renderOpts(db, env, url, request));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.post("/shop/cart/add", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const form = await request.formData();
    let token = parseCartCookie(request.headers.get("Cookie"));
    let created = false;
    if (token === null) {
      token = newCartToken();
      created = true;
    }
    const productId = Number(form.get("productId"));
    const quantity = Number(form.get("quantity") ?? "1");
    try {
      await addToCart(db, token, productId, quantity);
    } catch (err) {
      const message = err instanceof WordlessError ? err.message : "Could not add that product to the cart.";
      const response = new Response(null, { status: 303, headers: { Location: `/shop/cart?notice=${encodeURIComponent(message)}` } });
      if (created) response.headers.set("Set-Cookie", cartCookieHeader(token));
      return response;
    }
    const response = new Response(null, { status: 303, headers: { Location: "/shop/cart" } });
    if (created) response.headers.set("Set-Cookie", cartCookieHeader(token));
    return response;
  });

  router.post("/shop/cart/remove", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const form = await request.formData();
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token !== null) {
      await setCartQuantity(db, token, Number(form.get("productId")), 0);
    }
    return new Response(null, { status: 303, headers: { Location: "/shop/cart" } });
  });

  router.post("/shop/cart/quantity", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const form = await request.formData();
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token !== null) {
      await setCartQuantity(db, token, Number(form.get("productId")), Number(form.get("quantity") ?? "0"));
    }
    return new Response(null, { status: 303, headers: { Location: "/shop/cart" } });
  });

  router.post("/shop/checkout", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const form = await request.formData();
    const token = parseCartCookie(request.headers.get("Cookie"));
    try {
      if (token === null) throw new WordlessError("bad_request", 400, "The cart is empty.");
      const order = await createOrderFromCart(db, token, {
        customerName: form.get("customerName"),
        customerEmail: form.get("customerEmail"),
      });
      const { provider } = await resolvePaymentProvider(db, env);
      const base = await siteUrl(db);
      const checkout = await provider.createCheckout(env, {
        order,
        siteUrl: base,
        successUrl: `${base}/shop/checkout/success?order=${order.id}`,
        cancelUrl: `${base}/shop/checkout/cancelled?order=${order.id}`,
      });
      await setOrderPayment(db, order.id, provider.id, checkout.reference);
      if (provider.id === "mock") {
        return new Response(null, {
          status: 303,
          headers: { Location: `/shop/checkout/test?order=${order.id}&reference=${encodeURIComponent(checkout.reference)}` },
        });
      }
      return new Response(null, { status: 303, headers: { Location: checkout.checkoutUrl } });
    } catch (err) {
      // A checkout that cannot start shows the reason plainly on the
      // cart page — never a fake success, never a bare JSON error.
      const message = err instanceof WordlessError ? err.message : "Checkout could not be started.";
      return new Response(null, {
        status: 303,
        headers: { Location: `/shop/cart?notice=${encodeURIComponent(message)}` },
      });
    }
  });

  router.post("/shop/checkout/test", async ({ request, env }) => {
    const db = adaptD1(env.DB);
    const form = await request.formData();
    const orderId = String(form.get("orderId") ?? "");
    const reference = String(form.get("reference") ?? "");
    const order = await getOrder(db, orderId);
    if (order === null) {
      return new Response(null, { status: 303, headers: { Location: "/shop/cart" } });
    }
    if (order.paymentProvider !== "mock" || order.paymentReference !== reference) {
      return new Response(null, { status: 303, headers: { Location: `/shop/checkout/success?order=${order.id}` } });
    }
    const secret = env.MOCK_PAYMENT_WEBHOOK_SECRET;
    if (secret === undefined || secret === "") {
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/shop/cart?notice=${encodeURIComponent(
            "Test checkout is not enabled: set the MOCK_PAYMENT_WEBHOOK_SECRET secret (wrangler secret put) first.",
          )}`,
        },
      });
    }
    // Simulate the provider's webhook: the mock provider's own
    // signature scheme signs the event, and handlePaymentWebhook does
    // the real verification + the pending→paid transition.
    const body = JSON.stringify({ event: "payment.paid", reference });
    const signature = await hmacHex("SHA-256", secret, body);
    const webhookRequest = new Request(`https://wordless.local/api/commerce/webhooks/mock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-signature": signature },
      body,
    });
    const outcome = await handlePaymentWebhook(db, env, "mock", webhookRequest);
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/shop/checkout/success?order=${order.id}${outcome.order === "paid" ? "" : "&webhook=failed"}`,
      },
    });
  });

  // ------------------------------------------------------- feeds + sitemap
  router.get("/feed", async ({ env }) => {
    const xml = await rssFeed(adaptD1(env.DB));
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
  });

  router.get("/sitemap.xml", async ({ env, url }) => {
    const pageParam = url.searchParams.get("page");
    const page = pageParam === null ? undefined : intInRange(pageParam, "page", 1, 100000, 1);
    const xml = await sitemapXml(adaptD1(env.DB), page);
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8" } });
  });

  router.get("/robots.txt", async ({ env }) => {
    const txt = await getRobotsTxt(adaptD1(env.DB));
    return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  });

  // ------------------------------------------------------------- public site
  router.get("/", async ({ env, url }) => {
    const db = adaptD1(env.DB);
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const rendered = await renderHome(db, page, await renderOpts(db, env, url));
    return htmlResponse(rendered.html, rendered.status);
  });

  router.get("/search", async ({ env, url }) => {
    const db = adaptD1(env.DB);
    const q = url.searchParams.get("q") ?? "";
    if (q.trim().length === 0) {
      const rendered = await renderHome(db, 1, await renderOpts(db, env, url));
      return htmlResponse(rendered.html, rendered.status);
    }
    const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
    const rendered = await renderSearchPage(db, q, page, await renderOpts(db, env, url));
    return htmlResponse(rendered.html, rendered.status);
  });

  // The admin is a React SPA served from Static Assets (see fetch() below);
  // there is no server-rendered admin shell anymore (M3 removed admin-shell.ts).

  return router;
}

/**
 * Variation settings for a public request: a preview token's unsaved
 * overrides win; otherwise the active theme's SAVED variation applies.
 * The saved variation is what makes "save variation" actually change the
 * live site — without this step the customizer would save but never render.
 */
async function resolveVariation(
  db: Db,
  url: URL,
): Promise<{ variation?: Record<string, unknown>; previewToken?: string }> {
  const token = url.searchParams.get("wl_preview");
  if (token !== null && token !== "") {
    const preview = await getPreview(db, token);
    if (preview !== null) return { variation: preview.settings, previewToken: token };
  }
  const slug = await getActiveThemeSlug(db);
  const saved = await getVariation(db, slug);
  if (saved !== null) return { variation: saved.settings };
  return {};
}

/** Build RenderOptions for a public request: R2 storage for theme files + variation overrides. */
async function renderOpts(db: Db, env: Env, url: URL, request?: Request): Promise<RenderOptions> {
  const opts: RenderOptions = { storage: new R2MediaStorage(env.MEDIA) };
  const { variation, previewToken } = await resolveVariation(db, url);
  if (variation !== undefined) opts.variation = variation;
  if (previewToken !== undefined) opts.previewToken = previewToken;
  // M8: the shop reads the cart from the cookie token.
  if (request !== undefined) {
    const token = parseCartCookie(request.headers.get("Cookie"));
    if (token !== null) opts.cartToken = token;
  }
  return opts;
}

/** Public GET fallback: resolve the path through permalinks. */
async function handlePublicGet(db: Db, url: URL, opts?: RenderOptions): Promise<Response> {
  const page = intInRange(url.searchParams.get("page"), "page", 1, 10000, 1);
  const plainId = url.searchParams.get("p");
  if (plainId !== null) {
    const post = await resolvePostById(db, Number(plainId));
    if (post) {
      const rendered = post.type === "page" ? await renderPage(db, post, opts) : await renderSingle(db, post, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    const notFoundPage = await renderNotFound(db, opts);
    return htmlResponse(notFoundPage.html, 404);
  }
  const resolved = await resolvePath(db, url.pathname);
  switch (resolved.kind) {
    case "redirect":
      return new Response(null, { status: 301, headers: { Location: resolved.target } });
    case "home": {
      const rendered = await renderHome(db, page, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "post": {
      const rendered = await renderSingle(db, resolved.post, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "page": {
      const rendered = await renderPage(db, resolved.post, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "term": {
      const rendered = await renderTermArchive(db, resolved.term, page, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "date-archive": {
      const rendered = await renderDateArchive(db, resolved.year, resolved.month, page, opts);
      return htmlResponse(rendered.html, rendered.status);
    }
    case "not-found": {
      const rendered = await renderNotFound(db, opts);
      return htmlResponse(rendered.html, 404);
    }
  }
}

/** Public comment submission from the rendered form: /{slug}/comments. */
async function handlePublicCommentPost(request: Request, db: Db, env: Env, url: URL, user: AuthUser | null, opts?: RenderOptions): Promise<Response> {
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const slug = segments.length === 2 ? segments[0] : undefined;
  if (slug === undefined || segments[1] !== "comments") {
    const notFoundPage = await renderNotFound(db, opts);
    return htmlResponse(notFoundPage.html, 404);
  }
  const post = await getPostBySlug(db, slug);
  if (!post) {
    const notFoundPage = await renderNotFound(db, opts);
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
    await notifyAdminOfComment(db, env, post.title, comment.author, comment.content);
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
      // Preview renders (?wl_preview=) are never cached either.
      const cacheable =
        request.method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/admin") &&
        !url.searchParams.has("wl_preview") &&
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
          response = await handlePublicGet(db, url, await renderOpts(db, env, url, request));
        } else if (request.method === "POST" && url.pathname.endsWith("/comments")) {
          response = await handlePublicCommentPost(request, db, env, url, user, await renderOpts(db, env, url, request));
        }
      }

      // M7: record public 404s (the log strips query strings; the home
      // page itself is never a 404 even when ?p= misses). Never breaks
      // the response.
      if (response.status === 404 && request.method === "GET" && url.pathname !== "/") {
        await logNotFound(db, url.pathname, request.headers.get("Referer") ?? "");
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
