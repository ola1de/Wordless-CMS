/**
 * Fixture generation (Milestone 4) — dev-time only.
 *
 * Two checked-in artifacts are produced by the converter itself and must
 * stay in sync with it:
 * 1. examples/hello-dolly/index.ts (+ extension.json) — the converter's
 *    output for the bundled Hello Dolly plugin.
 * 2. docs/conversion/akismet-analysis.md — the static analysis of the
 *    bundled Akismet plugin.
 *
 * Running the suite normally only ASSERTS these files exist and are
 * consistent. Regenerate them with:
 *
 *   GENERATE_FIXTURES=1 npx vitest run src/conversion/generate-fixtures.test.ts
 *
 * Both generators read the local reference copy of WordPress 7.1.5
 * (~/workspace/wordless/reference/, never committed). They skip when it
 * is absent, so a fresh clone without the reference copy still passes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePhp, renderAnalysisReport, type FileAnalysis } from "./analyze";
import { convertPhp } from "./index";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HELLO_PATH = join(REPO_ROOT, "..", "reference", "wordpress-7.1.5", "wp-content", "plugins", "hello.php");
const AKISMET_DIR = join(REPO_ROOT, "..", "reference", "wordpress-7.1.5", "wp-content", "plugins", "akismet");
const HELLO_OUT_DIR = join(REPO_ROOT, "examples", "hello-dolly");
const HELLO_OUT = join(HELLO_OUT_DIR, "index.ts");
const HELLO_MANIFEST = join(HELLO_OUT_DIR, "extension.json");
const AKISMET_REPORT = join(REPO_ROOT, "docs", "conversion", "akismet-analysis.md");

const GENERATE = process.env.GENERATE_FIXTURES === "1";

function listPhpFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listPhpFiles(full));
    else if (entry.endsWith(".php")) out.push(full);
  }
  return out.sort();
}

describe("fixture generation (M4)", () => {
  it.skipIf(!existsSync(HELLO_PATH))("hello-dolly fixture exists and matches a fresh conversion", () => {
    expect(existsSync(HELLO_OUT)).toBe(true);
    expect(existsSync(HELLO_MANIFEST)).toBe(true);
    const source = readFileSync(HELLO_PATH, "utf8");
    const report = convertPhp(source, "hello.php", { slug: "hello-dolly" });
    expect(readFileSync(HELLO_OUT, "utf8")).toBe(report.output.code);
    const manifest = JSON.parse(readFileSync(HELLO_MANIFEST, "utf8")) as Record<string, unknown>;
    expect(manifest.slug).toBe("hello-dolly");
    expect(manifest.name).toBe("Hello Dolly");
    expect(manifest.version).toBe("1.7.2");
  });

  it.skipIf(!existsSync(AKISMET_DIR))("akismet analysis exists and covers every PHP file", () => {
    expect(existsSync(AKISMET_REPORT)).toBe(true);
    const files = listPhpFiles(AKISMET_DIR);
    expect(files.length).toBeGreaterThan(10);
    const report = readFileSync(AKISMET_REPORT, "utf8");
    for (const file of files) {
      const rel = file.slice(AKISMET_DIR.length + 1);
      expect(report).toContain(`\`${rel}\``);
    }
    expect(report).toContain("Akismet is NOT converted in M4");
  });

  it.skipIf(!GENERATE || !existsSync(HELLO_PATH))("GENERATE_FIXTURES=1: write the hello-dolly fixture", () => {
    const source = readFileSync(HELLO_PATH, "utf8");
    const report = convertPhp(source, "hello.php", { slug: "hello-dolly" });
    mkdirSync(HELLO_OUT_DIR, { recursive: true });
    writeFileSync(HELLO_OUT, report.output.code);
    writeFileSync(
      HELLO_MANIFEST,
      JSON.stringify(
        {
          slug: report.extension.slug,
          name: report.extension.name,
          version: report.extension.version,
          author: "Matt Mullenweg",
          description:
            "Converted from the bundled Hello Dolly plugin (WordPress 7.1.5) by the Wordless conversion engine (M4). Shows a random lyric from Hello, Dolly in the admin.",
          sourceFile: "hello.php",
          generatedBy: "wordless-conversion-m4",
          convertedFunctions: report.converted.functions,
          hooks: report.converted.hooks,
          unconverted: report.unconverted,
          warnings: report.warnings,
        },
        null,
        2,
      ) + "\n",
    );
    expect(existsSync(HELLO_OUT)).toBe(true);
  });

  it.skipIf(!GENERATE || !existsSync(AKISMET_DIR))("GENERATE_FIXTURES=1: write the akismet analysis", () => {
    const files = listPhpFiles(AKISMET_DIR);
    const analyses: FileAnalysis[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const rel = file.slice(AKISMET_DIR.length + 1);
      try {
        analyses.push(analyzePhp(readFileSync(file, "utf8"), rel));
      } catch (err) {
        failures.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(failures).toEqual([]);
    const report = renderAnalysisReport(analyses, {
      title: "Akismet — conversion analysis (Milestone 4)",
      intro: [
        "Static analysis of the Akismet plugin bundled with WordPress 7.1.5,",
        "run through the Wordless PHP parser (Milestone 4). Akismet is **NOT",
        "converted in M4**: it is a commercial spam-filtering service whose",
        "value is an external API and a spam database, not the PHP code",
        "around them. A translation of the PHP would still need the Akismet",
        "API (key, HTTP endpoints, account) and a spam-decision service —",
        "that is an integration (Phase 8), not a conversion. This report",
        "says, file by file, what a future conversion would face.",
      ].join(" "),
      generatedBy:
        "Analysis: Wordless conversion engine (M4), static parse only — no PHP executed. " +
        "Akismet is NOT converted in M4 (external API + spam database + commercial service).",
    });
    mkdirSync(join(REPO_ROOT, "docs", "conversion"), { recursive: true });
    writeFileSync(AKISMET_REPORT, report);
    expect(existsSync(AKISMET_REPORT)).toBe(true);
  });
});
