/**
 * WordPress conversion engine (Milestone 4) — PHP AST node types.
 *
 * The converter is static analysis only: it NEVER executes PHP (no PHP is
 * installed anywhere in this pipeline) and NEVER executes converted code at
 * conversion time. Every node carries its source position so reports can
 * point at the exact line a construct came from. Constructs the emitter
 * cannot translate are kept as `unsupported` nodes with a reason — they
 * are never silently dropped or guessed.
 */

export interface SourcePos {
  line: number;
  column: number;
  offset: number;
}

export interface ParamNode {
  kind: "param";
  name: string;
  type: string | null;
  defaultValue: ExprNode | null;
  byRef: boolean;
  variadic: boolean;
  pos: SourcePos;
}

export interface FunctionDeclNode {
  kind: "function";
  name: string;
  params: ParamNode[];
  returnType: string | null;
  body: StmtNode[];
  docblock: string | null;
  pos: SourcePos;
}

export interface MethodDeclNode {
  kind: "method";
  name: string;
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
  params: ParamNode[];
  body: StmtNode[];
  pos: SourcePos;
}

export interface ClassDeclNode {
  kind: "class";
  name: string;
  extendsName: string | null;
  implementsNames: string[];
  methods: MethodDeclNode[];
  properties: string[];
  pos: SourcePos;
}

export interface BlockNode {
  kind: "block";
  body: StmtNode[];
  pos: SourcePos;
}

export interface ExprStmtNode {
  kind: "expr_stmt";
  expr: ExprNode;
  pos: SourcePos;
}

export interface ReturnNode {
  kind: "return";
  value: ExprNode | null;
  pos: SourcePos;
}

export interface EchoNode {
  kind: "echo";
  values: ExprNode[];
  pos: SourcePos;
}

export interface IfNode {
  kind: "if";
  test: ExprNode;
  consequent: StmtNode[];
  alternate: StmtNode[] | IfNode | null;
  /** True when the source used the template alternative syntax (if …: … endif;). */
  altSyntax?: boolean;
  pos: SourcePos;
}

export interface ForeachNode {
  kind: "foreach";
  iterable: ExprNode;
  keyVar: string | null;
  valueVar: string;
  body: StmtNode[];
  altSyntax?: boolean;
  pos: SourcePos;
}

export interface ForNode {
  kind: "for";
  init: ExprNode | null;
  test: ExprNode | null;
  update: ExprNode | null;
  body: StmtNode[];
  altSyntax?: boolean;
  pos: SourcePos;
}

export interface WhileNode {
  kind: "while";
  test: ExprNode;
  body: StmtNode[];
  altSyntax?: boolean;
  pos: SourcePos;
}

export interface RequireNode {
  kind: "require";
  /** "require" | "include" | "require_once" | "include_once" */
  mode: string;
  /** Literal path when the argument is a string literal, otherwise null. */
  literalPath: string | null;
  arg: ExprNode;
  pos: SourcePos;
}

export interface InlineHtmlNode {
  kind: "inline_html";
  text: string;
  pos: SourcePos;
}

export interface UnsupportedStmtNode {
  kind: "unsupported";
  /** Short label, e.g. "class declaration", "switch", "global". */
  label: string;
  reason: string;
  /** Raw source of the construct when it was captured, for the report. */
  source: string;
  pos: SourcePos;
}

export interface BreakNode {
  kind: "break";
  pos: SourcePos;
}

export interface StaticVarNode {
  kind: "static_var";
  /** Function-local static variables (persist across calls in PHP). */
  vars: { name: string; value: ExprNode | null }[];
  pos: SourcePos;
}

export interface DoWhileNode {
  kind: "do_while";
  body: StmtNode[];
  test: ExprNode;
  pos: SourcePos;
}

export interface ContinueNode {
  kind: "continue";
  pos: SourcePos;
}

export interface GlobalNode {
  kind: "global";
  names: string[];
  pos: SourcePos;
}

export interface ConstDeclNode {
  kind: "const_decl";
  name: string;
  value: ExprNode;
  pos: SourcePos;
}

export interface SwitchNode {
  kind: "switch";
  discriminant: ExprNode;
  altSyntax?: boolean;
  /** Raw source of the whole switch body — parsed loosely, not converted. */
  source: string;
  pos: SourcePos;
}

export interface TryNode {
  kind: "try";
  body: StmtNode[];
  catches: { varName: string | null; body: StmtNode[] }[];
  finallyBody: StmtNode[] | null;
  pos: SourcePos;
}

export type StmtNode =
  | FunctionDeclNode
  | ClassDeclNode
  | BlockNode
  | ExprStmtNode
  | ReturnNode
  | EchoNode
  | IfNode
  | ForeachNode
  | ForNode
  | WhileNode
  | RequireNode
  | InlineHtmlNode
  | UnsupportedStmtNode
  | BreakNode
  | ContinueNode
  | GlobalNode
  | ConstDeclNode
  | SwitchNode
  | TryNode
  | StaticVarNode
  | DoWhileNode;

export interface LiteralNode {
  kind: "literal";
  /** "string" | "number" | "bool" | "null" */
  literalKind: string;
  value: string | number | boolean | null;
  pos: SourcePos;
}

export interface VarNode {
  kind: "var";
  /** Name without the leading `$` ("this" for $this). */
  name: string;
  pos: SourcePos;
}

export interface ArrayEntry {
  key: ExprNode | null;
  value: ExprNode;
}

export interface ArrayNode {
  kind: "array";
  entries: ArrayEntry[];
  pos: SourcePos;
}

export interface ArrayAccessNode {
  kind: "array_access";
  object: ExprNode;
  index: ExprNode | null;
  /** `$arr[] = $v` (append) — only meaningful as an assignment target. */
  append: boolean;
  pos: SourcePos;
}

export interface BinaryNode {
  kind: "binary";
  operator: string;
  left: ExprNode;
  right: ExprNode;
  pos: SourcePos;
}

export interface UnaryNode {
  kind: "unary";
  operator: string;
  operand: ExprNode;
  prefix: boolean;
  pos: SourcePos;
}

export interface TernaryNode {
  kind: "ternary";
  test: ExprNode;
  consequent: ExprNode | null;
  alternate: ExprNode;
  pos: SourcePos;
}

export interface CallNode {
  kind: "call";
  /** Plain function name, or null for a dynamic call ($fn()). */
  name: string | null;
  callee: ExprNode | null;
  args: ExprNode[];
  pos: SourcePos;
}

export interface MethodCallNode {
  kind: "method_call";
  object: ExprNode;
  method: string;
  args: ExprNode[];
  pos: SourcePos;
}

export interface StaticCallNode {
  kind: "static_call";
  className: string;
  member: string;
  args: ExprNode[];
  /** True for Class::CONSTANT (no call parens). */
  isConstant: boolean;
  pos: SourcePos;
}

export interface PropertyFetchNode {
  kind: "property_fetch";
  object: ExprNode;
  property: string;
  pos: SourcePos;
}

export interface ConstFetchNode {
  kind: "const_fetch";
  name: string;
  pos: SourcePos;
}

export interface NewNode {
  kind: "new";
  className: string;
  args: ExprNode[];
  pos: SourcePos;
}

export interface ClosureNode {
  kind: "closure";
  params: ParamNode[];
  uses: string[];
  body: StmtNode[];
  pos: SourcePos;
}

export interface InterpolatedNode {
  kind: "interpolated_string";
  parts: { kind: "text" | "var"; value: string }[];
  pos: SourcePos;
}

export interface AssignNode {
  kind: "assign";
  operator: string;
  target: ExprNode;
  value: ExprNode;
  pos: SourcePos;
}

/** A cast expression: (int) $x, (string) $y, … */
export interface CastNode {
  kind: "cast";
  /** "int" | "float" | "string" | "bool" | "array" | "object" | "unset" */
  castType: string;
  operand: ExprNode;
  pos: SourcePos;
}

export interface UnsupportedExprNode {
  kind: "unsupported_expr";
  label: string;
  reason: string;
  source: string;
  pos: SourcePos;
}

export type ExprNode =
  | LiteralNode
  | VarNode
  | ArrayNode
  | ArrayAccessNode
  | BinaryNode
  | UnaryNode
  | TernaryNode
  | CallNode
  | MethodCallNode
  | StaticCallNode
  | PropertyFetchNode
  | ConstFetchNode
  | NewNode
  | ClosureNode
  | InterpolatedNode
  | AssignNode
  | CastNode
  | UnsupportedExprNode;

export type AstNode = StmtNode | ExprNode | ParamNode | MethodDeclNode;

export interface ProgramNode {
  kind: "program";
  body: StmtNode[];
  pos: SourcePos;
}

/** Child nodes of any node, for walkers (counts, analysis, safety). */
export function childNodes(node: AstNode | ProgramNode): (AstNode | ProgramNode)[] {
  switch (node.kind) {
    case "program":
      return node.body;
    case "function":
      return [...node.params.flatMap((p) => (p.defaultValue ? [p.defaultValue] : [])), ...node.body];
    case "method":
      return [...node.params.flatMap((p) => (p.defaultValue ? [p.defaultValue] : [])), ...node.body];
    case "param":
      return node.defaultValue ? [node.defaultValue] : [];
    case "class":
      return node.methods;
    case "block":
      return node.body;
    case "expr_stmt":
      return [node.expr];
    case "return":
      return node.value ? [node.value] : [];
    case "echo":
      return node.values;
    case "if": {
      const alt: (AstNode | ProgramNode)[] =
        node.alternate === null
          ? []
          : Array.isArray(node.alternate)
            ? node.alternate
            : [node.alternate];
      return [node.test, ...node.consequent, ...alt];
    }
    case "foreach":
      return [node.iterable, ...node.body];
    case "for":
      return [
        ...(node.init ? [node.init] : []),
        ...(node.test ? [node.test] : []),
        ...(node.update ? [node.update] : []),
        ...node.body,
      ];
    case "while":
      return [node.test, ...node.body];
    case "require":
      return [node.arg];
    case "try":
      return [
        ...node.body,
        ...node.catches.flatMap((c) => c.body),
        ...(node.finallyBody ?? []),
      ];
    case "static_var":
      return node.vars.flatMap((v) => (v.value ? [v.value] : []));
    case "do_while":
      return [...node.body, node.test];
    case "cast":
      return [node.operand];
    case "const_decl":
      return [node.value];
    case "array":
      return node.entries.flatMap((e) => (e.key ? [e.key, e.value] : [e.value]));
    case "array_access":
      return node.index ? [node.object, node.index] : [node.object];
    case "binary":
      return [node.left, node.right];
    case "unary":
      return [node.operand];
    case "ternary":
      return node.consequent
        ? [node.test, node.consequent, node.alternate]
        : [node.test, node.alternate];
    case "call":
      return [...(node.callee ? [node.callee] : []), ...node.args];
    case "method_call":
      return [node.object, ...node.args];
    case "static_call":
      return node.args;
    case "property_fetch":
      return [node.object];
    case "new":
      return node.args;
    case "closure":
      return [
        ...node.params.flatMap((p) => (p.defaultValue ? [p.defaultValue] : [])),
        ...node.body,
      ];
    case "interpolated_string":
      return [];
    case "assign":
      return [node.target, node.value];
    default:
      return [];
  }
}

/** Depth-first walk of a program, invoking `visit` for every node. */
export function walkAst(
  program: ProgramNode,
  visit: (node: AstNode | ProgramNode) => void,
): void {
  const stack: (AstNode | ProgramNode)[] = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    visit(node);
    const kids = childNodes(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (kid !== undefined) stack.push(kid);
    }
  }
}

/** Total AST node count (program node itself excluded). */
export function countAstNodes(program: ProgramNode): number {
  let count = 0;
  walkAst(program, (node) => {
    if (node.kind !== "program") count += 1;
  });
  return count;
}
