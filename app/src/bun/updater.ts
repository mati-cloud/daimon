// Auto-update through Electrobun's Updater. The installed app checks
// `<release.baseUrl>/stable-<os>-<arch>-update-v2.json` (electrobun.config.ts: the latest
// GitHub release) shortly after launch and then every few hours. A newer build is
// downloaded in the background; the page then offers "restart to update", which swaps the
// bundle and relaunches. Terminal sessions live in the detached pty-daemon, so they survive.
//
// Dev builds (channel "dev") never update. DAIMON_UPDATE_DEMO=1 fakes one, to work on the UI.

import { Updater } from "electrobun/bun";
import { appLog, appWarn } from "./appLog";

/** What the page shows: nothing, a download in progress, or a restart button. */
export type UpdateState =
  | { state: "none" }
  | { state: "downloading"; version: string; progress?: number }
  | { state: "ready"; version: string };

/** A manual check's answer ("Check for updates" in the command palette). */
export type CheckResult =
  | { result: "up-to-date"; version: string }
  | { result: "available"; version: string } // downloading, or ready: the sidebar shows which
  | { result: "busy" }                       // a check is already running
  | { result: "unsupported" }                // dev build
  | { result: "error"; message: string };

const FIRST_CHECK_MS = 15_000; // after launch, so it doesn't compete with startup
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function startUpdater(isDev: boolean, notify: (s: UpdateState) => void) {
  let current: UpdateState = { state: "none" };
  const set = (s: UpdateState) => { current = s; notify(s); };

  if (isDev) {
    const isDemo = process.env.DAIMON_UPDATE_DEMO === "1";
    if (isDemo) demo(set);
    return {
      state: () => current,
      check: async (): Promise<CheckResult> =>
        isDemo ? { result: "available", version: "9.9.9" } : { result: "unsupported" },
      apply: () => appLog("[update] demo: would restart into", current.state === "ready" ? current.version : "-"),
    };
  }

  Updater.onStatusChange((e) => {
    if (e.status === "download-progress" && current.state === "downloading" && e.details?.progress != null) {
      set({ ...current, progress: e.details.progress });
    } else if (e.status === "error") {
      appWarn("[update]", e.message);
    }
  });

  let busy = false;
  /** Checks, then downloads a newer build in the background; resolves once the check is done. */
  async function check(): Promise<CheckResult> {
    if (current.state === "ready") return { result: "available", version: current.version };
    if (current.state === "downloading") return { result: "available", version: current.version };
    if (busy) return { result: "busy" };
    busy = true;
    let info;
    try {
      info = await Updater.checkForUpdate();
    } catch (err) {
      busy = false;
      appWarn("[update] check failed:", err);
      return { result: "error", message: err instanceof Error ? err.message : String(err) };
    }
    if (info.error) {
      busy = false;
      appWarn("[update] check failed:", info.error);
      return { result: "error", message: info.error };
    }
    if (!info.updateAvailable) {
      busy = false;
      return { result: "up-to-date", version: await Updater.localInfo.version() };
    }
    appLog("[update] available:", info.version);
    void download(info.version, info.updateReady).finally(() => { busy = false; });
    return { result: "available", version: info.version };
  }

  async function download(version: string, alreadyReady: boolean) {
    try {
      if (!alreadyReady) {
        set({ state: "downloading", version });
        await Updater.downloadUpdate();
      }
      const after = Updater.updateInfo();
      if (after.updateReady) {
        appLog("[update] ready:", after.version);
        set({ state: "ready", version: after.version });
      } else {
        appWarn("[update] download didn't finish:", after.error || "unknown error");
        set({ state: "none" });
      }
    } catch (err) {
      appWarn("[update] download failed:", err);
      set({ state: "none" });
    }
  }

  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  return {
    state: () => current,
    check,
    apply: () => {
      if (current.state !== "ready") return;
      appLog("[update] restarting into", current.version);
      void Updater.applyUpdate();
    },
  };
}

/** DAIMON_UPDATE_DEMO=1 in dev: a fake download, then a ready update. */
function demo(set: (s: UpdateState) => void) {
  let progress = 0;
  const timer = setInterval(() => {
    progress += 20;
    if (progress < 100) return set({ state: "downloading", version: "9.9.9", progress });
    clearInterval(timer);
    set({ state: "ready", version: "9.9.9" });
  }, 1000);
}
