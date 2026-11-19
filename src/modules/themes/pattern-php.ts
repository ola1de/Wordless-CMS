/**
 * Inline-PHP evaluator for block-pattern files (Milestone 10).
 *
 * Twenty Twenty-Five's patterns are not pure HTML: 75 of its 98 pattern
 * files contain inline PHP — but an exhaustive scan of the theme shows it
 * is a closed set of twelve i18n/escaping calls with string-literal
 * arguments and no variables, no includes, no dynamic code:
 *
 *   __, _x, _e, esc_html__, esc_html_x, esc_html_e,
 *   esc_attr__, esc_attr_x, esc_attr_e, esc_url,
 *   get_template_directory_uri, printf, wp_kses_post
 *
 * This module evaluates exactly that subset with a small tokenizer +
 * recursive-descent parser over the PHP *text*. It is a literal
 * evaluator, not a PHP runtime: there is no variable lookup, no function
 * definition, no control flow, no file access, no `eval`, and anything
 * outside the allowlist makes the whole pattern refuse (the renderer
 * warns and renders nothing for that pattern). A theme that uses other
 * PHP in a pattern gets a warning, not a partial render and never an
 * execution.
 *
 * Semantics (WordPress behaviour, with two honest differences):
 * - `__` / `_x` return the literal; `_e` echoes it. The textdomain and
 *   context arguments are ignored — Wordless has no translations, and
 *   every literal in a shipped theme is the English source string.
 * - `esc_html_*` / `esc_attr_*` escape the literal (quotes included).
 *   `_e` output is escaped too (WordPress echoes it raw; the literal is
 *   theme-authored static text, and escaping can only turn a `<br>` in
 *   such a literal into visible text — the safe direction).
 * - `wp_kses_post` keeps an allowlist of safe tags/attributes and drops
 *   the rest (script/style/iframe/on* handlers/javascript: links).
 * - `get_template_directory_uri()` returns "" — Wordless serves theme
 *   files from R2 with no public asset URL yet, so an image `src` built
 *   from it will 404; the renderer records one warning per page render
 *   (via `onAssetUri`). Theme-asset serving is a later milestone.
 * - `printf` supports `%s` / `%d` / `%%` only.
 */
import { escapeHtml } from "../render/theme";

/** Functions this evaluator will run, and whether they echo. */
const ECHO_FUNCTIONS = new Set(["_e", "esc_html_e", "esc_attr_e"]);
const RETURN_FUNCTIONS = new Set([
  "__",
  "_x",
  "esc_html__",
  "esc_html_x",
  "esc_attr__",
  "esc_attr_x",
  "esc_url",
  "get_template_directory_uri",
  "printf",
  "wp_kses_post",
]);

const KSES_ALLOWED_TAGS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "rel", "target", "class"]),
  br: new Set([]),
  p: new Set(["class"]),
  span: new Set(["class"]),
  strong: new Set(["class"]),
  em: new Set(["class"]),
  b: new Set(["class"]),
  i: new Set(["class"]),
  code: new Set(["class"]),
  ul: new Set(["class"]),
  ol: new Set(["class"]),
  li: new Set(["class"]),
  h1: new Set(["class"]),
  h2: new Set(["class"]),
  h3: new Set(["class"]),
  h4: new Set(["class"]),
  h5: new Set(["class"]),
  h6: new Set(["class"]),
  small: new Set(["class"]),
  sub: new Set(["class"]),
  sup: new Set(["class"]),
  blockquote: new Set(["class"]),
  cite: new Set(["class"]),
  mark: new Set(["class"]),
  time: new Set(["class", "datetime"]),
};

/**
 * Minimal wp_kses_post: keep allowlisted tags with allowlisted
 * attributes, drop everything else (script/style/iframe content is
 * dropped whole; other unknown tags are unwrapped, keeping their text).
 */
export function ksesPost(html: string): string {
  let out = "";
  let i = 0;
  const dropContent = new Set(["script", "style", "iframe", "object", "embed", "form"]);
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += escapeHtml(html.slice(i));
      break;
    }
    out += escapeHtml(html.slice(i, lt));
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      out += escapeHtml(html.slice(lt));
      break;
    }
    const rawTag = html.slice(lt + 1, gt).trim();
    const isClose = rawTag.startsWith("/");
    const nameMatch = /^\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(rawTag);
    const name = nameMatch?.[1]?.toLowerCase() ?? "";
    if (name === "" || name === "!--") {
      // Comment or malformed tag: drop it.
      i = gt + 1;
      continue;
    }
    if (dropContent.has(name)) {
      // Drop the element and everything up to its close tag.
      const closeRe = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(gt + 1);
      const close = closeRe.exec(rest);
      i = close !== null ? gt + 1 + (close.index ?? 0) + close[0].length : html.length;
      continue;
    }
    const allowed = KSES_ALLOWED_TAGS[name];
    if (allowed === undefined) {
      // Unknown tag: unwrap (drop the tag, keep the text).
      i = gt + 1;
      continue;
    }
    if (isClose) {
      out += `</${name}>`;
      i = gt + 1;
      continue;
    }
    // Keep the tag with allowlisted attributes only.
    const attrs: string[] = [];
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("[^"]*"|'[^']*')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rawTag)) !== null) {
      const attrName = (m[1] ?? "").toLowerCase();
      const rawValue = m[2] ?? '""';
      const value = rawValue.slice(1, -1);
      if (!allowed.has(attrName)) continue;
      if (attrName === "href" && /^\s*javascript:/i.test(value)) continue;
      attrs.push(`${attrName}="${escapeHtml(value)}"`);
    }
    const selfClose = rawTag.endsWith("/") || name === "br";
    out += `<${name}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}${selfClose ? " /" : ""}>`;
    i = gt + 1;
  }
  return out;
}

// ---------------------------------------------------------------- tokenizer

type Token =
  | { kind: "ident"; value: string }
  | { kind: "string"; value: string }
  | { kind: "int"; value: number }
  | { kind: "punct"; value: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let value = "";
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        const c = src[j] ?? "";
        if (c === "\\" && j + 1 < src.length) {
          const next = src[j + 1] ?? "";
          if (next === ch || next === "\\") {
            value += next;
            j += 2;
            continue;
          }
          value += c;
          j++;
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
        // No interpolation: a $ inside a double-quoted string refuses.
        if (ch === '"' && c === "$") return null;
        value += c;
        j++;
      }
      if (!closed) return null;
      tokens.push({ kind: "string", value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j] ?? "")) j++;
      tokens.push({ kind: "int", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] ?? "")) j++;
      tokens.push({ kind: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("(),;.".includes(ch)) {
      tokens.push({ kind: "punct", value: ch });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

// ------------------------------------------------------------------- parser

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly assetUri: () => void,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  private expectPunct(value: string): boolean {
    const t = this.peek();
    if (t?.kind === "punct" && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** Parse a whole PHP segment (statements until the tokens run out). */
  parseSegment(): string | null {
    let out = "";
    while (this.pos < this.tokens.length) {
      const stmt = this.parseStatement();
      if (stmt === null) return null;
      out += stmt;
    }
    return out;
  }

  private parseStatement(): string | null {
    let echoIt = false;
    const first = this.peek();
    if (first?.kind === "ident" && first.value === "echo") {
      echoIt = true;
      this.pos++;
    }
    const value = this.parseExpr();
    if (value === null) return null;
    // The trailing semicolon is required between statements, but a short
    // echo tag (`<?= expr ?>`) usually omits it — allow it at the end.
    if (!this.expectPunct(";") && this.pos < this.tokens.length) return null;
    // A bare call to an _e function echoes; a bare __() call does not.
    // parseCall records whether the value should be output.
    return value.output || echoIt ? value.text : "";
  }

  private parseExpr(): { text: string; output: boolean } | null {
    let left = this.parseTerm();
    if (left === null) return null;
    while (this.peek()?.kind === "punct" && this.peek()?.value === ".") {
      this.pos++;
      const right = this.parseTerm();
      if (right === null) return null;
      left = { text: left.text + right.text, output: left.output || right.output };
    }
    return left;
  }

  private parseTerm(): { text: string; output: boolean } | null {
    const t = this.next();
    if (t === undefined) return null;
    if (t.kind === "string") return { text: t.value, output: false };
    if (t.kind === "int") return { text: String(t.value), output: false };
    if (t.kind === "ident") {
      if (t.value === "echo") return null; // echo only starts a statement
      if (!this.expectPunct("(")) return null;
      const args: { text: string; output: boolean }[] = [];
      if (!(this.peek()?.kind === "punct" && this.peek()?.value === ")")) {
        for (;;) {
          const arg = this.parseExpr();
          if (arg === null) return null;
          args.push(arg);
          if (this.expectPunct(",")) continue;
          break;
        }
      }
      if (!this.expectPunct(")")) return null;
      return this.callFunction(t.value, args);
    }
    return null;
  }

  private callFunction(
    name: string,
    args: { text: string; output: boolean }[],
  ): { text: string; output: boolean } | null {
    const first = args[0]?.text ?? "";
    switch (name) {
      case "__":
      case "_x":
        return { text: first, output: false };
      case "_e":
        return { text: escapeHtml(first), output: true };
      case "esc_html__":
      case "esc_html_x":
        return { text: escapeHtml(first), output: false };
      case "esc_html_e":
        return { text: escapeHtml(first), output: true };
      case "esc_attr__":
      case "esc_attr_x":
        return { text: escapeHtml(first), output: false };
      case "esc_attr_e":
        return { text: escapeHtml(first), output: true };
      case "esc_url": {
        if (/^\s*javascript:/i.test(first) || /^\s*data:/i.test(first)) return { text: "", output: false };
        return { text: escapeHtml(first), output: false };
      }
      case "get_template_directory_uri":
        this.assetUri();
        return { text: "", output: false };
      case "printf": {
        let out = "";
        let argIndex = 1;
        for (let i = 0; i < first.length; i++) {
          const c = first[i] ?? "";
          if (c === "%" && i + 1 < first.length) {
            const spec = first[i + 1] ?? "";
            if (spec === "%") {
              out += "%";
              i++;
            } else if (spec === "s" || spec === "d") {
              const arg = args[argIndex++];
              if (arg === undefined) return null;
              out += spec === "d" ? String(Number(arg.text) || 0) : arg.text;
              i++;
            } else {
              return null;
            }
          } else {
            out += c;
          }
        }
        return { text: out, output: true };
      }
      case "wp_kses_post":
        return { text: ksesPost(first), output: false };
      default:
        return null;
    }
  }
}

export interface PatternPhpOptions {
  /** Called (at most once per render) when a pattern uses the theme URI. */
  onAssetUri?: () => void;
}

/**
 * Evaluate the inline PHP segments in pattern HTML and splice the results
 * in. Returns null when any segment uses a construct outside the
 * allowlist — the caller refuses the whole pattern (never a partial
 * render, never an execution).
 */
export function evaluatePatternPhp(html: string, opts: PatternPhpOptions = {}): string | null {
  let assetUriNotified = false;
  const assetUri = () => {
    if (!assetUriNotified) {
      assetUriNotified = true;
      opts.onAssetUri?.();
    }
  };
  let out = "";
  let i = 0;
  const re = /<\?(php|=)([\s\S]*?)\?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out += html.slice(i, m.index);
    // <?= … ?> is the short echo tag: the expression's value is output.
    const body = m[1] === "=" ? `echo ${m[2] ?? ""}` : (m[2] ?? "");
    const tokens = tokenize(body);
    if (tokens === null) return null;
    const value = new Parser(tokens, assetUri).parseSegment();
    if (value === null) return null;
    out += value;
    i = m.index + m[0].length;
  }
  out += html.slice(i);
  return out;
}
