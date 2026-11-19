import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/format";
import type { DerivativeStatus, MediaItem, MediaList } from "../lib/types";
import { EmptyState, ErrorBox, Modal, Pagination, Spinner } from "../components/ui";

export function MediaPage(): React.ReactElement {
  const [list, setList] = useState<MediaList | null>(null);
  const [page, setPage] = useState(1);
  const [mime, setMime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [derivatives, setDerivatives] = useState<DerivativeStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "24" });
      if (mime) params.set("mime", mime);
      setList(await api.get<MediaList>(`/api/media?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media.");
    }
  }, [page, mime]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DerivativeStatus>("/api/media/derivatives")
      .then((d) => {
        if (!cancelled) setDerivatives(d);
      })
      .catch(() => {
        // Derivatives status is informational; a failure here never blocks the library.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    setError(null);
    try {
      await api.uploadMedia(file);
      setNotice(`Uploaded ${file.name}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const saveAlt = async (): Promise<void> => {
    if (!editing) return;
    try {
      await api.put<MediaItem>(`/api/media/${editing.id}`, { alt: altDraft });
      setNotice("Alt text saved.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save alt text.");
    }
  };

  const remove = async (item: MediaItem): Promise<void> => {
    if (!window.confirm(`Delete ${item.filename}? This removes the file and cannot be undone.`)) return;
    try {
      await api.del(`/api/media/${item.id}`);
      setNotice(`Deleted ${item.filename}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {derivatives ? (
        <p className="muted">
          {derivatives.bound
            ? `Image derivatives are available (Cloudflare Images bound; ${derivatives.stored} variant(s) stored; widths ${derivatives.widths.join(", ")}). Use ?width=&format= on a media URL.`
            : "Image derivatives are unavailable until the Cloudflare Images binding is configured (see wrangler.toml) — media URLs serve the original file."}
        </p>
      ) : null}
      <div className="toolbar">
        <select value={mime} onChange={(e) => { setMime(e.target.value); setPage(1); }} aria-label="Filter by type">
          <option value="">All types</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
          <option value="image/gif">GIF</option>
          <option value="image/webp">WebP</option>
          <option value="image/avif">AVIF</option>
          <option value="image/svg+xml">SVG</option>
          <option value="application/pdf">PDF</option>
        </select>
        <span className="spacer" />
        <label className="muted" htmlFor="media-upload">
          Upload (max 50 MB; jpeg, png, gif, webp, avif, svg, pdf)
        </label>
        <input
          id="media-upload"
          type="file"
          disabled={uploading}
          style={{ width: "auto" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>
      {uploading ? <p className="muted">Uploading…</p> : null}

      {!list ? (
        <Spinner />
      ) : list.media.length === 0 ? (
        <EmptyState>No media yet. Upload a file to get started.</EmptyState>
      ) : (
        <>
          <div className="media-grid">
            {list.media.map((item) => (
              <div key={item.id} className="media-card">
                <div className="thumb">
                  {item.mimeType.startsWith("image/") ? (
                    <img src={item.url} alt={item.alt || item.filename} />
                  ) : (
                    <span className="file-icon">
                      {item.mimeType}
                      <br />
                      {item.filename}
                    </span>
                  )}
                </div>
                <div className="meta">
                  <div className="name">{item.filename}</div>
                  <div className="sub">
                    {formatBytes(item.size)} · {formatDateTime(item.date)}
                  </div>
                  {item.alt ? <div className="sub">Alt: {item.alt}</div> : null}
                  <div className="sub">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.url}
                    </a>
                  </div>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="small"
                    onClick={() => {
                      setEditing(item);
                      setAltDraft(item.alt);
                    }}
                  >
                    Edit alt
                  </button>
                  <button type="button" className="small danger" onClick={() => void remove(item)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={list.page} totalPages={list.totalPages} total={list.total} onPage={setPage} />
        </>
      )}

      {editing ? (
        <Modal title={`Alt text — ${editing.filename}`} onClose={() => setEditing(null)}>
          <div className="field">
            <label htmlFor="media-alt">Alt text</label>
            <input id="media-alt" value={altDraft} onChange={(e) => setAltDraft(e.target.value)} maxLength={500} />
            <p className="hint">Describe the image for screen readers and search engines.</p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void saveAlt()}>
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
