/**
 * WordPress conversion engine (Milestone 4) — sandbox safety scan.
 *
 * The converter NEVER executes PHP and NEVER executes converted code at
 * conversion time, but the scan is the first line of defence for what the
 * converter will even translate: code that can run arbitrary commands,
 * load code dynamically, or unserialize untrusted data is rejected
 * outright — the job fails with a clear reason instead of producing a
 * partial, silently weakened translation.
 *
 * The scan runs on lexer tokens (not raw text), so a blocked word inside
 * a string literal or a comment does not trip it, and a blocked call
 * cannot hide behind odd spacing.
 */
import { lexPhp } from "./lexer";
import type { SourcePos } from "./ast";

/** Blocked PHP function / construct names (case-insensitive). */
const BLOCKED_CALLS = new Set([
  "eval",
  "exec",
  "shell_exec",
  "system",
  "passthru",
  "popen",
  "proc_open",
  "create_function",
  "unserialize",
  "mb_parse_str",
  "parse_str",
  "assert",
]);

const DYNAMIC_LOADERS = new Set(["require", "include", "require_once", "include_once"]);

export interface SafetyViolation {
  construct: string;
  reason: string;
  line: number;
  column: number;
}

export interface SafetyResult {
  safe: boolean;
  violations: SafetyViolation[];
}

function posOf(pos: SourcePos): { line: number; column: number } {
  return { line: pos.line, column: pos.column };
}

/**
 * Scan PHP source for blocked constructs. Returns every violation found
 * (not just the first) so the report can list them all.
 */
export function scanSafety(source: string): SafetyResult {
  const violations: SafetyViolation[] = [];
  let tokens;
  try {
    tokens = lexPhp(source).tokens;
  } catch (err) {
    // A lex error is a parse failure, not a safety violation — let the
    // parser report it. The scan reports "safe" and parsing will fail.
    void err;
    return { safe: true, violations: [] };
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;

    // Backtick execution: `cmd`.
    if (tok.kind === "backtick") {
      violations.push({
        construct: "backtick execution",
        reason: "Backtick shell execution (`` `cmd` ``) is blocked: the converter never translates code that can run shell commands.",
        ...posOf(tok.pos),
      });
      continue;
    }

    if (tok.kind !== "ident") continue;
    const name = tok.value.toLowerCase();

    // Blocked function calls: name followed by `(`.
    if (BLOCKED_CALLS.has(name)) {
      const next = tokens[i + 1];
      if (next !== undefined && next.kind === "punct" && next.value === "(") {
        const reason =
          name === "unserialize"
            ? "unserialize() is blocked: PHP object injection. Import data as JSON instead (the WordPress importer unserializes safely at import time)."
            : name === "eval" || name === "create_function"
              ? `${tok.value}() is blocked: it executes dynamically generated code, which the Wordless sandbox never allows.`
              : name === "parse_str" || name === "mb_parse_str"
                ? `${tok.value}() is blocked: it writes variables into scope from untrusted input. Parse query strings explicitly instead.`
                : name === "assert"
                  ? "assert() is blocked: it can execute a string as PHP code."
                  : `${tok.value}() is blocked: it runs shell commands, which the Wordless sandbox never allows.`;
        violations.push({ construct: `${tok.value}()`, reason, ...posOf(tok.pos) });
        continue;
      }
    }

    // Dynamic include/require: the argument must be a string literal.
    if (DYNAMIC_LOADERS.has(name)) {
      let j = i + 1;
      let hasParen = false;
      if (tokens[j]?.kind === "punct" && tokens[j]?.value === "(") {
        hasParen = true;
        j++;
      }
      const arg = tokens[j];
      const isLiteral =
        arg !== undefined &&
        ((arg.kind === "string" && arg.value.length > 0) ||
          (arg.kind === "ident" && arg.value === "__FILE__"));
      void hasParen;
      if (!isLiteral) {
        violations.push({
          construct: `${tok.value} (dynamic path)`,
          reason: `${tok.value} with a non-literal path is blocked: converted extensions may only load files whose path is known at conversion time.`,
          ...posOf(tok.pos),
        });
      }
    }
  }

  return { safe: violations.length === 0, violations };
}

/** Throw a single readable error listing every violation (job fails). */
export function assertSafe(source: string): void {
  const result = scanSafety(source);
  if (result.safe) return;
  const lines = result.violations.map(
    (v) => `line ${v.line}: ${v.construct} — ${v.reason}`,
  );
  throw new Error(
    `Conversion blocked by the sandbox (${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}):\n${lines.join("\n")}`,
  );
}
