import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Term } from "../lib/types";
import { EmptyState, ErrorBox, Pagination, Spinner } from "../components/ui";

interface TermList {
  terms: Term[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function TermsPage(): React.ReactElement {
  const [taxonomy, setTaxonomy] = useState<"category" | "tag">("category");
  const [list, setList] = useState<TermList | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<Term | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      setList(
        await api.get<TermList>(`/api/terms?taxonomy=${taxonomy}&page=${page}&per_page=20`),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load terms.");
    }
  }, [taxonomy, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await api.post<Term>("/api/terms", {
        name: name.trim(),
        slug: slug.trim() || undefined,
        taxonomy,
        description: description.trim() || undefined,
      });
      setNotice(`Created “${name.trim()}”.`);
      setName("");
      setSlug("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    }
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    try {
      await api.put<Term>(`/api/terms/${editing.termTaxonomyId}`, { name: editName.trim() });
      setNotice("Saved.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  };

  const remove = async (term: Term): Promise<void> => {
    if (term.count > 0) {
      setError(`“${term.name}” is used by ${term.count} post(s) and cannot be deleted yet.`);
      return;
    }
    if (!window.confirm(`Delete “${term.name}”?`)) return;
    try {
      await api.del(`/api/terms/${term.termTaxonomyId}`);
      setNotice("Deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      <div className="toolbar">
        <button
          type="button"
          className={taxonomy === "category" ? "primary" : ""}
          onClick={() => {
            setTaxonomy("category");
            setPage(1);
          }}
        >
          Categories
        </button>
        <button
          type="button"
          className={taxonomy === "tag" ? "primary" : ""}
          onClick={() => {
            setTaxonomy("tag");
            setPage(1);
          }}
        >
          Tags
        </button>
      </div>

      <div className="card">
        <h3>Add new {taxonomy === "category" ? "category" : "tag"}</h3>
        <form onSubmit={(e) => void create(e)}>
          <div className="field">
            <label htmlFor="term-name">Name</label>
            <input id="term-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="term-slug">Slug (optional)</label>
            <input id="term-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="term-desc">Description (optional)</label>
            <input id="term-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button type="submit" className="primary">
            Add {taxonomy === "category" ? "category" : "tag"}
          </button>
        </form>
      </div>

      <div className="card">
        {!list ? (
          <Spinner />
        ) : list.terms.length === 0 ? (
          <EmptyState>
            No {taxonomy === "category" ? "categories" : "tags"} yet.
          </EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Posts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.terms.map((term) =>
                  editing?.termTaxonomyId === term.termTaxonomyId ? (
                    <tr key={term.termTaxonomyId}>
                      <td>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Term name" />
                      </td>
                      <td>/{term.slug}</td>
                      <td>{term.count}</td>
                      <td>
                        <button type="button" className="small primary" onClick={() => void saveEdit()}>
                          Save
                        </button>{" "}
                        <button type="button" className="small" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={term.termTaxonomyId}>
                      <td>{term.name}</td>
                      <td>/{term.slug}</td>
                      <td>{term.count}</td>
                      <td>
                        <button
                          type="button"
                          className="small"
                          onClick={() => {
                            setEditing(term);
                            setEditName(term.name);
                          }}
                        >
                          Rename
                        </button>{" "}
                        <button type="button" className="small danger" onClick={() => void remove(term)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <Pagination page={list.page} totalPages={list.totalPages} total={list.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
