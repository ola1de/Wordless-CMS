import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePhp, renderAnalysisReport } from "./analyze";

const HELLO_PATH = fileURLToPath(
  new URL("../../../reference/wordpress-7.1.5/wp-content/plugins/hello.php", import.meta.url),
);
const HAS_HELLO = existsSync(HELLO_PATH);

describe("php analysis (M4)", () => {
  it.skipIf(!HAS_HELLO)("analyses Hello Dolly as convertible", () => {
    const a = analyzePhp(readFileSync(HELLO_PATH, "utf8"), "hello.php");
    expect(a.verdict).toBe("convertible");
    expect(a.functions).toEqual(["hello_dolly_get_lyric", "hello_dolly", "dolly_css"]);
    expect(a.hooks).toEqual([
      { tag: "admin_notices", kind: "action" },
      { tag: "admin_head", kind: "action" },
    ]);
    expect(a.unconvertible).toEqual([]);
  });

  it("marks a file using wp_remote_post and $wpdb as blocked", () => {
    const a = analyzePhp(
      `<?php
function check($c) {
  global $wpdb;
  $r = wp_remote_post('https://api.example.com/', array('body' => $c));
  return $r;
}
`,
      "blocked.php",
    );
    expect(a.verdict).toBe("blocked");
    expect(a.httpCalls).toContain("wp_remote_post");
    expect(a.features).toContain("$wpdb");
  });

  it("marks a class file as partial with the class named", () => {
    const a = analyzePhp(`<?php class Foo { public function bar() { return 1; } }`, "class.php");
    expect(a.verdict).toBe("partial");
    expect(a.classes).toEqual(["Foo"]);
  });

  it("marks a file with a blocked construct as blocked", () => {
    const a = analyzePhp(`<?php function f($x) { return eval($x); }`, "eval.php");
    expect(a.verdict).toBe("blocked");
    expect(a.features).toContain("blocked-construct");
  });

  it("renders a report with a per-file verdict and an effort estimate", () => {
    const a = analyzePhp(`<?php function f() { return 1; }`, "f.php");
    const report = renderAnalysisReport([a], {
      title: "Test report",
      intro: "Intro.",
      generatedBy: "Test.",
    });
    expect(report).toContain("# Test report");
    expect(report).toContain("## `f.php` — convertible");
    expect(report).toContain("## Effort estimate");
    expect(report).toContain("Convertible files (1");
  });
});
