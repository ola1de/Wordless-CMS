/**
 * Themes + Customizer (Milestone 5).
 *
 * Lists installed themes (import a block or classic theme from a ZIP,
 * activate, delete), and a customizer for the ACTIVE block theme: edit
 * theme.json settings (colour palette, font sizes, font families,
 * spacing scale, content/wide widths), preview the unsaved overrides in
 * an iframe of the public site (server-side preview token, never JS
 * injection), save as a variation, or reset to the theme defaults.
 *
 * Full site-template editing is OUT of scope for v1 — the page says so.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { ThemeDetail, ThemeRecord, ThemeVariation } from "../lib/types";
import { EmptyState, ErrorBox, Spinner } from "../components/ui";

type Settings = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => isRecord(v)) : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Merge a variation's preset arrays over the base settings (match by slug). */
function mergeSettings(base: Settings, over: Settings): Settings {
  const merged: Settings = { ...base };
  for (const [section, value] of Object.entries(over)) {
    const baseSection = isRecord(merged[section]) ? { ...(merged[section] as Settings) } : {};
    if (!isRecord(value)) {
      merged[section] = value;
      continue;
    }
    const nextSection: Settings = { ...baseSection };
    for (const [key, val] of Object.entries(value)) {
      if (Array.isArray(val)) {
        const baseArr = asArray(baseSection[key]);
        const mergedArr = [...baseArr];
        for (const row of asArray(val)) {
          const slug = str(row.slug);
          const idx = mergedArr.findIndex((r) => str(r.slug) === slug);
          if (idx >= 0) mergedArr[idx] = { ...mergedArr[idx], ...row };
          else mergedArr.push(row);
        }
        nextSection[key] = mergedArr;
      } else {
        nextSection[key] = val;
      }
    }
    merged[section] = nextSection;
  }
  return merged;
}

function sectionOf(settings: Settings, section: string): Record<string, unknown> {
  return isRecord(settings[section]) ? (settings[section] as Record<string, unknown>) : {};
}

function listOf(settings: Settings, section: string, key: string): Array<Record<string, unknown>> {
  return asArray(sectionOf(settings, section)[key]);
}

function setList(settings: Settings, section: string, key: string, rows: Array<Record<string, unknown>>): Settings {
  return {
    ...settings,
    [section]: { ...sectionOf(settings, section), [key]: rows },
  };
}

function setLayout(settings: Settings, key: string, value: string): Settings {
  return { ...settings, layout: { ...sectionOf(settings, "layout"), [key]: value } };
}

interface PresetListProps {
  title: string;
  rows: Array<Record<string, unknown>>;
  valueField: "color" | "size" | "fontFamily";
  valueLabel: string;
  onChange: (rows: Array<Record<string, unknown>>) => void;
}

function PresetList({ title, rows, valueField, valueLabel, onChange }: PresetListProps): React.ReactElement {
  const update = (index: number, field: string, value: string): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onChange(next);
  };
  const remove = (index: number): void => onChange(rows.filter((_, i) => i !== index));
  const add = (): void => onChange([...rows, { slug: "", [valueField]: "", name: "" }]);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No entries yet.</p>
      ) : (
        rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="slug"
              value={str(row.slug)}
              onChange={(e) => update(i, "slug", e.target.value)}
              style={{ width: 110 }}
              aria-label="Slug"
            />
            {valueField === "color" ? (
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(str(row.color)) ? str(row.color) : "#000000"}
                onChange={(e) => update(i, "color", e.target.value)}
                aria-label="Colour"
              />
            ) : null}
            <input
              type="text"
              placeholder={valueLabel}
              value={str(row[valueField])}
              onChange={(e) => update(i, valueField, e.target.value)}
              style={{ width: valueField === "fontFamily" ? 220 : 110 }}
              aria-label={valueLabel}
            />
            <input
              type="text"
              placeholder="Name"
              value={str(row.name)}
              onChange={(e) => update(i, "name", e.target.value)}
              style={{ width: 140 }}
              aria-label="Name"
            />
            <button type="button" onClick={() => remove(i)}>
              Remove
            </button>
          </div>
        ))
      )}
      <button type="button" onClick={add}>
        Add entry
      </button>
    </div>
  );
}

export function ThemeEditorPage(): React.ReactElement {
  const [themes, setThemes] = useState<ThemeRecord[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThemeDetail | null>(null);
  const [variation, setVariation] = useState<ThemeVariation | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [variationName, setVariationName] = useState("Custom");
  const [importKind, setImportKind] = useState<"block" | "classic">("block");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewExpires, setPreviewExpires] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async (): Promise<void> => {
    try {
      const list = await api.listThemes();
      setThemes(list);
      const active = list.find((t) => t.status === "active") ?? null;
      setActiveSlug(active?.slug ?? null);
      if (active !== null) {
        const [det, varn] = await Promise.all([api.getTheme(active.slug), api.getVariation(active.slug)]);
        setDetail(det);
        setVariation(varn);
        const base = isRecord(det.themeJson) && isRecord(det.themeJson.settings) ? (det.themeJson.settings as Settings) : {};
        setSettings(varn !== null ? mergeSettings(base, varn.settings) : base);
        if (varn !== null) setVariationName(varn.name);
      } else {
        setDetail(null);
        setVariation(null);
        setSettings({});
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load themes.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (!cancelled) {
        // no-op: load() sets state itself
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = themes?.find((t) => t.slug === activeSlug) ?? null;

  const doImport = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a theme .zip file first.");
      return;
    }
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      const theme = await api.importTheme(file, importKind);
      setNotice(`Imported “${theme.name}” (${theme.kind}). Activate it to use it on the public site.`);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setWorking(false);
    }
  };

  const doActivate = async (slug: string): Promise<void> => {
    setError(null);
    setWorking(true);
    try {
      await api.activateTheme(slug);
      setNotice(`Activated “${slug}”. The public site now uses it (stylesheet URL is versioned, so caches bust).`);
      setPreviewUrl(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setWorking(false);
    }
  };

  const doDelete = async (slug: string): Promise<void> => {
    if (!window.confirm(`Delete theme “${slug}”? Its files are removed from storage. This cannot be undone.`)) return;
    setError(null);
    setWorking(true);
    try {
      await api.deleteTheme(slug);
      setNotice(`Deleted “${slug}”.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setWorking(false);
    }
  };

  const doPreview = async (): Promise<void> => {
    if (activeSlug === null) return;
    setError(null);
    setWorking(true);
    try {
      const token = await api.createPreview(activeSlug, settings);
      setPreviewUrl(`${window.location.origin}/?wl_preview=${encodeURIComponent(token.token)}`);
      setPreviewExpires(token.expiresAt);
      setNotice("Preview ready below — it shows the public site with your unsaved changes. The preview link expires in 30 minutes.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setWorking(false);
    }
  };

  const doSave = async (): Promise<void> => {
    if (activeSlug === null) return;
    setError(null);
    setWorking(true);
    try {
      const saved = await api.saveVariation(activeSlug, variationName, settings);
      setVariation(saved);
      setNotice(`Variation “${saved.name}” saved — the live site now uses these settings on top of the theme.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setWorking(false);
    }
  };

  const doReset = async (): Promise<void> => {
    if (activeSlug === null) return;
    setError(null);
    setWorking(true);
    try {
      await api.deleteVariation(activeSlug);
      setVariation(null);
      setPreviewUrl(null);
      const det = await api.getTheme(activeSlug);
      setDetail(det);
      const base = isRecord(det.themeJson) && isRecord(det.themeJson.settings) ? (det.themeJson.settings as Settings) : {};
      setSettings(base);
      setNotice("Reset to the theme defaults — the saved variation was removed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setWorking(false);
    }
  };

  if (themes === null) return <Spinner />;

  const classicReport = (t: ThemeRecord): { convertible: number; partial: number; blocked: number } | null => {
    if (t.kind !== "classic" || !isRecord(t.report)) return null;
    const r = t.report;
    if (typeof r.convertible !== "number") return null;
    return {
      convertible: r.convertible as number,
      partial: typeof r.partial === "number" ? r.partial : 0,
      blocked: typeof r.blocked === "number" ? r.blocked : 0,
    };
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Themes</h2>
      {error !== null && <ErrorBox message={error} onDismiss={() => setError(null)} />}
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Import a theme</h3>
        <p className="hint">
          Upload a theme .zip (max 5 MB). Block themes need <code>style.css</code> with a theme header plus{" "}
          <code>theme.json</code>; classic themes are imported for their stylesheet plus a per-file conversion report —
          their PHP templates are analysed, never executed or fully converted.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".zip" aria-label="Theme ZIP file" />
          <select value={importKind} onChange={(e) => setImportKind(e.target.value as "block" | "classic")} aria-label="Theme kind">
            <option value="block">Block theme</option>
            <option value="classic">Classic theme</option>
          </select>
          <button type="button" className="primary" onClick={() => void doImport()} disabled={working}>
            {working ? "Importing…" : "Import"}
          </button>
        </div>
      </div>

      {themes.length === 0 ? (
        <EmptyState>No themes installed. The built-in Wordless default theme is normally seeded on first use.</EmptyState>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Installed themes</h3>
          {themes.map((t) => {
            const report = classicReport(t);
            return (
              <div key={t.slug} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <strong>{t.name}</strong> <span className="muted">v{t.version}</span>{" "}
                <span className="muted">
                  by {t.author === "" ? "—" : t.author} · {t.kind} · {t.source} ·{" "}
                  <code>{t.stylesheetHash.slice(0, 8)}</code>
                </span>{" "}
                {t.status === "active" ? <span className="badge">Active</span> : null}
                {report !== null && (
                  <p className="hint" style={{ margin: "4px 0" }}>
                    Classic import — PHP files analysed: {report.convertible} convertible · {report.partial} partial ·{" "}
                    {report.blocked} blocked. Only the stylesheet is used on the site.
                  </p>
                )}
                <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                  {t.status !== "active" && (
                    <button type="button" onClick={() => void doActivate(t.slug)} disabled={working}>
                      Activate
                    </button>
                  )}
                  {t.status !== "active" && t.slug !== "wordless-default" && (
                    <button type="button" onClick={() => void doDelete(t.slug)} disabled={working}>
                      Delete
                    </button>
                  )}
                  {t.slug === "wordless-default" && t.status === "active" && <span className="muted">Built-in default — cannot be deleted.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2>Customizer</h2>
      <p className="hint">
        Edits the active theme&apos;s <code>theme.json</code> settings. Full site-template editing is not in v1 — templates
        are edited by importing a new theme version.
      </p>
      {active === null ? (
        <EmptyState>No active theme.</EmptyState>
      ) : active.kind === "classic" ? (
        <div className="card">
          <p>
            The active theme “{active.name}” is a classic theme. Variations apply to block themes only — a classic
            theme renders with its imported stylesheet as-is. Activate a block theme to use the customizer.
          </p>
        </div>
      ) : detail === null ? (
        <Spinner />
      ) : (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>
              {active.name} {variation !== null ? <span className="muted">— variation “{variation.name}” saved</span> : null}
            </h3>
            <label className="field">
              Variation name
              <input type="text" value={variationName} onChange={(e) => setVariationName(e.target.value)} />
            </label>
          </div>

          <PresetList
            title="Colour palette"
            rows={listOf(settings, "color", "palette")}
            valueField="color"
            valueLabel="#rrggbb"
            onChange={(rows) => setSettings(setList(settings, "color", "palette", rows))}
          />
          <PresetList
            title="Font sizes"
            rows={listOf(settings, "typography", "fontSizes")}
            valueField="size"
            valueLabel="Size (e.g. 1.25rem)"
            onChange={(rows) => setSettings(setList(settings, "typography", "fontSizes", rows))}
          />
          <PresetList
            title="Font families"
            rows={listOf(settings, "typography", "fontFamilies")}
            valueField="fontFamily"
            valueLabel="Stack (e.g. Georgia, serif)"
            onChange={(rows) => setSettings(setList(settings, "typography", "fontFamilies", rows))}
          />
          <PresetList
            title="Spacing scale"
            rows={listOf(settings, "spacing", "spacingSizes")}
            valueField="size"
            valueLabel="Size (e.g. 30px)"
            onChange={(rows) => setSettings(setList(settings, "spacing", "spacingSizes", rows))}
          />

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Layout</h3>
            <label className="field">
              Content width
              <input
                type="text"
                value={str(sectionOf(settings, "layout").contentSize)}
                onChange={(e) => setSettings(setLayout(settings, "contentSize", e.target.value))}
                placeholder="e.g. 680px"
              />
            </label>
            <label className="field">
              Wide width
              <input
                type="text"
                value={str(sectionOf(settings, "layout").wideSize)}
                onChange={(e) => setSettings(setLayout(settings, "wideSize", e.target.value))}
                placeholder="e.g. 1080px"
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button type="button" className="primary" onClick={() => void doPreview()} disabled={working}>
              Preview changes
            </button>
            <button type="button" onClick={() => void doSave()} disabled={working}>
              Save variation
            </button>
            <button type="button" onClick={() => void doReset()} disabled={working}>
              Reset to theme defaults
            </button>
            <a href="/" target="_blank" rel="noreferrer">
              View live site ↗
            </a>
          </div>

          {previewUrl !== null && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Preview (unsaved changes)</h3>
              <p className="hint">
                Preview link expires at {previewExpires !== null ? new Date(previewExpires).toLocaleString() : "—"}. It
                renders server-side with your unsaved overrides — nothing is injected into the page.
              </p>
              <iframe
                title="Theme preview"
                src={previewUrl}
                style={{ width: "100%", height: 480, border: "1px solid var(--border)", borderRadius: 8 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
