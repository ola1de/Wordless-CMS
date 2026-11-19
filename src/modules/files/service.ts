/**
 * File manager (Milestone 11).
 *
 * Lists the objects in the R2 bucket (media files, installed extension
 * files, theme files, backups, imports) with folder navigation by key
 * prefix, and lets an administrator upload, download, rename and delete
 * files. Every operation needs `manage_options` (enforced by the routes).
 *
 * Safety rules (all tested):
 * - No shell access, no in-place editing of files. PHP files are
 *   view-only through download; they are never executed.
 * - Path traversal is rejected: keys and prefixes must be relative,
 *   with no `..`, no leading `/`, no backslashes, no empty segments.
 * - Managed prefixes are read-only here: `extensions/`, `themes/`,
 *   `backups/` and `imports/` are owned by the Marketplace, Themes,
 *   Backup and Import flows. Upload/rename/delete under them is
 *   refused with a message pointing at the owning page, so a rename
 *   cannot silently break an installed extension or orphan a backup.
 *   Media files (root keys) are writable; deleting one also deletes
 *   its media-library record, renaming one updates its record.
 * - Uploads use the same MIME allowlist and 50 MB cap as the media
 *   library, plus the same magic-byte sniffing. A file-manager upload
 *   is a plain R2 object, not a media-library attachment (the Media
 *   page is where attachments live).
 * - Listings are capped at 1000 entries per folder (R2 page size);
 *   `truncated` says so honestly.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import type { MediaStorage } from "../media/storage";
import { deleteMedia, findMediaByKey, renameMediaObject, validateUpload } from "../media/service";
import { verifyUploadBytes } from "../security/magic";

/** One page of a folder listing. */
export interface FileEntry {
  key: string;
  name: string;
  size: number;
  /** Lowercase extension without the dot, or "file". */
  type: string;
  modified: string | null;
  /** True when the key belongs to a media-library attachment. */
  isMedia: boolean;
}

export interface FileListResult {
  prefix: string;
  folders: string[];
  files: FileEntry[];
  truncated: boolean;
}

/** Prefixes owned by other flows — read-only in the file manager. */
export const MANAGED_PREFIXES = ["extensions/", "themes/", "backups/", "imports/"];

/** Maximum entries in one folder listing. */
export const MAX_FILE_LIST_ENTRIES = 1000;

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** Normalise + validate a folder prefix ("" = bucket root). Throws 400. */
export function validatePrefix(raw: string): string {
  const prefix = raw.trim().replace(/^\/+|\/+$/g, "");
  if (prefix === "") return "";
  if (prefix.includes("\\") || prefix.includes("..")) {
    throw badRequest(`Invalid folder path "${raw}".`);
  }
  const segments = prefix.split("/");
  if (segments.some((s) => s === "" || !SEGMENT_RE.test(s))) {
    throw badRequest(`Invalid folder path "${raw}".`);
  }
  return prefix;
}

/** Validate a full object key (relative path, no traversal). Throws 400. */
export function validateFileKey(raw: string): string {
  const key = raw.trim();
  if (
    key === "" ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    key.includes("..")
  ) {
    throw badRequest(`Invalid file path "${raw}".`);
  }
  const segments = key.split("/");
  if (segments.some((s) => s === "" || !SEGMENT_RE.test(s))) {
    throw badRequest(`Invalid file path "${raw}".`);
  }
  return key;
}

/** Validate a single file name (one segment, no separators). Throws 400. */
export function validateFileName(raw: string): string {
  const name = raw.trim();
  if (name === "" || name.length > 180 || !SEGMENT_RE.test(name) || name === "." || name === "..") {
    throw badRequest(`Invalid file name "${raw}".`);
  }
  return name;
}

function isManaged(key: string): boolean {
  return MANAGED_PREFIXES.some((p) => key.startsWith(p));
}

function typeOf(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = key.slice(dot + 1).toLowerCase();
  return ext !== "" && /^[a-z0-9]+$/.test(ext) ? ext : "file";
}

async function mediaKeys(db: Db): Promise<Set<string>> {
  const rows = await queryAll<{ meta_value: unknown }>(
    db,
    "SELECT meta_value FROM wp_postmeta WHERE meta_key = '_wp_attached_file'",
  );
  const out = new Set<string>();
  for (const row of rows) {
    if (typeof row.meta_value === "string" && row.meta_value !== "") out.add(row.meta_value);
  }
  return out;
}

/** List one folder: immediate subfolders + files directly inside it. */
export async function listFiles(db: Db, storage: MediaStorage, rawPrefix: string): Promise<FileListResult> {
  const prefix = validatePrefix(rawPrefix);
  const listPrefix = prefix === "" ? "" : `${prefix}/`;
  const objects = await storage.listObjects(listPrefix);
  const attachments = await mediaKeys(db);
  const folders = new Set<string>();
  const files: FileEntry[] = [];
  for (const obj of objects) {
    const rest = obj.key.slice(listPrefix.length);
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      folders.add(rest.slice(0, slash));
      continue;
    }
    files.push({
      key: obj.key,
      name: rest,
      size: obj.size,
      type: typeOf(obj.key),
      modified: obj.uploaded === null ? null : obj.uploaded.toISOString(),
      isMedia: attachments.has(obj.key),
    });
  }
  const truncated = files.length + folders.size > MAX_FILE_LIST_ENTRIES;
  return {
    prefix,
    folders: [...folders].sort().slice(0, MAX_FILE_LIST_ENTRIES),
    files: files.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_FILE_LIST_ENTRIES),
    truncated,
  };
}

export interface UploadFileInput {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/** Upload a file into a folder. Refused under managed prefixes. */
export async function uploadFile(
  storage: MediaStorage,
  rawPrefix: string,
  input: UploadFileInput,
): Promise<FileEntry> {
  const prefix = validatePrefix(rawPrefix);
  const name = validateFileName(input.filename);
  const key = prefix === "" ? name : `${prefix}/${name}`;
  if (isManaged(key)) {
    throw badRequest(`Files under "${key.split("/")[0]}/" are managed by their own page and cannot be uploaded here.`);
  }
  validateUpload(input.mimeType, input.data.byteLength);
  verifyUploadBytes(name, input.mimeType, input.data);
  if (await storage.exists(key)) {
    throw badRequest(`A file named "${name}" already exists in this folder.`);
  }
  const stored = await storage.put(key, input.data, input.mimeType);
  return { key, name, size: stored.size, type: typeOf(key), modified: new Date().toISOString(), isMedia: false };
}

/** Read a file's bytes for download. */
export async function downloadFile(
  storage: MediaStorage,
  rawKey: string,
): Promise<{ data: Uint8Array; contentType: string; name: string }> {
  const key = validateFileKey(rawKey);
  const found = await storage.get(key);
  if (found === null) throw notFound(`File "${key}" not found.`);
  return { data: found.data, contentType: found.contentType, name: key.split("/").pop() ?? key };
}

/** Rename a file within its folder (copy + delete). Media records follow the new key. */
export async function renameFile(
  db: Db,
  storage: MediaStorage,
  rawKey: string,
  rawNewName: string,
): Promise<FileEntry> {
  const key = validateFileKey(rawKey);
  const newName = validateFileName(rawNewName);
  if (isManaged(key)) {
    throw badRequest(`Files under "${key.split("/")[0]}/" are managed by their own page and cannot be renamed here.`);
  }
  const slash = key.lastIndexOf("/");
  const newKey = slash >= 0 ? `${key.slice(0, slash + 1)}${newName}` : newName;
  if (newKey === key) throw badRequest("The new name is the same as the current name.");
  if (await storage.exists(newKey)) {
    throw badRequest(`A file named "${newName}" already exists in this folder.`);
  }
  const found = await storage.get(key);
  if (found === null) throw notFound(`File "${key}" not found.`);
  await storage.put(newKey, found.data, found.contentType);
  await storage.delete(key);
  const attachment = await renameMediaObject(db, key, newKey);
  return {
    key: newKey,
    name: newName,
    size: found.data.byteLength,
    type: typeOf(newKey),
    modified: new Date().toISOString(),
    isMedia: attachment !== null,
  };
}

/** Delete a file. A media attachment's library record is deleted too. */
export async function deleteFile(db: Db, storage: MediaStorage, rawKey: string): Promise<{ deleted: boolean }> {
  const key = validateFileKey(rawKey);
  if (isManaged(key)) {
    throw badRequest(`Files under "${key.split("/")[0]}/" are managed by their own page and cannot be deleted here.`);
  }
  const attachment = await findMediaByKey(db, key);
  if (attachment !== null) {
    await deleteMedia(db, storage, attachment.id);
    return { deleted: true };
  }
  const deleted = await storage.delete(key);
  if (!deleted) throw notFound(`File "${key}" not found.`);
  return { deleted: true };
}
