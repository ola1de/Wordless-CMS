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
  /** Per-post SEO fields (Milestone 7) — present on the detail payload. */
  seo?: PostSeo;
}

/** SEO (Milestone 7). */
export interface PostSeo {
  title: string;
  description: string;
  focusKeyword: string;
  canonical: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImageId: number;
  twitterCard: "summary" | "summary_large_image";
}

export interface SeoCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface SeoAnalysis {
  postId: number;
  score: number;
  checks: SeoCheck[];
  wordCount: number;
  readingEase: number | null;
  internalLinks: number;
  externalLinks: number;
  images: number;
  imagesMissingAlt: number;
}

export interface RedirectRecord {
  id: number;
  oldPath: string;
  newPath: string;
  postId: number;
  createdAt: string;
}

export interface RedirectList {
  redirects: RedirectRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface NotFoundEntry {
  path: string;
  count: number;
  referrer: string;
  firstSeen: string;
  lastSeen: string;
}

export interface NotFoundList {
  entries: NotFoundEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ContentTemplate {
  slug: string;
  name: string;
  description: string;
  title: string;
  content: string;
}

export interface CalendarDay {
  date: string;
  posts: Array<{ id: number; title: string; status: string; type: string; slug: string }>;
}

export interface ContentCalendar {
  from: string;
  to: string;
  days: CalendarDay[];
  total: number;
}

export interface SeoImportResult {
  applied: number;
  skipped: Array<{ post: string; reason: string }>;
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

/** AI (Milestone 6). */
export type AiMode = "manual" | "supervised" | "autonomous";

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  configuredDetail: string;
  recommended: boolean;
  requiresKey: boolean;
}

export interface AiProvidersResponse {
  providers: ProviderInfo[];
  selected: string;
}

export interface AiModeResponse {
  mode: AiMode;
  description: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  risk: "low" | "medium" | "high";
  requiresProvider: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface AiProposal {
  type: string;
  summary: string;
  risk: "low" | "medium" | "high";
  payload: Record<string, unknown>;
}

export interface AiTaskResult {
  agent: string;
  mode: AiMode;
  summary: string;
  output?: string;
  data?: Record<string, unknown>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  proposals: AiProposal[];
  approvals: Array<{ id: string; summary: string; risk: string }>;
  applied: Array<{ summary: string; result: Record<string, unknown> }>;
  applyErrors?: Array<{ summary: string; error: string }>;
}

export interface AiTask {
  id: string;
  agent: string;
  input: string;
  mode: AiMode;
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  createdAt: string;
  updatedAt: string;
  result?: AiTaskResult;
  error?: string;
}

export interface AiTaskList {
  tasks: AiTask[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface AiApproval {
  id: string;
  taskId: string;
  agent: string;
  action: AiProposal;
  status: "pending" | "approved" | "rejected";
  createdBy: number;
  decidedBy: number | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiApprovalList {
  approvals: AiApproval[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface MemoryEntry {
  id: number;
  kind: "fact" | "note";
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}

export interface MemoryList {
  facts: MemoryEntry[];
  notes: MemoryEntry[];
}

/** Commerce + integrations (Milestone 8). */
export interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  priceMinor: number;
  currency: string;
  stock: number;
  status: "draft" | "published";
  featuredImageId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductList {
  products: Product[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface OrderItem {
  id: number;
  productId: number;
  name: string;
  priceMinor: number;
  quantity: number;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled";

export interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  paymentProvider: string;
  paymentReference: string;
  stockApplied: boolean;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderList {
  orders: Order[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface IntegrationInfo {
  id: string;
  name: string;
  kind: string;
  description: string;
  setupHint: string;
  configured: boolean;
  configuredDetail: string;
  config: Record<string, unknown>;
}

export interface MailLogEntry {
  id: number;
  provider: string;
  toEmail: string;
  subject: string;
  body: string;
  status: "logged" | "sent" | "failed";
  createdAt: string;
}

export interface MailLogList {
  entries: MailLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface AnalyticsStatus {
  provider: string;
  measurementId: string;
  configured: boolean;
  detail: string;
  snippet: string | null;
}

export interface BindingStatus {
  binding: string;
  present: boolean;
  detail: string;
}

export interface PaymentProviderInfo {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  configuredDetail: string;
  requiresKey: boolean;
}

export interface SelectedPayment {
  provider: string;
  mode: "test" | "live";
}

export interface WebhookLogEntry {
  id: number;
  provider: string;
  event: string;
  reference: string;
  result: string;
  detail: string;
  createdAt: string;
}

export interface WebhookLogList {
  entries: WebhookLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface MarketplaceExtension {
  slug: string;
  name: string;
  version: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/* Milestone 9 types — security, backup, importer, derivatives. */

export interface SecurityOverview {
  headers: { policy: string; applied: boolean };
  lockout: {
    config: { maxAttempts: number; windowMinutes: number; lockoutMinutes: number };
    lockedKeys: Array<{ key: string; attempts: number; lockedUntil: string; lockoutCount: number }>;
  };
  twoFactor: Array<{ userId: number; login: string; role: string; enabled: boolean }>;
  sessions: { active: number };
  failedLogins: Array<{ userId: number; createdAt: string; details: string | null }>;
  defaultAdminLoginExists: boolean;
}

export interface SessionView {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  ipHashPrefix: string | null;
  revoked: boolean;
  current: boolean;
}

export interface TotpSetup {
  secret: string;
  url: string;
}

export interface BackupRow {
  id: string;
  filename: string;
  size: number;
  checksum: string;
  tables: Record<string, number>;
  mediaCount: number;
  mediaMissing: number;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export interface BackupVerifyReport {
  backupId: string;
  ok: boolean;
  files: Array<{ file: string; expected: string; actual: string | null; ok: boolean }>;
  verifiedAt: string;
}

export interface BackupJobResult {
  id: string;
  status: string;
  result: BackupRow | { error: string } | null;
}

export interface ImportReportItem {
  type: string;
  sourceId: string;
  targetId: number | null;
  status: "imported" | "skipped" | "failed";
  reason?: string;
}

export interface ImportReport {
  kind: "wxr" | "sql";
  source: string;
  counts: {
    imported: number;
    skipped: number;
    failed: number;
    byType: Record<string, { imported: number; skipped: number; failed: number }>;
  };
  items: ImportReportItem[];
  ignoredTables?: string[];
  finishedAt: string;
}

export interface ImportJobResult {
  id: string;
  kind: string;
  status: string;
  result: ImportReport | { error: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DerivativeStatus {
  bound: boolean;
  stored: number;
  widths: number[];
}
