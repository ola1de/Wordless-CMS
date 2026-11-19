/**
 * Safe PHP unserializer (Milestone 9).
 *
 * WordPress stores PHP-serialized values in wp_options / wp_postmeta /
 * wp_usermeta. Wordless stores JSON instead, so the importer must
 * convert them at import time. This parser handles scalars, arrays and
 * nested structures — and NOTHING else:
 *
 * - `O:` (objects) and `C:` (custom serializable) are REJECTED with a
 *   reason — unserializing an object would be executing imported code.
 * - `r:` / `R:` (references) are rejected — no object graph to rebuild.
 * - `N;` (null), `b:` (bool), `i:` (int), `d:` (double), `s:` (string),
 *   `a:` (array) are supported, with strict length checks so a corrupt
 *   or hostile payload fails loudly instead of being half-parsed.
 *
 * A plain string that is not serialized at all is returned unchanged
 * (WordPress options are often plain strings).
 */
export type PhpValue = string | number | boolean | null | PhpValue[] | { [key: string]: PhpValue };

export class PhpUnserializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhpUnserializeError";
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly input: string) {}

  parse(): PhpValue {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.input.length) {
      throw new PhpUnserializeError(`Trailing data after value at offset ${this.pos}.`);
    }
    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos] as string)) this.pos += 1;
  }

  private expect(ch: string): void {
    if (this.input[this.pos] !== ch) {
      throw new PhpUnserializeError(`Expected "${ch}" at offset ${this.pos}, found "${this.input[this.pos] ?? ""}".`);
    }
    this.pos += 1;
  }

  private readUntil(delim: string): string {
    const idx = this.input.indexOf(delim, this.pos);
    if (idx === -1) throw new PhpUnserializeError(`Missing "${delim}" after offset ${this.pos}.`);
    const out = this.input.slice(this.pos, idx);
    this.pos = idx + 1;
    return out;
  }

  private parseValue(): PhpValue {
    const type = this.input[this.pos] as string | undefined;
    if (type === undefined) throw new PhpUnserializeError("Unexpected end of input.");
    this.pos += 1;
    switch (type) {
      case "N": {
        this.expect(";");
        return null;
      }
      case "b": {
        this.expect(":");
        const raw = this.readUntil(";");
        if (raw !== "0" && raw !== "1") throw new PhpUnserializeError(`Invalid boolean "${raw}".`);
        return raw === "1";
      }
      case "i": {
        this.expect(":");
        const raw = this.readUntil(";");
        const n = Number(raw);
        if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(n)) {
          throw new PhpUnserializeError(`Invalid integer "${raw}".`);
        }
        return n;
      }
      case "d": {
        this.expect(":");
        const raw = this.readUntil(";");
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new PhpUnserializeError(`Invalid double "${raw}".`);
        return n;
      }
      case "s": {
        this.expect(":");
        const lenRaw = this.readUntil(":");
        const len = Number(lenRaw);
        if (!/^\d+$/.test(lenRaw) || !Number.isSafeInteger(len)) {
          throw new PhpUnserializeError(`Invalid string length "${lenRaw}".`);
        }
        this.expect('"');
        // PHP string lengths are byte lengths; Wordless stores UTF-8, so
        // measure in bytes and slice by byte length, then decode.
        const bytes = new TextEncoder().encode(this.input.slice(this.pos));
        let str: string;
        try {
          str = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, len));
        } catch {
          throw new PhpUnserializeError(`String at offset ${this.pos} is not valid UTF-8.`);
        }
        this.pos += str.length;
        this.expect('"');
        this.expect(";");
        return str;
      }
      case "a": {
        this.expect(":");
        const countRaw = this.readUntil(":");
        const count = Number(countRaw);
        if (!/^\d+$/.test(countRaw) || !Number.isSafeInteger(count) || count > 100000) {
          throw new PhpUnserializeError(`Invalid array count "${countRaw}".`);
        }
        this.expect("{");
        const entries: Array<[PhpValue, PhpValue]> = [];
        for (let i = 0; i < count; i++) {
          const key = this.parseValue();
          const value = this.parseValue();
          entries.push([key, value]);
        }
        this.expect("}");
        const isList = entries.every(([k], i) => k === i);
        if (isList) return entries.map(([, v]) => v);
        const obj: { [key: string]: PhpValue } = {};
        for (const [k, v] of entries) {
          obj[String(k)] = v;
        }
        return obj;
      }
      case "O":
      case "C":
        throw new PhpUnserializeError(
          `Serialized PHP objects (${type}:) are refused — unserializing them would execute imported code.`,
        );
      case "r":
      case "R":
        throw new PhpUnserializeError("Serialized PHP references (r:/R:) are refused.");
      default:
        throw new PhpUnserializeError(`Unknown serialized type "${type}" at offset ${this.pos - 1}.`);
    }
  }
}

/**
 * Unserialize a PHP value, or return the input unchanged when it is not
 * a serialized value at all. Throws PhpUnserializeError on malformed
 * or refused payloads.
 */
export function safeUnserialize(input: string): PhpValue {
  const trimmed = input.trim();
  // A value shaped like a serialized value (letter + ":" or "N;") is
  // parsed strictly — an unknown type throws instead of being treated
  // as a plain string. Anything else is a plain string.
  if (!/^[A-Za-z]:/.test(trimmed) && !/^N;$/.test(trimmed)) {
    // Not a serialized value — a plain string stays a plain string.
    return input;
  }
  return new Parser(trimmed).parse();
}

/** Is this string a serialized PHP value (rather than a plain string)? */
export function looksSerialized(input: string): boolean {
  const trimmed = input.trim();
  return /^N;$/.test(trimmed) || /^[A-Za-z]:/.test(trimmed);
}
