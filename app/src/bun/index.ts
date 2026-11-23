import { BrowserWindow, ApplicationMenu } from "electrobun/bun";
import { openExternal } from "electrobun/bun/utils";
import { connectDaemon, request, type Daemon } from "./daemon";
import { appLog, appWarn } from "./appLog";
import { enablePinchZoom } from "./macMagnification";
import { setupNativeDrag } from "./macWindowDrag";
import { setMinSize } from "./windowMinSize";
import { describeFocus, isForeground } from "./winFocus";
import { focusLog } from "./focusLog";
import { setKeyInterceptLock, requestAccessibilityPermission, hasAccessibilityPermission } from "./keyIntercept";
import { startUpdater, type UpdateState } from "./updater";
import { homedir } from "node:os";

// ── pty-daemon ────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";
const daemon = await connectDaemon(isDev);

const nativeTransparent = process.env.DAIMON_TRANSPARENT !== "0";

const baseUrl = isDev ? "http://localhost:7881" : (daemon ? `http://localhost:${daemon.port}` : "views://daimon2/index.html");
const query = [
  daemon && `daimon_port=${daemon.port}`,
  `home=${encodeURIComponent(homedir())}`,
  nativeTransparent && "transparent=1",
  process.env.DAIMON_BENCH && `bench=${encodeURIComponent(process.env.DAIMON_BENCH)}`,
].filter(Boolean);
const frontendUrl = query.length ? `${baseUrl}?${query.join("&")}` : baseUrl;

// ── App menu ──────────────────────────────────────────────────────────────────
ApplicationMenu.setApplicationMenu([
  {
    label: "daimon",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
]);

// ── Window ────────────────────────────────────────────────────────────────────
const win = new BrowserWindow({
  title: "daimon",
  url: frontendUrl,
  frame: { width: 1280, height: 800, x: 100, y: 100 },
  transparent: nativeTransparent,
  titleBarStyle: "hiddenInset" as const,
  trafficLightOffset: { x: 16, y: 14 },
});

enablePinchZoom();
setupNativeDrag(win);
setMinSize(win);

// Request Accessibility permission on first launch (needed for CGEventTap keyboard suppression).
// Deferred so the window is visible and frontmost before the dialog appears — macOS
// suppresses the AXIsProcessTrustedWithOptions prompt when the app has no visible window.
setTimeout(() => {
  if (!hasAccessibilityPermission()) requestAccessibilityPermission();
}, 1000);

const HOST_FOCUS_JS = `window.dispatchEvent(new Event("daimon:host-focus"))`;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
function returnFocusToPage(why: string) {
  if (focusTimer) clearTimeout(focusTimer);
  focusLog("host", `return focus (${why}) ${describeFocus(win.ptr)}`);
  focusTimer = setTimeout(() => { focusTimer = null; win.webview.executeJavascript(HOST_FOCUS_JS); }, 30);
}
win.on("focus", () => returnFocusToPage("native focus"));
win.on("blur", () => focusLog("host", `native blur ${describeFocus(win.ptr)}`));

// Messages from the page: window.__electrobunSendToHost({ type, ... }).
type HostMessage = { type?: string; blur?: unknown; action?: unknown; msg?: unknown; text?: unknown; on?: unknown };
const hostMessageHandlers: ((msg: HostMessage) => void)[] = [];
(win.webview as unknown as { on(name: string, handler: (event: unknown) => void): void }).on(
  "host-message",
  (event) => {
    const msg = (event as { data?: { detail?: unknown } }).data?.detail as HostMessage | undefined;
    if (msg) for (const handle of hostMessageHandlers) handle(msg);
  },
);

// OSC 52 clipboard write from a TUI program (see ui/src/lib/daimon/tuiTerminal.ts).
hostMessageHandlers.push((msg) => {
  if (msg.type !== "clipboard" || typeof msg.text !== "string") return;
  try {
    const p = Bun.spawn(["pbcopy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    p.stdin.write(msg.text);
    p.stdin.end();
  } catch (err) {
    appWarn(`[main] clipboard write (pbcopy) failed: ${String(err)}`);
  }
});

hostMessageHandlers.push((msg) => {
  if (msg.type === "quit") win.close();
});

hostMessageHandlers.push((msg) => {
  if (msg.type === "focus-log" && typeof msg.msg === "string") focusLog("page", msg.msg);
});

// System-wide keyboard suppression during keymap capture.
hostMessageHandlers.push((msg) => {
  if (msg.type === "keymap-lock" && typeof msg.on === "boolean") setKeyInterceptLock(msg.on);
});

console.log("[main] window opened →", frontendUrl);

// Auto-update (see updater.ts).
let currentDaemon = daemon;
const updater = startUpdater(
  isDev,
  (state) => sendUpdateState(state),
  () => currentDaemon,
  (nd) => {
    // Daemon restarted from staged bundle — the new daemon serves updated UI assets.
    // Reload the page so the browser fetches them; sessions survive in the PTYs.
    currentDaemon = nd;
    appLog("[update] daemon restarted; reloading UI from new assets");
    win.webview.executeJavascript("location.reload()");
  },
);
function sendUpdateState(state: UpdateState) {
  win.webview.executeJavascript(
    `window.dispatchEvent(new CustomEvent("daimon:update", { detail: ${JSON.stringify(state)} }))`,
  );
}
hostMessageHandlers.push((msg) => {
  if (msg.type !== "update") return;
  if (msg.action === "state") sendUpdateState(updater.state());
  else if (msg.action === "apply") updater.apply();
  else if (msg.action === "apply-daemon") {
    void updater.applyDaemonOnly();
  }
  else if (msg.action === "check") {
    void updater.check().then((result) => win.webview.executeJavascript(
      `window.dispatchEvent(new CustomEvent("daimon:update-check", { detail: ${JSON.stringify(result)} }))`,
    ));
  }
});

// Proxy privileged commands from the page to the daemon via UNIX socket.
// The page sends { type: "daemon-rpc", req_id, payload } and gets back
// { type: "daemon-rpc-reply", req_id, ok, data } via executeJavascript.
hostMessageHandlers.push(async (msg) => {
  if ((msg as { type?: string }).type !== "daemon-rpc") return;
  const m = msg as { type: string; req_id: string; payload: object };
  const d = currentDaemon;
  if (!d) {
    win.webview.executeJavascript(
      `window.dispatchEvent(new CustomEvent("daimon:rpc-reply", { detail: ${JSON.stringify({ req_id: m.req_id, ok: false, data: { error: "no daemon" } })} }))`,
    );
    return;
  }
  const data = await request<unknown>(d, { ...m.payload, req_id: m.req_id });
  win.webview.executeJavascript(
    `window.dispatchEvent(new CustomEvent("daimon:rpc-reply", { detail: ${JSON.stringify({ req_id: m.req_id, ok: data !== null, data })} }))`,
  );
});

hostMessageHandlers.push((msg) => {
  if (msg.type !== "openUrl" || typeof (msg as { url?: unknown }).url !== "string") return;
  const url = (msg as { url: string }).url;
  try {
    if (url.startsWith("https://") || url.startsWith("http://")) openExternal(url);
  } catch (e) {
    console.error("[main] openUrl error:", e);
  }
});
