/**
 * Elementor content renderer — tests (Milestone 11).
 *
 * The fixture is a realistic `_elementor_data` tree: one section, one
 * column, heading + text-editor + image + button, plus a second section
 * with an unknown widget (must render nothing, listed as unsupported).
 */
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { execRun } from "../../db";
import { createPost } from "../posts/service";
import {
  getElementorData,
  hasElementorData,
  renderElementorData,
  SUPPORTED_ELEMENTOR_WIDGETS,
} from "./elementor";

const FIXTURE = [
  {
    id: "sec1",
    elType: "section",
    settings: { layout: "boxed" },
    elements: [
      {
        id: "col1",
        elType: "column",
        settings: { _column_size: 100 },
        elements: [
          { id: "w1", elType: "widget", widgetType: "heading", settings: { title: "Welcome to Wordless", header_size: "h1", align: "center" } },
          { id: "w2", elType: "widget", widgetType: "text-editor", settings: { editor: "<p>Built with <strong>Elementor</strong>, rendered by Wordless.</p>" } },
          { id: "w3", elType: "widget", widgetType: "image", settings: { image: { url: "https://example.test/hero.jpg", alt: "Hero" }, caption: "Our hero" } },
          { id: "w4", elType: "widget", widgetType: "button", settings: { text: "Get started", link: { url: "https://example.test/start", is_external: true }, align: "center" } },
          { id: "w5", elType: "widget", widgetType: "spacer", settings: { space: { size: 40 } } },
          { id: "w6", elType: "widget", widgetType: "divider", settings: {} },
        ],
      },
    ],
  },
  {
    id: "sec2",
    elType: "section",
    settings: {},
    elements: [
      {
        id: "col2",
        elType: "column",
        settings: {},
        elements: [
          { id: "w7", elType: "widget", widgetType: "fancy-slider", settings: { slides: [] } },
          { id: "w8", elType: "widget", widgetType: "video", settings: { video_type: "youtube", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
          { id: "w9", elType: "widget", widgetType: "icon-list", settings: { icon_list: [{ text: "Fast" }, { text: "Simple" }] } },
          { id: "w10", elType: "widget", widgetType: "image-box", settings: { image: { url: "https://example.test/box.jpg" }, title_text: "Box title", description_text: "Box text" } },
          { id: "w11", elType: "widget", widgetType: "google-maps", settings: { address: "Lagos, Nigeria", zoom: { size: 12 }, height: { size: 300 } } },
        ],
      },
    ],
  },
];

describe("renderElementorData", () => {
  it("renders a nested section > column > heading + text + image + button", () => {
    const { html, unsupported } = renderElementorData(FIXTURE);
    expect(html).toContain('<section class="elementor-section">');
    expect(html).toContain('<div class="elementor-column">');
    expect(html).toContain('<h1 style="text-align:center;">Welcome to Wordless</h1>');
    expect(html).toContain("<p>Built with <strong>Elementor</strong>, rendered by Wordless.</p>");
    expect(html).toContain('<img src="https://example.test/hero.jpg" alt="Hero" loading="lazy">');
    expect(html).toContain("<figcaption>Our hero</figcaption>");
    expect(html).toContain('<a class="elementor-button" href="https://example.test/start" target="_blank" rel="noopener">Get started</a>');
    expect(html).toContain('height:40px');
    expect(html).toContain('<hr class="elementor-divider">');
    expect(unsupported).toEqual(["fancy-slider"]);
  });

  it("renders video, icon-list, image-box and google-maps widgets", () => {
    const { html } = renderElementorData(FIXTURE);
    expect(html).toContain("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(html).toContain('<ul class="elementor-icon-list"><li>Fast</li><li>Simple</li></ul>');
    expect(html).toContain("Box title");
    expect(html).toContain("Box text");
    expect(html).toContain("https://maps.google.com/maps?q=Lagos%2C%20Nigeria");
  });

  it("renders nothing for unknown widgets and lists them as unsupported", () => {
    const { html, unsupported } = renderElementorData([
      { id: "x", elType: "widget", widgetType: "mega-menu", settings: {} },
      { id: "y", elType: "widget", widgetType: "mega-menu", settings: {} },
    ]);
    expect(html).toBe("");
    expect(unsupported).toEqual(["mega-menu"]);
  });

  it("returns empty HTML for non-array data", () => {
    expect(renderElementorData(null)).toEqual({ html: "", unsupported: [] });
    expect(renderElementorData({})).toEqual({ html: "", unsupported: [] });
    expect(renderElementorData([])).toEqual({ html: "", unsupported: [] });
  });

  it("escapes widget text and rejects javascript: links", () => {
    const { html } = renderElementorData([
      { id: "a", elType: "widget", widgetType: "heading", settings: { title: "<script>alert(1)</script> Hi" } },
      { id: "b", elType: "widget", widgetType: "button", settings: { text: "Click", link: { url: "javascript:alert(1)" } } },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="elementor-button">Click</span>');
  });

  it("strips scripts from text-editor HTML", () => {
    const { html } = renderElementorData([
      { id: "a", elType: "widget", widgetType: "text-editor", settings: { editor: '<p onclick="evil()">Safe</p><script>bad()</script>' } },
    ]);
    expect(html).toContain("<p>Safe</p>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onclick");
  });

  it("supports the documented widget list", () => {
    expect([...SUPPORTED_ELEMENTOR_WIDGETS].sort()).toEqual(
      ["button", "divider", "google-maps", "heading", "icon-list", "image", "image-box", "spacer", "text-editor", "video"].sort(),
    );
  });

  it("renders a hosted video file and ignores unknown video types", () => {
    const { html } = renderElementorData([
      { id: "a", elType: "widget", widgetType: "video", settings: { video_type: "hosted", hosted_url: { url: "https://example.test/clip.mp4" } } },
      { id: "b", elType: "widget", widgetType: "video", settings: { video_type: "twitch", youtube_url: "https://www.youtube.com/watch?v=x" } },
    ]);
    expect(html).toContain('<video controls preload="none" src="https://example.test/clip.mp4">');
    expect(html).not.toContain("youtube.com/embed");
  });
});

describe("getElementorData / hasElementorData", () => {
  it("reads _elementor_data postmeta and reports presence", async () => {
    const { db, close } = createTestDb();
    try {
      const post = await createPost(db, { title: "Elementor page", type: "page", status: "publish", authorId: 1 });
      expect(await hasElementorData(db, post.id)).toBe(false);
      await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
        post.id,
        "_elementor_data",
        JSON.stringify(FIXTURE),
      ]);
      expect(await hasElementorData(db, post.id)).toBe(true);
      const data = await getElementorData(db, post.id);
      expect(Array.isArray(data)).toBe(true);
      expect((data as unknown[]).length).toBe(2);
    } finally {
      close();
    }
  });

  it("returns null for invalid or empty Elementor JSON", async () => {
    const { db, close } = createTestDb();
    try {
      const post = await createPost(db, { title: "Broken", type: "page", status: "publish", authorId: 1 });
      await execRun(db, "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [
        post.id,
        "_elementor_data",
        "not json at all",
      ]);
      expect(await getElementorData(db, post.id)).toBeNull();
      expect(await hasElementorData(db, post.id)).toBe(false);
    } finally {
      close();
    }
  });
});
