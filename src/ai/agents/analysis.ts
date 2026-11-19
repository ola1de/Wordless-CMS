/**
 * Deterministic analysis agents (Milestone 6).
 *
 * These agents do NOT need a provider: they measure the site's real data
 * (posts, comments, users, media, themes, conversion reports) and report
 * only what they measured. Nothing here is invented — a check that finds
 * nothing says so, and a recommendation names the milestone that will
 * deliver it (e.g. real SEO fixes in M7, backups in M9).
 */
import { queryOne } from "../../db";
import { getOption } from "../../modules/options/service";
import { listComments } from "../../modules/comments/service";
import { listConversionJobs } from "../../modules/conversion/service";
import { listExtensions } from "../../modules/extensions/service";
import { listMedia } from "../../modules/media/service";
import { getPermalinkStructure } from "../../modules/permalinks/service";
import { listPosts } from "../../modules/posts/service";
import { getPostTerms } from "../../modules/terms/service";
import { getThemeDetail } from "../../modules/themes/service";
import { getActiveThemeSlug } from "../../modules/themes/service";
import { R2MediaStorage } from "../../modules/media/storage";
import { listUsers } from "../../modules/users/service";
import type { AgentContext, AgentDefinition, AgentResult } from "../types";

const SAMPLE = 50;

function count<T>(items: T[], pred: (item: T) => boolean): number {
  return items.reduce((n, item) => (pred(item) ? n + 1 : n), 0);
}

export const seoAuditor: AgentDefinition = {
  id: "seo-auditor",
  name: "SEO Auditor",
  description:
    "Audits published posts for basic SEO hygiene: missing excerpts, missing categories, empty titles, and whether the site title/tagline and permalink structure are set. Findings only in M6 — automated fixes arrive with the SEO engine in Milestone 7.",
  capabilities: ["Audit excerpts, categories and titles", "Check site title, tagline and permalinks"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const posts = await listPosts(db, { status: "publish", type: "post", page: 1, perPage: SAMPLE });
    let missingExcerpt = 0;
    let missingTerms = 0;
    let emptyTitle = 0;
    for (const post of posts.posts) {
      if (post.excerpt.trim() === "") missingExcerpt++;
      if (post.title.trim() === "") emptyTitle++;
      const terms = await getPostTerms(db, post.id, "category");
      if (terms.length === 0) missingTerms++;
    }
    const title = await getOption<string>(db, "blogname", "");
    const tagline = await getOption<string>(db, "blogdescription", "");
    const structure = await getPermalinkStructure(db);
    const findings = [
      `${posts.total} published posts checked (sample of ${posts.posts.length}).`,
      `${missingExcerpt} missing an excerpt.`,
      `${missingTerms} have no category.`,
      `${emptyTitle} have an empty title.`,
      title === "" ? "Site title is not set." : `Site title is set ("${title}").`,
      tagline === "" ? "Tagline is not set." : "Tagline is set.",
      `Permalink structure: ${structure}.`,
    ];
    return {
      summary: `SEO audit: ${missingExcerpt} posts missing excerpts, ${missingTerms} without a category, ${emptyTitle} with empty titles.`,
      output: findings.join("\n"),
      data: {
        checked: posts.posts.length,
        total: posts.total,
        missingExcerpt,
        missingTerms,
        emptyTitle,
        titleSet: title !== "",
        taglineSet: tagline !== "",
        permalinkStructure: structure,
      },
    };
  },
};

export const securityScanner: AgentDefinition = {
  id: "security-scanner",
  name: "Security Scanner",
  description:
    "Checks measurable security posture: how many administrators exist, how many sessions are active, and how many comments are waiting or marked spam. It does not guess at password strength (hashes are opaque) and does not invent vulnerabilities.",
  capabilities: ["Count administrators and active sessions", "Count pending and spam comments"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const users = await listUsers(db, { page: 1, perPage: 100 });
    const admins = count(users.users, (u) => u.role === "administrator");
    const now = new Date().toISOString();
    const sessions = await queryOne<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM wl_sessions WHERE revoked = 0 AND expires_at > ?",
      [now],
    );
    const pending = await listComments(db, { status: "pending", page: 1, perPage: 1 });
    const spam = await listComments(db, { status: "spam", page: 1, perPage: 1 });
    const findings = [
      `${users.total} users in total; ${admins} administrator${admins === 1 ? "" : "s"}.`,
      `${sessions?.n ?? 0} active sessions.`,
      `${pending.total} comments awaiting moderation; ${spam.total} marked spam.`,
      admins > 3 ? "More than 3 administrators — review who really needs the role." : "Administrator count looks reasonable.",
    ];
    return {
      summary: `Security scan: ${admins} administrators, ${sessions?.n ?? 0} active sessions, ${pending.total} comments pending, ${spam.total} spam.`,
      output: findings.join("\n"),
      data: { users: users.total, administrators: admins, activeSessions: sessions?.n ?? 0, pendingComments: pending.total, spamComments: spam.total },
    };
  },
};

export const performanceAnalyst: AgentDefinition = {
  id: "performance-analyst",
  name: "Performance Analyst",
  description:
    "Measures content volume that drives page weight and database size: posts, revisions, media files and total media bytes, comments. Recommendations are generic until Core Web Vitals measurement arrives in Milestone 9.",
  capabilities: ["Count posts, revisions, media and comments", "Total media bytes"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const posts = await listPosts(db, { status: "publish", type: "post", page: 1, perPage: 1 });
    const revisions = await queryOne<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision'",
    );
    const media = await listMedia(db, { page: 1, perPage: 100 });
    const mediaBytes = media.media.reduce((n, m) => n + m.size, 0);
    const comments = await listComments(db, { page: 1, perPage: 1 });
    const findings = [
      `${posts.total} published posts.`,
      `${revisions?.n ?? 0} revisions stored.`,
      `${media.total} media files (${media.media.length} sampled), ${mediaBytes} bytes in the sample.`,
      `${comments.total} comments in total.`,
      (revisions?.n ?? 0) > 100
        ? "Over 100 revisions — pruning old revisions (Milestone 9) would shrink the database."
        : "Revision count is modest.",
    ];
    return {
      summary: `Performance snapshot: ${posts.total} posts, ${revisions?.n ?? 0} revisions, ${media.total} media files, ${comments.total} comments.`,
      output: findings.join("\n"),
      data: {
        posts: posts.total,
        revisions: revisions?.n ?? 0,
        mediaFiles: media.total,
        mediaBytesSampled: mediaBytes,
        comments: comments.total,
      },
    };
  },
};

export const accessibilityChecker: AgentDefinition = {
  id: "accessibility-checker",
  name: "Accessibility Checker",
  description:
    "Checks measurable accessibility basics: media items missing alt text, posts with empty titles, and heading use in recent posts. It does not render pages, so colour contrast on the live site is checked by the design advisor from the theme instead.",
  capabilities: ["Media alt-text coverage", "Empty titles", "Heading use in recent posts"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const media = await listMedia(db, { page: 1, perPage: 100 });
    const missingAlt = count(media.media, (m) => m.alt.trim() === "");
    const posts = await listPosts(db, { status: "publish", type: "post", page: 1, perPage: 20 });
    const emptyTitle = count(posts.posts, (p) => p.title.trim() === "");
    const h1Count = posts.posts.reduce((n, p) => n + (p.content.match(/<h1[\s>]/gi) ?? []).length, 0);
    const findings = [
      `${media.total} media files (${media.media.length} sampled); ${missingAlt} missing alt text.`,
      `${posts.posts.length} recent posts checked; ${emptyTitle} with an empty title.`,
      `${h1Count} <h1> headings across the sampled posts (more than one per post is usually a mistake).`,
    ];
    return {
      summary: `Accessibility check: ${missingAlt} media items missing alt text, ${emptyTitle} posts with empty titles, ${h1Count} <h1> headings in the sample.`,
      output: findings.join("\n"),
      data: { mediaChecked: media.media.length, mediaTotal: media.total, missingAlt, postsChecked: posts.posts.length, emptyTitle, h1Count },
    };
  },
};

export const analyticsReporter: AgentDefinition = {
  id: "analytics-reporter",
  name: "Analytics Reporter",
  description:
    "Reports the site's own counts: posts by status, comments by status, users by role. This is on-site activity, not visitor analytics — external analytics integrations arrive in Milestone 8.",
  capabilities: ["Posts by status", "Comments by status", "Users by role"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const byStatus: Record<string, number> = {};
    for (const status of ["publish", "draft", "private", "trash"] as const) {
      const list = await listPosts(db, { status, type: "post", page: 1, perPage: 1 });
      byStatus[status] = list.total;
    }
    const commentsByStatus: Record<string, number> = {};
    for (const status of ["approved", "pending", "spam", "trash"] as const) {
      const list = await listComments(db, { status, page: 1, perPage: 1 });
      commentsByStatus[status] = list.total;
    }
    const users = await listUsers(db, { page: 1, perPage: 100 });
    const usersByRole: Record<string, number> = {};
    for (const u of users.users) usersByRole[u.role] = (usersByRole[u.role] ?? 0) + 1;
    const lines = [
      `Posts: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      `Comments: ${Object.entries(commentsByStatus).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      `Users: ${Object.entries(usersByRole).map(([k, v]) => `${k} ${v}`).join(", ")} (${users.total} total).`,
    ];
    return {
      summary: `Site report: ${byStatus.publish ?? 0} published posts, ${commentsByStatus.approved ?? 0} approved comments, ${users.total} users.`,
      output: lines.join("\n"),
      data: { postsByStatus: byStatus, commentsByStatus, usersByRole, usersTotal: users.total },
    };
  },
};

export const backupAdvisor: AgentDefinition = {
  id: "backup-advisor",
  name: "Backup Advisor",
  description:
    "Sizes what a backup would need to cover (posts, media files and bytes, users, comments) and recommends a cadence. Real backup export and restore arrive in Milestone 9 — this agent advises, it does not back anything up.",
  capabilities: ["Size the site's content", "Recommend a backup cadence"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const posts = await listPosts(db, { page: 1, perPage: 1 });
    const media = await listMedia(db, { page: 1, perPage: 100 });
    const mediaBytes = media.media.reduce((n, m) => n + m.size, 0);
    const users = await listUsers(db, { page: 1, perPage: 1 });
    const comments = await listComments(db, { page: 1, perPage: 1 });
    const cadence = posts.total > 50 || media.total > 100 ? "daily" : "weekly";
    const findings = [
      `Content to protect: ${posts.total} posts/pages, ${media.total} media files (${mediaBytes} bytes sampled), ${users.total} users, ${comments.total} comments.`,
      `Recommended backup cadence: ${cadence}.`,
      "Automated backup export and restore arrive in Milestone 9. Until then, export content regularly from the admin and keep media copies off-site.",
    ];
    return {
      summary: `Backup advice: ${posts.total} posts/pages and ${media.total} media files to protect; ${cadence} backups recommended.`,
      output: findings.join("\n"),
      data: { posts: posts.total, mediaFiles: media.total, mediaBytesSampled: mediaBytes, users: users.total, comments: comments.total, recommendedCadence: cadence },
    };
  },
};

export const migrationAssistant: AgentDefinition = {
  id: "migration-assistant",
  name: "Migration Assistant",
  description:
    "Reports migration readiness: how much content a WordPress import would need to carry, and what the conversion engine has already converted. The WordPress importer itself (WXR + database) arrives in Milestone 9.",
  capabilities: ["Count importable content", "Summarise past conversions"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const posts = await listPosts(db, { page: 1, perPage: 1 });
    const comments = await listComments(db, { page: 1, perPage: 1 });
    const users = await listUsers(db, { page: 1, perPage: 1 });
    const media = await listMedia(db, { page: 1, perPage: 1 });
    const jobs = await listConversionJobs(db, { page: 1, perPage: 100 });
    const done = jobs.jobs.filter((j) => j.status === "done").length;
    const failed = jobs.jobs.filter((j) => j.status === "failed").length;
    const lines = [
      `Content on this site: ${posts.total} posts/pages, ${comments.total} comments, ${users.total} users, ${media.total} media files.`,
      `Conversion engine history: ${jobs.total} jobs (${done} done, ${failed} failed).`,
      "Readiness: export a WordPress WXR file from the source site when the Milestone 9 importer lands; plugin/theme conversion is handled by the conversion engine (Milestone 4) first.",
    ];
    return {
      summary: `Migration readiness: ${posts.total} posts/pages, ${comments.total} comments, ${users.total} users, ${media.total} media files; ${done} past conversions done.`,
      output: lines.join("\n"),
      data: { posts: posts.total, comments: comments.total, users: users.total, media: media.total, conversionJobs: jobs.total, conversionsDone: done, conversionsFailed: failed },
    };
  },
};

export const codeReviewer: AgentDefinition = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description:
    "Reviews the site's installed extensions and conversion reports: what is active, and what the converter flagged as unconverted or warned about. It reads reports — it does not execute code.",
  capabilities: ["List installed extensions", "Summarise conversion reports"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db } = ctx;
    const extensions = await listExtensions(db);
    const active = extensions.filter((e) => e.status === "active");
    const jobs = await listConversionJobs(db, { page: 1, perPage: 20 });
    const lines = [
      `${extensions.length} installed extensions (${active.length} active).`,
      ...extensions.map((e) => `- ${e.name} (${e.slug}) v${e.version} — ${e.status}.`),
      `${jobs.total} conversion jobs on record.`,
    ];
    for (const job of jobs.jobs.filter((j) => j.status === "done" && j.report !== undefined).slice(0, 3)) {
      const report = job.report;
      if (report !== undefined) {
        lines.push(
          `- ${job.filename}: ${report.converted.functions.length} functions converted, ${report.unconverted.length} unconverted, ${report.warnings.length} warnings.`,
        );
      }
    }
    if (extensions.length === 0) lines.push("No extensions installed yet.");
    return {
      summary: `Code review: ${extensions.length} extensions (${active.length} active), ${jobs.total} conversion jobs on record.`,
      output: lines.join("\n"),
      data: { extensions: extensions.length, active: active.length, conversionJobs: jobs.total },
    };
  },
};

/** Relative luminance of a #rrggbb colour (WCAG). */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null || m[1] === undefined) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export const designAdvisor: AgentDefinition = {
  id: "design-advisor",
  name: "Design Advisor",
  description:
    "Reads the active theme's colour palette and checks text/background contrast ratios (WCAG 4.5:1 for normal text). It reports real ratios from the theme — it does not render pages.",
  capabilities: ["Read the active theme palette", "Compute WCAG contrast ratios"],
  risk: "low",
  requiresProvider: false,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const { db, env } = ctx;
    const slug = await getActiveThemeSlug(db);
    const detail = await getThemeDetail(db, new R2MediaStorage(env.MEDIA), slug);
    const themeJson = detail.themeJson as { settings?: { color?: { palette?: Array<{ slug: string; color: string }> } } } | null;
    const palette = themeJson?.settings?.color?.palette ?? [];
    if (palette.length === 0) {
      return {
        summary: `Design check: the active theme "${slug}" has no colour palette to check.`,
        output: `The active theme "${slug}" defines no colour palette in theme.json, so there is nothing to measure.`,
        data: { theme: slug, paletteSize: 0, pairsChecked: 0, failures: 0 },
      };
    }
    const base = palette.find((p) => p.slug === "base")?.color;
    const contrast = palette.find((p) => p.slug === "contrast")?.color;
    const failures: string[] = [];
    let pairsChecked = 0;
    if (base !== undefined && contrast !== undefined) {
      const ratio = contrastRatio(base, contrast);
      pairsChecked++;
      if (ratio !== null && ratio < 4.5) {
        failures.push(`base (${base}) on contrast (${contrast}): ${ratio.toFixed(2)}:1 — below 4.5:1.`);
      }
    }
    for (const entry of palette) {
      if (base === undefined || entry.slug === "base") continue;
      const ratio = contrastRatio(entry.color, base);
      pairsChecked++;
      if (ratio !== null && ratio < 4.5) {
        failures.push(`${entry.slug} (${entry.color}) on base (${base}): ${ratio.toFixed(2)}:1 — below 4.5:1.`);
      }
    }
    const lines = [
      `Active theme "${slug}" — palette of ${palette.length} colours, ${pairsChecked} contrast pairs checked.`,
      failures.length === 0
        ? "All checked pairs meet 4.5:1 for normal text."
        : `${failures.length} pair(s) below 4.5:1:\n${failures.map((f) => `- ${f}`).join("\n")}`,
    ];
    return {
      summary:
        failures.length === 0
          ? `Design check: all ${pairsChecked} contrast pairs in "${slug}" meet 4.5:1.`
          : `Design check: ${failures.length} of ${pairsChecked} contrast pairs in "${slug}" are below 4.5:1.`,
      output: lines.join("\n"),
      data: { theme: slug, paletteSize: palette.length, pairsChecked, failures: failures.length },
    };
  },
};
