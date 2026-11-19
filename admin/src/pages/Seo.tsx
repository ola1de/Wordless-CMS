import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { NotFoundList, RedirectList, SeoImportResult } from "../lib/types";
import { EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";

export function SeoPage(): React.ReactElement {
  const [redirects, setRedirects] = useState<RedirectList | null>(null);
  const [redirectPage, setRedirectPage] = useState(1);
  const [notFound, setNotFound] = useState<NotFoundList | null>(null);
  const [notFoundPage, setNotFoundPage] = useState(1);
  const [robots, setRobots] = useState<string | null>(null);
  const [robotsDraft, setRobotsDraft] = useState("");
  const [oldPath, setOldPath] = useState("");
  const [newPath, setNewPath] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState("");
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<SeoImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRedirects = useCallback(async (page: number) => {
    try {
      setRedirects(await api.listRedirects(page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load redirects.");
    }
  }, []);

  const loadNotFound = useCallback(async (page: number) => {
    try {
      setNotFound(await api.listNotFound(page));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the 404 log.");
    }
  }, []);

  const loadRobots = useCallback(async () => {
    try {
      const { robots: txt } = await api.getRobots();
      setRobots(txt);
      setRobotsDraft(txt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load robots.txt.");
    }
  }, []);

  useEffect(() => {
    void loadRedirects(redirectPage);
  }, [redirectPage, loadRedirects]);

  useEffect(() => {
    void loadNotFound(notFoundPage);
  }, [notFoundPage, loadNotFound]);

  useEffect(() => {
    void loadRobots();
  }, [loadRobots]);

  const fail = (err: unknown): void => {
    setError(err instanceof Error ? err.message : "Something went wrong.");
  };

  const createRedirect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.createRedirect(oldPath.trim(), newPath.trim());
      setNotice(`Redirect created: ${created.oldPath} → ${created.newPath}.`);
      setOldPath("");
      setNewPath("");
      await loadRedirects(redirectPage);
    } catch (err) {
      fail(err);
    }
  };

  const saveEditedRedirect = async (id: number): Promise<void> => {
    setError(null);
    try {
      await api.updateRedirect(id, editingTarget.trim());
      setEditingId(null);
      setNotice("Redirect updated.");
      await loadRedirects(redirectPage);
    } catch (err) {
      fail(err);
    }
  };

  const removeRedirect = async (id: number): Promise<void> => {
    setError(null);
    try {
      await api.deleteRedirect(id);
      setNotice("Redirect deleted.");
      await loadRedirects(redirectPage);
    } catch (err) {
      fail(err);
    }
  };

  const createRedirectFrom404 = (path: string): void => {
    setOldPath(path);
    setNewPath("");
    setNotice(`Old path prefilled from the 404 log — enter where "${path}" should point.`);
    window.scrollTo({ top: 0 });
  };

  const removeNotFound = async (path: string): Promise<void> => {
    setError(null);
    try {
      await api.deleteNotFound(path);
      await loadNotFound(notFoundPage);
    } catch (err) {
      fail(err);
    }
  };

  const saveRobots = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const { robots: txt } = await api.updateRobots(robotsDraft);
      setRobots(txt);
      setRobotsDraft(txt);
      setNotice("robots.txt saved.");
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const runImport = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setImportResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText) as unknown;
    } catch {
      setError("Import text is not valid JSON. Paste an object like {\"posts\": [...]}.");
      return;
    }
    const posts = (parsed as { posts?: unknown }).posts;
    if (!Array.isArray(posts)) {
      setError('Import JSON must be an object with a "posts" array.');
      return;
    }
    try {
      const result = await api.importSeo(posts);
      setImportResult(result);
      setNotice(`Import finished: ${result.applied} applied, ${result.skipped.length} skipped.`);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="card">
        <h3>Sitemap &amp; robots</h3>
        <p>
          <a href="/sitemap.xml" target="_blank" rel="noreferrer">View sitemap.xml ↗</a>
          {" · "}
          <a href="/robots.txt" target="_blank" rel="noreferrer">View robots.txt ↗</a>
        </p>
        <p className="muted">
          The sitemap lists the home page, published posts/pages and term archives, with changefreq and
          priority from recency. Above 1,000 URLs it becomes an index with pages of 1,000. Image entries
          are included only for attachments that exist.
        </p>
        {robots === null ? (
          <Spinner />
        ) : (
          <>
            <div className="field">
              <label htmlFor="robots">robots.txt</label>
              <textarea
                id="robots"
                value={robotsDraft}
                onChange={(e) => setRobotsDraft(e.target.value)}
                rows={8}
                spellCheck={false}
              />
              <p className="hint">
                Rules that would block /admin or /api are rejected — a typo here must never lock you out
                of your own admin.
              </p>
            </div>
            <button type="button" className="primary" disabled={saving} onClick={() => void saveRobots()}>
              {saving ? "Saving…" : "Save robots.txt"}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h3>Redirects ({redirects?.total ?? 0})</h3>
        <form onSubmit={(e) => void createRedirect(e)}>
          <div className="field">
            <label htmlFor="old-path">Old path (from)</label>
            <input id="old-path" value={oldPath} onChange={(e) => setOldPath(e.target.value)} placeholder="/old-page" />
          </div>
          <div className="field">
            <label htmlFor="new-path">New path or URL (to)</label>
            <input id="new-path" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="/new-page" />
          </div>
          <button type="submit" className="primary">Add redirect</button>
        </form>
        {!redirects ? (
          <Spinner />
        ) : redirects.redirects.length === 0 ? (
          <EmptyState>
            <p>No redirects yet. Renaming a published post&apos;s slug creates one automatically.</p>
          </EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Old path</th>
                  <th>New path</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {redirects.redirects.map((r) => (
                  <tr key={r.id}>
                    <td>{r.oldPath}</td>
                    <td>
                      {editingId === r.id ? (
                        <input value={editingTarget} onChange={(e) => setEditingTarget(e.target.value)} aria-label="New path" />
                      ) : (
                        r.newPath
                      )}
                    </td>
                    <td>
                      {editingId === r.id ? (
                        <>
                          <button type="button" className="small primary" onClick={() => void saveEditedRedirect(r.id)}>Save</button>{" "}
                          <button type="button" className="small ghost" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="small"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditingTarget(r.newPath);
                            }}
                          >
                            Edit
                          </button>{" "}
                          <button type="button" className="small danger" onClick={() => void removeRedirect(r.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={redirects.page} totalPages={redirects.totalPages} total={redirects.total} onPage={setRedirectPage} />
          </>
        )}
      </div>

      <div className="card">
        <h3>404 log ({notFound?.total ?? 0})</h3>
        <p className="muted">
          Public 404s, one row per path, most-hit first. Query strings are never stored. The log keeps
          the 500 most recently seen paths.
        </p>
        {!notFound ? (
          <Spinner />
        ) : notFound.entries.length === 0 ? (
          <EmptyState>
            <p>No 404s recorded yet.</p>
          </EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Hits</th>
                  <th>Last seen</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notFound.entries.map((entry) => (
                  <tr key={entry.path}>
                    <td>{entry.path}</td>
                    <td>{entry.count}</td>
                    <td>{entry.lastSeen.slice(0, 10)}</td>
                    <td>
                      <button type="button" className="small" onClick={() => createRedirectFrom404(entry.path)}>
                        Create redirect
                      </button>{" "}
                      <button type="button" className="small danger" onClick={() => void removeNotFound(entry.path)}>
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={notFound.page} totalPages={notFound.totalPages} total={notFound.total} onPage={setNotFoundPage} />
          </>
        )}
      </div>

      <div className="card">
        <h3>Import SEO metadata (Yoast / Rank Math)</h3>
        <p className="muted">
          Paste JSON like <code>{"{\"posts\": [{\"slug\": \"hello\", \"meta\": {\"_yoast_wpseo_title\": \"...\"}}]}"}</code>.
          Yoast (<code>_yoast_wpseo_*</code>) and Rank Math (<code>rank_math_*</code>) keys are mapped to
          Wordless fields; unknown keys and invalid rows are reported, never silently dropped. At most
          500 posts per import.
        </p>
        <div className="field">
          <label htmlFor="seo-import">Import JSON</label>
          <textarea id="seo-import" value={importText} onChange={(e) => setImportText(e.target.value)} rows={6} spellCheck={false} placeholder='{"posts": []}' />
        </div>
        <button type="button" className="primary" onClick={() => void runImport()}>
          Import
        </button>
        {importResult ? (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>{importResult.applied} applied</strong>, {importResult.skipped.length} skipped.
            </p>
            {importResult.skipped.length > 0 ? (
              <ul>
                {importResult.skipped.map((s, i) => (
                  <li key={i}>
                    <strong>{s.post}:</strong> {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
