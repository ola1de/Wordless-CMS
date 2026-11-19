import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import { createProduct } from "../commerce/products";
import { addToCart, getCart, newCartToken } from "../commerce/cart";
import { createOrderFromCart } from "../commerce/orders";
import { plainTextExcerpt, renderContent } from "./blocks";
import {
  renderCartPage,
  renderCheckoutResult,
  renderHome,
  renderNotFound,
  renderProductPage,
  renderShop,
  renderSingle,
  renderTestCheckout,
} from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("block rendering", () => {
  it("renders paragraph, heading, list, quote, image and code blocks", () => {
    const content = [
      "<!-- wp:paragraph --><p>Hello <strong>world</strong></p><!-- /wp:paragraph -->",
      '<!-- wp:heading {"level":3} --><h3>Section</h3><!-- /wp:heading -->',
      "<!-- wp:list --><ul><li>one</li><li>two</li></ul><!-- /wp:list -->",
      "<!-- wp:quote --><blockquote>Quoted</blockquote><!-- /wp:quote -->",
      '<!-- wp:image {"url":"https://example.com/a.png","alt":"Alt text"} /-->',
      "<!-- wp:code --><pre><code>const x = 1;</code></pre><!-- /wp:code -->",
      "<!-- wp:separator /-->",
    ].join("\n");
    const html = renderContent(content);
    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<h3>Section</h3>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<blockquote>Quoted</blockquote>");
    expect(html).toContain('<img src="https://example.com/a.png" alt="Alt text">');
    expect(html).toContain("<pre><code>const x = 1;</code></pre>");
    expect(html).toContain("<hr>");
  });

  it("renders unknown blocks' inner HTML unchanged and strips scripts", () => {
    const content =
      '<!-- wp:gallery --><figure><img src="x.png"></figure><!-- /wp:gallery -->' +
      '<script>alert("xss")</script>' +
      '<!-- wp:paragraph --><p onclick="evil()">Safe</p><!-- /wp:paragraph -->';
    const html = renderContent(content);
    expect(html).toContain('<figure><img src="x.png"></figure>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<p>Safe</p>");
  });

  it("returns classic content as stored when there are no blocks", () => {
    expect(renderContent("<p>Classic</p>")).toBe("<p>Classic</p>");
    expect(renderContent("plain text")).toBe("plain text");
  });

  it("plainTextExcerpt strips block comments and tags (M10 shop fix)", () => {
    const content =
      '<!-- wp:paragraph --><p>Five vinyl stickers for your laptop. Ships nowhere.</p><!-- /wp:paragraph -->' +
      '<!-- wp:paragraph --><p>Second paragraph.</p><!-- /wp:paragraph -->';
    const excerpt = plainTextExcerpt(content);
    expect(excerpt).toBe("Five vinyl stickers for your laptop. Ships nowhere. Second paragraph.");
    expect(excerpt).not.toContain("wp:paragraph");
    expect(excerpt).not.toContain("<p>");
    expect(plainTextExcerpt("plain text")).toBe("plain text");
    expect(plainTextExcerpt("x".repeat(250), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("public pages", () => {
  it("home lists published posts only, with escaped titles", async () => {
    await createPost(tdb.db, { title: "Public <script>", content: "Body", authorId: 1, status: "publish" });
    await createPost(tdb.db, { title: "Draft One", content: "Body", authorId: 1, status: "draft" });
    const page = await renderHome(tdb.db, 1);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Public &lt;script&gt;");
    expect(page.html).not.toContain("<script>");
    expect(page.html).not.toContain("Draft One");
    expect(page.html).toContain('href="/feed"');
  });

  it("single post page renders blocks and escapes the title", async () => {
    const post = await createPost(tdb.db, {
      title: "A & B",
      content: "<!-- wp:paragraph --><p>Body text</p><!-- /wp:paragraph -->",
      authorId: 1,
      status: "publish",
    });
    const page = await renderSingle(tdb.db, post);
    expect(page.status).toBe(200);
    expect(page.html).toContain("<title>A &amp; B — Wordless</title>");
    expect(page.html).toContain("<p>Body text</p>");
    expect(page.html).toContain("Leave a reply");
  });

  it("404 page returns status 404 with a home link", async () => {
    const page = await renderNotFound(tdb.db);
    expect(page.status).toBe(404);
    expect(page.html).toContain("Page not found");
    expect(page.html).toContain('href="/"');
  });
});

describe("shop pages (M8)", () => {
  it("shop lists published products with prices, not drafts", async () => {
    await createProduct(tdb.db, {
      name: "Pack Hoodie",
      description:
        "<!-- wp:paragraph --><p>Warm hoodie with the pack logo.</p><!-- /wp:paragraph -->",
      priceMinor: 125000,
      currency: "NGN",
      stock: 5,
      status: "published",
    });
    await createProduct(tdb.db, {
      name: "Hidden Draft",
      priceMinor: 100,
      currency: "NGN",
      stock: 1,
      status: "draft",
    });
    const page = await renderShop(tdb.db, 1);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Pack Hoodie");
    expect(page.html).toContain("₦1,250.00");
    expect(page.html).toContain("Warm hoodie with the pack logo.");
    expect(page.html).not.toContain("wp:paragraph");
    expect(page.html).not.toContain("Hidden Draft");
  });

  it("product page shows price, stock note, add-to-cart and share links", async () => {
    const product = await createProduct(tdb.db, {
      name: "Low Stock Tee",
      description: "<p>Soft tee.</p>",
      priceMinor: 250000,
      currency: "NGN",
      stock: 2,
      status: "published",
    });
    const page = await renderProductPage(tdb.db, product);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Low Stock Tee");
    expect(page.html).toContain("₦2,500.00");
    expect(page.html).toContain("Only 2 left");
    expect(page.html).toContain("Add to cart");
    expect(page.html).toContain("twitter.com/intent/tweet");
  });

  it("cart page lists lines with totals and a checkout form", async () => {
    const product = await createProduct(tdb.db, {
      name: "Pack Hoodie",
      priceMinor: 125000,
      currency: "NGN",
      stock: 5,
      status: "published",
    });
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 2);
    const page = await renderCartPage(tdb.db, await getCart(tdb.db, token));
    expect(page.status).toBe(200);
    expect(page.html).toContain("Pack Hoodie");
    expect(page.html).toContain("₦2,500.00");
    expect(page.html).toContain('action="/shop/checkout"');
  });

  it("test checkout and success pages name the order and the test-mode caveat", async () => {
    const product = await createProduct(tdb.db, {
      name: "Pack Hoodie",
      priceMinor: 125000,
      currency: "NGN",
      stock: 5,
      status: "published",
    });
    const token = newCartToken();
    await addToCart(tdb.db, token, product.id, 1);
    const order = await createOrderFromCart(tdb.db, token, {
      customerName: "Ada",
      customerEmail: "ada@example.test",
    });
    const testPage = await renderTestCheckout(tdb.db, order, `mock_${order.id}`);
    expect(testPage.html).toContain("no money moves");
    expect(testPage.html).toContain(order.id);
    const success = await renderCheckoutResult(tdb.db, { ...order, status: "paid" });
    expect(success.html).toContain("Thank you");
    expect(success.html).toContain(order.id);
  });
});
