// The terminal for full-screen programs (vim, btop, less…) inside a block.
//
// First choice is Wraith: libghostty-vt + a WebGPU renderer in a worker. WebGPU isn't
// everywhere, though — Linux's WebKitGTK (the Linux app's webview) doesn't have it, so
// there Wraith.mount() rejects ("requires WebGPU in a secure context"). Then the same
// package's xterm.js-compatible Terminal takes over with xterm's DOM renderer, behind the
// same small interface, so BlockView doesn't care which one it got.

import { Wraith } from "wraithterm";
import { Terminal as XtermTerminal } from "wraithterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "wraithterm/css/xterm.css";

type Disposable = { dispose(): void };

export interface TuiTerminal {
  /** "wraith" (WebGPU) or "xterm" (DOM fallback) — for logs. */
  readonly kind: "wraith" | "xterm";
  readonly cols: number;
  readonly rows: number;
  write(data: string): Promise<void>;
  fit(): void;
  focus(): void;
  onData(listener: (data: string) => void): Disposable;
  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable;
  onError(listener: (err: Error) => void): Disposable;
  dispose(): Promise<void>;
}

export interface TuiOptions {
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  theme: { foreground: string; background: string; cursor: string; palette: string[] };
}

export async function mountTui(el: HTMLElement, opts: TuiOptions): Promise<TuiTerminal> {
  if ("gpu" in navigator && window.isSecureContext) {
    try {
      return await mountWraith(el, opts);
    } catch (err) {
      console.warn("[tui] WebGPU terminal unavailable, using the DOM renderer:", err);
      el.replaceChildren(); // whatever a half-started mount left behind
    }
  }
  return mountXterm(el, opts);
}

async function mountWraith(el: HTMLElement, opts: TuiOptions): Promise<TuiTerminal> {
  const t = await Wraith.mount(el, {
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    scrollback: opts.scrollback,
    commandBlocks: false, // daimon draws its own blocks
    theme: opts.theme,
  });
  return {
    kind: "wraith",
    get cols() { return t.cols; },
    get rows() { return t.rows; },
    write: (data) => t.write(data),
    fit: () => t.fit(),
    focus: () => t.focus(),
    onData: (l) => t.onData(l),
    onResize: (l) => t.onResize(l),
    onError: (l) => t.onError(l),
    dispose: () => t.dispose(),
  };
}

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

  // Wraith fits itself to its host; do the same here.
  const fit = () => {
    if (el.clientWidth === 0 || el.clientHeight === 0) return; // hidden: keep the last size
    try { fitAddon.fit(); } catch { /* not laid out yet */ }
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  fit();

  let disposed = false;
  return {
    kind: "xterm",
    get cols() { return term.cols; },
    get rows() { return term.rows; },
    write: (data) => new Promise<void>((resolve, reject) => {
      if (disposed) return reject(new Error("terminal disposed"));
      term.write(data, resolve);
    }),
    fit,
    focus: () => term.focus(),
    onData: (l) => term.onData(l),
    onResize: (l) => term.onResize(l),
    onError: () => ({ dispose() {} }), // the DOM renderer has no async failures to report
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      ro.disconnect();
      term.dispose();
    },
  };
}
