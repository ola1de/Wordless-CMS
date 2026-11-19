import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { createPost } from "../posts/service";
import { createTerm } from "../terms/service";
import {
  addMenuItem,
  createMenu,
  deleteMenu,
  getMenuLocations,
  listMenuItems,
  listMenus,
  removeMenuItem,
  resolveMenuByLocation,
  setMenuLocation,
  updateMenuItem,
} from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("menus", () => {
  it("creates menus and custom items in order", async () => {
    const menu = await createMenu(tdb.db, "Main");
    expect(menu.name).toBe("Main");
    const home = await addMenuItem(tdb.db, menu.id, { title: "Home", type: "custom", url: "/" });
    const about = await addMenuItem(tdb.db, menu.id, { title: "About", type: "custom", url: "/about" });
    const items = await listMenuItems(tdb.db, menu.id);
    expect(items.map((i) => i.title)).toEqual(["Home", "About"]);
    expect(items[0]?.url).toBe("/");
    expect(items[0]?.order).toBeLessThan(items[1]?.order ?? 0);
    expect(home.type).toBe("custom");
    expect(about.id).not.toBe(home.id);
    expect((await listMenus(tdb.db)).map((m) => m.name)).toEqual(["Main"]);
  });

  it("links post and page items and resolves their URLs", async () => {
    const post = await createPost(tdb.db, { title: "Hello World", authorId: 1, status: "publish" });
    const page = await createPost(tdb.db, { title: "About Us", authorId: 1, status: "publish", type: "page" });
    const menu = await createMenu(tdb.db, "Main");
    const item = await addMenuItem(tdb.db, menu.id, { title: "Hello", type: "post", objectId: post.id });
    expect(item.url).toBe("/hello-world");
    const pageItem = await addMenuItem(tdb.db, menu.id, { title: "About", type: "page", objectId: page.id });
    expect(pageItem.url).toBe("/about-us");
    await expect(
      addMenuItem(tdb.db, menu.id, { title: "Wrong", type: "page", objectId: post.id }),
    ).rejects.toThrow();
    await expect(
      addMenuItem(tdb.db, menu.id, { title: "Missing", type: "post", objectId: 99999 }),
    ).rejects.toThrow();
  });

  it("links term items and nests sub-items", async () => {
    const cat = await createTerm(tdb.db, { name: "News", taxonomy: "category" });
    const menu = await createMenu(tdb.db, "Main");
    const parent = await addMenuItem(tdb.db, menu.id, { title: "Sections", type: "custom", url: "#" });
    const child = await addMenuItem(tdb.db, menu.id, {
      title: "News",
      type: "term",
      objectId: cat.termTaxonomyId,
      parentId: parent.id,
    });
    expect(child.url).toBe("/category/news");
    const items = await listMenuItems(tdb.db, menu.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.[0]?.title).toBe("News");
    await expect(updateMenuItem(tdb.db, menu.id, parent.id, { parentId: parent.id })).rejects.toThrow();
  });

  it("assigns locations and resolves them (empty when unassigned)", async () => {
    expect((await resolveMenuByLocation(tdb.db, "primary")).menu).toBeNull();
    const menu = await createMenu(tdb.db, "Main");
    await addMenuItem(tdb.db, menu.id, { title: "Home", type: "custom", url: "/" });
    await setMenuLocation(tdb.db, "primary", menu.id);
    expect(await getMenuLocations(tdb.db)).toEqual({ primary: menu.id });
    const resolved = await resolveMenuByLocation(tdb.db, "primary");
    expect(resolved.menu?.name).toBe("Main");
    expect(resolved.items).toHaveLength(1);
    await setMenuLocation(tdb.db, "primary", null);
    expect((await resolveMenuByLocation(tdb.db, "primary")).menu).toBeNull();
  });

  it("deletes a menu and its items", async () => {
    const menu = await createMenu(tdb.db, "Main");
    await addMenuItem(tdb.db, menu.id, { title: "Home", type: "custom", url: "/" });
    await setMenuLocation(tdb.db, "primary", menu.id);
    await deleteMenu(tdb.db, menu.id);
    expect(await listMenus(tdb.db)).toHaveLength(0);
    expect(await getMenuLocations(tdb.db)).toEqual({});
    await expect(listMenuItems(tdb.db, menu.id)).rejects.toThrow();
  });

  it("removes a single item and reparents its children to top level", async () => {
    const menu = await createMenu(tdb.db, "Main");
    const parent = await addMenuItem(tdb.db, menu.id, { title: "P", type: "custom", url: "#" });
    await addMenuItem(tdb.db, menu.id, { title: "C", type: "custom", url: "#", parentId: parent.id });
    await removeMenuItem(tdb.db, menu.id, parent.id);
    const items = await listMenuItems(tdb.db, menu.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("C");
  });
});
