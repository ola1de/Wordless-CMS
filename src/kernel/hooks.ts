/**
 * Typed hook/filter system — clean-room re-implementation of the semantics
 * of WordPress wp-includes/plugin.php (1,032 lines) + class-wp-hook.php,
 * minus PHP's string-callable quirks: callbacks are functions, never strings.
 *
 * Rules (mirroring WordPress):
 * - Callbacks run in ascending priority order; default priority is 10.
 * - Callbacks at the same priority run in registration (stable) order.
 * - `acceptedArgs` caps how many arguments a callback receives (0 = all).
 * - Actions are fire-and-forget; filters chain a value through callbacks.
 * - Sync only in v1; async hooks arrive with Queues (Phase 6).
 */
export type HookCallback = (...args: unknown[]) => unknown;

interface HookEntry {
  callback: HookCallback;
  priority: number;
  order: number;
  acceptedArgs: number;
}

function sortEntries(entries: HookEntry[]): HookEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority || a.order - b.order);
}

export class HookRegistry {
  private actions = new Map<string, HookEntry[]>();
  private filters = new Map<string, HookEntry[]>();
  private didCounts = new Map<string, number>();
  private stack: { tag: string; kind: "action" | "filter" }[] = [];
  private seq = 0;

  addAction(tag: string, callback: HookCallback, priority = 10, acceptedArgs = 0): void {
    this.add(this.actions, tag, callback, priority, acceptedArgs);
  }

  addFilter(tag: string, callback: HookCallback, priority = 10, acceptedArgs = 0): void {
    this.add(this.filters, tag, callback, priority, acceptedArgs);
  }

  removeAction(tag: string, callback: HookCallback, priority?: number): boolean {
    return this.remove(this.actions, tag, callback, priority);
  }

  removeFilter(tag: string, callback: HookCallback, priority?: number): boolean {
    return this.remove(this.filters, tag, callback, priority);
  }

  hasAction(tag: string, callback?: HookCallback): boolean {
    return this.has(this.actions, tag, callback);
  }

  hasFilter(tag: string, callback?: HookCallback): boolean {
    return this.has(this.filters, tag, callback);
  }

  /** How many times an action (or filter) has run. */
  didAction(tag: string): number {
    return this.didCounts.get(tag) ?? 0;
  }

  didFilter(tag: string): number {
    return this.didCounts.get(tag) ?? 0;
  }

  /** Tag of the action currently executing, or null. */
  currentAction(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i];
      if (entry === undefined) return null;
      if (entry.kind === "action") return entry.tag;
    }
    return null;
  }

  /** Tag of the filter currently executing, or null. */
  currentFilter(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i];
      if (entry === undefined) return null;
      if (entry.kind === "filter") return entry.tag;
    }
    return null;
  }

  doAction(tag: string, ...args: unknown[]): void {
    this.didCounts.set(tag, (this.didCounts.get(tag) ?? 0) + 1);
    this.stack.push({ tag, kind: "action" });
    try {
      for (const entry of sortEntries(this.actions.get(tag) ?? [])) {
        const sliced = entry.acceptedArgs > 0 ? args.slice(0, entry.acceptedArgs) : args;
        entry.callback(...sliced);
      }
    } finally {
      this.stack.pop();
    }
  }

  applyFilters(tag: string, value: unknown, ...args: unknown[]): unknown {
    this.didCounts.set(tag, (this.didCounts.get(tag) ?? 0) + 1);
    this.stack.push({ tag, kind: "filter" });
    try {
      let current = value;
      for (const entry of sortEntries(this.filters.get(tag) ?? [])) {
        const all = [current, ...args];
        const sliced = entry.acceptedArgs > 0 ? all.slice(0, entry.acceptedArgs) : all;
        current = entry.callback(...sliced);
      }
      return current;
    } finally {
      this.stack.pop();
    }
  }

  private add(
    map: Map<string, HookEntry[]>,
    tag: string,
    callback: HookCallback,
    priority: number,
    acceptedArgs: number,
  ): void {
    const list = map.get(tag) ?? [];
    list.push({ callback, priority, order: this.seq++, acceptedArgs });
    map.set(tag, list);
  }

  private remove(
    map: Map<string, HookEntry[]>,
    tag: string,
    callback: HookCallback,
    priority?: number,
  ): boolean {
    const list = map.get(tag);
    if (!list) return false;
    const before = list.length;
    const kept = list.filter(
      (e) => !(e.callback === callback && (priority === undefined || e.priority === priority)),
    );
    if (kept.length === before) return false;
    if (kept.length === 0) map.delete(tag);
    else map.set(tag, kept);
    return true;
  }

  private has(map: Map<string, HookEntry[]>, tag: string, callback?: HookCallback): boolean {
    const list = map.get(tag);
    if (!list || list.length === 0) return false;
    if (callback === undefined) return true;
    return list.some((e) => e.callback === callback);
  }
}

/** Process-wide registry used by the compat layer and extensions. */
export const hooks = new HookRegistry();

export const addAction = (tag: string, cb: HookCallback, priority = 10, acceptedArgs = 0): void =>
  hooks.addAction(tag, cb, priority, acceptedArgs);
export const addFilter = (tag: string, cb: HookCallback, priority = 10, acceptedArgs = 0): void =>
  hooks.addFilter(tag, cb, priority, acceptedArgs);
export const removeAction = (tag: string, cb: HookCallback, priority?: number): boolean =>
  hooks.removeAction(tag, cb, priority);
export const removeFilter = (tag: string, cb: HookCallback, priority?: number): boolean =>
  hooks.removeFilter(tag, cb, priority);
export const hasAction = (tag: string, cb?: HookCallback): boolean => hooks.hasAction(tag, cb);
export const hasFilter = (tag: string, cb?: HookCallback): boolean => hooks.hasFilter(tag, cb);
export const doAction = (tag: string, ...args: unknown[]): void => hooks.doAction(tag, ...args);
export const applyFilters = (tag: string, value: unknown, ...args: unknown[]): unknown =>
  hooks.applyFilters(tag, value, ...args);
export const didAction = (tag: string): number => hooks.didAction(tag);
export const currentAction = (): string | null => hooks.currentAction();
export const currentFilter = (): string | null => hooks.currentFilter();
