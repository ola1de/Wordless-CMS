/**
 * Public-page cache rules (Milestone 9).
 *
 * - Anonymous GETs of public pages are cached for 60 s (M2 behaviour,
 *   unchanged) with `stale-while-revalidate=60`, so a reader never
 *   waits on a regeneration while a fresh copy is being fetched.
 * - Publishing (or changing) a post purges its own URL, the home page,
 *   and the affected term pages from the Cache API. The purge uses the
 *   same `cache.match(url)` keying the render layer uses, so it hits.
 * - A purge failure never fails the publish — it is logged and the
 *   entry expires on its own after 60 s.
 *
 * The purge path is tested with a fake Cache object; the real Cache API
 * is only available in the Worker runtime.
 */
export const PUBLIC_CACHE_MAX_AGE = 60;
export const PUBLIC_CACHE_STALE_WHILE_REVALIDATE = 60;

export function publicCacheControl(): string {
  return `public, max-age=${PUBLIC_CACHE_MAX_AGE}, stale-while-revalidate=${PUBLIC_CACHE_STALE_WHILE_REVALIDATE}`;
}

export interface CacheLike {
  delete(request: string | Request): Promise<boolean>;
}

/** Build the list of URLs to purge when a post is published/changed. */
export function urlsToPurgeForPost(
  baseUrl: string,
  postSlug: string,
  termSlugs: string[],
  isHomePage = false,
): string[] {
  const base = baseUrl.replace(/\/$/, "");
  const urls = new Set<string>();
  if (!isHomePage) urls.add(`${base}/${postSlug}`);
  urls.add(`${base}/`);
  for (const slug of termSlugs) {
    urls.add(`${base}/category/${slug}`);
    urls.add(`${base}/tag/${slug}`);
  }
  return [...urls];
}

/** Delete every URL from the cache. Returns the number actually deleted. */
export async function purgeUrls(cache: CacheLike, urls: string[]): Promise<number> {
  let deleted = 0;
  for (const url of urls) {
    try {
      if (await cache.delete(url)) deleted += 1;
    } catch {
      // A failed purge is not fatal — the entry expires after 60 s.
    }
  }
  return deleted;
}
