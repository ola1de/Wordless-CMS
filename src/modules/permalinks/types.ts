import type { Post } from "../posts/types";
import type { Term } from "../terms/types";

export type PermalinkStructure = "plain" | "postname" | "day-name" | "month-name";

export const ALL_PERMALINK_STRUCTURES: PermalinkStructure[] = ["plain", "postname", "day-name", "month-name"];

export function isPermalinkStructure(value: unknown): value is PermalinkStructure {
  return typeof value === "string" && (ALL_PERMALINK_STRUCTURES as string[]).includes(value);
}

export type ResolvedPath =
  | { kind: "redirect"; target: string }
  | { kind: "home" }
  | { kind: "post"; post: Post }
  | { kind: "page"; post: Post }
  | { kind: "term"; term: Term }
  | { kind: "date-archive"; year: number; month?: number }
  | { kind: "not-found" };
