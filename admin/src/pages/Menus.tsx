import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Menu, MenuItem } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

export function MenusPage(): React.ReactElement {
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [locations, setLocations] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [locationName, setLocationName] = useState("primary");

  const loadMenus = useCallback(async () => {
    try {
      const [m, locs] = await Promise.all([
        api.get<Menu[]>("/api/menus"),
        api.get<Record<string, number>>("/api/menus/locations"),
      ]);
      setMenus(m);
      setLocations(locs);
      if (m.length > 0 && selectedId === null) setSelectedId(m[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load menus.");
    }
  }, [selectedId]);

  useEffect(() => {
    void loadMenus();
  }, [loadMenus]);

  useEffect(() => {
    if (selectedId === null) {
      setItems(null);
      return;
    }
    let cancelled = false;
    api
      .get<MenuItem[]>(`/api/menus/${selectedId}/items`)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load menu items.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const createMenu = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      const menu = await api.post<Menu>("/api/menus", { name: newMenuName.trim() });
      setNotice(`Menu “${menu.name}” created.`);
      setNewMenuName("");
      await loadMenus();
      setSelectedId(menu.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    }
  };

  const addItem = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (selectedId === null) return;
    setError(null);
    try {
      await api.post<MenuItem>(`/api/menus/${selectedId}/items`, {
        title: itemTitle.trim(),
        type: "custom",
        url: itemUrl.trim(),
      });
      setNotice("Menu item added.");
      setItemTitle("");
      setItemUrl("");
      setItems(await api.get<MenuItem[]>(`/api/menus/${selectedId}/items`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add item failed.");
    }
  };

  const removeItem = async (itemId: number): Promise<void> => {
    if (selectedId === null) return;
    try {
      await api.del(`/api/menus/${selectedId}/items/${itemId}`);
      setItems(await api.get<MenuItem[]>(`/api/menus/${selectedId}/items`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    }
  };

  const setLocation = async (): Promise<void> => {
    if (selectedId === null) return;
    setError(null);
    try {
      const updated = await api.post<Record<string, number>>("/api/menus/locations", {
        location: locationName.trim().toLowerCase(),
        menuId: selectedId,
      });
      setLocations(updated);
      setNotice(`Menu assigned to location “${locationName.trim().toLowerCase()}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed.");
    }
  };

  const selected = menus?.find((m) => m.id === selectedId) ?? null;

  return (
    <div>
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="card">
        <h3>Create a menu</h3>
        <form onSubmit={(e) => void createMenu(e)}>
          <div className="field">
            <label htmlFor="menu-name">Menu name</label>
            <input id="menu-name" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} required />
          </div>
          <button type="submit" className="primary">
            Create menu
          </button>
        </form>
      </div>

      {!menus ? (
        <Spinner />
      ) : menus.length === 0 ? (
        <EmptyState>No menus yet. Create one above.</EmptyState>
      ) : (
        <>
          <div className="toolbar">
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              aria-label="Select menu"
            >
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="muted">
              Locations:{" "}
              {Object.keys(locations).length === 0
                ? "none assigned"
                : Object.entries(locations)
                    .map(([loc, menuId]) => `${loc} → ${menus.find((m) => m.id === menuId)?.name ?? menuId}`)
                    .join(", ")}
            </span>
          </div>

          <div className="card">
            <h3>Items — {selected?.name}</h3>
            {!items ? (
              <Spinner />
            ) : items.length === 0 ? (
              <EmptyState>No items in this menu yet.</EmptyState>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>URL</th>
                    <th>Type</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>{item.url}</td>
                      <td>{item.type}</td>
                      <td>
                        <button type="button" className="small danger" onClick={() => void removeItem(item.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={(e) => void addItem(e)} style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="item-title">Add a custom link — title</label>
                <input id="item-title" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="item-url">URL</label>
                <input
                  id="item-url"
                  value={itemUrl}
                  onChange={(e) => setItemUrl(e.target.value)}
                  placeholder="https://example.com/page or /about"
                  required
                />
              </div>
              <button type="submit" className="primary">
                Add item
              </button>
            </form>
          </div>

          <div className="card">
            <h3>Assign to a location</h3>
            <p className="muted">
              Locations are theme slots (for example “primary” for the main navigation). The public site renders the
              menu assigned to each location.
            </p>
            <div className="field">
              <label htmlFor="location-name">Location name</label>
              <input id="location-name" value={locationName} onChange={(e) => setLocationName(e.target.value)} />
            </div>
            <button type="button" onClick={() => void setLocation()}>
              Assign “{selected?.name}” to this location
            </button>
          </div>
        </>
      )}
    </div>
  );
}
