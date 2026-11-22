export interface ShortcutDef {
  id: string;
  combo: string;      // default combo
  description: string;
  category: string;
  source: "core" | "plugin";
  pluginName?: string;
}

export interface ResolvedShortcut extends ShortcutDef {
  effectiveCombo: string;
  overridden: boolean;
  conflict: boolean;
}

// ── Registry ──────────────────────────────────────────────────────────────────
const registry = new Map<string, ShortcutDef>();

export function registerShortcut(def: Omit<ShortcutDef, "source"> & { source?: ShortcutDef["source"] }) {
  registry.set(def.id, { source: "core", ...def });
}

// ── Overrides (localStorage) ──────────────────────────────────────────────────
const STORAGE_KEY = "daimon:keymap-overrides";

function loadOverrides(): Map<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Map(JSON.parse(raw) as [string, string][]);
  } catch { /* ignore */ }
  return new Map();
}

function saveOverrides(m: Map<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(m.entries())));
}

const overrides = loadOverrides();

export function setOverride(id: string, combo: string) {
  const def = registry.get(id);
  if (!def) return;
  if (combo === "" || combo === def.combo) {
    overrides.delete(id);
  } else {
    overrides.set(id, combo);
  }
  saveOverrides(overrides);
  emitChange();
}

export function getEffectiveCombo(id: string): string {
  return overrides.get(id) ?? registry.get(id)?.combo ?? "";
}

// ── Conflict detection ────────────────────────────────────────────────────────
function buildConflictSet(pendingId?: string, pendingCombo?: string): Set<string> {
  const counts = new Map<string, string[]>(); // combo -> ids
  for (const def of registry.values()) {
    const combo = pendingId === def.id && pendingCombo !== undefined
      ? pendingCombo
      : (overrides.get(def.id) ?? def.combo);
    if (!combo) continue;
    const existing = counts.get(combo) ?? [];
    existing.push(def.id);
    counts.set(combo, existing);
  }
  const conflicted = new Set<string>();
  for (const ids of counts.values()) if (ids.length > 1) for (const id of ids) conflicted.add(id);
  return conflicted;
}

export function getShortcuts(pendingId?: string, pendingCombo?: string): ResolvedShortcut[] {
  const conflictSet = buildConflictSet(pendingId, pendingCombo);
  return Array.from(registry.values()).map(def => ({
    ...def,
    effectiveCombo: pendingId === def.id && pendingCombo !== undefined
      ? pendingCombo
      : (overrides.get(def.id) ?? def.combo),
    overridden: overrides.has(def.id),
    conflict: conflictSet.has(def.id),
  }));
}

export function hasAnyConflict(): boolean {
  return buildConflictSet().size > 0;
}

// ── Change subscription ───────────────────────────────────────────────────────
const listeners = new Set<() => void>();
function emitChange() { for (const fn of listeners) fn(); }
export function subscribeKeymaps(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Core shortcuts ────────────────────────────────────────────────────────────
registerShortcut({ id: "complete",        combo: "Tab",        description: "Accept completion",          category: "Composer" });
registerShortcut({ id: "history-up",      combo: "↑",          description: "Previous history entry",    category: "Composer" });
registerShortcut({ id: "history-down",    combo: "↓",          description: "Next history entry",        category: "Composer" });
registerShortcut({ id: "kbd-shortcuts",   combo: "⌘K",         description: "Keyboard shortcuts",        category: "Global" });
registerShortcut({ id: "search",          combo: "⌘F",         description: "Search blocks",             category: "Global" });
registerShortcut({ id: "new-session",     combo: "⌘T",         description: "New session",               category: "Global" });
registerShortcut({ id: "split-pane",      combo: "⌘D",         description: "Split pane",                category: "Global" });
registerShortcut({ id: "sidebar",         combo: "⌘B",         description: "Toggle sidebar",            category: "Global" });
registerShortcut({ id: "commands",        combo: "⌘P",         description: "Command palette",           category: "Global" });
registerShortcut({ id: "settings",        combo: "⌘,",         description: "Open settings",             category: "Global" });
registerShortcut({ id: "presentation",     combo: "⌘⇧ V",      description: "Toggle presentation mode",  category: "Global" });
registerShortcut({ id: "interrupt",       combo: "Ctrl+C",     description: "Interrupt running command", category: "Terminal" });
registerShortcut({ id: "eof",             combo: "Ctrl+D",     description: "Send EOF / close input",    category: "Terminal" });
registerShortcut({ id: "block-mod",       combo: "⌘⇧ (hold)", description: "Enter block mode",          category: "Block Mode" });
registerShortcut({ id: "block-copy-all",  combo: "⌘⇧ C",      description: "Copy block (cmd + output)", category: "Block Mode" });
registerShortcut({ id: "block-copy-cmd",  combo: "⌘⇧ I",      description: "Copy command",              category: "Block Mode" });
registerShortcut({ id: "block-copy-out",  combo: "⌘⇧ O",      description: "Copy output",               category: "Block Mode" });
registerShortcut({ id: "block-rerun",     combo: "⌘⇧ R",      description: "Re-run command",            category: "Block Mode" });
registerShortcut({ id: "block-expand",    combo: "⌘⇧ E",      description: "Expand / collapse block",   category: "Block Mode" });
registerShortcut({ id: "block-find",      combo: "⌘⇧ F",      description: "Find in block",             category: "Block Mode" });
registerShortcut({ id: "block-pin",       combo: "⌘⇧ P",      description: "Pin / unpin block",         category: "Block Mode" });
registerShortcut({ id: "block-screenshot", combo: "⌘⇧ S",     description: "Screenshot block → clipboard (secrets redacted)", category: "Block Mode" });
registerShortcut({ id: "block-select",    combo: "⌘⇧ Space",  description: "Toggle block selection",    category: "Block Mode" });
registerShortcut({ id: "block-nav-up",    combo: "⌘⇧ ↑",      description: "Navigate to previous block", category: "Block Mode" });
registerShortcut({ id: "block-nav-down",  combo: "⌘⇧ ↓",      description: "Navigate to next block",    category: "Block Mode" });
