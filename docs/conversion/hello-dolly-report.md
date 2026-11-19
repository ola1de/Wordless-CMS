# Hello Dolly — conversion report (Milestone 4)

The first end-to-end conversion the Wordless engine produced: the Hello
Dolly plugin bundled with WordPress 7.1.5 (2,669 bytes, 107 lines), turned
into a real working Wordless extension at `examples/hello-dolly/`. The
generated module is the converter's own output, checked in as the fixture
result — it is not hand-written, and a test asserts it matches a fresh
conversion byte for byte.

## Result at a glance

| | |
|---|---|
| Source | `hello.php` (WordPress 7.1.5 bundled plugin), 2,669 bytes / 107 lines |
| AST | 64 nodes · 3 functions · 0 classes · 2 hooks |
| Converted | 3 / 3 functions, 2 / 2 hooks |
| Unconverted | **0** |
| Warnings | **0** |
| Transformed | 1 (the ABSPATH guard) |
| Output | 5,001 bytes of TypeScript (`examples/hello-dolly/index.ts`) |
| Duration | ~11 ms (lex → parse → emit, in-process) |

## What converted cleanly

- **All three functions**: `hello_dolly_get_lyric()`, `hello_dolly()`,
  `dolly_css()` — renamed to camelCase (`helloDollyGetLyric`,
  `helloDolly`, `dollyCss`) and given the WordPress API (`wp`) as their
  first parameter.
- **Both hooks**: `add_action('admin_notices', 'hello_dolly')` and
  `add_action('admin_head', 'dolly_css')` became registrations in the
  generated module's `activate(wp)`, which registers them with the kernel.
- **Built-in mappings**: `explode()` → `split()`, `count()` → length,
  `mt_rand()` → `__rand()` (inclusive, same semantics), `substr()` →
  `__substr()` (PHP negative-start/length semantics), `printf()` →
  `__sprintf()` (minimal `%s %d` support), `__()` → `wp.__()`,
  `wptexturize()` → `wp.wptexturize()`, `get_user_locale()` →
  `wp.get_user_locale()`.
- **`echo`/`printf` output**: collected into the `__out` buffer and
  returned as a string. The `admin_notices` action callback's output is
  captured into the module's `renderedOutput` array, so invoking the hook
  returns the lyric markup.

## What was flagged

Nothing was flagged as unconverted, and there are no warnings. One thing
was **transformed**:

- **The ABSPATH guard (line 17)** — `if ( ! defined( 'ABSPATH' ) ) { exit; }`
  was removed with a note in the generated module. Wordless extensions are
  never loaded directly (they load only through the extension API), so the
  guard has no meaning here. The converter treats `exit;` and `die();`
  guards identically (the upstream 6.9.1 copy uses `die();`).

## How it was verified

- The generated output typechecks (`tsc`, strict) — tested in
  `src/conversion/emitter.test.ts`.
- The checked-in fixture matches a fresh conversion exactly
  (determinism test in the same file).
- Runtime test (`examples/hello-dolly/hello-dolly.test.ts`): `activate(wp)`
  registers the hooks; `do_action("admin_notices")` returns a lyric line
  (`<p id="dolly">…</p>`); `do_action("admin_head")` returns the
  `<style>` block; 50 calls to `helloDollyGetLyric()` return more than one
  distinct lyric.
- The conversion job path was smoke-tested end to end over the API
  (fixture job → done → extension installed and active).

## How to enable it

Convert the fixture — in the admin at **Conversion → Convert the Hello
Dolly fixture**, or `POST /api/conversion/jobs` with
`{ "fixture": "hello-dolly" }` (administrator, `install_plugins`). The job
installs the extension row (`wl_extensions`, status `active`) and calls
`activate(wp)`, which registers the two hooks with the kernel's hook
registry for the running isolate. A cold start does not re-activate
extensions — per-request extension loading at Worker startup is a later
milestone.

## What this does NOT prove

Hello Dolly is the easiest possible plugin: three small procedural
functions, no classes, no database, no HTTP, no options, no
`$_POST`/`$_GET`. It proves the pipeline works end to end (lex → parse →
emit → register → run), not that any plugin converts. See
`docs/conversion/akismet-analysis.md` for what a real-world plugin faces:
11 classes, external HTTP calls and `$wpdb` — none of which M4 converts.
