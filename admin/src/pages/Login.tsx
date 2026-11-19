import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: User) => void }): React.ReactElement {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.login(login.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Wordless</h1>
        <p>Sign in to the admin.</p>
        {error ? <div className="error">{error}</div> : null}
        <form onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="login-username">Username or email</label>
            <input
              id="login-username"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
