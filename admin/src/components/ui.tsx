import type { ReactNode } from "react";

export function Spinner(): React.ReactElement {
  return <p className="muted">Loading…</p>;
}

export function EmptyState({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ message, onDismiss }: { message: string; onDismiss?: () => void }): React.ReactElement {
  return (
    <div className="error" role="alert">
      {message}
      {onDismiss ? (
        <button type="button" className="ghost small" onClick={onDismiss} style={{ float: "right" }}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}): React.ReactElement {
  return (
    <div className="pagination">
      <button type="button" className="small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      <span>
        Page {page} of {Math.max(totalPages, 1)} ({total} total)
      </span>
      <button type="button" className="small" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Badge({ status }: { status: string }): React.ReactElement {
  return <span className={`badge ${status}`}>{status}</span>;
}
