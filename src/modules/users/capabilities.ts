/**
 * Roles and capabilities, mirroring WordPress default roles
 * (wp-admin/includes/schema.php): administrator, editor, author,
 * contributor, subscriber. Capability names match WP so converted
 * extensions calling current_user_can() keep working.
 */

export type Role = "administrator" | "editor" | "author" | "contributor" | "subscriber";

export const ALL_ROLES: Role[] = ["administrator", "editor", "author", "contributor", "subscriber"];

export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  administrator: [
    "read",
    "edit_posts",
    "publish_posts",
    "edit_pages",
    "publish_pages",
    "edit_others_posts",
    "edit_others_pages",
    "delete_posts",
    "delete_pages",
    "delete_others_posts",
    "upload_files",
    "moderate_comments",
    "edit_users",
    "manage_options",
    "manage_categories",
    "install_plugins",
    "install_themes",
    "activate_plugins",
    "switch_themes",
    "edit_theme_options",
    "manage_links",
    "import",
    "unfiltered_html",
  ],
  editor: [
    "read",
    "edit_posts",
    "publish_posts",
    "edit_pages",
    "publish_pages",
    "edit_others_posts",
    "edit_others_pages",
    "delete_posts",
    "delete_pages",
    "delete_others_posts",
    "upload_files",
    "moderate_comments",
    "manage_categories",
    "manage_links",
  ],
  author: ["read", "edit_posts", "publish_posts", "delete_posts", "upload_files"],
  contributor: ["read", "edit_posts", "delete_posts"],
  subscriber: ["read"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as string[]).includes(value);
}

/** Capability check for a user-like object (only needs a `role`). */
export function userCan(user: { role: Role }, capability: string): boolean {
  return (ROLE_CAPABILITIES[user.role] ?? []).includes(capability);
}
