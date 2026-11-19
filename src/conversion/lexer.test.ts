import { describe, expect, it } from "vitest";
import { lexPhp } from "./lexer";

describe("PHP lexer (M4)", () => {
  it("tokenizes open/close tags, functions, variables and calls", () => {
    const { tokens } = lexPhp(`<?php
function hello_dolly_get_lyric() {
  $lyrics = "Hello, Dolly";
  return $lyrics;
}
`);
    const kinds = tokens.map((t) => `${t.kind}:${t.value}`);
    expect(kinds[0]).toBe("open_tag:<?php");
    expect(kinds).toContain("ident:function");
    expect(kinds).toContain("var:lyrics");
    expect(kinds).toContain("string:Hello, Dolly");
    expect(kinds[kinds.length - 1]).toBe("eof:");
  });

  it("decodes double-quoted escapes and keeps single-quoted escapes literal", () => {
    const { tokens } = lexPhp(`<?php $a = "x\\ny"; $b = 'it\\'s'; $c = 'a\\\\b';`);
    const strings = tokens.filter((t) => t.kind === "string").map((t) => t.value);
    expect(strings[0]).toBe("x\ny");
    expect(strings[1]).toBe("it's");
    expect(strings[2]).toBe("a\\b");
  });

  it("splits interpolated strings into text/var parts", () => {
    const { tokens } = lexPhp(`<?php $s = "Hello $name, welcome";`);
    const tok = tokens.find((t) => t.kind === "interp_string");
    expect(tok).toBeDefined();
    expect(tok?.parts).toEqual([
      { kind: "text", value: "Hello " },
      { kind: "var", value: "name" },
      { kind: "text", value: ", welcome" },
    ]);
  });

  it("marks complex interpolation as complex, not var", () => {
    const { tokens } = lexPhp(`<?php $s = "Hello {$user->name}";`);
    const tok = tokens.find((t) => t.kind === "interp_string");
    expect(tok?.parts?.some((p) => p.kind === "complex")).toBe(true);
  });

  it("tokenizes backticks, heredoc and nowdoc", () => {
    const { tokens } = lexPhp("<?php $a = `ls`; $b = <<<EOT\nhello\nEOT;\n$c = <<<'NOW'\nraw $x\nNOW;");
    expect(tokens.some((t) => t.kind === "backtick" && t.value === "ls")).toBe(true);
    const heredoc = tokens.find((t) => t.kind === "heredoc" && t.heredocLabel === "EOT");
    expect(heredoc?.value).toBe("hello");
    const nowdoc = tokens.find((t) => t.kind === "heredoc" && t.isNowdoc === true);
    expect(nowdoc?.value).toBe("raw $x");
  });

  it("emits inline_html between close and open tags", () => {
    const { tokens } = lexPhp(`<?php echo "a"; ?>\n<p>hi</p>\n<?php echo "b"; ?>`);
    const html = tokens.filter((t) => t.kind === "inline_html");
    expect(html).toHaveLength(1);
    expect(html[0]?.value).toBe("<p>hi</p>\n");
  });

  it("collects comments and tracks line numbers", () => {
    const { tokens, comments } = lexPhp(`<?php
// a line comment
/* a block */
$x = 1;`);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.text).toBe("// a line comment");
    const varTok = tokens.find((t) => t.kind === "var");
    expect(varTok?.pos.line).toBe(4);
  });

  it("throws a LexError on an unterminated string", () => {
    expect(() => lexPhp(`<?php $a = "never closed;`)).toThrow(/Unterminated string/);
  });

  it("tokenizes arrays, arrows and scope operators", () => {
    const { tokens } = lexPhp(`<?php $a = array('k' => 1); $b = $a['k']; $c->m(); D::E;`);
    const puncts = tokens.filter((t) => t.kind === "punct").map((t) => t.value);
    expect(puncts).toContain("=>");
    expect(puncts).toContain("->");
    expect(puncts).toContain("::");
  });
});
