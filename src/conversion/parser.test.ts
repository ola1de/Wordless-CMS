import { describe, expect, it } from "vitest";
import { parsePhp, parsePluginHeader } from "./parser";
import { countAstNodes, walkAst } from "./ast";

describe("PHP parser (M4)", () => {
  it("parses functions, echo, return and add_action calls", () => {
    const src = `<?php
function hello_dolly() {
  $chosen = hello_dolly_get_lyric();
  printf('<p>%s</p>', $chosen);
}
add_action('admin_notices', 'hello_dolly');
`;
    const { program } = parsePhp(src);
    const functions: string[] = [];
    const calls: string[] = [];
    walkAst(program, (n) => {
      if (n.kind === "function") functions.push(n.name);
      if (n.kind === "call" && n.name !== null) calls.push(n.name);
    });
    expect(functions).toEqual(["hello_dolly"]);
    expect(calls).toContain("hello_dolly_get_lyric");
    expect(calls).toContain("printf");
    expect(calls).toContain("add_action");
    expect(countAstNodes(program)).toBeGreaterThan(10);
  });

  it("parses if/elseif/else, foreach with key=>value, and ternary", () => {
    const src = `<?php
if ($a === 1) {
  $b = 2;
} elseif ($a === 3) {
  $b = 4;
} else {
  $b = 5;
}
foreach ($items as $key => $item) {
  $total += $item;
}
$x = $a > 0 ? 'yes' : 'no';
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("if");
    expect(kinds).toContain("foreach");
    expect(kinds).toContain("ternary");
    const foreachNode = program.body.find((s) => s.kind === "foreach");
    expect(foreachNode).toBeDefined();
    if (foreachNode?.kind === "foreach") {
      expect(foreachNode.keyVar).toBe("key");
      expect(foreachNode.valueVar).toBe("item");
    }
  });

  it("parses arrays (array() and []), concatenation and array access", () => {
    const src = `<?php
$a = array('x' => 1, 'y' => 2);
$b = [1, 2, 3];
$c = $b[0] . $a['x'];
$d = $b[] = 4;
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds.filter((k) => k === "array")).toHaveLength(2);
    expect(kinds).toContain("binary");
    expect(kinds).toContain("array_access");
  });

  it("records class declarations with methods (analysed, not converted)", () => {
    const src = `<?php
class Akismet {
  public static function check($comment) {
    return true;
  }
  private $key;
}
`;
    const { program } = parsePhp(src);
    const cls = program.body.find((s) => s.kind === "class");
    expect(cls).toBeDefined();
    if (cls?.kind === "class") {
      expect(cls.name).toBe("Akismet");
      expect(cls.methods).toHaveLength(1);
      expect(cls.methods[0]?.name).toBe("check");
      expect(cls.methods[0]?.visibility).toBe("public");
      expect(cls.methods[0]?.isStatic).toBe(true);
    }
  });

  it("parses require of a literal path and keeps the literal", () => {
    const { program } = parsePhp(`<?php require_once __DIR__ . '/inc.php'; require 'lib.php';`);
    const reqs = program.body.filter((s) => s.kind === "require");
    expect(reqs).toHaveLength(2);
    if (reqs[1]?.kind === "require") {
      expect(reqs[1].literalPath).toBe("lib.php");
    }
    // __DIR__ . '/inc.php' is not a literal path.
    if (reqs[0]?.kind === "require") {
      expect(reqs[0].literalPath).toBeNull();
    }
  });

  it("parses inline HTML as its own node", () => {
    const { program } = parsePhp(`<?php if ($a) { ?><p>yes</p><?php } ?>`);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("inline_html");
  });

  it("extracts the plugin header from the leading comment", () => {
    const src = `<?php
/*
Plugin Name: Hello Dolly
Version: 1.7.2
Author: Matt Mullenweg
Description: A lyric plugin.
*/
function hello_dolly() {}
`;
    const { comments } = parsePhp(src);
    const header = parsePluginHeader(comments);
    expect(header["Plugin Name"]).toBe("Hello Dolly");
    expect(header["Version"]).toBe("1.7.2");
    expect(header["Author"]).toBe("Matt Mullenweg");
  });

  it("throws a ParseError with a line number on broken syntax", () => {
    expect(() => parsePhp(`<?php function broken( {`)).toThrow(/line \d+/);
  });

  it("parses the ABSPATH guard as an if with a defined() test", () => {
    const { program } = parsePhp(`<?php
if ( ! defined( 'ABSPATH' ) ) {
  exit;
}
`);
    const ifNode = program.body.find((s) => s.kind === "if");
    expect(ifNode).toBeDefined();
    if (ifNode?.kind === "if") {
      expect(ifNode.test.kind).toBe("unary");
    }
  });

  it("parses closures, try/catch and switch as nodes (not errors)", () => {
    const src = `<?php
$f = function ($x) use ($y) { return $x + $y; };
try { foo(); } catch (Exception $e) { bar(); }
switch ($a) { case 1: break; default: break; }
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("closure");
    expect(kinds).toContain("try");
    expect(kinds).toContain("switch");
  });

  it("parses casts, the spaceship operator and qualified names", () => {
    const src = `<?php
$a = (int) $_POST['n'];
$b = (float) $x <=> (float) $y;
WP_CLI\\Utils\\format_items('table', $rows, $keys);
$c = \\esc_html($s);
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    const calls: string[] = [];
    walkAst(program, (n) => {
      kinds.push(n.kind);
      if (n.kind === "call" && n.name !== null) calls.push(n.name);
    });
    expect(kinds).toContain("cast");
    expect(kinds.filter((k) => k === "cast")).toHaveLength(3);
    expect(calls).toContain("WP_CLI\\Utils\\format_items");
    expect(calls).toContain("\\esc_html");
  });

  it("parses nullable/array parameter types and constructor promotion", () => {
    const src = `<?php
function f(?array $input = null, array $plugins = array()) { return $input; }
class C { public function __construct(private string $key) {} }
`;
    const { program } = parsePhp(src);
    const fns: string[] = [];
    walkAst(program, (n) => {
      if (n.kind === "function") fns.push(n.name);
    });
    expect(fns).toContain("f");
    expect(program.body.some((s) => s.kind === "class")).toBe(true);
  });

  it("parses abstract methods (no body) and static:: calls", () => {
    const src = `<?php
abstract class A {
  abstract protected function get_name(): string;
  public function go() { static::purge_cache(); }
}
`;
    const { program } = parsePhp(src);
    const cls = program.body.find((s) => s.kind === "class");
    expect(cls?.kind).toBe("class");
    if (cls?.kind === "class") {
      expect(cls.methods).toHaveLength(2);
      expect(cls.methods[0]?.body).toEqual([]);
    }
    const calls: string[] = [];
    walkAst(program, (n) => {
      if (n.kind === "static_call") calls.push(n.member);
    });
    expect(calls).toContain("purge_cache");
  });

  it("parses static local variables and do/while loops", () => {
    const src = `<?php
function memo() {
  static $cache = null;
  if (is_null($cache)) { $cache = load(); }
  return $cache;
}
do { $i++; } while ($i < 3);
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("static_var");
    expect(kinds).toContain("do_while");
  });

  it("parses elseif chains of any length", () => {
    const src = `<?php
if ($p === 'a') { $x = 1; }
elseif ($p === 'b') { $x = 2; }
elseif ($p === 'c') { $x = 3; }
else { $x = 4; }
`;
    const { program } = parsePhp(src);
    const top = program.body[0];
    expect(top?.kind).toBe("if");
    // The chain nests: if -> alternate if -> alternate if -> alternate stmts.
    if (top?.kind === "if" && !Array.isArray(top.alternate) && top.alternate !== null) {
      const second = top.alternate;
      expect(second.kind).toBe("if");
      if (!Array.isArray(second.alternate) && second.alternate !== null) {
        const third = second.alternate;
        expect(third.kind).toBe("if");
        expect(Array.isArray(third.alternate)).toBe(true);
      }
    }
  });

  it("parses the template alternative syntax (if/foreach/endif)", () => {
    const src = `<?php if ( $show ) : ?>
<div>hi</div>
<?php foreach ( $items as $it ) : ?>
<p><?php echo $it; ?></p>
<?php endforeach; ?>
<?php elseif ( $other ) : ?>
<p>other</p>
<?php else : ?>
<p>none</p>
<?php endif; ?>
`;
    const { program } = parsePhp(src);
    const top = program.body[0];
    expect(top?.kind).toBe("if");
    if (top?.kind === "if") {
      expect(top.altSyntax).toBe(true);
      const kinds: string[] = [];
      walkAst(program, (n) => kinds.push(n.kind));
      expect(kinds).toContain("foreach");
      expect(kinds).toContain("inline_html");
    }
  });

  it("parses endif without a semicolon before ?>", () => {
    const src = `<?php if ( $x ) : ?>yes<?php endif ?>`;
    const { program } = parsePhp(src);
    expect(program.body[0]?.kind).toBe("if");
  });

  it("treats a // comment as ending at ?> (template echo + comment)", () => {
    const src = `<?php echo $tick; // phpcs:ignore WordPress.Security.EscapeOutput ?>
<div>after</div>
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("echo");
    expect(kinds).toContain("inline_html");
  });

  it("parses variable variables as unsupported expressions, not errors", () => {
    const src = `<?php
foreach ( $args as $key => $val ) {
  $$key = $val;
}
`;
    const { program } = parsePhp(src);
    const kinds: string[] = [];
    walkAst(program, (n) => kinds.push(n.kind));
    expect(kinds).toContain("unsupported_expr");
  });
});
