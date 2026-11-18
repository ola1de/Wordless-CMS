export type PostStatus = "draft" | "publish" | "private" | "trash";

export const ALL_POST_STATUSES: PostStatus[] = ["draft", "publish", "private", "trash"];

export function isPostStatus(value: unknown): value is PostStatus {
  return typeof value === "string" && (ALL_POST_STATUSES as string[]).includes(value);
}

export interface Post {
  id: number;
  authorId: number;
  date: string;
  dateGmt: string;
  content: string;
  title: string;
  excerpt: string;
  status: PostStatus;
  commentStatus: string;
  pingStatus: string;
  password: string;
  slug: string;
  modified: string;
  modifiedGmt: string;
  contentFiltered: string;
  parentId: number;
  guid: string;
  menuOrder: number;
  type: string;
  mimeType: string;
  commentCount: number;
}

export interface CreatePostInput {
  title: string;
  content?: string;
  excerpt?: string;
  slug?: string;
  status?: PostStatus;
  type?: string;
  authorId: number;
  parentId?: number;
  mimeType?: string;
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
  excerpt?: string;
  slug?: string;
  status?: PostStatus;
  type?: string;
  parentId?: number;
}

export interface ListPostsOptions {
  status?: PostStatus;
  type?: string;
  authorId?: number;
  page?: number;
  perPage?: number;
  /** When false (default), trashed posts are excluded from unfiltered lists. */
  includeTrash?: boolean;
}

export interface PostListResult {
  posts: Post[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
