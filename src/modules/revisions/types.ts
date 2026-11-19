/**
 * Revisions — snapshots of a post stored as wp_posts rows, exactly like
 * WordPress: post_type 'revision', post_status 'inherit', post_parent =
 * the post id. Autosaves are revisions whose post_name ends in
 * '-autosave-v1' (one per post + author, updated in place).
 */
import type { Post } from "../posts/types";

export interface Revision {
  id: number;
  postId: number;
  authorId: number;
  date: string;
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  /** 'inherit' for real revisions; autosaves are also 'inherit'. */
  status: string;
  isAutosave: boolean;
}

export interface RevisionDiff {
  /** Number of lines present in `to` but not in `from`. */
  added: number;
  /** Number of lines present in `from` but not in `to`. */
  removed: number;
  /** First differing added lines (max 10). */
  addedLines: string[];
  /** First differing removed lines (max 10). */
  removedLines: string[];
}

export type { Post };
