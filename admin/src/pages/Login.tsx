import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { Icon, LogoMark } from "../components/icons";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: User) => void }): React.ReactElement {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.login(login.trim(), password, needsTotp ? totp.trim() : undefined);
      onLoggedIn(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.message.includes("Two-factor")) {
        setNeedsTotp(true);
        setError("Two-factor authentication is enabled for this account — enter the 6-digit code from your authenticator app (or a recovery code).");
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-inner">
        <div className="login-card">
          <div className="login-brand">
            <LogoMark size={52} />
            <h1>Wordless</h1>
            <p>The autonomous website operating system</p>
          </div>
          {error ? (
            <div className="error" role="alert">
              <Icon name="alert" size={18} />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          ) : null}
          <form onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="login-username">Username or email</label>
              <div className="input-icon">
                <Icon name="user" size={17} />
                <input
                  id="login-username"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <div className="input-icon">
                <Icon name="lock" size={17} />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            {needsTotp ? (
              <div className="field">
                <label htmlFor="login-totp">Authenticator code (or recovery code)</label>
                <div className="input-icon">
                  <Icon name="security" size={17} />
                  <input
                    id="login-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    required
                  />
                </div>
              </div>
            ) : null}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" }} aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Log in"
              )}
            </button>
          </form>
        </div>
        <p className="login-foot">
          <a href="/">← Back to the site</a>
        </p>
      </div>
    </div>
  );
}
