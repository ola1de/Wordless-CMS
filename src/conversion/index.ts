/**
 * WordPress conversion engine (Milestone 4) — conversion pipeline.
 *
 * One function, `convertPhp`, runs the whole pipeline for a single PHP
 * file: safety scan → lex → parse → emit. It never executes the source.
 * The result is a ConversionReport (counts, converted/unconverted items,
 * warnings, the generated TypeScript) that the jobs module stores in
 * `wl_jobs.result`.
 */
import { countAstNodes, walkAst, type ProgramNode } from "./ast";
import { emitTypeScript, type EmitOptions } from "./emitter";
import { parsePhp, parsePluginHeader } from "./parser";
import { scanSafety } from "./safety";

export interface ConversionReport {
  source: { filename: string; bytes: number; lines: number };
  filesProcessed: number;
  ast: { nodes: number; functions: number; classes: number; hooks: number };
  converted: { functions: string[]; hooks: { tag: string; kind: string; functionName: string }[] };
  unconverted: { kind: string; name?: string; reason: string; line: number }[];
  warnings: string[];
  transformed: { what: string; note: string }[];
  output: { filename: string; bytes: number; code: string };
  extension: { slug: string; name: string; version: string };
  durationMs: number;
}

export interface ConvertOptions {
  slug: string;
  compatImport?: string;
  sourceLabel?: string;
}

export class ConversionBlockedError extends Error {
  readonly violations: { construct: string; reason: string; line: number }[];
  constructor(violations: { construct: string; reason: string; line: number }[]) {
    super(
      `Conversion blocked by the sandbox (${violations.length} violation${violations.length === 1 ? "" : "s"}): ` +
        violations.map((v) => `line ${v.line}: ${v.construct}`).join("; "),
    );
    this.name = "ConversionBlockedError";
    this.violations = violations;
  }
}

export class ConversionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionParseError";
  }
}

/**
 * Convert one PHP source file to a Wordless extension module.
 * Throws ConversionBlockedError (sandbox) or ConversionParseError (syntax).
 */
export function convertPhp(source: string, filename: string, options: ConvertOptions): ConversionReport {
  const started = Date.now();
  const lines = source.split("\n").length;

  // 1. Sandbox safety scan — blocked constructs fail the job, fast.
  const safety = scanSafety(source);
  if (!safety.safe) {
    throw new ConversionBlockedError(
      safety.violations.map((v) => ({ construct: v.construct, reason: v.reason, line: v.line })),
    );
  }

  // 2. Parse.
  let program: ProgramNode;
  let comments: { text: string; pos: { line: number; column: number; offset: number } }[];
  try {
    const parsed = parsePhp(source);
    program = parsed.program;
    comments = parsed.comments;
  } catch (err) {
    throw new ConversionParseError(
      `Could not parse ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Emit.
  const header = parsePluginHeader(comments);
  const emitOptions: EmitOptions = {
    filename,
    slug: options.slug,
    compatImport: options.compatImport,
    pluginHeader: header,
    sourceLabel: options.sourceLabel ?? filename,
  };
  const { code, report } = emitTypeScript(program, emitOptions);

  // 4. Report.
  let functionCount = 0;
  let classCount = 0;
  walkAst(program, (node) => {
    if (node.kind === "function") functionCount++;
    if (node.kind === "class") classCount++;
  });

  return {
    source: { filename, bytes: new TextEncoder().encode(source).length, lines },
    filesProcessed: 1,
    ast: {
      nodes: countAstNodes(program),
      functions: functionCount,
      classes: classCount,
      hooks: report.hooks.length,
    },
    converted: {
      functions: report.functions,
      hooks: report.hooks.map((h) => ({ tag: h.tag, kind: h.kind, functionName: h.functionName })),
    },
    unconverted: report.unconverted,
    warnings: report.warnings,
    transformed: report.transformed,
    output: {
      filename: `${options.slug}.ts`,
      bytes: new TextEncoder().encode(code).length,
      code,
    },
    extension: {
      slug: options.slug,
      name: header["Plugin Name"] ?? options.slug,
      version: header["Version"] ?? "0.1.0",
    },
    durationMs: Date.now() - started,
  };
}
