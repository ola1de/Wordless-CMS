/**
 * Menus service.
 *
 * A menu is a term in the `nav_menu` taxonomy (same tables as categories);
 * a menu item is a wp_posts row of type `nav_menu_item`, linked to its
 * menu via wp_term_relationships. Item fields live in wp_postmeta, the
 * WordPress way (_menu_item_type, _menu_item_url, _menu_item_object_id,
 * _menu_item_object). Sub-items use post_parent; ordering uses menu_order.
 * Menu locations (e.g. `primary`, `footer`) are stored in the option
 * `nav_menu_locations` as a JSON map location → menu term taxonomy id.
 */
import { getOption, setOption } from "../options/service";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { postUrl, termUrl } from "../permalinks/service";
import { findPostById } from "../posts/repo";
import { deleteTerm } from "../terms/service";
import { findTermByTaxonomyId } from "../terms/repo";
import { createTerm, listTerms } from "../terms/service";
import {
  deleteMenuItemRow,
  deleteMenuItems,
  findMenuItemRow,
  findMenuItemRows,
  insertMenuItemRow,
  linkItemToMenu,
  maxMenuOrder,
  setPostMeta,
  updateMenuItemRow,
  type MenuItemRow,
} from "./repo";
import type { CreateMenuItemInput, Menu, MenuItem, MenuItemType, UpdateMenuItemInput } from "./types";

export const NAV_MENU_TAXONOMY = "nav_menu";
export const MENU_LOCATIONS_OPTION = "nav_menu_locations";

function rowToMenuItem(row: MenuItemRow, menuId: number, resolvedUrl: string): MenuItem {
  const type = (row.meta["_menu_item_type"] ?? "custom") as MenuItemType;
  return {
    id: row.id,
    menuId,
    title: row.title,
    url: resolvedUrl,
    type: type === "post" || type === "page" || type === "term" ? type : "custom",
    objectId: Number(row.meta["_menu_item_object_id"] ?? 0),
    objectType: row.meta["_menu_item_object"] ?? "",
    parentId: row.parentId,
    order: row.order,
  };
}

async function resolveItemUrl(db: Db, row: MenuItemRow): Promise<string> {
  const type = row.meta["_menu_item_type"] ?? "custom";
  if (type === "custom") return row.meta["_menu_item_url"] ?? "#";
  const objectId = Number(row.meta["_menu_item_object_id"] ?? 0);
  if (objectId === 0) return "#";
  if (type === "post" || type === "page") {
    const post = await findPostById(db, objectId);
    if (!post) return "#";
    return postUrl(db, post);
  }
  if (type === "term") {
    const term = await findTermByTaxonomyId(db, objectId);
    if (!term) return "#";
    return termUrl(term.taxonomy, term.slug);
  }
  return row.meta["_menu_item_url"] ?? "#";
}

function nestItems(items: MenuItem[]): MenuItem[] {
  const byId = new Map<number, MenuItem>();
  const roots: MenuItem[] = [];
  for (const item of items) byId.set(item.id, { ...item, children: [] });
  for (const item of items) {
    const node = byId.get(item.id);
    if (!node) continue;
    if (item.parentId !== 0) {
      const parent = byId.get(item.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  return roots;
}

export async function createMenu(db: Db, name: string): Promise<Menu> {
  const term = await createTerm(db, { name, taxonomy: NAV_MENU_TAXONOMY });
  return { id: term.termTaxonomyId, name: term.name, slug: term.slug };
}

export async function listMenus(db: Db): Promise<Menu[]> {
  const { terms } = await listTerms(db, NAV_MENU_TAXONOMY, { perPage: 100 });
  return terms.map((t) => ({ id: t.termTaxonomyId, name: t.name, slug: t.slug }));
}

export async function getMenu(db: Db, menuId: number): Promise<Menu> {
  const term = await findTermByTaxonomyId(db, menuId);
  if (!term || term.taxonomy !== NAV_MENU_TAXONOMY) throw notFound(`Menu ${menuId} not found.`);
  return { id: term.termTaxonomyId, name: term.name, slug: term.slug };
}

export async function deleteMenu(db: Db, menuId: number): Promise<boolean> {
  await getMenu(db, menuId);
  await deleteMenuItems(db, menuId);
  // Remove the menu from any location pointing at it.
  const locations = await getMenuLocations(db);
  let changed = false;
  for (const [location, id] of Object.entries(locations)) {
    if (id === menuId) {
      delete locations[location];
      changed = true;
    }
  }
  if (changed) await setOption(db, MENU_LOCATIONS_OPTION, locations);
  await deleteTerm(db, menuId);
  return true;
}

export async function addMenuItem(db: Db, menuId: number, input: CreateMenuItemInput): Promise<MenuItem> {
  await getMenu(db, menuId);
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) {
    throw badRequest('Field "title" is required and must be at most 200 characters.');
  }
  if (input.type !== "custom" && input.type !== "post" && input.type !== "page" && input.type !== "term") {
    throw badRequest('Field "type" must be one of custom, post, page, term.');
  }
  let url = "";
  let objectId = 0;
  let objectType = "";
  if (input.type === "custom") {
    url = (input.url ?? "").trim();
    if (url.length === 0) throw badRequest('Field "url" is required for custom menu items.');
  } else {
    objectId = input.objectId ?? 0;
    if (objectId === 0) throw badRequest(`Field "objectId" is required for ${input.type} menu items.`);
    if (input.type === "post" || input.type === "page") {
      const post = await findPostById(db, objectId);
      if (!post) throw notFound(`Post ${objectId} not found.`);
      if (input.type === "page" && post.type !== "page") throw badRequest(`Post ${objectId} is not a page.`);
      if (input.type === "post" && post.type !== "post") throw badRequest(`Post ${objectId} is not a post.`);
      objectType = post.type;
    } else {
      const term = await findTermByTaxonomyId(db, objectId);
      if (!term) throw notFound(`Term ${objectId} not found.`);
      objectType = term.taxonomy;
    }
  }
  const parentId = input.parentId ?? 0;
  if (parentId !== 0) {
    const parent = await findMenuItemRow(db, parentId);
    if (!parent) throw notFound(`Parent menu item ${parentId} not found.`);
  }
  const order = input.position ?? (await maxMenuOrder(db, menuId)) + 1;
  const id = await insertMenuItemRow(db, { title, parentId, order });
  await setPostMeta(db, id, "_menu_item_type", input.type);
  await setPostMeta(db, id, "_menu_item_object", objectType);
  await setPostMeta(db, id, "_menu_item_object_id", String(objectId));
  await setPostMeta(db, id, "_menu_item_url", url);
  await linkItemToMenu(db, id, menuId);
  const row = await findMenuItemRow(db, id);
  if (!row) throw new Error("Failed to read back the created menu item.");
  return rowToMenuItem(row, menuId, await resolveItemUrl(db, row));
}

export async function listMenuItems(db: Db, menuId: number): Promise<MenuItem[]> {
  await getMenu(db, menuId);
  const rows = await findMenuItemRows(db, menuId);
  const items: MenuItem[] = [];
  for (const row of rows) {
    items.push(rowToMenuItem(row, menuId, await resolveItemUrl(db, row)));
  }
  return nestItems(items);
}

export async function updateMenuItem(db: Db, menuId: number, itemId: number, patch: UpdateMenuItemInput): Promise<MenuItem> {
  await getMenu(db, menuId);
  const row = await findMenuItemRow(db, itemId);
  if (!row) throw notFound(`Menu item ${itemId} not found.`);
  if (patch.parentId !== undefined && patch.parentId !== 0) {
    if (patch.parentId === itemId) throw badRequest("A menu item cannot be its own parent.");
    const parent = await findMenuItemRow(db, patch.parentId);
    if (!parent) throw notFound(`Parent menu item ${patch.parentId} not found.`);
  }
  const next: { title?: string; parentId?: number; order?: number } = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0 || title.length > 200) throw badRequest('Field "title" must be 1–200 characters.');
    next.title = title;
  }
  if (patch.parentId !== undefined) next.parentId = patch.parentId;
  if (patch.position !== undefined) next.order = patch.position;
  await updateMenuItemRow(db, itemId, next);
  if (patch.url !== undefined) await setPostMeta(db, itemId, "_menu_item_url", patch.url.trim());
  const updated = await findMenuItemRow(db, itemId);
  if (!updated) throw new Error("Failed to read back the updated menu item.");
  return rowToMenuItem(updated, menuId, await resolveItemUrl(db, updated));
}

export async function removeMenuItem(db: Db, menuId: number, itemId: number): Promise<boolean> {
  await getMenu(db, menuId);
  const row = await findMenuItemRow(db, itemId);
  if (!row) throw notFound(`Menu item ${itemId} not found.`);
  return (await deleteMenuItemRow(db, itemId)) > 0;
}

export async function getMenuLocations(db: Db): Promise<Record<string, number>> {
  return getOption<Record<string, number>>(db, MENU_LOCATIONS_OPTION, {});
}

export async function setMenuLocation(db: Db, location: string, menuId: number | null): Promise<Record<string, number>> {
  const loc = location.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(loc)) throw badRequest('Field "location" must be a lowercase key (letters, digits, hyphen, underscore).');
  if (menuId !== null) await getMenu(db, menuId);
  const locations = await getMenuLocations(db);
  if (menuId === null) delete locations[loc];
  else locations[loc] = menuId;
  await setOption(db, MENU_LOCATIONS_OPTION, locations);
  return locations;
}

/** Resolve the menu assigned to a location, with its items (empty when unassigned). */
export async function resolveMenuByLocation(db: Db, location: string): Promise<{ location: string; menu: Menu | null; items: MenuItem[] }> {
  const locations = await getMenuLocations(db);
  const menuId = locations[location.trim().toLowerCase()];
  if (menuId === undefined) return { location, menu: null, items: [] };
  const menu = await getMenu(db, menuId);
  return { location, menu, items: await listMenuItems(db, menuId) };
}
