/**
 * Marketplace skeleton (Milestone 8).
 *
 * The marketplace in M8 is deliberately small and honest: an admin
 * installs an extension from a ZIP upload carrying a `wordless.json`
 * manifest (slug, name, version, kind). Files are stored in R2 under
 * `extensions/<slug>/` and the extension is recorded in wl_extensions
 * (the same table the M4 conversion pipeline uses), starting inactive.
 * Activation/deactivation reuse the extensions service. There is NO
 * remote directory, NO remote download, and NO claim that an extension
 * from a ZIP is safe to run — uploaded extensions are inert records
 * until a later milestone loads their code (the conversion pipeline
 * already does that for converted PHP). A remote marketplace directory
 * is a later milestone, not this one.
 */
import { unzipSync } from "fflate";
import { badRequest } from "../../kernel/errors";
import { requireString } from "../../kernel/validate";
import type { MediaStorage } from "../media/storage";
import { installExtension, listExtensions, setExtensionStatus } from "../extensions/service";
import type { ExtensionRecord } from "../extensions/service";
import type { Db } from "../../db";

export const MAX_MARKETPLACE_ZIP_BYTES = 2 * 1024 * 1024;
export const MAX_MARKETPLACE_FILES = 100;

export interface MarketplaceManifest {
  slug: string;
  name: string;
  version: string;
  kind: string;
  description?: string;
}

export interface MarketplaceInstallResult {
  extension: ExtensionRecord;
  files: number;
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function parseManifest(raw: string): MarketplaceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("wordless.json is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw badRequest("wordless.json must be a JSON object with slug, name and version.");
  }
  const obj = parsed as Record<string, unknown>;
  const slug = requireString(obj.slug, "manifest.slug", { max: 100 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw badRequest("Manifest slug must be lowercase letters, digits and hyphens only.");
  }
  const name = requireString(obj.name, "manifest.name", { max: 200 });
  const version = requireString(obj.version, "manifest.version", { max: 20 });
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw badRequest('Manifest version must look like "1.0.0".');
  }
  const kind = typeof obj.kind === "string" && obj.kind.trim() !== "" ? obj.kind.trim() : "plugin";
  if (kind !== "plugin" && kind !== "theme") {
    throw badRequest('Manifest kind must be "plugin" or "theme".');
  }
  return { slug, name, version, kind, description: typeof obj.description === "string" ? obj.description : undefined };
}

/** Validate + install an extension ZIP. Throws 400 on any bad input; stores nothing on failure. */
export async function installExtensionFromZip(
  db: Db,
  storage: MediaStorage,
  filename: string,
  data: Uint8Array,
): Promise<MarketplaceInstallResult> {
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw badRequest("The marketplace install requires a .zip file.");
  }
  if (data.byteLength === 0) throw badRequest("The uploaded ZIP is empty.");
  if (data.byteLength > MAX_MARKETPLACE_ZIP_BYTES) {
    throw badRequest(`The ZIP is ${data.byteLength} bytes; the limit is ${MAX_MARKETPLACE_ZIP_BYTES} bytes (2 MB).`);
  }
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data) as Record<string, Uint8Array>;
  } catch {
    throw badRequest("Could not read the uploaded ZIP file. It must be a valid .zip archive.");
  }
  const entries = Object.entries(raw).filter(([path]) => !path.endsWith("/"));
  if (entries.length === 0) throw badRequest("The ZIP contains no files.");
  if (entries.length > MAX_MARKETPLACE_FILES) {
    throw badRequest(`The ZIP contains ${entries.length} files; the limit is ${MAX_MARKETPLACE_FILES}.`);
  }
  // A ZIP usually has one top-level folder (myext/…). Strip it when every
  // file shares the same first segment.
  const firstSegments = new Set(entries.map(([path]) => path.split("/")[0] ?? ""));
  const stripPrefix =
    firstSegments.size === 1 && entries.every(([path]) => path.includes("/"))
      ? `${[...firstSegments][0] as string}/`
      : "";
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    const relative = stripPrefix !== "" ? path.slice(stripPrefix.length) : path;
    if (relative === "" || relative.startsWith("/") || relative.includes("..")) {
      throw badRequest(`The ZIP contains an unsafe path: "${path}".`);
    }
    files.set(relative, bytes);
  }
  const manifestRaw = files.get("wordless.json");
  if (manifestRaw === undefined) {
    throw badRequest('The ZIP must contain a wordless.json manifest at its root (slug, name, version, kind).');
  }
  const manifest = parseManifest(decodeText(manifestRaw));
  // Store files first; the wl_extensions row is the record of the install.
  for (const [path, bytes] of files) {
    await storage.put(`extensions/${manifest.slug}/${path}`, bytes, "application/octet-stream");
  }
  const extension = await installExtension(db, {
    slug: manifest.slug,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    source: "marketplace:upload",
    status: "inactive",
  });
  return { extension, files: files.size };
}

export async function listMarketplaceExtensions(db: Db): Promise<ExtensionRecord[]> {
  return listExtensions(db);
}

export async function setMarketplaceExtensionStatus(
  db: Db,
  slug: string,
  status: "active" | "inactive",
): Promise<ExtensionRecord> {
  return setExtensionStatus(db, slug, status);
}
