/**
 * mysqldump parser (Milestone 9) — data only, never executed.
 *
 * Parses `INSERT INTO <table> [(cols)] VALUES (...), (...);` statements
 * from a mysqldump-style file. Only the 12 single-site `wp_*` tables
 * are returned; other tables are reported as ignored. CREATE TABLE,
 * SET, LOCK/UNLOCK and comment lines are skipped.
 *
 * SQL string literals are decoded with MySQL backslash escapes
 * (\', \", \\, \n, \r, \t, \0, \b, \Z, \%, \_) and '' → '. NULL
 * becomes null; bare numbers become numbers. Anything else that does
 * not parse is a hard error with the statement index — a half-parsed
 * dump is never imported.
 */
export interface SqlRow {
  table: string;
  values: Record<string, unknown>;
}

export interface SqlParseResult {
  rows: SqlRow[];
  ignoredTables: string[];
  statements: number;
}

/** Canonical column order per table (wp-admin/includes/schema.php, WordPress 7.1.5). */
export const WP_TABLE_COLUMNS: Record<string, string[]> = {
  wp_posts: [
    "ID", "post_author", "post_date", "post_date_gmt", "post_content", "post_title", "post_excerpt",
    "post_status", "comment_status", "ping_status", "post_password", "post_name", "post_modified",
    "post_modified_gmt", "post_content_filtered", "post_parent", "guid", "menu_order", "post_type",
    "post_mime_type", "comment_count",
  ],
  wp_postmeta: ["meta_id", "post_id", "meta_key", "meta_value"],
  wp_users: [
    "ID", "user_login", "user_pass", "user_nicename", "user_email", "user_url", "user_registered",
    "user_activation_key", "user_status", "display_name",
  ],
  wp_usermeta: ["umeta_id", "user_id", "meta_key", "meta_value"],
  wp_terms: ["term_id", "name", "slug", "term_group"],
  wp_term_taxonomy: ["term_taxonomy_id", "term_id", "taxonomy", "description", "parent", "count"],
  wp_term_relationships: ["object_id", "term_taxonomy_id", "term_order"],
  wp_comments: [
    "comment_ID", "comment_post_ID", "comment_author", "comment_author_email", "comment_author_url",
    "comment_author_IP", "comment_date", "comment_date_gmt", "comment_content", "comment_karma",
    "comment_approved", "comment_agent", "comment_type", "comment_parent", "user_id",
  ],
  wp_commentmeta: ["meta_id", "comment_id", "meta_key", "meta_value"],
  wp_links: [
    "link_id", "link_url", "link_name", "link_image", "link_target", "link_description", "link_visible",
    "link_owner", "link_rating", "link_updated", "link_rel", "link_notes", "link_rss",
  ],
  wp_options: ["option_id", "option_name", "option_value", "autoload"],
  wp_termmeta: ["meta_id", "term_id", "meta_key", "meta_value"],
};

export const WP_TABLES = new Set(Object.keys(WP_TABLE_COLUMNS));

const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
  b: "\b",
  Z: "\u001a",
  "'": "'",
  '"': '"',
  "\\": "\\",
  "%": "%",
  _: "_",
};

/** Split the dump into top-level statements (respecting quotes and comments). */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1] as string | undefined;
    if (inLineComment) {
      // Comment text is dropped, not kept in the statement.
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      // Comment text is dropped, not kept in the statement.
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-" && (sql[i + 2] === " " || sql[i + 2] === "\t")) {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }
    if (ch === "\\" && (inSingle || inDouble)) {
      current += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;
    current += ch;
    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      statements.push(current);
      current = "";
    }
    i += 1;
  }
  if (current.trim() !== "") statements.push(current);
  return statements;
}

interface Token {
  kind: "string" | "number" | "null" | "word";
  value: string;
}

/** Tokenize the parenthesised value list of one row. */
function tokenizeValues(text: string, start: number): { values: Token[]; end: number } {
  const values: Token[] = [];
  let i = start;
  const skipWs = (): void => {
    while (i < text.length && /\s/.test(text[i] as string)) i += 1;
  };
  skipWs();
  if (text[i] !== "(") throw new Error(`Expected "(" at offset ${i} in VALUES list.`);
  i += 1;
  for (;;) {
    skipWs();
    const ch = text[i] as string | undefined;
    if (ch === undefined) throw new Error("Unexpected end of VALUES list.");
    if (ch === "'") {
      i += 1;
      let out = "";
      for (;;) {
        const c = text[i] as string | undefined;
        if (c === undefined) throw new Error("Unterminated string literal in VALUES list.");
        if (c === "'") {
          if (text[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (c === "\\") {
          const esc = text[i + 1] as string | undefined;
          if (esc === undefined) throw new Error("Trailing backslash in string literal.");
          out += ESCAPES[esc] ?? esc;
          i += 2;
          continue;
        }
        out += c;
        i += 1;
      }
      values.push({ kind: "string", value: out });
    } else if (ch === "N" && text.slice(i, i + 4) === "NULL") {
      values.push({ kind: "null", value: "NULL" });
      i += 4;
    } else {
      // Bare number (or TRUE/FALSE, treated as a word).
      let j = i;
      while (j < text.length && !/[,\s)]/.test(text[j] as string)) j += 1;
      const word = text.slice(i, j);
      if (word === "") throw new Error(`Unexpected character "${ch}" in VALUES list.`);
      values.push({ kind: /^-?\d+(\.\d+)?$/.test(word) ? "number" : "word", value: word });
      i = j;
    }
    skipWs();
    const sep = text[i] as string | undefined;
    if (sep === ",") {
      i += 1;
      continue;
    }
    if (sep === ")") {
      i += 1;
      return { values, end: i };
    }
    throw new Error(`Expected "," or ")" at offset ${i} in VALUES list, found "${sep ?? ""}".`);
  }
}

function parseInsert(statement: string): { table: string; columns: string[]; rows: Record<string, unknown>[] } | null {
  const head = /^\s*INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*(?:\(([^)]+)\))?\s*VALUES\s*/i.exec(statement);
  if (head === null) return null;
  const table = (head[1] as string).toLowerCase();
  // Tables outside the 12 wp_* tables are reported as ignored — their
  // VALUES are never parsed (no canonical column list exists for them).
  if (!WP_TABLES.has(table)) return { table, columns: [], rows: [] };
  const columns =
    head[2] !== undefined
      ? head[2].split(",").map((c) => c.trim().replace(/^`|`$/g, ""))
      : (WP_TABLE_COLUMNS[table] ?? []);
  // The regex ends after VALUES + trailing whitespace, so the value
  // lists start exactly at the end of the match.
  const valuesStart = head[0].length;
  const rows: Record<string, unknown>[] = [];
  let i = valuesStart;
  for (;;) {
    while (i < statement.length && /[\s,]/.test(statement[i] as string)) i += 1;
    if (i >= statement.length || statement[i] === ";") break;
    if (statement[i] !== "(") throw new Error(`Expected "(" at offset ${i} in INSERT into ${table}.`);
    const { values, end } = tokenizeValues(statement, i);
    i = end;
    if (values.length !== columns.length) {
      throw new Error(
        `INSERT into ${table} has ${values.length} values but ${columns.length} columns (statement: ${statement.slice(0, 80)}…).`,
      );
    }
    const record: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      const token = values[idx] as Token;
      record[col] = token.kind === "null" ? null : token.kind === "number" ? Number(token.value) : token.value;
    });
    rows.push(record);
  }
  return { table, columns, rows };
}

export function parseSqlDump(sql: string): SqlParseResult {
  const statements = splitStatements(sql);
  const rows: SqlRow[] = [];
  const ignored = new Set<string>();
  for (const statement of statements) {
    const parsed = parseInsert(statement);
    if (parsed === null) continue;
    if (!WP_TABLES.has(parsed.table)) {
      ignored.add(parsed.table);
      continue;
    }
    for (const record of parsed.rows) rows.push({ table: parsed.table, values: record });
  }
  return { rows, ignoredTables: [...ignored].sort(), statements: statements.length };
}
