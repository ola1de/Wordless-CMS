import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { ActivityList } from "../lib/types";
import { EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";

export function ActivityPage({ timezone }: { timezone: string }): React.ReactElement {
  const [list, setList] = useState<ActivityList | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.get<ActivityList>(`/api/activity?page=${page}&per_page=20`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity.");
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      <div className="card">
        {!list ? (
          <Spinner />
        ) : list.entries.length === 0 ? (
          <EmptyState>No activity recorded yet.</EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Details</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {list.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.action}</td>
                    <td>{entry.actorId === 0 ? "system" : `user #${entry.actorId}`}</td>
                    <td>
                      {entry.objectType ? `${entry.objectType}${entry.objectId ? ` #${entry.objectId}` : ""}` : "—"}
                      {entry.details ? <div className="muted">{entry.details}</div> : null}
                    </td>
                    <td>{formatDateTime(entry.createdAt, timezone)}</td>
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
