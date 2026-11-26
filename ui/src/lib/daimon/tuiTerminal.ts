// The terminal for full-screen programs (vim, btop, less…) inside a block.
//
// Always Wraith: libghostty-vt + a WebGPU renderer in a worker. WebGPU is required;
// there is no xterm fallback. If Wraith.mount() rejects, the error surfaces in the block
// (BlockView catches it) so it is visible rather than silently degrading to a black xterm.

import { toast } from "sonner";
import { Wraith } from "wraithterm";
import { magnifyScale } from "./magnify";

type Disposable = { dispose(): void };

export interface TuiTerminal {
  readonly kind: "wraith";
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
  const rect = el.getBoundingClientRect();
  console.info(`[tui] mount — size ${rect.width}×${rect.height}, WebGPU=${("gpu" in navigator) && window.isSecureContext}, secure=${window.isSecureContext}`);
  if (!("gpu" in navigator) || !window.isSecureContext) {
    console.error("[tui] WebGPU unavailable — no xterm fallback, terminal will not start", { gpu: "gpu" in navigator, secure: window.isSecureContext });
    throw new Error("WebGPU required (no fallback): gpu=" + ("gpu" in navigator) + " secure=" + window.isSecureContext);
  }
  return mountWraith(el, opts);
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
