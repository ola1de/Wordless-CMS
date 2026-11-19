/**
 * WordPress conversion engine (Milestone 4) — AST → TypeScript emitter.
 *
 * Translates a parsed PHP program into a Wordless extension module. The
 * output is real TypeScript that typechecks: every PHP function becomes a
 * TS function taking the WordPress API (`wp`) as its first parameter,
 * `add_action` / `add_filter` become hook registrations in `activate()`,
 * and `echo` / `printf` output is collected into a returned string.
 *
 * Honesty rules:
 * - A WordPress/PHP function with no mapping is emitted as a call to a
 *   generated `__unmapped_<name>` helper that throws at runtime, and is
 *   listed in the report — the module still typechecks, but the gap is
 *   visible and the report says the extension needs manual work.
 * - Constructs the parser marked `unsupported` are emitted as comments
 *   plus a report entry, never silently dropped.
 * - WordPress data functions are async in Wordless (they hit D1) while
 *   PHP code is synchronous: the emitter propagates asyncness through
 *   the file's own call graph and awaits where needed.
 */
import type {
  AstNode,
  ClassDeclNode,
  ExprNode,
  FunctionDeclNode,
  MethodDeclNode,
  ParamNode,
  ProgramNode,
  StmtNode,
} from "./ast";
import { childNodes, walkAst } from "./ast";

export interface UnconvertedItem {
  kind: string;
  name?: string;
  reason: string;
  line: number;
}

export interface HookRegistration {
  tag: string;
  kind: "action" | "filter";
  functionName: string;
  priority: number;
  line: number;
}

export interface EmitReport {
  functions: string[];
  asyncFunctions: string[];
  hooks: HookRegistration[];
  unconverted: UnconvertedItem[];
  warnings: string[];
  transformed: { what: string; note: string }[];
  helpersUsed: string[];
}

export interface EmitResult {
  code: string;
  report: EmitReport;
}

export interface EmitOptions {
  filename: string;
  slug: string;
  /** Import path for the WordPressApi type in the generated module. */
  compatImport?: string;
  /** Plugin header fields (Plugin Name, Version, Author, Description). */
  pluginHeader?: Record<string, string>;
  /** Human-readable source label for the header comment. */
  sourceLabel?: string;
}

/** WordPress API functions that are async in Wordless (they hit D1). */
const WP_ASYNC = new Set([
  "get_option",
  "update_option",
  "delete_option",
  "add_option",
  "get_post",
  "get_posts",
  "wp_insert_post",
  "wp_update_post",
  "wp_delete_post",
  "get_user_meta",
  "update_user_meta",
  "wp_get_post_terms",
  "get_the_terms",
  "wp_list_categories",
  "wp_get_post_revisions",
  "wp_restore_post_revision",
  "wp_nav_menu",
  "get_media_items",
  "wp_get_attachment_url",
  "media_handle_upload",
  "wp_schedule_event",
]);

/** WordPress API functions that are synchronous in Wordless. */
const WP_SYNC = new Set([
  "get_user_locale",
  "get_locale",
  "add_action",
  "add_filter",
  "remove_action",
  "remove_filter",
  "apply_filters",
  "do_action",
  "register_post_type",
  "register_taxonomy",
  "add_shortcode",
  "current_user_can",
  "wp_enqueue_script",
  "wp_enqueue_style",
  "register_rest_route",
  "__",
  "_e",
  "esc_html",
  "esc_attr",
  "esc_html__",
  "esc_attr__",
  "wptexturize",
]);

const TS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "null", "return",
  "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
  "while", "with", "yield", "let", "static", "await", "enum", "implements",
  "interface", "package", "private", "protected", "public", "abstract",
  "boolean", "byte", "char", "double", "final", "float", "goto", "int",
  "long", "native", "short", "transient", "volatile", "of", "as", "from",
  "get", "set", "constructor", "string", "number",
]);

/** snake_case PHP name → camelCase TypeScript name. */
export function toTsName(phpName: string): string {
  const camel = phpName.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase());
  if (TS_RESERVED.has(camel)) return `_${camel}`;
  return camel;
}

/** Map a PHP parameter type to a TypeScript type. */
function phpTypeToTs(type: string | null): string {
  if (type === null) return "unknown";
  const nullable = type.startsWith("?");
  const base = nullable ? type.slice(1) : type;
  const parts = base.split("|").map((p) => {
    switch (p.toLowerCase()) {
      case "int":
      case "integer":
      case "float":
      case "double":
        return "number";
      case "string":
        return "string";
      case "bool":
      case "boolean":
        return "boolean";
      case "array":
        return "unknown[]";
      case "callable":
        return "(...args: unknown[]) => unknown";
      case "mixed":
      case "object":
        return "unknown";
      case "void":
        return "void";
      case "null":
        return "null";
      case "false":
        return "false";
      case "true":
        return "true";
      default:
        // Class names and unknown types — the runtime has no class system.
        return "unknown";
    }
  });
  const joined = parts.join(" | ");
  return nullable ? `${joined} | null` : joined;
}

interface FunctionInfo {
  phpName: string;
  tsName: string;
  node: FunctionDeclNode;
  isAsync: boolean;
  returnsOutput: boolean;
  hasReturnValue: boolean;
}

interface EmitContext {
  /** Variable names assigned anywhere in the current function (pre-declared with `let`). */
  declaredVars: Set<string>;
  /** True while emitting inside a function that collects echo output. */
  inFunction: boolean;
  /** Current function info, if any. */
  currentFunction: FunctionInfo | null;
  /** Depth, for indentation. */
  depth: number;
  /** Function-local static vars renamed to their module-level names. */
  renameVars?: Map<string, string>;
}

const SUPERGLOBALS = new Set([
  "_GET",
  "_POST",
  "_SERVER",
  "_FILES",
  "_COOKIE",
  "_REQUEST",
  "_SESSION",
  "_ENV",
  "GLOBALS",
]);

export function emitTypeScript(program: ProgramNode, options: EmitOptions): EmitResult {
  const compatImport = options.compatImport ?? "../../src/compat/wordpress";
  const unconverted: UnconvertedItem[] = [];
  const warnings: string[] = [];
  const transformed: { what: string; note: string }[] = [];
  const helpersUsed = new Set<string>();
  const functions = new Map<string, FunctionInfo>();
  const hookRegs: HookRegistration[] = [];
  const topLevelStmts: StmtNode[] = [];
  const classDecls: ClassDeclNode[] = [];
  /** Function-local `static` variables hoisted to module level (PHP statics
   *  persist across calls; a function-level `let` would not). */
  const moduleStatics: { fnName: string; varName: string; init: ExprNode | null }[] = [];

  const noteUnconverted = (kind: string, reason: string, line: number, name?: string): void => {
    if (!unconverted.some((u) => u.kind === kind && u.name === name && u.line === line)) {
      unconverted.push({ kind, name, reason, line });
    }
  };

  // ---------------------------------------------------------- first pass
  for (const stmt of program.body) {
    if (stmt.kind === "function") {
      const tsName = toTsName(stmt.name);
      functions.set(stmt.name, {
        phpName: stmt.name,
        tsName,
        node: stmt,
        isAsync: false,
        returnsOutput: false,
        hasReturnValue: false,
      });
    } else if (stmt.kind === "class") {
      classDecls.push(stmt);
    } else {
      topLevelStmts.push(stmt);
    }
  }

  // Collect hook registrations at the top level.
  for (const stmt of topLevelStmts) {
    if (stmt.kind !== "expr_stmt") continue;
    const expr = stmt.expr;
    if (expr.kind !== "call" || (expr.name !== "add_action" && expr.name !== "add_filter")) continue;
    const [tagArg, cbArg, prioArg] = expr.args;
    if (tagArg === undefined || cbArg === undefined) continue;
    if (tagArg.kind !== "literal" || tagArg.literalKind !== "string") {
      noteUnconverted("hook registration", "add_action/add_filter with a non-literal hook tag is not translated.", expr.pos.line);
      continue;
    }
    const tag = String(tagArg.value);
    const priority =
      prioArg !== undefined && prioArg.kind === "literal" && prioArg.literalKind === "number"
        ? Number(prioArg.value)
        : 10;
    if (cbArg.kind === "literal" && cbArg.literalKind === "string") {
      const fnName = String(cbArg.value);
      if (functions.has(fnName)) {
        hookRegs.push({
          tag,
          kind: expr.name === "add_action" ? "action" : "filter",
          functionName: fnName,
          priority,
          line: expr.pos.line,
        });
      } else {
        noteUnconverted("hook callback", `Hook "${tag}" references function ${fnName}(), which is not defined in this file.`, expr.pos.line, fnName);
      }
    } else if (cbArg.kind === "closure") {
      noteUnconverted("hook callback", `Hook "${tag}" uses a closure callback; closures as hook callbacks are not translated yet.`, expr.pos.line);
    } else {
      noteUnconverted("hook callback", `Hook "${tag}" uses a non-literal callback (array callable or variable); only a function-name string is translated.`, expr.pos.line);
    }
  }

  // Async analysis: a function is async when it calls an async WP function
  // or another async function from this file. Fixpoint over the call graph.
  const callsAsyncWp = (node: FunctionDeclNode): boolean => {
    let found = false;
    walkAst({ kind: "program", body: node.body, pos: node.pos }, (n) => {
      if (n.kind === "call" && n.name !== null && WP_ASYNC.has(n.name)) found = true;
    });
    return found;
  };
  const callsFunction = (node: FunctionDeclNode, target: string): boolean => {
    let found = false;
    walkAst({ kind: "program", body: node.body, pos: node.pos }, (n) => {
      if (n.kind === "call" && n.name === target) found = true;
    });
    return found;
  };
  for (const info of functions.values()) {
    info.isAsync = callsAsyncWp(info.node);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of functions.values()) {
      if (info.isAsync) continue;
      for (const other of functions.values()) {
        if (other.isAsync && callsFunction(info.node, other.phpName)) {
          info.isAsync = true;
          changed = true;
        }
      }
    }
  }

  // Per-function output/return analysis.
  for (const info of functions.values()) {
    let returnsOutput = false;
    let hasReturnValue = false;
    walkAst({ kind: "program", body: info.node.body, pos: info.node.pos }, (n) => {
      if (n.kind === "echo") returnsOutput = true;
      if (n.kind === "call" && n.name === "printf") returnsOutput = true;
      if (n.kind === "return" && n.value !== null) hasReturnValue = true;
    });
    info.returnsOutput = returnsOutput;
    info.hasReturnValue = hasReturnValue;
  }

  // ------------------------------------------------------------ emission
  const lines: string[] = [];
  const indent = (depth: number): string => "  ".repeat(depth);

  const header = options.pluginHeader ?? {};
  const extName = header["Plugin Name"] ?? options.slug;
  const extVersion = header["Version"] ?? "0.1.0";
  const extAuthor = header["Author"] ?? "";
  const extDescription = header["Description"] ?? "";

  lines.push(`// Generated by the Wordless conversion engine (Milestone 4) from ${options.filename}.`);
  lines.push(`// Source: ${options.sourceLabel ?? options.filename} — converted statically, never executed.`);
  lines.push(`// DO NOT EDIT BY HAND: regenerate with the converter. Review before enabling.`);
  lines.push(`// Sandbox: this module runs only through the Wordless extension API,`);
  lines.push(`// with the same capability checks as any extension. It cannot load`);
  lines.push(`// code dynamically, run shell commands, or touch PHP.`);
  lines.push(`import type { WordPressApi } from "${compatImport}";`);
  lines.push(``);

  const unmappedHelpers = new Set<string>();

  // -- expression emission -------------------------------------------------
  const emitExpr = (expr: ExprNode, ctx: EmitContext): string => {
    switch (expr.kind) {
      case "literal": {
        if (expr.literalKind === "string") return JSON.stringify(expr.value);
        if (expr.literalKind === "null") return "null";
        return String(expr.value);
      }
      case "var": {
        // Function-local static vars were hoisted to module level.
        if (ctx.renameVars?.has(expr.name)) {
          return ctx.renameVars.get(expr.name) as string;
        }
        if (expr.name === "this") {
          noteUnconverted("this", "$this has no equivalent: Wordless extensions are functions, not objects.", expr.pos.line);
          helpersUsed.add("__unsupported");
          return `__unsupported("$this is not available in a Wordless extension")`;
        }
        if (SUPERGLOBALS.has(expr.name)) {
          noteUnconverted("superglobal", `$${expr.name} is not available in a Wordless extension; use the request context API (Phase 6).`, expr.pos.line, `$${expr.name}`);
          helpersUsed.add("__unsupported");
          return `__unsupported("superglobal $${expr.name} is not available")`;
        }
        return expr.name;
      }
      case "array": {
        const allKeyless = expr.entries.every((e) => e.key === null);
        if (allKeyless) {
          return `[${expr.entries.map((e) => emitExpr(e.value, ctx)).join(", ")}]`;
        }
        const sequential = expr.entries.every(
          (e, i) => e.key !== null && e.key.kind === "literal" && e.key.literalKind === "number" && Number(e.key.value) === i,
        );
        if (sequential) {
          return `[${expr.entries.map((e) => emitExpr(e.value, ctx)).join(", ")}]`;
        }
        const parts = expr.entries.map((e) => {
          const key =
            e.key === null
              ? null
              : e.key.kind === "literal" && (e.key.literalKind === "string" || e.key.literalKind === "number")
                ? JSON.stringify(String(e.key.value))
                : `[${emitExpr(e.key, ctx)}]`;
          return key === null ? emitExpr(e.value, ctx) : `${key}: ${emitExpr(e.value, ctx)}`;
        });
        if (expr.entries.some((e) => e.key === null)) {
          warnings.push(`Mixed list/object PHP array at line ${expr.pos.line} was emitted as an object; list entries use numeric keys.`);
        }
        return `{ ${parts.join(", ")} }`;
      }
      case "array_access": {
        if (expr.append) {
          // Only valid as an assignment target; handled by emitAssign.
          return emitExpr(expr.object, ctx);
        }
        const obj = emitExpr(expr.object, ctx);
        const idx = expr.index === null ? "" : emitExpr(expr.index, ctx);
        return `${obj}[${idx}]`;
      }
      case "binary": {
        const left = emitExpr(expr.left, ctx);
        const right = emitExpr(expr.right, ctx);
        switch (expr.operator) {
          case ".":
            return `(${left} + ${right})`;
          case "and":
            return `(${left} && ${right})`;
          case "or":
            return `(${left} || ${right})`;
          case "xor":
            warnings.push(`PHP "xor" at line ${expr.pos.line} was translated as !== (boolean xor).`);
            return `(${left} !== ${right})`;
          case "<=>":
            // Spaceship operator: -1 / 0 / 1.
            return `(${left} < ${right} ? -1 : ${left} > ${right} ? 1 : 0)`;
          default:
            return `(${left} ${expr.operator} ${right})`;
        }
      }
      case "unary": {
        const operand = emitExpr(expr.operand, ctx);
        if (expr.operator === "@") {
          warnings.push(`Error-suppression operator @ at line ${expr.pos.line} was removed (Wordless never suppresses errors).`);
          return operand;
        }
        if (expr.prefix) return `(${expr.operator}${operand})`;
        return `(${operand}${expr.operator})`;
      }
      case "ternary": {
        const test = emitExpr(expr.test, ctx);
        const alt = emitExpr(expr.alternate, ctx);
        if (expr.consequent === null) return `(${test} ?? ${alt})`;
        return `(${test} ? ${emitExpr(expr.consequent, ctx)} : ${alt})`;
      }
      case "interpolated_string": {
        const escapeTemplateText = (text: string): string =>
          text
            .replace(/\\/g, "\\\\")
            .replace(/`/g, "\\`")
            .replace(/\$/g, "\\$")
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
        const parts = expr.parts
          .map((p) => {
            if (p.kind === "text") return escapeTemplateText(p.value);
            return `\${${p.value}}`;
          })
          .join("");
        return `\`${parts}\``;
      }
      case "assign":
        return emitAssign(expr, ctx);
      case "call":
        return emitCall(expr, ctx);
      case "method_call": {
        noteUnconverted("method call", `Method call $...->${expr.method}() needs a class runtime, which Wordless does not provide yet.`, expr.pos.line, expr.method);
        helpersUsed.add("__unsupported");
        return `__unsupported("method call ->${expr.method}() is not converted")`;
      }
      case "static_call": {
        noteUnconverted("static call", `Static call ${expr.className}::${expr.member}() needs a class runtime, which Wordless does not provide yet.`, expr.pos.line, expr.member);
        helpersUsed.add("__unsupported");
        return `__unsupported("static call ${expr.className}::${expr.member}() is not converted")`;
      }
      case "property_fetch": {
        noteUnconverted("property fetch", `Property fetch ->${expr.property} needs a class runtime, which Wordless does not provide yet.`, expr.pos.line, expr.property);
        helpersUsed.add("__unsupported");
        return `__unsupported("property fetch ->${expr.property} is not converted")`;
      }
      case "const_fetch": {
        switch (expr.name) {
          case "__FILE__":
          case "__DIR__":
          case "__LINE__":
          case "__FUNCTION__":
          case "__CLASS__":
          case "__METHOD__":
          case "__NAMESPACE__":
            noteUnconverted("magic constant", `${expr.name} has no equivalent in a converted extension.`, expr.pos.line, expr.name);
            helpersUsed.add("__unsupported");
            return `__unsupported("magic constant ${expr.name} is not available")`;
          case "DIRECTORY_SEPARATOR":
            return `"/"`;
          case "PHP_EOL":
            return `"\\n"`;
          case "PHP_VERSION":
            return `"8.0"`;
          default:
            // Unknown constant — probably a plugin-defined one.
            noteUnconverted("constant", `Constant ${expr.name} is not defined in this file; it may come from another file or WordPress core.`, expr.pos.line, expr.name);
            helpersUsed.add("__unsupported");
            return `__unsupported("constant ${expr.name} is not defined")`;
        }
      }
      case "new": {
        noteUnconverted("instantiation", `new ${expr.className}() needs a class runtime, which Wordless does not provide yet.`, expr.pos.line, expr.className);
        helpersUsed.add("__unsupported");
        return `__unsupported("new ${expr.className}() is not converted")`;
      }
      case "closure": {
        if (expr.uses.length > 0) {
          noteUnconverted("closure", "Closures that capture variables with `use` are not translated.", expr.pos.line);
          helpersUsed.add("__unsupported");
          return `__unsupported("closure with use() is not converted")`;
        }
        const params = expr.params.map((p) => emitParam(p)).join(", ");
        const subVars = new Set<string>();
        collectAssignedVars(expr.body, subVars);
        for (const p of expr.params) subVars.delete(p.name);
        const sub: EmitContext = { ...ctx, declaredVars: subVars, depth: ctx.depth + 1 };
        const decls = [...subVars].sort().map((n) => `${indent(ctx.depth + 1)}let ${n};`).join("\n");
        const bodyLines = emitStmtList(expr.body, sub);
        const inner = [decls, bodyLines].filter((s) => s !== "").join("\n");
        return `(${params}) => {\n${inner}\n${indent(ctx.depth)}}`;
      }
      case "cast": {
        const inner = emitExpr(expr.operand, ctx);
        switch (expr.castType) {
          case "int":
          case "integer":
            return `Math.trunc(Number(${inner}))`;
          case "float":
          case "double":
          case "real":
            return `Number(${inner})`;
          case "string":
          case "binary":
            return `String(${inner})`;
          case "bool":
          case "boolean":
            return `Boolean(${inner})`;
          case "array":
            return `(Array.isArray(${inner}) ? ${inner} : [${inner}])`;
          case "unset":
            return "null";
          default:
            noteUnconverted("cast", `(object) cast has no direct equivalent; the value is used as-is.`, expr.pos.line);
            return inner;
        }
      }
      case "unsupported_expr": {
        noteUnconverted("expression", expr.reason, expr.pos.line, expr.label);
        helpersUsed.add("__unsupported");
        return `__unsupported(${JSON.stringify(expr.reason)})`;
      }
      default:
        return "undefined";
    }
  };

  const emitParam = (p: ParamNode): string => {
    const tsType = phpTypeToTs(p.type);
    const name = p.variadic ? `...${p.name}` : p.name;
    if (p.defaultValue !== null) {
      const ctx: EmitContext = { declaredVars: new Set(), inFunction: false, currentFunction: null, depth: 0 };
      return `${name}: ${tsType} = ${emitExpr(p.defaultValue, ctx)}`;
    }
    if (p.type === null && !p.variadic) return `${name}: unknown`;
    return `${name}: ${tsType}`;
  };

  /** Collect variable names assigned anywhere in a statement list. */
  const collectAssignedVars = (stmts: StmtNode[], into: Set<string>): void => {
    for (const stmt of stmts) {
      walkAst({ kind: "program", body: [stmt], pos: stmt.pos }, (n) => {
        if (n.kind === "assign" && n.target.kind === "var") into.add(n.target.name);
        if (n.kind === "foreach") {
          into.add(n.valueVar);
          if (n.keyVar !== null) into.add(n.keyVar);
        }
        if (n.kind === "for" && n.init !== null && n.init.kind === "assign" && n.init.target.kind === "var") {
          into.add(n.init.target.name);
        }
      });
    }
  };

  const emitAssign = (node: Extract<ExprNode, { kind: "assign" }>, ctx: EmitContext): string => {
    // Assignment through an untranslatable target (e.g. $$key = $val):
    // evaluate the value for its side effects and drop the assignment.
    if (node.target.kind === "unsupported_expr") {
      noteUnconverted(
        "variable variable",
        "Assignment through a variable variable ($$key) is not translated; name the variable directly.",
        node.pos.line,
      );
      return `void (${emitExpr(node.value, ctx)})`;
    }
    // list($a, $b) = expr → destructuring.
    if (node.target.kind === "call" && node.target.name === "__list_assign") {
      const names = node.target.args
        .map((a) => (a.kind === "var" ? a.name : null))
        .filter((n): n is string => n !== null);
      return `([${names.join(", ")}] = ${emitExpr(node.value, ctx)})`;
    }
    if (node.target.kind === "array_access" && node.target.append) {
      if (node.operator !== "=") {
        warnings.push(`Append assignment with operator ${node.operator} at line ${node.pos.line} was simplified to push().`);
      }
      return `${emitExpr(node.target.object, ctx)}.push(${emitExpr(node.value, ctx)})`;
    }
    const target = emitExpr(node.target, ctx);
    const value = emitExpr(node.value, ctx);
    if (node.operator === "=") return `(${target} = ${value})`;
    return `(${target} ${node.operator} ${value})`;
  };

  /**
   * Emit a call argument. A direct array read ($arr[$i]) is asserted
   * non-null: under `noUncheckedIndexedAccess` the read is `T | undefined`,
   * but the PHP source guarantees the index by construction in the cases
   * the converter sees (e.g. mt_rand(0, count($arr) - 1)). The assertion
   * makes that assumption visible in the generated code instead of hiding
   * it behind a cast — a reviewer can see exactly where it is relied on.
   */
  const emitCallArg = (a: ExprNode, ctx: EmitContext): string => {
    const text = emitExpr(a, ctx);
    return a.kind === "array_access" ? `${text}!` : text;
  };

  const emitCall = (expr: Extract<ExprNode, { kind: "call" }>, ctx: EmitContext): string => {
    const name = expr.name;
    // Dynamic call ($fn()): not translatable.
    if (name === null) {
      noteUnconverted("dynamic call", "Calling a function through a variable is not translated; name the function directly.", expr.pos.line);
      helpersUsed.add("__unsupported");
      return `__unsupported("dynamic function call is not converted")`;
    }
    const lower = name.toLowerCase();

    // isset / empty (parsed as calls by the parser).
    if (lower === "isset") {
      const target = expr.args[0];
      if (target === undefined) return "false";
      if (target.kind === "var") return `(typeof ${target.name} !== "undefined" && ${target.name} !== null)`;
      const t = emitExpr(target, ctx);
      return `(${t} !== undefined && ${t} !== null)`;
    }
    if (lower === "empty") {
      const target = expr.args[0];
      if (target === undefined) return "true";
      return `(!${emitExpr(target, ctx)})`;
    }

    // printf / sprintf.
    if (lower === "printf" || lower === "sprintf") {
      helpersUsed.add("__sprintf");
      const args = expr.args.map((a) => emitExpr(a, ctx));
      return `__sprintf(${args.join(", ")})`;
    }

    // WordPress API (sync + async).
    if (WP_ASYNC.has(lower) || WP_SYNC.has(lower)) {
      return emitWpCall(lower, expr, ctx);
    }

    // Local function from this file.
    const local = functions.get(name);
    if (local !== undefined) {
      const args = expr.args.map((a) => emitExpr(a, ctx)).join(", ");
      const awaited = local.isAsync ? "await " : "";
      return `${awaited}${local.tsName}(wp${args.length > 0 ? `, ${args}` : ""})`;
    }

    // Built-in PHP functions.
    const builtin = emitBuiltin(lower, expr, ctx);
    if (builtin !== null) return builtin;

    // add_action / add_filter inside a function body (top-level ones are
    // handled by activate() generation).
    if (lower === "add_action" || lower === "add_filter") {
      return emitHookCall(lower, expr, ctx);
    }

    // Unmapped: throwing helper + report entry.
    noteUnconverted("function call", `No Wordless mapping for ${name}() yet; the generated code throws if this line runs.`, expr.pos.line, name);
    const helper = `__unmapped_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
    unmappedHelpers.add(helper);
    helpersUsed.add(helper);
    const args = expr.args.map((a) => emitCallArg(a, ctx)).join(", ");
    return `${helper}(${args})`;
  };

  const emitWpCall = (lower: string, expr: Extract<ExprNode, { kind: "call" }>, ctx: EmitContext): string => {
    const args = expr.args.map((a) => emitCallArg(a, ctx));
    const awaited = WP_ASYNC.has(lower) ? "await " : "";
    switch (lower) {
      case "esc_html__":
        return `wp.esc_html(wp.__(${args[0] ?? `""`}))`;
      case "esc_attr__":
        return `wp.esc_attr(wp.__(${args[0] ?? `""`}))`;
      case "_e":
        // _e() echoes in PHP; here it returns the string (echo is handled
        // by the statement emitter).
        return `wp.__(${args[0] ?? `""`})`;
      default:
        return `${awaited}wp.${lower}(${args.join(", ")})`;
    }
  };

  const emitHookCall = (kind: string, expr: Extract<ExprNode, { kind: "call" }>, ctx: EmitContext): string => {
    const [tagArg, cbArg, prioArg] = expr.args;
    const tag = tagArg !== undefined ? emitExpr(tagArg, ctx) : `""`;
    const priority =
      prioArg !== undefined && prioArg.kind === "literal" && prioArg.literalKind === "number"
        ? `, ${Number(prioArg.value)}`
        : "";
    if (cbArg !== undefined && cbArg.kind === "literal" && cbArg.literalKind === "string") {
      const fnName = String(cbArg.value);
      const local = functions.get(fnName);
      if (local !== undefined) {
        const awaited = local.isAsync ? "void " : "";
        return `${awaited}wp.${kind}(${tag}, (...hookArgs: unknown[]) => ${local.tsName}(wp, ...hookArgs)${priority})`;
      }
      noteUnconverted("hook callback", `Hook callback ${fnName}() is not defined in this file.`, expr.pos.line, fnName);
      helpersUsed.add("__unsupported");
      return `__unsupported("hook callback ${fnName}() is not defined")`;
    }
    if (cbArg !== undefined && cbArg.kind === "closure") {
      return `wp.${kind}(${tag}, ${emitExpr(cbArg, ctx)}${priority})`;
    }
    noteUnconverted("hook callback", "Only a function-name string (or a closure) can be a hook callback.", expr.pos.line);
    helpersUsed.add("__unsupported");
    return `__unsupported("hook callback is not a function name")`;
  };

  /** Built-in PHP → TypeScript mapping. Returns null when unmapped. */
  const emitBuiltin = (
    lower: string,
    expr: Extract<ExprNode, { kind: "call" }>,
    ctx: EmitContext,
  ): string | null => {
    const args = expr.args.map((a) => emitCallArg(a, ctx));
    const a = (i: number): string => args[i] ?? "undefined";
    switch (lower) {
      case "explode": {
        if (args.length === 2) return `${a(1)}.split(${a(0)})`;
        return null;
      }
      case "implode": {
        if (args.length === 2) return `${a(1)}.join(${a(0)})`;
        if (args.length === 1) return `${a(0)}.join("")`;
        return null;
      }
      case "count":
        // Works for lists and associative arrays alike.
        return `(Array.isArray(${a(0)}) ? (${a(0)} as unknown[]).length : Object.keys(${a(0)} as Record<string, unknown>).length)`;
      case "substr": {
        helpersUsed.add("__substr");
        if (args.length === 2) return `__substr(${a(0)}, ${a(1)})`;
        if (args.length === 3) return `__substr(${a(0)}, ${a(1)}, ${a(2)})`;
        return null;
      }
      case "strlen":
        warnings.push(`strlen() at line ${expr.pos.line} counts UTF-16 code units in TypeScript, not bytes.`);
        return `String(${a(0)}).length`;
      case "strtolower":
        return `String(${a(0)}).toLowerCase()`;
      case "strtoupper":
        return `String(${a(0)}).toUpperCase()`;
      case "trim":
        return args.length === 1 ? `String(${a(0)}).trim()` : null;
      case "str_replace": {
        if (args.length === 3) return `String(${a(2)}).replaceAll(${a(0)}, ${a(1)})`;
        return null;
      }
      case "str_contains":
        return `String(${a(0)}).includes(${a(1)})`;
      case "str_starts_with":
        return `String(${a(0)}).startsWith(${a(1)})`;
      case "str_ends_with":
        return `String(${a(0)}).endsWith(${a(1)})`;
      case "ucfirst":
        return `(String(${a(0)}).charAt(0).toUpperCase() + String(${a(0)}).slice(1))`;
      case "lcfirst":
        return `(String(${a(0)}).charAt(0).toLowerCase() + String(${a(0)}).slice(1))`;
      case "str_repeat":
        return `String(${a(0)}).repeat(Number(${a(1)}))`;
      case "in_array":
        return `(${a(1)} as unknown[]).includes(${a(0)})`;
      case "array_merge":
        warnings.push(`array_merge() at line ${expr.pos.line} was translated with list (spread) semantics; associative-array key overwriting is not preserved.`);
        return `[${args.map((x) => `...(${x} as unknown[])`).join(", ")}]`;
      case "array_keys":
        return `Object.keys(${a(0)} as Record<string, unknown>)`;
      case "array_values":
        return `Object.values(${a(0)} as Record<string, unknown>)`;
      case "array_map": {
        if (args.length !== 2) return null;
        const fnArg = expr.args[0];
        if (fnArg !== undefined && fnArg.kind === "literal" && fnArg.literalKind === "string") {
          const fnName = String(fnArg.value);
          const local = functions.get(fnName);
          if (local !== undefined) return `(${a(1)} as unknown[]).map((v: unknown) => ${local.tsName}(wp, v))`;
          const builtinName = fnName.toLowerCase();
          if (builtinName === "strtolower") return `(${a(1)} as unknown[]).map((v: unknown) => String(v).toLowerCase())`;
          if (builtinName === "strtoupper") return `(${a(1)} as unknown[]).map((v: unknown) => String(v).toUpperCase())`;
          if (builtinName === "trim") return `(${a(1)} as unknown[]).map((v: unknown) => String(v).trim())`;
          if (builtinName === "intval") return `(${a(1)} as unknown[]).map((v: unknown) => Math.trunc(Number(v)))`;
        }
        return null;
      }
      case "array_filter": {
        if (args.length === 1) return `(${a(0)} as unknown[]).filter(Boolean)`;
        return null;
      }
      case "is_array":
        return `Array.isArray(${a(0)})`;
      case "is_string":
        return `(typeof ${a(0)} === "string")`;
      case "is_int":
      case "is_integer":
        return `Number.isInteger(${a(0)})`;
      case "is_bool":
        return `(typeof ${a(0)} === "boolean")`;
      case "is_null":
        return `(${a(0)} === null)`;
      case "is_numeric":
        return `!Number.isNaN(Number(${a(0)}))`;
      case "intval":
        return `Math.trunc(Number(${a(0)}))`;
      case "floatval":
        return `Number(${a(0)})`;
      case "strval":
        return `String(${a(0)})`;
      case "boolval":
        return `Boolean(${a(0)})`;
      case "json_encode":
        return `JSON.stringify(${a(0)})`;
      case "json_decode":
        return `JSON.parse(String(${a(0)}))`;
      case "mt_rand":
      case "rand": {
        helpersUsed.add("__rand");
        if (args.length === 2) return `__rand(${a(0)}, ${a(1)})`;
        if (args.length === 0) return `__rand(0, 2147483647)`;
        return null;
      }
      case "time":
        return `Math.floor(Date.now() / 1000)`;
      case "min":
        return `Math.min(${args.join(", ")})`;
      case "max":
        return `Math.max(${args.join(", ")})`;
      case "abs":
        return `Math.abs(${a(0)})`;
      case "floor":
        return `Math.floor(${a(0)})`;
      case "ceil":
        return `Math.ceil(${a(0)})`;
      case "round":
        return `Math.round(${a(0)})`;
      case "array_push":
        return `(${a(0)} as unknown[]).push(${args.slice(1).join(", ")})`;
      case "array_pop":
        return `(${a(0)} as unknown[]).pop()`;
      case "array_shift":
        return `(${a(0)} as unknown[]).shift()`;
      case "array_slice":
        return `(${a(0)} as unknown[]).slice(${args.slice(1).join(", ")})`;
      case "array_reverse":
        return `[...(${a(0)} as unknown[])].reverse()`;
      case "array_search": {
        warnings.push(`array_search() at line ${expr.pos.line} returns false when not found (PHP) but -1 in TypeScript; check for -1, not false.`);
        return `(${a(1)} as unknown[]).indexOf(${a(0)})`;
      }
      case "sort":
        return `(${a(0)} as unknown[]).sort()`;
      case "rsort":
        return `(${a(0)} as unknown[]).sort().reverse()`;
      case "htmlspecialchars":
      case "htmlentities":
        helpersUsed.add("__escHtml");
        return `__escHtml(String(${a(0)}))`;
      case "defined":
        // Only the ABSPATH guard is handled (in emitIf); anything else is unmapped.
        return null;
      default:
        return null;
    }
  };

  // -- statement emission --------------------------------------------------
  const emitStmtList = (stmts: StmtNode[], ctx: EmitContext): string => {
    const out: string[] = [];
    for (const stmt of stmts) {
      const text = emitStmt(stmt, ctx);
      if (text !== "") out.push(text);
    }
    return out.join("\n");
  };

  const emitStmt = (stmt: StmtNode, ctx: EmitContext): string => {
    const pad = indent(ctx.depth);
    switch (stmt.kind) {
      case "block": {
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        return `${pad}{\n${emitStmtList(stmt.body, sub)}\n${pad}}`;
      }
      case "expr_stmt": {
        // Assignment statements: emit without the wrapping parens.
        if (stmt.expr.kind === "assign") {
          const assigned = emitAssign(stmt.expr, ctx);
          const inner = assigned.startsWith("(") && assigned.endsWith(")") ? assigned.slice(1, -1) : assigned;
          return `${pad}${inner};`;
        }
        // printf() prints: in an output-collecting function its result
        // goes to the buffer (a bare sprintf() call still discards it,
        // exactly like PHP).
        if (
          stmt.expr.kind === "call" &&
          stmt.expr.name !== null &&
          stmt.expr.name.toLowerCase() === "printf"
        ) {
          if (ctx.inFunction) return `${pad}__out += ${emitExpr(stmt.expr, ctx)};`;
          return `${pad}renderedOutput.push(${emitExpr(stmt.expr, ctx)});`;
        }
        return `${pad}${emitExpr(stmt.expr, ctx)};`;
      }
      case "return": {
        if (stmt.value === null) return `${pad}return;`;
        return `${pad}return ${emitExpr(stmt.value, ctx)};`;
      }
      case "echo": {
        if (ctx.inFunction) {
          return stmt.values.map((v) => `${pad}__out += ${emitExpr(v, ctx)};`).join("\n");
        }
        return stmt.values.map((v) => `${pad}renderedOutput.push(${emitExpr(v, ctx)});`).join("\n");
      }
      case "if":
        return emitIf(stmt, ctx);
      case "foreach": {
        const iter = emitExpr(stmt.iterable, ctx);
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        const body = emitStmtList(stmt.body, sub);
        // The loop variables are pre-declared with `let` at the top of the
        // function (PHP variables are function-scoped), so no `const` here.
        if (stmt.keyVar !== null) {
          warnings.push(
            `foreach with key at line ${stmt.pos.line}: keys are strings in the TypeScript translation (Object.entries); PHP integer keys become strings.`,
          );
          return `${pad}for ([${stmt.keyVar}, ${stmt.valueVar}] of Object.entries(${iter} as Record<string, unknown>)) {\n${body}\n${pad}}`;
        }
        return `${pad}for (${stmt.valueVar} of (${iter} as unknown[])) {\n${body}\n${pad}}`;
      }
      case "for": {
        const init = stmt.init === null ? "" : emitAssignOrExpr(stmt.init, ctx);
        const test = stmt.test === null ? "" : emitExpr(stmt.test, ctx);
        const update = stmt.update === null ? "" : emitExpr(stmt.update, ctx);
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        const body = emitStmtList(stmt.body, sub);
        return `${pad}for (${init}; ${test}; ${update}) {\n${body}\n${pad}}`;
      }
      case "while": {
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        const body = emitStmtList(stmt.body, sub);
        return `${pad}while (${emitExpr(stmt.test, ctx)}) {\n${body}\n${pad}}`;
      }
      case "do_while": {
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        const body = emitStmtList(stmt.body, sub);
        return `${pad}do {\n${body}\n${pad}} while (${emitExpr(stmt.test, ctx)});`;
      }
      case "static_var": {
        // Declared at module level (see moduleStatics); nothing to emit here.
        return "";
      }
      case "require": {
        if (stmt.literalPath !== null) {
          noteUnconverted("require/include", `Literal ${stmt.mode} of "${stmt.literalPath}" is not translated: converted extensions are single modules; move the included code into this file.`, stmt.pos.line, stmt.mode);
          return `${pad}/* NOT CONVERTED (line ${stmt.pos.line}): ${stmt.mode} "${stmt.literalPath}" — see conversion report. */`;
        }
        noteUnconverted("require/include", `${stmt.mode} with a non-literal path was blocked by the safety scan.`, stmt.pos.line, stmt.mode);
        return `${pad}/* NOT CONVERTED (line ${stmt.pos.line}): dynamic ${stmt.mode} — blocked by the sandbox. */`;
      }
      case "inline_html": {
        if (ctx.inFunction) {
          return `${pad}__out += ${JSON.stringify(stmt.text)};`;
        }
        return `${pad}renderedOutput.push(${JSON.stringify(stmt.text)});`;
      }
      case "unsupported": {
        noteUnconverted(stmt.label, stmt.reason, stmt.pos.line);
        return `${pad}/* NOT CONVERTED (line ${stmt.pos.line}): ${stmt.label} — ${stmt.reason} */`;
      }
      case "break":
        return `${pad}break;`;
      case "continue":
        return `${pad}continue;`;
      case "global": {
        noteUnconverted("global", `global $${stmt.names.join(", $")} has no equivalent: Wordless functions receive state through parameters and the wp API.`, stmt.pos.line);
        return `${pad}/* NOT CONVERTED (line ${stmt.pos.line}): global $${stmt.names.join(", $")} — see conversion report. */`;
      }
      case "const_decl": {
        return `${pad}const ${toTsName(stmt.name)} = ${emitExpr(stmt.value, ctx)};`;
      }
      case "switch": {
        noteUnconverted("switch", "switch statements are not translated yet (PHP loose comparison differs from TypeScript); rewrite as if/else.", stmt.pos.line);
        return `${pad}/* NOT CONVERTED (line ${stmt.pos.line}): switch — rewrite as if/else. See conversion report. */`;
      }
      case "try": {
        const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
        let out = `${pad}try {\n${emitStmtList(stmt.body, sub)}\n${pad}}`;
        for (const c of stmt.catches) {
          out += ` catch {\n${emitStmtList(c.body, sub)}\n${pad}}`;
        }
        if (stmt.finallyBody !== null) {
          out += ` finally {\n${emitStmtList(stmt.finallyBody, sub)}\n${pad}}`;
        }
        return out;
      }
      case "function":
      case "class":
        // Top-level functions/classes are emitted as module members, not inline.
        return "";
      default:
        return "";
    }
  };

  const emitAssignOrExpr = (expr: ExprNode, ctx: EmitContext): string => {
    if (expr.kind === "assign") {
      const assigned = emitAssign(expr, ctx);
      return assigned.startsWith("(") && assigned.endsWith(")") ? assigned.slice(1, -1) : assigned;
    }
    return emitExpr(expr, ctx);
  };

  /** The `if (!defined('ABSPATH')) { exit; }` guard is a known idiom: drop it with a note. */
  const isAbpsathGuard = (stmt: Extract<StmtNode, { kind: "if" }>): boolean => {
    const test = stmt.test;
    if (test.kind !== "unary" || test.operator !== "!") return false;
    const inner = test.operand;
    if (inner.kind !== "call" || inner.name?.toLowerCase() !== "defined") return false;
    const arg = inner.args[0];
    if (arg === undefined || arg.kind !== "literal" || arg.literalKind !== "string") return false;
    if (String(arg.value) !== "ABSPATH") return false;
    // The body must be only exit/die (parsed as unsupported statements).
    return stmt.consequent.every((s) => s.kind === "unsupported" && (s.label === "exit()" || s.label === "die()"));
  };

  const emitIf = (stmt: Extract<StmtNode, { kind: "if" }>, ctx: EmitContext): string => {
    const pad = indent(ctx.depth);
    if (isAbpsathGuard(stmt)) {
      transformed.push({
        what: "ABSPATH guard",
        note: `Line ${stmt.pos.line}: "if (!defined('ABSPATH')) { exit; }" was removed — Wordless extensions are never loaded directly, so the guard has no meaning here.`,
      });
      return `${pad}// Wordless: the ABSPATH direct-access guard (line ${stmt.pos.line}) is not needed — extensions load only through the extension API.`;
    }
    const sub: EmitContext = { ...ctx, depth: ctx.depth + 1 };
    let out = `${pad}if (${emitExpr(stmt.test, ctx)}) {\n${emitStmtList(stmt.consequent, sub)}\n${pad}}`;
    const alt = stmt.alternate;
    if (alt !== null) {
      if (Array.isArray(alt)) {
        out += ` else {\n${emitStmtList(alt, sub)}\n${pad}}`;
      } else {
        // else-if chain: emit the nested if directly after "else".
        const nested = emitIf(alt, ctx);
        out += ` else ${nested.slice(pad.length)}`;
      }
    }
    return out;
  };

  // -- function emission ---------------------------------------------------
  const emitFunction = (info: FunctionInfo): string => {
    const node = info.node;
    const declaredVars = new Set<string>();
    collectAssignedVars(node.body, declaredVars);
    // Params and foreach variables are declared by their own syntax.
    for (const p of node.params) declaredVars.delete(p.name);
    // Function-local `static` variables persist across calls in PHP, so
    // they are hoisted to module-level lets and every reference is renamed.
    const renameVars = new Map<string, string>();
    const collectStatics = (n: AstNode | ProgramNode): void => {
      if (n.kind === "static_var") {
        for (const v of n.vars) {
          const hoisted = `__static_${info.tsName}_${v.name}`;
          renameVars.set(v.name, hoisted);
          moduleStatics.push({ fnName: info.tsName, varName: v.name, init: v.value });
          declaredVars.delete(v.name);
        }
      }
      for (const k of childNodes(n)) collectStatics(k);
    };
    collectStatics(node);
    const ctx: EmitContext = {
      declaredVars,
      inFunction: true,
      currentFunction: info,
      depth: 1,
      renameVars,
    };
    const params = node.params.map((p) => emitParam(p)).join(", ");
    const asyncPrefix = info.isAsync ? "async " : "";
    let returnType = "";
    if (info.isAsync) {
      returnType = info.returnsOutput || info.hasReturnValue ? ": Promise<string>" : ": Promise<void>";
    } else if (info.returnsOutput) {
      returnType = ": string";
    } else if (!info.hasReturnValue) {
      returnType = ": void";
    }
    const out: string[] = [];
    out.push(`export ${asyncPrefix}function ${info.tsName}(wp: WordPressApi${params.length > 0 ? `, ${params}` : ""})${returnType} {`);
    if (info.returnsOutput) out.push(`  let __out = "";`);
    // PHP variables are untyped and function-scoped: pre-declare every
    // assigned name as an evolving `let` (no annotation — an explicit
    // `: unknown` would make every later use a type error).
    for (const name of [...declaredVars].sort()) {
      out.push(`  let ${name};`);
    }
    const body = emitStmtList(node.body, ctx);
    if (body !== "") out.push(body);
    if (info.returnsOutput) {
      const lastIsReturn = node.body.length > 0 && node.body[node.body.length - 1]?.kind === "return";
      if (!lastIsReturn) out.push(`  return __out;`);
      else if (info.hasReturnValue) {
        warnings.push(
          `Function ${info.phpName}() both echoes output and returns a value; the echoed output is discarded and only the returned value is used.`,
        );
      }
    }
    out.push(`}`);
    return out.join("\n");
  };

  // ------------------------------------------------------------ assemble
  const functionBlocks: string[] = [];
  for (const info of functions.values()) {
    functionBlocks.push(emitFunction(info));
  }

  // Top-level statements that are not functions/classes/hooks become
  // module-level code (rare; usually only stray echo/inline HTML).
  const topLevelCode: string[] = [];
  for (const stmt of topLevelStmts) {
    if (stmt.kind === "expr_stmt") {
      const expr = stmt.expr;
      if (expr.kind === "call" && (expr.name === "add_action" || expr.name === "add_filter")) continue;
    }
    const ctx: EmitContext = { declaredVars: new Set(), inFunction: false, currentFunction: null, depth: 0 };
    if (stmt.kind === "class") continue;
    const text = emitStmt(stmt, ctx);
    if (text !== "") topLevelCode.push(text);
  }

  for (const cls of classDecls) {
    noteUnconverted(
      "class declaration",
      `Class ${cls.name} (${cls.methods.length} method${cls.methods.length === 1 ? "" : "s"}${cls.extendsName !== null ? `, extends ${cls.extendsName}` : ""}) is analysed but not converted: Wordless has no class runtime yet.`,
      cls.pos.line,
      cls.name,
    );
    // Say so in the generated module too, so a reader of the output sees
    // the gap without opening the report.
    topLevelCode.push(
      `/* NOT CONVERTED (line ${cls.pos.line}): class ${cls.name} — analysed but not converted; Wordless has no class runtime yet. See the conversion report. */`,
    );
  }

  // Hook wrappers for activate(): action callbacks that produce output
  // have their output captured in renderedOutput (the admin renderer
  // displays it); filter callbacks pass the value through.
  const needsRenderedOutput =
    hookRegs.some((h) => {
      const info = functions.get(h.functionName);
      return h.kind === "action" && info !== undefined && info.returnsOutput;
    }) || topLevelCode.some((c) => c.includes("renderedOutput.push"));

  const activateLines: string[] = [];
  activateLines.push(`/** Register this extension's hooks with the Wordless kernel. */`);
  activateLines.push(`export function activate(wp: WordPressApi): void {`);
  if (hookRegs.length === 0) {
    activateLines.push(`  // No hooks registered: this file declares no add_action/add_filter calls.`);
  }
  for (const reg of hookRegs) {
    const info = functions.get(reg.functionName);
    const tsName = info?.tsName ?? toTsName(reg.functionName);
    const prio = reg.priority !== 10 ? `, ${reg.priority}` : "";
    if (reg.kind === "action") {
      if (info !== undefined && info.returnsOutput) {
        if (info.isAsync) {
          warnings.push(
            `Async action callback ${reg.functionName}() on "${reg.tag}": the hook system is synchronous, so its output cannot be captured — the callback runs but its output is discarded.`,
          );
          activateLines.push(`  wp.add_action("${reg.tag}", () => { void ${tsName}(wp); }${prio});`);
        } else {
          activateLines.push(`  wp.add_action("${reg.tag}", () => { renderedOutput.push(${tsName}(wp)); }${prio});`);
        }
      } else if (info !== undefined && info.isAsync) {
        activateLines.push(`  wp.add_action("${reg.tag}", (...hookArgs: unknown[]) => { void ${tsName}(wp, ...hookArgs); }${prio});`);
      } else {
        activateLines.push(`  wp.add_action("${reg.tag}", (...hookArgs: unknown[]) => ${tsName}(wp, ...hookArgs)${prio});`);
      }
    } else {
      // Filter: first hook arg is the filtered value.
      activateLines.push(
        `  wp.add_filter("${reg.tag}", (value: unknown, ...hookArgs: unknown[]) => ${tsName}(wp, value, ...hookArgs)${prio});`,
      );
    }
  }
  activateLines.push(`}`);

  if (needsRenderedOutput) {
    lines.push(`/** Output captured from action callbacks (admin notices, head output). */`);
    lines.push(`export const renderedOutput: string[] = [];`);
    lines.push(``);
  }
  if (moduleStatics.length > 0) {
    // Function-local static variables, hoisted so they persist across calls
    // exactly as PHP statics do.
    lines.push(`/** Function-local static variables, hoisted to module level (PHP statics persist across calls). */`);
    const staticCtx: EmitContext = { declaredVars: new Set(), inFunction: false, currentFunction: null, depth: 0 };
    for (const s of moduleStatics) {
      const init = s.init ? emitExpr(s.init, staticCtx) : "null";
      lines.push(`let __static_${s.fnName}_${s.varName} = ${init};`);
    }
    lines.push(``);
  }
  if (functionBlocks.length > 0) {
    lines.push(...functionBlocks);
    lines.push(``);
  }
  if (topLevelCode.length > 0) {
    lines.push(`// Top-level statements and unconverted declarations from the source file.`);
    lines.push(...topLevelCode);
    lines.push(``);
  }
  lines.push(...activateLines);
  lines.push(``);

  // Extension manifest (from the plugin header when present).
  lines.push(`export const extensionMeta = {`);
  lines.push(`  slug: ${JSON.stringify(options.slug)},`);
  lines.push(`  name: ${JSON.stringify(extName)},`);
  lines.push(`  version: ${JSON.stringify(extVersion)},`);
  if (extAuthor !== "") lines.push(`  author: ${JSON.stringify(extAuthor)},`);
  if (extDescription !== "") lines.push(`  description: ${JSON.stringify(extDescription)},`);
  lines.push(`  sourceFile: ${JSON.stringify(options.filename)},`);
  lines.push(`  generatedBy: "wordless-conversion-m4",`);
  lines.push(`} as const;`);

  // Helpers (only the ones actually used).
  const helperBlocks: string[] = [];
  if (helpersUsed.has("__sprintf")) {
    helperBlocks.push([
      `/** Minimal sprintf: %s %d %f %x %X %c and %% (enough for converted plugins). */`,
      `function __sprintf(format: string, ...args: unknown[]): string {`,
      `  let i = 0;`,
      `  return format.replace(/%([%bcdeEfFgGosuxX])/g, (_m: string, spec: string) => {`,
      `    if (spec === "%") return "%";`,
      `    const arg = args[i++];`,
      `    if (arg === undefined) return "";`,
      `    if (spec === "d" || spec === "i" || spec === "u") return String(Math.trunc(Number(arg)));`,
      `    if (spec === "f" || spec === "e" || spec === "E" || spec === "g" || spec === "G") return String(Number(arg));`,
      `    if (spec === "x") return Number(arg).toString(16);`,
      `    if (spec === "X") return Number(arg).toString(16).toUpperCase();`,
      `    if (spec === "c") return String.fromCharCode(Number(arg));`,
      `    return String(arg);`,
      `  });`,
      `}`,
    ].join("\n"));
  }
  if (helpersUsed.has("__rand")) {
    helperBlocks.push(
      `/** mt_rand($min, $max): inclusive random integer. */\nfunction __rand(min: number, max: number): number {\n  return Math.floor(Math.random() * (max - min + 1)) + min;\n}`,
    );
  }
  if (helpersUsed.has("__substr")) {
    helperBlocks.push([
      `/** PHP substr() semantics (negative start/length count from the end). */`,
      `function __substr(value: string, start: number, length?: number): string {`,
      `  const str = String(value);`,
      `  const len = str.length;`,
      `  const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);`,
      `  if (length === undefined) return str.slice(s);`,
      `  if (length < 0) return str.slice(s, Math.max(len + length, s));`,
      `  return str.slice(s, s + length);`,
      `}`,
    ].join("\n"));
  }
  if (helpersUsed.has("__escHtml")) {
    helperBlocks.push(
      `/** htmlspecialchars(): escape HTML special characters. */\nfunction __escHtml(value: string): string {\n  return value\n    .replace(/&/g, "&amp;")\n    .replace(/</g, "&lt;")\n    .replace(/>/g, "&gt;")\n    .replace(/"/g, "&quot;")\n    .replace(/'/g, "&#39;");\n}`,
    );
  }
  if (helpersUsed.has("__unsupported")) {
    helperBlocks.push(
      `/** A PHP construct the converter could not translate. Throws if reached. */\nfunction __unsupported(reason: string): never {\n  throw new Error("Unconverted PHP construct: " + reason);\n}`,
    );
  }
  for (const helper of [...unmappedHelpers].sort()) {
    const fnName = helper.replace(/^__unmapped_/, "");
    helperBlocks.push(
      `/** ${fnName}() has no Wordless mapping yet — see the conversion report. */\nfunction ${helper}(...args: unknown[]): unknown {\n  void args;\n  throw new Error("Unmapped function ${fnName}() — this converted extension needs manual work (see the conversion report).");\n}`,
    );
  }
  if (helperBlocks.length > 0) {
    lines.push(``);
    lines.push(...helperBlocks);
  }

  const report: EmitReport = {
    functions: [...functions.values()].map((f) => f.phpName),
    asyncFunctions: [...functions.values()].filter((f) => f.isAsync).map((f) => f.phpName),
    hooks: hookRegs,
    unconverted,
    warnings,
    transformed,
    helpersUsed: [...helpersUsed].sort(),
  };

  return { code: lines.join("\n") + "\n", report };
}
