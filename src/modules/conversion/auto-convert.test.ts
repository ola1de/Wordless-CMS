/**
 * Auto-convert on upload — tests (Milestone 11).
 *
 * Conversion runs the M4 engine over each PHP file (never executes
 * it) and settings migration carries literal option defaults over as
 * Wordless options — existing options are never overwritten.
 */
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { getOption } from "../options/service";
import {
  collectOptionDefaults,
  convertPhpFiles,
  migrateOptionDefaults,
  summarizeThemeJsonSettings,
} from "./auto-convert";

const enc = new TextEncoder();

const CONVERTIBLE_PHP = `<?php
if (!defined('ABSPATH')) exit;
function my_plugin_init() {
  add_action('init', 'my_plugin_init');
  return get_option('my_plugin_option', 'hello');
}
`;

const CLASS_PHP = `<?php
class My_Widget {
  public function render() {
    echo 'hello';
  }
}
`;

const EVAL_PHP = `<?php
function run_code($code) {
  eval($code);
}
`;

describe("convertPhpFiles", () => {
  it("converts a clean procedural file and generates TypeScript", () => {
    const { generated, report } = convertPhpFiles(
      new Map([["my-plugin.php", enc.encode(CONVERTIBLE_PHP)]]),
      "my-plugin",
      "plugin",
    );
    expect(report.converted).toBe(1);
    expect(report.partial).toBe(0);
    expect(report.blocked).toBe(0);
    expect(report.files[0]?.status).toBe("converted");
    expect(report.files[0]?.functionsConverted).toContain("my_plugin_init");
    expect(report.files[0]?.generatedPath).toBe("converted/my-plugin.ts");
    const code = generated.get("converted/my-plugin.ts");
    expect(code).toBeDefined();
    expect(code).toContain("my_plugin_init");
  });

  it("marks class files partial and eval files blocked, with reasons", () => {
    const { generated, report } = convertPhpFiles(
      new Map([
        ["a.php", enc.encode(CLASS_PHP)],
        ["b.php", enc.encode(EVAL_PHP)],
      ]),
      "mixed",
      "plugin",
    );
    expect(report.converted).toBe(0);
    expect(report.partial).toBe(1);
    expect(report.blocked).toBe(1);
    expect(report.files.find((f) => f.file === "a.php")?.status).toBe("partial");
    expect(report.files.find((f) => f.file === "a.php")?.reason).toMatch(/class runtime/);
    expect(report.files.find((f) => f.file === "b.php")?.status).toBe("blocked");
    expect(report.files.find((f) => f.file === "b.php")?.reason).toMatch(/sandbox/);
    expect(report.files.find((f) => f.file === "b.php")?.generatedPath).toBeNull();
    expect(generated.has("converted/a.ts")).toBe(true);
    expect(generated.has("converted/b.ts")).toBe(false);
  });

  it("marks unparseable PHP blocked instead of crashing", () => {
    const { report } = convertPhpFiles(
      new Map([["bad.php", enc.encode("<?php $x = fn($a) => $a * 2;")]]),
      "bad",
      "plugin",
    );
    expect(report.blocked).toBe(1);
    expect(report.files[0]?.status).toBe("blocked");
    expect(report.files[0]?.reason).toMatch(/Could not be parsed/);
  });

  it("ignores non-PHP files and reports zero PHP files", () => {
    const { report } = convertPhpFiles(
      new Map([["readme.txt", enc.encode("hello")]]),
      "assets-only",
      "plugin",
    );
    expect(report.phpFiles).toBe(0);
    expect(report.files).toEqual([]);
  });
});

describe("collectOptionDefaults + migrateOptionDefaults", () => {
  it("collects literal defaults and carries them over as options", async () => {
    const { db, close } = createTestDb();
    try {
      const defaults = collectOptionDefaults(
        new Map([["p.php", enc.encode(CONVERTIBLE_PHP)]]),
      );
      expect(defaults).toEqual([{ key: "my_plugin_option", defaultValue: "hello", file: "p.php" }]);
      const result = await migrateOptionDefaults(db, defaults);
      expect(result.carriedOver).toHaveLength(1);
      expect(result.carriedOver[0]?.key).toBe("my_plugin_option");
      expect(result.skipped).toHaveLength(0);
      expect(await getOption(db, "my_plugin_option", null)).toBe("hello");
    } finally {
      close();
    }
  });

  it("never overwrites an option that already exists", async () => {
    const { db, close } = createTestDb();
    try {
      const { setOption } = await import("../options/service");
      await setOption(db, "my_plugin_option", "existing");
      const result = await migrateOptionDefaults(db, [
        { key: "my_plugin_option", defaultValue: "hello", file: "p.php" },
      ]);
      expect(result.carriedOver).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toMatch(/already exists/);
      expect(await getOption(db, "my_plugin_option", null)).toBe("existing");
    } finally {
      close();
    }
  });

  it("collects number and boolean defaults, ignores non-literal ones", () => {
    const defaults = collectOptionDefaults(
      new Map([
        [
          "p.php",
          enc.encode(
            `<?php $a = get_option('num_opt', 42); $b = get_option('bool_opt', true); $c = get_option('dyn_opt', SOME_CONST); $d = get_option($dynamic_key, 'x');`,
          ),
        ],
      ]),
    );
    expect(defaults.map((d) => d.key).sort()).toEqual(["bool_opt", "num_opt"]);
    expect(defaults.find((d) => d.key === "num_opt")?.defaultValue).toBe(42);
    expect(defaults.find((d) => d.key === "bool_opt")?.defaultValue).toBe(true);
  });
});

describe("summarizeThemeJsonSettings", () => {
  it("counts presets carried over as CSS and lists unsupported settings as skipped", () => {
    const themeJson = {
      settings: {
        color: { palette: [{ slug: "a" }, { slug: "b" }, { slug: "c" }] },
        typography: { fontSizes: [{ slug: "s" }, { slug: "m" }] },
        spacing: { spacingSizes: [{ slug: "10" }] },
        layout: { contentSize: "640px" },
      },
    };
    const result = summarizeThemeJsonSettings(themeJson, ["settings.typography.writingMode"]);
    expect(result.carriedOver.map((e) => e.key)).toEqual([
      "theme.json color palette",
      "theme.json font sizes",
      "theme.json spacing sizes",
      "theme.json layout widths",
    ]);
    expect(result.carriedOver[0]?.value).toBe(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.key).toBe("theme.json settings.typography.writingMode");
  });
});
