/**
 * File manager (Milestone 11) — browse the R2 bucket by folder prefix,
 * upload, download, rename and delete files. Admin-only (manage_options,
 * enforced by the API routes). No shell access and no in-place editing:
 * files are downloaded to view or edit elsewhere. Folders owned by other
 * flows (extensions/, themes/, backups/, imports/) are listed but
 * read-only here — use the Marketplace, Themes, Backup or Import page
 * for those.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/format";
import type { FileEntry, FileListResult } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

function parentPrefix(prefix: string): string {
  const slash = prefix.lastIndexOf("/");
  return slash < 0 ? "" : prefix.slice(0, slash);
}

function formatModified(value: string | null): string {
  if (value === null) return "—";
  return formatDateTime(value);
}

export function FilesPage(): React.ReactElement {
  const [prefix, setPrefix] = useState("");
  const [list, setList] = useState<FileListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.listFiles(p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(prefix);
  }, [prefix, load]);

  const openFolder = (folder: string): void => {
    setPrefix(prefix === "" ? folder : `${prefix}/${folder}`);
  };

  const goUp = (): void => setPrefix(parentPrefix(prefix));

  const doUpload = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (file === null) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const entry = await api.uploadFile(file, prefix);
      setNotice(`Uploaded ${entry.name} (${formatBytes(entry.size)}).`);
      setFile(null);
      await load(prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const doRename = async (): Promise<void> => {
    if (renameTarget === null || renameValue.trim() === "") return;
    setError(null);
    try {
      const entry = await api.renameFile(renameTarget.key, renameValue.trim());
      setNotice(`Renamed to ${entry.name}.`);
      setRenameTarget(null);
      await load(prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    }
  };

  const doDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    setError(null);
    try {
      await api.deleteFile(deleteTarget.key);
      setNotice(`Deleted ${deleteTarget.name}.`);
      setDeleteTarget(null);
      await load(prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const crumbs = prefix === "" ? [] : prefix.split("/");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Files</h2>
      {error !== null && <ErrorBox message={error} onDismiss={() => setError(null)} />}
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <p className="hint">
        Every file stored in the site&apos;s storage: media uploads, installed extensions, themes, backups and
        imports. Uploads are capped at 50 MB (same file types as the Media library). Folders owned by other pages —{" "}
        <code>extensions/</code>, <code>themes/</code>, <code>backups/</code>, <code>imports/</code> — are read-only
        here; manage them from the Marketplace, Themes, Backup or Import page. Files are never executed.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={(e) => void doUpload(e)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Upload to this folder
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="File to upload" />
          </label>
          <button type="submit" className="primary" disabled={uploading || file === null}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          <button type="button" onClick={() => setPrefix("")} disabled={prefix === ""}>
            Storage root
          </button>
          {crumbs.map((c, i) => (
            <span key={`${i}-${c}`}>
              {" / "}
              <button
                type="button"
                onClick={() => setPrefix(crumbs.slice(0, i + 1).join("/"))}
                disabled={i === crumbs.length - 1}
              >
                {c}
              </button>
            </span>
          ))}
          {prefix !== "" && (
            <span>
              {" "}
              <button type="button" onClick={goUp}>
                ↑ Up one level
              </button>
            </span>
          )}
        </p>
        {loading || list === null ? (
          <Spinner />
        ) : list.folders.length === 0 && list.files.length === 0 ? (
          <EmptyState>This folder is empty.</EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.folders.map((f) => (
                  <tr key={`folder:${f}`}>
                    <td>
                      <button type="button" onClick={() => openFolder(f)}>
                        {f}/
                      </button>
                    </td>
                    <td>folder</td>
                    <td>—</td>
                    <td>—</td>
                    <td></td>
                  </tr>
                ))}
                {list.files.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.name}
                      {f.isMedia && <span className="muted"> · media</span>}
                    </td>
                    <td>{f.type}</td>
                    <td>{formatBytes(f.size)}</td>
                    <td>{formatModified(f.modified)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a href={`/api/files/download?key=${encodeURIComponent(f.key)}`}>Download</a>{" "}
                      <button type="button" onClick={() => { setRenameTarget(f); setRenameValue(f.name); }}>
                        Rename
                      </button>{" "}
                      <button type="button" onClick={() => setDeleteTarget(f)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.truncated && (
              <p className="hint">Listing capped at 1,000 entries — this folder has more files than shown.</p>
            )}
          </>
        )}
      </div>

      {renameTarget !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Rename {renameTarget.name}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="New file name"
            />
            <button type="button" className="primary" onClick={() => void doRename()}>
              Rename
            </button>
            <button type="button" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteTarget !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Delete {deleteTarget.name}?</h3>
          <p className="muted">
            This deletes the file from storage{deleteTarget.isMedia ? " and removes its Media library record" : ""}.
            This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="danger" onClick={() => void doDelete()}>
              Delete
            </button>
            <button type="button" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
