# Classic-theme conversion (Milestone 5)

Wordless cannot execute PHP, so a classic theme is **never converted
wholesale**. Importing one (`POST /api/themes/import-classic`, or Admin →
Themes → Import → Classic theme) does three honest things:

1. Parses the `style.css` header (Theme Name, Version, Author, Text
   Domain, …) and imports the stylesheet as the theme's stylesheet — this
   is what the public site actually uses when the classic theme is active.
2. Runs every `.php` file through the M4 static analyser and produces a
   per-file report: **convertible / partial / blocked**, with the template
   tags found, hooks, WordPress API calls, and the reasons for each
   verdict.
3. Stores the report in `wl_themes.report_json` (visible in the admin
   Themes list and via `GET /api/themes/:slug`).

No PHP is executed at any point. No template is converted to a block
template in v1 — the report says what a future conversion would need to
reproduce.

## What converts

A classic theme file is **convertible** when the M4 analyser finds only
constructs the converter understands and no blocked constructs: plain
procedural code, `if/else`, loops, function definitions, `add_action` /
`add_filter`, and WordPress template tags used as plain function calls
(`get_header()`, `the_post()`, `the_title()`, `the_content()`, …).

## What does not

| Verdict | Meaning |
|---|---|
| **partial** | The file uses a construct the analyser understands but the emitter cannot convert yet (e.g. a class — analysed, not converted — or an unmapped WordPress function, which would become a throwing `__unmapped_*` helper). |
| **blocked** | The file contains a construct the safety sandbox rejects (`eval`, `exec`, `shell_exec`, `system`, `unserialize`, backticks, dynamic `include`/`require`), or a parse error (`match` expressions and `fn` arrow functions are not parsed yet). A blocked file fails the analysis with a reason; nothing from it is used. |

WordPress template tags themselves are never a blocker — they are plain
function calls to the analyser. What makes a classic theme hard to
convert in full is not the tags but the PHP around them: classes
(walkers, widgets), direct `$wpdb` use, `query_posts()` / custom
`WP_Query` loops with pagination logic, and output buffering tricks.
Those are reported per file so a human (or a future conversion pass) can
decide what to do with each one.

## Synthetic fixture results

The committed fixture `src/modules/themes/fixtures/classic-sample/` is a
small classic theme authored for the test suite (original code, not a
copy of any WordPress theme): `style.css`, `index.php`, `single.php`,
`functions.php`.

| File | Verdict | Template tags found |
|---|---|---|
| `index.php` | convertible | `get_header`, `have_posts`, `the_post`, `the_title`, `the_content`, `get_footer` |
| `single.php` | convertible | `get_header`, `the_post`, `the_title`, `the_content`, `comments_template`, `get_footer` |
| `functions.php` | convertible | `add_theme_support`, `register_nav_menu`, `add_action`, `wp_enqueue_style`, `get_stylesheet_uri` |

Result: **3 convertible / 0 partial / 0 blocked.** The fixture is
deliberately simple — it proves the analyser and the CSS import work
end to end (the import test activates it and confirms the public
stylesheet contains the fixture's CSS). It does **not** prove that real
classic themes convert cleanly; see the Twenty Twenty-Five verdict
below.

## Real bundled themes (local smoke test only)

The bundled WordPress themes in the reference copy
(`~/workspace/wordless/reference/wordpress-7.1.5/wp-content/themes/`,
read-only, never committed) are block themes, not classic themes, so the
classic importer is not the right tool for them — the **block** importer
is. The M5 smoke test ran the block importer against Twenty Twenty-Five
from the reference path; the verdict is recorded in the milestone report
(see `IMPLEMENTATION_STATUS.md`, M5 section) and is **not** repeated here
as a permanent claim, because the bundled themes change with each
WordPress release. What the smoke test establishes is the importer's
behaviour on a real, large, modern block theme: which `theme.json`
features it accepts, which it records as unsupported, and whether the
theme renders.
