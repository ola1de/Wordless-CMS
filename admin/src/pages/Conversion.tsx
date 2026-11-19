import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ConversionJob, ExtensionRecord } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function ConversionPage(): React.ReactElement {
  const [jobs, setJobs] = useState<ConversionJob[] | null>(null);
  const [extensions, setExtensions] = useState<ExtensionRecord[] | null>(null);
  const [selected, setSelected] = useState<ConversionJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [list, exts] = await Promise.all([api.listConversionJobs(), api.listExtensions()]);
      setJobs(list.jobs);
      setExtensions(exts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load conversion jobs.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (!cancelled) {
        // no-op: load() sets state itself
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while any job is still running (local processing is synchronous,
  // so this is normally one refresh right after starting a job).
  const anyActive = jobs?.some((j) => j.status === "pending" || j.status === "running") ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive]);

  // Keep the selected job fresh when the list refreshes.
  useEffect(() => {
    if (selected === null || jobs === null) return;
    const fresh = jobs.find((j) => j.id === selected.id);
    if (fresh !== undefined && fresh.updatedAt !== selected.updatedAt) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const startJob = async (start: () => Promise<ConversionJob>): Promise<void> => {
    setError(null);
    setWorking(true);
    try {
      const job = await start();
      setSelected(job);
      setShowCode(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start the conversion job.");
    } finally {
      setWorking(false);
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".php")) {
      setError("Only .php files can be converted.");
      return;
    }
    await startJob(() => api.uploadPhpFile(file));
  };

  const report = selected?.report;
  const helloDolly = extensions?.find((e) => e.slug === "hello-dolly");

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}

      <div className="card">
        <h2>Convert a WordPress plugin</h2>
        <p className="muted">
          The converter translates PHP source to a Wordless extension module — statically, without ever
          running the PHP. Uploads are capped at 1 MB. Anything the sandbox blocks (eval, shell
          commands, dynamic includes, unserialize) fails the job with a reason instead of a partial
          success. Converted code runs only through the Wordless extension API.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".php"
            style={{ display: "none" }}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={working}
            onClick={() => fileRef.current?.click()}
          >
            {working ? "Converting…" : "Upload a .php file"}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => void startJob(() => api.startFixtureJob("hello-dolly"))}
          >
            Convert the Hello Dolly fixture
          </button>
          <span className="muted">Hello Dolly is the bundled WordPress plugin — a known-good first conversion.</span>
        </div>
      </div>

      <div className="card">
        <h2>Installed extensions</h2>
        {!extensions ? (
          <Spinner />
        ) : extensions.length === 0 ? (
          <EmptyState>
            No extensions installed yet. Convert the Hello Dolly fixture to install the first one.
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Extension</th>
                <th>Version</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {extensions.map((ext) => (
                <tr key={ext.slug}>
                  <td>
                    {ext.name} <span className="muted">({ext.slug})</span>
                  </td>
                  <td>{ext.version}</td>
                  <td>
                    <span className={`badge ${ext.status === "active" ? "good" : ""}`}>{ext.status}</span>
                  </td>
                  <td className="muted">{ext.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {helloDolly ? (
          <p className="muted">
            Hello Dolly is installed and active: its <code>admin_notices</code> hook returns a lyric
            line and <code>admin_head</code> returns its stylesheet. See{" "}
            <code>examples/hello-dolly/</code> in the repo for the generated module.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Conversion jobs</h2>
        {!jobs ? (
          <Spinner />
        ) : jobs.length === 0 ? (
          <EmptyState>No conversion jobs yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => {
                    setSelected(job);
                    setShowCode(false);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    {job.filename}
                    {job.fixture ? <span className="muted"> (fixture: {job.fixture})</span> : null}
                  </td>
                  <td>
                    <span className={`badge ${job.status === "done" ? "good" : job.status === "failed" ? "critical" : ""}`}>
                      {job.status}
                    </span>
                  </td>
                  <td>{job.progress}%</td>
                  <td className="muted">{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected ? (
        <div className="card">
          <h2>
            Job report — {selected.filename}{" "}
            <span className={`badge ${selected.status === "done" ? "good" : selected.status === "failed" ? "critical" : ""}`}>
              {selected.status}
            </span>
          </h2>
          {selected.error ? (
            <ErrorBox message={selected.error} />
          ) : null}
          {report ? (
            <div>
              <p className="muted">
                {report.source.lines} lines · {report.ast.nodes} AST nodes · {report.ast.functions}{" "}
                functions · {report.ast.classes} classes · {report.ast.hooks} hooks ·{" "}
                {report.durationMs} ms
              </p>
              <h3>Converted ({report.converted.functions.length} functions)</h3>
              {report.converted.functions.length === 0 ? (
                <p className="muted">No functions converted.</p>
              ) : (
                <ul>
                  {report.converted.functions.map((fn) => (
                    <li key={fn}>
                      <code>{fn}</code>
                    </li>
                  ))}
                </ul>
              )}
              {report.converted.hooks.length > 0 ? (
                <div>
                  <h3>Hooks registered</h3>
                  <ul>
                    {report.converted.hooks.map((h) => (
                      <li key={`${h.kind}:${h.tag}`}>
                        <code>
                          {h.kind} “{h.tag}” → {h.functionName}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.transformed.length > 0 ? (
                <div>
                  <h3>Transformed</h3>
                  <ul>
                    {report.transformed.map((t, i) => (
                      <li key={i}>
                        <strong>{t.what}:</strong> {t.note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.unconverted.length > 0 ? (
                <div>
                  <h3>Not converted ({report.unconverted.length})</h3>
                  <ul>
                    {report.unconverted.map((u, i) => (
                      <li key={i}>
                        <code>
                          {u.kind}
                          {u.name ? ` ${u.name}` : ""}
                        </code>{" "}
                        (line {u.line}): {u.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted">Nothing flagged as unconverted.</p>
              )}
              {report.warnings.length > 0 ? (
                <div>
                  <h3>Warnings ({report.warnings.length})</h3>
                  <ul>
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p>
                Extension: <code>{report.extension.name}</code> {report.extension.version} (slug{" "}
                <code>{report.extension.slug}</code>)
              </p>
              <button type="button" className="small" onClick={() => setShowCode((v) => !v)}>
                {showCode ? "Hide generated code" : "Show generated code"}
              </button>
              {showCode ? (
                <pre style={{ overflowX: "auto", maxHeight: "32rem" }}>{report.output.code}</pre>
              ) : null}
            </div>
          ) : selected.status === "done" ? (
            <p className="muted">The job finished but no report was stored.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
