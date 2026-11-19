import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { HealthCheck, SiteHealth } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function HealthPage(): React.ReactElement {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<SiteHealth>("/api/site-health")
      .then((h) => {
        if (!cancelled) setChecks(h.checks);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load site health.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      <div className="card">
        {!checks ? (
          <Spinner />
        ) : checks.length === 0 ? (
          <EmptyState>No health checks returned.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.name}>
                  <td>{check.name}</td>
                  <td>
                    <span className={`badge ${check.status}`}>{check.status}</span>
                  </td>
                  <td>{check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
