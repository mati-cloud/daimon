import type { GitBranchNode } from "./shell";
/// WebSocket transport shim — identical shell API surface to the Electrobun RPC version.
/// Connects to the Rust pty-daemon at ws://localhost:<port>/?token=<token>.
///
/// The daemon only accepts clients with its token. The app passes it (and the port) in
/// the page URL — ?daimon_token=…&daimon_port=… — and we keep it in sessionStorage so
/// reloads work after the URL is cleaned up. There is no other way in: a plain browser tab
/// gets no token, and the daemon also refuses any web origin but the app's own.

type Creds = { token: string; port: number };

/** A plugin file as the daemon reports it. `source` only when approved (see plugins.rs). */
export type PluginEntry = {
  name: string;
  file: string;
  sha256: string;
  findings: { id: string; what: string; privileged: boolean }[];
  approved: boolean;
  /** An unmodified copy of a plugin that ships with daimon. */
  official: boolean;
  reason?: string;
  source?: string;
};
const CREDS_KEY = "daimon-daemon";

function credsFromUrl(): Creds | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("daimon_token");
  if (!token) return null;
  const port = Number(url.searchParams.get("daimon_port")) || 7878;
  url.searchParams.delete("daimon_token");
  url.searchParams.delete("daimon_port");
  history.replaceState(history.state, "", url);
  return { token, port };
}

let creds: Creds | null = (() => {
  const fromUrl = credsFromUrl();
  if (fromUrl) { try { sessionStorage.setItem(CREDS_KEY, JSON.stringify(fromUrl)); } catch { /**/ } return fromUrl; }
  try { const saved = sessionStorage.getItem(CREDS_KEY); return saved ? JSON.parse(saved) as Creds : null; } catch { return null; }
})();

export type ShellContext = {
  pwd?: string;
  gitBranch?: string;
  gitAhead?: number;
  gitBehind?: number;
  gitDirty?: boolean;
  gitAdded?: number;
  gitRemoved?: number;
  exitCode?: number;
  /** `user@host` while the tab is in a daimonified SSH session (set by the remote payload). */
  ssh?: string;
  cmdDuration?: number;
  cmdTimestamp?: number;
  promptLen?: number;
  /** Values of the env vars plugins asked for (`watchEnv`) that are set in the shell. */
  env?: Record<string, string>;
};

type DaemonEvent =
  | { type: "output"; tab_id: string; data: string }
  | { type: "exit"; tab_id: string; code: number }
  | { type: "prompt"; tab_id: string; context: string }
  | { type: "commandStart"; tab_id: string }
  | { type: "altScreenEnter"; tab_id: string }
  | { type: "altScreenExit"; tab_id: string }
  | { type: "response"; req_id: string; ok: boolean; data: unknown }
  | { type: "pluginsChanged" };

type OutputListener        = (tabId: string, data: string) => void;
type ExitListener          = (tabId: string, code: number) => void;
type ContextListener       = (tabId: string, ctx: ShellContext) => void;
type CommandStartListener  = (tabId: string) => void;

const outputListeners            = new Set<OutputListener>();
const exitListeners              = new Set<ExitListener>();
const contextListeners           = new Set<ContextListener>();
const commandStartListeners      = new Set<CommandStartListener>();
const commandCompleteListeners   = new Set<ContextListener>();
// Tracks tabs where a commandStart fired but the follow-up prompt hasn't yet.
const pendingCommandComplete     = new Set<string>();

// Cache last context per tab so late onContext subscribers get it immediately
const lastContext = new Map<string, ShellContext>();

// Pending request/response promises keyed by req_id
let reqSeq = 0;
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function request<T>(msg: object, timeoutMs = 5000): Promise<T> {
  const req_id = `r${++reqSeq}`;
  const json = JSON.stringify({ ...msg, req_id });
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(req_id);
      reject(new Error("rpc timeout"));
    }, timeoutMs);
    pendingRequests.set(req_id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T); },
      reject:  (e) => { clearTimeout(timer); reject(e); },
    });
    if (ws?.readyState === WebSocket.OPEN) ws.send(json);
    else pending.push(json);
  });
}

// ── WebSocket (auto-reconnect) ───────────────────────────────────────────────

let ws: WebSocket | null = null;
const pending: string[] = [];
let everConnected = false;

/** Main-thread time spent on daemon messages (read by bench mode, see bench.ts). */
export const perf = { msgs: 0, parseMs: 0, outputMs: 0, paintMs: 0, promptAt: 0, finalAskAt: 0, finalGotAt: 0, resolvedAt: 0 };
const reconnectListeners = new Set<() => void>();

/** Called after the connection to the daemon came back (not on the first connect). */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => { reconnectListeners.delete(fn); };
}

async function connect() {
  if (!creds) {
    console.warn("[rpc] no daemon token — start daimon through the app (or dev.sh)");
    return;
  }
  ws = new WebSocket(`ws://localhost:${creds.port}/?token=${encodeURIComponent(creds.token)}`);
  ws.onopen = () => {
    while (pending.length) ws!.send(pending.shift()!);
    // Events sent while we were away are gone: let the UI resync its sessions.
    if (everConnected) reconnectListeners.forEach((fn) => fn());
    everConnected = true;
  };
  ws.onclose = () => {
    ws = null;
    // Reject all pending requests so callers don't hang across reconnect
    for (const [, p] of pendingRequests) p.reject(new Error("disconnected"));
    pendingRequests.clear();
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e: MessageEvent) => {
    const t0 = performance.now();
    const ev: DaemonEvent = JSON.parse(e.data as string);
    const t1 = performance.now();
    perf.parseMs += t1 - t0;
    perf.msgs++;
    if (ev.type === "output") { outputListeners.forEach((fn) => fn(ev.tab_id, ev.data)); perf.outputMs += performance.now() - t1; }
    else if (ev.type === "exit") exitListeners.forEach((fn) => fn(ev.tab_id, ev.code));
    else if (ev.type === "prompt") {
      let ctx: ShellContext = {};
      if (ev.context) {
        try { ctx = JSON.parse(ev.context); } catch { /* bare prompt */ }
      }
      perf.promptAt = performance.now();
      lastContext.set(ev.tab_id, ctx);
      contextListeners.forEach((fn) => fn(ev.tab_id, ctx));
      if (pendingCommandComplete.delete(ev.tab_id)) {
        commandCompleteListeners.forEach((fn) => fn(ev.tab_id, ctx));
      }
    } else if (ev.type === "commandStart") {
      pendingCommandComplete.add(ev.tab_id);
      commandStartListeners.forEach((fn) => fn(ev.tab_id));
    } else if (ev.type === "altScreenEnter") {
      altScreenListeners.forEach((fn) => fn(ev.tab_id, true));
    } else if (ev.type === "altScreenExit") {
      altScreenListeners.forEach((fn) => fn(ev.tab_id, false));
    } else if (ev.type === "pluginsChanged") {
      pluginsChangedListeners.forEach((fn) => fn());
    } else if (ev.type === "response") {
      const p = pendingRequests.get(ev.req_id);
      if (p) {
        pendingRequests.delete(ev.req_id);
        if (ev.ok) p.resolve(ev.data);
        else {
          const d = ev.data as { error?: unknown } | null;
          p.reject(new Error(typeof d?.error === "string" ? d.error : String(ev.data)));
        }
      }
    }
  };
}
void connect();

function send(msg: object) {
  const json = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN) ws.send(json);
  else pending.push(json);
}

// ── shell API ────────────────────────────────────────────────────────────────

type GitStatusFile = { xy: string; path: string; from?: string; add?: number; del?: number };
type GitStatus = { branch: string; upstream?: string | null; ahead: number; behind: number; staged: GitStatusFile[]; unstaged: GitStatusFile[]; untracked: string[]; added?: number; removed?: number; error?: string };
type LogEntry  = { hash: string; fullHash: string; date: string; subject: string; author: string; isHead?: boolean; unpushed?: boolean; unpushedTo?: string; refs?: { name: string; kind: "local" | "remote" | "tag"; current: boolean; trunk: boolean; synced: string[] }[] };
type CommitDetail = { files: { status: string; path: string; additions: number; deletions: number }[]; body: string };

/** A shell as the daemon has it (see `attach`). */
export type AttachInfo = {
  exists: boolean;
  running: boolean;
  command: string | null;
  startedAt: number;
  altScreen: boolean;
  /** Running command: output so far, or (full-screen programs) the modes to restore. */
  output: string;
  context: string | null;
};

type AltScreenListener = (tabId: string, enter: boolean) => void;
const altScreenListeners = new Set<AltScreenListener>();
const pluginsChangedListeners = new Set<() => void>();

export function openInBrowser(url: string) {
  (window as { __electrobunSendToHost?: (m: unknown) => void }).__electrobunSendToHost?.({ type: "openUrl", url });
}

export const shell = {
  onOutput:       (fn: OutputListener)       => { outputListeners.add(fn);        return () => outputListeners.delete(fn); },
  onExit:         (fn: ExitListener)         => { exitListeners.add(fn);          return () => exitListeners.delete(fn); },
  onContext:      (fn: ContextListener)      => { contextListeners.add(fn);            return () => contextListeners.delete(fn); },
  onCommandStart: (fn: CommandStartListener) => { commandStartListeners.add(fn);       return () => commandStartListeners.delete(fn); },
  onCommandComplete: (fn: ContextListener)   => { commandCompleteListeners.add(fn);    return () => commandCompleteListeners.delete(fn); },
  onAltScreen:    (fn: AltScreenListener)    => { altScreenListeners.add(fn);     return () => altScreenListeners.delete(fn); },
  /** A file in ~/.config/daimon/plugins/ changed (the daemon watches the folder). */
  onPluginsChanged: (fn: () => void)         => { pluginsChangedListeners.add(fn); return () => pluginsChangedListeners.delete(fn); },

  write:  (tabId: string, data: string) => { send({ type: "write", tab_id: tabId, data }); return Promise.resolve(); },
  /** Make a resumed full-screen program repaint (resize dance → SIGWINCH). */
  redraw: (tabId: string) => { send({ type: "redraw", tab_id: tabId }); return Promise.resolve(); },
  /** Write that starts a command; the daemon remembers `command` to label it on reattach. */
  writeCommand: (tabId: string, data: string, command: string) => { send({ type: "write", tab_id: tabId, data, command }); return Promise.resolve(); },
  /**
   * Reattach to a tab's shell after the UI (re)started. Also replays the last prompt
   * context to onContext listeners, as if the prompt had just been drawn.
   */
  attach: async (tabId: string): Promise<AttachInfo> => {
    const info = await request<AttachInfo>({ type: "attach", tab_id: tabId });
    if (info.exists && info.context) {
      let ctx: ShellContext = {};
      try { ctx = JSON.parse(info.context); } catch { /* bare prompt */ }
      lastContext.set(tabId, ctx);
      if (!info.running) contextListeners.forEach((fn) => fn(tabId, ctx));
    }
    return info;
  },
  resize: (tabId: string, cols: number, rows: number) => {
    const c = Math.min(Math.max(cols, 10), 500);
    const r = Math.min(Math.max(rows, 2), 300);
    send({ type: "resize", tab_id: tabId, cols: c, rows: r });
    return Promise.resolve();
  },
  ready:  (tabId: string) => { send({ type: "write", tab_id: tabId, data: "" }); return Promise.resolve(); },
  hasReady: (tabId: string) => lastContext.has(tabId),
  /** The last prompt context of a tab, if it has drawn a prompt. */
  context: (tabId: string): ShellContext | undefined => lastContext.get(tabId),
  close:  (tabId: string) => { send({ type: "close", tab_id: tabId }); return Promise.resolve(); },

  // Stubs — backend support needed for these
  complete:            () => Promise.resolve([] as { type: "plain" | "file" | "dir"; value: string }[]),
  listBinaries:        () => Promise.resolve([] as string[]),
  completePath:        () => Promise.resolve(""),
  listPathCompletions: (prefix: string, cwd: string, kind: string) =>
    request<{ value: string; isDir: boolean }[]>({ type: "listPaths", prefix, cwd, kind }),
  completeNative:      (buffer: string, cwd: string) =>
    request<{ text: string; description?: string; kind: string }[]>({ type: "complete", buffer, cwd }),
  getCompletions:      () => Promise.resolve([] as { value: string; description?: string }[]),
  getFlagType:         () => Promise.resolve("unknown" as const),
  getBuiltinPathKind:  () => Promise.resolve(null as "file" | "dir" | "path" | null),
  loadSessions:        () => Promise.resolve([] as { id: string; title: string; icon: string }[]),
  saveSessions:        () => Promise.resolve(),
  gitStatus:           (cwd: string) => request<GitStatus>({ type: "gitStatus", cwd }),
  listBranches:        (cwd: string) => request<{ branches: string[]; current: string; trunk?: string | null; nodes?: GitBranchNode[] }>({ type: "gitBranch", cwd }),
  listLog:             (cwd: string, limit?: number, args?: string[]) => request<LogEntry[] | { error: string }>({ type: "gitLog", cwd, limit: limit ?? 50, args: args ?? [] }),
  gitDiff:             (cwd: string, args?: string[]) => request<{ raw: string }>({ type: "gitDiff", cwd, args: args ?? [] }),
  getCommitDetail:     (hash: string, cwd: string) => request<CommitDetail>({ type: "commitDetail", hash, cwd }),
  getFileDiff:         (hash: string, filePath: string, cwd: string) => request<string>({ type: "fileDiff", hash, file_path: filePath, cwd }),
  getFileContent:      (blob: string, filePath: string, cwd: string) =>
    request<{ content?: string; source?: "blob" | "worktree"; error?: string }>({ type: "fileContent", blob, file_path: filePath, cwd }),
  linkPreview:         (url: string) =>
    request<{ url: string; title?: string | null; description?: string | null; image?: string | null; siteName?: string | null; icon?: string | null } | null>({ type: "linkPreview", url }, 10000),

  // ── Persistent store ────────────────────────────────────────────────────────
  historyAdd:          (cmd: string, ts: number) => request<boolean>({ type: "historyAdd", cmd, ts }),
  historyList:         (limit?: number) => request<{ id: number; cmd: string; ts: number; source: string }[]>({ type: "historyList", limit: limit ?? 1000000 }),
  historySearch:       (query: string, limit?: number) => request<{ id: number; cmd: string; ts: number; source: string }[]>({ type: "historySearch", query, limit: limit ?? 50 }),
  blockSave:           (block: { id: string; session_id: string; input: string; cwd: string; ctx: string; ts: number; exit_code: number; output_json: string }) =>
    request<boolean>({ type: "blockSave", block }),
  blockList:           (session_id: string, limit?: number) =>
    request<{ id: string; session_id: string; input: string; cwd: string; ctx: string; ts: number; exit_code: number; output_json: string }[]>({ type: "blockList", session_id, limit: limit ?? 500 }),
  blockRecent:         (limit?: number) =>
    request<{ id: string; session_id: string; input: string; cwd: string; ctx: string; ts: number; exit_code: number; output_json: string }[]>({ type: "blockRecent", limit: limit ?? 200 }),
  blockSearch:         (query: string, limit?: number) => request<{ id: string; session_id: string; input: string; cwd: string; ctx: string; ts: number; exit_code: number; output_json: string }[]>({ type: "blockSearch", query, limit: limit ?? 50 }),
  blockClear:          (session_id: string) => request<boolean>({ type: "blockClear", session_id }),
  prefSet:             (key: string, value: string) => request<boolean>({ type: "prefSet", key, value }),
  prefGet:             (key: string) => request<string | null>({ type: "prefGet", key }),
  /** `plugins`: plugin protocol version; missing on daemons that predate plugins. */
  daemonInfo:          () => request<{ build: string; sessions: number; pid: number; plugins?: number }>({ type: "daemonInfo" }, 15000),
  pluginList:          () => request<PluginEntry[]>({ type: "pluginList" }, 15000),
  /** Approve a plugin as its file is now. The daemon shows the OS admin prompt; waits for the user. */
  pluginApprove:       (name: string) => request<{ approved: boolean; error?: string; command?: string }>({ type: "pluginApprove", name }, 10 * 60_000),
  /** Rename a blocked plugin to `.<file>.quarantined` so it never loads. */
  pluginQuarantine:    (name: string) => request<{ ok: boolean; error?: string; path?: string }>({ type: "pluginQuarantine", name }),
  exec:                (cmd: string, args: string[] = [], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) => {
    const timeoutMs = opts.timeoutMs ?? 10000;
    return request<{ code: number | null; stdout: string; stderr: string }>(
      { type: "exec", cmd, args, cwd: opts.cwd, env: opts.env ?? {}, timeout_ms: timeoutMs }, timeoutMs + 2000);
  },
  setContextEnv:       (names: string[]) => request<boolean>({ type: "setContextEnv", names }),
  describeResource:    (..._args: unknown[]) => Promise.resolve(""),
  getNodeEvents:       (..._args: unknown[]) => Promise.resolve([] as { type: string; reason: string; age: string; message: string }[]),
};
