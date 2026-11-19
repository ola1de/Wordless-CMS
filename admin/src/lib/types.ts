/** Types for the Wordless API responses used by the admin SPA. */

export interface User {
  id: number;
  login: string;
  email: string;
  displayName: string;
  role: Role;
  registered: string;
}

export type Role = "administrator" | "editor" | "author" | "contributor" | "subscriber";

export interface Post {
  id: number;
  authorId: number;
  date: string;
  modified: string;
  title: string;
  content: string;
  excerpt: string;
  status: string;
  slug: string;
  type: "post" | "page" | "attachment" | "revision";
  commentStatus: string;
  commentCount: number;
}

export interface PostList {
  posts: Post[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface Revision {
  id: number;
  postId: number;
  authorId: number;
  date: string;
  title: string;
  content: string;
}

export interface MediaItem {
  id: number;
  authorId: number;
  date: string;
  title: string;
  mimeType: string;
  url: string;
  filename: string;
  size: number;
  alt: string;
  objectKey: string;
}

export interface MediaList {
  media: MediaItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface Term {
  id: number;
  termTaxonomyId: number;
  taxonomy: string;
  name: string;
  slug: string;
  description: string;
  parentId: number;
  count: number;
}

export interface WpComment {
  id: number;
  postId: number;
  author: string;
  authorEmail: string;
  authorUrl: string;
  date: string;
  content: string;
  status: "approved" | "pending" | "spam" | "trash";
}

export interface CommentList {
  comments: WpComment[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface Menu {
  id: number;
  name: string;
  slug: string;
}

export interface MenuItem {
  id: number;
  menuId: number;
  title: string;
  url: string;
  type: "custom" | "post" | "page" | "term";
  objectId: number;
  objectType: string;
  parentId: number;
  order: number;
  children?: MenuItem[];
}

export interface ActivityItem {
  id: number;
  actorId: number;
  action: string;
  objectType: string | null;
  objectId: string | null;
  details: string | null;
  createdAt: string;
}

export interface ActivityList {
  entries: ActivityItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface HealthCheck {
  name: string;
  status: "good" | "recommended" | "critical";
  message: string;
}

export interface SiteHealth {
  checks: HealthCheck[];
}

export interface Settings {
  siteTitle: string;
  siteTagline: string;
  postsPerPage: number;
  permalinkStructure: string;
  timezone: string;
  defaultCommentStatus: string;
  commentMaxLinks: number;
}

export interface UserList {
  users: User[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ConversionReport {
  source: { filename: string; bytes: number; lines: number };
  filesProcessed: number;
  ast: { nodes: number; functions: number; classes: number; hooks: number };
  converted: { functions: string[]; hooks: { tag: string; kind: string; functionName: string }[] };
  unconverted: { kind: string; name?: string; reason: string; line: number }[];
  warnings: string[];
  transformed: { what: string; note: string }[];
  output: { filename: string; bytes: number; code: string };
  extension: { slug: string; name: string; version: string };
  durationMs: number;
}

export interface ConversionJob {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  filename: string;
  fixture?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  report?: ConversionReport;
  error?: string;
}

export interface ConversionJobList {
  jobs: ConversionJob[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ExtensionRecord {
  slug: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Themes (Milestone 5). `report` is the parsed import/classic report when one exists. */
export interface ThemeRecord {
  slug: string;
  name: string;
  version: string;
  author: string;
  kind: "block" | "classic";
  status: "active" | "inactive";
  hasThemeJson: boolean;
  stylesheetHash: string;
  source: string;
  report: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeDetail extends ThemeRecord {
  themeJson: Record<string, unknown> | null;
  stylesheet: string;
  files: Record<string, string>;
}

export interface ThemeVariation {
  name: string;
  settings: Record<string, unknown>;
  updatedAt: string;
}

export interface PreviewToken {
  token: string;
  slug: string;
  settings: Record<string, unknown>;
  expiresAt: string;
}
