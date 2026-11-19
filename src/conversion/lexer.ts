/**
 * WordPress conversion engine (Milestone 4) — PHP tokenizer.
 *
 * Static analysis only: the lexer never executes anything. It tokenizes
 * the PHP subset real plugins use, tracking line/column for every token
 * so reports can point at exact source lines. Comments are skipped for
 * parsing but collected (docblocks carry plugin headers and function
 * docs). Inline HTML between `?>` and `<?php` is its own token — views
 * and templates mix HTML and PHP, and the parser must see both.
 */
import type { SourcePos } from "./ast";

export type TokenKind =
  | "open_tag"
  | "close_tag"
  | "inline_html"
  | "ident"
  | "var"
  | "number"
  | "string"
  | "interp_string"
  | "heredoc"
  | "backtick"
  | "punct"
  | "eof";

export interface StringPart {
  kind: "text" | "var" | "complex";
  value: string;
}

export interface Token {
  kind: TokenKind;
  /** Decoded value (strings) or raw text (everything else). */
  value: string;
  pos: SourcePos;
  /** For open_tag: true when the tag was `<?=` (short echo). */
  shortEcho?: boolean;
  /** For string / interp_string / heredoc: decoded parts. */
  parts?: StringPart[];
  /** For heredoc: the label; for nowdoc this is set and isNowdoc is true. */
  heredocLabel?: string;
  isNowdoc?: boolean;
}

export interface LexComment {
  text: string;
  pos: SourcePos;
}

export interface LexResult {
  tokens: Token[];
  comments: LexComment[];
}

export class LexError extends Error {
  readonly pos: SourcePos;
  constructor(message: string, pos: SourcePos) {
    super(`${message} (line ${pos.line}, column ${pos.column})`);
    this.name = "LexError";
    this.pos = pos;
  }
}

const MULTI_PUNCT = [
  "...",
  "**=",
  "??=",
  "===",
  "!==",
  "<=>",
  "**",
  "<<=",
  ">>=",
  "<<",
  ">>",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "++",
  "--",
  "->",
  "=>",
  "::",
  "?->",
  "??",
  ".=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
];

const SINGLE_PUNCT = new Set([
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  ".",
  ",",
  ";",
  ":",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "!",
  "~",
  "&",
  "|",
  "^",
  "@",
  "$",
  "\\",
]);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\x80-\xff]/.test(ch);
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_\x80-\xff]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Decode PHP double-quoted escape sequences. Unknown escapes keep the backslash. */
function decodeDoubleQuoted(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i++;
          break;
        case "r":
          out += "\r";
          i++;
          break;
        case "t":
          out += "\t";
          i++;
          break;
        case "v":
          out += "\v";
          i++;
          break;
        case "e":
          out += "\x1b";
          i++;
          break;
        case "f":
          out += "\f";
          i++;
          break;
        case "\\":
          out += "\\";
          i++;
          break;
        case '"':
          out += '"';
          i++;
          break;
        case "$":
          out += "$";
          i++;
          break;
        default:
          // \$ handled above; any other \x stays literal (PHP behaviour).
          out += "\\";
          break;
      }
    } else {
      out += ch ?? "";
    }
  }
  return out;
}

/** Split a double-quoted / heredoc body into text / $var / complex parts. */
function splitInterpolation(raw: string): StringPart[] {
  const parts: StringPart[] = [];
  let text = "";
  let i = 0;
  const flush = (): void => {
    if (text.length > 0) {
      parts.push({ kind: "text", value: decodeDoubleQuoted(text) });
      text = "";
    }
  };
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length && raw[i + 1] === "$") {
      text += "\\$";
      i += 2;
      continue;
    }
    if (ch === "$" && i + 1 < raw.length) {
      const next = raw[i + 1] as string;
      if (next === "{") {
        // ${expr} or {$expr} — complex interpolation, not translated.
        flush();
        const close = raw.indexOf("}", i + 2);
        const end = close === -1 ? raw.length : close + 1;
        parts.push({ kind: "complex", value: raw.slice(i, end) });
        i = end;
        continue;
      }
      if (isIdentStart(next)) {
        let j = i + 1;
        while (j < raw.length && isIdentChar(raw[j] as string)) j++;
        const after = raw[j] ?? "";
        if (after === "-" && raw[j + 1] === ">" ) {
          // $obj->prop inside a string — complex, not translated.
          flush();
          parts.push({ kind: "complex", value: raw.slice(i, j) + "->" });
          i = j + 2;
          continue;
        }
        if (after === "[") {
          flush();
          const close = raw.indexOf("]", j);
          const end = close === -1 ? j + 1 : close + 1;
          parts.push({ kind: "complex", value: raw.slice(i, end) });
          i = end;
          continue;
        }
        flush();
        parts.push({ kind: "var", value: raw.slice(i + 1, j) });
        i = j;
        continue;
      }
    }
    text += ch ?? "";
    i++;
  }
  flush();
  return parts;
}

export function lexPhp(source: string): LexResult {
  const tokens: Token[] = [];
  const comments: LexComment[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const pos = (): SourcePos => ({ line, column, offset: i });

  const advance = (n = 1): void => {
    for (let k = 0; k < n && i < source.length; k++) {
      if (source[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  };

  const startsWith = (s: string): boolean => source.startsWith(s, i);

  /** Lex code until `?>` or EOF. */
  const lexCode = (): void => {
    while (i < source.length) {
      // Close tag: back to HTML mode. PHP eats one newline after `?>`.
      if (startsWith("?>")) {
        tokens.push({ kind: "close_tag", value: "?>", pos: pos() });
        advance(2);
        if (source[i] === "\r" && source[i + 1] === "\n") advance(2);
        else if (source[i] === "\n") advance(1);
        return;
      }
      const ch = source[i] as string;

      // Whitespace.
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance(1);
        continue;
      }

      // Comments. A single-line comment ends at the newline OR at `?>`
      // (PHP: the closing tag ends the comment — `// note ?>` is common
      // in templates, and swallowing the `?>` breaks everything after it).
      if (startsWith("//") || startsWith("#")) {
        const start = pos();
        const nl = source.indexOf("\n", i);
        const closeTag = source.indexOf("?>", i);
        let end = source.length;
        if (nl !== -1) end = Math.min(end, nl);
        if (closeTag !== -1) end = Math.min(end, closeTag);
        const text = source.slice(i, end);
        comments.push({ text, pos: start });
        advance(end - i);
        continue;
      }
      if (startsWith("/*")) {
        const start = pos();
        const endIdx = source.indexOf("*/", i + 2);
        if (endIdx === -1) throw new LexError("Unterminated block comment", start);
        const text = source.slice(i, endIdx + 2);
        comments.push({ text, pos: start });
        advance(endIdx + 2 - i);
        continue;
      }

      // Heredoc / nowdoc: <<<LABEL, <<<"LABEL", <<<'LABEL'.
      if (startsWith("<<<")) {
        const start = pos();
        const m = /^<<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(source.slice(i));
        if (m === null) throw new LexError("Invalid heredoc start", start);
        const quote = m[1] as string;
        const label = m[2] as string;
        const isNowdoc = quote === "'";
        advance(m[0].length);
        // Body runs until a line whose (trimmed) text is exactly the label
        // (PHP 7.3+ allows the closing marker to be indented).
        const bodyStart = i;
        let bodyEnd = -1;
        let cursor = i;
        while (cursor < source.length) {
          const nl = source.indexOf("\n", cursor);
          const lineEnd = nl === -1 ? source.length : nl;
          const lineText = source.slice(cursor, lineEnd).trim();
          if (lineText === label || lineText === `${label};`) {
            bodyEnd = cursor;
            break;
          }
          cursor = lineEnd + 1;
        }
        if (bodyEnd === -1) throw new LexError(`Unterminated heredoc (${label})`, start);
        let raw = source.slice(bodyStart, bodyEnd);
        // PHP strips the newline immediately before the closing marker.
        if (raw.endsWith("\r\n")) raw = raw.slice(0, -2);
        else if (raw.endsWith("\n")) raw = raw.slice(0, -1);
        // Consume the label line (but not its newline — the parser skips it).
        advance(bodyEnd - i + label.length);
        if (isNowdoc) {
          tokens.push({ kind: "heredoc", value: raw, pos: start, heredocLabel: label, isNowdoc: true });
        } else {
          const parts = splitInterpolation(raw);
          const hasComplex = parts.some((p) => p.kind === "complex");
          tokens.push({
            kind: "heredoc",
            value: hasComplex ? raw : parts.map((p) => (p.kind === "text" ? p.value : `\${${p.value}}`)).join(""),
            pos: start,
            parts,
            heredocLabel: label,
          });
        }
        continue;
      }

      // Backtick execution — tokenized so the safety scan can reject it.
      if (ch === "`") {
        const start = pos();
        advance(1);
        let raw = "";
        while (i < source.length && source[i] !== "`") {
          raw += source[i];
          advance(1);
        }
        if (i >= source.length) throw new LexError("Unterminated backtick string", start);
        advance(1);
        tokens.push({ kind: "backtick", value: raw, pos: start });
        continue;
      }

      // Strings.
      if (ch === "'" || ch === '"') {
        const start = pos();
        const quote = ch;
        advance(1);
        let raw = "";
        let closed = false;
        while (i < source.length) {
          const c = source[i] as string;
          if (c === "\\" && i + 1 < source.length) {
            raw += c + (source[i + 1] as string);
            advance(2);
            continue;
          }
          if (c === quote) {
            closed = true;
            advance(1);
            break;
          }
          raw += c;
          advance(1);
        }
        if (!closed) throw new LexError("Unterminated string literal", start);
        if (quote === "'") {
          const value = raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
          tokens.push({ kind: "string", value, pos: start });
        } else {
          const parts = splitInterpolation(raw);
          if (parts.length === 1 && parts[0]?.kind === "text") {
            tokens.push({ kind: "string", value: parts[0].value, pos: start });
          } else {
            tokens.push({ kind: "interp_string", value: raw, pos: start, parts });
          }
        }
        continue;
      }

      // Variables: $name (not followed by another $ — $$ is unsupported, lex as var + var).
      if (ch === "$" && i + 1 < source.length && isIdentStart(source[i + 1] as string)) {
        const start = pos();
        advance(1);
        let name = "";
        while (i < source.length && isIdentChar(source[i] as string)) {
          name += source[i];
          advance(1);
        }
        tokens.push({ kind: "var", value: name, pos: start });
        continue;
      }

      // Numbers.
      if (isDigit(ch) || (ch === "." && i + 1 < source.length && isDigit(source[i + 1] as string))) {
        const start = pos();
        const m = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
          source.slice(i),
        );
        const text = m?.[0] ?? ch;
        advance(text.length);
        tokens.push({ kind: "number", value: text, pos: start });
        continue;
      }

      // Identifiers / keywords.
      if (isIdentStart(ch)) {
        const start = pos();
        let name = "";
        while (i < source.length && isIdentChar(source[i] as string)) {
          name += source[i];
          advance(1);
        }
        tokens.push({ kind: "ident", value: name, pos: start });
        continue;
      }

      // Multi-char punctuators (longest first).
      let matched = false;
      for (const p of MULTI_PUNCT) {
        if (startsWith(p)) {
          tokens.push({ kind: "punct", value: p, pos: pos() });
          advance(p.length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Single-char punctuators.
      if (SINGLE_PUNCT.has(ch)) {
        tokens.push({ kind: "punct", value: ch, pos: pos() });
        advance(1);
        continue;
      }

      throw new LexError(`Unexpected character ${JSON.stringify(ch)}`, pos());
    }
  };

  // Main loop: alternate HTML mode and code mode.
  while (i < source.length) {
    if (startsWith("<?php") || startsWith("<?=")) {
      const start = pos();
      const shortEcho = startsWith("<?=");
      const tagLen = shortEcho ? 3 : 5;
      tokens.push({ kind: "open_tag", value: source.slice(i, i + tagLen), pos: start, shortEcho });
      advance(tagLen);
      lexCode();
      continue;
    }
    if (startsWith("<?")) {
      // Short open tag `<?` (not `<?php` / `<?=`): treat as an open tag too;
      // short tags are disabled on most hosts, but parsing them is harmless.
      const start = pos();
      tokens.push({ kind: "open_tag", value: "<?", pos: start });
      advance(2);
      lexCode();
      continue;
    }
    // Inline HTML until the next open tag.
    const start = pos();
    const nextPhp = source.indexOf("<?", i);
    const end = nextPhp === -1 ? source.length : nextPhp;
    const text = source.slice(i, end);
    if (text.length > 0) {
      tokens.push({ kind: "inline_html", value: text, pos: start });
    }
    advance(end - i);
  }

  tokens.push({ kind: "eof", value: "", pos: pos() });
  return { tokens, comments };
}
