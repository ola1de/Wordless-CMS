/** Comment approval: WordPress stores '1' (approved), '0' (pending), 'spam', 'trash'. */
export type CommentStatus = "approved" | "pending" | "spam" | "trash";

export const ALL_COMMENT_STATUSES: CommentStatus[] = ["approved", "pending", "spam", "trash"];

export function isCommentStatus(value: unknown): value is CommentStatus {
  return typeof value === "string" && (ALL_COMMENT_STATUSES as string[]).includes(value);
}

/** Stored value in wp_comments.comment_approved. */
export function toStoredStatus(status: CommentStatus): string {
  return status === "approved" ? "1" : status === "pending" ? "0" : status;
}

export function fromStoredStatus(value: string): CommentStatus {
  if (value === "1") return "approved";
  if (value === "0") return "pending";
  if (value === "spam") return "spam";
  if (value === "trash") return "trash";
  return "pending";
}

export interface Comment {
  id: number;
  postId: number;
  author: string;
  authorEmail: string;
  authorUrl: string;
  authorIp: string;
  date: string;
  dateGmt: string;
  content: string;
  status: CommentStatus;
  parentId: number;
  userId: number;
  children?: Comment[];
}

export interface CreateCommentInput {
  postId: number;
  author: string;
  authorEmail?: string;
  authorUrl?: string;
  content: string;
  parentId?: number;
  userId?: number;
  authorIp?: string;
  /** Honeypot field: must be empty. A filled honeypot means a bot. */
  honeypot?: string;
}

export interface ListCommentsOptions {
  postId?: number;
  status?: CommentStatus;
  page?: number;
  perPage?: number;
}

export interface CommentListResult {
  comments: Comment[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
