// macOS-only: suppress all keyboard input system-wide during keymap capture.
//
// CGEventTap at kCGHIDEventTap discards key events before any app sees them —
// including Spotlight, Mission Control, language switcher.
// Requires Accessibility: System Settings → Privacy & Security → Accessibility.

import { dlopen, FFIType, ptr, JSCallback, type Pointer } from "bun:ffi";

type Id = Pointer | null;
const P = FFIType.ptr;

// ── dlopen helpers (lazy, darwin-only paths) ──────────────────────────────────

function loadCG() {
  return dlopen(
    "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
    {
      CGEventTapCreate: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u64, P, P], returns: P },
      CGEventTapEnable: { args: [P, FFIType.bool], returns: FFIType.void },
    },
  ).symbols;
}

function loadCF() {
  return dlopen(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
    {
      CFMachPortCreateRunLoopSource: { args: [P, P, FFIType.i32], returns: P },
      CFRunLoopGetMain:              { args: [], returns: P },
      CFRunLoopAddSource:            { args: [P, P, P], returns: FFIType.void },
      // kCFRunLoopCommonModes is a global CFStringRef — declared as a 0-arg function
      // so bun:ffi resolves the symbol; calling it reads the pointer at that address.
      kCFRunLoopCommonModes:         { args: [], returns: P },
    },
  ).symbols;
}

function loadAX() {
  return dlopen(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
    {
      AXIsProcessTrusted:            { args: [], returns: FFIType.bool },
      AXIsProcessTrustedWithOptions: { args: [P], returns: FFIType.bool },
    },
  ).symbols;
}

function loadObjC() {
  const lib = "/usr/lib/libobjc.A.dylib";
  const send = <A extends FFIType[], R extends FFIType>(args: A, returns: R) =>
    dlopen(lib, { objc_msgSend: { args: [P, P, ...args], returns } }).symbols
      .objc_msgSend as unknown as (...a: unknown[]) => unknown;
  const rt = dlopen(lib, {
    objc_getClass:    { args: [P], returns: P },
    sel_registerName: { args: [P], returns: P },
  }).symbols;
  const cstr = (s: string) => ptr(Buffer.from(s + "\0"));
  return {
    cls:      (n: string) => rt.objc_getClass(cstr(n)) as Id,
    sel:      (n: string) => rt.sel_registerName(cstr(n)) as Id,
    cstr,
    with1:    send([P], P)    as (self: Id, sel: Id, a: Id) => Id,
    with2:    send([P, P], P) as (self: Id, sel: Id, a: Id, b: Id) => Id,
    withBool: send([FFIType.bool], P) as (self: Id, sel: Id, a: boolean) => Id,
  };
}

// ── Accessibility ─────────────────────────────────────────────────────────────

export function hasAccessibilityPermission(): boolean {
  if (process.platform !== "darwin") return false;
  try { return Boolean(loadAX().AXIsProcessTrusted()); } catch { return false; }
}

export function requestAccessibilityPermission(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const ax = loadAX();
    const o = loadObjC();
    const yes  = o.withBool(o.cls("NSNumber"), o.sel("numberWithBool:"), true);
    const key  = o.with1(o.cls("NSString"), o.sel("stringWithUTF8String:"),
                         o.cstr("AXTrustedCheckOptionPrompt"));
    const dict = o.with2(o.cls("NSDictionary"), o.sel("dictionaryWithObject:forKey:"), yes, key);
    return Boolean(ax.AXIsProcessTrustedWithOptions(dict));
  } catch (e) {
    console.error("[keyIntercept] requestAccessibilityPermission:", e);
    return false;
  }
}

// ── Event tap ─────────────────────────────────────────────────────────────────
// keyDown(10)|keyUp(11)|flagsChanged(12) = 0x1C00
const KEY_MASK = BigInt(0x1C00);

let tapPort: Id = null;
let tapCb: JSCallback | null = null;
let locked = false;

function installTap(): boolean {
  if (tapPort) return true;
  if (!hasAccessibilityPermission()) return false;
  try {
    const cg = loadCG();
    const cf = loadCF();

    tapCb = new JSCallback(
      () => null, // return NULL = discard the event
      { args: [P, FFIType.i32, P, P], returns: P },
    );

    // kCGHIDEventTap=0, kCGHeadInsertEventTap=0, kCGEventTapOptionDefault=0
    tapPort = cg.CGEventTapCreate(0, 0, 0, KEY_MASK, tapCb.ptr, null);
    if (!tapPort) {
      console.error("[keyIntercept] CGEventTapCreate failed — Accessibility permission required");
      return false;
    }

    const rl  = cf.CFRunLoopGetMain();
    const src = cf.CFMachPortCreateRunLoopSource(null, tapPort, 0);
    // kCFRunLoopCommonModes is a global symbol — call it as a getter to read the pointer.
    const commonModes = cf.kCFRunLoopCommonModes() as Id;
    cf.CFRunLoopAddSource(rl, src, commonModes);

    cg.CGEventTapEnable(tapPort, false); // start disabled until setKeyInterceptLock(true)
    console.log("[keyIntercept] tap installed");
    return true;
  } catch (e) {
    console.error("[keyIntercept] installTap:", e);
    tapPort = null;
    tapCb = null;
    return false;
  }
}

export function setKeyInterceptLock(on: boolean): void {
  if (process.platform !== "darwin") return;
  if (on === locked) return;
  if (on && !installTap()) {
    console.warn("[keyIntercept] lock skipped — Accessibility permission not granted");
    return;
  }
  try {
    loadCG().CGEventTapEnable(tapPort, on);
    locked = on;
    console.log(`[keyIntercept] ${on ? "LOCKED" : "unlocked"}`);
  } catch (e) {
    console.error("[keyIntercept] CGEventTapEnable:", e);
  }
}
