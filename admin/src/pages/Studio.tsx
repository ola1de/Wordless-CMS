import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AiProvidersResponse, AiTask, AiTaskList, ContentCalendar, ContentTemplate } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

function appliedPostId(task: AiTask): number | null {
  for (const applied of task.result?.applied ?? []) {
    const id = applied.result?.postId;
    if (typeof id === "number" && id > 0) return id;
  }
  return null;
}

export function StudioPage(): React.ReactElement {
  const [calendar, setCalendar] = useState<ContentCalendar | null>(null);
  const [templates, setTemplates] = useState<ContentTemplate[] | null>(null);
  const [providers, setProviders] = useState<AiProvidersResponse | null>(null);
  const [tasks, setTasks] = useState<AiTaskList | null>(null);
  const [idea, setIdea] = useState("");
  const [ideaTask, setIdeaTask] = useState<AiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cal, tpl, prov, recent] = await Promise.all([
        api.getCalendar(30),
        api.listTemplates(),
        api.getAiProviders(),
        api.listAiTasks(),
      ]);
      setCalendar(cal);
      setTemplates(tpl);
      setProviders(prov);
      setTasks(recent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the content studio.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (err: unknown): void => {
    setError(err instanceof Error ? err.message : "Something went wrong.");
  };

  const selectedProvider = providers?.providers.find((p) => p.id === providers.selected);
  const providerReady = selectedProvider?.configured === true;

  const useMockProvider = async (): Promise<void> => {
    setError(null);
    try {
      setProviders(await api.selectAiProvider("mock"));
      setNotice("Mock provider selected for local development. Switch back to Workers AI before going live.");
    } catch (err) {
      fail(err);
    }
  };

  const createDraft = async (slug: string, title?: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const { id } = await api.createFromTemplate(slug, title);
      setNotice(`Draft created from the template.`);
      window.location.hash = `#/posts/${id}/edit`;
    } catch (err) {
      fail(err);
    }
  };

  const generateIdea = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setIdeaTask(null);
    if (idea.trim() === "") {
      setError("Write a topic first.");
      return;
    }
    setBusy(true);
    try {
      const task = await api.createAiTask({ agent: "content-writer", input: idea.trim() });
      setIdeaTask(task);
      setTasks(await api.listAiTasks());
      if (task.status === "failed") {
        setError(task.error ?? "The AI task failed.");
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const daysWithPosts = calendar?.days.filter((d) => d.posts.length > 0) ?? [];

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="card">
        <h3>Editorial calendar — next 30 days</h3>
        {!calendar ? (
          <Spinner />
        ) : daysWithPosts.length === 0 ? (
          <EmptyState>
            <p>
              Nothing scheduled in the next 30 days. Publish a post, or save a draft with a future date
              — a draft with a future date is the schedule (Wordless has no “future” status yet).
            </p>
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Posts</th>
              </tr>
            </thead>
            <tbody>
              {daysWithPosts.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>
                    {day.posts.map((p) => (
                      <span key={p.id} style={{ display: "block" }}>
                        <a href={`#/${p.type === "page" ? "pages" : "posts"}/${p.id}/edit`}>{p.title || "(untitled)"}</a>{" "}
                        <span className="muted">({p.status})</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">{calendar ? `${calendar.total} post(s) in the window ${calendar.from} → ${calendar.to}.` : ""}</p>
      </div>

      <div className="card">
        <h3>Content templates</h3>
        <p className="muted">Create a real draft post, prefilled with blocks. Nothing here is a demo — the draft is a post you can edit and publish.</p>
        {!templates ? (
          <Spinner />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>What it is</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.slug}>
                  <td>{t.name}</td>
                  <td>{t.description}</td>
                  <td>
                    <button type="button" className="small primary" onClick={() => void createDraft(t.slug)}>
                      Create draft
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Content ideas (AI)</h3>
        {!providers ? (
          <Spinner />
        ) : !providerReady ? (
          <div>
            <p>
              No AI provider is configured ({providers.selected} is the selected provider). Ideas are
              generated by the content-writer agent through the real AI task API — nothing is invented
              here.
            </p>
            <button type="button" onClick={() => void useMockProvider()}>
              Use the mock provider (local development)
            </button>
          </div>
        ) : (
          <p className="muted">
            Using {selectedProvider?.name}. Drafts are proposed, never published by the agent.
          </p>
        )}
        <div className="field">
          <label htmlFor="idea-topic">Topic for a draft post</label>
          <input id="idea-topic" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. how the pack prepares for winter" />
        </div>
        <button type="button" className="primary" disabled={busy || !providerReady} onClick={() => void generateIdea()}>
          {busy ? "Drafting…" : "Generate draft"}
        </button>
        {ideaTask?.result ? (
          <div style={{ marginTop: 16 }}>
            <p>
              <strong>{ideaTask.result.summary}</strong>
            </p>
            {ideaTask.result.output ? <pre style={{ whiteSpace: "pre-wrap" }}>{ideaTask.result.output}</pre> : null}
            {appliedPostId(ideaTask) !== null ? (
              <p>
                <a href={`#/posts/${appliedPostId(ideaTask) as number}/edit`}>Open the draft in the editor ↗</a>
              </p>
            ) : ideaTask.result.approvals.length > 0 ? (
              <p>
                The draft is waiting for approval — review it in the <a href="#/ai">AI command centre</a>.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>Recent AI drafts</h3>
        {!tasks ? (
          <Spinner />
        ) : tasks.tasks.length === 0 ? (
          <EmptyState>
            <p>No AI tasks yet. Generate an idea above, or run an agent from the AI command centre.</p>
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Request</th>
                <th>Status</th>
                <th>Draft</th>
              </tr>
            </thead>
            <tbody>
              {tasks.tasks.slice(0, 10).map((t) => {
                const postId = appliedPostId(t);
                return (
                  <tr key={t.id}>
                    <td>{t.agent}</td>
                    <td>{t.input.slice(0, 80)}</td>
                    <td>{t.status}</td>
                    <td>
                      {postId !== null ? <a href={`#/posts/${postId}/edit`}>Open draft ↗</a> : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
