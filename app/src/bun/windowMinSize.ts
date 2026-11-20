// Smallest window size the layout still works at (sidebar + a usable terminal).
// Electrobun (2.0.6) has no min-size option, so:
// - macOS: NSWindow's contentMinSize, set natively: the window can't be dragged smaller.
//   AppKit wants the main thread, so (like macMagnification.ts) it goes through
//   key-value coding: [window performSelectorOnMainThread:@selector(setValuesForKeysWithDictionary:)
//   withObject:@{ @"contentMinSize": [NSValue valueWithSize:…] } waitUntilDone:NO].
// - Windows / Linux: after a resize below the minimum, the window is set back to it.
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import type { BrowserWindow } from "electrobun/bun";

export const MIN_WIDTH = 760;
export const MIN_HEIGHT = 480;

function macMinSize(nsWindow: Pointer, width: number, height: number) {
  const objc = "/usr/lib/libobjc.A.dylib";
  const { ptr: P, f64, bool } = FFIType;
  const send = (args: FFIType[], returns: FFIType) =>
    dlopen(objc, { objc_msgSend: { args: [P, P, ...args], returns } }).symbols.objc_msgSend as unknown as (
      ...a: unknown[]
    ) => Pointer | null;
  const rt = dlopen(objc, {
    objc_getClass: { args: [P], returns: P },
    sel_registerName: { args: [P], returns: P },
  }).symbols;
  const cstr = (s: string) => ptr(Buffer.from(s + "\0"));
  const cls = (n: string) => rt.objc_getClass(cstr(n));
  const sel = (n: string) => rt.sel_registerName(cstr(n));

  // NSSize is two doubles: passed in float registers like two f64 arguments (arm64 and x86-64).
  const size = send([f64, f64], P)(cls("NSValue"), sel("valueWithSize:"), width, height);
  const key = send([P], P)(cls("NSString"), sel("stringWithUTF8String:"), cstr("contentMinSize"));
  const dict = send([P, P], P)(cls("NSDictionary"), sel("dictionaryWithObject:forKey:"), size, key);
  send([P, P, bool], FFIType.void)(
    nsWindow, sel("performSelectorOnMainThread:withObject:waitUntilDone:"),
    sel("setValuesForKeysWithDictionary:"), dict, false,
  );
}

export function setMinSize(win: BrowserWindow, attempt = 0): void {
  if (process.platform === "darwin") {
    const nsWindow = win.ptr as Pointer | null;
    if (!nsWindow) {
      if (attempt < 20) setTimeout(() => setMinSize(win, attempt + 1), 250);
      return;
    }
    try { macMinSize(nsWindow, MIN_WIDTH, MIN_HEIGHT); }
    catch (err) { console.warn("[main] min window size failed:", err); }
    return;
  }
  let clamping = false;
  win.on("resize", () => {
    if (clamping || win.isMaximized()) return;
    const { width, height } = win.getFrame();
    if (width >= MIN_WIDTH && height >= MIN_HEIGHT) return;
    clamping = true;
    win.setSize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));
    setTimeout(() => { clamping = false; }, 50);
  });
}
