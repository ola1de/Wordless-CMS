/**
 * Auto-convert on upload (Milestone 11).
 *
 * When a theme or plugin ZIP is uploaded, Wordless now *converts* it,
 * not just analyses it: every PHP file goes through the M4 engine
 * (`convertPhp`) and the generated TypeScript is stored in R2 under
 * `<prefix>/converted/<path>.ts`, next to the original files. Settings
 * travel too: literal `get_option()` defaults found in the PHP are
 * carried over as Wordless options (only when the option does not
 * already exist), and a theme's `theme.json` settings are reported as
 * applied by the theme engine (CSS presets) or skipped with a reason.
 *
 * Honest boundary (read this before promising anything):
 * - "Exact, nothing lost" conversion of arbitrary PHP is NOT possible.
 *   Dynamic behaviour, hooks/filters with no Wordless equivalent, AJAX
 *   handlers and class-heavy code cannot all convert. So every upload
 *   produces this per-file record (converted / partial / blocked +
 *   reason) and a settings-migration report — nothing is silent, and
 *   nothing is ever labelled "fully converted" while the record shows
 *   partial or blocked items.
 * - Converted code is stored, never executed. A converted plugin does
 *   not run until a later milestone loads generated extensions; the
 *   conversion record is the deliverable, not a running plugin.
 * - Conversion runs synchronously inside the install/import request.
 *   At most 500 PHP files are converted per upload (1 MB per file);
 *   the rest are recorded as skipped. The look of a theme (theme.json,
 *   CSS, templates, patterns) is carried over by the theme import
 *   itself — see the theme import report — not by this module.
 */
import type { Db } from "../../db";
import {
  ConversionBlockedError,
  ConversionParseError,
  convertPhp,
} from "../../conversion/index";
import { analyzePhp, type OptionDefault } from "../../conversion/analyze";
import { addOption } from "../options/service";
import { MAX_ANALYSED_PHP_BYTES, MAX_ANALYSED_PHP_FILES } from "../integrations/compat-report";

/** Worst case per upload: 500 PHP files converted, the rest skipped. */
export const MAX_CONVERT_PHP_FILES = 500;
/** Per-file conversion records stored in the report. */
export const MAX_CONVERT_REPORT_FILES = 500;

export type AutoConvertFileStatus = "converted" | "partial" | "blocked";

export interface AutoConvertedFile {
  file: string;
  status: AutoConvertFileStatus;
  functionsConverted: string[];
  hooksConverted: string[];
  unconverted: Array<{ kind: string; name?: string; reason: string; line: number }>;
  /** Human-readable summary of what happened to this file. */
  reason: string;
  /** R2 path of the stored TypeScript (null when nothing was generated). */
  generatedPath: string | null;
}

export interface SettingsMigrationEntry {
  key: string;
  value: string | number | boolean;
  source: "php-default" | "theme.json";
  reason?: string;
}

export interface SettingsMigrationReport {
  carriedOver: SettingsMigrationEntry[];
  skipped: SettingsMigrationEntry[];
}

export interface AutoConvertReport {
  kind: "theme" | "plugin";
  slug: string;
  phpFiles: number;
  converted: number;
  partial: number;
  blocked: number;
  skipped: number;
  files: AutoConvertedFile[];
  filesTruncated: boolean;
  settings: SettingsMigrationReport;
  convertedAt: string;
}

function isPhpFile(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

/**
 * Convert every PHP file in an extracted ZIP. Pure except for no I/O:
 * returns the generated TypeScript per file; the caller stores it.
 * Nothing here executes PHP.
 */
export function convertPhpFiles(
  files: Map<string, Uint8Array>,
  slug: string,
  kind: "theme" | "plugin",
): { generated: Map<string, string>; report: AutoConvertReport } {
  const phpPaths = [...files.keys()].filter(isPhpFile).sort();
  const generated = new Map<string, string>();
  const records: AutoConvertedFile[] = [];
  let skipped = 0;
  let convertedCount = 0;

  for (const path of phpPaths) {
    const bytes = files.get(path);
    if (bytes === undefined) continue;
    if (convertedCount >= MAX_CONVERT_PHP_FILES || bytes.byteLength > MAX_ANALYSED_PHP_BYTES) {
      skipped += 1;
      records.push({
        file: path,
        status: "blocked",
        functionsConverted: [],
        hooksConverted: [],
        unconverted: [],
        reason:
          bytes.byteLength > MAX_ANALYSED_PHP_BYTES
            ? "Skipped: file is over the 1 MB per-file conversion cap."
            : `Skipped: only the first ${MAX_CONVERT_PHP_FILES} PHP files are converted per upload.`,
        generatedPath: null,
      });
      continue;
    }
    convertedCount += 1;
    let text: string;
    try {
      text = new TextDecoder().decode(bytes);
    } catch {
      records.push({
        file: path,
        status: "blocked",
        functionsConverted: [],
        hooksConverted: [],
        unconverted: [],
        reason: "File could not be decoded as text.",
        generatedPath: null,
      });
      continue;
    }
    try {
      const converted = convertPhp(text, path, { slug, sourceLabel: `${slug}/${path}` });
      const generatedPath = `converted/${path.replace(/\.php$/i, ".ts")}`;
      generated.set(generatedPath, converted.output.code);
      const partial = converted.unconverted.length > 0 || converted.ast.classes > 0;
      records.push({
        file: path,
        status: partial ? "partial" : "converted",
        functionsConverted: converted.converted.functions,
        hooksConverted: converted.converted.hooks.map((h) => `${h.kind}:${h.tag}`),
        unconverted: converted.unconverted,
        reason: partial
          ? `${converted.unconverted.length} item${converted.unconverted.length === 1 ? "" : "s"} could not be converted${converted.ast.classes > 0 ? `; ${converted.ast.classes} class${converted.ast.classes === 1 ? "" : "es"} need${converted.ast.classes === 1 ? "s" : ""} a class runtime` : ""}.`
          : `Converted ${converted.converted.functions.length} function${converted.converted.functions.length === 1 ? "" : "s"}${converted.converted.hooks.length > 0 ? ` and ${converted.converted.hooks.length} hook${converted.converted.hooks.length === 1 ? "" : "s"}` : ""}.`,
        generatedPath,
      });
    } catch (err) {
      if (err instanceof ConversionBlockedError) {
        records.push({
          file: path,
          status: "blocked",
          functionsConverted: [],
          hooksConverted: [],
          unconverted: err.violations.map((v) => ({ kind: v.construct, reason: v.reason, line: v.line })),
          reason: `Blocked by the conversion sandbox: ${err.violations.map((v) => v.construct).join(", ")}.`,
          generatedPath: null,
        });
      } else if (err instanceof ConversionParseError) {
        records.push({
          file: path,
          status: "blocked",
          functionsConverted: [],
          hooksConverted: [],
          unconverted: [],
          reason: `Could not be parsed: ${err.message.slice(0, 200)}`,
          generatedPath: null,
        });
      } else {
        records.push({
          file: path,
          status: "blocked",
          functionsConverted: [],
          hooksConverted: [],
          unconverted: [],
          reason: `Conversion failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`,
          generatedPath: null,
        });
      }
    }
  }

  const count = (s: AutoConvertFileStatus): number => records.filter((r) => r.status === s).length;
  const rank: Record<AutoConvertFileStatus, number> = { blocked: 0, partial: 1, converted: 2 };
  const ordered = [...records].sort((a, b) => rank[a.status] - rank[b.status] || a.file.localeCompare(b.file));
  return {
    generated,
    report: {
      kind,
      slug,
      phpFiles: phpPaths.length,
      converted: count("converted"),
      partial: count("partial"),
      blocked: count("blocked"),
      skipped,
      files: ordered.slice(0, MAX_CONVERT_REPORT_FILES),
      filesTruncated: ordered.length > MAX_CONVERT_REPORT_FILES,
      settings: { carriedOver: [], skipped: [] },
      convertedAt: new Date().toISOString(),
    },
  };
}

/**
 * Collect literal option defaults from PHP files (analysis only, no
 * conversion). Used by the theme import, which does not run the
 * marketplace analyser. Unparseable files are skipped here — the
 * conversion record already says so.
 */
export function collectOptionDefaults(files: Map<string, Uint8Array>): OptionDefault[] {
  const out: OptionDefault[] = [];
  const phpPaths = [...files.keys()].filter(isPhpFile).sort();
  let analysed = 0;
  for (const path of phpPaths) {
    const bytes = files.get(path);
    if (bytes === undefined) continue;
    if (analysed >= MAX_ANALYSED_PHP_FILES || bytes.byteLength > MAX_ANALYSED_PHP_BYTES) continue;
    analysed += 1;
    try {
      out.push(...analyzePhp(new TextDecoder().decode(bytes), path).optionDefaults);
    } catch {
      // Unparseable — the conversion record already says so.
    }
  }
  return out;
}

/**
 * Carry literal option defaults over as Wordless options. Only options
 * that do not already exist are written (`addOption`); existing ones
 * are reported as skipped, never overwritten. Non-literal defaults are
 * never collected, so they never appear here.
 */
export async function migrateOptionDefaults(
  db: Db,
  defaults: OptionDefault[],
): Promise<SettingsMigrationReport> {
  const carriedOver: SettingsMigrationEntry[] = [];
  const skipped: SettingsMigrationEntry[] = [];
  const seen = new Set<string>();
  for (const def of defaults) {
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    const added = await addOption(db, def.key, def.defaultValue);
    if (added) {
      carriedOver.push({ key: def.key, value: def.defaultValue, source: "php-default" });
    } else {
      skipped.push({ key: def.key, value: def.defaultValue, source: "php-default", reason: "Option already exists — kept the existing value." });
    }
  }
  return { carriedOver, skipped };
}

/**
 * Summarise a theme.json's settings as a migration report: the theme
 * engine applies these as CSS (presets), so they count as carried
 * over; settings paths the engine reports as unsupported count as
 * skipped. Counts come from the parsed theme.json object itself.
 */
export function summarizeThemeJsonSettings(
  themeJson: unknown,
  unsupported: string[],
): SettingsMigrationReport {
  const carriedOver: SettingsMigrationEntry[] = [];
  const skipped: SettingsMigrationEntry[] = [];
  const settings =
    themeJson !== null && typeof themeJson === "object" && !Array.isArray(themeJson)
      ? ((themeJson as Record<string, unknown>).settings as Record<string, unknown> | undefined)
      : undefined;
  if (settings !== undefined && typeof settings === "object") {
    const palette = (settings.color as Record<string, unknown> | undefined)?.palette;
    const fontSizes = (settings.typography as Record<string, unknown> | undefined)?.fontSizes;
    const spacingSizes = (settings.spacing as Record<string, unknown> | undefined)?.spacingSizes;
    const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
    if (count(palette) > 0) {
      carriedOver.push({ key: "theme.json color palette", value: count(palette), source: "theme.json" });
    }
    if (count(fontSizes) > 0) {
      carriedOver.push({ key: "theme.json font sizes", value: count(fontSizes), source: "theme.json" });
    }
    if (count(spacingSizes) > 0) {
      carriedOver.push({ key: "theme.json spacing sizes", value: count(spacingSizes), source: "theme.json" });
    }
    if (typeof settings.layout === "object" && settings.layout !== null) {
      carriedOver.push({ key: "theme.json layout widths", value: 1, source: "theme.json" });
    }
  }
  for (const path of unsupported) {
    skipped.push({ key: `theme.json ${path}`, value: 0, source: "theme.json", reason: "Not supported by the Wordless theme engine — ignored." });
  }
  return { carriedOver, skipped };
}

/** Merge a theme.json summary into a conversion report's settings. */
export function mergeSettingsReports(
  into: SettingsMigrationReport,
  extra: SettingsMigrationReport,
): SettingsMigrationReport {
  return {
    carriedOver: [...into.carriedOver, ...extra.carriedOver],
    skipped: [...into.skipped, ...extra.skipped],
  };
}
