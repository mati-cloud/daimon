// Inline TUI renderer: libghostty-vt parser (Headless WASM) with no GPU.
// Produces a flat Uint32Array grid consumed by TuiGrid.tsx for native DOM rendering.

import { initWasm, Headless, KEY_CODES } from "wraithterm";
import type { TuiTerminal, TuiOptions } from "./tuiTerminal";

export type GridSnapshot = {
  /** Flat [scalar, fg, bg, flags] × cols×rows, row-major. */
  cells: Uint32Array;
  cols: number;
  rows: number;
  /** Cursor column in viewport, 0-based. */
  cursorCol: number;
  /** Cursor row in viewport, 0-based. */
  cursorRow: number;
  /** Whether the cursor should be visible (DECTCEM mode 25). */
  cursorVisible: boolean;
  /** 0=block 1=bar 2=underline */
  cursorStyle: number;
  /** True while the PTY stream has emitted \x1b[J (erase-down) since the last
   *  full-screen clear — signals an inline TUI (prompt_toolkit/clintermission)
   *  is redrawing from the cursor position upward. */
  inlineTui: boolean;
};

type Listener<T> = (value: T) => void;
type Disposable = { dispose(): void };

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(l: Listener<T>): Disposable {
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    },
    emit(value: T) {
      for (const l of listeners) l(value);
    },
    get size() {
      return listeners.size;
    },
  };
}

function mods(e: KeyboardEvent): number {
  return Number(e.shiftKey) | (Number(e.ctrlKey) << 1) | (Number(e.altKey) << 2) | (Number(e.metaKey) << 3);
}

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  // initWasm is idempotent once resolved; cache the promise so concurrent
  // callers share one initialization and subsequent calls return instantly.
  wasmReady ??= initWasm().then(() => {});
  return wasmReady;
}

/** Measure a monospace cell in the host element (px). */
function measureCell(el: HTMLElement, fontSize: number, lineHeight: number): { w: number; h: number } {
  const span = document.createElement("span");
  span.style.cssText = `position:absolute;visibility:hidden;font-family:GeistMono,'Geist Mono',ui-monospace,monospace;font-size:${fontSize}px;line-height:${lineHeight};white-space:pre`;
  span.textContent = "M";
  el.appendChild(span);
  const rect = span.getBoundingClientRect();
  el.removeChild(span);
  return { w: rect.width || fontSize * 0.6, h: rect.height || fontSize * lineHeight };
}

export async function mountHeadless(
  el: HTMLElement,
  opts: TuiOptions,
  onGrid: (snap: GridSnapshot) => void,
): Promise<TuiTerminal> {
  await ensureWasm();

  // Wait for layout to settle after WASM init (minHeight CSS may not have applied yet).
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  const cell = measureCell(el, opts.fontSize, opts.lineHeight);
  const rect = el.getBoundingClientRect();
  let cols = Math.max(1, Math.floor(rect.width / cell.w));
  // Use a large fixed row count so long output (tracebacks, logs) doesn't scroll
  // into scrollback and disappear from the grid. TuiGrid trims trailing blank rows
  // so the visual height stays compact regardless of this internal PTY size.
  let rows = 200;

  const hl = new Headless(cols, rows, opts.scrollback);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const data = emitter<string>();
  const resizes = emitter<{ cols: number; rows: number }>();
  const title = emitter<string>();
  const bell = emitter<void>();
  const clipboard = emitter<string>();
  const noop: Disposable = { dispose: () => {} };

  let disposed = false;
  let lastDigest = "";
  let rafId = 0;
  // prompt_toolkit hides the cursor (\x1b[?25l) while drawing an inline TUI frame
  // and shows it again (\x1b[?25h) when done. Use this as the reliable inline-TUI signal.
  let inlineTui = false;

  function drainEvents() {
    for (const ev of hl.take_events() as [number, Uint8Array][]) {
      if (ev[0] === 0) data.emit(dec.decode(ev[1]));       // PTY output (key echo)
      if (ev[0] === 1) title.emit(dec.decode(ev[1]));       // OSC title
      if (ev[0] === 2) bell.emit();                          // BEL
      if (ev[0] === 4) clipboard.emit(dec.decode(ev[1]));   // OSC 52 write
    }
  }

  function renderFrame() {
    if (disposed) return;
    rafId = requestAnimationFrame(renderFrame);
    const d = hl.digest();
    if (d === lastDigest) return;
    lastDigest = d;
    const sc = hl.screen();
    const snap: GridSnapshot = {
      cells: hl.grid(),
      cols,
      rows,
      cursorCol: sc[4] ?? 0,
      cursorRow: sc[3] ?? 0,
      cursorVisible: hl.mode(25),
      cursorStyle: hl.cursor_style(),
      inlineTui,
    };
    hl.acknowledge_damage();
    onGrid(snap);
  }

  // Hidden textarea captures keyboard input (same approach as Wraith).
  const input = document.createElement("textarea");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
  input.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;border:0;margin:0;opacity:0;overflow:hidden;resize:none;outline:none;caret-color:transparent";
  el.style.position ||= "relative";
  el.appendChild(input);

  const ac = new AbortController();
  const sig = { signal: ac.signal };

  input.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing || e.key === "Process" || e.key === "Dead") return;
      if (e.metaKey) return;
      e.preventDefault();
      const char = [...e.key].length === 1 ? e.key : "";
      const unshifted = e.code.startsWith("Key")
        ? (e.code.slice(3).toLowerCase().codePointAt(0) ?? 0)
        : e.code.startsWith("Digit")
          ? (e.code.slice(5).codePointAt(0) ?? 0)
          : (char.toLowerCase().codePointAt(0) ?? 0);
      hl.key(KEY_CODES[e.code] ?? 0, mods(e), e.repeat ? 2 : 1, char, unshifted);
      drainEvents();
    },
    sig,
  );

  input.addEventListener(
    "keyup",
    (e) => {
      if (e.isComposing || e.metaKey) return;
      hl.key(KEY_CODES[e.code] ?? 0, mods(e), 0, "", 0);
      drainEvents();
    },
    sig,
  );

  input.addEventListener(
    "compositionend",
    (e) => {
      if (!e.data) return;
      hl.key(0, 0, 1, e.data, 0);
      drainEvents();
    },
    sig,
  );

  rafId = requestAnimationFrame(renderFrame);

  return {
    kind: "headless",
    get cols() { return cols; },
    get rows() { return rows; },
    write(data_) {
      hl.write(enc.encode(data_));
      drainEvents();
      // \x1b[?25l = hide cursor: prompt_toolkit is drawing an inline TUI frame.
      // \x1b[?25h = show cursor: prompt_toolkit finished drawing (or app exited menu).
      if (data_.includes("\x1b[?25l")) inlineTui = true;
      if (data_.includes("\x1b[?25h")) inlineTui = false;
      // Reply to CPR queries (\x1b[6n) so clintermission/inquirer don't hang waiting.
      if (data_.includes("\x1b[6n")) {
        const sc = hl.screen();
        data.emit(`\x1b[${(sc[3] as number) + 1};${(sc[4] as number) + 1}R`);
      }
      return Promise.resolve();
    },
    paste(text) {
      // Bracketed paste: mode 2004 wraps text in \x1b[200~ ... \x1b[201~
      const bp = hl.mode(2004);
      hl.key(0, 0, 1, bp ? `\x1b[200~${text}\x1b[201~` : text, 0);
      drainEvents();
      return Promise.resolve();
    },
    fit() {
      const r = el.getBoundingClientRect();
      const c = measureCell(el, opts.fontSize, opts.lineHeight);
      cols = Math.max(1, Math.floor(r.width / c.w));
      // Keep rows fixed at 200 — same as initial. Only cols change on resize.
      hl.resize(cols, rows);
      resizes.emit({ cols, rows });
    },
    focus() { input.focus({ preventScroll: true }); },
    onData: (l) => data.on(l),
    onResize: (l) => resizes.on(l),
    onError: (_l) => noop,
    onTitleChange: (l) => title.on(l),
    onBell: (l) => bell.on(l),
    onClipboard: (l) => clipboard.on(l),
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      ac.abort();
      el.removeChild(input);
      hl.free();
      return Promise.resolve();
    },
  };
}
