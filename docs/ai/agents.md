# AI agents (Milestone 6)

Wordless ships 15 specialist agents, run from the command centre
(admin `#/ai`) or `POST /api/ai/tasks`. Every agent is a real registered
handler — none is a stub. An agent that depends on a later milestone
reports itself **unavailable** instead of faking a result.

## Provider rule

Agents marked "provider" need a configured AI provider. **Workers AI is
the default and only required provider** (no extra key; the `AI` binding
in `wrangler.toml`). The OpenAI-compatible provider is an optional
fallback. When no provider is configured, provider agents fail their
task honestly with `ai_not_configured` — the UI and API say so plainly.

Agents marked "measured" need no provider: they read the site's real
data and report only what they measured. They never invent numbers.

## Roster

| Agent | Needs | Risk | What it does | What it cannot do yet |
|---|---|---|---|---|
| content-writer | provider | low | Drafts a post on a topic from the site's memory; proposes a **draft** post (never publishes on its own) | Full editorial workflow, SEO scoring of the draft — M7 |
| seo-auditor | measured | low | Counts posts/pages, missing excerpts, missing titles, empty content, short content (under 300 words) | Keyword analysis, meta-description scoring, sitemap checks — M7 |
| security-scanner | measured | medium | Counts administrators, active sessions, pending/spam comments, extensions | Vulnerability scanning, file-integrity checks — M9 |
| performance-analyst | measured | low | Counts posts, revisions (incl. per-post max), media bytes, comments | Real timing budgets, cache-hit analysis — M9 |
| design-advisor | measured | low | Checks the active theme palette against WCAG contrast (4.5:1) and reports fluid typography | Live screenshot review, layout critique — later |
| support-responder | provider | low | Drafts a reply to a visitor's message, labelled as an AI draft | Sending the reply — M8 (email integration) |
| analytics-reporter | measured | low | Posts/comments by status, users by role, media counts | Real visitor analytics — M8 (analytics integration): the integration is config-only; this agent still reports stored counts only, never traffic |
| commerce-assistant | measured | high | **Live since M8.** Reports real store data: product count, orders by status, low-stock warnings (≤5), revenue = sum of paid orders (minor units). Reports only — it never changes the store. | Creating or changing products/orders — never |
| email-composer | provider | low | Drafts an email (subject + body) from a brief, labelled as an AI draft | Sending: drafts only. Sending is via the M8 email integration (mock logs in test mode; HTTP provider when configured) |
| social-composer | provider | low | Drafts a short social post (≤280 chars) from a brief, labelled as an AI draft | Publishing to social accounts — not built; social is share links only (M8) |
| backup-advisor | measured | low | Recommends a backup cadence from the site's content volume and revision counts | Actually backing up or restoring — M9 |
| migration-assistant | measured | low | Reports content counts and conversion-job history as migration readiness | Importing WordPress content (WXR) — M9 |
| accessibility-checker | measured | low | Alt-text coverage on media, empty post titles, `<h1>` usage in a 20-post sample | Full WCAG audit, ARIA checks — later |
| code-reviewer | measured | medium | Reviews installed extensions and conversion reports, flagging partial/blocked items | Live code review of arbitrary code — later |
| research-assistant | provider | low | Researches a topic from the site's memory and proposes a **draft** post; every factual claim in the draft is labelled as needing verification | Live web research, citations — later |

## Operating modes

Modes are enforced by the orchestrator, not the UI:

- **manual** — the agent only drafts and reports; nothing is applied.
- **supervised** (default) — every proposal becomes a pending approval
  in `wl_ai_approvals`; nothing is applied until an admin approves it.
- **autonomous** — low-risk proposals apply automatically; medium- and
  high-risk proposals still become approvals.

Approving applies the proposal through the existing services (a draft
post via the posts service, an option update via the options service
with an allow-list, a term via the terms service, a theme variation via
the themes service). Approving applies **first** and only marks the row
approved on success — a failed apply leaves the approval pending, so a
half-applied action can never be marked approved.

## Proposals

An agent may propose one of these action types (each carries a summary,
a risk level and a payload):

- `create_post` — always creates a **draft**
- `update_post` — edits an existing post
- `publish_post` — high risk; always needs approval, even in autonomous mode
- `update_option` — allow-list only: `blogname`, `blogdescription`,
  `posts_per_page` (1–100), `default_comment_status` (`open`|`closed`)
- `create_term` — creates a category or tag
- `update_theme_variation` — saves a customizer variation

There is **no delete action** in M6.

## Website memory

Agents receive the site's memory as prompt context: site title/tagline,
active theme, recent post/page titles, extensions, and up to 10 admin
notes. Facts are re-ingested from the site (`POST /api/ai/memory/rebuild`);
notes are added by an admin (`POST /api/ai/memory/notes`) and refuse
secret-like text. Memory never contains secrets.

## Honest limits (M6)

- Live Workers AI calls have **not** been verified in this environment
  (no Cloudflare account connected). Tests and local development use the
  deterministic mock provider; production behaviour is documented, not
  claimed as tested.
- AI tasks run synchronously inside the request in local dev. On
  production this risks the free-tier CPU limit for long provider calls;
  Queues/Workflows are the planned production path.
- Drafting agents produce drafts, not finished copy: every draft is
  labelled as AI output and, for the research assistant, its factual
  claims are labelled as needing verification.
