export type MenuItemType = "custom" | "post" | "page" | "term";

export interface Menu {
  /** Term taxonomy id of the nav_menu term. */
  id: number;
  name: string;
  slug: string;
}

export interface MenuItem {
  id: number;
  /** Term taxonomy id of the menu this item belongs to. */
  menuId: number;
  title: string;
  url: string;
  type: MenuItemType;
  /** Linked object id (post/page id or term taxonomy id) for non-custom items. */
  objectId: number;
  objectType: string;
  parentId: number;
  order: number;
  children?: MenuItem[];
}

export interface CreateMenuItemInput {
  title: string;
  type: MenuItemType;
  /** Required for `custom` items; ignored for post/page/term items (URL is resolved). */
  url?: string;
  objectId?: number;
  parentId?: number;
  /** 0-based position; omitted = append at the end. */
  position?: number;
}

export interface UpdateMenuItemInput {
  title?: string;
  url?: string;
  parentId?: number;
  position?: number;
}
