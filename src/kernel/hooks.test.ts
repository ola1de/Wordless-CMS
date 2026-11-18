import { describe, expect, it } from "vitest";
import { HookRegistry } from "./hooks";

describe("hooks", () => {
  it("runs actions in ascending priority order", () => {
    const h = new HookRegistry();
    const order: string[] = [];
    h.addAction("init", () => order.push("p30"), 30);
    h.addAction("init", () => order.push("p10"), 10);
    h.addAction("init", () => order.push("p20"), 20);
    h.doAction("init");
    expect(order).toEqual(["p10", "p20", "p30"]);
  });

  it("runs same-priority callbacks in registration (stable) order", () => {
    const h = new HookRegistry();
    const order: string[] = [];
    h.addAction("init", () => order.push("first"));
    h.addAction("init", () => order.push("second"));
    h.addAction("init", () => order.push("third"));
    h.doAction("init");
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("chains filter values through callbacks in priority order", () => {
    const h = new HookRegistry();
    h.addFilter("title", (v) => `${String(v)}!`, 20);
    h.addFilter("title", (v) => `Hello ${String(v)}`, 10);
    expect(h.applyFilters("title", "World")).toBe("Hello World!");
  });

  it("returns the value unchanged when no filters are registered", () => {
    const h = new HookRegistry();
    expect(h.applyFilters("missing", 42)).toBe(42);
  });

  it("removes callbacks by identity, optionally scoped to a priority", () => {
    const h = new HookRegistry();
    const cb = () => undefined;
    h.addAction("init", cb, 10);
    h.addAction("init", cb, 20);
    expect(h.removeAction("init", cb, 10)).toBe(true);
    expect(h.hasAction("init", cb)).toBe(true); // the priority-20 one remains
    expect(h.removeAction("init", cb)).toBe(true);
    expect(h.hasAction("init")).toBe(false);
    expect(h.removeAction("init", cb)).toBe(false);
  });

  it("removes filters and stops them running", () => {
    const h = new HookRegistry();
    const cb = (v: unknown) => `${String(v)}-x`;
    h.addFilter("slug", cb);
    expect(h.applyFilters("slug", "a")).toBe("a-x");
    expect(h.removeFilter("slug", cb)).toBe(true);
    expect(h.applyFilters("slug", "a")).toBe("a");
  });

  it("tracks didAction counts and current action/filter", () => {
    const h = new HookRegistry();
    expect(h.didAction("init")).toBe(0);
    let seenInside = "";
    h.addAction("init", () => {
      seenInside = h.currentAction() ?? "";
    });
    h.doAction("init");
    h.doAction("init");
    expect(h.didAction("init")).toBe(2);
    expect(seenInside).toBe("init");
    expect(h.currentAction()).toBeNull();
  });

  it("respects acceptedArgs by capping the arguments a callback receives", () => {
    const h = new HookRegistry();
    const received: unknown[][] = [];
    h.addAction("save", (...args) => received.push(args), 10, 1);
    h.addAction("save", (...args) => received.push(args), 20, 0);
    h.doAction("save", "a", "b", "c");
    expect(received).toEqual([["a"], ["a", "b", "c"]]);
  });
});
