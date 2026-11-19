import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { SecurityOverview, SessionView, TotpSetup } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function SecurityPage(): React.ReactElement {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, s, t] = await Promise.all([
        api.get<SecurityOverview>("/api/security/overview"),
        api.get<SessionView[]>("/api/auth/sessions"),
        api.get<{ enabled: boolean }>("/api/auth/2fa/status"),
      ]);
      setOverview(o);
      setSessions(s);
      setTwoFaEnabled(t.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load security overview.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startSetup = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.post<TotpSetup>("/api/auth/2fa/setup", {}));
      setRecoveryCodes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start two-factor setup.");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!setup) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>("/api/auth/2fa/confirm", { code: setupCode.trim() });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setSetupCode("");
      setNotice("Two-factor authentication is now enabled. Store the recovery codes somewhere safe — they are shown once.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code was not accepted.");
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/2fa/disable", { password: disablePassword });
      setDisablePassword("");
      setNotice("Two-factor authentication is disabled. You have been signed out everywhere — sign in again.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable two-factor authentication.");
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async (): Promise<void> => {
    if (!window.confirm("Sign out every session, including this one?")) return;
    setError(null);
    try {
      await api.post<{ revoked: number }>("/api/auth/sessions/revoke-all", {});
      setNotice("All sessions revoked. You will need to sign in again.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke sessions.");
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <p>{notice}</p>
          {recoveryCodes ? (
            <div>
              <p>
                <strong>Recovery codes (one-time use, shown once):</strong>
              </p>
              <ul>
                {recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="card">
        <h2>Security headers</h2>
        {!overview ? (
          <Spinner />
        ) : (
          <p>
            Applied to every response: Content-Security-Policy, X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
            Referrer-Policy, Permissions-Policy. The CSP allows the inline styles and scripts the admin and analytics
            need — see docs/security/security.md for the rationale.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Login lockout</h2>
        {!overview ? (
          <Spinner />
        ) : (
          <div>
            <p>
              {overview.lockout.config.maxAttempts} failed attempts in {overview.lockout.config.windowMinutes} minutes
              locks a login name / IP for {overview.lockout.config.lockoutMinutes} minutes (doubling on consecutive
              lockouts, capped at 60). A successful login clears the counter.
            </p>
            {overview.lockout.lockedKeys.length === 0 ? (
              <p className="muted">No keys are currently locked.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Attempts</th>
                    <th>Locked until</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.lockout.lockedKeys.map((k) => (
                    <tr key={k.key}>
                      <td>
                        <code>{k.key}</code>
                      </td>
                      <td>{k.attempts}</td>
                      <td>{k.lockedUntil}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {overview.defaultAdminLoginExists ? (
              <p className="error">A user with the default login name “admin” exists — rename it.</p>
            ) : (
              <p className="muted">No user with the default login name “admin” exists.</p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Two-factor authentication</h2>
        {twoFaEnabled === null ? (
          <Spinner />
        ) : twoFaEnabled ? (
          <div>
            <p>Two-factor authentication is enabled for your account.</p>
            <form onSubmit={(e) => void disable2fa(e)}>
              <div className="field">
                <label htmlFor="disable-2fa-password">Account password (to disable 2FA)</label>
                <input
                  id="disable-2fa-password"
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" disabled={busy}>
                Disable two-factor authentication
              </button>
              <p className="muted">Disabling signs you out everywhere.</p>
            </form>
          </div>
        ) : (
          <div>
            <p>Two-factor authentication is not enabled for your account.</p>
            {!setup ? (
              <button type="button" onClick={() => void startSetup()} disabled={busy}>
                Set up two-factor authentication
              </button>
            ) : (
              <div>
                <p>
                  Scan this with your authenticator app, or enter the secret manually:{" "}
                  <code>{setup.secret}</code>
                </p>
                <p className="muted">Setup URL (QR-friendly):</p>
                <p>
                  <code>{setup.url}</code>
                </p>
                <form onSubmit={(e) => void confirmSetup(e)}>
                  <div className="field">
                    <label htmlFor="totp-setup-code">6-digit code from your authenticator app</label>
                    <input
                      id="totp-setup-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={setupCode}
                      onChange={(e) => setSetupCode(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" disabled={busy}>
                    Confirm and enable
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
        {overview && overview.twoFactor.length > 0 ? (
          <div>
            <h3>Administrators</h3>
            <table>
              <thead>
                <tr>
                  <th>Login</th>
                  <th>2FA</th>
                </tr>
              </thead>
              <tbody>
                {overview.twoFactor.map((a) => (
                  <tr key={a.userId}>
                    <td>{a.login}</td>
                    <td>
                      <span className={`badge ${a.enabled ? "pass" : "fail"}`}>{a.enabled ? "enabled" : "not enabled"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Your sessions ({overview ? overview.sessions.active : "…"} active site-wide)</h2>
        {!sessions ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <EmptyState>No sessions.</EmptyState>
        ) : (
          <div>
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Last seen</th>
                  <th>Expires</th>
                  <th>Browser</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.createdAt}</td>
                    <td>{s.lastSeenAt ?? "—"}</td>
                    <td>{s.expiresAt}</td>
                    <td>{s.userAgent ?? "—"}</td>
                    <td>
                      {s.current ? <span className="badge pass">this session</span> : null}
                      {s.revoked ? <span className="badge fail">revoked</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => void revokeAll()}>
              Revoke all my sessions
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recent failed logins</h2>
        {!overview ? (
          <Spinner />
        ) : overview.failedLogins.length === 0 ? (
          <EmptyState>No failed logins recorded.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {overview.failedLogins.map((f, i) => (
                <tr key={`${f.createdAt}-${i}`}>
                  <td>{f.createdAt}</td>
                  <td>{f.details ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
