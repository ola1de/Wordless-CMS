/**
 * Proposal applier (Milestone 6).
 *
 * Applies a proposed action through the EXISTING services — never raw
 * SQL writes to content tables. This is the single choke point where an
 * approved AI action touches the site, so the allow-lists here are the
 * safety boundary:
 * - update_option only touches a small allow-list of safe settings.
 * - create_post always creates a DRAFT (publishing is a separate,
 *   high-risk `publish_post` action that needs its own approval).
 * - No delete actions exist at all in M6.
 */
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import type { ProposedAction } from "../../ai/types";
import { setOption } from "../options/service";
import { createPost, updatePost } from "../posts/service";
import { createTerm } from "../terms/service";
import { saveVariation } from "../themes/service";

/** Option keys an approved AI action may change. Nothing else. */
const OPTION_ALLOWLIST: Record<string, "string" | "int" | "comment-status"> = {
  blogname: "string",
  blogdescription: "string",
  posts_per_page: "int",
  default_comment_status: "comment-status",
};

function requirePayloadString(payload: Record<string, unknown>, field: string, max = 10000): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`Proposal payload is missing a valid "${field}".`);
  }
  if (value.length > max) throw badRequest(`Proposal payload field "${field}" is too long.`);
  return value;
}

function optionalPayloadString(payload: Record<string, unknown>, field: string, max = 10000): string | undefined {
  const value = payload[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`Proposal payload field "${field}" must be a string.`);
  if (value.length > max) throw badRequest(`Proposal payload field "${field}" is too long.`);
  return value;
}

/**
 * Apply one proposed action as `userId`. Returns a small result object
 * (ids of what was created/updated) for the task result and audit trail.
 */
export async function applyProposal(
  db: Db,
  action: ProposedAction,
  userId: number,
): Promise<Record<string, unknown>> {
  const payload = action.payload;
  switch (action.type) {
    case "create_post": {
      const post = await createPost(db, {
        title: requirePayloadString(payload, "title", 1000),
        content: optionalPayloadString(payload, "content", 1_000_000) ?? "",
        excerpt: optionalPayloadString(payload, "excerpt", 10000),
        status: "draft",
        type: "post",
        authorId: userId,
      });
      return { postId: post.id, slug: post.slug };
    }
    case "update_post": {
      const postId = payload.postId;
      if (typeof postId !== "number" || !Number.isInteger(postId) || postId < 1) {
        throw badRequest('Proposal payload is missing a valid "postId".');
      }
      const post = await updatePost(db, postId, {
        title: optionalPayloadString(payload, "title", 1000),
        content: optionalPayloadString(payload, "content", 1_000_000),
        excerpt: optionalPayloadString(payload, "excerpt", 10000),
      });
      return { postId: post.id };
    }
    case "publish_post": {
      const postId = payload.postId;
      if (typeof postId !== "number" || !Number.isInteger(postId) || postId < 1) {
        throw badRequest('Proposal payload is missing a valid "postId".');
      }
      const post = await updatePost(db, postId, { status: "publish" });
      return { postId: post.id, status: post.status };
    }
    case "update_option": {
      const key = requirePayloadString(payload, "key", 191);
      const kind = OPTION_ALLOWLIST[key];
      if (kind === undefined) {
        throw badRequest(`Option "${key}" is not on the AI allow-list and cannot be changed by an agent.`);
      }
      const value = payload.value;
      if (kind === "string") {
        if (typeof value !== "string" || value.trim() === "") {
          throw badRequest(`Proposal payload for option "${key}" must be a non-empty string.`);
        }
        await setOption(db, key, value);
      } else if (kind === "int") {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
          throw badRequest(`Proposal payload for option "${key}" must be an integer between 1 and 100.`);
        }
        await setOption(db, key, value);
      } else {
        if (value !== "open" && value !== "closed") {
          throw badRequest(`Proposal payload for option "${key}" must be "open" or "closed".`);
        }
        await setOption(db, key, value);
      }
      return { key };
    }
    case "create_term": {
      const term = await createTerm(db, {
        name: requirePayloadString(payload, "name", 200),
        taxonomy: requirePayloadString(payload, "taxonomy", 32),
        slug: optionalPayloadString(payload, "slug", 200),
      });
      return { termTaxonomyId: term.termTaxonomyId };
    }
    case "update_theme_variation": {
      const slug = requirePayloadString(payload, "slug", 100);
      const settings = payload.settings;
      if (settings === undefined || typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        throw badRequest('Proposal payload is missing a valid "settings" object.');
      }
      const variation = await saveVariation(db, slug, {
        name: "AI suggestion",
        settings: settings as Record<string, unknown>,
      });
      return { slug, updatedAt: variation.updatedAt };
    }
    default:
      throw badRequest(`Unknown proposal action type "${String((action as { type?: unknown }).type)}".`);
  }
}
