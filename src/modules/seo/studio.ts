/**
 * Content studio (Milestone 7) — templates + editorial calendar.
 *
 * Templates are real Gutenberg block-comment HTML: creating from a
 * template inserts a genuine draft post through the posts service
 * (revisions, slug generation and all). The calendar groups stored
 * posts by date for the next 30 days — drafts with a future date are
 * the schedule, since Wordless has no "future" post status yet (the
 * publish date is the post_date). Ideas and AI drafts come from the
 * M6 AI task API — the studio UI calls it directly; there is no
 * separate ideas store and no fake idea is ever invented.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import { createPost } from "../posts/service";
import type { Post } from "../posts/types";
import type { CalendarDay, ContentCalendar, ContentTemplate } from "./types";

export const CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    slug: "announcement",
    name: "Announcement",
    description: "A short news-style announcement with a headline, intro and key details.",
    title: "Announcement: ",
    content: `<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">What is happening</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Write one short paragraph explaining the announcement in plain language.</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Key details</h2><!-- /wp:heading -->
<!-- wp:list --><ul class="wp-block-list"><li>Detail one</li><li>Detail two</li><li>Detail three</li></ul><!-- /wp:list -->
<!-- wp:paragraph --><p>End with what readers should do next.</p><!-- /wp:paragraph -->`,
  },
  {
    slug: "how-to",
    name: "How-to guide",
    description: "A step-by-step guide with an intro, numbered steps and a summary.",
    title: "How to ",
    content: `<!-- wp:paragraph --><p>One paragraph: what the reader will be able to do by the end, and who this guide is for.</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Before you start</h2><!-- /wp:heading -->
<!-- wp:list --><ul class="wp-block-list"><li>What you need first</li><li>What you need second</li></ul><!-- /wp:list -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Steps</h2><!-- /wp:heading -->
<!-- wp:list {"ordered":true} --><ol class="wp-block-list"><li>First step — be specific.</li><li>Second step — be specific.</li><li>Third step — be specific.</li></ol><!-- /wp:list -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Summary</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>One paragraph recapping the result and what to try next.</p><!-- /wp:paragraph -->`,
  },
  {
    slug: "news-update",
    name: "News update",
    description: "A dated news update: lead paragraph, background, and what happens next.",
    title: "News update: ",
    content: `<!-- wp:paragraph --><p>Lead paragraph: the news in one or two sentences — who, what, when.</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Background</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Context readers need to understand why this matters.</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">What happens next</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>What to expect, and when the next update will come.</p><!-- /wp:paragraph -->`,
  },
];

export function listTemplates(): ContentTemplate[] {
  return CONTENT_TEMPLATES.map((t) => ({ ...t }));
}

export function getTemplate(slug: string): ContentTemplate | undefined {
  return CONTENT_TEMPLATES.find((t) => t.slug === slug);
}

/** Create a draft post from a template (real post, real blocks). */
export async function createFromTemplate(
  db: Db,
  slug: string,
  input: { authorId: number; title?: string },
): Promise<Post> {
  const template = getTemplate(slug);
  if (!template) throw badRequest(`Unknown content template "${slug}".`);
  const title = input.title !== undefined && input.title.trim() !== "" ? input.title : template.title;
  return createPost(db, {
    title,
    content: template.content,
    status: "draft",
    type: "post",
    authorId: input.authorId,
  });
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Editorial calendar: stored posts (any status except trash) grouped by
 * post date, from today through `days` days ahead. A draft with a
 * future date is the scheduled item — Wordless has no "future" status
 * yet, so the date is the schedule.
 */
export async function contentCalendar(db: Db, days = 30): Promise<ContentCalendar> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const now = new Date();
  const from = dateOnly(now);
  const toDate = new Date(now.getTime() + (safeDays - 1) * 86400000);
  const to = dateOnly(toDate);
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT ID, post_title, post_status, post_type, post_name, post_date FROM wp_posts
      WHERE post_status != 'trash' AND post_type IN ('post', 'page')
        AND substr(post_date, 1, 10) >= ? AND substr(post_date, 1, 10) <= ?
      ORDER BY post_date ASC, ID ASC`,
    [from, to],
  );
  const byDate = new Map<string, CalendarDay>();
  for (const row of rows) {
    const date = String(row.post_date ?? "").slice(0, 10);
    if (date === "") continue;
    const day = byDate.get(date) ?? { date, posts: [] };
    day.posts.push({
      id: typeof row.ID === "number" ? row.ID : Number(row.ID ?? 0),
      title: typeof row.post_title === "string" ? row.post_title : "",
      status: typeof row.post_status === "string" ? row.post_status : "",
      type: typeof row.post_type === "string" ? row.post_type : "",
      slug: typeof row.post_name === "string" ? row.post_name : "",
    });
    byDate.set(date, day);
  }
  const daysOut: CalendarDay[] = [];
  for (let i = 0; i < safeDays; i++) {
    const d = dateOnly(new Date(now.getTime() + i * 86400000));
    daysOut.push(byDate.get(d) ?? { date: d, posts: [] });
  }
  return { from, to, days: daysOut, total: rows.length };
}
