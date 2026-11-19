/**
 * Image derivatives (Milestone 9).
 *
 * When the Cloudflare Images binding (`IMAGES`) is present, the media
 * endpoint asks it for a resized/WebP variant and stores the result in
 * R2 + `wl_media_derivatives`, so `srcset` can be generated from stored
 * records. When the binding is absent, the endpoint serves the original
 * and the admin media page says derivatives are unavailable — a resize
 * is NEVER faked.
 *
 * The Images API surface is the documented Workers Images binding
 * (`input(stream).transform({ width, fit }).output({ format })`,
 * @cloudflare/workers-types). If the bound API rejects the request (bad
 * width, unsupported format), the original is served instead and the
 * failure is reported, not hidden.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import type { Env } from "../../env";

export const DERIVATIVE_WIDTHS = [320, 640, 1024, 1600];
export const DERIVATIVE_FORMATS = ["webp", "jpeg", "png"] as const;
export type DerivativeFormat = (typeof DERIVATIVE_FORMATS)[number];

export interface DerivativeRecord {
  id: number;
  mediaId: number;
  width: number;
  format: DerivativeFormat;
  objectKey: string;
  size: number;
  createdAt: string;
}

export function isValidDerivativeWidth(width: number): boolean {
  return Number.isInteger(width) && width >= 32 && width <= 4096;
}

export function isValidDerivativeFormat(format: string): format is DerivativeFormat {
  return (DERIVATIVE_FORMATS as readonly string[]).includes(format);
}

/** `GET /media/:key?width=&format=` — variant only when Images is bound. */
export async function getDerivativeOrOriginal(
  env: Env,
  db: Db,
  mediaId: number,
  objectKey: string,
  width: number | null,
  format: DerivativeFormat | null,
): Promise<
  | { kind: "original" }
  | { kind: "derivative"; objectKey: string; format: DerivativeFormat; width: number }
  | { kind: "unavailable"; reason: string }
> {
  if (width === null && format === null) return { kind: "original" };
  if (width === null) width = 1024;
  if (format === null) format = "webp";
  if (!isValidDerivativeWidth(width)) throw badRequest("width must be an integer between 32 and 4096.");
  if (!isValidDerivativeFormat(format)) throw badRequest("format must be webp, jpeg or png.");
  if (!env.IMAGES) {
    return {
      kind: "unavailable",
      reason: "Image derivatives are unavailable: the Cloudflare Images binding is not configured. Serve the original instead.",
    };
  }
  const existing = await queryOne<DerivativeRecord>(
    db,
    "SELECT * FROM wl_media_derivatives WHERE media_id = ? AND width = ? AND format = ? LIMIT 1",
    [mediaId, width, format],
  );
  if (existing !== null) {
    return { kind: "derivative", objectKey: existing.objectKey, format, width };
  }
  // No stored variant yet: derive it now via the Images binding and store it.
  const original = await env.MEDIA.get(objectKey);
  if (original === null) return { kind: "original" };
  // The Images binding takes a ReadableStream (R2Object.body) and a
  // transform ({ width, fit }) + output ({ format: "image/webp" }).
  const result = await env.IMAGES.input(original.body)
    .transform({ width, fit: "scale-down" })
    .output({ format: `image/${format}` });
  const bytes = new Uint8Array(await result.response().arrayBuffer());
  const derivedKey = `media/derivatives/${mediaId}-${width}.${format}`;
  await env.MEDIA.put(derivedKey, bytes, { httpMetadata: { contentType: `image/${format}` } });
  await execRun(
    db,
    "INSERT INTO wl_media_derivatives (media_id, width, format, object_key, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [mediaId, width, format, derivedKey, bytes.length, nowIso()],
  );
  return { kind: "derivative", objectKey: derivedKey, format, width };
}

/** Stored derivatives for one media item (for srcset generation). */
export async function listDerivatives(db: Db, mediaId: number): Promise<DerivativeRecord[]> {
  return queryAll<DerivativeRecord>(
    db,
    "SELECT * FROM wl_media_derivatives WHERE media_id = ? ORDER BY width ASC",
    [mediaId],
  );
}

/** Build a srcset string from stored derivative records. Empty when none exist. */
export function buildSrcset(baseMediaUrl: string, derivatives: DerivativeRecord[]): string {
  const parts: string[] = [];
  for (const d of derivatives) {
    parts.push(`${baseMediaUrl}?width=${d.width}&format=${d.format} ${d.width}w`);
  }
  return parts.join(", ");
}

/** Derivative status for Site Health / the media page (measured, never claimed). */
export async function derivativeStatus(db: Db, imagesBound: boolean): Promise<{
  bound: boolean;
  stored: number;
  widths: number[];
}> {
  const row = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_media_derivatives");
  return { bound: imagesBound, stored: row?.n ?? 0, widths: DERIVATIVE_WIDTHS };
}
