/**
 * Classic-theme analysis (Milestone 5).
 *
 * A classic theme is a style.css header + PHP templates. Wordless cannot
 * execute PHP, so a classic theme is imported for its stylesheet plus a
 * per-file static analysis (reusing the M4 analyser) — never converted
 * wholesale. This module parses the style.css header, scans template
 * files for the WordPress template tags they use, and produces the
 * import report.
 */
import { analyzePhp, type FileAnalysis } from "../../conversion/analyze";

export interface StyleCssHeader {
  name: string;
  version: string;
  author: string;
  description: string;
  themeUri: string;
  authorUri: string;
  textDomain: string;
  tags: string[];
  requiresWordPress: string;
  requiresPhp: string;
  /** Raw header fields as parsed (key → value). */
  raw: Record<string, string>;
}

/** Parse the style.css header block (Theme Name, Version, …). */
export function parseStyleCssHeader(css: string): StyleCssHeader | null {
  const match = css.match(/\/\*([\s\S]*?)\*\//);
  if (match === null) return null;
  const raw: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const kv = line.match(/^\s*([A-Za-z][A-Za-z ]*?):\s*(.*)\s*$/);
    if (kv !== null && kv[1] !== undefined && kv[2] !== undefined) {
      raw[kv[1].trim()] = kv[2].trim();
    }
  }
  if (raw["Theme Name"] === undefined || raw["Theme Name"] === "") return null;
  return {
    name: raw["Theme Name"] ?? "",
    version: raw["Version"] ?? "0.1.0",
    author: raw["Author"] ?? "",
    description: raw["Description"] ?? "",
    themeUri: raw["Theme URI"] ?? "",
    authorUri: raw["Author URI"] ?? "",
    textDomain: raw["Text Domain"] ?? "",
    tags: (raw["Tags"] ?? "").split(",").map((t) => t.trim()).filter((t) => t !== ""),
    requiresWordPress: raw["Requires at least"] ?? "",
    requiresPhp: raw["Requires PHP"] ?? "",
    raw,
  };
}

/** WordPress template tags whose presence says what a template does. */
export const TEMPLATE_TAGS = [
  "get_header",
  "get_footer",
  "get_sidebar",
  "get_template_part",
  "have_posts",
  "the_post",
  "the_title",
  "the_content",
  "the_excerpt",
  "the_permalink",
  "the_date",
  "the_author",
  "the_category",
  "the_tags",
  "comments_template",
  "wp_head",
  "wp_footer",
  "wp_nav_menu",
  "get_search_form",
  "bloginfo",
  "wp_enqueue_style",
  "wp_enqueue_script",
  "add_action",
  "add_filter",
  "register_nav_menu",
  "add_theme_support",
] as const;

export interface ClassicFileReport extends FileAnalysis {
  /** Template tags found in this file (literal scan, static only). */
  templateTags: string[];
}

export interface ClassicReport {
  header: StyleCssHeader;
  /** style.css bytes (the imported stylesheet). */
  cssBytes: number;
  files: ClassicFileReport[];
  convertible: number;
  partial: number;
  blocked: number;
  /** What the import did and did not do. */
  notes: string[];
}

/** Scan one PHP source for literal template-tag calls (static, no execution). */
export function findTemplateTags(source: string): string[] {
  const found: string[] = [];
  for (const tag of TEMPLATE_TAGS) {
    if (new RegExp(`\\b${tag}\\s*\\(`).test(source)) found.push(tag);
  }
  return found;
}

/**
 * Analyse a classic theme's files. `files` maps relative paths
 * (style.css, index.php, …) to contents. PHP files go through the M4
 * analyser; the style.css header decides the theme identity.
 */
export function analyzeClassicTheme(files: Map<string, string>): ClassicReport | null {
  const css = files.get("style.css");
  if (css === undefined) return null;
  const header = parseStyleCssHeader(css);
  if (header === null) return null;
  const reports: ClassicFileReport[] = [];
  for (const [path, source] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.toLowerCase().endsWith(".php")) continue;
    let analysis: FileAnalysis;
    try {
      analysis = analyzePhp(source, path);
    } catch (err) {
      // A file the parser cannot handle is reported, not fatal.
      analysis = {
        file: path,
        lines: source.split("\n").length,
        bytes: new TextEncoder().encode(source).length,
        tokens: 0,
        nodes: 0,
        functions: [],
        classes: [],
        hooks: [],
        wpCalls: [],
        optionKeys: [],
        httpCalls: [],
        features: [],
        unconvertible: [
          {
            kind: "parse-error",
            reason: err instanceof Error ? err.message : "Could not parse this file.",
            line: 1,
          },
        ],
        verdict: "partial",
        reasons: ["could not be fully parsed; needs manual review."],
      };
    }
    reports.push({ ...analysis, templateTags: findTemplateTags(source) });
  }
  const convertible = reports.filter((r) => r.verdict === "convertible").length;
  const partial = reports.filter((r) => r.verdict === "partial").length;
  const blocked = reports.filter((r) => r.verdict === "blocked").length;
  return {
    header,
    cssBytes: new TextEncoder().encode(css).length,
    files: reports,
    convertible,
    partial,
    blocked,
    notes: [
      "Classic themes are imported for their stylesheet and analysis only: PHP templates are never executed.",
      "The style.css is served as the theme stylesheet; templates are not converted to block templates in M5.",
      "Template tags used by the PHP files are listed per file — they show what a future block-template conversion would need to reproduce.",
    ],
  };
}

/** Render the classic report as markdown (docs + admin display). */
export function renderClassicReport(report: ClassicReport): string {
  const lines: string[] = [];
  lines.push(`# Classic theme — ${report.header.name} (import report)`);
  lines.push(``);
  lines.push(`Version ${report.header.version}${report.header.author !== "" ? ` by ${report.header.author}` : ""}.`);
  if (report.header.description !== "") lines.push(report.header.description);
  lines.push(``);
  lines.push(`- Stylesheet imported: **${report.cssBytes} bytes** of style.css.`);
  lines.push(`- PHP files analysed: **${report.files.length}** — convertible **${report.convertible}** · partial **${report.partial}** · blocked **${report.blocked}**.`);
  lines.push(``);
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push(``);
  lines.push(`| File | Lines | Verdict | Template tags | Why |`);
  lines.push(`| --- | ---: | --- | --- | --- |`);
  for (const f of report.files) {
    lines.push(`| \`${f.file}\` | ${f.lines} | ${f.verdict} | ${f.templateTags.join(", ") || "—"} | ${f.reasons.join(" ")} |`);
  }
  return lines.join("\n");
}
