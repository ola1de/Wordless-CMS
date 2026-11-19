import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { CommentList } from "../lib/types";
import { Badge, EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";

const STATUSES = ["", "pending", "approved", "spam", "trash"];

export function CommentsPage({ timezone }: { timezone: string }): React.ReactElement {
  const [list, setList] = useState<CommentList | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "20" });
      if (status) params.set("status", status);
      setList(await api.get<CommentList>(`/api/comments?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments.");
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (id: number, action: "approve" | "spam" | "trash"): Promise<void> => {
    setError(null);
    try {
      await api.post(`/api/comments/${id}/${action}`);
      setNotice(`Comment ${action === "approve" ? "approved" : action === "spam" ? "marked as spam" : "trashed"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation failed.");
    }
  };

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
      </div>
      <div className="card">
        {!list ? (
          <Spinner />
        ) : list.comments.length === 0 ? (
          <EmptyState>No comments{status ? ` with status “${status}”` : ""}.</EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Author</th>
                  <th>Comment</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.comments.map((comment) => (
                  <tr key={comment.id}>
                    <td>
                      {comment.author}
                      <div className="muted">{comment.authorEmail}</div>
                      <div className="muted">Post #{comment.postId}</div>
                    </td>
                    <td>{comment.content}</td>
                    <td>
                      <Badge status={comment.status} />
                    </td>
                    <td>{formatDateTime(comment.date, timezone)}</td>
                    <td>
                      {comment.status !== "approved" ? (
                        <button type="button" className="small" onClick={() => void moderate(comment.id, "approve")}>
                          Approve
                        </button>
                      ) : null}{" "}
                      {comment.status !== "spam" ? (
                        <button type="button" className="small" onClick={() => void moderate(comment.id, "spam")}>
                          Spam
                        </button>
                      ) : null}{" "}
                      {comment.status !== "trash" ? (
                        <button type="button" className="small danger" onClick={() => void moderate(comment.id, "trash")}>
                          Trash
                        </button>
                      ) : null}
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
