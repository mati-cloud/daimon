// The terminal for full-screen programs (vim, btop, less…) inside a block.
//
// Where WebGPU exists (macOS's WKWebView, the Chromium bundled with the Linux app) it is
// Wraith: libghostty-vt + a WebGPU renderer in a worker. Without WebGPU (no usable GPU
// adapter, a webview without it such as WebKitGTK) Wraith.mount() rejects ("requires WebGPU
// in a secure context"); then the same package's xterm.js-compatible Terminal takes over,
// drawn on the GPU by xterm's official WebGL renderer — or by xterm's DOM renderer if WebGL
// isn't available or its context is lost. All behind one small interface, so BlockView
// doesn't care which one it got.

import { toast } from "sonner";
import { Wraith } from "wraithterm";
import { Terminal as XtermTerminal } from "wraithterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "wraithterm/css/xterm.css";
import { magnifyScale } from "./magnify";

type Disposable = { dispose(): void };

export interface TuiTerminal {
  /** "wraith" (WebGPU), "webgl" or "dom" (xterm) — for logs. */
  readonly kind: "wraith" | "webgl" | "dom";
  readonly cols: number;
  readonly rows: number;
  write(data: string): Promise<void>;
  /** Paste text, wrapping in bracketed-paste sequences when the app requests them. */
  paste(text: string): Promise<void>;
  fit(): void;
  focus(): void;
  onData(listener: (data: string) => void): Disposable;
  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable;
  onError(listener: (err: Error) => void): Disposable;
  /** The program set the window title (OSC 0/2). */
  onTitleChange(listener: (title: string) => void): Disposable;
  onBell(listener: () => void): Disposable;
  /** The program copied text (OSC 52). */
  onClipboard(listener: (text: string) => void): Disposable;
  dispose(): Promise<void>;
}

export interface TuiOptions {
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  theme: { foreground: string; background: string; cursor: string; palette: string[] };
}

/** Marks the terminal's host element: keys typed in it belong to the program, not daimon. */
export const TUI_ATTR = "data-tui";
/** Whether a key/mouse event happened inside a full-screen program's terminal. */
export const inTerminal = (e: Event) => !!(e.target as Element | null)?.closest?.(`[${TUI_ATTR}]`);

export async function mountTui(el: HTMLElement, opts: TuiOptions): Promise<TuiTerminal> {
  el.setAttribute(TUI_ATTR, "");
  let t: TuiTerminal | null = null;
  if ("gpu" in navigator && window.isSecureContext) {
    try {
      t = await mountWraith(el, opts);
    } catch (err) {
      console.warn("[tui] WebGPU terminal unavailable, using xterm:", err);
      el.replaceChildren(); // whatever a half-started mount left behind
    }
  }
  return t ?? mountXterm(el, opts);
}

// ── Clipboard ────────────────────────────────────────────────────────────────

/** Put a program's copy (OSC 52, reported by the terminal) on the clipboard. It arrives with
 *  output, not during a click or key press, so the page may not write the clipboard itself:
 *  the native host does (app/src/bun/index.ts); a plain browser tries anyway. */
export function writeClipboard(text: string) {
  // Never silent: a program (or an ssh remote) could otherwise swap in a command for you to paste.
  const preview = text.length > 60 ? text.slice(0, 60) + "…" : text;
  toast(`Program copied ${text.length} chars`, { description: preview.replace(/\s+/g, " "), duration: 2500, id: "osc52" });
  const host = (window as { __electrobunSendToHost?: (m: unknown) => void }).__electrobunSendToHost;
  if (host) host({ type: "clipboard", text });
  else navigator.clipboard.writeText(text).catch((err) => console.warn("[tui] clipboard write failed:", err));
}

// ── Wraith (WebGPU) ──────────────────────────────────────────────────────────

/** Wraith rasterizes OpenType (not woff2) itself and has no system-font fallback (desktop apps
 *  and native terminals get theirs from the OS), so the chain is shipped: the app's Geist
 *  Mono as TTF (SemiBold for bold), JetBrains Mono for braille and box drawing, Noto
 *  Symbols 2 / Symbols / Math for the rest TUIs draw (⏵ ⎿ ✻ ⏺ arrows, math, technical),
 *  and Noto Color Emoji — its COLRv1 table only (SVG stripped: 25 MB → 5 MB), which
 *  Wraith draws in colour. Fetched (then cached) when a full-screen program starts. */
const fontUrl = (file: string) => new URL(`/fonts/terminal/${file}`, location.href);
const TERMINAL_FONT = {
  font: fontUrl("GeistMono-Regular.ttf"),
  fontFaces: { bold: fontUrl("GeistMono-SemiBold.ttf") },
  fallbackFonts: [
    fontUrl("JetBrainsMono-Regular.ttf"),
    fontUrl("NotoSansSymbols2-Regular.ttf"),
    fontUrl("NotoSansSymbols.ttf"),
    fontUrl("NotoSansMath-Regular.ttf"),
    fontUrl("NotoColorEmoji.ttf"),
  ],
};

async function mountWraith(el: HTMLElement, opts: TuiOptions): Promise<TuiTerminal> {
  const t = await Wraith.mount(el, {
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    scrollback: opts.scrollback,
    commandBlocks: false, // daimon draws its own blocks
    theme: opts.theme,
    ...TERMINAL_FONT,
  });
  const offMagnify = sharpenOnMagnify(t);
  return {
    kind: "wraith",
    get cols() { return t.cols; },
    get rows() { return t.rows; },
    write: (data) => t.write(data),
    paste: (text) => t.paste(text),
    fit: () => t.fit(),
    focus: () => t.focus(),
    onData: (l) => t.onData(l),
    onResize: (l) => t.onResize(l),
    onError: (l) => t.onError(l),
    onTitleChange: (l) => t.onTitleChange(l),
    onBell: (l) => t.onBell(l),
    // OSC 52 and the ⌘C fix come from our wraithterm patch (ui/patches/).
    onClipboard: (l) => t.onClipboard(l),
    dispose: () => { offMagnify(); return t.dispose(); },
  };
}

/** Wraith's resolution cap. */
const MAX_DPR = 3;
/** Wraith internals used here (the public API has no resolution or fit switch). */
type WraithInternals = {
  canvas: HTMLCanvasElement;
  configureDisplay(changes: { fit?: boolean }): Promise<void>;
};
let displayQueue: Promise<unknown> = Promise.resolve();

/**
 * Sharp under Ctrl+wheel magnify (magnify.ts). The page is scaled with a CSS transform: the
 * browser re-rasterizes HTML at the new scale, but this canvas keeps its pixels and is
 * stretched. Once the zoom settles it is re-rendered at "screen × magnification":
 *
 * - Wraith reads window.devicePixelRatio when its display is reconfigured, so that reads
 *   the magnified ratio for the duration of the call (queued: one terminal at a time).
 * - The grid stays as it is (`fit: false`): Wraith fits from getBoundingClientRect, which
 *   includes the page's transform, and cells are whole device pixels, so a refit would
 *   resize the program (SIGWINCH) just for zooming.
 * - Whole-pixel cells also make the re-rendered canvas a hair larger or smaller in CSS
 *   pixels; a small scale keeps it covering exactly the area it covered before.
 * - The canvas is drawn by a worker (OffscreenCanvas): the old frame stays up until the
 *   sharp one replaces it — no blank frame.
 * Back at 100% it returns to the real ratio and fits again.
 */
function sharpenOnMagnify(t: Wraith): () => void {
  const w = t as unknown as WraithInternals;
  if (typeof w.configureDisplay !== "function" || !(w.canvas instanceof HTMLCanvasElement)) return () => {};
  const cssSize = () => ({ width: parseFloat(w.canvas.style.width) || 0, height: parseFloat(w.canvas.style.height) || 0 });
  let base: { width: number; height: number } | null = null; // the canvas's CSS size at 100%

  const apply = (scale: number) => {
    const run = async () => {
      const zoomed = scale !== 1;
      if (zoomed && !base) base = cssSize();
      const own = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      if (zoomed && own?.get) {
        const dpr = Math.min(MAX_DPR, ((own.get.call(window) as number) || 1) * scale);
        Object.defineProperty(window, "devicePixelRatio", { configurable: true, enumerable: true, get: () => dpr });
      }
      try {
        await w.configureDisplay({ fit: !zoomed });
      } finally {
        if (zoomed && own) Object.defineProperty(window, "devicePixelRatio", own);
      }
      const now = cssSize();
      if (zoomed && base && now.width && now.height) {
        w.canvas.style.transformOrigin = "0 0";
        w.canvas.style.transform = `scale(${base.width / now.width}, ${base.height / now.height})`;
      } else {
        w.canvas.style.transform = w.canvas.style.transformOrigin = "";
        base = null;
      }
    };
    displayQueue = displayQueue.then(run, run).catch((err) => console.warn("[tui] re-render for zoom failed:", err));
  };

  const onMagnify = (e: Event) => apply((e as CustomEvent<{ scale: number }>).detail?.scale ?? 1);
  window.addEventListener("daimon:magnify", onMagnify);
  if (magnifyScale() !== 1) apply(magnifyScale()); // mounted while the page is magnified
  return () => window.removeEventListener("daimon:magnify", onMagnify);
}

// ── xterm (WebGL, else DOM) ──────────────────────────────────────────────────

const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

function mountXterm(el: HTMLElement, opts: TuiOptions): TuiTerminal {
  const ansi = Object.fromEntries(
    ANSI_NAMES.flatMap((name, i) => (opts.theme.palette[i] ? [[name, opts.theme.palette[i]]] : [])),
  ) as Partial<Record<(typeof ANSI_NAMES)[number], string>>;
  const term = new XtermTerminal({
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    scrollback: opts.scrollback,
    // The app's Geist Mono (a web font, already loaded for the UI); the WebGL renderer
    // rasterizes it with the browser, so woff2 is fine here.
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
    cursorBlink: true,
    allowProposedApi: true,
    theme: {
      foreground: opts.theme.foreground,
      background: opts.theme.background,
      cursor: opts.theme.cursor,
      ...ansi,
    },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);

  // GPU rendering through WebGL; xterm's DOM renderer takes over if it can't start or its
  // context is lost (GPU reset, too many contexts).
  let kind: "webgl" | "dom" = "dom";
  let webgl: WebglAddon | null = null;
  const loadWebgl = () => {
    webgl?.dispose();
    webgl = null;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        console.warn("[tui] WebGL context lost — using the DOM renderer");
        addon.dispose();
        if (webgl === addon) { webgl = null; kind = "dom"; }
      });
      term.loadAddon(addon);
      webgl = addon;
      kind = "webgl";
    } catch (err) {
      console.warn("[tui] WebGL renderer unavailable — using the DOM renderer:", err);
      kind = "dom";
    }
  };
  loadWebgl();

  // Wraith fits itself to its host; do the same here.
  const fit = () => {
    if (el.clientWidth === 0 || el.clientHeight === 0) return; // hidden: keep the last size
    try { fitAddon.fit(); } catch { /* not laid out yet */ }
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  fit();

  // Track kitty keyboard protocol stack. Apps push/pop with CSI = / CSI < and enable/disable
  // with CSI > / CSI <. When active, Shift+Enter must be encoded as \x1b[13;2u — xterm doesn't
  // implement this protocol so we intercept and emit it ourselves.
  let kittyDepth = 0;
  const KITTY_PUSH_RE  = /\x1b\[=\d*u/g;  // CSI = Pu  (push)
  const KITTY_POP_RE   = /\x1b\[<\d*u/g;  // CSI < Pu  (pop / disable-with-flags)
  const KITTY_SET_RE   = /\x1b\[>\d*u/g;  // CSI > Pu  (set/enable — depth 0→1)

  const dataListeners = new Set<(data: string) => void>();

  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (kittyDepth <= 0) return true;
    if (e.type !== "keydown") return true;
    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.type === "keydown") dataListeners.forEach((l) => l("\x1b[13;2u"));
      return false; // suppress xterm's default \r
    }
    return true;
  });

  let disposed = false;
  return {
    get kind() { return kind; },
    get cols() { return term.cols; },
    get rows() { return term.rows; },
    write: (data) => new Promise<void>((resolve, reject) => {
      if (disposed) return reject(new Error("terminal disposed"));
      // Track kitty keyboard protocol depth so Shift+Enter can be re-encoded.
      const pushes = (data.match(KITTY_PUSH_RE) ?? []).length;
      const pops   = (data.match(KITTY_POP_RE)  ?? []).length;
      const sets   = (data.match(KITTY_SET_RE)   ?? []).length;
      if (sets  > 0 && kittyDepth === 0) kittyDepth = 1;
      kittyDepth = Math.max(0, kittyDepth + pushes - pops);
      term.write(data, resolve);
    }),
    paste: (text) => { term.paste(text); return Promise.resolve(); },
    fit,
    focus: () => term.focus(),
    onData: (l) => {
      dataListeners.add(l);
      const sub = term.onData(l);
      return { dispose: () => { dataListeners.delete(l); sub.dispose(); } };
    },
    onResize: (l) => term.onResize(l),
    onError: () => ({ dispose() {} }), // nothing asynchronous to report
    onTitleChange: (l) => term.onTitleChange(l),
    onBell: (l) => term.onBell(l),
    // xterm's parser hands OSC 52 to a registered handler ("<targets>;<base64>").
    onClipboard: (l) => term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(";") + 1);
      if (b64 && b64 !== "?") {
        try { l(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))); } catch { /* not base64 */ }
      }
      return true;
    }),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      kittyDepth = 0;
      dataListeners.clear();
      ro.disconnect();
      webgl?.dispose();
      term.dispose();
    },
  };
}
