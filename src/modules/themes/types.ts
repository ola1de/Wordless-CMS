/**
 * Theme types (Milestone 5).
 *
 * A theme is NOT an extension: themes live in `wl_themes`, their files in
 * R2 under `themes/<slug>/`. A block theme has a theme.json + block
 * templates; a classic theme has a style.css + PHP templates that Wordless
 * cannot execute — it is imported for its stylesheet + analysis report
 * only (see classic.ts).
 */

export type ThemeKind = "block" | "classic";
export type ThemeStatus = "active" | "inactive";

export interface ThemeRecord {
  slug: string;
  name: string;
  version: string;
  author: string;
  kind: ThemeKind;
  status: ThemeStatus;
  /** True when a theme.json is stored (block themes only). */
  hasThemeJson: boolean;
  stylesheetHash: string;
  source: string;
  /** Import/classic report when one exists (parsed report_json). */
  report: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeDetail extends ThemeRecord {
  /** Parsed theme.json (block themes) or null (classic themes). */
  themeJson: Record<string, unknown> | null;
  /** The generated (block) or imported (classic) stylesheet. */
  stylesheet: string;
  /** Theme files: relative path → content (templates, parts, style.css). */
  files: Record<string, string>;
}

/** A customizer variation: a partial theme.json `settings` object. */
export interface ThemeVariation {
  name: string;
  /** Partial settings, merged over the theme's own settings. */
  settings: Record<string, unknown>;
  updatedAt: string;
}

/** A short-lived preview token: unsaved variation overrides for one render. */
export interface ThemePreview {
  token: string;
  slug: string;
  settings: Record<string, unknown>;
  expiresAt: string;
}

export const ACTIVE_THEME_OPTION = "active_theme";
export const DEFAULT_THEME_SLUG = "wordless-default";

export function variationOptionKey(slug: string): string {
  return `wl_theme_variation_${slug}`;
}

export const PREVIEW_OPTION = "wl_theme_preview";
