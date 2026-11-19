/**
 * Marketplace install limits + plugin compatibility reports — tests (M11).
 *
 * Part A: the old 2 MB / 100-file caps are gone (50 MB / 10000 files).
 * Part B: every install carries a PHP-analyser report (convertible /
 * partial / blocked counts + top blocking reasons with file paths).
 * Installed code is never executed by any of this.
 */
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { createTestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import {
  getMarketplaceExtensionReport,
  installExtensionFromZip,
  listMarketplaceExtensions,
  MAX_MARKETPLACE_FILES,
  MAX_MARKETPLACE_ZIP_BYTES,
} from "./marketplace";
import { analyzePluginFiles } from "./compat-report";

function makeZip(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) input[path] = new TextEncoder().encode(text);
  return zipSync(input);
}

function manifest(slug: string): Record<string, string> {
  return {
    [`${slug}/wordless.json`]: JSON.stringify({ slug, name: slug, version: "1.0.0", kind: "plugin" }),
  };
}

const CONVERTIBLE_PHP = `<?php
if (!defined('ABSPATH')) exit;
function my_plugin_init() {
  add_action('init', 'my_plugin_init');
  $value = get_option('my_plugin_option');
  return $value;
}
`;

const CLASS_PHP = `<?php
class My_Widget {
  public function render() {
    echo 'hello';
  }
}
new My_Widget();
`;

const EVAL_PHP = `<?php
function run_code($code) {
  eval($code);
}
`;

describe("marketplace limits (M11)", () => {
  it("exports the raised 50 MB / 10000-file limits", () => {
    expect(MAX_MARKETPLACE_ZIP_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_MARKETPLACE_FILES).toBe(10000);
  });

  it("installs a ZIP with 201 files (the user's 1532-file case is under the new cap)", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const files: Record<string, string> = { ...manifest("big-plugin") };
      for (let i = 0; i < 200; i++) files[`big-plugin/part-${i}.txt`] = "x";
      const result = await installExtensionFromZip(db, storage, "big-plugin.zip", makeZip(files));
      expect(result.extension.slug).toBe("big-plugin");
      expect(result.files).toBe(201);
    } finally {
      close();
    }
  });

  it("rejects a ZIP over 50 MB", async () => {
    const { db, close } = createTestDb();
    try {
      await expect(
        installExtensionFromZip(db, new InMemoryMediaStorage(), "big.zip", new Uint8Array(51 * 1024 * 1024)),
      ).rejects.toThrow(/50 MB/);
    } finally {
      close();
    }
  });

  it("rejects a ZIP with more than 10000 files", async () => {
    const { db, close } = createTestDb();
    try {
      const files: Record<string, string> = { ...manifest("huge-plugin") };
      for (let i = 0; i < 10000; i++) files[`huge-plugin/part-${i}.txt`] = "x";
      await expect(
        installExtensionFromZip(db, new InMemoryMediaStorage(), "huge.zip", makeZip(files)),
      ).rejects.toThrow(/limit is 10000/);
    } finally {
      close();
    }
  });
});

describe("analyzePluginFiles", () => {
  it("reports a convertible plugin as compatible", () => {
    const report = analyzePluginFiles(
      new Map([["my-plugin/my-plugin.php", new TextEncoder().encode(CONVERTIBLE_PHP)]]),
    );
    expect(report.verdict).toBe("compatible");
    expect(report.phpFiles).toBe(1);
    expect(report.convertible).toBe(1);
    expect(report.partial).toBe(0);
    expect(report.blocked).toBe(0);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.verdict).toBe("convertible");
  });

  it("reports classes as partial and eval as blocked, with file paths", () => {
    const enc = new TextEncoder();
    const report = analyzePluginFiles(
      new Map([
        ["mixed/a.php", enc.encode(CLASS_PHP)],
        ["mixed/b.php", enc.encode(EVAL_PHP)],
        ["mixed/c.php", enc.encode(CONVERTIBLE_PHP)],
      ]),
    );
    expect(report.verdict).toBe("blocked");
    expect(report.phpFiles).toBe(3);
    expect(report.convertible).toBe(1);
    expect(report.partial).toBe(1);
    expect(report.blocked).toBe(1);
    const kinds = report.topReasons.map((r) => r.kind);
    expect(kinds).toContain("class");
    expect(kinds).toContain("eval");
    const classReason = report.topReasons.find((r) => r.kind === "class");
    expect(classReason?.files).toContain("mixed/a.php");
    const evalReason = report.topReasons.find((r) => r.kind === "eval");
    expect(evalReason?.files).toContain("mixed/b.php");
  });

  it("reports a plugin with no PHP files as not-analysed", () => {
    const report = analyzePluginFiles(
      new Map([["assets/readme.txt", new TextEncoder().encode("hello")]]),
    );
    expect(report.verdict).toBe("not-analysed");
    expect(report.phpFiles).toBe(0);
  });

  it("marks unparseable PHP as unparsed instead of crashing", () => {
    const report = analyzePluginFiles(
      new Map([["bad/bad.php", new TextEncoder().encode("<?php $x = fn($a) => $a * 2;")]]),
    );
    expect(report.unparsed).toBe(1);
    expect(report.verdict).toBe("blocked");
  });
});

describe("marketplace install stores the compatibility report", () => {
  it("stores the report and returns it from the API helper", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const zip = makeZip({
        ...manifest("mixed-plugin"),
        "mixed-plugin/a.php": CLASS_PHP,
        "mixed-plugin/b.php": CONVERTIBLE_PHP,
      });
      const result = await installExtensionFromZip(db, storage, "mixed-plugin.zip", zip);
      expect(result.report.verdict).toBe("partial");
      expect(result.report.phpFiles).toBe(2);
      expect(result.report.partial).toBe(1);
      expect(result.report.convertible).toBe(1);
      expect(result.extension.report?.verdict).toBe("partial");
      const listed = await listMarketplaceExtensions(db);
      expect(listed.find((e) => e.slug === "mixed-plugin")?.report?.verdict).toBe("partial");
      const fetched = await getMarketplaceExtensionReport(db, "mixed-plugin");
      expect(fetched?.verdict).toBe("partial");
      expect(fetched?.topReasons.map((r) => r.kind)).toContain("class");
    } finally {
      close();
    }
  });

  it("returns null for an extension installed without a report", async () => {
    const { db, close } = createTestDb();
    try {
      const { installExtension } = await import("../extensions/service");
      await installExtension(db, { slug: "legacy", name: "Legacy", version: "1.0.0" });
      expect(await getMarketplaceExtensionReport(db, "legacy")).toBeNull();
    } finally {
      close();
    }
  });

  it("auto-converts PHP on install: generated TS stored, option default carried over", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const zip = makeZip({
        ...manifest("auto-plugin"),
        "auto-plugin/auto-plugin.php": `<?php
if (!defined('ABSPATH')) exit;
function auto_plugin_init() {
  add_action('init', 'auto_plugin_init');
  return get_option('auto_plugin_mode', 'standard');
}
`,
        "auto-plugin/class.php": CLASS_PHP,
      });
      const result = await installExtensionFromZip(db, storage, "auto-plugin.zip", zip);
      expect(result.report.conversion).not.toBeNull();
      expect(result.report.conversion?.converted).toBe(1);
      expect(result.report.conversion?.partial).toBe(1);
      expect(result.report.conversion?.blocked).toBe(0);
      expect(await storage.exists("extensions/auto-plugin/converted/auto-plugin.ts")).toBe(true);
      expect(await storage.exists("extensions/auto-plugin/converted/class.ts")).toBe(true);
      const carried = result.report.conversion?.settings.carriedOver ?? [];
      expect(carried.map((c) => c.key)).toContain("auto_plugin_mode");
      const { getOption } = await import("../options/service");
      expect(await getOption(db, "auto_plugin_mode", null)).toBe("standard");
      // The stored report carries the conversion record too.
      const fetched = await getMarketplaceExtensionReport(db, "auto-plugin");
      expect(fetched?.conversion?.converted).toBe(1);
      expect(fetched?.conversion?.settings.carriedOver.map((c) => c.key)).toContain("auto_plugin_mode");
    } finally {
      close();
    }
  });

  it("rejects a report lookup for an unknown slug", async () => {
    const { db, close } = createTestDb();
    try {
      await expect(getMarketplaceExtensionReport(db, "nope")).rejects.toThrow(/not installed/);
    } finally {
      close();
    }
  });
});
