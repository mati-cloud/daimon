// Linux: what the app asks of the window manager / compositor directly, over X11.
//
// Electrobun embeds Chromium as an X11 child window, so the window is an X11 client — on
// XWayland in a Wayland session (GNOME, KDE Plasma…). These calls use their own Xlib
// connection: no GTK calls off GTK's thread.
//
// - Resize: the window has no system title bar (titleBarStyle "hidden", see index.ts), and
//   an undecorated window gets no resize borders from the window manager. The page's edge
//   strips (TitleBar.tsx) ask for one, and we send the standard EWMH request,
//   _NET_WM_MOVERESIZE — what GTK's begin_resize_drag sends.
// - Blur: KDE's compositor (KWin) blurs what is behind a window that sets
//   _KDE_NET_WM_BLUR_BEHIND_REGION, and advertises that in _NET_SUPPORTED. Other compositors
//   — GNOME's Mutter among them — offer applications no blur behind a window at all.
//   Apps only switch it on or off; KWin sets the strength (System Settings → Desktop
//   Effects → Blur).

import { dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";

export type ResizeEdge = "top-left" | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left";

// _NET_WM_MOVERESIZE directions.
const DIRECTION: Record<ResizeEdge, number> = {
  "top-left": 0, "top": 1, "top-right": 2, "right": 3,
  "bottom-right": 4, "bottom": 5, "bottom-left": 6, "left": 7,
};

const ClientMessage = 33;
const SubstructureRedirectMask = 1 << 20;
const SubstructureNotifyMask = 1 << 19;
const PropModeReplace = 0;
const XA_ATOM = 4n;
const XA_CARDINAL = 6n;
const XA_STRING = 31n;
const XA_WINDOW = 33n;
/** WM_CLASS of the app's windows: the Electrobun app name ("daimon2", "daimon2-dev"). */
const OWN_CLASS = /^daimon2(-|$)/;

type X11 = ReturnType<typeof openX11>;
let x11: X11 | null | undefined;

function openX11() {
  const lib = dlopen("libX11.so.6", {
    XOpenDisplay: { args: [FFIType.ptr], returns: FFIType.ptr },
    XDefaultRootWindow: { args: [FFIType.ptr], returns: FFIType.u64 },
    XInternAtom: { args: [FFIType.ptr, FFIType.cstring, FFIType.i32], returns: FFIType.u64 },
    XGetWindowProperty: {
      args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.i64, FFIType.i64, FFIType.i32, FFIType.u64,
        FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    XChangeProperty: {
      args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    XDeleteProperty: { args: [FFIType.ptr, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    XQueryPointer: {
      args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    XSendEvent: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    XUngrabPointer: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    XFlush: { args: [FFIType.ptr], returns: FFIType.i32 },
    XGetGeometry: {
      args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    XTranslateCoordinates: {
      args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    XFree: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const display = lib.symbols.XOpenDisplay(null);
  if (!display) throw new Error("XOpenDisplay failed (no X server / XWayland?)");
  const atom = (name: string) => lib.symbols.XInternAtom(display, Buffer.from(`${name}\0`), 0) as bigint;
  return {
    s: lib.symbols,
    display,
    root: lib.symbols.XDefaultRootWindow(display) as bigint,
    atoms: {
      supported: atom("_NET_SUPPORTED"),
      clientList: atom("_NET_CLIENT_LIST"),
      wmClass: atom("WM_CLASS"),
      moveResize: atom("_NET_WM_MOVERESIZE"),
      kdeBlur: atom("_KDE_NET_WM_BLUR_BEHIND_REGION"),
    },
  };
}

function getX11(): X11 | null {
  if (x11 === undefined) {
    try { x11 = openX11(); } catch (err) { console.warn("[x11]", err); x11 = null; }
  }
  return x11;
}

/** A window property: format-32 data as 64-bit items (Xlib returns C longs), format-8 as bytes. */
function property(x: X11, window: bigint, prop: bigint, type: bigint, bytes = false): bigint[] {
  const actualType = new BigUint64Array(1), format = new Int32Array(1);
  const nItems = new BigUint64Array(1), after = new BigUint64Array(1), data = new BigUint64Array(1);
  const ok = x.s.XGetWindowProperty(x.display, window, prop, 0, 4096, 0, type,
    ptr(actualType), ptr(format), ptr(nItems), ptr(after), ptr(data));
  if (ok !== 0 || !data[0]) return [];
  const p = Number(data[0]) as Pointer;
  const items = Array.from({ length: Number(nItems[0]) }, (_, i) => (bytes ? BigInt(read.u8(p, i)) : read.u64(p, i * 8)));
  x.s.XFree(p);
  return items;
}

/** WM_CLASS: "instance\0class\0". */
function wmClass(x: X11, w: bigint): string[] {
  return String.fromCharCode(...property(x, w, x.atoms.wmClass, XA_STRING, true).map(Number)).split("\0");
}

type Rect = { x: number; y: number; width: number; height: number };

/** The app's managed top-level windows, with where they are on screen. (CEF's window has no
 *  _NET_WM_PID; the installed app and a dev build share the class prefix.) */
function ownWindows(x: X11): { win: bigint; rect: Rect }[] {
  const root = new BigUint64Array(1), child = new BigUint64Array(1);
  const gx = new Int32Array(1), gy = new Int32Array(1), w = new Uint32Array(1), h = new Uint32Array(1);
  const border = new Uint32Array(1), depth = new Uint32Array(1), ax = new Int32Array(1), ay = new Int32Array(1);
  const out: { win: bigint; rect: Rect }[] = [];
  for (const win of property(x, x.root, x.atoms.clientList, XA_WINDOW)) {
    if (!wmClass(x, win).some((c) => OWN_CLASS.test(c))) continue;
    if (!x.s.XGetGeometry(x.display, win, ptr(root), ptr(gx), ptr(gy), ptr(w), ptr(h), ptr(border), ptr(depth))) continue;
    if (!x.s.XTranslateCoordinates(x.display, win, x.root, 0, 0, ptr(ax), ptr(ay), ptr(child))) continue;
    out.push({ win, rect: { x: ax[0]!, y: ay[0]!, width: w[0]!, height: h[0]! } });
  }
  return out;
}

// ── Resize ───────────────────────────────────────────────────────────────────

/** Start resizing from `edge`, for a left-button press that is still held. */
export function startLinuxResize(edge: ResizeEdge): boolean {
  if (!(edge in DIRECTION)) return false;
  const x = getX11();
  if (!x) return false;
  // Where the pointer is, in root coordinates.
  const rootRet = new BigUint64Array(1), child = new BigUint64Array(1);
  const rx = new Int32Array(1), ry = new Int32Array(1), wx = new Int32Array(1), wy = new Int32Array(1), mask = new Uint32Array(1);
  x.s.XQueryPointer(x.display, x.root, ptr(rootRet), ptr(child), ptr(rx), ptr(ry), ptr(wx), ptr(wy), ptr(mask));
  // Ours: the app window under the pointer — the press that started this is on it.
  const px = rx[0]!, py = ry[0]!;
  const own = ownWindows(x).find(({ rect: r }) => px >= r.x && py >= r.y && px < r.x + r.width && py < r.y + r.height);
  if (!own) { console.warn("[resize] couldn't find the app's X11 window under the pointer"); return false; }

  // XClientMessageEvent (LP64): type@0, serial@8, send_event@16, display@24, window@32,
  // message_type@40, format@48, data.l[5]@56. XEvent is 24 longs.
  const ev = new DataView(new ArrayBuffer(192));
  ev.setInt32(0, ClientMessage, true);
  ev.setInt32(16, 1, true);
  ev.setBigUint64(32, own.win, true);
  ev.setBigUint64(40, x.atoms.moveResize, true);
  ev.setInt32(48, 32, true);
  ev.setBigInt64(56, BigInt(px), true);
  ev.setBigInt64(64, BigInt(py), true);
  ev.setBigInt64(72, BigInt(DIRECTION[edge]), true);
  ev.setBigInt64(80, 1n, true); // button 1
  ev.setBigInt64(88, 1n, true); // source: normal application

  x.s.XUngrabPointer(x.display, 0n);
  const sent = x.s.XSendEvent(x.display, x.root, 0, SubstructureRedirectMask | SubstructureNotifyMask, ptr(ev));
  x.s.XFlush(x.display);
  return sent !== 0;
}

// ── Blur (KWin) ──────────────────────────────────────────────────────────────

/** Whether the compositor blurs behind windows on request: KWin lists its blur property in
 *  _NET_SUPPORTED. False on GNOME (Mutter) and other compositors without it. */
export function compositorBlurSupported(): boolean {
  const x = getX11();
  if (!x) return false;
  return property(x, x.root, x.atoms.supported, XA_ATOM).includes(x.atoms.kdeBlur);
}

/**
 * Blur (or stop blurring) what is behind the app window `frame` (the window's frame, as
 * Electrobun reports it). An empty region means the whole window. Returns false if the
 * window isn't found yet (not mapped) — call again later.
 */
export function setCompositorBlur(frame: Rect, on: boolean): boolean {
  const x = getX11();
  if (!x) return false;
  const windows = ownWindows(x);
  // The app window at this frame (several may share the class: installed app + dev build).
  const distance = (r: Rect) =>
    Math.abs(r.x - frame.x) + Math.abs(r.y - frame.y) + Math.abs(r.width - frame.width) + Math.abs(r.height - frame.height);
  const own = windows.sort((a, b) => distance(a.rect) - distance(b.rect))[0];
  if (!own || (windows.length > 1 && distance(own.rect) > 64)) return false;
  if (on) {
    const none = new BigUint64Array(1); // no rectangles: the whole window
    x.s.XChangeProperty(x.display, own.win, x.atoms.kdeBlur, XA_CARDINAL, 32, PropModeReplace, ptr(none), 0);
  } else {
    x.s.XDeleteProperty(x.display, own.win, x.atoms.kdeBlur);
  }
  x.s.XFlush(x.display);
  return true;
}
