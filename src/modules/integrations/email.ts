/**
 * Email (Milestone 8).
 *
 * Two providers, one interface:
 * - "http": a generic Resend/SendGrid-shaped HTTP endpoint — POST JSON
 *   { from, to, subject, text, html } with `Authorization: Bearer
 *   <EMAIL_API_KEY>` to EMAIL_API_URL. The key comes only from env/
 *   secrets; the URL is non-secret config (wl_integration_email.apiUrl).
 *   Outcomes (sent/failed) are recorded in wl_mail_log.
 * - "mock": no provider is configured — the message is recorded in
 *   wl_mail_log with status "logged" and delivered: false. It is NEVER
 *   presented as delivered; the admin UI says "test mode — messages
 *   are logged, not delivered".
 *
 * sendMail never throws for a mail failure: it returns { delivered,
 * provider, error? } and the caller decides. A mail outage must never
 * take down a webhook or a checkout.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { Env } from "../../env";
import { siteUrl } from "../feeds/service";
import { getIntegrationConfig } from "./config";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendMailResult {
  delivered: boolean;
  provider: "http" | "mock";
  error?: string;
}

export interface MailLogEntry {
  id: number;
  provider: string;
  toEmail: string;
  subject: string;
  body: string;
  status: "logged" | "sent" | "failed";
  createdAt: string;
}

async function recordMail(
  db: Db,
  provider: string,
  input: SendMailInput,
  status: "logged" | "sent" | "failed",
): Promise<void> {
  await execRun(
    db,
    "INSERT INTO wl_mail_log (provider, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [provider, input.to, input.subject, input.text.slice(0, 10000), status, nowIso()],
  );
}

export async function getMailFrom(db: Db, env: Env): Promise<string> {
  const config = await getIntegrationConfig(db, "email");
  if (typeof config.from === "string" && config.from.trim() !== "") return config.from.trim();
  const base = await siteUrl(db);
  try {
    const hostname = new URL(base).hostname;
    return `noreply@${hostname}`;
  } catch {
    return "noreply@localhost";
  }
}

export async function sendMail(db: Db, env: Env, input: SendMailInput): Promise<SendMailResult> {
  const config = await getIntegrationConfig(db, "email");
  const apiUrl = typeof config.apiUrl === "string" ? config.apiUrl.trim() : "";
  const apiKey = env.EMAIL_API_KEY;
  if (apiUrl !== "" && apiKey !== undefined && apiKey !== "") {
    const from = await getMailFrom(db, env);
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text, html: input.html ?? undefined }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        await recordMail(db, "http", input, "failed");
        return { delivered: false, provider: "http", error: `Email provider returned HTTP ${res.status}${detail !== "" ? `: ${detail.slice(0, 200)}` : ""}.` };
      }
      await recordMail(db, "http", input, "sent");
      return { delivered: true, provider: "http" };
    } catch (err) {
      await recordMail(db, "http", input, "failed");
      return { delivered: false, provider: "http", error: err instanceof Error ? err.message : "Email request failed." };
    }
  }
  // No provider configured: log locally, never claim delivery.
  await recordMail(db, "mock", input, "logged");
  return { delivered: false, provider: "mock", error: "No email provider is configured — the message was logged, not delivered." };
}

export async function listMailLog(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<{ entries: MailLogEntry[]; total: number; page: number; perPage: number; totalPages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const totalRow = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_mail_log");
  const rows = await queryAll<{
    id: number;
    provider: string;
    to_email: string;
    subject: string;
    body: string;
    status: string;
    created_at: string;
  }>(db, "SELECT * FROM wl_mail_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [perPage, offset]);
  const total = totalRow?.n ?? 0;
  return {
    entries: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      toEmail: r.to_email,
      subject: r.subject,
      body: r.body,
      status: r.status as "logged" | "sent" | "failed",
      createdAt: r.created_at,
    })),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}
