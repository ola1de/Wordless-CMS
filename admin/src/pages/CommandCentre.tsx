/**
 * AI Command Centre (Milestone 6) — providers, operating mode, agents,
 * tasks, approvals and website memory. Every section says plainly when
 * something is not configured or unavailable instead of pretending.
 * AI output is always labelled as such; nothing is published from here
 * without an approval (supervised/autonomous) or a draft proposal.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type {
  AgentInfo,
  AiApproval,
  AiMode,
  AiProvidersResponse,
  AiTask,
  MemoryEntry,
  MemoryList,
  ProviderInfo,
} from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

const MODE_ORDER: AiMode[] = ["manual", "supervised", "autonomous"];
const MODE_LABELS: Record<AiMode, string> = {
  manual: "Manual",
  supervised: "Supervised",
  autonomous: "Autonomous",
};
const MODE_TEXT: Record<AiMode, string> = {
  manual: "Agents only draft. Nothing is applied.",
  supervised: "Every proposal waits for your approval. Nothing applies on its own.",
  autonomous: "Low-risk proposals (e.g. draft posts) apply automatically. Anything destructive or publishing still waits for approval.",
};

export function CommandCentrePage(): React.ReactElement {
  const [providers, setProviders] = useState<AiProvidersResponse | null>(null);
  const [mode, setMode] = useState<AiMode | null>(null);
  const [modeDescription, setModeDescription] = useState("");
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [tasks, setTasks] = useState<AiTask[] | null>(null);
  const [selectedTask, setSelectedTask] = useState<AiTask | null>(null);
  const [approvals, setApprovals] = useState<AiApproval[] | null>(null);
  const [memory, setMemory] = useState<MemoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [probe, setProbe] = useState<Record<string, string>>({});

  const [agentId, setAgentId] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [taskMode, setTaskMode] = useState<"" | AiMode>("");
  const [noteText, setNoteText] = useState("");
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const load = async (): Promise<void> => {
    try {
      const [prov, modeRes, agentList, taskList, apprList, mem] = await Promise.all([
        api.getAiProviders(),
        api.getAiMode(),
        api.listAiAgents(),
        api.listAiTasks(),
        api.listAiApprovals("pending"),
        api.getAiMemory(),
      ]);
      setProviders(prov);
      setMode(modeRes.mode);
      setModeDescription(modeRes.description);
      setAgents(agentList);
      setTasks(taskList.tasks);
      setApprovals(apprList.approvals);
      setMemory(mem);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the AI command centre.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (!cancelled) {
        /* load() sets state itself */
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshTasks = async (): Promise<void> => {
    try {
      const [taskList, apprList] = await Promise.all([api.listAiTasks(), api.listAiApprovals("pending")]);
      setTasks(taskList.tasks);
      setApprovals(apprList.approvals);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to refresh tasks.");
    }
  };

  const selectProvider = async (id: string): Promise<void> => {
    setError(null);
    try {
      setProviders(await api.selectAiProvider(id));
      setNotice(`Provider set to ${id}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not change the provider.");
    }
  };

  const testProvider = async (provider: ProviderInfo): Promise<void> => {
    setError(null);
    try {
      const result = await api.testAiProvider(provider.id);
      setProbe((prev) => ({ ...prev, [provider.id]: result.ok ? `OK — ${result.message}` : `Not OK — ${result.message}` }));
    } catch (err: unknown) {
      setProbe((prev) => ({
        ...prev,
        [provider.id]: `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  };

  const setOperatingMode = async (next: AiMode): Promise<void> => {
    setError(null);
    try {
      const res = await api.setAiMode(next);
      setMode(res.mode);
      setModeDescription(res.description);
      setNotice(`Operating mode set to ${res.mode}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not change the operating mode.");
    }
  };

  const runTask = async (): Promise<void> => {
    if (agentId === "" || taskInput.trim() === "") {
      setError("Pick an agent and write what you want it to do.");
      return;
    }
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      const task = await api.createAiTask({
        agent: agentId,
        input: taskInput.trim(),
        mode: taskMode === "" ? undefined : taskMode,
      });
      setSelectedTask(task);
      setTaskInput("");
      await refreshTasks();
      if (task.status === "failed") {
        setError(task.error ?? "The AI task failed.");
      } else if (task.result !== undefined && task.result.approvals.length > 0) {
        setNotice(`Task finished. ${task.result.approvals.length} proposal(s) waiting for approval below.`);
      } else if (task.result !== undefined && task.result.applied.length > 0) {
        setNotice(`Task finished. ${task.result.applied.length} low-risk action(s) applied automatically.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not run the AI task.");
    } finally {
      setWorking(false);
    }
  };

  const decide = async (approval: AiApproval, approve: boolean): Promise<void> => {
    setError(null);
    try {
      if (approve) {
        await api.approveAiApproval(approval.id);
        setNotice(`Approved: ${approval.action.summary}`);
      } else {
        await api.rejectAiApproval(approval.id, rejectReason[approval.id] ?? "");
        setNotice(`Rejected: ${approval.action.summary}`);
      }
      await refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not decide the approval.");
    }
  };

  const addNote = async (): Promise<void> => {
    if (noteText.trim() === "") return;
    setError(null);
    try {
      await api.addAiMemoryNote(noteText.trim());
      setNoteText("");
      setMemory(await api.getAiMemory());
      setNotice("Note added to website memory.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add the note.");
    }
  };

  const removeNote = async (note: MemoryEntry): Promise<void> => {
    setError(null);
    try {
      await api.deleteAiMemoryNote(note.id);
      setMemory(await api.getAiMemory());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete the note.");
    }
  };

  const rebuild = async (): Promise<void> => {
    setError(null);
    try {
      const res = await api.rebuildAiMemory();
      setMemory(await api.getAiMemory());
      setNotice(`Website memory rebuilt: ${res.facts} facts, ${res.notes} notes.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not rebuild website memory.");
    }
  };

  const availableAgents = (agents ?? []).filter((a) => a.available);
  const selectedProvider = providers?.providers.find((p) => p.id === providers.selected);

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <p className="card" style={{ background: "var(--surface-muted)" }}>
          {notice}
        </p>
      ) : null}

      <div className="card">
        <h2>AI providers</h2>
        <p className="muted">
          Workers AI (Cloudflare) is the default and only required provider — no API key, just the{" "}
          <code>[ai]</code> binding in wrangler.toml. OpenAI-compatible is an optional fallback that needs a
          secret key. The mock provider is for local development only (canned responses, no real AI).
        </p>
        {providers === null ? (
          <Spinner />
        ) : providers.providers.length === 0 ? (
          <EmptyState>No AI providers are registered.</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {providers.providers.map((p) => (
              <li
                key={p.id}
                style={{ borderBottom: "1px solid var(--border)", padding: "0.6rem 0" }}
              >
                <strong>{p.name}</strong>
                {p.recommended ? <span> — Recommended (default)</span> : null}
                {providers.selected === p.id ? <span> — Selected</span> : null}
                <br />
                <span className="muted">{p.description}</span>
                <br />
                <span className="muted">
                  {p.configured ? "Configured. " : "Not configured. "}
                  {p.configuredDetail}
                </span>
                {probe[p.id] ? (
                  <span>
                    <br />
                    {probe[p.id]}
                  </span>
                ) : null}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                  <button type="button" disabled={providers.selected === p.id} onClick={() => void selectProvider(p.id)}>
                    {providers.selected === p.id ? "Selected" : "Select"}
                  </button>
                  <button type="button" onClick={() => void testProvider(p)}>
                    Test
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {selectedProvider !== undefined && !selectedProvider.configured ? (
          <p style={{ marginTop: "0.6rem" }}>
            The selected provider is not configured, so provider-based agents will fail honestly with
            &ldquo;not configured&rdquo; until it is. Analysis agents (SEO, security, performance, …) still work.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Operating mode</h2>
        <p className="muted">{modeDescription}</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "primary" : ""}
              onClick={() => void setOperatingMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {MODE_ORDER.map((m) => (
          <p key={m} className="muted" style={{ margin: "0.4rem 0 0" }}>
            <strong>{MODE_LABELS[m]}:</strong> {MODE_TEXT[m]}
          </p>
        ))}
      </div>

      <div className="card">
        <h2>Agents</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          The email-composer and social-composer only draft — they never send. Sending an email happens through the
          email integration (Integrations page), and only when it is configured; in test mode messages are logged,
          not delivered. There is no social publishing integration: social is share links only.
        </p>
        {agents === null ? (
          <Spinner />
        ) : agents.length === 0 ? (
          <EmptyState>No agents are registered.</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {agents.map((a) => (
              <li key={a.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.6rem 0" }}>
                <strong>{a.name}</strong>{" "}
                <span className="muted">
                  (risk: {a.risk}
                  {a.requiresProvider ? ", needs a provider" : ", no provider needed"})
                </span>
                <br />
                <span className="muted">{a.description}</span>
                <br />
                <span className="muted">Can: {a.capabilities.join("; ")}</span>
                {!a.available ? (
                  <span>
                    <br />
                    <strong>Unavailable:</strong> {a.unavailableReason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Run a task</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <label>
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={{ display: "block", marginTop: "0.3rem", width: "100%" }}
            >
              <option value="">Choose an agent…</option>
              {availableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What should it do?
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              rows={3}
              placeholder="e.g. Draft a post about our new opening hours"
              style={{ display: "block", marginTop: "0.3rem", width: "100%" }}
            />
          </label>
          <label>
            Mode for this task (leave blank for the site mode)
            <select
              value={taskMode}
              onChange={(e) => setTaskMode(e.target.value as "" | AiMode)}
              style={{ display: "block", marginTop: "0.3rem" }}
            >
              <option value="">Site mode ({mode ?? "…"})</option>
              {MODE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="button" className="primary" disabled={working} onClick={() => void runTask()}>
              {working ? "Running…" : "Run task"}
            </button>
          </div>
        </div>
        {selectedTask?.result !== undefined ? (
          <div style={{ marginTop: "0.8rem" }}>
            <h3>Result — {selectedTask.agent}</h3>
            <p>{selectedTask.result.summary}</p>
            {selectedTask.result.output ? (
              <pre style={{ whiteSpace: "pre-wrap", background: "var(--surface-muted)", padding: "0.6rem" }}>
                {selectedTask.result.output}
              </pre>
            ) : null}
            {selectedTask.result.proposals.length > 0 ? (
              <p className="muted">
                Proposals: {selectedTask.result.proposals.map((p) => p.summary).join("; ")}
              </p>
            ) : null}
            {selectedTask.result.applied.length > 0 ? (
              <p className="muted">
                Applied: {selectedTask.result.applied.map((a) => a.summary).join("; ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Recent tasks</h2>
        {tasks === null ? (
          <Spinner />
        ) : tasks.length === 0 ? (
          <EmptyState>No AI tasks yet. Run one above.</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tasks.slice(0, 10).map((t) => (
              <li key={t.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.5rem 0" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
                  onClick={() => setSelectedTask(t)}
                >
                  <strong>{t.agent}</strong> — {t.status} ({t.mode})
                  <br />
                  <span className="muted">{t.result?.summary ?? t.input.slice(0, 100)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Approvals</h2>
        {approvals === null ? (
          <Spinner />
        ) : approvals.length === 0 ? (
          <EmptyState>Nothing waiting for approval.</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {approvals.map((a) => (
              <li key={a.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.6rem 0" }}>
                <strong>{a.agent}</strong> — {a.action.summary} <span className="muted">(risk: {a.action.risk})</span>
                <br />
                <span className="muted">
                  Type: {a.action.type}; created {a.createdAt}
                </span>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                  <button type="button" className="primary" onClick={() => void decide(a, true)}>
                    Approve &amp; apply
                  </button>
                  <input
                    type="text"
                    placeholder="Reason for rejecting (optional)"
                    value={rejectReason[a.id] ?? ""}
                    onChange={(e) => setRejectReason((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    style={{ flex: "1 1 12rem" }}
                  />
                  <button type="button" onClick={() => void decide(a, false)}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Website memory</h2>
        <p className="muted">
          Facts the agents use as context, re-ingested from the site (title, tagline, posts, theme,
          extensions), plus notes you add. Memory never contains secrets.
        </p>
        <button type="button" onClick={() => void rebuild()}>
          Rebuild memory from the site
        </button>
        {memory === null ? (
          <Spinner />
        ) : (
          <div style={{ marginTop: "0.6rem" }}>
            <h3>Facts</h3>
            {memory.facts.length === 0 ? (
              <EmptyState>No facts yet — rebuild memory from the site.</EmptyState>
            ) : (
              <ul>
                {memory.facts.map((f) => (
                  <li key={f.id}>
                    <code>{f.key}</code>: {f.value.length > 200 ? `${f.value.slice(0, 200)}…` : f.value}
                  </li>
                ))}
              </ul>
            )}
            <h3>Notes</h3>
            {memory.notes.length === 0 ? <EmptyState>No notes yet.</EmptyState> : null}
            <ul>
              {memory.notes.map((n) => (
                <li key={n.id}>
                  {n.value}{" "}
                  <button type="button" onClick={() => void removeNote(n)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
              <input
                type="text"
                placeholder="Add a note for the agents, e.g. Our tone is plain and friendly."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                style={{ flex: "1 1 12rem" }}
              />
              <button type="button" onClick={() => void addNote()}>
                Add note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
