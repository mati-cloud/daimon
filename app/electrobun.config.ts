import type { ElectrobunConfig } from "electrobun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Production payload (./build.sh): the built UI is served from views://daimon2/ and
// the release pty-daemon sits next to the main bundle. Dev builds (./dev.sh) use the
// Vite server and an already-running daemon, so anything not built yet is skipped.
const payload: Record<string, string> = {
  "../ui/dist": "views/daimon2",
  "../target/release/pty-daemon": "pty-daemon",
  // The CLI (`daimon setup`, `daimon plugin`, shell hooks), shipped inside the installed app.
  "../target/release/daimon": "daimon-cli",
  // macOS: native window dragging, loaded from next to the bundled main process (macWindowDrag.ts).
  ...(process.platform === "darwin" && { "src/bun/libDaimonDrag.dylib": "bun/libDaimonDrag.dylib" }),
  // Windows app built from WSL: the distro its (Linux) daemon runs in.
  "wsl-distro": "wsl-distro",
  // Windows: the window icon, set at runtime (src/bun/winIcon.ts).
  "assets/icon.ico": "icon.ico",
};
const copy = Object.fromEntries(
  Object.entries(payload)
    .map(([src, dest]) => [resolve(import.meta.dirname, src), dest] as const)
    .filter(([src]) => existsSync(src)),
);

export default {
  app: {
    name: "daimon2",
    identifier: "daimon2.terminal",
    version: "0.14.7", // x-release-please-version
  },
  build: {
    // Windows: run the main process on Bun. Electrobun's default runtime (Cottontail)
    // keeps one thread spinning there — ~40% of a core and ~550 MB while idle, even
    // for an empty one-window app; on Bun it idles at 0% and ~65 MB.
    ...(process.platform === "win32" && {
      mainProcess: "bun" as const,
      bun: { entrypoint: "src/bun/index.ts" },
    }),
    views: {},
    copy,
    // App icon, generated from assets/icon.svg.
    mac:   { bundleCEF: false, icons: "assets/icon.iconset" },
    // Linux: Chromium (CEF) instead of WebKitGTK. WebKitGTK has no working WebGPU (the
    // full-screen terminal's renderer) and stretches a magnified page as a bitmap, where
    // Chromium re-rasterizes it sharp. Electrobun starts CEF with the GPU off; turn it
    // back on, and enable Chromium's WebGPU, which needs Vulkan on Linux. (Electrobun
    // embeds CEF as an X11 child window, so the app runs on XWayland under Wayland.)
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "assets/icon.png",
      chromiumFlags: {
        "disable-gpu": false,
        "disable-gpu-compositing": false,
        "enable-unsafe-webgpu": true,
        "enable-features": "Vulkan",
      },
    },
    win:   { bundleCEF: false, icon: "assets/icon.ico" },
  },
  // Auto-update (src/bun/updater.ts): the installed app fetches
  // `<baseUrl>/stable-<os>-<arch>-update-v2.json` and the .tar.zst it names. The release
  // workflow attaches both to each GitHub release; `latest/download` follows the newest.
  // DAIMON_UPDATE_URL at build time points a build elsewhere (e.g. a local server, to test).
  release: {
    baseUrl: process.env.DAIMON_UPDATE_URL || "https://github.com/mati-cloud/daimon/releases/latest/download",
    // Delta patches would need the previous release's archive at build time; a full
    // download per update keeps CI simple.
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
