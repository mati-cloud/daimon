export interface ShortcutDef {
  id: string;
  combo: string;
  description: string;
  category: string;
  source: "core" | "plugin";
  pluginName?: string;
}

const registry = new Map<string, ShortcutDef>();

export function registerShortcut(def: Omit<ShortcutDef, "source"> & { source?: ShortcutDef["source"]; pluginName?: string }) {
  registry.set(def.id, { source: "core", ...def });
}

export function getShortcuts(): (ShortcutDef & { conflict: boolean })[] {
  const all = Array.from(registry.values());
  const comboCounts = new Map<string, number>();
  for (const s of all) comboCounts.set(s.combo, (comboCounts.get(s.combo) ?? 0) + 1);
  return all.map(s => ({ ...s, conflict: (comboCounts.get(s.combo) ?? 0) > 1 }));
}

// Core shortcuts
registerShortcut({ id: "complete",        combo: "Tab",        description: "Accept completion",       category: "Composer" });
registerShortcut({ id: "history-up",      combo: "↑",          description: "Previous history entry",  category: "Composer" });
registerShortcut({ id: "history-down",    combo: "↓",          description: "Next history entry",      category: "Composer" });
registerShortcut({ id: "kbd-shortcuts",   combo: "⌘K",         description: "Keyboard shortcuts",      category: "Global" });
registerShortcut({ id: "search",          combo: "⌘F",         description: "Search blocks",           category: "Global" });
registerShortcut({ id: "new-session",     combo: "⌘T",         description: "New session",             category: "Global" });
registerShortcut({ id: "split-pane",      combo: "⌘D",         description: "Split pane",              category: "Global" });
registerShortcut({ id: "sidebar",         combo: "⌘B",         description: "Toggle sidebar",          category: "Global" });
registerShortcut({ id: "commands",        combo: "⌘P",         description: "Command palette",         category: "Global" });
registerShortcut({ id: "settings",        combo: "⌘,",         description: "Open settings",           category: "Global" });
registerShortcut({ id: "interrupt",       combo: "Ctrl+C",     description: "Interrupt running command", category: "Terminal" });
registerShortcut({ id: "eof",             combo: "Ctrl+D",     description: "Send EOF / close input",  category: "Terminal" });
registerShortcut({ id: "block-mod",       combo: "⌘⇧ (hold)", description: "Enter block mode",        category: "Block Mode" });
registerShortcut({ id: "block-copy-all",  combo: "⌘⇧ C",      description: "Copy block (cmd + output)", category: "Block Mode" });
registerShortcut({ id: "block-copy-cmd",  combo: "⌘⇧ I",      description: "Copy command",            category: "Block Mode" });
registerShortcut({ id: "block-copy-out",  combo: "⌘⇧ O",      description: "Copy output",             category: "Block Mode" });
registerShortcut({ id: "block-rerun",     combo: "⌘⇧ R",      description: "Re-run command",          category: "Block Mode" });
registerShortcut({ id: "block-expand",    combo: "⌘⇧ E",      description: "Expand / collapse block", category: "Block Mode" });
registerShortcut({ id: "block-find",      combo: "⌘⇧ F",      description: "Find in block",           category: "Block Mode" });
registerShortcut({ id: "block-pin",       combo: "⌘⇧ P",      description: "Pin / unpin block",       category: "Block Mode" });
registerShortcut({ id: "block-select",    combo: "⌘⇧ Space",  description: "Toggle block selection",  category: "Block Mode" });
registerShortcut({ id: "block-nav-up",    combo: "⌘⇧ ↑",      description: "Navigate to previous block", category: "Block Mode" });
registerShortcut({ id: "block-nav-down",  combo: "⌘⇧ ↓",      description: "Navigate to next block",  category: "Block Mode" });
