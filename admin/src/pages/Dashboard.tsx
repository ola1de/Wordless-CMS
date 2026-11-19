import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { ActivityItem, ActivityList, HealthCheck, PostList, CommentList } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function DashboardPage({ timezone }: { timezone: string }): React.ReactElement {
  const [health, setHealth] = useState<HealthCheck[] | null>(null);
  const [posts, setPosts] = useState<PostList | null>(null);
  const [comments, setComments] = useState<CommentList | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, p, c, a] = await Promise.all([
          api.get<{ checks: HealthCheck[] }>("/api/site-health"),
          api.get<PostList>("/api/posts?per_page=5"),
          api.get<CommentList>("/api/comments?status=pending&per_page=5"),
          api.get<ActivityList>("/api/activity?per_page=8"),
        ]);
        if (cancelled) return;
        setHealth(h.checks);
        setPosts(p);
        setComments(c);
        setActivity(a.entries);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the dashboard.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const critical = health?.filter((c) => c.status === "critical").length ?? 0;
  const recommended = health?.filter((c) => c.status === "recommended").length ?? 0;

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      <div className="grid">
        <div className="stat">
          <div className="num">{posts?.total ?? "—"}</div>
          <div className="lbl">Posts</div>
        </div>
        <div className="stat">
          <div className="num">{comments?.total ?? "—"}</div>
          <div className="lbl">Comments awaiting moderation</div>
        </div>
        <div className="stat">
          <div className="num">{critical}</div>
          <div className="lbl">Critical health issues</div>
        </div>
        <div className="stat">
          <div className="num">{recommended}</div>
          <div className="lbl">Recommended health fixes</div>
        </div>
      </div>

      <div className="card">
        <h3>Recent posts</h3>
        {!posts ? (
          <Spinner />
        ) : posts.posts.length === 0 ? (
          <EmptyState>
            No posts yet. <a href="#/posts/new">Write your first post</a>.
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {posts.posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <a href={`#/posts/${post.id}/edit`}>{post.title || "(untitled)"}</a>
                  </td>
                  <td>
                    <span className={`badge ${post.status}`}>{post.status}</span>
                  </td>
                  <td>{formatDateTime(post.modified, timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <a href="#/posts">All posts →</a>
        </p>
      </div>

      <div className="card">
        <h3>Recent activity</h3>
        {!activity ? (
          <Spinner />
        ) : activity.length === 0 ? (
          <EmptyState>No activity recorded yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.action}
                    {item.objectType ? ` (${item.objectType}${item.objectId ? ` #${item.objectId}` : ""})` : ""}
                    {item.details ? <div className="muted">{item.details}</div> : null}
                  </td>
                  <td>{formatDateTime(item.createdAt, timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <a href="#/activity">Full activity log →</a>
        </p>
      </div>
    </div>
  );
}
