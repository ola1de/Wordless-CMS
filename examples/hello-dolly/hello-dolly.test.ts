import { describe, expect, it } from "vitest";
import { createTestDb } from "../../src/test/test-db";
import { createWordPressApi } from "../../src/compat/wordpress";
import { activate, extensionMeta, helloDollyGetLyric, renderedOutput } from "./index";

describe("converted Hello Dolly extension (M4)", () => {
  it("registers its hooks and returns a lyric through the kernel", () => {
    const { db, close } = createTestDb();
    try {
      const api = createWordPressApi({ db, currentUser: null, locale: "en_US" });
      renderedOutput.length = 0;
      activate(api);

      api.do_action("admin_notices");
      expect(renderedOutput).toHaveLength(1);
      const notice = renderedOutput[0] ?? "";
      expect(notice).toContain('<p id="dolly">');
      expect(notice).toContain("Hello Dolly song, by Jerry Herman");
      // The lyric inside is one non-empty line from the song.
      const lyric = notice.replace(/^.*<span dir="ltr">/, "").replace(/<\/span><\/p>$/, "");
      expect(lyric.length).toBeGreaterThan(0);
      expect(lyric).not.toContain("\n");

      api.do_action("admin_head");
      expect(renderedOutput).toHaveLength(2);
      expect(renderedOutput[1]).toContain("<style type='text/css'>");
      expect(renderedOutput[1]).toContain("#dolly");
    } finally {
      close();
    }
  });

  it("returns more than one distinct lyric over many calls", () => {
    const { db, close } = createTestDb();
    try {
      const api = createWordPressApi({ db, currentUser: null, locale: "en_US" });
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) seen.add(helloDollyGetLyric(api));
      expect(seen.size).toBeGreaterThan(1);
      for (const lyric of seen) {
        expect(lyric.length).toBeGreaterThan(0);
        expect(lyric).not.toContain("\n");
      }
    } finally {
      close();
    }
  });

  it("carries the plugin manifest from the header", () => {
    expect(extensionMeta.slug).toBe("hello-dolly");
    expect(extensionMeta.name).toBe("Hello Dolly");
    expect(extensionMeta.version).toBe("1.7.2");
    expect(extensionMeta.author).toBe("Matt Mullenweg");
  });
});
