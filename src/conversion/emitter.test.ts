import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { convertPhp } from "./index";
import { emitTypeScript } from "./emitter";
import { parsePhp } from "./parser";

const HELLO_PATH = fileURLToPath(
  new URL("../../../reference/wordpress-7.1.5/wp-content/plugins/hello.php", import.meta.url),
);
const HAS_HELLO = existsSync(HELLO_PATH);
const FIXTURE_PATH = fileURLToPath(new URL("../../examples/hello-dolly/index.ts", import.meta.url));

function emitSnippet(source: string): string {
  const { program } = parsePhp(source);
  return emitTypeScript(program, { filename: "snippet.php", slug: "snippet" }).code;
}

describe("emitter (M4)", () => {
  it("maps functions, hooks, echo and printf to Wordless code", () => {
    const code = emitSnippet(`<?php
function greet($name) {
  echo "Hello " . $name;
  printf('<p>%s</p>', $name);
}
add_action('init', 'greet');
`);
    expect(code).toContain("export function greet(wp: WordPressApi, name: unknown): string {");
    expect(code).toContain('__out += ("Hello " + name);');
    expect(code).toContain('__out += __sprintf("<p>%s</p>", name);');
    // greet() echoes, so the action wrapper captures its output.
    expect(code).toContain('wp.add_action("init", () => { renderedOutput.push(greet(wp)); });');
    expect(code).toContain("export function activate(wp: WordPressApi): void {");
    expect(code).toContain("export const extensionMeta");
  });

  it("maps explode/count/mt_rand/substr to TypeScript equivalents", () => {
    const code = emitSnippet(`<?php
function pick($text) {
  $lines = explode("\\n", $text);
  return $lines[mt_rand(0, count($lines) - 1)];
}
function short($s) {
  return substr($s, 0, 3);
}
`);
    expect(code).toContain('.split("\\n")');
    expect(code).toContain("__rand(0,");
    expect(code).toContain("Array.isArray");
    expect(code).toContain("__substr(");
  });

  it("makes functions async when they call async WP functions, and awaits", () => {
    const code = emitSnippet(`<?php
function get_title($id) {
  $post = get_post($id);
  return $post;
}
function show($id) {
  $t = get_title($id);
  echo $t;
}
`);
    expect(code).toContain("export async function getTitle(wp: WordPressApi, id: unknown): Promise<string> {");
    expect(code).toContain("await wp.get_post(id)");
    expect(code).toContain("export async function show(wp: WordPressApi, id: unknown): Promise<string> {");
    expect(code).toContain("await getTitle(wp, id)");
  });

  it("turns the ABSPATH guard into a comment and records the transformation", () => {
    const { program } = parsePhp(`<?php
if ( ! defined( 'ABSPATH' ) ) {
  exit;
}
function f() { return 1; }
`);
    const { code, report } = emitTypeScript(program, { filename: "g.php", slug: "g" });
    expect(code).toContain("ABSPATH direct-access guard");
    expect(report.transformed.some((t) => t.what === "ABSPATH guard")).toBe(true);
    expect(code).not.toContain("exit");
  });

  it("emits unmapped calls as throwing helpers and lists them", () => {
    const { program } = parsePhp(`<?php
function f() {
  $x = some_unknown_wp_function(1, 2);
  return $x;
}
`);
    const { code, report } = emitTypeScript(program, { filename: "u.php", slug: "u" });
    expect(code).toContain("__unmapped_some_unknown_wp_function(1, 2)");
    expect(code).toContain("function __unmapped_some_unknown_wp_function");
    expect(report.unconverted.some((u) => u.name === "some_unknown_wp_function")).toBe(true);
  });

  it("records classes as unconverted, with a comment in the output", () => {
    const { program } = parsePhp(`<?php
class Foo {
  public function bar() { return 1; }
}
`);
    const { code, report } = emitTypeScript(program, { filename: "c.php", slug: "c" });
    expect(report.unconverted.some((u) => u.kind === "class declaration" && u.name === "Foo")).toBe(true);
    expect(code).toContain("NOT CONVERTED (line 2): class Foo");
  });

  it("converts foreach to for..of and string interpolation to template literals", () => {
    const code = emitSnippet(`<?php
function list_all($items) {
  foreach ($items as $item) {
    echo "Item: $item\\n";
  }
}
`);
    expect(code).toContain("for (item of (items as unknown[])) {");
    expect(code).toContain("__out += `Item: ${item}\\n`;");
  });

  it("handles die() guards the same way as exit guards", () => {
    const a = emitSnippet(`<?php if (!defined('ABSPATH')) { exit; } function f() { return 1; }`);
    const b = emitSnippet(`<?php if (!defined('ABSPATH')) { die(); } function f() { return 1; }`);
    expect(a).toBe(b);
  });

  it("translates casts and the spaceship operator", () => {
    const code = emitSnippet(`<?php
function cmp($a, $b) {
  $x = (int) $a;
  $y = (string) $b;
  return (float) $x <=> (float) $y;
}
`);
    expect(code).toContain("Math.trunc(Number(a))");
    expect(code).toContain("String(b)");
    expect(code).toContain("? -1 :");
  });

  it("hoists function-local static variables to module level", () => {
    const code = emitSnippet(`<?php
function memo() {
  static $cache = null;
  if (is_null($cache)) { $cache = 'v'; }
  return $cache;
}
`);
    expect(code).toContain("let __static_memo_cache = null;");
    expect(code).toContain('__static_memo_cache = "v"');
    expect(code).toContain("return __static_memo_cache;");
    // No function-level `let cache;` for the hoisted variable.
    expect(code).not.toMatch(/^\s+let cache;$/m);
  });

  it("translates do/while loops and alternative-syntax ifs", () => {
    const code = emitSnippet(`<?php
function f($items) {
  $i = 0;
  do { $i++; } while ($i < 3);
  if ($items) :
    echo 'yes';
  else :
    echo 'no';
  endif;
  return $i;
}
`);
    expect(code).toContain("do {");
    expect(code).toContain("while ((i < 3))");
    expect(code).toContain('__out += "yes"');
    expect(code).toContain('__out += "no"');
  });

  it.skipIf(!HAS_HELLO)("converts the real Hello Dolly end to end", () => {
    const source = readFileSync(HELLO_PATH, "utf8");
    const report = convertPhp(source, "hello.php", { slug: "hello-dolly" });
    expect(report.ast.functions).toBe(3);
    expect(report.converted.functions).toEqual([
      "hello_dolly_get_lyric",
      "hello_dolly",
      "dolly_css",
    ]);
    expect(report.converted.hooks).toEqual([
      { tag: "admin_notices", kind: "action", functionName: "hello_dolly" },
      { tag: "admin_head", kind: "action", functionName: "dolly_css" },
    ]);
    expect(report.unconverted).toEqual([]);
    expect(report.transformed.some((t) => t.what === "ABSPATH guard")).toBe(true);
    expect(report.output.code).toContain("export function helloDollyGetLyric");
    expect(report.output.code).toContain('wp.add_action("admin_notices"');
    expect(report.output.code).toContain("renderedOutput.push(helloDolly(wp))");
    expect(report.output.code).toContain("wp.wptexturize");
    expect(report.output.code).toContain("wp.get_user_locale()");
    expect(report.output.code).toContain("__sprintf");
    expect(report.extension.name).toBe("Hello Dolly");
    expect(report.extension.version).toBe("1.7.2");
  });

  it.skipIf(!HAS_HELLO)(
    "the generated Hello Dolly output typechecks with tsc",
    () => {
    const source = readFileSync(HELLO_PATH, "utf8");
    const report = convertPhp(source, "hello.php", { slug: "hello-dolly" });
    const dir = mkdtempSync(join(tmpdir(), "wordless-emit-"));
    try {
      // Mirror the checked-in fixture's depth so the relative import
      // (../../src/compat/wordpress) resolves the same way.
      const nested = join(dir, "a", "b");
      mkdirSync(nested, { recursive: true });
      const outPath = join(nested, "index.ts");
      // Point the compat import at the real repo module (relative path).
      const repoSrc = fileURLToPath(new URL("../../src/compat/wordpress.ts", import.meta.url));
      const relImport = relative(dirname(outPath), repoSrc).replace(/\.ts$/, "");
      const rewritten = report.output.code.replace(
        '"../../src/compat/wordpress"',
        JSON.stringify(relImport.startsWith(".") ? relImport : `./${relImport}`),
      );
      writeFileSync(outPath, rewritten);
      execFileSync(
        "npx",
        [
          "tsc",
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--moduleResolution",
          "bundler",
          "--types",
          "node",
          outPath,
        ],
        { cwd: fileURLToPath(new URL("../..", import.meta.url)), timeout: 120000, stdio: "pipe" },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    },
    60000,
  );

  it.skipIf(!HAS_HELLO)(
    "the checked-in fixture matches a fresh conversion (determinism)",
    () => {
      const source = readFileSync(HELLO_PATH, "utf8");
      const report = convertPhp(source, "hello.php", { slug: "hello-dolly" });
      expect(existsSync(FIXTURE_PATH)).toBe(true);
      const checkedIn = readFileSync(FIXTURE_PATH, "utf8");
      expect(checkedIn).toBe(report.output.code);
    },
  );
});
