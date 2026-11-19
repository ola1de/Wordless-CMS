/**
 * Plugin compatibility analyser (Milestone 11).
 *
 * When a plugin ZIP is installed via the marketplace, the M4 PHP
 * analyser (`src/conversion/analyze.ts`) runs over its PHP files and the
 * result is stored as a per-plugin compatibility report on the
 * wl_extensions row. The report is a static map, not a promise: a
 * "compatible" verdict means every analysed file is procedural code the
 * converter can translate; "partial" means some files need a class
 * runtime or manual work; "blocked" means some files call an external
 * API, use $wpdb, or contain a construct the sandbox blocks. Installed
 * code is NEVER executed — this analysis only parses source text.
 *
 * Honest limits:
 * - The analyser parses PHP; it does not run it, so runtime behaviour
 *   (what a plugin actually does when activated) is NOT verified.
 * - A plugin whose files are all "convertible" is still inert after
 *   install: Wordless does not execute uploaded PHP. Activation only
 *   records the status; running the plugin needs the conversion
 *   pipeline (M4) to produce a Wordless extension first.
 * - Analysis runs synchronously inside the install request. To bound
 *   that work, at most 2000 PHP files are analysed per install and
 *   individual PHP files over 1 MB are skipped; both are recorded in
 *   the report as `skipped` so the counts always add up.
 */
import { analyzePhp, type OptionDefault } from "../../conversion/analyze";
import type { AutoConvertReport } from "../conversion/auto-convert";

export type PluginFileVerdictKind = "convertible" | "partial" | "blocked" | "unparsed";

/** Worst case per install: 2000 PHP files analysed, the rest skipped. */
export const MAX_ANALYSED_PHP_FILES = 2000;
/** A single PHP file over this size is skipped by the analyser. */
export const MAX_ANALYSED_PHP_BYTES = 1024 * 1024;
/** Per-file verdicts stored in the report (partial/blocked first). */
export const MAX_REPORT_FILES = 500;
/** Blocking reasons listed in the report. */
export const MAX_TOP_REASONS = 8;

export interface PluginFileVerdict {
  file: string;
  verdict: PluginFileVerdictKind;
  reasons: string[];
}

export interface PluginBlockingReason {
  kind: string;
  count: number;
  /** Up to 5 example files where this reason occurs. */
  files: string[];
}

export type PluginOverallVerdict = "compatible" | "partial" | "blocked" | "not-analysed";

export interface PluginCompatibilityReport {
  /** PHP files found in the ZIP. */
  phpFiles: number;
  /** All files in the ZIP (PHP + assets + everything else). */
  totalFiles: number;
  convertible: number;
  partial: number;
  blocked: number;
  /** PHP files the parser could not read. */
  unparsed: number;
  /** PHP files skipped by the analyser caps (see module docs). */
  skipped: number;
  verdict: PluginOverallVerdict;
  topReasons: PluginBlockingReason[];
  /** Per-file verdicts, partial/blocked/unparsed first, capped. */
  files: PluginFileVerdict[];
  filesTruncated: boolean;
  /** Literal option defaults found in the PHP (M11 settings migration). */
  optionDefaults: OptionDefault[];
  /** M11 auto-conversion record (null when no PHP files were converted). */
  conversion: AutoConvertReport | null;
  analysedAt: string;
}

function isPhpFile(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

/** Analyse a plugin's extracted files. Pure function — no I/O, no PHP executed. */
export function analyzePluginFiles(files: Map<string, Uint8Array>): PluginCompatibilityReport {
  const phpPaths = [...files.keys()].filter(isPhpFile).sort();
  const verdicts: PluginFileVerdict[] = [];
  const reasonCounts = new Map<string, { count: number; files: string[] }>();
  const optionDefaults: OptionDefault[] = [];
  let skipped = 0;
  let analysed = 0;

  const recordReason = (kind: string, file: string): void => {
    const entry = reasonCounts.get(kind) ?? { count: 0, files: [] };
    entry.count += 1;
    if (entry.files.length < 5 && !entry.files.includes(file)) entry.files.push(file);
    reasonCounts.set(kind, entry);
  };

  for (const path of phpPaths) {
    const bytes = files.get(path);
    if (bytes === undefined) continue;
    if (analysed >= MAX_ANALYSED_PHP_FILES || bytes.byteLength > MAX_ANALYSED_PHP_BYTES) {
      skipped += 1;
      continue;
    }
    analysed += 1;
    let text: string;
    try {
      text = new TextDecoder().decode(bytes);
    } catch {
      verdicts.push({ file: path, verdict: "unparsed", reasons: ["File could not be decoded as text."] });
      recordReason("undecodable", path);
      continue;
    }
    try {
      const analysis = analyzePhp(text, path);
      verdicts.push({ file: path, verdict: analysis.verdict, reasons: analysis.reasons });
      optionDefaults.push(...analysis.optionDefaults);
      for (const u of analysis.unconvertible) recordReason(u.kind, path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verdicts.push({
        file: path,
        verdict: "unparsed",
        reasons: [`Could not be parsed by the PHP analyser: ${message.slice(0, 200)}`],
      });
      recordReason("parse-error", path);
    }
  }

  const count = (v: PluginFileVerdictKind): number => verdicts.filter((f) => f.verdict === v).length;
  const convertible = count("convertible");
  const partial = count("partial");
  const blocked = count("blocked");
  const unparsed = count("unparsed");

  let verdict: PluginOverallVerdict;
  if (phpPaths.length === 0) {
    verdict = "not-analysed";
  } else if (blocked > 0 || unparsed > 0) {
    verdict = "blocked";
  } else if (partial > 0) {
    verdict = "partial";
  } else {
    verdict = "compatible";
  }

  const rank: Record<PluginFileVerdictKind, number> = { blocked: 0, partial: 1, unparsed: 2, convertible: 3 };
  const ordered = [...verdicts].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.file.localeCompare(b.file));
  const filesTruncated = ordered.length > MAX_REPORT_FILES;
  const topReasons: PluginBlockingReason[] = [...reasonCounts.entries()]
    .map(([kind, entry]) => ({ kind, count: entry.count, files: entry.files }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, MAX_TOP_REASONS);

  return {
    phpFiles: phpPaths.length,
    totalFiles: files.size,
    convertible,
    partial,
    blocked,
    unparsed,
    skipped,
    verdict,
    topReasons,
    files: ordered.slice(0, MAX_REPORT_FILES),
    filesTruncated,
    optionDefaults,
    conversion: null,
    analysedAt: new Date().toISOString(),
  };
}

/** Parse a stored report (or null when absent/invalid — "not analysed"). */
export function parseCompatibilityReport(raw: string | null): PluginCompatibilityReport | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Partial<PluginCompatibilityReport>;
    if (typeof r.verdict !== "string" || typeof r.phpFiles !== "number") return null;
    return parsed as PluginCompatibilityReport;
  } catch {
    return null;
  }
}
