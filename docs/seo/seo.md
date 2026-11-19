# SEO (Milestone 7)

Wordless has a content-studio + SEO engine, not an SEO plugin. Every
number it reports is computed from the site's own stored content.
Nothing is a ranking, a traffic estimate, or a guess about what a
search engine will do.

## Per-post SEO fields

Stored as `wp_postmeta` (keys `_wl_seo_*`), editable in the block
editor's SEO panel and via `GET/PUT /api/posts/:id/seo` (`edit_posts`).
The post detail payload (`GET /api/posts/:slug`) includes the fields.

| Field | Meta key | Validation |
|---|---|---|
| SEO title | `_wl_seo_title` | ≤ 70 chars |
| Meta description | `_wl_seo_description` | ≤ 160 chars |
| Focus keyword | `_wl_seo_focus_keyword` | ≤ 100 chars |
| Canonical URL | `_wl_seo_canonical` | valid http(s) URL, or empty |
| Noindex | `_wl_seo_noindex` | `"1"` when set, deleted when cleared |
| OG title | `_wl_seo_og_title` | ≤ 70 chars |
| OG description | `_wl_seo_og_description` | ≤ 160 chars |
| OG image | `_wl_seo_og_image_id` | an attachment id that exists (0 = none) |
| Twitter card | `_wl_seo_twitter_card` | `summary` or `summary_large_image` |

An empty string clears a field (the meta row is deleted). Validation
failures return a 400 naming the field; nothing is partially written.

The editor panel shows live character counts and a Google-style
snippet preview. The preview is labelled as a preview: it is an
approximation of how a search result *might* look, never a real
ranking.

## Head tags

Every public page renders (in `src/modules/seo/head.ts`, computed once
in `render/service.ts` `finishPage`):

- `<title>` — SEO title if set, else the post/page title, else the site
  title. The site name is appended by the renderer.
- `<meta name="description">` — SEO description, else the excerpt, else
  the tagline.
- `<link rel="canonical">` — the SEO canonical, else the page's own URL.
  Search and 404 pages get no canonical and a noindex robots meta.
- `<meta name="robots" content="noindex, follow">` — only when the post
  is flagged noindex (or on search/404 pages).
- Open Graph tags (`og:title`, `og:description`, `og:type`, `og:url`,
  `og:image` when an OG image attachment exists) and Twitter Card tags
  (`twitter:card`, `twitter:title`, `twitter:description`).
- JSON-LD: `WebSite` on every page, `Article` on single posts (with the
  author's display name when the author exists), `BreadcrumbList` on
  single posts and archives.

All values are HTML-escaped. JSON-LD escapes `<`, `>` and `&` as
`\u003c` / `\u003e` / `\u0026`, so a hostile title renders as text,
never markup.

## Analysis score

`GET /api/posts/:id/seo/analysis` (`edit_posts`) runs deterministic
checks over the stored post content and SEO fields. There are **9
checks when no focus keyword is set, 12 when one is set** — without a
keyword the four keyword-placement checks collapse into a single
"no focus keyword set" warning.

| Check | Pass | Warn | Fail |
|---|---|---|---|
| Title length | 30–70 chars | 1–29 or 71+ | missing |
| Meta description | 50–160 chars | 1–49 or 161+ | missing |
| Focus keyword (no keyword set) | — | no keyword set | — |
| Keyword in title | present | — | missing |
| Keyword in first paragraph | present | — | missing |
| Keyword in slug | present | missing (warn) | — |
| Keyword in headings | present | missing (warn) | — |
| Heading structure | no H1 in content, levels in order (no headings at all is fine) | skipped levels | an H1 in the content |
| Image alt coverage | all images have alt (no images = pass) | — | ≥1 image without alt |
| Internal links | ≥1 | 0 | — |
| Word count | ≥300 | 100–299 | <100 |
| Readability (Flesch reading-ease, estimate) | ≥60 | 30–59, or too little text to estimate | <30 |
| Canonical | set | missing | — |

**Score formula** (documented in `src/modules/seo/analyze.ts`):

```
score = round(100 · (passes + 0.5 · warns) / number of checks run)
```

- An empty post scores exactly 50: 9 checks run (no keyword), with
  2 passes (headings, images), 5 warns (title, keyword, internal
  links, readability, canonical) and 2 fails (description, word
  count) — (2 + 2.5) / 9 = 0.5.
- Keyword matching normalises hyphens to spaces, so a slug
  `winter-training` matches the keyword "winter training".
- The M6 seo-auditor agent uses this engine: its data output is this
  analysis (average score across the posts it checked) and its summary
  names the score.

The score is a **content-quality score from stored content**. It is not
a ranking prediction, not a traffic estimate, and not a promise about
search-engine behaviour.

## Sitemap (`GET /sitemap.xml`)

URLs: home page, published posts/pages, term archives with content.

| URL | changefreq | priority |
|---|---|---|
| Home | daily | 1.0 |
| Post updated < 7 days ago | daily | 0.9 |
| Post updated < 30 days ago | weekly | 0.8 |
| Post updated < 365 days ago | monthly | 0.6 |
| Post older than a year | yearly | 0.5 |
| Page | monthly | 0.7 |
| Term archive | weekly | 0.5 |

`<lastmod>` comes from each post/page/term's updated date. Image
entries (`<image:image>`) are included for posts whose content
references attachments via `wp:image {"id":N}` blocks — only
attachments that exist, max 10 per URL.

**Pagination.** Above 1,000 URLs the sitemap becomes an index:
`GET /sitemap.xml` returns `<sitemapindex>` with one
`<sitemap>` per page (`/sitemap.xml?page=N`); each page holds at most
1,000 `<url>` entries. Total cap: 50,000 URLs.

## robots.txt (`GET /robots.txt`, `GET/PUT /api/seo/robots`)

Default (when no custom text is stored): allow all + a sitemap line.
Custom text is stored in the `wl_robots_txt` option (max 10,000 chars)
and must use only the directives `User-agent`, `Allow`, `Disallow`,
`Sitemap`, `Crawl-delay`. Rules that would block `/admin` or `/api`
are rejected — including `Disallow: /` — so a typo can never lock the
admin out. A sitemap line is appended when the stored text has none.

## Redirects and the 404 log (admin `#/seo`)

- **Redirects** live in the M2 `wl_redirects` table. Create/edit/delete
  via `GET/POST/PUT/DELETE /api/seo/redirects` (`manage_options`).
  `oldPath` must start with `/` and differ from `newPath`; `newPath`
  may be a path or an absolute http(s) URL. Renaming a published
  post's slug still creates a redirect automatically (M2 behaviour).
- **404 log** (`wl_404_log`, migration `0007_m7.sql`): one row per
  public 404 path, with referrer, hit count, first/last seen. The log
  keeps the 500 most recently seen paths (pruned on insert).
  **Query strings and fragments are stripped before logging**, so
  tokens and passwords never land in the log. System paths are not
  logged: `/favicon.ico`, `/api*`, `/admin*`, `/media/`,
  `/theme.css`, `/feed`, `/sitemap*`, `/robots.txt`.
  A 404 row has a one-click "Create redirect" that prefills the source
  path. Entries can be dismissed individually
  (`DELETE /api/seo/404s?path=…`).

## Content studio (admin `#/studio`)

- **Editorial calendar** (`GET /api/seo/calendar?days=1–90`, default
  30): stored posts grouped by date, today through `days − 1`. There
  is no "future" post status yet — a draft with a future date *is* the
  schedule.
- **Content ideas** go through the real M6 content-writer AI task API
  (`POST /api/ai/tasks`). When no provider is configured the page says
  so and offers the mock provider for local dev. Ideas are never faked.
  An approved `create_post` proposal opens the new draft directly in
  the block editor.
- **Content templates** (`GET /api/seo/templates`,
  `POST /api/seo/templates/:slug/create`, `edit_posts`): three built-in
  templates — `announcement`, `how-to`, `news-update` — each creating a
  real draft post with Gutenberg block-comment HTML.

## Yoast / Rank Math metadata import

`POST /api/seo/import` (`manage_options`), body `{ posts: [...] }`,
max 500 rows. Each row: `{ postId?: number, slug?: string, meta: {...} }`.
Matched by post ID first, then slug. Recognised keys:

- Wordless: `_wl_seo_*` (the field names above).
- Yoast SEO: `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`,
  `_yoast_wpseo_focuskw`, `_yoast_wpseo_canonical`,
  `_yoast_wpseo_meta-robots-noindex` (`"1"` = noindex),
  `_yoast_wpseo_opengraph-title`, `_yoast_wpseo_opengraph-description`,
  `_yoast_wpseo_opengraph-image`, `_yoast_wpseo_twitter-card`.
- Rank Math: `rank_math_title`, `rank_math_description`,
  `rank_math_focus_keyword`, `rank_math_canonical_url`,
  `rank_math_robots` (array or comma-separated string containing
  `noindex`), `rank_math_facebook_title`, `rank_math_facebook_description`,
  `rank_math_facebook_image`, `rank_math_twitter_card_type`.

Every row is validated through the same validator as the SEO endpoint.
The response is `{ applied, skipped: [{ post, reason }] }`: unknown
posts, invalid values and rows with no post identity are skipped with a
reason; unknown keys are reported per row and never silently dropped
(the row still applies its known keys).

## What is NOT done

- **No live search-engine submission.** Wordless never pings Google,
  Bing or any index. There is no Search Console integration.
- **No rank tracking, no traffic, no analytics.** The analysis score is
  computed from stored content only.
- **No "future" post status** (see the calendar note above).
- **No FTS5/full-text search** — search is still LIKE-based (M2).
- **No pattern rendering** — block themes built from `wp:pattern`
  blocks (e.g. Twenty Twenty-Five) still render nearly empty (M5 gap).
- **No commerce** — email sending, payments, analytics and social
  publishing are Milestone 8.
