/**
 * Magic-byte sniffing for uploads (Milestone 9).
 *
 * The M3 allowlist checks the *declared* MIME type; a PHP file renamed
 * to .jpg passes it. This module checks the first bytes of the actual
 * file and rejects files whose content contradicts their extension/MIME.
 * SVG is text, so it is checked by content instead of magic bytes.
 */
import { badRequest } from "../../kernel/errors";

interface Signature {
  mime: string;
  /** Prefix bytes the file must start with (null = checked by `test`). */
  prefix?: number[];
  test?: (data: Uint8Array) => boolean;
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", prefix: [0xff, 0xd8, 0xff] },
  { mime: "image/png", prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", prefix: [0x47, 0x49, 0x46, 0x38] },
  {
    mime: "image/webp",
    test: (d) => d.length >= 12 && startsWith(d, [0x52, 0x49, 0x46, 0x46]) && startsWith(d.subarray(8, 12), [0x57, 0x45, 0x42, 0x50]),
  },
  {
    mime: "image/avif",
    test: (d) =>
      d.length >= 12 &&
      startsWith(d.subarray(4, 8), [0x66, 0x74, 0x79, 0x70]) &&
      (startsWith(d.subarray(8, 12), [0x61, 0x76, 0x69, 0x66]) || startsWith(d.subarray(8, 12), [0x61, 0x76, 0x69, 0x73])),
  },
  { mime: "application/pdf", prefix: [0x25, 0x50, 0x44, 0x46] },
];

/** Extension → expected MIME (the declared MIME must match the extension). */
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

const SVG_DANGEROUS = /<script[\s>]|javascript\s*:|on\w+\s*=/i;

/**
 * Sniff an SVG's text: it must actually contain an <svg> element and
 * must not contain scripts, javascript: URLs or inline event handlers.
 * Returns false for anything that is not a plausible SVG document.
 */
export function sniffSvg(data: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(0, 4096));
  const stripped = head.replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?/i, "");
  if (!/^<svg[\s>]/.test(stripped)) return false;
  if (SVG_DANGEROUS.test(head)) return false;
  return true;
}

/**
 * Verify that `data` really is what `mimeType` + `filename` claim.
 * Throws a 400 on any mismatch. SVG is checked by content; other types
 * by magic bytes. Unknown extensions are rejected (the allowlist only
 * ever admits the mapped ones).
 */
export function verifyUploadBytes(filename: string, mimeType: string, data: Uint8Array): void {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const expected = EXTENSION_MIME[ext];
  if (expected === undefined) {
    throw badRequest(`File extension ".${ext}" is not allowed.`);
  }
  if (expected !== mimeType) {
    throw badRequest(`File extension ".${ext}" does not match the declared type "${mimeType}".`);
  }
  if (mimeType === "image/svg+xml") {
    if (!sniffSvg(data)) {
      throw badRequest("SVG file failed its content check (not a plain SVG document, or it contains scripts).");
    }
    return;
  }
  const sig = SIGNATURES.find((s) => s.mime === mimeType);
  if (sig === undefined) {
    throw badRequest(`File type "${mimeType}" cannot be verified.`);
  }
  const ok = sig.prefix !== undefined ? startsWith(data, sig.prefix) : sig.test?.(data) === true;
  if (!ok) {
    throw badRequest(`File contents do not match the declared type "${mimeType}" — the file may have been renamed.`);
  }
}
