/**
 * WordPress conversion engine (Milestone 4) — PHP recursive-descent parser.
 *
 * Parses the lexer output into the AST (ast.ts). Static analysis only —
 * nothing here executes PHP. Constructs the emitter cannot translate
 * (classes, switch, try/catch, closures, `new`, `$this->`, …) are parsed
 * into the AST and marked `unsupported` with a reason, so the conversion
 * report can list them instead of silently dropping them.
 */
import { lexPhp, type LexComment, type Token } from "./lexer";
import type {
  ArrayEntry,
  ArrayNode,
  AstNode,
  ClassDeclNode,
  ExprNode,
  FunctionDeclNode,
  MethodDeclNode,
  ParamNode,
  ProgramNode,
  SourcePos,
  StmtNode,
} from "./ast";
import { countAstNodes, walkAst } from "./ast";

export class ParseError extends Error {
  readonly pos: SourcePos;
  constructor(message: string, pos: SourcePos) {
    super(`${message} (line ${pos.line}, column ${pos.column})`);
    this.name = "ParseError";
    this.pos = pos;
  }
}

export interface ParseResult {
  program: ProgramNode;
  comments: LexComment[];
  tokens: Token[];
}

/** Extract WordPress plugin header fields from the first comment block. */
export function parsePluginHeader(comments: LexComment[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const comment of comments) {
    const text = comment.text;
    if (!text.includes("Plugin Name")) continue;
    for (const line of text.split("\n")) {
      const m = /^\s*\*?\s*([A-Za-z ]+):\s*(.+?)\s*$/.exec(line);
      if (m !== null) {
        const key = (m[1] as string).trim();
        const value = (m[2] as string).trim();
        if (["Plugin Name", "Plugin URI", "Description", "Author", "Author URI", "Version", "Text Domain"].includes(key)) {
          fields[key] = value;
        }
      }
    }
    if (Object.keys(fields).length > 0) break;
  }
  return fields;
}

const ASSIGN_OPS = new Set(["=", ".=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "**=", "??="]);

/** Cast type names recognised after `(`: (int) $x, (string) $y, … */
const CAST_TYPES = new Set([
  "int",
  "integer",
  "float",
  "double",
  "real",
  "string",
  "bool",
  "boolean",
  "array",
  "object",
  "unset",
  "binary",
]);

const BINARY_PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  or: 2,
  "&&": 3,
  and: 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "==": 7,
  "!=": 7,
  "===": 7,
  "!==": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  "<=>": 8,
  "+": 9,
  "-": 9,
  ".": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};

export function parsePhp(source: string): ParseResult {
  const { tokens, comments } = lexPhp(source);
  const parser = new Parser(tokens, source);
  const program = parser.parseProgram();
  return { program, comments, tokens };
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(offset = 0): Token {
    const tok = this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
    return tok as Token;
  }

  private next(): Token {
    const tok = this.tokens[this.pos] as Token;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private atEof(): boolean {
    return this.peek().kind === "eof";
  }

  private isPunct(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "punct" && t.value === value;
  }

  private isIdent(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "ident" && t.value.toLowerCase() === value.toLowerCase();
  }

  private matchPunct(value: string): boolean {
    if (this.isPunct(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private matchIdent(value: string): boolean {
    if (this.isIdent(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expectPunct(value: string): Token {
    if (!this.isPunct(value)) {
      throw new ParseError(`Expected "${value}" but found ${this.describe(this.peek())}`, this.peek().pos);
    }
    return this.next();
  }

  private expectIdent(what = "identifier"): Token {
    const t = this.peek();
    if (t.kind !== "ident") {
      throw new ParseError(`Expected ${what} but found ${this.describe(t)}`, t.pos);
    }
    return this.next();
  }

  private describe(t: Token): string {
    if (t.kind === "eof") return "end of file";
    return JSON.stringify(t.value);
  }

  private error(message: string, pos: SourcePos): ParseError {
    return new ParseError(message, pos);
  }

  /** Raw source between two token positions (for unsupported-node capture). */
  private sliceSource(from: SourcePos, to: SourcePos): string {
    return this.source.slice(from.offset, to.offset);
  }

  parseProgram(): ProgramNode {
    const start: SourcePos = { line: 1, column: 1, offset: 0 };
    const body: StmtNode[] = [];
    while (!this.atEof()) {
      const tok = this.peek();
      if (tok.kind === "open_tag") {
        this.next();
        if (tok.shortEcho === true) {
          // <?= expr ?> — short echo.
          const expr = this.parseExpression();
          body.push({ kind: "echo", values: [expr], pos: tok.pos });
          if (this.peek().kind === "close_tag") this.next();
          continue;
        }
        body.push(...this.parseStatementList(false));
        continue;
      }
      if (tok.kind === "inline_html") {
        this.next();
        body.push({ kind: "inline_html", text: tok.value, pos: tok.pos });
        continue;
      }
      if (tok.kind === "close_tag") {
        this.next();
        continue;
      }
      // Anything else outside a PHP block is unexpected — skip defensively.
      this.next();
    }
    return { kind: "program", body, pos: start };
  }

  /** Statements until a close_tag / `}` / EOF. When `inBlock` is true the
   *  list continues across `?>` … `<?php` pauses (inline HTML inside a
   *  block); at the top level a close tag ends the PHP section. */
  private parseStatementList(inBlock: boolean): StmtNode[] {
    const stmts: StmtNode[] = [];
    while (!this.atEof()) {
      const tok = this.peek();
      if (tok.kind === "close_tag") {
        this.next();
        // Inside a block, `?>` HTML `<?php` is just a pause: keep going.
        // At the top level the PHP section is over.
        if (inBlock) continue;
        break;
      }
      if (tok.kind === "inline_html") {
        this.next();
        stmts.push({ kind: "inline_html", text: tok.value, pos: tok.pos });
        continue;
      }
      if (tok.kind === "open_tag") {
        // A new <?php inside a block (e.g. after inline HTML) — re-enter.
        this.next();
        if (tok.shortEcho === true) {
          const expr = this.parseExpression();
          stmts.push({ kind: "echo", values: [expr], pos: tok.pos });
          if (this.peek().kind === "close_tag") this.next();
        }
        continue;
      }
      if (this.isPunct("}")) break;
      const stmt = this.parseStatement();
      if (stmt !== null) stmts.push(stmt);
    }
    return stmts;
  }

  private parseBlock(): StmtNode[] {
    this.expectPunct("{");
    const body = this.parseStatementList(true);
    this.expectPunct("}");
    return body;
  }

  /** Parse one statement; returns null for an empty `;`. */
  private parseStatement(): StmtNode | null {
    const tok = this.peek();
    if (this.isPunct(";")) {
      this.next();
      return null;
    }
    if (this.isPunct("{")) {
      const pos = tok.pos;
      const body = this.parseBlock();
      return { kind: "block", body, pos };
    }
    if (tok.kind === "ident") {
      const kw = tok.value.toLowerCase();
      switch (kw) {
        case "function":
          return this.parseFunctionDecl();
        case "class":
        case "abstract":
        case "final":
          return this.parseClassDecl();
        case "interface":
        case "trait":
        case "enum": {
          const start = this.next().pos;
          // Skip the whole declaration body loosely; record as unsupported.
          const from = start;
          let depth = 0;
          while (!this.atEof()) {
            const t = this.next();
            if (t.kind === "punct" && t.value === "{") depth++;
            if (t.kind === "punct" && t.value === "}") {
              depth--;
              if (depth <= 0) break;
            }
            if (t.kind === "close_tag" || t.kind === "eof") break;
          }
          return {
            kind: "unsupported",
            label: `${kw} declaration`,
            reason: `Wordless has no ${kw} system; the declaration is analysed but not converted.`,
            source: this.sliceSource(from, this.peek().pos),
            pos: start,
          };
        }
        case "if":
          return this.parseIf();
        case "foreach":
          return this.parseForeach();
        case "for":
          return this.parseFor();
        case "while":
          return this.parseWhile();
        case "do": {
          this.next();
          const bodyStmt = this.parseStatement();
          const body = bodyStmt?.kind === "block" ? bodyStmt.body : bodyStmt ? [bodyStmt] : [];
          this.expectIdent("while");
          this.expectPunct("(");
          const test = this.parseExpression();
          this.expectPunct(")");
          this.expectPunct(";");
          return { kind: "do_while", body, test, pos: tok.pos };
        }
        case "static": {
          // Function-local static variable: static $x = null; / static $a, $b = 1;
          // But `static::method()` and `static function () {}` are
          // expressions, not declarations — fall through to them.
          if (this.peek(1).kind !== "var") break;
          this.next();
          const vars: { name: string; value: ExprNode | null }[] = [];
          while (this.peek().kind === "var") {
            const name = this.next().value;
            const value = this.matchPunct("=") ? this.parseExpression() : null;
            vars.push({ name, value });
            if (!this.matchPunct(",")) break;
          }
          this.expectPunct(";");
          return { kind: "static_var", vars, pos: tok.pos };
        }
        case "switch":
          return this.parseSwitch();
        case "try":
          return this.parseTry();
        case "return": {
          this.next();
          let value: ExprNode | null = null;
          if (!this.isPunct(";")) value = this.parseExpression();
          this.expectPunct(";");
          return { kind: "return", value, pos: tok.pos };
        }
        case "echo":
        case "print": {
          this.next();
          const values: ExprNode[] = [this.parseExpression()];
          while (this.matchPunct(",")) values.push(this.parseExpression());
          // print is an expression in PHP but used as a statement here.
          this.expectPunct(";");
          return { kind: "echo", values, pos: tok.pos };
        }
        case "require":
        case "include":
        case "require_once":
        case "include_once": {
          this.next();
          const hasParen = this.matchPunct("(");
          const arg = this.parseExpression();
          if (hasParen) this.expectPunct(")");
          this.expectPunct(";");
          return {
            kind: "require",
            mode: kw,
            literalPath: arg.kind === "literal" && arg.literalKind === "string" ? String(arg.value) : null,
            arg,
            pos: tok.pos,
          };
        }
        case "global": {
          this.next();
          const names: string[] = [];
          do {
            const v = this.peek();
            if (v.kind !== "var") throw this.error("Expected a variable after global", v.pos);
            this.next();
            names.push(v.value);
          } while (this.matchPunct(","));
          this.expectPunct(";");
          return { kind: "global", names, pos: tok.pos };
        }
        case "const": {
          this.next();
          const nameTok = this.expectIdent("constant name");
          this.expectPunct("=");
          const value = this.parseExpression();
          this.expectPunct(";");
          return { kind: "const_decl", name: nameTok.value, value, pos: tok.pos };
        }
        case "break": {
          this.next();
          if (!this.isPunct(";")) this.parseExpression();
          this.expectPunct(";");
          return { kind: "break", pos: tok.pos };
        }
        case "continue": {
          this.next();
          if (!this.isPunct(";")) this.parseExpression();
          this.expectPunct(";");
          return { kind: "continue", pos: tok.pos };
        }
        case "exit":
        case "die": {
          this.next();
          if (this.matchPunct("(")) {
            if (!this.isPunct(")")) this.parseExpression();
            this.expectPunct(")");
          }
          this.expectPunct(";");
          return {
            kind: "unsupported",
            label: `${kw}()`,
            reason: "Terminating the request has no equivalent in a Wordless extension; the call site must be rewritten by hand.",
            source: kw,
            pos: tok.pos,
          };
        }
        case "unset": {
          this.next();
          this.expectPunct("(");
          while (!this.isPunct(")") && !this.atEof()) this.next();
          this.expectPunct(")");
          this.expectPunct(";");
          return {
            kind: "unsupported",
            label: "unset()",
            reason: "unset() is not translated; assign null instead.",
            source: "unset(...)",
            pos: tok.pos,
          };
        }
        case "declare":
        case "namespace":
        case "use": {
          const start = this.next().pos;
          // Skip to the end of the statement.
          while (!this.isPunct(";") && !this.isPunct("{") && !this.atEof()) this.next();
          if (this.isPunct("{")) {
            let depth = 0;
            while (!this.atEof()) {
              const t = this.next();
              if (t.kind === "punct" && t.value === "{") depth++;
              if (t.kind === "punct" && t.value === "}") {
                depth--;
                if (depth <= 0) break;
              }
            }
          } else {
            this.expectPunct(";");
          }
          return {
            kind: "unsupported",
            label: `${kw} statement`,
            reason: `The ${kw} statement is not part of the convertible PHP subset.`,
            source: kw,
            pos: start,
          };
        }
        default:
          break;
      }
    }
    // Expression statement.
    const expr = this.parseExpression();
    this.expectPunct(";");
    return { kind: "expr_stmt", expr, pos: expr.pos };
  }

  private parseFunctionDecl(): FunctionDeclNode {
    const start = this.expectIdent("function").pos;
    // Anonymous function used as a statement is a closure expression.
    if (this.isPunct("(")) {
      const closure = this.parseClosure(start);
      // A bare closure statement — wrap as an expression statement.
      throw this.error("Unexpected anonymous function as a statement", closure.pos);
    }
    const nameTok = this.expectIdent("function name");
    const params = this.parseParams();
    let returnType: string | null = null;
    if (this.matchPunct(":")) {
      returnType = this.parseTypeName();
    }
    const body = this.parseBlock();
    return {
      kind: "function",
      name: nameTok.value,
      params,
      returnType,
      body,
      docblock: this.findDocblock(start),
      pos: start,
    };
  }

  /** The docblock comment immediately before `pos`, if any. */
  private findDocblock(_pos: SourcePos): string | null {
    return null;
  }

  private parseTypeName(): string {
    let name = "";
    if (this.matchPunct("?")) name += "?";
    const first = this.peek();
    if (first.kind === "ident") {
      name += this.next().value;
      while (this.isPunct("\\")) {
        this.next();
        name += "\\" + this.expectIdent().value;
      }
    } else if (this.isPunct("|")) {
      name += "|";
    }
    while (this.isPunct("|")) {
      this.next();
      name += "|" + this.parseTypeName();
    }
    return name;
  }

  private parseParams(): ParamNode[] {
    this.expectPunct("(");
    const params: ParamNode[] = [];
    while (!this.isPunct(")") && !this.atEof()) {
      const start = this.peek().pos;
      // Constructor property promotion: public/private/protected/readonly
      // before the type — consumed; the parameter itself is still a plain
      // parameter in the translation (the class is not converted anyway).
      while (
        this.isIdent("public") ||
        this.isIdent("private") ||
        this.isIdent("protected") ||
        this.isIdent("readonly")
      ) {
        this.next();
      }
      let type: string | null = null;
      // A type precedes the variable: int $x, ?array $y, Foo\Bar $z.
      // `array` IS a type here (array $x); array() as a value only
      // appears after `=`, which the rewind check below handles.
      if (this.peek().kind === "ident" || this.isPunct("?")) {
        const save = this.pos;
        try {
          type = this.parseTypeName();
        } catch {
          type = null;
          this.pos = save;
        }
        if (type !== null && this.peek().kind !== "var" && !this.isPunct("&") && !this.isPunct("...")) {
          // Not actually a type (a bare identifier) — rewind.
          type = null;
          this.pos = save;
        }
      }
      const byRef = this.matchPunct("&");
      const variadic = this.matchPunct("...");
      const varTok = this.peek();
      if (varTok.kind !== "var") throw this.error("Expected a parameter variable", varTok.pos);
      this.next();
      let defaultValue: ExprNode | null = null;
      if (this.matchPunct("=")) defaultValue = this.parseExpression();
      params.push({ kind: "param", name: varTok.value, type, defaultValue, byRef, variadic, pos: start });
      if (!this.matchPunct(",")) break;
    }
    this.expectPunct(")");
    return params;
  }

  private parseClassDecl(): ClassDeclNode {
    let start = this.peek().pos;
    let isAbstract = false;
    if (this.isIdent("abstract")) {
      this.next();
      isAbstract = true;
    }
    if (this.isIdent("final")) this.next();
    this.expectIdent("class");
    const nameTok = this.expectIdent("class name");
    start = start;
    let extendsName: string | null = null;
    if (this.matchIdent("extends")) {
      extendsName = this.expectIdent("parent class name").value;
      while (this.isPunct("\\")) {
        this.next();
        extendsName += "\\" + this.expectIdent().value;
      }
    }
    const implementsNames: string[] = [];
    if (this.matchIdent("implements")) {
      do {
        let name = this.expectIdent("interface name").value;
        while (this.isPunct("\\")) {
          this.next();
          name += "\\" + this.expectIdent().value;
        }
        implementsNames.push(name);
      } while (this.matchPunct(","));
    }
    this.expectPunct("{");
    const methods: MethodDeclNode[] = [];
    const properties: string[] = [];
    while (!this.isPunct("}") && !this.atEof()) {
      const tok = this.peek();
      // Method modifiers that precede the visibility keyword.
      if (tok.kind === "ident" && (tok.value.toLowerCase() === "abstract" || tok.value.toLowerCase() === "final")) {
        this.next();
        continue;
      }
      if (tok.kind === "ident") {
        const kw = tok.value.toLowerCase();
        if (kw === "public" || kw === "private" || kw === "protected") {
          const visibility = kw as "public" | "private" | "protected";
          this.next();
          let isStatic = false;
          if (this.isIdent("static")) {
            this.next();
            isStatic = true;
          }
          if (this.isIdent("function")) {
            this.next();
            const mName = this.expectIdent("method name");
            const params = this.parseParams();
            if (this.matchPunct(":")) this.parseTypeName();
            // Abstract methods end with `;` instead of a body.
            const body = this.isPunct(";") ? (this.next(), [] as StmtNode[]) : this.parseBlock();
            methods.push({ kind: "method", name: mName.value, visibility, isStatic, params, body, pos: tok.pos });
            continue;
          }
          if (this.peek().kind === "var") {
            const v = this.next();
            properties.push(v.value);
            if (this.matchPunct("=")) this.parseExpression();
            this.expectPunct(";");
            continue;
          }
          if (this.isIdent("const")) {
            this.next();
            this.expectIdent("constant name");
            this.expectPunct("=");
            this.parseExpression();
            this.expectPunct(";");
            continue;
          }
        }
        if (kw === "function") {
          this.next();
          const mName = this.expectIdent("method name");
          const params = this.parseParams();
          if (this.matchPunct(":")) this.parseTypeName();
          // Abstract methods end with `;` instead of a body.
          const body = this.isPunct(";") ? (this.next(), [] as StmtNode[]) : this.parseBlock();
          methods.push({ kind: "method", name: mName.value, visibility: "public", isStatic: false, params, body, pos: tok.pos });
          continue;
        }
        if (kw === "const") {
          this.next();
          this.expectIdent("constant name");
          this.expectPunct("=");
          this.parseExpression();
          this.expectPunct(";");
          continue;
        }
        if (kw === "var") {
          this.next();
          const v = this.peek();
          if (v.kind === "var") {
            this.next();
            properties.push(v.value);
            if (this.matchPunct("=")) this.parseExpression();
            this.expectPunct(";");
            continue;
          }
        }
      }
      if (tok.kind === "var") {
        this.next();
        properties.push(tok.value);
        if (this.matchPunct("=")) this.parseExpression();
        this.expectPunct(";");
        continue;
      }
      if (this.isPunct(";")) {
        this.next();
        continue;
      }
      // Unknown member — skip to the next ; or } to stay in sync.
      this.next();
    }
    this.expectPunct("}");
    void isAbstract;
    return {
      kind: "class",
      name: nameTok.value,
      extendsName,
      implementsNames,
      methods,
      properties,
      pos: start,
    };
  }

  private parseIf(): StmtNode {
    const start = this.expectIdent("if").pos;
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    if (this.isPunct(":")) {
      // Alternative syntax: if (...): … elseif (…): … else: … endif;
      // Common in templates (views/*.php). Nested alt-ifs consume their
      // own endif, so the terminators below only stop the outer body.
      this.next();
      const consequent = this.parseAltBody(["elseif", "else", "endif"]);
      let alternate: StmtNode[] | import("./ast").IfNode | null = null;
      if (this.isIdent("elseif")) alternate = this.parseAltElseIfChain();
      else if (this.isIdent("else")) {
        this.next();
        this.expectPunct(":");
        alternate = this.parseAltBody(["endif"]);
      }
      this.expectIdent("endif");
      this.optionalSemi();
      return { kind: "if", test, consequent, alternate, altSyntax: true, pos: start };
    }
    const consequent = this.parseBranch();
    let alternate: StmtNode[] | import("./ast").IfNode | null = null;
    if (this.isIdent("else")) {
      this.next();
      if (this.isIdent("if")) {
        alternate = this.parseIf() as import("./ast").IfNode;
      } else {
        alternate = this.parseBranch();
      }
    } else if (this.isIdent("elseif")) {
      alternate = this.parseElseIf();
    }
    return { kind: "if", test, consequent, alternate, pos: start };
  }

  /** One `elseif (…)` step of a brace-syntax chain (chains of any length:
   *  each step recurses for the next elseif). */
  private parseElseIf(): import("./ast").IfNode {
    const start = this.expectIdent("elseif").pos;
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    const consequent = this.parseBranch();
    let alternate: StmtNode[] | import("./ast").IfNode | null = null;
    if (this.isIdent("elseif")) {
      alternate = this.parseElseIf();
    } else if (this.isIdent("else")) {
      this.next();
      alternate = this.isIdent("if") ? (this.parseIf() as import("./ast").IfNode) : this.parseBranch();
    }
    return { kind: "if", test, consequent, alternate, pos: start };
  }

  /** One `elseif (…): …` step of an alternative-syntax chain (the final
   *  `endif;` is consumed by the outermost parseIf, not here). */
  private parseAltElseIfChain(): import("./ast").IfNode {
    const start = this.expectIdent("elseif").pos;
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    this.expectPunct(":");
    const consequent = this.parseAltBody(["elseif", "else", "endif"]);
    let alternate: StmtNode[] | import("./ast").IfNode | null = null;
    if (this.isIdent("elseif")) alternate = this.parseAltElseIfChain();
    else if (this.isIdent("else")) {
      this.next();
      this.expectPunct(":");
      alternate = this.parseAltBody(["endif"]);
    }
    return { kind: "if", test, consequent, alternate, altSyntax: true, pos: start };
  }

  /**
   * A `;` is optional before `?>` in PHP — the closing tag ends the
   * statement (`<?php endif ?>` is legal). Consume a `;` when present and
   * leave a close-tag for the statement list to skip.
   */
  private optionalSemi(): void {
    if (this.isPunct(";")) this.next();
  }

  /**
   * Statements of an alternative-syntax body, up to (not consuming) one of
   * the terminator keywords. `?>` close-tags between statements are
   * skipped; inline HTML is a statement like anywhere else.
   */
  private parseAltBody(terminators: string[]): StmtNode[] {
    const stmts: StmtNode[] = [];
    while (!this.atEof()) {
      const tok = this.peek();
      if (tok.kind === "close_tag") {
        this.next();
        continue;
      }
      if (tok.kind === "inline_html") {
        this.next();
        stmts.push({ kind: "inline_html", text: tok.value, pos: tok.pos });
        continue;
      }
      if (tok.kind === "open_tag") {
        // A new <?php (or <?=) inside the body — re-enter code mode.
        this.next();
        if (tok.shortEcho === true) {
          const expr = this.parseExpression();
          stmts.push({ kind: "echo", values: [expr], pos: tok.pos });
          if (this.peek().kind === "close_tag") this.next();
        }
        continue;
      }
      if (tok.kind === "ident" && terminators.includes(tok.value.toLowerCase())) break;
      if (tok.kind === "punct" && tok.value === "}") break; // safety net
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  /** A branch is either a block or a single statement. */
  private parseBranch(): StmtNode[] {
    if (this.isPunct("{")) return this.parseBlock();
    if (this.isPunct(":")) {
      throw this.error("Alternative if/foreach syntax (`:` … `endif`) is not supported here", this.peek().pos);
    }
    const stmt = this.parseStatement();
    return stmt === null ? [] : [stmt];
  }

  private parseForeach(): StmtNode {
    const start = this.expectIdent("foreach").pos;
    this.expectPunct("(");
    const iterable = this.parseExpression();
    if (!this.matchIdent("as")) throw this.error("Expected 'as' in foreach", this.peek().pos);
    const firstVar = this.peek();
    if (firstVar.kind !== "var") throw this.error("Expected a loop variable in foreach", firstVar.pos);
    this.next();
    let keyVar: string | null = null;
    let valueVar = firstVar.value;
    if (this.matchPunct("=>")) {
      keyVar = valueVar;
      const v2 = this.peek();
      if (v2.kind !== "var") throw this.error("Expected a loop value variable in foreach", v2.pos);
      this.next();
      valueVar = v2.value;
    }
    this.expectPunct(")");
    if (this.isPunct(":")) {
      this.next();
      const body = this.parseAltBody(["endforeach"]);
      this.expectIdent("endforeach");
      this.optionalSemi();
      return { kind: "foreach", iterable, keyVar, valueVar, body, altSyntax: true, pos: start };
    }
    const body = this.parseBranch();
    return { kind: "foreach", iterable, keyVar, valueVar, body, pos: start };
  }

  private parseFor(): StmtNode {
    const start = this.expectIdent("for").pos;
    this.expectPunct("(");
    let init: ExprNode | null = null;
    if (!this.isPunct(";")) init = this.parseExpression();
    this.expectPunct(";");
    let test: ExprNode | null = null;
    if (!this.isPunct(";")) test = this.parseExpression();
    this.expectPunct(";");
    let update: ExprNode | null = null;
    if (!this.isPunct(")")) update = this.parseExpression();
    this.expectPunct(")");
    if (this.isPunct(":")) {
      this.next();
      const body = this.parseAltBody(["endfor"]);
      this.expectIdent("endfor");
      this.optionalSemi();
      return { kind: "for", init, test, update, body, altSyntax: true, pos: start };
    }
    const body = this.parseBranch();
    return { kind: "for", init, test, update, body, pos: start };
  }

  private parseWhile(): StmtNode {
    const start = this.expectIdent("while").pos;
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    if (this.isPunct(":")) {
      this.next();
      const body = this.parseAltBody(["endwhile"]);
      this.expectIdent("endwhile");
      this.optionalSemi();
      return { kind: "while", test, body, altSyntax: true, pos: start };
    }
    const body = this.parseBranch();
    return { kind: "while", test, body, pos: start };
  }

  private parseSwitch(): StmtNode {
    const start = this.expectIdent("switch").pos;
    this.expectPunct("(");
    const discriminant = this.parseExpression();
    this.expectPunct(")");
    const from = start;
    if (this.isPunct(":")) {
      // Alternative syntax: switch (...): … endswitch;
      this.next();
      while (!this.atEof() && !this.isIdent("endswitch")) this.next();
      this.expectIdent("endswitch");
      this.optionalSemi();
      return {
        kind: "switch",
        discriminant,
        altSyntax: true,
        source: this.sliceSource(from, this.peek().pos),
        pos: start,
      };
    }
    this.expectPunct("{");
    let depth = 1;
    while (!this.atEof() && depth > 0) {
      const t = this.next();
      if (t.kind === "punct" && t.value === "{") depth++;
      if (t.kind === "punct" && t.value === "}") depth--;
    }
    return {
      kind: "switch",
      discriminant,
      source: this.sliceSource(from, this.peek().pos),
      pos: start,
    };
  }

  private parseTry(): StmtNode {
    const start = this.expectIdent("try").pos;
    const body = this.parseBlock();
    const catches: { varName: string | null; body: StmtNode[] }[] = [];
    while (this.isIdent("catch")) {
      this.next();
      this.expectPunct("(");
      // Exception class name(s), then optional $var.
      while (!this.isPunct(")") && !this.atEof()) this.next();
      this.expectPunct(")");
      const catchBody = this.parseBlock();
      catches.push({ varName: null, body: catchBody });
    }
    let finallyBody: StmtNode[] | null = null;
    if (this.isIdent("finally")) {
      this.next();
      finallyBody = this.parseBlock();
    }
    return { kind: "try", body, catches, finallyBody, pos: start };
  }

  private parseClosure(start: SourcePos): import("./ast").ClosureNode {
    // The `(` is consumed by parseParams().
    const params = this.parseParams();
    const uses: string[] = [];
    if (this.matchIdent("use")) {
      this.expectPunct("(");
      while (!this.isPunct(")") && !this.atEof()) {
        if (this.matchPunct("&")) continue;
        const v = this.peek();
        if (v.kind === "var") {
          this.next();
          uses.push(v.value);
        } else {
          this.next();
        }
        if (!this.matchPunct(",")) break;
      }
      this.expectPunct(")");
    }
    if (this.matchPunct(":")) this.parseTypeName();
    const body = this.parseBlock();
    return { kind: "closure", params, uses, body, pos: start };
  }

  // ------------------------------------------------------------ expressions

  parseExpression(): ExprNode {
    return this.parseAssignment();
  }

  private parseAssignment(): ExprNode {
    const left = this.parseTernary();
    const tok = this.peek();
    if (tok.kind === "punct" && ASSIGN_OPS.has(tok.value)) {
      this.next();
      const right = this.parseAssignment();
      return { kind: "assign", operator: tok.value, target: left, value: right, pos: left.pos };
    }
    return left;
  }

  private parseTernary(): ExprNode {
    const test = this.parseBinary(1);
    if (!this.isPunct("?")) return test;
    this.next();
    let consequent: ExprNode | null = null;
    if (!this.isPunct(":")) consequent = this.parseExpression();
    this.expectPunct(":");
    const alternate = this.parseExpression();
    return { kind: "ternary", test, consequent, alternate, pos: test.pos };
  }

  private parseBinary(minPrec: number): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      let op: string | null = null;
      if (tok.kind === "punct" && tok.value in BINARY_PRECEDENCE) op = tok.value;
      else if (tok.kind === "ident") {
        const kw = tok.value.toLowerCase();
        if (kw === "and" || kw === "or" || kw === "xor") op = kw;
      }
      if (op === null) break;
      const prec = BINARY_PRECEDENCE[op] as number;
      if (prec < minPrec) break;
      this.next();
      const right = this.parseBinary(op === "**" ? prec : prec + 1);
      left = { kind: "binary", operator: op, left, right, pos: left.pos };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const tok = this.peek();
    if (tok.kind === "punct" && ["!", "-", "+", "~", "@"].includes(tok.value)) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "unary", operator: tok.value, operand, prefix: true, pos: tok.pos };
    }
    if (tok.kind === "punct" && (tok.value === "++" || tok.value === "--")) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "unary", operator: tok.value, operand, prefix: true, pos: tok.pos };
    }
    if (tok.kind === "ident") {
      const kw = tok.value.toLowerCase();
      if (kw === "isset" || kw === "empty") {
        this.next();
        this.expectPunct("(");
        const args: ExprNode[] = [];
        while (!this.isPunct(")") && !this.atEof()) {
          args.push(this.parseExpression());
          if (!this.matchPunct(",")) break;
        }
        this.expectPunct(")");
        return {
          kind: "call",
          name: kw,
          callee: null,
          args,
          pos: tok.pos,
        };
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let expr = this.parsePrimary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === "punct" && tok.value === "(") {
        // Call on a non-identifier callee (e.g. $fn()).
        this.next();
        const args = this.parseArgs();
        this.expectPunct(")");
        expr = { kind: "call", name: null, callee: expr, args, pos: expr.pos };
        continue;
      }
      if (tok.kind === "punct" && tok.value === "[") {
        this.next();
        if (this.isPunct("]")) {
          this.next();
          expr = { kind: "array_access", object: expr, index: null, append: true, pos: expr.pos };
        } else {
          const index = this.parseExpression();
          this.expectPunct("]");
          expr = { kind: "array_access", object: expr, index, append: false, pos: expr.pos };
        }
        continue;
      }
      if (tok.kind === "punct" && (tok.value === "->" || tok.value === "?->")) {
        this.next();
        const member = this.peek();
        if (member.kind === "ident") {
          this.next();
          if (this.isPunct("(")) {
            this.next();
            const args = this.parseArgs();
            this.expectPunct(")");
            expr = { kind: "method_call", object: expr, method: member.value, args, pos: expr.pos };
          } else {
            expr = { kind: "property_fetch", object: expr, property: member.value, pos: expr.pos };
          }
          continue;
        }
        if (member.kind === "var") {
          this.next();
          expr = { kind: "property_fetch", object: expr, property: `$${member.value}`, pos: expr.pos };
          continue;
        }
        throw this.error("Expected a member name after ->", member.pos);
      }
      if (tok.kind === "punct" && tok.value === "::") {
        this.next();
        const member = this.peek();
        if (member.kind !== "ident" && member.kind !== "var") {
          throw this.error("Expected a member name after ::", member.pos);
        }
        this.next();
        if (this.isPunct("(")) {
          this.next();
          const args = this.parseArgs();
          this.expectPunct(")");
          const className =
            expr.kind === "const_fetch" || expr.kind === "var" ? this.exprToClassName(expr) : "static";
          expr = { kind: "static_call", className, member: member.value, args, isConstant: false, pos: expr.pos };
        } else {
          const className =
            expr.kind === "const_fetch" || expr.kind === "var" ? this.exprToClassName(expr) : "static";
          expr = { kind: "static_call", className, member: member.value, args: [], isConstant: true, pos: expr.pos };
        }
        continue;
      }
      if (tok.kind === "punct" && (tok.value === "++" || tok.value === "--")) {
        this.next();
        expr = { kind: "unary", operator: tok.value, operand: expr, prefix: false, pos: expr.pos };
        continue;
      }
      break;
    }
    return expr;
  }

  private exprToClassName(expr: ExprNode): string {
    if (expr.kind === "const_fetch") return expr.name;
    if (expr.kind === "var") return `$${expr.name}`;
    return "static";
  }

  private parseArgs(): ExprNode[] {
    const args: ExprNode[] = [];
    while (!this.isPunct(")") && !this.atEof()) {
      if (this.matchPunct("...")) {
        args.push(this.parseExpression());
      } else {
        // Named arguments (PHP 8): name: value — parse and keep the value.
        const save = this.pos;
        if (
          this.peek().kind === "ident" &&
          this.peek(1).kind === "punct" &&
          this.peek(1).value === ":"
        ) {
          this.next();
          this.next();
        } else {
          this.pos = save;
        }
        args.push(this.parseExpression());
      }
      if (!this.matchPunct(",")) break;
    }
    return args;
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();
    switch (tok.kind) {
      case "number": {
        this.next();
        const raw = tok.value;
        let value: number;
        if (/^0[xX]/.test(raw)) value = parseInt(raw, 16);
        else if (/^0[bB]/.test(raw)) value = parseInt(raw.slice(2), 2);
        else if (/^0[oO]/.test(raw)) value = parseInt(raw.slice(2), 8);
        else value = Number(raw);
        return { kind: "literal", literalKind: "number", value, pos: tok.pos };
      }
      case "string": {
        this.next();
        return { kind: "literal", literalKind: "string", value: tok.value, pos: tok.pos };
      }
      case "interp_string": {
        this.next();
        const parts = (tok.parts ?? []).map((p) => {
          if (p.kind === "var") return { kind: "var" as const, value: p.value };
          if (p.kind === "complex") {
            return { kind: "text" as const, value: "" };
          }
          return { kind: "text" as const, value: p.value };
        });
        const hasComplex = (tok.parts ?? []).some((p) => p.kind === "complex");
        if (hasComplex) {
          return {
            kind: "unsupported_expr",
            label: "complex string interpolation",
            reason: "Interpolated expressions like {$obj->prop} or $arr[0] inside a string are not translated; build the string with concatenation instead.",
            source: tok.value,
            pos: tok.pos,
          };
        }
        if (parts.length === 1 && parts[0]?.kind === "text") {
          return { kind: "literal", literalKind: "string", value: parts[0].value, pos: tok.pos };
        }
        return { kind: "interpolated_string", parts, pos: tok.pos };
      }
      case "heredoc": {
        this.next();
        if (tok.isNowdoc === true) {
          return { kind: "literal", literalKind: "string", value: tok.value, pos: tok.pos };
        }
        const parts = (tok.parts ?? []).map((p) => {
          if (p.kind === "var") return { kind: "var" as const, value: p.value };
          return { kind: "text" as const, value: p.value };
        });
        const hasComplex = (tok.parts ?? []).some((p) => p.kind === "complex");
        if (hasComplex) {
          return {
            kind: "unsupported_expr",
            label: "complex heredoc interpolation",
            reason: "Heredoc strings with complex interpolation are not translated.",
            source: `<<<${tok.heredocLabel ?? ""}`,
            pos: tok.pos,
          };
        }
        if (parts.length === 1 && parts[0]?.kind === "text") {
          return { kind: "literal", literalKind: "string", value: parts[0].value, pos: tok.pos };
        }
        return { kind: "interpolated_string", parts, pos: tok.pos };
      }
      case "backtick": {
        this.next();
        return {
          kind: "unsupported_expr",
          label: "backtick execution",
          reason: "Backtick shell execution is blocked by the conversion sandbox.",
          source: `\`${tok.value}\``,
          pos: tok.pos,
        };
      }
      case "var": {
        this.next();
        return { kind: "var", name: tok.value, pos: tok.pos };
      }
      case "punct": {
        if (tok.value === "$") {
          // Variable variables ($$x, $$$x) — parsed, not translated.
          // Consume the whole chain ($ + $key) so the statement parser
          // sees the assignment that usually follows.
          this.next();
          while (this.peek().kind === "var" || this.isPunct("$")) this.next();
          return {
            kind: "unsupported_expr",
            label: "variable variable",
            reason: "Variable variables ($$x) are not translated; name the variable directly.",
            source: "$$",
            pos: tok.pos,
          };
        }
        if (tok.value === "(") {
          // Cast: (int) $x, (string) $y, (float) $z, (bool) $b, (array) $a.
          const afterOpen = this.peek(1);
          const afterType = this.peek(2);
          if (
            afterOpen.kind === "ident" &&
            CAST_TYPES.has(afterOpen.value.toLowerCase()) &&
            afterType.kind === "punct" &&
            afterType.value === ")"
          ) {
            this.next(); // (
            const castType = this.next().value.toLowerCase();
            this.next(); // )
            const operand = this.parseUnary();
            return { kind: "cast", castType, operand, pos: tok.pos };
          }
          this.next();
          const inner = this.parseExpression();
          this.expectPunct(")");
          return inner;
        }
        if (tok.value === "[") {
          return this.parseArrayLiteral();
        }
        if (tok.value === "\\") {
          // Fully-qualified name: \Foo\Bar or \foo().
          const name = this.parseQualifiedName();
          return this.finishName(name, tok.pos);
        }
        break;
      }
      case "ident": {
        const kw = tok.value.toLowerCase();
        if (kw === "true" || kw === "false") {
          this.next();
          return { kind: "literal", literalKind: "bool", value: kw === "true", pos: tok.pos };
        }
        if (kw === "null") {
          this.next();
          return { kind: "literal", literalKind: "null", value: null, pos: tok.pos };
        }
        if (kw === "array") {
          this.next();
          this.expectPunct("(");
          const entries = this.parseArrayEntries(")");
          this.expectPunct(")");
          return { kind: "array", entries, pos: tok.pos };
        }
        if (kw === "function") {
          this.next();
          return this.parseClosure(tok.pos);
        }
        if (kw === "static" && this.peek(1).kind === "ident" && this.peek(1).value.toLowerCase() === "function") {
          // Static closure: static function ($x) use ($y) { … }
          this.next();
          this.next();
          return this.parseClosure(tok.pos);
        }
        if (kw === "new") {
          this.next();
          // Class name may be qualified: new Foo\Bar(), new \Foo\Bar().
          const className = this.parseQualifiedNameOrVar();
          let args: ExprNode[] = [];
          if (this.isPunct("(")) {
            this.next();
            args = this.parseArgs();
            this.expectPunct(")");
          }
          return { kind: "new", className, args, pos: tok.pos };
        }
        if (kw === "yield") {
          // Generators are parsed (so analysis is accurate) but not
          // translated — recorded as unsupported by the emitter.
          this.next();
          if (this.isIdent("from")) {
            this.next();
            this.parseExpression();
          } else if (!this.isPunct(";") && !this.isPunct(")") && !this.isPunct(",") && !this.isPunct("]")) {
            this.parseExpression();
            if (this.matchPunct("=>")) this.parseExpression();
          }
          return {
            kind: "unsupported_expr",
            label: "yield",
            reason: "Generators (yield) are not translated; restructure the function to return an array.",
            source: "yield",
            pos: tok.pos,
          };
        }
        if (kw === "list") {
          this.next();
          this.expectPunct("(");
          const names: ExprNode[] = [];
          while (!this.isPunct(")") && !this.atEof()) {
            const v = this.peek();
            if (v.kind === "var") {
              this.next();
              names.push({ kind: "var", name: v.value, pos: v.pos });
            } else {
              names.push(this.parseExpression());
            }
            if (!this.matchPunct(",")) break;
          }
          this.expectPunct(")");
          // list(...) = expr is handled by the assignment parser as a call-like target.
          return {
            kind: "call",
            name: "__list_assign",
            callee: null,
            args: names,
            pos: tok.pos,
          };
        }
        if (kw === "clone") {
          this.next();
          const operand = this.parseUnary();
          return {
            kind: "unsupported_expr",
            label: "clone",
            reason: "Object cloning has no equivalent in the Wordless extension runtime.",
            source: "clone",
            pos: tok.pos,
          };
        }
        // Plain function call or constant fetch (name may be qualified:
        // WP_CLI\Utils\format_items, \esc_html).
        const name = this.parseQualifiedName();
        return this.finishName(name, tok.pos);
      }
      default:
        break;
    }
    throw this.error(`Unexpected token ${this.describe(tok)}`, tok.pos);
  }

  /** Read a (possibly qualified) name: Foo, Foo\Bar, \Foo\Bar. The leading
   *  backslash and every segment are consumed; the current token must be an
   *  ident (or a leading `\` punct) when called. */
  private parseQualifiedName(): string {
    let name = "";
    if (this.isPunct("\\")) {
      this.next();
      name = "\\";
    }
    const first = this.expectIdent("name");
    name += first.value;
    while (this.isPunct("\\")) {
      this.next();
      name += "\\" + this.expectIdent("namespace segment").value;
    }
    return name;
  }

  /** A class name after `new`: a qualified name, or a variable ($class). */
  private parseQualifiedNameOrVar(): string {
    if (this.peek().kind === "var") return `$${this.next().value}`;
    return this.parseQualifiedName();
  }

  /** Finish a name read by parseQualifiedName: a call if followed by `(`,
   *  otherwise a constant fetch. */
  private finishName(name: string, pos: SourcePos): ExprNode {
    if (this.isPunct("(")) {
      this.next();
      const args = this.parseArgs();
      this.expectPunct(")");
      return { kind: "call", name, callee: null, args, pos };
    }
    return { kind: "const_fetch", name, pos };
  }

  private parseArrayLiteral(): ArrayNode {
    const start = this.expectPunct("[").pos;
    const entries = this.parseArrayEntries("]");
    this.expectPunct("]");
    return { kind: "array", entries, pos: start };
  }

  private parseArrayEntries(closer: string): ArrayEntry[] {
    const entries: ArrayEntry[] = [];
    while (!this.isPunct(closer) && !this.atEof()) {
      // Spread: ...$arr
      if (this.matchPunct("...")) {
        const value = this.parseExpression();
        entries.push({ key: null, value });
        if (!this.matchPunct(",")) break;
        continue;
      }
      const first = this.parseExpression();
      if (this.matchPunct("=>")) {
        const value = this.parseExpression();
        entries.push({ key: first, value });
      } else {
        entries.push({ key: null, value: first });
      }
      if (!this.matchPunct(",")) break;
    }
    return entries;
  }
}

/** Convenience: parse + return the node counts used by reports. */
export function parsePhpWithStats(source: string): ParseResult & { nodeCount: number } {
  const result = parsePhp(source);
  return { ...result, nodeCount: countAstNodes(result.program) };
}

export type { AstNode };
export { countAstNodes, walkAst };
