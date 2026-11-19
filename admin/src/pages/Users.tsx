import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Role, User, UserList } from "../lib/types";
import { EmptyState, ErrorBox, Modal, Pagination, Spinner } from "../components/ui";

const ROLES: Role[] = ["administrator", "editor", "author", "contributor", "subscriber"];

export function UsersPage({ currentUser }: { currentUser: User }): React.ReactElement {
  const [list, setList] = useState<UserList | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("subscriber");
  const [tempPassword, setTempPassword] = useState<{ login: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.get<UserList>(`/api/users?page=${page}&per_page=20`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<User>("/api/users", {
        login: login.trim(),
        email: email.trim(),
        password,
        role,
      });
      setNotice(`User “${created.login}” created.`);
      setLogin("");
      setEmail("");
      setPassword("");
      setRole("subscriber");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    }
  };

  const changeRole = async (user: User, next: Role): Promise<void> => {
    setError(null);
    try {
      await api.put<User>(`/api/users/${user.id}/role`, { role: next });
      setNotice(`“${user.login}” is now ${next}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Role change failed.");
    }
  };

  const remove = async (user: User): Promise<void> => {
    if (user.id === currentUser.id) {
      setError("You cannot delete your own account.");
      return;
    }
    if (!window.confirm(`Delete user “${user.login}”?`)) return;
    setError(null);
    try {
      await api.del(`/api/users/${user.id}`);
      setNotice(`Deleted “${user.login}”.`);
      await load();
    } catch (err) {
      // The API refuses with 400 when the user owns posts — show its message.
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const resetPassword = async (user: User): Promise<void> => {
    if (!window.confirm(`Reset the password for “${user.login}”? Their sessions will be revoked.`)) return;
    setError(null);
    try {
      const { temporaryPassword } = await api.post<{ user: User; temporaryPassword: string }>(
        `/api/users/${user.id}/reset-password`,
      );
      setTempPassword({ login: user.login, password: temporaryPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="card">
        <h3>Add new user</h3>
        <form onSubmit={(e) => void create(e)}>
          <div className="field">
            <label htmlFor="user-login">Username</label>
            <input id="user-login" value={login} onChange={(e) => setLogin(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="user-email">Email</label>
            <input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="user-password">Password</label>
            <input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="field">
            <label htmlFor="user-role">Role</label>
            <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="primary">
            Add user
          </button>
        </form>
      </div>

      <div className="card">
        {!list ? (
          <Spinner />
        ) : list.users.length === 0 ? (
          <EmptyState>No users found.</EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Registered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.login}</td>
                    <td>{user.email}</td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(e) => void changeRole(user, e.target.value as Role)}
                        aria-label={`Role for ${user.login}`}
                        style={{ width: "auto" }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{user.registered.slice(0, 10)}</td>
                    <td>
                      <button type="button" className="small" onClick={() => void resetPassword(user)}>
                        Reset password
                      </button>{" "}
                      <button
                        type="button"
                        className="small danger"
                        disabled={user.id === currentUser.id}
                        onClick={() => void remove(user)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={list.page} totalPages={list.totalPages} total={list.total} onPage={setPage} />
          </>
        )}
      </div>

      {tempPassword ? (
        <Modal title="Temporary password" onClose={() => setTempPassword(null)}>
          <p>
            The temporary password for <strong>{tempPassword.login}</strong> is shown <strong>once</strong>. Copy it
            now and share it securely — it will not be shown again, and it is not stored anywhere in plain text.
          </p>
          <p style={{ fontSize: 20, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
            {tempPassword.password}
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                void navigator.clipboard?.writeText(tempPassword.password);
              }}
            >
              Copy
            </button>
            <button type="button" onClick={() => setTempPassword(null)}>
              Done
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
