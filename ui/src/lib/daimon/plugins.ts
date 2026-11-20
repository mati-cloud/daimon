/// Runtime plugins: files in ~/.config/daimon/plugins/ (.js .mjs .jsx .ts .tsx), read by the
/// daemon and imported here. No build step, and the daemon watches the folder, so saving a
/// file swaps the plugin in live.
///
///   // ~/.config/daimon/plugins/hello.tsx
///   import { useState } from "react";
///   import { registerHeaderButton, exec } from "daimon";
///
///   registerHeaderButton("hello", () => {
///     const [n, setN] = useState(0);
///     return <button className="rounded px-2 text-xs hover:bg-accent" onClick={() => setN(n + 1)}>hi {n}</button>;
///   });
///
/// - `react`, `react/jsx-runtime` and `daimon` are the only importable modules; they map to
///   the app's own React and `pluginApi`.
/// - TS/JSX is stripped in the browser (sucrase), Tailwind classes are compiled against the
///   app's theme (tailwindcss). Both are lazy chunks, fetched only when a plugin needs them.
/// - A plugin may also `export default function (daimon) { … }`; if it returns a function,
///   that's called before the plugin is reloaded or removed (clear intervals there).
/// - Everything a plugin registers is dropped and registered again on each reload.

import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import htm from "htm";
import { toast } from "sonner";
import { shell, openInBrowser, type ShellContext, type PluginEntry } from "./rpc";
import { inTerminal } from "./tuiTerminal";
import { setKeyLock } from "./keyLock";
import { Keys, Kbd } from "@/components/daimon/Kbd";

// ── Registries ───────────────────────────────────────────────────────────────────────────

/** Things plugins register (header buttons, status items, …), keyed by id: registering an
 *  id again replaces it. While plugins (re)load, registrations collect in `staged` and
 *  replace the list in one go, so a reload doesn't flicker. */
function createRegistry<T extends { id: string }>() {
  let items: readonly T[] = [];
  let staged: T[] | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
  const set = (next: readonly T[]) => { items = next; listeners.forEach((fn) => fn()); };
  return {
    add(item: T) {
      if (staged) staged = [...staged.filter((x) => x.id !== item.id), item];
      else set([...items.filter((x) => x.id !== item.id), item]);
    },
    get: () => items,
    use: () => useSyncExternalStore(subscribe, () => items, () => items),
    subscribe,
    stage() { staged = []; },
    commit() { const next = staged ?? items; staged = null; set(next); },
  };
}

export type HeaderButton = { id: string; render: ComponentType | ReactNode };

/** What a status item shows. daimon draws it as a header badge or a powerline segment,
 *  following the user's "Context badges" / "Context powerline" settings. */
export type StatusItem = {
  /** Small icon, e.g. `<img src="data:image/svg+xml,…" />` or an inline `<svg>`. */
  icon?: ReactNode;
  label: ReactNode;
  /** Secondary text after a muted "·". */
  detail?: ReactNode;
  /** Label color in the badge style (any CSS color). */
  color?: string;
  title?: string;
  onClick?: () => void;
};
/** Called while rendering, so it may use hooks. Return null to show nothing. */
export type UseStatusItem = () => StatusItem | null;
export type RegisteredStatusItem = { id: string; use: UseStatusItem; serial: number };

type Shortcut = { id: string; combo: string; handler: (e: KeyboardEvent) => void };
type WatchedEnv = { id: string };

const headerButtons = createRegistry<HeaderButton>();
const statusItems = createRegistry<RegisteredStatusItem>();
const shortcuts = createRegistry<Shortcut>();
const watchedEnv = createRegistry<WatchedEnv>();
const registries = [headerButtons, statusItems, shortcuts, watchedEnv];
let statusSerial = 0;

/** Put a button/badge into the header's right-side slot. Registering an id again replaces it.
 *  Pass a component (preferred — it can use hooks) or a ready element. */
export function registerHeaderButton(id: string, render: ComponentType | ReactNode) {
  headerButtons.add({ id, render });
}

/** Current header buttons; re-renders when they change. */
export const useHeaderButtons = (): readonly HeaderButton[] => headerButtons.use();

/** Add a status item (context badge / powerline segment). `use` runs while rendering,
 *  so it may use hooks, e.g. `useShellContext()`. */
export function registerStatusItem(id: string, use: UseStatusItem) {
  // A new serial remounts the item, so a reloaded plugin's hooks start fresh.
  statusItems.add({ id, use, serial: ++statusSerial });
}

export const useStatusItems = (): readonly RegisteredStatusItem[] => statusItems.use();

// ── Keyboard shortcuts ───────────────────────────────────────────────────────────────────

/** `combo`: "+"-joined modifiers and a key, e.g. "mod+j", "mod+shift+k", "alt+1". `mod` is
 *  ⌘ or Ctrl (either works, like daimon's own shortcuts). Plugin shortcuts win over
 *  daimon's own. Registering an id again replaces it. */
export function registerShortcut(id: string, combo: string, handler: (e: KeyboardEvent) => void) {
  shortcuts.add({ id, combo: combo.toLowerCase(), handler });
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key || e.key.toLowerCase() !== key) return false;
  const want = new Set(parts);
  const mod = want.has("mod");
  return (mod ? e.metaKey || e.ctrlKey : e.metaKey === want.has("meta") && e.ctrlKey === want.has("ctrl"))
    && e.shiftKey === want.has("shift")
    && e.altKey === want.has("alt");
}

function onShortcutKey(e: KeyboardEvent) {
  if (inTerminal(e)) return; // the full-screen program's keys
  const hit = shortcuts.get().find((s) => matches(s.combo, e));
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  try { hit.handler(e); } catch (err) { reportError(hit.id, err); }
}

// ── Shell context ────────────────────────────────────────────────────────────────────────

let activeTab = "";
let currentContext: ShellContext = {};
const contextListeners         = new Set<(ctx: ShellContext) => void>();
const commandCompleteListeners = new Set<(ctx: ShellContext) => void>();

function refreshContext() {
  const next = shell.context(activeTab) ?? {};
  if (next === currentContext) return;
  currentContext = next;
  contextListeners.forEach((fn) => { try { fn(next); } catch (e) { console.error("[plugins]", e); } });
}

shell.onContext((tabId) => { if (tabId === activeTab) refreshContext(); });
shell.onCommandComplete((tabId, ctx) => {
  if (tabId !== activeTab) return;
  commandCompleteListeners.forEach((fn) => { try { fn(ctx); } catch (e) { console.error("[plugins]", e); } });
});

/** daimon tells plugins which tab's shell is in focus. */
export function setPluginActiveTab(tabId: string) {
  activeTab = tabId;
  refreshContext();
}

/** Calls `fn` with the focused shell's prompt context now and after every prompt (a new
 *  object each time). Returns an unsubscribe function. */
export function onShellContext(fn: (ctx: ShellContext) => void): () => void {
  contextListeners.add(fn);
  fn(currentContext);
  return () => { contextListeners.delete(fn); };
}

/** Calls `fn` after a command completes in the focused shell (prompt follows a commandStart).
 *  Unlike onShellContext, does not fire immediately on registration or on tab-switch.
 *  Returns an unsubscribe function. */
export function onCommandComplete(fn: (ctx: ShellContext) => void): () => void {
  commandCompleteListeners.add(fn);
  return () => { commandCompleteListeners.delete(fn); };
}

const subscribeContext = (fn: () => void) => {
  contextListeners.add(fn);
  return () => { contextListeners.delete(fn); };
};

/** The focused shell's prompt context: cwd, git, exit code, and `env` with the watched
 *  env vars. Re-renders after every prompt. */
export function useShellContext(): ShellContext {
  return useSyncExternalStore(subscribeContext, () => currentContext, () => currentContext);
}

/** Ask the shell to report these env vars in `context.env` (from the next prompt on).
 *  Only names you ask for leave the shell. */
export function watchEnv(names: string | string[]) {
  for (const name of Array.isArray(names) ? names : [names]) watchedEnv.add({ id: name });
}

let sentEnv: string | null = null;
function syncWatchedEnv() {
  const names = [...new Set(watchedEnv.get().map((w) => w.id))].sort();
  const key = names.join("\n");
  if (key === sentEnv) return;
  sentEnv = key;
  shell.setContextEnv(names).catch((e) => { sentEnv = null; console.warn("[plugins] watchEnv:", e); });
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────

let commandRunner: ((command: string) => void) | null = null;

/** daimon hands plugins its way to run a command in the focused tab. */
export function setPluginCommandRunner(fn: (command: string) => void) {
  commandRunner = fn;
}

/** Run a command line in the focused tab, as if typed: it shows up as a block. */
function runCommand(command: string) {
  if (!commandRunner) throw new Error("daimon isn't ready to run commands yet");
  commandRunner(command);
}

/** Move keyboard focus back to the focused tab's command input. */
function focusComposer() {
  window.dispatchEvent(new CustomEvent("focus-composer"));
}

const html = htm.bind(React.createElement);

/** The `daimon` module / default-export argument. Keep this stable — it's the public API,
 *  typed for plugin authors in crates/daimon-cli/src/plugin-types.d.ts. */
export const pluginApi = {
  /** API version; bumped on breaking changes. */
  version: 1,
  React,
  h: React.createElement,
  html,
  registerHeaderButton,
  registerStatusItem,
  registerShortcut,
  useShellContext,
  onShellContext,
  onCommandComplete,
  watchEnv,
  runCommand,
  focusComposer,
  /** Run a program (no shell) via the daemon: `{ code, stdout, stderr }`. Rejects on spawn
   *  failure or timeout (default 10 s). `env` adds variables to the daemon's environment. */
  exec: shell.exec,
  /** Persistent key/value storage (shared prefs table — namespace your keys). */
  prefGet: shell.prefGet,
  prefSet: shell.prefSet,
  /** Open an http(s) URL in the system browser. */
  openUrl: openInBrowser,
  /** daimon's own components, for a consistent look. */
  components: { Keys, Kbd },
  toast,
};

export type DaimonPluginApi = typeof pluginApi;

// ── Module shims: what `import … from "react" | "daimon"` resolves to ────────────────────

const GLOBAL = "__daimonPlugin";
(globalThis as Record<string, unknown>)[GLOBAL] = { React, jsxRuntime, api: pluginApi };

function shimModule(expr: string, names: string[]): string {
  const ident = /^[A-Za-z_$][\w$]*$/;
  const exported = names.filter((n) => ident.test(n) && n !== "default");
  const src = `const m = globalThis.${GLOBAL}.${expr};\nexport default m;\n` +
    (exported.length ? `export const { ${exported.join(", ")} } = m;\n` : "");
  return URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
}

let shims: Record<string, string> | null = null;
function getShims() {
  if (!shims) {
    const runtime = shimModule("jsxRuntime", Object.keys(jsxRuntime));
    shims = {
      react: shimModule("React", Object.keys(React)),
      "react/jsx-runtime": runtime,
      "react/jsx-dev-runtime": runtime,
      daimon: shimModule("api", Object.keys(pluginApi)),
    };
  }
  return shims;
}

/** Point the module specifiers we provide at their shims. Anything else is left alone and
 *  fails to resolve with the browser's own (clear enough) error. */
function rewriteImports(code: string): string {
  const map = getShims();
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(react(?:\/jsx-(?:dev-)?runtime)?|daimon)\2/g,
    (_, lead: string, q: string, spec: string) => `${lead}${q}${map[spec]}${q}`,
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────────────────

type PluginFile = { name: string; file: string; source: string };

function reportError(name: string, err: unknown) {
  console.error(`[plugin ${name}]`, err);
  toast.error(`Plugin "${name}" failed`, {
    id: `plugin-error-${name}`,
    description: err instanceof Error ? err.message : String(err),
  });
}

/** Cleanups returned by the default exports of the currently loaded plugins. */
let cleanups: { name: string; fn: () => void }[] = [];

async function importPlugin({ name, file, source }: PluginFile): Promise<void> {
  let code = source;
  if (/\.(jsx|ts|tsx)$/.test(file)) {
    const { compilePluginSource } = await import("./pluginTransform");
    code = compilePluginSource(source, file);
  }
  code = rewriteImports(code);
  // sourceURL: errors and devtools show the plugin's file name instead of a blob id.
  const blob = new Blob([`${code}\n//# sourceURL=daimon-plugin://${file}`], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    if (typeof mod.default === "function") {
      const ret = await (mod.default as (api: DaimonPluginApi) => unknown)(pluginApi);
      if (typeof ret === "function") cleanups.push({ name, fn: ret as () => void });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function applyPluginCss(plugins: PluginFile[]) {
  const el = document.getElementById("daimon-plugin-css");
  const styled = plugins.filter((p) => /\bclass(Name)?\s*=/.test(p.source));
  if (!styled.length) { el?.remove(); return; }
  const { buildPluginCss } = await import("./pluginTailwind");
  const css = await buildPluginCss(styled.map((p) => p.source));
  const style = el ?? Object.assign(document.createElement("style"), { id: "daimon-plugin-css" });
  style.textContent = css;
  if (!el) document.head.append(style);
}

// ── Blocked plugins ──────────────────────────────────────────────────────────────────────
// Plugins the daemon refused to hand over: new (e.g. dropped in by other software) or changed
// since they were approved. PluginGate shows them in a modal that can't be dismissed: the
// user approves (types the name + OS admin prompt) or quarantines each one.

let blocked: readonly PluginEntry[] = [];
const blockedListeners = new Set<() => void>();
const subscribeBlocked = (fn: () => void) => { blockedListeners.add(fn); return () => { blockedListeners.delete(fn); }; };
function setBlocked(next: PluginEntry[]) {
  const key = (l: readonly PluginEntry[]) => l.map((p) => `${p.name}:${p.sha256}`).join("|");
  if (key(next) === key(blocked)) return;
  blocked = next;
  setKeyLock(next.length > 0); // PluginGate is up: no shortcuts until it's resolved
  blockedListeners.forEach((fn) => fn());
}

export const useBlockedPlugins = (): readonly PluginEntry[] =>
  useSyncExternalStore(subscribeBlocked, () => blocked, () => blocked);

/** Approve via the daemon's OS admin prompt; resolves once the user answered it. */
export const approvePlugin = (name: string) => shell.pluginApprove(name);
export const quarantinePlugin = (name: string) => shell.pluginQuarantine(name);

async function loadAll() {
  // A daemon from before plugin approval (kept running for its sessions) sends only
  // { name, file, source } and serves every plugin: load them as it did, no gate — it has no
  // approve/quarantine to answer one with. It's replaced by the new build once idle.
  const all = (await shell.pluginList()).map((p) =>
    p.approved === undefined ? { ...p, approved: true, findings: [], official: false, sha256: "" } : p);
  const plugins = all.filter((p): p is PluginEntry & { source: string } => p.approved && typeof p.source === "string");
  setBlocked(all.filter((p) => !p.approved));

  for (const { name, fn } of cleanups) {
    try { fn(); } catch (e) { reportError(name, e); }
  }
  cleanups = [];

  // CSS first, so a new button doesn't paint unstyled for a frame.
  try { await applyPluginCss(plugins); } catch (e) { reportError("tailwind", e); }

  registries.forEach((r) => r.stage());
  try {
    for (const p of plugins) {
      try {
        await importPlugin(p);
        toast.dismiss(`plugin-error-${p.name}`);
      } catch (e) {
        reportError(p.name, e);
      }
    }
  } finally {
    registries.forEach((r) => r.commit());
    syncWatchedEnv();
  }
}

let running: Promise<void> | null = null;
let again = false;

/** (Re)load every plugin. Calls that arrive mid-load coalesce into one more pass. */
export function reloadPlugins(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      try { await loadAll(); } catch (e) { console.warn("[plugins] could not load plugins:", e); }
    } while (again);
    running = null;
  })();
  return running;
}

/** Startup: check the daemon can serve plugins, load them, then follow file changes. */
export async function loadPlugins() {
  try {
    const info = await shell.daemonInfo();
    if (info.plugins === undefined) {
      toast.warning("daimon's background daemon is outdated", {
        description: "Plugins and other new features need the current one. Quit daimon and start it again to replace it.",
        duration: 15000,
      });
      return;
    }
  } catch (e) {
    console.warn("[plugins] daemon unavailable:", e);
    return;
  }
  shell.onPluginsChanged(() => { void reloadPlugins(); });
  window.addEventListener("keydown", onShortcutKey, true);
  await reloadPlugins();
}

export { reportError as reportPluginError };
