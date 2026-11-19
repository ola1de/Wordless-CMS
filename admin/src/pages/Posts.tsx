import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { PostList } from "../lib/types";
import { Badge, EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";
import { Icon } from "../components/icons";

const STATUSES = ["", "publish", "draft", "trash"];

export function PostsPage({ type, timezone }: { type: "post" | "page"; timezone: string }): React.ReactElement {
  const [list, setList] = useState<PostList | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ type, page: String(page), per_page: "20" });
      if (status) params.set("status", status);
      if (query) params.set("search", query);
      setList(await api.get<PostList>(`/api/posts?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load content.");
    }
  }, [type, page, status, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const trash = async (id: number): Promise<void> => {
    setError(null);
    try {
      await api.post(`/api/posts/${id}/trash`);
      setNotice("Moved to trash.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trash.");
    }
  };

  const restore = async (id: number): Promise<void> => {
    setError(null);
    try {
      await api.post(`/api/posts/${id}/restore`);
      setNotice("Restored as draft.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore.");
    }
  };

  const label = type === "page" ? "Pages" : "Posts";
  const editBase = type === "page" ? "#/pages" : "#/posts";

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder={`Search ${label.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setQuery(search.trim());
              setPage(1);
            }
          }}
          style={{ minWidth: 220 }}
        />
        <button
          type="button"
          onClick={() => {
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <Icon name="search" size={16} />
          Search
        </button>
        <span className="spacer" />
        <a href={`${editBase}/new`}>
          <button type="button" className="primary">
            <Icon name="plus" size={16} />
            Add new {type === "page" ? "page" : "post"}
          </button>
        </a>
      </div>

      <div className="card">
        {!list ? (
          <Spinner />
        ) : list.posts.length === 0 ? (
          <EmptyState>
            No {label.toLowerCase()} found.
            {status === "" && query === "" ? (
              <>
                {" "}
                <a href={`${editBase}/new`}>Create the first one</a>.
              </>
            ) : null}
          </EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.posts.map((post) => (
                  <tr key={post.id}>
                    <td>
                      <a href={`${editBase}/${post.id}/edit`}>{post.title || "(untitled)"}</a>
                      <div className="muted">/{post.slug}</div>
                    </td>
                    <td>
                      <Badge status={post.status} />
                    </td>
                    <td>{formatDateTime(post.modified, timezone)}</td>
                    <td>
                      {post.status === "trash" ? (
                        <button type="button" className="small" onClick={() => void restore(post.id)}>
                          Restore
                        </button>
                      ) : (
                        <button type="button" className="small danger" onClick={() => void trash(post.id)}>
                          Trash
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={list.page} totalPages={list.totalPages} total={list.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
