# WordPress import (Milestone 9)

Wordless can import a WordPress site's **content** from two formats:
a WordPress eXtended RSS export (WXR) or a mysqldump-style SQL file.
Both run as admin-only `wl_jobs` jobs and produce a per-item report
— nothing is silently dropped.

> **The importer parses data only.** It never executes PHP, never
> evaluates imported code, and never unserializes PHP objects. A
> WordPress *plugin or theme* is not imported here — converting code
> is the M4 conversion engine's job.

![Admin Import page](../screenshots/admin-import.png)
*The admin Import page — WXR and SQL-dump import, with the synthetic
test fixtures linked for a trial run.*

## Formats

| Format | Endpoint | Limit | Parser |
|---|---|---|---|
| WXR (XML) | `POST /api/import/wxr` | 10 MB multipart upload | `fast-xml-parser` (a real XML parser — never regex) |
| SQL dump | `POST /api/import/sql` | 10 MB multipart upload | hand-written mysqldump parser (`sql-parser.ts`) |

Both endpoints store the uploaded file in R2 under
`imports/<jobId>-<filename>`, create a `wl_jobs` job (`import_wxr`
/ `import_sql`), and run it synchronously in local dev. The job
result is the import report; `GET /api/import/jobs/:id` polls it.

## What is imported

| Source | Destination | Notes |
|---|---|---|
| WXR / SQL authors and `wp_users` | Users | Forced password reset (see below); `wp_capabilities` serialized array becomes a JSON object the roles system reads |
| WXR categories/tags and `wp_terms` + `wp_term_taxonomy` + `wp_term_relationships` | Terms | Category parents remapped in a second pass (`wp:category_parent` is a **slug**, not an ID); `post_tag` maps to the `tag` taxonomy |
| WXR items and `wp_posts` | Posts / pages / attachments | Block content preserved verbatim; status mapping below; original dates kept; revisions skipped |
| `wp_postmeta` / `wp_commentmeta` / `wp_usermeta` | Meta tables | PHP-serialized values become JSON (see below) |
| WXR comments and `wp_comments` | Comments | Parents remapped in a second pass; `comment_count` refreshed; moderation follows the site's settings |
| WXR attachments | Media (R2) | URL fetched to R2 + attachment post; a failed fetch is recorded per item, never silently dropped |
| `wp_options` | Options | Serialized values become JSON; `wl_*` options are **never overwritten** |

### Status mapping

- `publish` / `draft` / `private` / `trash` — kept as-is.
- `inherit` on an attachment — becomes `publish`.
- Anything else — becomes `draft`, with a note in the report.

### Comment approval

- `1` → approved, `0` → pending, `spam` → spam. Anything else is
  treated as pending and noted.

## PHP serialized values

`wp_options`, `wp_postmeta`, `wp_usermeta` (and the SQL import's
meta tables) often hold PHP-serialized strings. The safe
unserializer (`src/modules/importer/php-serialize.ts`):

- parses scalars (strings, ints, floats, bools, null) and arrays,
  nested to any depth, with strict length checks;
- **refuses `O:` / `C:` objects and `r:` / `R:` references** with a
  `PhpUnserializeError` — the item is recorded as failed with a
  reason, never evaluated;
- treats a string shaped like a serialized value (`^[A-Za-z]:` or
  `N;`) strictly: an unknown type or malformed payload throws
  (recorded as failed); anything else is a plain string returned
  unchanged.

Serialized arrays become JSON objects/arrays in D1 — Wordless
stores option values as JSON, never as PHP-serialized strings.

## The forced-reset rule

**WordPress phpass hashes are not portable.** There is no way to
verify a phpass hash against a Wordless PBKDF2 hash, so every
imported user gets:

- an empty password (they cannot log in with the old password, or
  with any password), and
- the `wl_password_reset_required` usermeta flag.

An administrator must reset the password (the admin Users page, or
`POST /api/users/:id/reset-password`, which clears the flag) before
the imported user can sign in. The importer never invents a
temporary password and never emails one.

## SQL dump parsing

`src/modules/importer/sql-parser.ts` splits a mysqldump file into
statements respecting quotes and comments — comment text is dropped
before statement matching (a `--` comment used to break `^INSERT`
matching on the first/last statements) — and parses
`INSERT INTO <table> [(cols)] VALUES (...), (...)` with MySQL
backslash escapes and `''`.

Only the 12 core `wp_*` tables are imported, with canonical column
orders taken from WordPress 7.1.5's `schema.php`:

`wp_posts`, `wp_postmeta`, `wp_users`, `wp_usermeta`, `wp_terms`,
`wp_term_taxonomy`, `wp_term_relationships`, `wp_comments`,
`wp_commentmeta`, `wp_links`, `wp_options`, `wp_termmeta`.

Any other table (e.g. a plugin's `wp_custom_plugin`) is reported as
**ignored** in the report, and its VALUES are never parsed. Original
IDs are kept when free; when an ID collides with an existing row a
new ID is allocated and the mapping is applied to every reference
(terms, relationships, comment parents, post parents).

## What is NOT imported

- **Multisite tables** (`wp_blogs`, `wp_site`, `wp_sitemeta`, …) —
  Wordless is single-site; multisite is deferred.
- **Plugin tables** — any table that is not one of the 12 core
  `wp_*` tables is ignored and reported.
- **Uploads binary blobs** — attachments are fetched by URL (WXR)
  or referenced by GUID (SQL); the binary contents of a WordPress
  `wp-content/uploads` directory are not part of either format and
  must be uploaded separately (or re-fetched from the live site's
  URLs).
- **Serialized PHP objects** — refused and recorded (see above).
- **Post revisions** — skipped (Wordless has its own revision
  system; importing every revision would duplicate it).
- **Plugin/theme code** — use the M4 conversion engine instead.

## The report

Every import returns a per-item report:

```json
{
  "counts": { "users": { "imported": 2, "skipped": 0, "failed": 0 } },
  "items": [
    { "type": "user", "sourceId": "admin", "status": "imported", "note": "forced password reset" }
  ],
  "ignoredTables": ["wp_custom_plugin"],
  "errors": []
}
```

`counts` is per type (users, terms, posts, comments, attachments,
options, meta). `items` carries one entry per source item with
`imported` / `skipped` / `failed` and a human-readable note. A
failed item never aborts the whole import — the job continues and
the failure is in the report.

## Test fixtures

`test/fixtures/wordpress/` carries a synthetic WXR export and SQL
dump, generated by `scripts/generate-wp-fixture.mjs` from the
WordPress 7.1.5 schema (the reference source in
`~/workspace/wordless/reference/wordpress-7.1.5/` is read-only and
was never modified). The fixtures cover:

- 2 authors, 2 categories (one with a parent slug), 2 tags,
- a post, a page, an attachment and a revision (skipped),
- 2 comments including a reply,
- a serialized postmeta value and a serialized option,
- a serialized **object** option (proves the refusal path),
- a non-core `wp_custom_plugin` table (proves ignored-reporting).

Tests prove the full round-trip: fixture → import → counts match,
the serialized option lands as JSON, and an imported user cannot
log in with the old password and carries the forced-reset flag.
The admin Import page links to both fixtures (on GitHub, after the
M9 push) so a site owner can test an import before touching real
data.
