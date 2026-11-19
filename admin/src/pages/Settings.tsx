import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Settings } from "../lib/types";
import { ErrorBox, Spinner } from "../components/ui";
import type { AppSettings } from "../App";

const PERMALINKS = [
  { value: "plain", label: "Plain — /?p=123" },
  { value: "postname", label: "Post name — /my-post" },
  { value: "day-name", label: "Day and name — /2026/11/19/my-post" },
  { value: "month-name", label: "Month and name — /2026/11/my-post" },
];

export function SettingsPage({ onSaved }: { onSaved: (s: AppSettings) => void }): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await api.updateSettings(settings);
      setSettings(saved);
      setNotice("Settings saved.");
      onSaved({ timezone: saved.timezone, permalinkStructure: saved.permalinkStructure, siteTitle: saved.siteTitle });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <Spinner />;

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      <form onSubmit={(e) => void save(e)}>
        <div className="card">
          <h3>General</h3>
          <div className="field">
            <label htmlFor="set-title">Site title</label>
            <input id="set-title" value={settings.siteTitle} onChange={(e) => update("siteTitle", e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="set-tagline">Tagline</label>
            <input id="set-tagline" value={settings.siteTagline} onChange={(e) => update("siteTagline", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="set-tz">Timezone</label>
            <input
              id="set-tz"
              value={settings.timezone}
              onChange={(e) => update("timezone", e.target.value)}
              placeholder="Africa/Lagos"
              required
            />
            <p className="hint">An IANA timezone name, for example Africa/Lagos or UTC. Dates are stored in UTC.</p>
          </div>
          <div className="field">
            <label htmlFor="set-perpage">Posts per page</label>
            <input
              id="set-perpage"
              type="number"
              min={1}
              max={100}
              value={settings.postsPerPage}
              onChange={(e) => update("postsPerPage", Number(e.target.value))}
              required
            />
          </div>
        </div>

        <div className="card">
          <h3>Permalinks</h3>
          <div className="field">
            <label htmlFor="set-permalink">Permalink structure</label>
            <select
              id="set-permalink"
              value={settings.permalinkStructure}
              onChange={(e) => update("permalinkStructure", e.target.value)}
            >
              {PERMALINKS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="hint">
              Changing the structure does not break existing URLs: the old URL keeps working through an automatic
              redirect.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Comments</h3>
          <div className="field">
            <label htmlFor="set-comment-status">Default comment status for new posts</label>
            <select
              id="set-comment-status"
              value={settings.defaultCommentStatus}
              onChange={(e) => update("defaultCommentStatus", e.target.value)}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="set-max-links">Maximum links before a comment is held for moderation</label>
            <input
              id="set-max-links"
              type="number"
              min={0}
              max={10}
              value={settings.commentMaxLinks}
              onChange={(e) => update("commentMaxLinks", Number(e.target.value))}
              required
            />
            <p className="hint">0 means any comment with a link is held for moderation.</p>
          </div>
        </div>

        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
