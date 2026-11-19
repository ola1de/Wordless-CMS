import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import type { BackupJobResult, BackupRow, BackupVerifyReport } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function BackupPage(): React.ReactElement {
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyReport, setVerifyReport] = useState<BackupVerifyReport | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      setBackups(await api.get<BackupRow[]>("/api/backup"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backups.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const job = await api.post<BackupJobResult>("/api/backup/create", {});
      if (job.status === "done" && job.result !== null && !("error" in job.result)) {
        setNotice(`Backup created: ${job.result.id} (${formatBytes(job.result.size)}). Verify it before relying on it.`);
      } else {
        setError(job.result !== null && "error" in job.result ? job.result.error : "Backup job did not complete.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (backup: BackupRow): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const report = await api.post<BackupVerifyReport>(`/api/backup/${backup.id}/verify`, {});
      setVerifyReport(report);
      if (report.ok) {
        setNotice(`Backup ${backup.id} verified: every file checksum matches.`);
      } else {
        setError(`Backup ${backup.id} FAILED verification — do not restore it.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    }
  };

  const download = (backup: BackupRow): void => {
    window.location.href = `/api/backup/${backup.id}/download`;
  };

  const restore = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!restoreTarget) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const report = await api.post<{
        backupId: string;
        restoredTables: string[];
        rowsRestored: number;
        missingMedia: string[];
        mediaChecked: number;
      }>(`/api/backup/${restoreTarget.id}/restore`, { confirmation: restoreConfirmation });
      setNotice(
        `Restored ${report.rowsRestored} rows across ${report.restoredTables.length} tables.` +
          (report.missingMedia.length > 0
            ? ` Missing media keys (not restored): ${report.missingMedia.join(", ")}.`
            : " No media keys were missing."),
      );
      setRestoreTarget(null);
      setRestoreConfirmation("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="card">
        <p>
          Backups are real ZIPs in R2 (<code>backups/&lt;id&gt;.zip</code>): one JSON file per database table, a media
          manifest, and a manifest with a SHA-256 checksum per file. A backup is only “verified” after its checksums
          are re-read and recomputed. Restore replaces the database with the backup — it needs the typed confirmation{" "}
          <code>RESTORE</code> and refuses a backup that failed verification. The 10 most recent backups are kept.
        </p>
        <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
          {busy ? "Creating backup…" : "Create backup now"}
        </button>
      </div>

      {verifyReport ? (
        <div className="card">
          <h2>Verification: {verifyReport.backupId}</h2>
          <p>
            {verifyReport.ok ? "All files match their checksums." : "CHECKSUM MISMATCH — this backup must not be restored."}{" "}
            (verified {verifyReport.verifiedAt})
          </p>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {verifyReport.files.map((f) => (
                <tr key={f.file}>
                  <td>
                    <code>{f.file}</code>
                  </td>
                  <td>
                    <span className={`badge ${f.ok ? "pass" : "fail"}`}>{f.ok ? "ok" : "mismatch"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setVerifyReport(null)}>
            Close
          </button>
        </div>
      ) : null}

      {restoreTarget ? (
        <div className="card">
          <h2>Restore backup {restoreTarget.id}</h2>
          <p>
            This replaces the current database with the backup from {restoreTarget.createdAt}. Media files are checked
            against storage and reported if missing — they are not copied. This cannot be undone.
          </p>
          <form onSubmit={(e) => void restore(e)}>
            <div className="field">
              <label htmlFor="restore-confirmation">Type RESTORE to confirm</label>
              <input
                id="restore-confirmation"
                value={restoreConfirmation}
                onChange={(e) => setRestoreConfirmation(e.target.value)}
                placeholder="RESTORE"
                required
              />
            </div>
            <button type="submit" disabled={busy || restoreConfirmation !== "RESTORE"}>
              Restore this backup
            </button>{" "}
            <button
              type="button"
              onClick={() => {
                setRestoreTarget(null);
                setRestoreConfirmation("");
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h2>Backups</h2>
        {!backups ? (
          <Spinner />
        ) : backups.length === 0 ? (
          <EmptyState>No backups yet. Create one above.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Size</th>
                <th>Tables</th>
                <th>Media</th>
                <th>Verified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{b.createdAt}</td>
                  <td>{formatBytes(b.size)}</td>
                  <td>{Object.keys(b.tables).length}</td>
                  <td>{b.mediaCount}</td>
                  <td>
                    <span className={`badge ${b.verified ? "pass" : "fail"}`}>{b.verified ? "verified" : "not verified"}</span>
                  </td>
                  <td>
                    <button type="button" onClick={() => void verify(b)}>
                      Verify
                    </button>{" "}
                    <button type="button" onClick={() => download(b)}>
                      Download
                    </button>{" "}
                    <button type="button" onClick={() => setRestoreTarget(b)} disabled={!b.verified}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">Restore is only available for backups that have passed verification.</p>
      </div>
    </div>
  );
}
