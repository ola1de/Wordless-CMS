/**
 * Analytics (Milestone 8) — config only, honest reporting.
 *
 * No tracking pixel is injected unless the admin configures a provider
 * (GA4 measurement ID or Plausible domain) in the integrations config.
 * The status endpoint reports configured/not and what the snippet does;
 * there is no analytics data in Wordless itself — page views, visitors
 * and funnels live in the provider's dashboard, never invented here.
 * Supported snippets, exactly as each provider documents them:
 * - GA4: the gtag.js loader + config call for the measurement ID.
 * - Plausible: the deferred script tag with data-domain.
 */
import type { Db } from "../../db";
import { escapeHtml } from "../render/theme";
import { siteUrl } from "../feeds/service";
import { getIntegrationConfig } from "./config";

export type AnalyticsProvider = "none" | "ga4" | "plausible";

export interface AnalyticsStatus {
  provider: AnalyticsProvider;
  measurementId: string;
  configured: boolean;
  detail: string;
  /** The exact snippet injected into public pages (null when not configured). */
  snippet: string | null;
}

async function readAnalyticsConfig(db: Db): Promise<{ provider: AnalyticsProvider; measurementId: string }> {
  const config = await getIntegrationConfig(db, "analytics");
  const provider: AnalyticsProvider =
    config.provider === "ga4" || config.provider === "plausible" ? config.provider : "none";
  const measurementId = typeof config.measurementId === "string" ? config.measurementId.trim() : "";
  return { provider, measurementId };
}

/** The snippet injected into public pages, or null when unconfigured. */
export async function buildAnalyticsSnippet(db: Db): Promise<string | null> {
  const { provider, measurementId } = await readAnalyticsConfig(db);
  if (provider === "none" || measurementId === "") return null;
  const id = escapeHtml(measurementId);
  if (provider === "ga4") {
    return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
  }
  // Plausible: measurementId is the site domain.
  return `<script defer data-domain="${id}" src="https://plausible.io/js/script.js"></script>`;
}

export async function getAnalyticsStatus(db: Db): Promise<AnalyticsStatus> {
  const { provider, measurementId } = await readAnalyticsConfig(db);
  if (provider === "none" || measurementId === "") {
    return {
      provider: "none",
      measurementId: "",
      configured: false,
      detail: "No analytics provider is configured — public pages carry no tracking snippet.",
      snippet: null,
    };
  }
  return {
    provider,
    measurementId,
    configured: true,
    detail:
      provider === "ga4"
        ? `Google Analytics 4 is configured (measurement ID ${measurementId}). Page views are counted by Google, not by Wordless.`
        : `Plausible is configured (domain ${measurementId}). Page views are counted by Plausible, not by Wordless.`,
    snippet: await buildAnalyticsSnippet(db),
  };
}

/** The domain Plausible expects (the site host) — used as the default measurementId hint. */
export async function analyticsDomainHint(db: Db): Promise<string> {
  const base = await siteUrl(db);
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
}
