/**
 * Configurable robots.txt (Milestone 7).
 *
 * Stored as the wp_options value `wl_robots_txt` (JSON string). When
 * unset, the M2 default is served (allow everything, sitemap line).
 *
 * Validation (enforced on write): at most 10,000 characters; every
 * non-empty, non-comment line must be a known directive
 * (`User-agent:`, `Allow:`, `Disallow:`, `Sitemap:`, `Crawl-delay:`).
 * A rule that would block the admin or the API is rejected — a typo in
 * robots.txt must never lock the site owner out of their own admin:
 * `Disallow: /` (blocks everything) and any `Disallow:` whose path is
 * `/admin`, `/api`, or a prefix of either (e.g. `/a`) is refused.
 * `Sitemap:` lines are left as written; the default sitemap line is
 * only added when the stored text has none.
 */
import { badRequest } from "../../kernel/errors";
import { getOption, setOption } from "../options/service";
import { siteUrl } from "../feeds/service";
import type { Db } from "../../db";

export const ROBOTS_OPTION = "wl_robots_txt";
const MAX_ROBOTS_BYTES = 10000;

const KNOWN_DIRECTIVES = ["user-agent:", "allow:", "disallow:", "sitemap:", "crawl-delay:"];

/** Does a Disallow path block `target` (/admin or /api)? Robots matching is prefix-based. */
function blocksPath(disallowPath: string, target: string): boolean {
  const p = disallowPath.trim();
  if (p === "") return false;
  return target.startsWith(p);
}

export function validateRobotsTxt(text: string): void {
  if (typeof text !== "string") throw badRequest("robots.txt must be a string.");
  if (text.length > MAX_ROBOTS_BYTES) {
    throw badRequest(`robots.txt is too long (max ${MAX_ROBOTS_BYTES} characters).`);
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const lower = line.toLowerCase();
    const known = KNOWN_DIRECTIVES.find((d) => lower.startsWith(d));
    if (!known) {
      throw badRequest(`Unknown robots.txt directive in line: "${line.slice(0, 80)}".`);
    }
    if (known === "disallow:") {
      const path = line.slice("disallow:".length).trim();
      if (blocksPath(path, "/admin") || blocksPath(path, "/api")) {
        throw badRequest(`robots.txt must not block /admin or /api (refused: "${line.slice(0, 80)}").`);
      }
    }
  }
}

/** The robots.txt that is actually served (stored text, or the default). */
export async function getRobotsTxt(db: Db): Promise<string> {
  const base = await siteUrl(db);
  const stored = await getOption<string | null>(db, ROBOTS_OPTION, null);
  if (stored === null || stored.trim() === "") {
    return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
  }
  const text = stored.endsWith("\n") ? stored : `${stored}\n`;
  if (/^\s*sitemap:/im.test(text)) return text;
  return `${text}Sitemap: ${base}/sitemap.xml\n`;
}

export async function setRobotsTxt(db: Db, text: string): Promise<string> {
  validateRobotsTxt(text);
  const trimmed = text.trim();
  if (trimmed === "") {
    await setOption(db, ROBOTS_OPTION, "");
  } else {
    await setOption(db, ROBOTS_OPTION, trimmed);
  }
  return getRobotsTxt(db);
}
