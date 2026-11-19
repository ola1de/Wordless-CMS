import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { postUrl } from "../lib/permalinks";
import type { MediaItem, MediaList, Post, Revision } from "../lib/types";
import { emptyParagraph, newBlockId, parseBlocks, serializeBlocks } from "../editor/blocks";
import type { Block } from "../editor/blocks";
import { ErrorBox, Modal, Spinner } from "../components/ui";

export interface EditorSettings {
  timezone: string;
  permalinkStructure: string;
}

const ADDABLE: Array<{ type: Block["type"]; label: string }> = [
  { type: "paragraph", label: "Paragraph" },
  { type: "heading", label: "Heading" },
  { type: "list", label: "List" },
  { type: "quote", label: "Quote" },
  { type: "image", label: "Image" },
  { type: "code", label: "Code" },
  { type: "separator", label: "Separator" },
];

function blankBlock(type: Block["type"]): Block {
  switch (type) {
    case "heading":
      return { id: newBlockId(), type, level: 2, html: "" };
    case "list":
      return { id: newBlockId(), type, ordered: false, items: [""] };
    case "quote":
      return { id: newBlockId(), type, html: "" };
    case "image":
      return { id: newBlockId(), type, attachmentId: 0, url: "", alt: "" };
    case "code":
      return { id: newBlockId(), type, code: "" };
    case "separator":
      return { id: newBlockId(), type };
    case "raw":
      return { id: newBlockId(), type, raw: "" };
    case "paragraph":
    default:
      return emptyParagraph();
  }
}

/** Media picker modal: pick an existing item or upload a new one. */
function MediaPicker({
  onSelect,
  onClose,
}: {
  onSelect: (item: MediaItem) => void;
  onClose: () => void;
}): React.ReactElement {
  const [list, setList] = useState<MediaList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setList(await api.get<MediaList>("/api/media?per_page=24"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    setError(null);
    try {
      const item = await api.uploadMedia(file);
      await load();
      onSelect(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Insert image" onClose={onClose}>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      <div className="field">
        <label htmlFor="picker-upload">Upload a new image</label>
        <input
          id="picker-upload"
          type="file"
          accept="image/*,.pdf"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {uploading ? <p className="muted">Uploading…</p> : null}
      </div>
      {!list ? (
        <Spinner />
      ) : list.media.length === 0 ? (
        <p className="muted">No media yet — upload an image above.</p>
      ) : (
        <div className="media-grid">
          {list.media
            .filter((m) => m.mimeType.startsWith("image/"))
            .map((item) => (
              <button key={item.id} type="button" className="media-card" onClick={() => onSelect(item)} style={{ padding: 0, textAlign: "left" }}>
                <span className="thumb">
                  <img src={item.url} alt={item.alt || item.filename} />
                </span>
                <span className="meta">
                  <span className="name">{item.filename}</span>
                </span>
              </button>
            ))}
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function EditorPage({
  type,
  postId,
  settings,
  onDone,
}: {
  type: "post" | "page";
  postId?: number;
  settings: EditorSettings;
  onDone: () => void;
}): React.ReactElement {
  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("draft");
  const [blocks, setBlocks] = useState<Block[]>([emptyParagraph()]);
  const [loading, setLoading] = useState(postId !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [autosaveAt, setAutosaveAt] = useState<string | null>(null);
  const [addType, setAddType] = useState<Block["type"]>("paragraph");
  const dirtyRef = useRef(false);
  const stateRef = useRef({ title, slug, status, blocks, post });
  stateRef.current = { title, slug, status, blocks, post };

  useEffect(() => {
    if (postId === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.get<Post>(`/api/posts/${postId}`);
        if (cancelled) return;
        setPost(loaded);
        setTitle(loaded.title);
        setSlug(loaded.slug);
        setStatus(loaded.status);
        const parsed = parseBlocks(loaded.content || "");
        setBlocks(parsed.length > 0 ? parsed : [emptyParagraph()]);
        setRevisions(await api.get<Revision[]>(`/api/posts/${postId}/revisions`));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the content.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Autosave: 20 s after the last edit, for existing posts.
  useEffect(() => {
    if (postId === undefined) return;
    const timer = window.setTimeout(() => {
      if (!dirtyRef.current) return;
      const s = stateRef.current;
      if (!s.post) return;
      void api
        .post<Revision>(`/api/posts/${s.post.id}/autosave`, {
          title: s.title,
          content: serializeBlocks(s.blocks),
        })
        .then(() => {
          dirtyRef.current = false;
          setAutosaveAt(new Date().toLocaleTimeString());
          return api.get<Revision[]>(`/api/posts/${s.post?.id}/revisions`);
        })
        .then((revs) => setRevisions(revs))
        .catch(() => {
          // Autosave failures are silent; the manual save still works.
        });
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [blocks, title, postId]);

  const updateBlock = (id: string, patch: Partial<Block>): void => {
    dirtyRef.current = true;
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const moveBlock = (id: string, dir: -1 | 1): void => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  const deleteBlock = (id: string): void => {
    dirtyRef.current = true;
    setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.id !== id)));
  };

  const addBlock = (): void => {
    dirtyRef.current = true;
    setBlocks((prev) => [...prev, blankBlock(addType)]);
  };

  const pickImage = (item: MediaItem): void => {
    if (pickerFor === "__new__") {
      dirtyRef.current = true;
      setBlocks((prev) => [
        ...prev,
        { id: newBlockId(), type: "image", attachmentId: item.id, url: item.url, alt: item.alt },
      ]);
    } else if (pickerFor) {
      updateBlock(pickerFor, { attachmentId: item.id, url: item.url, alt: item.alt });
    }
    setPickerFor(null);
  };

  const save = async (publish: boolean): Promise<void> => {
    setError(null);
    setNotice(null);
    setSaving(true);
    const content = serializeBlocks(blocks);
    const nextStatus = publish ? "publish" : status === "publish" ? "publish" : "draft";
    try {
      if (post) {
        const updated = await api.put<Post>(`/api/posts/${post.id}`, {
          title,
          content,
          slug: slug.trim() || undefined,
          status: nextStatus,
        });
        setPost(updated);
        setStatus(updated.status);
        setNotice(publish ? "Published." : "Draft saved.");
        setRevisions(await api.get<Revision[]>(`/api/posts/${post.id}/revisions`));
      } else {
        const created = await api.post<Post>("/api/posts", {
          title,
          content,
          slug: slug.trim() || undefined,
          status: nextStatus,
          type,
        });
        setPost(created);
        setStatus(created.status);
        setNotice(publish ? "Published." : "Draft saved.");
        // Switch the URL to the edit route so refresh keeps editing.
        window.location.hash = `#/${type === "page" ? "pages" : "posts"}/${created.id}/edit`;
        setRevisions(await api.get<Revision[]>(`/api/posts/${created.id}/revisions`));
      }
      dirtyRef.current = false;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const restoreRevision = async (revId: number): Promise<void> => {
    setError(null);
    try {
      const restored = await api.post<Post>(`/api/revisions/${revId}/restore`);
      setPost(restored);
      setTitle(restored.title);
      setSlug(restored.slug);
      setStatus(restored.status);
      const parsed = parseBlocks(restored.content || "");
      setBlocks(parsed.length > 0 ? parsed : [emptyParagraph()]);
      setNotice("Revision restored.");
      setRevisions(await api.get<Revision[]>(`/api/posts/${restored.id}/revisions`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    }
  };

  if (loading) return <Spinner />;

  const previewUrl = post && post.status === "publish" ? postUrl(post, settings.permalinkStructure) : null;

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="card">
        <div className="field">
          <label htmlFor="editor-title">Title</label>
          <input
            id="editor-title"
            className="editor-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              dirtyRef.current = true;
            }}
            placeholder={type === "page" ? "Page title" : "Post title"}
          />
        </div>
        <div className="field">
          <label htmlFor="editor-slug">Slug (leave blank to generate from the title)</label>
          <input
            id="editor-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              dirtyRef.current = true;
            }}
            placeholder="my-post-slug"
          />
          {post ? <p className="hint">Changing the slug keeps the old URL working — a redirect is created automatically.</p> : null}
        </div>
      </div>

      <div className="block-list">
        {blocks.map((block, idx) => (
          <BlockView
            key={block.id}
            block={block}
            isFirst={idx === 0}
            isLast={idx === blocks.length - 1}
            onChange={(patch) => updateBlock(block.id, patch)}
            onMove={(dir) => moveBlock(block.id, dir)}
            onDelete={() => deleteBlock(block.id)}
            onPickImage={() => setPickerFor(block.id)}
          />
        ))}
      </div>

      <div className="add-block">
        <select value={addType} onChange={(e) => setAddType(e.target.value as Block["type"])} aria-label="Block type">
          {ADDABLE.map((a) => (
            <option key={a.type} value={a.type}>
              {a.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={addBlock}>
          + Add block
        </button>
        <button type="button" onClick={() => setPickerFor("__new__")}>
          Insert image from library
        </button>
      </div>

      <div className="toolbar" style={{ marginTop: 24 }}>
        <button type="button" className="primary" disabled={saving} onClick={() => void save(false)}>
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button type="button" disabled={saving} onClick={() => void save(true)}>
          {saving ? "Saving…" : status === "publish" ? "Update" : "Publish"}
        </button>
        {previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer">
            <button type="button">Preview ↗</button>
          </a>
        ) : (
          <span className="muted">Preview is available once published.</span>
        )}
        <span className="spacer" />
        {autosaveAt ? <span className="muted">Autosaved at {autosaveAt}</span> : null}
        <button type="button" className="ghost" onClick={onDone}>
          Back to list
        </button>
      </div>

      {revisions && revisions.length > 0 ? (
        <div className="card">
          <h3>Revisions ({revisions.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {revisions.slice(0, 10).map((rev) => (
                <tr key={rev.id}>
                  <td>{formatDateTime(rev.date, settings.timezone)}</td>
                  <td>{rev.title || "(untitled)"}</td>
                  <td>
                    <button type="button" className="small" onClick={() => void restoreRevision(rev.id)}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pickerFor ? <MediaPicker onSelect={pickImage} onClose={() => setPickerFor(null)} /> : null}
    </div>
  );
}

/** One editable block. contentEditable edits commit on blur to keep the caret stable. */
function BlockView({
  block,
  isFirst,
  isLast,
  onChange,
  onMove,
  onDelete,
  onPickImage,
}: {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Block>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onPickImage: () => void;
}): React.ReactElement {
  const tools = (
    <div className="block-tools">
      <span className="kind">{block.type}</span>
      {block.type === "heading" ? (
        <select
          value={block.level ?? 2}
          onChange={(e) => onChange({ level: Number(e.target.value) === 3 ? 3 : 2 })}
          aria-label="Heading level"
          style={{ width: "auto" }}
        >
          <option value={2}>H2</option>
          <option value={3}>H3</option>
        </select>
      ) : null}
      {block.type === "list" ? (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={block.ordered ?? false}
            onChange={(e) => onChange({ ordered: e.target.checked })}
            style={{ width: "auto" }}
          />
          Numbered
        </label>
      ) : null}
      <span className="spacer" />
      <button type="button" className="small ghost" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move up">
        ↑
      </button>
      <button type="button" className="small ghost" disabled={isLast} onClick={() => onMove(1)} aria-label="Move down">
        ↓
      </button>
      <button type="button" className="small danger" onClick={onDelete} aria-label="Delete block">
        Delete
      </button>
    </div>
  );

  switch (block.type) {
    case "paragraph":
    case "heading":
    case "quote": {
      const Tag = block.type === "heading" ? (block.level === 3 ? "h3" : "h2") : block.type === "quote" ? "blockquote" : "p";
      return (
        <div className="block">
          {tools}
          <Tag
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
            onBlur={(e) => onChange({ html: e.currentTarget.innerHTML })}
            data-placeholder={block.type === "paragraph" ? "Write…" : ""}
          />
          {block.type === "quote" ? (
            <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
              <label htmlFor={`cite-${block.id}`}>Citation (optional)</label>
              <input
                id={`cite-${block.id}`}
                value={block.cite ?? ""}
                onChange={(e) => onChange({ cite: e.target.value })}
                placeholder="Author or source"
              />
            </div>
          ) : null}
        </div>
      );
    }
    case "list":
      return (
        <div className="block">
          {tools}
          {(block.items ?? []).map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span className="muted">{block.ordered ? `${i + 1}.` : "•"}</span>
              <div
                style={{ flex: 1 }}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: item }}
                onBlur={(e) => {
                  const items = [...(block.items ?? [])];
                  items[i] = e.currentTarget.innerHTML;
                  onChange({ items });
                }}
              />
              <button
                type="button"
                className="small ghost"
                onClick={() => {
                  const items = (block.items ?? []).filter((_, j) => j !== i);
                  onChange({ items: items.length > 0 ? items : [""] });
                }}
                aria-label="Remove list item"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            style={{ marginTop: 8 }}
            onClick={() => onChange({ items: [...(block.items ?? []), ""] })}
          >
            + Add item
          </button>
        </div>
      );
    case "image":
      return (
        <div className="block">
          {tools}
          {block.url ? (
            <img src={block.url} alt={block.alt ?? ""} />
          ) : (
            <p className="muted">No image selected.</p>
          )}
          <div className="field">
            <label htmlFor={`alt-${block.id}`}>Alt text</label>
            <input id={`alt-${block.id}`} value={block.alt ?? ""} onChange={(e) => onChange({ alt: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`cap-${block.id}`}>Caption (optional)</label>
            <input
              id={`cap-${block.id}`}
              value={block.caption ?? ""}
              onChange={(e) => onChange({ caption: e.target.value })}
            />
          </div>
          <button type="button" className="small" onClick={onPickImage}>
            {block.url ? "Replace image" : "Choose image"}
          </button>
        </div>
      );
    case "code":
      return (
        <div className="block">
          {tools}
          <textarea
            value={block.code ?? ""}
            onChange={(e) => onChange({ code: e.target.value })}
            aria-label="Code"
            spellCheck={false}
          />
        </div>
      );
    case "separator":
      return (
        <div className="block">
          {tools}
          <hr />
        </div>
      );
    case "raw":
    default:
      return (
        <div className="block">
          {tools}
          <p className="hint">Unsupported block — preserved as raw HTML. Edit the source below; it is never dropped.</p>
          <textarea
            value={block.raw ?? ""}
            onChange={(e) => onChange({ raw: e.target.value })}
            aria-label="Raw HTML"
            spellCheck={false}
          />
        </div>
      );
  }
}
