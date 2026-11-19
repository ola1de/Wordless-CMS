/**
 * Inline-PHP evaluator tests (Milestone 10).
 *
 * Proves the allowlisted evaluator handles every construct Twenty
 * Twenty-Five's patterns actually use (the twelve i18n/escaping
 * functions, string literals, concatenation, printf %s) and refuses
 * everything else — variables, unknown functions, includes, eval,
 * dynamic code — without executing anything.
 */
import { describe, expect, it } from "vitest";
import { evaluatePatternPhp, ksesPost } from "./pattern-php";

describe("evaluatePatternPhp — the Twenty Twenty-Five constructs", () => {
  it("echoes esc_html_e / esc_attr_e literals (escaped)", () => {
    expect(evaluatePatternPhp(`<p><?php esc_html_e( 'Blog', 'twentytwentyfive' ); ?></p>`)).toBe(
      "<p>Blog</p>",
    );
    expect(
      evaluatePatternPhp(`<p title="<?php esc_attr_e( 'A "quoted" title', 't' ); ?>">x</p>`),
    ).toBe(`<p title="A &quot;quoted&quot; title">x</p>`);
  });

  it("evaluates __ / _x / esc_html__ / esc_html_x as values", () => {
    expect(evaluatePatternPhp(`<?php echo esc_html_x( 'Search', 'label', 't' ); ?>`)).toBe("Search");
    expect(evaluatePatternPhp(`<?php echo __( 'Hello & goodbye', 't' ); ?>`)).toBe("Hello & goodbye");
    expect(evaluatePatternPhp(`<?php echo esc_html__( 'A <b>bold</b> claim', 't' ); ?>`)).toBe(
      "A &lt;b&gt;bold&lt;/b&gt; claim",
    );
  });

  it("evaluates printf with %s and %%", () => {
    expect(
      evaluatePatternPhp(
        `<?php printf( esc_html__( 'Designed with %s.', 't' ), '<a href="https://wordpress.org">WordPress</a>' ); ?>`,
      ),
    ).toBe(`Designed with <a href="https://wordpress.org">WordPress</a>.`);
    expect(evaluatePatternPhp(`<?php printf( '100%% sure %s', 'yes' ); ?>`)).toBe("100% sure yes");
  });

  it("evaluates wp_kses_post (safe tags kept, script dropped)", () => {
    expect(
      evaluatePatternPhp(
        `<?php echo wp_kses_post( _x( 'Got questions? <br><a href="#">Ask us</a>', 't' ) ); ?>`,
      ),
    ).toBe(`Got questions? <br /><a href="#">Ask us</a>`);
    expect(
      evaluatePatternPhp(`<?php echo wp_kses_post( 'Safe <script>alert(1)</script> text' ); ?>`),
    ).toBe("Safe  text");
  });

  it("evaluates get_template_directory_uri as empty and notifies once", () => {
    let notified = 0;
    const out = evaluatePatternPhp(
      `<img src="<?php echo esc_url( get_template_directory_uri() ); ?>/assets/a.webp"><img src="<?php echo esc_url( get_template_directory_uri() ); ?>/assets/b.webp">`,
      { onAssetUri: () => notified++ },
    );
    expect(out).toBe(`<img src="/assets/a.webp"><img src="/assets/b.webp">`);
    expect(notified).toBe(1);
  });

  it("evaluates concatenation and multiple statements", () => {
    expect(
      evaluatePatternPhp(`<?php echo esc_url( get_template_directory_uri() . '/assets/x.webp' ); ?>`),
    ).toBe("/assets/x.webp");
    expect(
      evaluatePatternPhp(`<?php esc_html_e( 'One', 't' ); ?>-<?php esc_html_e( 'Two', 't' ); ?>`),
    ).toBe("One-Two");
  });

  it("supports <?= short echo tags", () => {
    expect(evaluatePatternPhp(`<?= esc_html__( 'Hi', 't' ) ?>`)).toBe("Hi");
  });

  it("skips translator comments inside printf calls", () => {
    expect(
      evaluatePatternPhp(
        `<?php printf( /* translators: %s is the brand. */ esc_html__( 'Made by %s', 't' ), 'Us' ); ?>`,
      ),
    ).toBe("Made by Us");
  });
});

describe("evaluatePatternPhp — refusals (never executed)", () => {
  const cases: Array<[string, string]> = [
    ["variable", `<?php echo $user_input; ?>`],
    ["unknown function", `<?php echo get_option( 'blogname' ); ?>`],
    ["system call", `<?php system( 'id' ); ?>`],
    ["include", `<?php include 'evil.php'; ?>`],
    ["eval", `<?php eval( '1+1' ); ?>`],
    ["method call", `<?php echo $post->post_title; ?>`],
    ["interpolated string", `<?php echo "hi $name"; ?>`],
    ["positional printf", `<?php printf( '%1$s', 'x' ); ?>`],
    ["unterminated string", `<?php echo 'oops; ?>`],
    ["bare control flow", `<?php if ( true ) { echo 'x'; } ?>`],
  ];
  for (const [label, snippet] of cases) {
    it(`refuses: ${label}`, () => {
      expect(evaluatePatternPhp(snippet)).toBeNull();
    });
  }

  it("refuses javascript: URLs from esc_url", () => {
    expect(evaluatePatternPhp(`<?php echo esc_url( 'javascript:alert(1)' ); ?>`)).toBe("");
  });
});

describe("ksesPost", () => {
  it("keeps allowlisted tags/attrs and drops the rest", () => {
    expect(ksesPost(`<p class="x">A <strong>bold</strong> <a href="https://example.com" onclick="evil()">link</a></p>`)).toBe(
      `<p class="x">A <strong>bold</strong> <a href="https://example.com">link</a></p>`,
    );
    expect(ksesPost(`<div><p>kept text</p></div>`)).toBe("<p>kept text</p>");
    expect(ksesPost(`<a href="javascript:alert(1)">x</a>`)).toBe("<a>x</a>");
  });
});
