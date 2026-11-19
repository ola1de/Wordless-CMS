/**
 * Minimal fetch wrapper for the Wordless JSON envelope
 * `{ ok, data, error }`. Same-origin credentials so the session cookie
 * (`wordless_session`) is sent. Throws ApiError on non-OK responses.
 */
import type {
  AgentInfo,
  AiApproval,
  AiApprovalList,
  AiMode,
  AiModeResponse,
  AiProvidersResponse,
  AiTask,
  AiTaskList,
  ContentCalendar,
  ContentTemplate,
  ConversionJob,
  ConversionJobList,
  ExtensionRecord,
  MediaItem,
  MemoryEntry,
  MemoryList,
  NotFoundList,
  PostSeo,
  PreviewToken,
  ProviderInfo,
  RedirectList,
  RedirectRecord,
  SeoAnalysis,
  SeoImportResult,
  Settings,
  ThemeDetail,
  ThemeRecord,
  ThemeVariation,
  User,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, `Request failed (${res.status}).`);
  }
  if (!res.ok || !body.ok) {
    throw new ApiError(res.status, body.error?.message ?? `Request failed (${res.status}).`);
  }
  return body.data as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
  },
  put<T>(path: string, data: unknown): Promise<T> {
    return request<T>(path, { method: "PUT", body: JSON.stringify(data) });
  },
  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },

  me(): Promise<{ user: User }> {
    return request<{ user: User }>("/api/auth/me");
  },
  login(login: string, password: string): Promise<{ user: User }> {
    return request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
  },
  logout(): Promise<{ loggedOut: boolean }> {
    return request<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" });
  },

  getSettings(): Promise<Settings> {
    return request<Settings>("/api/settings");
  },
  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
  },

  /** Multipart media upload (no JSON content-type; the browser sets it). */
  async uploadMedia(file: File, opts?: { title?: string; alt?: string }): Promise<MediaItem> {
    const form = new FormData();
    form.append("file", file);
    if (opts?.title) form.append("title", opts.title);
    if (opts?.alt) form.append("alt", opts.alt);
    const res = await fetch("/api/media", { method: "POST", credentials: "same-origin", body: form });
    const body = (await res.json()) as Envelope<MediaItem>;
    if (!res.ok || !body.ok) {
      throw new ApiError(res.status, body.error?.message ?? `Upload failed (${res.status}).`);
    }
    return body.data as MediaItem;
  },

  /** Conversion jobs (Milestone 4): list, one job, start a fixture job, upload a PHP file. */
  listConversionJobs(): Promise<ConversionJobList> {
    return request<ConversionJobList>("/api/conversion/jobs");
  },
  getConversionJob(id: string): Promise<ConversionJob> {
    return request<ConversionJob>(`/api/conversion/jobs/${encodeURIComponent(id)}`);
  },
  startFixtureJob(fixture: string): Promise<ConversionJob> {
    return request<ConversionJob>("/api/conversion/jobs", {
      method: "POST",
      body: JSON.stringify({ fixture }),
    });
  },
  async uploadPhpFile(file: File): Promise<ConversionJob> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/conversion/jobs", { method: "POST", credentials: "same-origin", body: form });
    const body = (await res.json()) as Envelope<ConversionJob>;
    if (!res.ok || !body.ok) {
      throw new ApiError(res.status, body.error?.message ?? `Conversion failed (${res.status}).`);
    }
    return body.data as ConversionJob;
  },
  listExtensions(): Promise<ExtensionRecord[]> {
    return request<ExtensionRecord[]>("/api/extensions");
  },

  /** Themes (Milestone 5). */
  listThemes(): Promise<ThemeRecord[]> {
    return request<ThemeRecord[]>("/api/themes");
  },
  getTheme(slug: string): Promise<ThemeDetail> {
    return request<ThemeDetail>(`/api/themes/${encodeURIComponent(slug)}`);
  },
  getActiveTheme(): Promise<ThemeRecord> {
    return request<ThemeRecord>("/api/themes/active");
  },
  async importTheme(file: File, kind: "block" | "classic"): Promise<ThemeRecord> {
    const form = new FormData();
    form.append("file", file);
    const path = kind === "classic" ? "/api/themes/import-classic" : "/api/themes/import";
    const res = await fetch(path, { method: "POST", credentials: "same-origin", body: form });
    const body = (await res.json()) as Envelope<{ theme: ThemeRecord }>;
    if (!res.ok || !body.ok) {
      throw new ApiError(res.status, body.error?.message ?? `Theme import failed (${res.status}).`);
    }
    return (body.data as { theme: ThemeRecord }).theme;
  },
  activateTheme(slug: string): Promise<ThemeRecord> {
    return request<ThemeRecord>(`/api/themes/${encodeURIComponent(slug)}/activate`, { method: "POST" });
  },
  deleteTheme(slug: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/themes/${encodeURIComponent(slug)}/delete`, { method: "POST" });
  },
  getVariation(slug: string): Promise<ThemeVariation | null> {
    return request<ThemeVariation | null>(`/api/themes/${encodeURIComponent(slug)}/variation`);
  },
  saveVariation(slug: string, name: string, settings: Record<string, unknown>): Promise<ThemeVariation> {
    return request<ThemeVariation>(`/api/themes/${encodeURIComponent(slug)}/variation`, {
      method: "PUT",
      body: JSON.stringify({ name, settings }),
    });
  },
  deleteVariation(slug: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/themes/${encodeURIComponent(slug)}/variation`, { method: "DELETE" });
  },
  createPreview(slug: string, settings: Record<string, unknown>): Promise<PreviewToken> {
    return request<PreviewToken>("/api/themes/preview", {
      method: "POST",
      body: JSON.stringify({ slug, settings }),
    });
  },

  /** AI command centre (Milestone 6). */
  getAiProviders(): Promise<AiProvidersResponse> {
    return request<AiProvidersResponse>("/api/ai/providers");
  },
  selectAiProvider(provider: string): Promise<AiProvidersResponse> {
    return request<AiProvidersResponse>("/api/ai/providers/select", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
  },
  testAiProvider(id: string): Promise<{ ok: boolean; message: string }> {
    return request<{ ok: boolean; message: string }>(`/api/ai/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },
  getAiMode(): Promise<AiModeResponse> {
    return request<AiModeResponse>("/api/ai/mode");
  },
  setAiMode(mode: AiMode): Promise<AiModeResponse> {
    return request<AiModeResponse>("/api/ai/mode", { method: "PUT", body: JSON.stringify({ mode }) });
  },
  listAiAgents(): Promise<AgentInfo[]> {
    return request<AgentInfo[]>("/api/ai/agents");
  },
  createAiTask(input: { agent: string; input: string; mode?: AiMode }): Promise<AiTask> {
    return request<AiTask>("/api/ai/tasks", { method: "POST", body: JSON.stringify(input) });
  },
  listAiTasks(): Promise<AiTaskList> {
    return request<AiTaskList>("/api/ai/tasks");
  },
  listAiApprovals(status?: string): Promise<AiApprovalList> {
    const q = status !== undefined ? `?status=${encodeURIComponent(status)}` : "";
    return request<AiApprovalList>(`/api/ai/approvals${q}`);
  },
  approveAiApproval(id: string): Promise<AiApproval> {
    return request<AiApproval>(`/api/ai/approvals/${encodeURIComponent(id)}/approve`, { method: "POST" });
  },
  rejectAiApproval(id: string, reason?: string): Promise<AiApproval> {
    return request<AiApproval>(`/api/ai/approvals/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    });
  },
  getAiMemory(): Promise<MemoryList> {
    return request<MemoryList>("/api/ai/memory");
  },
  addAiMemoryNote(text: string): Promise<MemoryEntry> {
    return request<MemoryEntry>("/api/ai/memory/notes", { method: "POST", body: JSON.stringify({ text }) });
  },
  deleteAiMemoryNote(id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/ai/memory/notes/${id}`, { method: "DELETE" });
  },
  rebuildAiMemory(): Promise<{ facts: number; notes: number }> {
    return request<{ facts: number; notes: number }>("/api/ai/memory/rebuild", { method: "POST" });
  },

  /** SEO (Milestone 7). */
  getPostSeo(id: number): Promise<PostSeo> {
    return request<PostSeo>(`/api/posts/${id}/seo`);
  },
  updatePostSeo(id: number, patch: Partial<PostSeo>): Promise<PostSeo> {
    return request<PostSeo>(`/api/posts/${id}/seo`, { method: "PUT", body: JSON.stringify(patch) });
  },
  getPostSeoAnalysis(id: number): Promise<SeoAnalysis> {
    return request<SeoAnalysis>(`/api/posts/${id}/seo/analysis`);
  },
  getRobots(): Promise<{ robots: string }> {
    return request<{ robots: string }>("/api/seo/robots");
  },
  updateRobots(robots: string): Promise<{ robots: string }> {
    return request<{ robots: string }>("/api/seo/robots", { method: "PUT", body: JSON.stringify({ robots }) });
  },
  listTemplates(): Promise<ContentTemplate[]> {
    return request<ContentTemplate[]>("/api/seo/templates");
  },
  createFromTemplate(slug: string, title?: string): Promise<{ id: number }> {
    return request<{ id: number }>(`/api/seo/templates/${encodeURIComponent(slug)}/create`, {
      method: "POST",
      body: JSON.stringify({ title: title ?? "" }),
    });
  },
  getCalendar(days = 30): Promise<ContentCalendar> {
    return request<ContentCalendar>(`/api/seo/calendar?days=${days}`);
  },
  importSeo(posts: unknown[]): Promise<SeoImportResult> {
    return request<SeoImportResult>("/api/seo/import", { method: "POST", body: JSON.stringify({ posts }) });
  },
  listRedirects(page = 1): Promise<RedirectList> {
    return request<RedirectList>(`/api/seo/redirects?page=${page}`);
  },
  createRedirect(oldPath: string, newPath: string): Promise<RedirectRecord> {
    return request<RedirectRecord>("/api/seo/redirects", { method: "POST", body: JSON.stringify({ oldPath, newPath }) });
  },
  updateRedirect(id: number, newPath: string): Promise<RedirectRecord> {
    return request<RedirectRecord>(`/api/seo/redirects/${id}`, { method: "PUT", body: JSON.stringify({ newPath }) });
  },
  deleteRedirect(id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/seo/redirects/${id}`, { method: "DELETE" });
  },
  listNotFound(page = 1): Promise<NotFoundList> {
    return request<NotFoundList>(`/api/seo/404s?page=${page}`);
  },
  deleteNotFound(path: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/seo/404s?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  },
};
