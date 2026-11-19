/**
 * WordPress compatibility registry — the bridge converted extensions call.
 *
 * Each entry records an honest support level (Milestone 3):
 * - full:    implemented with WordPress semantics (sync hooks).
 * - partial: implemented for the common path; documented gaps remain.
 * - stub:    recorded/thrown, not functional yet — never silently faked.
 *
 * The callable API is built by createWordPressApi(db, ctx). Unlike PHP,
 * the data functions are async (they hit D1); converted extensions must
 * await them. The snake_case names match WordPress so converted code
 * reads naturally.
 *
 * NOTE: the brief listed get_user_meta twice; the 25th entry here is
 * add_option (a real WP function) so the registry has 25 distinct names.
 */
import { execRun, nowIso } from "../db";
import type { Db } from "../db";
import { stubError, WordlessError } from "../kernel/errors";
import { applyFilters, doAction, hooks } from "../kernel/hooks";
import type { HookCallback } from "../kernel/hooks";
import { userCan, type Role } from "../modules/users/capabilities";
import { getUserMeta, updateUserMeta } from "../modules/users/service";
import type { User } from "../modules/users/types";
import { deleteOption, addOption, getOption, setOption } from "../modules/options/service";
import { listMenuItems, resolveMenuByLocation } from "../modules/menus/service";
import type { MenuItem } from "../modules/menus/types";
import { getActiveThemeSlug, getTheme } from "../modules/themes/service";
import type { ThemeRecord } from "../modules/themes/types";
import { termUrl } from "../modules/permalinks/service";
import {
  createPost,
  deletePost,
  getPostById,
  getPostBySlug,
  listPosts,
  updatePost,
} from "../modules/posts/service";
import type { CreatePostInput, Post, PostListResult, UpdatePostInput } from "../modules/posts/types";
import { isPostStatus } from "../modules/posts/types";
import { listRevisions, restoreRevision } from "../modules/revisions/service";
import type { Revision } from "../modules/revisions/types";
import { getPostTerms, listTerms } from "../modules/terms/service";
import type { Term } from "../modules/terms/types";
import { getMediaRecord, listMedia, uploadMedia } from "../modules/media/service";
import type { MediaListResult, MediaRecord, UploadMediaInput } from "../modules/media/service";
import type { MediaStorage } from "../modules/media/storage";

export type SupportLevel = "full" | "partial" | "stub" | "unsupported";

export interface CompatEntry {
  name: string;
  level: SupportLevel;
  description: string;
}

export const WORDPRESS_COMPAT: CompatEntry[] = [
  { name: "get_option", level: "partial", description: "Reads wp_options; values are JSON, not PHP-serialized. No autoload/transient handling yet." },
  { name: "update_option", level: "partial", description: "Upserts wp_options as JSON. No autoload/transient handling yet." },
  { name: "delete_option", level: "partial", description: "Deletes from wp_options. Returns whether a row was removed." },
  { name: "add_option", level: "partial", description: "Inserts only if absent; returns false when the option already exists." },
  { name: "get_post", level: "partial", description: "Reads wp_posts by ID. No WP_Post object extras (no filtered content, no meta preloading)." },
  { name: "get_posts", level: "partial", description: "Basic list (status/type/author/page/per_page). No WP_Query taxonomy/meta queries yet." },
  { name: "wp_insert_post", level: "partial", description: "Creates a post/page/attachment row with slug generation. No hooks fired yet; no meta input handling." },
  { name: "wp_update_post", level: "partial", description: "Updates allowlisted fields. Creates a revision of the pre-update content (M2)." },
  { name: "wp_delete_post", level: "partial", description: "Trashes by default; force=true hard-deletes the row and its postmeta." },
  { name: "add_action", level: "full", description: "Sync hook registration, priority order (default 10), stable order." },
  { name: "remove_action", level: "full", description: "Removes by callback identity, optionally scoped to a priority." },
  { name: "add_filter", level: "full", description: "Sync filter registration, priority order (default 10), stable order." },
  { name: "remove_filter", level: "full", description: "Removes by callback identity, optionally scoped to a priority." },
  { name: "apply_filters", level: "full", description: "Chains a value through registered filters in priority order." },
  { name: "do_action", level: "full", description: "Runs registered action callbacks in priority order." },
  { name: "register_post_type", level: "partial", description: "Registers in memory only (not persisted, no admin UI, no rewrite rules yet)." },
  { name: "register_taxonomy", level: "partial", description: "Registers in memory only (not persisted, no term UI yet)." },
  { name: "add_shortcode", level: "partial", description: "Registers the tag and callback in memory; shortcode rendering in post content is not built yet." },
  { name: "wp_schedule_event", level: "partial", description: "Persists a scheduled job row in wl_jobs; no cron runner executes it yet (Workers Cron Triggers are a later step)." },
  { name: "current_user_can", level: "partial", description: "Checks the capability map for the current request user; false when anonymous." },
  { name: "get_user_meta", level: "partial", description: "Reads wp_usermeta as JSON; single-value only (no multi-value arrays yet)." },
  { name: "update_user_meta", level: "partial", description: "Upserts wp_usermeta as JSON." },
  { name: "wp_enqueue_script", level: "partial", description: "Records the handle/src in memory; scripts are not rendered into pages yet." },
  { name: "wp_enqueue_style", level: "partial", description: "Records the handle/src in memory; styles are not rendered into pages yet." },
  { name: "register_rest_route", level: "stub", description: "STUB: routes are recorded for reporting but NOT mounted on the Worker router in M1." },
  { name: "wp_get_post_terms", level: "partial", description: "Terms assigned to a post (M2). Returns Term objects; no WP_Term extras." },
  { name: "get_the_terms", level: "partial", description: "Alias of wp_get_post_terms for one taxonomy (M2)." },
  { name: "wp_list_categories", level: "partial", description: "HTML list of categories with counts (M2). No Walker/custom args yet." },
  { name: "wp_get_post_revisions", level: "partial", description: "Revision snapshots for a post, newest first (M2)." },
  { name: "wp_restore_post_revision", level: "partial", description: "Restores a revision; snapshots the pre-restore content first (M2)." },
  { name: "wp_nav_menu", level: "partial", description: "HTML for a menu by location or id (M2). No Walker/theme args yet." },
  { name: "get_media_items", level: "partial", description: "Attachment posts, paginated with a MIME filter (M3). Returns MediaRecord objects, not WP_Post objects." },
  { name: "wp_get_attachment_url", level: "partial", description: "Public /media/<key> URL for an attachment id (M3). Empty string when the id is not an attachment." },
  { name: "media_handle_upload", level: "partial", description: "Validates and stores a file in R2, creating the attachment post + postmeta (M3). Needs a MediaStorage in the context; throws a stub error when none is wired. Image derivatives exist since M9 via the Cloudflare Images binding (originals served when unbound)." },
  { name: "get_user_locale", level: "partial", description: "The current user's locale: the locale passed in the WpContext (resolved once per request from the site_locale option), default en_US (M4). No per-user locale UI yet." },
  { name: "get_locale", level: "partial", description: "Site locale from the WpContext (resolved once per request from the site_locale option), default en_US (M4)." },
  { name: "__", level: "partial", description: "Returns the string unchanged: no translation files exist in M4, so there is nothing to translate from (M4)." },
  { name: "_e", level: "partial", description: "Returns the string unchanged (same as __); the emitter turns the surrounding echo into output (M4)." },
  { name: "esc_html", level: "partial", description: "Escapes & < > \" ' for HTML output (M4)." },
  { name: "esc_attr", level: "partial", description: "Escapes & < > \" ' for attribute output — same escaping as esc_html in M4 (M4)." },
  { name: "wptexturize", level: "partial", description: "Converts straight quotes to curly quotes, --/--- to dashes, ... to an ellipsis (M4). A small subset of WordPress's full texturize." },
  { name: "get_theme_root", level: "partial", description: "Returns the R2 prefix \"themes/\" where theme files live (M5). WordPress returns a filesystem path; Workers has no filesystem, so this is the object-storage prefix instead." },
  { name: "wp_get_theme", level: "partial", description: "Returns the active theme (or the named one): slug, name, version, author, status, kind (M5). No WP_Theme object extras (no template files list, no parent/child resolution)." },
  { name: "get_stylesheet", level: "partial", description: "Returns the active theme's slug (M5). The stylesheet itself is served at /theme.css." },
  { name: "get_template", level: "partial", description: "Same as get_stylesheet in v1 (M5): Wordless has no parent/child theme hierarchy yet, so template and stylesheet are always the same theme." },
];

/** In-memory registries for converted extensions (not persisted in M1). */
export const registeredPostTypes = new Map<string, Record<string, unknown>>();
export const registeredTaxonomies = new Map<string, Record<string, unknown>>();
export const registeredShortcodes = new Map<string, (...args: unknown[]) => unknown>();
export const enqueuedScripts: { handle: string; src: string }[] = [];
export const enqueuedStyles: { handle: string; src: string }[] = [];
export const registeredRestRoutes: { namespace: string; route: string; methods: string[] }[] = [];

export interface WpContext {
  db: Db;
  currentUser: User | null;
  /**
   * Site locale for this request (e.g. "en_US"). The Worker resolves it
   * once per request from the site_locale option; get_locale() and
   * get_user_locale() are synchronous reads of it, which matters for
   * converted code — a locale call inside an action callback must not
   * turn the whole function async (the hook system is synchronous).
   */
  locale?: string;
  /**
   * Media storage for media_handle_upload. The Worker passes an
   * R2MediaStorage; tests pass an in-memory fake. Absent → upload throws
   * a stub error instead of silently pretending to work.
   */
  storage?: MediaStorage;
}

export interface WordPressApi {
  get_option<T>(name: string, defaultValue: T): Promise<T>;
  update_option(name: string, value: unknown): Promise<void>;
  delete_option(name: string): Promise<boolean>;
  add_option(name: string, value: unknown): Promise<boolean>;
  get_post(id: number): Promise<Post | null>;
  get_posts(args?: { status?: string; type?: string; authorId?: number; page?: number; perPage?: number }): Promise<PostListResult>;
  wp_insert_post(input: CreatePostInput): Promise<Post>;
  wp_update_post(id: number, patch: UpdatePostInput): Promise<Post>;
  wp_delete_post(id: number, force?: boolean): Promise<boolean>;
  add_action(tag: string, cb: HookCallback, priority?: number, acceptedArgs?: number): void;
  remove_action(tag: string, cb: HookCallback, priority?: number): boolean;
  add_filter(tag: string, cb: HookCallback, priority?: number, acceptedArgs?: number): void;
  remove_filter(tag: string, cb: HookCallback, priority?: number): boolean;
  apply_filters(tag: string, value: unknown, ...args: unknown[]): unknown;
  do_action(tag: string, ...args: unknown[]): void;
  register_post_type(name: string, args?: Record<string, unknown>): void;
  register_taxonomy(name: string, objectType: string | string[], args?: Record<string, unknown>): void;
  add_shortcode(tag: string, cb: (...args: unknown[]) => unknown): void;
  wp_schedule_event(timestamp: number, recurrence: string, hook: string, args?: unknown[]): Promise<string>;
  current_user_can(capability: string): boolean;
  get_user_meta<T>(userId: number, key: string, defaultValue: T): Promise<T>;
  update_user_meta(userId: number, key: string, value: unknown): Promise<void>;
  wp_enqueue_script(handle: string, src: string): void;
  wp_enqueue_style(handle: string, src: string): void;
  register_rest_route(namespace: string, route: string, methods?: string[]): void;
  wp_get_post_terms(postId: number, taxonomy?: string): Promise<Term[]>;
  get_the_terms(postId: number, taxonomy: string): Promise<Term[]>;
  wp_list_categories(args?: { taxonomy?: string }): Promise<string>;
  wp_get_post_revisions(postId: number): Promise<Revision[]>;
  wp_restore_post_revision(revisionId: number): Promise<Post>;
  wp_nav_menu(args?: { theme_location?: string; menu?: number }): Promise<string>;
  get_media_items(args?: { page?: number; perPage?: number; mimeType?: string }): Promise<MediaListResult>;
  wp_get_attachment_url(id: number): Promise<string>;
  media_handle_upload(input: UploadMediaInput): Promise<MediaRecord>;
  get_user_locale(): string;
  get_locale(): string;
  __(text: string): string;
  _e(text: string): string;
  esc_html(text: string): string;
  esc_attr(text: string): string;
  wptexturize(text: string): string;
  /** R2 prefix where theme files live (no filesystem path on Workers). */
  get_theme_root(): string;
  /** Active theme (or the named one): slug, name, version, author, status, kind. */
  wp_get_theme(slug?: string): Promise<ThemeRecord>;
  /** Active theme slug (its stylesheet is served at /theme.css). */
  get_stylesheet(): Promise<string>;
  /** Same as get_stylesheet in v1 — no parent/child themes yet. */
  get_template(): Promise<string>;
}

export function createWordPressApi(ctx: WpContext): WordPressApi {
  const { db } = ctx;
  return {
    get_option: <T>(name: string, defaultValue: T) => getOption<T>(db, name, defaultValue),
    update_option: (name: string, value: unknown) => setOption(db, name, value),
    delete_option: (name: string) => deleteOption(db, name),
    add_option: (name: string, value: unknown) => addOption(db, name, value),

    get_post: (id: number) => getPostById(db, id),
    get_posts: (args = {}) =>
      listPosts(db, {
        status: args.status !== undefined && isPostStatus(args.status) ? args.status : undefined,
        type: args.type,
        authorId: args.authorId,
        page: args.page,
        perPage: args.perPage,
      }),
    wp_insert_post: (input: CreatePostInput) => createPost(db, input),
    wp_update_post: (id: number, patch: UpdatePostInput) => updatePost(db, id, patch),
    wp_delete_post: async (id: number, force = false) => {
      if (force) return deletePost(db, id);
      const post = await getPostById(db, id);
      if (!post) throw new WordlessError("not_found", 404, `Post ${id} not found.`);
      await updatePost(db, id, { status: "trash" });
      return true;
    },

    add_action: (tag, cb, priority = 10, acceptedArgs = 0) => hooks.addAction(tag, cb, priority, acceptedArgs),
    remove_action: (tag, cb, priority) => hooks.removeAction(tag, cb, priority),
    add_filter: (tag, cb, priority = 10, acceptedArgs = 0) => hooks.addFilter(tag, cb, priority, acceptedArgs),
    remove_filter: (tag, cb, priority) => hooks.removeFilter(tag, cb, priority),
    apply_filters: (tag, value, ...args) => applyFilters(tag, value, ...args),
    do_action: (tag, ...args) => doAction(tag, ...args),

    register_post_type: (name, args = {}) => {
      registeredPostTypes.set(name, args);
    },
    register_taxonomy: (name, _objectType, args = {}) => {
      registeredTaxonomies.set(name, args);
    },
    add_shortcode: (tag, cb) => {
      registeredShortcodes.set(tag, cb);
    },

    wp_schedule_event: async (timestamp, recurrence, hook, args = []) => {
      const id = crypto.randomUUID();
      const runAt = new Date(timestamp * 1000).toISOString();
      await execRun(
        db,
        `INSERT INTO wl_jobs (id, kind, status, payload, attempts, created_at, updated_at, run_at)
         VALUES (?, 'cron', 'scheduled', ?, 0, ?, ?, ?)`,
        [id, JSON.stringify({ hook, recurrence, args }), nowIso(), nowIso(), runAt],
      );
      return id;
    },

    current_user_can: (capability: string) => {
      if (!ctx.currentUser) return false;
      return userCan(ctx.currentUser, capability);
    },
    get_user_meta: <T>(userId: number, key: string, defaultValue: T) =>
      getUserMeta<T>(db, userId, key, defaultValue),
    update_user_meta: (userId: number, key: string, value: unknown) =>
      updateUserMeta(db, userId, key, value),

    wp_enqueue_script: (handle, src) => {
      enqueuedScripts.push({ handle, src });
    },
    wp_enqueue_style: (handle, src) => {
      enqueuedStyles.push({ handle, src });
    },
    register_rest_route: (namespace, route, methods = ["GET"]) => {
      registeredRestRoutes.push({ namespace, route, methods });
      throw stubError(`register_rest_route (${namespace}${route}) — recorded but not mounted in M1`);
    },

    wp_get_post_terms: (postId, taxonomy) => getPostTerms(db, postId, taxonomy),
    get_the_terms: (postId, taxonomy) => getPostTerms(db, postId, taxonomy),
    wp_list_categories: async (args = {}) => {
      const { terms } = await listTerms(db, args.taxonomy ?? "category", { perPage: 100 });
      const items = terms
        .map(
          (t) =>
            `<li class="cat-item"><a href="${termUrl(t.taxonomy, t.slug)}">${escapeHtml(t.name)}</a> (${t.count})</li>`,
        )
        .join("");
      return `<ul>${items}</ul>`;
    },
    wp_get_post_revisions: (postId) => listRevisions(db, postId),
    wp_restore_post_revision: (revisionId) => restoreRevision(db, revisionId),
    get_media_items: (args = {}) =>
      listMedia(db, { page: args.page, perPage: args.perPage, mimeType: args.mimeType }),
    wp_get_attachment_url: async (id) => {
      const record = await getMediaRecord(db, id);
      return record ? record.url : "";
    },
    media_handle_upload: async (input) => {
      if (!ctx.storage) {
        throw stubError("media_handle_upload — no MediaStorage in the WpContext (wire R2MediaStorage)");
      }
      return uploadMedia(db, ctx.storage, input);
    },
    // Locale is request-scoped config passed in the context (see
    // WpContext.locale) — synchronous on purpose, so a locale call inside
    // an action callback does not force the callback to be async.
    get_locale: () => ctx.locale ?? "en_US",
    get_user_locale: () => ctx.locale ?? "en_US",
    // No translation files exist in M4: __() returns the string unchanged.
    __: (text: string) => text,
    _e: (text: string) => text,
    esc_html: (text: string) => escapeHtml(text),
    esc_attr: (text: string) => escapeHtml(text),
    wptexturize: (text: string) => wptexturize(text),
    // Themes (M5): the active theme lives in wl_themes; its files in R2
    // under themes/<slug>/. No filesystem path exists on Workers, so
    // get_theme_root returns the R2 prefix. No parent/child themes yet.
    get_theme_root: () => "themes/",
    wp_get_theme: async (slug?: string) => getTheme(db, slug ?? (await getActiveThemeSlug(db))),
    get_stylesheet: () => getActiveThemeSlug(db),
    get_template: () => getActiveThemeSlug(db),
    wp_nav_menu: async (args = {}) => {
      let items: MenuItem[] = [];
      if (args.theme_location !== undefined) {
        items = (await resolveMenuByLocation(db, args.theme_location)).items;
      } else if (args.menu !== undefined) {
        items = await listMenuItems(db, args.menu);
      }
      const renderItems = (list: MenuItem[]): string =>
        list
          .map(
            (item) =>
              `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>${
                item.children && item.children.length > 0 ? `<ul>${renderItems(item.children)}</ul>` : ""
              }</li>`,
          )
          .join("");
      return `<ul>${renderItems(items)}</ul>`;
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * wptexturize (M4) — a small, real subset of WordPress's texturize:
 * ellipsis, em/en dashes, curly double quotes, and apostrophes inside
 * words. It does not handle every edge case WordPress does (quoted HTML
 * attributes are left alone only when they are not matched by the quote
 * patterns); converted plugins that need full fidelity should keep their
 * own copy of the function.
 */
export function wptexturize(text: string): string {
  return (
    text
      // Ellipsis and dashes first (longest first).
      .replace(/\.\.\./g, "…")
      .replace(/---/g, "—")
      .replace(/--/g, "–")
      // Apostrophe inside a word: You're → You’re, Dolly'll → Dolly’ll.
      .replace(/([A-Za-z])'([A-Za-z])/g, "$1’$2")
      // Trailing apostrophe after a word: goin' → goin’.
      .replace(/([A-Za-z])'(\s|$)/g, "$1’$2")
      // Paired double quotes on one line: "word" → “word”.
      .replace(/"([^"\n]+)"/g, "“$1”")
      // Remaining opening double quote (after space or start) → “.
      .replace(/(^|[\s(])"/g, "$1“")
      // Remaining closing double quote → ”.
      .replace(/"/g, "”")
  );
}

/** Look up a compat entry by its WordPress name. */
export function compatEntry(name: string): CompatEntry | undefined {
  return WORDPRESS_COMPAT.find((e) => e.name === name);
}

/**
 * Wordless AI API surface (Milestone 6) — NOT WordPress functions, so
 * they live in a separate list, not WORDPRESS_COMPAT. Each entry maps to
 * a real HTTP endpoint under /api/ai/*; "partial" means the endpoint
 * exists and works, with the documented M6 limits (no Queues yet — tasks
 * run synchronously in the request in local dev; live Workers AI calls
 * need the [ai] binding on a deployed Worker).
 */
export const AI_COMPAT: CompatEntry[] = [
  { name: "wl_ai_complete", level: "partial", description: "POST /api/ai/tasks — run an agent with the selected provider (Workers AI by default, mock in local dev). Fails honestly with ai_not_configured when no provider is configured." },
  { name: "wl_ai_providers", level: "partial", description: "GET /api/ai/providers (+ /select, /:id/test) — list providers with live configured state; Workers AI is the default, OpenAI-compatible is an optional fallback." },
  { name: "wl_ai_mode", level: "partial", description: "GET/PUT /api/ai/mode — manual / supervised / autonomous. The orchestrator enforces the mode; supervised never applies without approval." },
  { name: "wl_ai_agents", level: "partial", description: "GET /api/ai/agents — the 15-agent roster with live availability (commerce-assistant is live since Milestone 8, reading real store data)." },
  { name: "wl_ai_approve", level: "partial", description: "POST /api/ai/approvals/:id/approve|reject — human gate. Approving applies the proposal through the existing services; a failed apply leaves the approval pending." },
  { name: "wl_ai_memory", level: "partial", description: "GET/POST /api/ai/memory — website facts + admin notes used as agent context. Rebuild re-ingests from the site; notes never contain secrets." },
];

/**
 * Wordless SEO API surface (Milestone 7) — NOT WordPress functions, so
 * they live in a separate list, not WORDPRESS_COMPAT. Each entry maps to
 * a real HTTP endpoint under /api/posts/:id/seo or /api/seo/*; "partial"
 * means the endpoint exists and works, with the documented M7 limits
 * (no live search-engine submission, no rank tracking — the analysis
 * score is computed from stored content only).
 */
export const SEO_COMPAT: CompatEntry[] = [
  { name: "wl_seo_fields", level: "partial", description: "GET/PUT /api/posts/:id/seo — per-post SEO title, description, focus keyword, canonical, noindex, OG/Twitter fields, stored as wp_postmeta. Returned inside the post detail payload." },
  { name: "wl_seo_analysis", level: "partial", description: "GET /api/posts/:id/seo/analysis — deterministic 0–100 score from stored content (title, description, keyword, headings, alt text, links, word count, readability estimate, canonical). No rankings or traffic are invented." },
  { name: "wl_seo_head", level: "partial", description: "Public pages render <title>, meta description, canonical, robots, Open Graph, Twitter Card and JSON-LD (WebSite + Article + BreadcrumbList) with stored-field fallbacks." },
  { name: "wl_seo_sitemap", level: "partial", description: "GET /sitemap.xml — paginated at 1,000 URLs (index above that), changefreq/priority from recency, image entries only for existing attachments." },
  { name: "wl_seo_robots", level: "partial", description: "GET/PUT /api/seo/robots — configurable robots.txt; rules blocking /admin or /api are rejected." },
  { name: "wl_seo_redirects", level: "partial", description: "GET/POST/PUT/DELETE /api/seo/redirects — manual 301s over wl_redirects (slug changes already create them automatically)." },
  { name: "wl_seo_404s", level: "partial", description: "GET/DELETE /api/seo/404s — public 404 log (query strings stripped, capped at 500 paths) with one-click redirect creation." },
  { name: "wl_seo_templates", level: "partial", description: "GET /api/seo/templates + POST /api/seo/templates/:slug/create — three content templates (announcement, how-to, news update) that create real draft posts." },
  { name: "wl_seo_calendar", level: "partial", description: "GET /api/seo/calendar — stored posts grouped by date for the next 30 days (a draft with a future date is the schedule; no 'future' status yet)." },
  { name: "wl_seo_import", level: "partial", description: "POST /api/seo/import — Yoast SEO (_yoast_wpseo_*) and Rank Math (rank_math_*) metadata import by post ID or slug; unknown keys and invalid rows are reported, never silently dropped." },
];

/**
 * Wordless commerce API surface (Milestone 8) — NOT WordPress functions,
 * so they live in a separate list. "partial" means the endpoint exists
 * and works, with the documented M8 limits (no live provider call has
 * been verified here — no keys connected; no variable products, coupons,
 * taxes or shipping; no refunds).
 */
export const COMMERCE_COMPAT: CompatEntry[] = [
  { name: "wl_commerce_products", level: "partial", description: "GET /api/commerce/products (public, published only) + POST/PUT/DELETE (manage_options). Products: name, slug, block-HTML description, price in integer minor units, currency (NGN default), stock (-1 = unlimited), draft/published, featured image attachment id." },
  { name: "wl_commerce_shop", level: "partial", description: "Public storefront at /shop (list) and /shop/:slug (product page, add-to-cart form, share links), rendered through the theme system; /shop/cart shows the server-side cart with checkout form." },
  { name: "wl_commerce_cart", level: "partial", description: "GET/POST/PUT/DELETE /api/commerce/cart — server-side cart in D1 (wl_carts, 7-day expiry, pruned on read), keyed by the wordless_cart cookie. Stock is checked at add time." },
  { name: "wl_commerce_checkout", level: "partial", description: "POST /api/commerce/checkout — validates a non-empty cart + stock, creates a pending order, starts a checkout with the selected provider. With no provider configured it returns 503 — never a fake success." },
  { name: "wl_commerce_orders", level: "partial", description: "GET /api/commerce/orders (+ /:id) and POST /api/commerce/orders/:id/transition — pending → paid → fulfilled / cancelled. Stock decrements exactly once when an order becomes paid and is restored when a paid order is cancelled." },
  { name: "wl_commerce_payments", level: "partial", description: "Payment providers: Paystack (HMAC-SHA512 webhook), Flutterwave (verif-hash), Stripe (HMAC-SHA256, 300 s timestamp tolerance), plus a deterministic mock for test mode. GET /api/commerce/payments/providers + /selected + POST /select. Secrets live only in env/secrets." },
  { name: "wl_commerce_webhooks", level: "partial", description: "POST /api/commerce/webhooks/:provider — the provider signature IS the auth (401 on bad/missing). Every attempt is logged in wl_webhook_log. A paid webhook moves the order pending → paid exactly once; replays are idempotent." },
  { name: "wl_commerce_assistant", level: "partial", description: "The commerce-assistant AI agent (M6) is live since M8: it reports real products, order counts by status, low-stock warnings and revenue (sum of paid orders, minor units), computed from stored rows only." },
];

/**
 * Wordless integrations surface (Milestone 8) — the integration registry,
 * email, analytics, social and the marketplace skeleton. Config stores
 * non-secret settings only; secrets are rejected with a 400 and must be
 * set via wrangler secrets / env.
 */
export const INTEGRATIONS_COMPAT: CompatEntry[] = [
  { name: "wl_integrations", level: "partial", description: "GET /api/integrations (+ /:id/config GET/PUT) — registry of 8 integrations (email, paystack, flutterwave, stripe, analytics, social, cloudflare, marketplace) with live configured/not-configured detection from env." },
  { name: "wl_integrations_email", level: "partial", description: "sendMail — mock provider logs to wl_mail_log in test mode (never claims delivery); generic HTTP provider (Resend/SendGrid-shaped) sends via a configured endpoint + secret. Used for order confirmations, comment notifications and password resets. GET /api/integrations/email/log (admin)." },
  { name: "wl_integrations_analytics", level: "partial", description: "GET /api/integrations/analytics/status — GA4/Plausible configuration (provider id + measurement id, non-secret). The snippet is injected only when configured. No traffic numbers are ever fabricated." },
  { name: "wl_integrations_social", level: "partial", description: "Share links (X/Facebook/WhatsApp/Telegram) on public post and product pages — plain links, no API calls, no fake counts." },
  { name: "wl_integrations_cloudflare", level: "partial", description: "GET /api/integrations/cloudflare — read-only display of the bindings actually present in this environment (DB, MEDIA, CONFIG, ASSETS, AI). No IDs are invented." },
  { name: "wl_integrations_marketplace", level: "partial", description: "GET /api/marketplace + POST /api/marketplace/install (ZIP upload, wordless.json manifest, ≤50 MB / ≤10,000 files) + activate/deactivate + GET /api/marketplace/:slug/report (compatibility + auto-conversion report). Local-ZIP only — no remote directory, and installed code is never executed." },
];

/**
 * Wordless security + performance surface (Milestone 9) — NOT WordPress
 * functions, so they live in separate lists. "partial" means the endpoint
 * exists and works, with the documented M9 limits (no live Cloudflare
 * Images call has been verified here — no account connected; no real
 * Core Web Vitals measurement; compression is the edge's job).
 */
export const SECURITY_COMPAT: CompatEntry[] = [
  { name: "wl_security_headers", level: "partial", description: "Every response carries Content-Security-Policy, X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy and Permissions-Policy. The CSP allows the inline styles/scripts the admin and analytics need (documented in docs/security/security.md); a nonce-based policy is a later step." },
  { name: "wl_security_lockout", level: "partial", description: "POST /api/auth/login is guarded: 5 failed attempts in 15 minutes lock a login name/IP for 15 minutes (doubling on consecutive lockouts, capped at 60); a successful login clears the counter. Thresholds are options (wl_security_max_attempts / wl_security_window_minutes / wl_security_lockout_minutes)." },
  { name: "wl_security_2fa", level: "partial", description: "POST /api/auth/2fa/setup|confirm|disable + GET /api/auth/2fa/status — TOTP (RFC 6238, HMAC-SHA1, 30 s steps, ±1 step skew) with 8 one-time hashed recovery codes. The secret is stored only after a valid code confirms setup; login accepts an optional totp field." },
  { name: "wl_security_sessions", level: "partial", description: "GET /api/auth/sessions + POST /api/auth/sessions/revoke-all — idle timeout (wl_session_idle_hours, default 24 h) enforced on verify; sessions are listed without token values." },
  { name: "wl_security_uploads", level: "partial", description: "Uploads keep the M3 allowlist (jpeg/png/gif/webp/avif/svg/pdf, 50 MB) and add magic-byte sniffing — a PHP file renamed to .jpg is rejected; SVGs are checked for scripts and javascript: URLs." },
  { name: "wl_security_overview", level: "partial", description: "GET /api/security/overview — measured posture: headers policy, lockout config + locked keys, 2FA per admin, active sessions, recent failed logins, and whether a user with the default login name \"admin\" exists (login name only — passwords are never tested)." },
  { name: "wl_security_agents", level: "partial", description: "The M6 security-scanner agent now runs the real checks above and the performance-analyst measures real D1/R2 numbers; the backup-advisor reports the real backup registry and the migration-assistant points at the real M9 importer." },
];

export const PERFORMANCE_COMPAT: CompatEntry[] = [
  { name: "wl_performance_cache", level: "partial", description: "Anonymous public GETs are cached 60 s with stale-while-revalidate=60; publishing a post purges its URL, the home page and its term pages from the Cache API (purge failures never fail the publish). Imports do NOT purge — an imported post appears once the 60 s entry expires. Cache hit rates are not observable from inside the Worker and are not reported." },
  { name: "wl_performance_derivatives", level: "partial", description: "GET /media/:key?width=&format= — resized/WebP variants via the Cloudflare Images binding when bound (stored in R2 + wl_media_derivatives for srcset); when unbound the endpoint serves the original and says so (X-Wordless-Derivatives: unavailable). A resize is never faked." },
  { name: "wl_performance_health", level: "partial", description: "The Site Health response carries a performance section with measured numbers: D1 row counts, R2 object count (capped at 1,000, reported as 'at least'), cache config and derivative status. Compression is applied by the Cloudflare edge, not the Worker." },
];

export const BACKUP_COMPAT: CompatEntry[] = [
  { name: "wl_backup_create", level: "partial", description: "POST /api/backup/create (admin, wl_jobs job) — a real ZIP in R2 (backups/<id>.zip): one JSON file per D1 table, a media manifest (R2 keys + sizes + etags), and a manifest with a SHA-256 checksum per file. wl_backups and wl_jobs are excluded by design." },
  { name: "wl_backup_verify", level: "partial", description: "POST /api/backup/:id/verify — re-reads the bundle from R2 and recomputes every checksum; only then is the backup marked verified. GET /api/backup lists with size, checksum and verified flag." },
  { name: "wl_backup_restore", level: "partial", description: "POST /api/backup/:id/restore — requires the typed confirmation \"RESTORE\" and a passing verification, refuses a different minor version, restores tables in dependency order inside batched transactions, and checks the media manifest key-by-key (missing keys are reported, never silently skipped). GET /api/backup/:id/download serves the ZIP." },
];

export const IMPORT_COMPAT: CompatEntry[] = [
  { name: "wl_import_wxr", level: "partial", description: "POST /api/import/wxr (admin, multipart ≤50 MB, wl_jobs job) — WordPress eXtended RSS via a real XML parser: authors (forced password reset), categories/tags, posts/pages (block content verbatim), comments, attachments (URL fetch → R2; failed fetches recorded per item). Per-item report with imported/skipped/failed counts." },
  { name: "wl_import_sql", level: "partial", description: "POST /api/import/sql (admin, ≤50 MB, wl_jobs job) — mysqldump parsing for the 12 wp_* tables only (other tables reported as ignored). PHP-serialized values become JSON via the safe unserializer; serialized objects are refused and recorded. Original IDs are kept when free; revisions are skipped." },
  { name: "wl_import_fixtures", level: "partial", description: "test/fixtures/wordpress/ carries a synthetic WXR export + SQL dump (posts/pages/terms/comments/users/options, serialized values, a refused object payload, a revision, a non-wp_* table) that the importer is proven against in tests; the admin Import page links to both files." },
];

/**
 * Milestone 11 surface — auto-convert, Elementor rendering, file manager.
 * "partial" means the endpoint exists and works with the documented M11
 * limits: converted code is stored, never executed; the Elementor editor
 * is not included; 50 MB is the configured upload cap but uploads near
 * the cap can still be slow or fail on the Cloudflare free tier.
 */
export const M11_COMPAT: CompatEntry[] = [
  { name: "wl_m11_limits", level: "partial", description: "Upload caps raised to 50 MB / 10,000 files: theme ZIPs (was 200 files / 5 MB), marketplace ZIPs (was 100 files / 2 MB), media uploads (was 10 MB), WXR/SQL imports (was 10 MB). Near-cap uploads can still be slow or fail on the Cloudflare free tier (128 MB Worker memory, request buffering); chunked/resumable upload is a future improvement." },
  { name: "wl_m11_compat_report", level: "partial", description: "GET /api/marketplace/:slug/report — per-plugin compatibility report stored in wl_extensions.report_json: PHP files analysed (max 2,000, 1 MB per file), convertible / partial / blocked / unparsed counts, top blocking reasons with file paths, per-file verdicts (capped at 500). Static analysis only — never a guarantee the plugin works; a plugin is never labelled as working while its report shows partial/blocked files." },
  { name: "wl_m11_auto_convert", level: "partial", description: "Theme imports (block + classic) and marketplace installs automatically run the M4 converter over PHP files (max 500 files, 1 MB per file) and store the generated TypeScript in R2 under <prefix>/converted/<path>.ts — stored, never executed. Literal get_option() defaults are carried over as Wordless options (existing values never overwritten); theme.json settings are reported as applied or skipped with a reason. Per-file record (converted / partial / blocked + reason) and settings report are stored with the theme/plugin and shown in admin." },
  { name: "wl_m11_elementor", level: "partial", description: "Posts carrying _elementor_data postmeta render their Elementor layout on the public site (sections → columns → widgets) for heading, text-editor, image, button, spacer, divider, video, icon-list, image-box and google-maps. Unknown widgets render nothing and are collected as unsupported; icon glyphs are not rendered (no icon font bundled). This renders Elementor *content* only — the Elementor drag-and-drop editor is NOT included; pages are edited in Wordless's own block editor." },
  { name: "wl_m11_files", level: "partial", description: "GET /api/files (+ ?prefix=), POST /api/files/upload, GET /api/files/download, POST /api/files/rename, POST /api/files/delete — admin file manager over the R2 bucket (manage_options on every route). Folder navigation by prefix, uploads ≤50 MB with the media MIME allowlist + magic-byte sniffing, no in-place editing, no shell access; extensions/, themes/, backups/ and imports/ are read-only here; path traversal is rejected." },
];

export type { Role };
