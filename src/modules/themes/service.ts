/**
 * Themes service (Milestone 5) — wl_themes rows + R2 files.
 *
 * Storage model:
 * - Metadata + theme.json + generated stylesheet: `wl_themes` (D1).
 * - Theme files (templates/, parts/, style.css, assets): R2 under
 *   `themes/<slug>/` via the MediaStorage interface.
 * - The built-in default theme ("wordless-default") is different: its
 *   files live in the in-code bundle (default-theme.ts, generated from
 *   themes/wordless-default/) because the Worker cannot read repo files
 *   at runtime. Its D1 row is seeded lazily the first time any theme
 *   read happens on a fresh install, and refreshed when the bundled
 *   theme version is newer than the stored row (upgrade).
 * - The active theme is the `active_theme` option (default
 *   "wordless-default"); wl_themes.status mirrors it.
 * - Customizer variations are options (`wl_theme_variation_<slug>`);
 *   preview tokens are the `wl_theme_preview` option (30-minute expiry).
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { getOption, setOption, deleteOption } from "../options/service";
import type { MediaStorage } from "../media/storage";
import {
  generateThemeCss,
  generateThemeCssWithVariation,
  parseThemeJson,
  stylesheetHash,
  validateThemeSettings,
  type ParsedThemeJson,
} from "./themejson";
import { analyzeClassicTheme, parseStyleCssHeader, type ClassicReport } from "./classic";
import { extractThemeZip, zipTextFile, zipTextFilesUnder } from "./zip";
import {
  DEFAULT_THEME_AUTHOR,
  DEFAULT_THEME_FILES,
  DEFAULT_THEME_JSON,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_SLUG,
  DEFAULT_THEME_STYLE_CSS,
  DEFAULT_THEME_VERSION,
} from "./default-theme";
import {
  ACTIVE_THEME_OPTION,
  DEFAULT_THEME_SLUG as DEFAULT_SLUG,
  PREVIEW_OPTION,
  variationOptionKey,
  type ThemeDetail,
  type ThemeKind,
  type ThemePreview,
  type ThemeRecord,
  type ThemeVariation,
} from "./types";

export const MAX_THEME_ZIP_BYTES = 5 * 1024 * 1024;

interface ThemeRow {
  slug: string;
  name: string;
  version: string;
  author: string;
  kind: string;
  status: string;
  theme_json: string | null;
  stylesheet: string;
  stylesheet_hash: string;
  source: string;
  report_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ThemeRow): ThemeRecord {
  let report: Record<string, unknown> | null = null;
  if (row.report_json !== null && row.report_json !== "") {
    try {
      report = JSON.parse(row.report_json) as Record<string, unknown>;
    } catch {
      report = null;
    }
  }
  return {
    slug: row.slug,
    name: row.name,
    version: row.version,
    author: row.author,
    kind: row.kind as ThemeKind,
    status: row.status as ThemeRecord["status"],
    hasThemeJson: row.theme_json !== null && row.theme_json !== "",
    stylesheetHash: row.stylesheet_hash,
    source: row.source,
    report,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".php")) return "text/x-php; charset=utf-8";
  return "application/octet-stream";
}

/** The built-in default theme, as a D1 row (inserted lazily). */
function defaultThemeRow(now: string): ThemeRow {
  const parsed = parseThemeJson(DEFAULT_THEME_JSON);
  const generated = generateThemeCss(parsed);
  const stylesheet = `${generated}\n${DEFAULT_THEME_STYLE_CSS}`;
  return {
    slug: DEFAULT_SLUG,
    name: DEFAULT_THEME_NAME,
    version: DEFAULT_THEME_VERSION,
    author: DEFAULT_THEME_AUTHOR,
    kind: "block",
    status: "active",
    theme_json: JSON.stringify(DEFAULT_THEME_JSON),
    stylesheet,
    stylesheet_hash: stylesheetHash(stylesheet),
    source: "builtin",
    report_json: null,
    created_at: now,
    updated_at: now,
  };
}

/** Compare two "x.y.z" versions: -1 when a < b, 0 when equal, 1 when a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Insert the default theme row when the table is empty (fresh install), or
 * refresh the built-in row when the bundled theme is newer (upgrade), so an
 * existing install picks up a redesigned default theme. Only the built-in
 * row is ever refreshed: imported/custom themes are left alone, a row
 * newer than the bundle is never downgraded, and customizer variations
 * (stored as options, not in this row) are untouched.
 */
export async function ensureDefaultTheme(db: Db): Promise<void> {
  const count = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_themes");
  const row = defaultThemeRow(nowIso());
  if ((count?.n ?? 0) === 0) {
    await execRun(
      db,
      `INSERT OR IGNORE INTO wl_themes
       (slug, name, version, author, kind, status, theme_json, stylesheet, stylesheet_hash, source, report_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.slug,
        row.name,
        row.version,
        row.author,
        row.kind,
        row.status,
        row.theme_json,
        row.stylesheet,
        row.stylesheet_hash,
        row.source,
        row.report_json,
        row.created_at,
        row.updated_at,
      ],
    );
    return;
  }
  const existing = await queryOne<{ version: string }>(
    db,
    "SELECT version FROM wl_themes WHERE slug = ? AND source = 'builtin' LIMIT 1",
    [DEFAULT_SLUG],
  );
  if (existing === null) return;
  if (compareSemver(DEFAULT_THEME_VERSION, existing.version) <= 0) return;
  await execRun(
    db,
    `UPDATE wl_themes
     SET theme_json = ?, stylesheet = ?, stylesheet_hash = ?, version = ?, updated_at = ?
     WHERE slug = ? AND source = 'builtin'`,
    [row.theme_json, row.stylesheet, row.stylesheet_hash, row.version, row.updated_at, DEFAULT_SLUG],
  );
}

export async function listThemes(db: Db): Promise<ThemeRecord[]> {
  await ensureDefaultTheme(db);
  const rows = await queryAll<ThemeRow>(db, "SELECT * FROM wl_themes ORDER BY slug ASC");
  return rows.map(rowToRecord);
}

export async function getTheme(db: Db, slug: string): Promise<ThemeRecord> {
  await ensureDefaultTheme(db);
  const row = await queryOne<ThemeRow>(db, "SELECT * FROM wl_themes WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw notFound(`Theme "${slug}" is not installed.`);
  return rowToRecord(row);
}

export async function getActiveThemeSlug(db: Db): Promise<string> {
  await ensureDefaultTheme(db);
  const slug = await getOption<string>(db, ACTIVE_THEME_OPTION, DEFAULT_SLUG);
  const row = await queryOne<ThemeRow>(db, "SELECT slug FROM wl_themes WHERE slug = ? LIMIT 1", [slug]);
  return row === null ? DEFAULT_SLUG : slug;
}

export interface LoadedTheme {
  record: ThemeRecord;
  /** Parsed theme.json (block themes) or null (classic themes). */
  parsed: ParsedThemeJson | null;
  /** Theme files: relative path → content. */
  files: Map<string, string>;
  /** Active stylesheet (generated or imported), variation applied when given. */
  stylesheet: string;
  stylesheetHash: string;
}

async function loadThemeFiles(
  db: Db,
  storage: MediaStorage,
  row: ThemeRow,
): Promise<Map<string, string>> {
  if (row.slug === DEFAULT_SLUG) {
    // Built-in default: files come from the in-code bundle, not R2.
    const files = new Map<string, string>();
    for (const [path, content] of Object.entries(DEFAULT_THEME_FILES)) files.set(path, content);
    files.set("style.css", DEFAULT_THEME_STYLE_CSS);
    return files;
  }
  const keys = await storage.list(`themes/${row.slug}/`);
  const files = new Map<string, string>();
  for (const key of keys) {
    const stored = await storage.get(key);
    if (stored === null) continue;
    files.set(key.slice(`themes/${row.slug}/`.length), new TextDecoder().decode(stored.data));
  }
  return files;
}

/** Load the active theme with its files and stylesheet. */
export async function loadActiveTheme(
  db: Db,
  storage: MediaStorage,
  variation?: Record<string, unknown>,
): Promise<LoadedTheme> {
  const slug = await getActiveThemeSlug(db);
  const row = await queryOne<ThemeRow>(db, "SELECT * FROM wl_themes WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw new Error(`Active theme "${slug}" has no wl_themes row.`);
  const record = rowToRecord(row);
  let parsed: ParsedThemeJson | null = null;
  if (row.theme_json !== null && row.theme_json !== "") {
    try {
      parsed = parseThemeJson(JSON.parse(row.theme_json) as unknown);
    } catch {
      parsed = null;
    }
  }
  const files = await loadThemeFiles(db, storage, row);
  let stylesheet = row.stylesheet;
  if (parsed !== null && variation !== undefined) {
    stylesheet = `${generateThemeCssWithVariation(parsed, variation)}\n${files.get("style.css") ?? ""}`;
  }
  return { record, parsed, files, stylesheet, stylesheetHash: stylesheetHash(stylesheet) };
}

/** Stylesheet for the active theme (variation applied when given). */
export async function getActiveStylesheet(
  db: Db,
  storage: MediaStorage,
  variation?: Record<string, unknown>,
): Promise<{ css: string; hash: string; slug: string }> {
  const loaded = await loadActiveTheme(db, storage, variation);
  return { css: loaded.stylesheet, hash: loaded.stylesheetHash, slug: loaded.record.slug };
}

function slugifyThemeName(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? fallback : slug;
}

async function storeThemeFiles(
  storage: MediaStorage,
  slug: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for (const [path, bytes] of files) {
    await storage.put(`themes/${slug}/${path}`, bytes, contentTypeFor(path));
  }
}

async function upsertThemeRow(db: Db, row: Omit<ThemeRow, "created_at" | "updated_at">): Promise<void> {
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_themes
     (slug, name, version, author, kind, status, theme_json, stylesheet, stylesheet_hash, source, report_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name, version = excluded.version, author = excluded.author,
       kind = excluded.kind, theme_json = excluded.theme_json,
       stylesheet = excluded.stylesheet, stylesheet_hash = excluded.stylesheet_hash,
       source = excluded.source, report_json = excluded.report_json, updated_at = excluded.updated_at`,
    [
      row.slug,
      row.name,
      row.version,
      row.author,
      row.kind,
      row.status,
      row.theme_json,
      row.stylesheet,
      row.stylesheet_hash,
      row.source,
      row.report_json,
      now,
      now,
    ],
  );
}

export interface ImportResult {
  theme: ThemeRecord;
  /** Warnings from the import (skipped files, unsupported theme.json features). */
  warnings: string[];
  /** Files stored, by relative path. */
  files: string[];
}

/** Import a block theme from a ZIP upload. */
export async function importTheme(
  db: Db,
  storage: MediaStorage,
  filename: string,
  data: Uint8Array,
): Promise<ImportResult> {
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw badRequest("Theme import requires a .zip file.");
  }
  await ensureDefaultTheme(db);
  const { files, warnings } = extractThemeZip(data);
  const styleCss = files.get("style.css");
  if (styleCss === undefined) {
    throw badRequest('The theme ZIP is missing "style.css" at its root.');
  }
  const themeJsonRaw = files.get("theme.json");
  if (themeJsonRaw === undefined) {
    throw badRequest('The theme ZIP is missing "theme.json" at its root. Block themes need one; classic themes use the classic import.');
  }
  const header = parseStyleCssHeader(new TextDecoder().decode(styleCss));
  if (header === null) {
    throw badRequest('style.css has no "Theme Name:" header — this does not look like a WordPress theme.');
  }
  let themeJson: unknown;
  try {
    themeJson = JSON.parse(new TextDecoder().decode(themeJsonRaw));
  } catch {
    throw badRequest("theme.json is not valid JSON.");
  }
  const parsed = parseThemeJson(themeJson);
  if (parsed.errors.length > 0) {
    const detail = parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw badRequest(`theme.json is invalid — ${detail}`);
  }
  const slug = slugifyThemeName(header.textDomain !== "" ? header.textDomain : header.name, "imported-theme");
  if (slug === DEFAULT_SLUG) {
    throw badRequest(`A theme with slug "${DEFAULT_SLUG}" already exists (the built-in default).`);
  }
  const generated = generateThemeCss(parsed);
  const styleCssText = new TextDecoder().decode(styleCss);
  const stylesheet = `${generated}\n${styleCssText}`;
  const report = {
    kind: "block-theme-import",
    version: parsed.version,
    warnings: [...warnings, ...parsed.warnings.map((w) => `${w.path}: ${w.message}`)],
    unsupported: parsed.unsupported,
    files: [...files.keys()].sort(),
  };
  await storeThemeFiles(storage, slug, files);
  await upsertThemeRow(db, {
    slug,
    name: header.name,
    version: header.version,
    author: header.author,
    kind: "block",
    status: "inactive",
    theme_json: JSON.stringify(themeJson),
    stylesheet,
    stylesheet_hash: stylesheetHash(stylesheet),
    source: "import",
    report_json: JSON.stringify(report),
  });
  const record = await getTheme(db, slug);
  return { theme: record, warnings: report.warnings, files: report.files };
}

/** Import a classic theme from a ZIP upload: stylesheet + analysis report. */
export async function importClassicTheme(
  db: Db,
  storage: MediaStorage,
  filename: string,
  data: Uint8Array,
): Promise<{ theme: ThemeRecord; report: ClassicReport; warnings: string[] }> {
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw badRequest("Theme import requires a .zip file.");
  }
  await ensureDefaultTheme(db);
  const { files, warnings } = extractThemeZip(data);
  const styleCss = files.get("style.css");
  if (styleCss === undefined) {
    throw badRequest('The theme ZIP is missing "style.css" at its root.');
  }
  const textFiles = new Map<string, string>();
  for (const [path, bytes] of files) {
    if (path.endsWith(".css") || path.endsWith(".php") || path.endsWith(".json") || path.endsWith(".txt")) {
      textFiles.set(path, new TextDecoder().decode(bytes));
    }
  }
  const report = analyzeClassicTheme(textFiles);
  if (report === null) {
    throw badRequest('style.css has no "Theme Name:" header — this does not look like a WordPress theme.');
  }
  const slug = slugifyThemeName(
    report.header.textDomain !== "" ? report.header.textDomain : report.header.name,
    "imported-classic-theme",
  );
  if (slug === DEFAULT_SLUG) {
    throw badRequest(`A theme with slug "${DEFAULT_SLUG}" already exists (the built-in default).`);
  }
  const stylesheet = new TextDecoder().decode(styleCss);
  await storeThemeFiles(storage, slug, files);
  await upsertThemeRow(db, {
    slug,
    name: report.header.name,
    version: report.header.version,
    author: report.header.author,
    kind: "classic",
    status: "inactive",
    theme_json: null,
    stylesheet,
    stylesheet_hash: stylesheetHash(stylesheet),
    source: "import-classic",
    report_json: JSON.stringify(report),
  });
  const record = await getTheme(db, slug);
  return { theme: record, report, warnings };
}

export async function activateTheme(db: Db, slug: string): Promise<ThemeRecord> {
  await ensureDefaultTheme(db);
  const row = await queryOne<ThemeRow>(db, "SELECT * FROM wl_themes WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw notFound(`Theme "${slug}" is not installed.`);
  const now = nowIso();
  await execRun(db, "UPDATE wl_themes SET status = 'inactive', updated_at = ? WHERE status = 'active'", [now]);
  await execRun(db, "UPDATE wl_themes SET status = 'active', updated_at = ? WHERE slug = ?", [now, slug]);
  await setOption(db, ACTIVE_THEME_OPTION, slug);
  return getTheme(db, slug);
}

export async function deleteTheme(db: Db, storage: MediaStorage, slug: string): Promise<boolean> {
  await ensureDefaultTheme(db);
  if (slug === DEFAULT_SLUG) {
    throw badRequest("The built-in default theme cannot be deleted.");
  }
  const active = await getActiveThemeSlug(db);
  if (slug === active) {
    throw badRequest("Cannot delete the active theme. Activate another theme first.");
  }
  const keys = await storage.list(`themes/${slug}/`);
  for (const key of keys) await storage.delete(key);
  const { changes } = await execRun(db, "DELETE FROM wl_themes WHERE slug = ?", [slug]);
  await deleteOption(db, variationOptionKey(slug));
  return changes > 0;
}

export async function getThemeDetail(db: Db, storage: MediaStorage, slug: string): Promise<ThemeDetail> {
  await ensureDefaultTheme(db);
  const row = await queryOne<ThemeRow>(db, "SELECT * FROM wl_themes WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw notFound(`Theme "${slug}" is not installed.`);
  const record = rowToRecord(row);
  let themeJson: Record<string, unknown> | null = null;
  if (row.theme_json !== null && row.theme_json !== "") {
    try {
      themeJson = JSON.parse(row.theme_json) as Record<string, unknown>;
    } catch {
      themeJson = null;
    }
  }
  const filesMap = await loadThemeFiles(db, storage, row);
  const files: Record<string, string> = {};
  for (const [path, content] of filesMap) files[path] = content;
  return { ...record, themeJson, stylesheet: row.stylesheet, files };
}

// ------------------------------------------------------------ variations

export async function getVariation(db: Db, slug: string): Promise<ThemeVariation | null> {
  await getTheme(db, slug);
  return getOption<ThemeVariation | null>(db, variationOptionKey(slug), null);
}

/** Remove a saved variation (the theme renders with its own theme.json again). */
export async function deleteVariation(db: Db, slug: string): Promise<boolean> {
  await getTheme(db, slug);
  return deleteOption(db, variationOptionKey(slug));
}

export async function saveVariation(
  db: Db,
  slug: string,
  input: { name?: string; settings: Record<string, unknown> },
): Promise<ThemeVariation> {
  const theme = await getTheme(db, slug);
  if (theme.kind !== "block") {
    throw badRequest("Variations apply to block themes only (classic themes have no theme.json).");
  }
  if (input.settings === undefined || typeof input.settings !== "object" || input.settings === null) {
    throw badRequest("A variation needs a settings object.");
  }
  const errors = validateThemeSettings(input.settings, 3);
  if (errors.length > 0) {
    throw badRequest(`Variation settings are invalid — ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }
  const variation: ThemeVariation = {
    name: typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : "Custom",
    settings: input.settings,
    updatedAt: nowIso(),
  };
  await setOption(db, variationOptionKey(slug), variation);
  return variation;
}

// --------------------------------------------------------------- preview

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export async function createPreview(
  db: Db,
  slug: string,
  settings: Record<string, unknown>,
): Promise<ThemePreview> {
  const theme = await getTheme(db, slug);
  if (theme.kind !== "block") {
    throw badRequest("Previews apply to block themes only (classic themes have no theme.json).");
  }
  const errors = validateThemeSettings(settings, 3);
  if (errors.length > 0) {
    throw badRequest(`Preview settings are invalid — ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const preview: ThemePreview = {
    token,
    slug,
    settings,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
  };
  await setOption(db, PREVIEW_OPTION, preview);
  return preview;
}

/** Resolve a preview token to its (slug, settings), or null when missing/expired. */
export async function getPreview(
  db: Db,
  token: string,
): Promise<{ slug: string; settings: Record<string, unknown> } | null> {
  if (token === "") return null;
  const preview = await getOption<ThemePreview | null>(db, PREVIEW_OPTION, null);
  if (preview === null || preview.token !== token) return null;
  if (Date.parse(preview.expiresAt) <= Date.now()) return null;
  return { slug: preview.slug, settings: preview.settings };
}
