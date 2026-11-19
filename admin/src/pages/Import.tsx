import { useState } from "react";
import type { ImportJobResult, ImportReport } from "../lib/types";
import { ErrorBox } from "../components/ui";

const FIXTURE_BASE = "https://raw.githubusercontent.com/ola1de/Wordless-CMS/main/test/fixtures/wordpress";

export function ImportPage(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"wxr" | "sql">("wxr");
  const [job, setJob] = useState<ImportJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setJob(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(kind === "wxr" ? "/api/import/wxr" : "/api/import/sql", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const body = (await res.json()) as { ok: boolean; data?: ImportJobResult; error?: { message?: string } };
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(body.error?.message ?? `Import failed (${res.status}).`);
      }
      setJob(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const report = (job?.result !== null && job?.result !== undefined && !("error" in job.result) ? job.result : null) as ImportReport | null;
  const jobError = job?.result !== null && job?.result !== undefined && "error" in job.result ? job.result.error : null;

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}

      <div className="card">
        <p>
          Import a WordPress site into Wordless. WXR (WordPress eXtended RSS) or a mysqldump of the 12{" "}
          <code>wp_*</code> tables, up to 10 MB. The importer parses data only — it never executes imported code.
          WordPress password hashes are not portable, so every imported user gets a forced password reset and cannot
          sign in until an administrator resets their password. PHP-serialized values become JSON; serialized objects
          are refused and recorded as failed.
        </p>
        <p>
          Test fixtures (synthetic, for trying the importer):{" "}
          <a href={`${FIXTURE_BASE}/wordpress-export.xml`} target="_blank" rel="noreferrer">
            wordpress-export.xml
          </a>{" "}
          ·{" "}
          <a href={`${FIXTURE_BASE}/wordpress-dump.sql`} target="_blank" rel="noreferrer">
            wordpress-dump.sql
          </a>
        </p>
        <form onSubmit={(e) => void start(e)}>
          <div className="field">
            <label htmlFor="import-kind">Format</label>
            <select id="import-kind" value={kind} onChange={(e) => setKind(e.target.value as "wxr" | "sql")}>
              <option value="wxr">WXR (WordPress export XML)</option>
              <option value="sql">SQL dump (mysqldump)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="import-file">File (max 10 MB)</label>
            <input
              id="import-file"
              type="file"
              accept={kind === "wxr" ? ".xml" : ".sql"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <button type="submit" className="primary" disabled={busy || !file}>
            {busy ? "Importing…" : "Start import"}
          </button>
        </form>
      </div>

      {jobError ? (
        <div className="card">
          <p className="error">Import job failed: {jobError}</p>
        </div>
      ) : null}

      {job ? (
        <div className="card">
          <h2>Import job {job.id}</h2>
          <p>
            Status: <span className={`badge ${job.status === "done" ? "pass" : job.status === "failed" ? "fail" : ""}`}>{job.status}</span>
          </p>
          {report ? (
            <div>
              <p>
                {report.counts.imported} imported · {report.counts.skipped} skipped · {report.counts.failed} failed
                {report.ignoredTables && report.ignoredTables.length > 0
                  ? ` · ignored tables: ${report.ignoredTables.join(", ")}`
                  : ""}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Imported</th>
                    <th>Skipped</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.counts.byType).map(([type, counts]) => (
                    <tr key={type}>
                      <td>{type}</td>
                      <td>{counts.imported}</td>
                      <td>{counts.skipped}</td>
                      <td>{counts.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Per-item report</h3>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item, i) => (
                    <tr key={`${item.type}-${item.sourceId}-${i}`}>
                      <td>{item.type}</td>
                      <td>
                        <code>{item.sourceId}</code>
                      </td>
                      <td>
                        <span className={`badge ${item.status === "imported" ? "pass" : item.status === "failed" ? "fail" : ""}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>{item.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2>What is not imported</h2>
        <p>
          Multisite tables, plugin tables, uploads binary blobs, and serialized PHP objects. Post revisions are
          skipped. See docs/import/wordpress-import.md for the full list.
        </p>
      </div>
    </div>
  );
}
