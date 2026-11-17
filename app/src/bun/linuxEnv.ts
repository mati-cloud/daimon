// WebKitGTK workarounds that must be in the process environment before the first webview
// exists. The installed app is started from a desktop shortcut, with no wrapper script to
// set them. Imported first by index.ts.
//
// Bun doesn't forward process.env writes to the C environment that WebKitGTK reads, so
// they go through libc's setenv. Values the user already set win (overwrite = 0).
import { dlopen, FFIType } from "bun:ffi";
import { readFileSync } from "node:fs";

if (process.platform === "linux") {
  const vars: Record<string, string> = {};

  // WebKitGTK's DMA-BUF renderer shows a blank window under WSLg's virtual GPU.
  let isWsl = false;
  try {
    isWsl = /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    /* not readable: assume a regular Linux desktop */
  }
  if (isWsl) vars.WEBKIT_DISABLE_DMABUF_RENDERER = "1";

  // WebKitGTK can't repaint a see-through window with accelerated compositing.
  if (process.env.DAIMON_TRANSPARENT === "1") vars.WEBKIT_DISABLE_COMPOSITING_MODE = "1";

  if (Object.keys(vars).length) {
    const cstr = (s: string) => Buffer.from(`${s}\0`);
    const { symbols, close } = dlopen("libc.so.6", {
      setenv: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
    });
    for (const [key, value] of Object.entries(vars)) {
      symbols.setenv(cstr(key), cstr(value), 0);
      process.env[key] ??= value;
    }
    close();
  }
}
