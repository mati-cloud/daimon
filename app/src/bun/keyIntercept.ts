// macOS-only: suppress all keyboard input system-wide during keymap capture.
//
// CGEventTap at kCGHIDEventTap discards key events before any app sees them.
// Requires Accessibility: System Settings → Privacy & Security → Accessibility.
//
// The tap callback MUST NOT call back into JS — doing so deadlocks Bun's main
// thread (the CFRunLoop callback blocks waiting for JS, which is blocked waiting
// for the CFRunLoop). Instead we compile a tiny C dylib at startup whose callback
// simply returns NULL (discard the event) with no JS involvement.

import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { spawnSync } from "bun";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Id = Pointer | null;
const P = FFIType.ptr;

// ── C helper dylib ────────────────────────────────────────────────────────────
// Compiled once per process into a temp dir. The callback returns NULL = discard.

const HELPER_C = `
#include <stddef.h>
// CGEventTapCallBack signature — returns NULL to discard the event.
// No CG headers needed; the function pointer type is what matters.
void* daimonTapCallback(void* proxy, int type, void* event, void* refcon) {
  return NULL;
}
`;

let helperPath: string | null = null;

function buildHelper(): string | null {
  if (helperPath && existsSync(helperPath)) return helperPath;
  try {
    const sdk = spawnSync(["xcodebuild", "-sdk", "macosx", "-version", "Path"]);
    const sdkPath = new TextDecoder().decode(sdk.stdout).trim();
    if (!sdkPath) { console.error("[keyIntercept] xcodebuild SDK lookup failed"); return null; }

    const dir = mkdtempSync(join(tmpdir(), "daimon-keytap-"));
    const src = join(dir, "tap.c");
    const out = join(dir, "tap.dylib");
    writeFileSync(src, HELPER_C);
    const r = spawnSync([
      "xcrun", "--sdk", "macosx", "cc",
      "-O2", "-dynamiclib", "-isysroot", sdkPath,
      "-o", out, src,
    ]);
    if (r.exitCode !== 0) {
      console.error("[keyIntercept] build helper failed:", new TextDecoder().decode(r.stderr));
      return null;
    }
    helperPath = out;
    return out;
  } catch (e) {
    console.error("[keyIntercept] build helper error:", e);
    return null;
  }
}

// ── dlopen helpers ────────────────────────────────────────────────────────────

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
      CFStringCreateWithCString:     { args: [P, P, FFIType.u32], returns: P },
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
let locked = false;

function installTap(): boolean {
  if (tapPort) return true;
  if (!hasAccessibilityPermission()) return false;
  try {
    const dylib = buildHelper();
    if (!dylib) return false;

    // Load the C callback — pure native, no JS on the hot path.
    const helper = dlopen(dylib, {
      daimonTapCallback: { args: [P, FFIType.i32, P, P], returns: P },
    });

    const cg = loadCG();
    const cf = loadCF();

    // kCGHIDEventTap=0, kCGHeadInsertEventTap=0, kCGEventTapOptionDefault=0
    tapPort = cg.CGEventTapCreate(0, 0, 0, KEY_MASK, helper.symbols.daimonTapCallback, null);
    if (!tapPort) {
      console.error("[keyIntercept] CGEventTapCreate failed — Accessibility permission required");
      return false;
    }

    const rl  = cf.CFRunLoopGetMain();
    const src = cf.CFMachPortCreateRunLoopSource(null, tapPort, 0);
    // kCFStringEncodingUTF8 = 0x08000100
    const mode = cf.CFStringCreateWithCString(null, ptr(Buffer.from("kCFRunLoopDefaultMode\0")), 0x08000100);
    cf.CFRunLoopAddSource(rl, src, mode);

    cg.CGEventTapEnable(tapPort, false);
    console.log("[keyIntercept] tap installed");
    return true;
  } catch (e) {
    console.error("[keyIntercept] installTap:", e);
    tapPort = null;
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
