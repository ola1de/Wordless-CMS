import { describe, expect, it } from "vitest";
import { assertSafe, scanSafety } from "./safety";

describe("conversion safety scan (M4)", () => {
  it.each([
    ["eval", `<?php eval($code);`],
    ["exec", `<?php exec('ls');`],
    ["shell_exec", `<?php $x = shell_exec('id');`],
    ["system", `<?php system('whoami');`],
    ["passthru", `<?php passthru('cat /etc/passwd');`],
    ["create_function", `<?php $f = create_function('$a', 'return $a;');`],
    ["unserialize", `<?php $x = unserialize($_POST['data']);`],
    ["backticks", "<?php $x = `whoami`;"],
    ["dynamic include", `<?php include $file;`],
    ["dynamic require", `<?php require($path . '.php');`],
  ])("rejects %s", (_name, src) => {
    const result = scanSafety(src);
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(() => assertSafe(src)).toThrow(/blocked/i);
  });

  it("allows literal includes and normal plugin code", () => {
    const src = `<?php
require_once 'inc/helpers.php';
function hello_dolly() {
  $lyrics = explode("\\n", "a\\nb");
  return $lyrics[0];
}
add_action('admin_notices', 'hello_dolly');
`;
    expect(scanSafety(src).safe).toBe(true);
    expect(() => assertSafe(src)).not.toThrow();
  });

  it("does not trip on blocked words inside strings or comments", () => {
    const src = `<?php
// This comment mentions eval and system() for documentation.
// $x = "exec('ls') is just a string";
$a = 'unserialize is a word';
`;
    expect(scanSafety(src).safe).toBe(true);
  });

  it("reports the line of each violation", () => {
    const result = scanSafety(`<?php\n$a = 1;\n$x = eval($code);\n$y = system('id');\n`);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.line).toBe(3);
    expect(result.violations[1]?.line).toBe(4);
  });

  it("is case-insensitive for blocked names", () => {
    expect(scanSafety(`<?php EVAL($x);`).safe).toBe(false);
    expect(scanSafety(`<?php Shell_Exec('id');`).safe).toBe(false);
  });
});
