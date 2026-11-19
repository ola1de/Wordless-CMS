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
  { name: "wp_schedule_event", level: "partial", description: "Persists a scheduled job row in wl_jobs; no cron runner executes it yet (Workers Cron Triggers, Phase 6)." },
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
  { name: "media_handle_upload", level: "partial", description: "Validates and stores a file in R2, creating the attachment post + postmeta (M3). Needs a MediaStorage in the context; throws a stub error when none is wired. No image derivatives (Phase 7)." },
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

export type { Role };
