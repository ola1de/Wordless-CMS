/**
 * Theme ZIP handling (Milestone 5).
 *
 * Extracts an uploaded theme ZIP with fflate (pure JS, bundles under the
 * Workers script limit — no native modules, no Node APIs). Validates
 * structure before anything is stored: size cap, file count cap, no path
 * traversal, and a single top-level folder (the usual WordPress theme ZIP
 * layout) is stripped.
 */
import { unzipSync } from "fflate";
import { badRequest } from "../../kernel/errors";

export const MAX_THEME_ZIP_BYTES = 5 * 1024 * 1024;
export const MAX_THEME_FILES = 200;

export const ALLOWED_THEME_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".json",
  ".php",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".txt",
  ".md",
]);

export interface ExtractedThemeZip {
  /** Relative path → raw bytes (text files decoded by the caller). */
  files: Map<string, Uint8Array>;
  warnings: string[];
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/** Extract + validate a theme ZIP. Throws bad_request (400) on bad input. */
export function extractThemeZip(data: Uint8Array): ExtractedThemeZip {
  if (data.byteLength === 0) {
    throw badRequest("The uploaded ZIP is empty.");
  }
  if (data.byteLength > MAX_THEME_ZIP_BYTES) {
    throw badRequest(
      `Theme ZIP is ${data.byteLength} bytes; the limit is ${MAX_THEME_ZIP_BYTES} bytes (5 MB).`,
    );
  }
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data) as Record<string, Uint8Array>;
  } catch {
    throw badRequest("Could not read the uploaded ZIP file. It must be a valid .zip archive.");
  }
  const entries = Object.entries(raw).filter(([path]) => !path.endsWith("/"));
  if (entries.length === 0) {
    throw badRequest("The ZIP contains no files.");
  }
  if (entries.length > MAX_THEME_FILES) {
    throw badRequest(`The ZIP contains ${entries.length} files; the limit is ${MAX_THEME_FILES}.`);
  }
  // A WordPress theme ZIP usually has one top-level folder (mytheme/…).
  // Strip it when every file shares the same first segment.
  const firstSegments = new Set(entries.map(([path]) => path.split("/")[0] ?? ""));
  const stripPrefix =
    firstSegments.size === 1 && entries.every(([path]) => path.includes("/"))
      ? `${[...firstSegments][0] as string}/`
      : "";
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  for (const [path, bytes] of entries) {
    const relative = stripPrefix !== "" ? path.slice(stripPrefix.length) : path;
    if (relative === "" || relative.startsWith("/") || relative.includes("..")) {
      throw badRequest(`The ZIP contains an unsafe path: "${path}".`);
    }
    if (relative.split("/").some((seg) => seg === "__MACOSX" || seg.startsWith("."))) {
      continue; // Skip macOS metadata / hidden files silently.
    }
    const dot = relative.lastIndexOf(".");
    const ext = dot >= 0 ? relative.slice(dot).toLowerCase() : "";
    if (!ALLOWED_THEME_EXTENSIONS.has(ext)) {
      warnings.push(`Skipped unsupported file "${relative}" (extension "${ext}").`);
      continue;
    }
    files.set(relative, bytes);
  }
  if (files.size === 0) {
    throw badRequest("The ZIP contains no usable theme files.");
  }
  return { files, warnings };
}

/** Read a text file from an extracted ZIP (throws when missing). */
export function zipTextFile(files: Map<string, Uint8Array>, path: string): string {
  const data = files.get(path);
  if (data === undefined) throw badRequest(`The theme ZIP is missing "${path}".`);
  return decodeText(data);
}

/** All text files under a prefix (templates/, parts/), as path → string. */
export function zipTextFilesUnder(files: Map<string, Uint8Array>, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, bytes] of files) {
    if (path.startsWith(prefix)) out.set(path, decodeText(bytes));
  }
  return out;
}
