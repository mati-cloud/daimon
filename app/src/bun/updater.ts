// Auto-update through Electrobun's Updater. The installed app checks
// `<release.baseUrl>/stable-<os>-<arch>-update-v2.json` (electrobun.config.ts: the latest
// GitHub release) shortly after launch and then every few hours. A newer build is
// downloaded in the background; the page then offers "restart to update", which swaps the
// bundle and relaunches. Terminal sessions live in the detached pty-daemon, so they survive.
//
// Only the installed app (~/.local/share/<identifier>/<channel>/app, /Applications, …) can
// update itself; a copy run from elsewhere — e.g. ./build.sh's dist/ — gets an error
// state that says so and links to the release instead.
//
// Dev builds (channel "dev") never update. DAIMON_UPDATE_DEMO=1 fakes an update to work on
// the UI; DAIMON_UPDATE_DEMO=error fakes a failing one.

import { Updater } from "electrobun/bun";
import { appLog, appLogPath, appWarn } from "./appLog";

/** What the sidebar shows: nothing, a download in progress, a restart button, or a failure. */
export type UpdateState =
  | { state: "none" }
  | { state: "downloading"; version: string; stage: string; progress?: number }
  | { state: "ready"; version: string }
  | {
      state: "error";
      version: string;
      message: string;
      /** This copy isn't the installed app, so it can't update itself. */
      notInstalled: boolean;
      /** Where to get the new version by hand. */
      releaseUrl: string;
      logPath: string;
    };

/** A manual check's answer ("Check for updates" in the command palette). */
export type CheckResult =
  | { result: "up-to-date"; version: string }
  | { result: "available"; version: string } // downloading, or ready: the sidebar shows which
  | { result: "busy" }                       // a check is already running
  | { result: "unsupported" }                // dev build
  | { result: "error"; message: string };

const FIRST_CHECK_MS = 15_000; // after launch, so it doesn't compete with startup
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** A manual check waits this long for the download to fail before answering "available". */
const EARLY_FAILURE_MS = 2_000;
const RELEASES = "https://github.com/mati-cloud/daimon/releases";

/** Electrobun's status names → the stage the sidebar shows while downloading. */
const STAGES: Partial<Record<string, string>> = {
  "download-starting": "Starting download",
  "downloading": "Downloading",
  "downloading-full-bundle": "Downloading",
  "download-progress": "Downloading",
  "fetching-patch": "Downloading",
  "downloading-patch": "Downloading",
  "decompressing": "Unpacking",
  "extracting-version": "Unpacking",
  "applying-patch": "Unpacking",
  "download-complete": "Finishing",
};

function errorState(version: string, message: string): UpdateState {
  return {
    state: "error",
    version,
    message,
    notInstalled: /outside its managed update directory/i.test(message),
    releaseUrl: `${RELEASES}/tag/v${version}`,
    logPath: appLogPath,
  };
}

export function startUpdater(isDev: boolean, notify: (s: UpdateState) => void) {
  let current: UpdateState = { state: "none" };
  const set = (s: UpdateState) => { current = s; notify(s); };

  if (isDev) {
    const demoMode = process.env.DAIMON_UPDATE_DEMO;
    if (demoMode) demo(set, demoMode === "error");
    return {
      state: () => current,
      check: async (): Promise<CheckResult> =>
        demoMode ? { result: "available", version: "9.9.9" } : { result: "unsupported" },
      apply: () => appLog("[update] demo: would restart into", current.state === "ready" ? current.version : "-"),
    };
  }

  Updater.onStatusChange((e) => {
    if (current.state === "downloading") {
      const stage = STAGES[e.status];
      const progress = e.status === "download-progress" ? e.details?.progress ?? current.progress : current.progress;
      if (stage && (stage !== current.stage || progress !== current.progress)) {
        set({ ...current, stage, progress });
      }
    }
    if (e.status === "error") appWarn("[update]", e.message);
  });

  let busy = false;
  /** Checks, then downloads a newer build in the background; resolves once the check is done
   *  (or the download has failed right away, e.g. because this copy isn't installed). */
  async function check(): Promise<CheckResult> {
    if (current.state === "ready" || current.state === "downloading") {
      return { result: "available", version: current.version };
    }
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
      if (current.state === "error") set({ state: "none" });
      return { result: "up-to-date", version: await Updater.localInfo.version() };
    }
    appLog("[update] available:", info.version);
    const done = download(info.version, info.updateReady).finally(() => { busy = false; });
    await Promise.race([done, new Promise((r) => setTimeout(r, EARLY_FAILURE_MS))]);
    const now = current as UpdateState;
    if (now.state === "error") return { result: "error", message: now.message };
    return { result: "available", version: info.version };
  }

  async function download(version: string, alreadyReady: boolean) {
    try {
      if (!alreadyReady) {
        set({ state: "downloading", version, stage: "Starting download" });
        await Updater.downloadUpdate();
      }
      const after = Updater.updateInfo();
      if (after.updateReady) {
        appLog("[update] ready:", after.version);
        set({ state: "ready", version: after.version });
      } else {
        const message = after.error || "the download didn't finish";
        appWarn("[update] download failed:", message);
        set(errorState(version, message));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appWarn("[update] download failed:", message);
      set(errorState(version, message));
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

/** DAIMON_UPDATE_DEMO in dev: a fake download, then a ready (or failed) update. */
function demo(set: (s: UpdateState) => void, fail: boolean) {
  let progress = 0;
  const timer = setInterval(() => {
    progress += 20;
    if (progress < 100) return set({ state: "downloading", version: "9.9.9", stage: "Downloading", progress });
    clearInterval(timer);
    set(fail
      ? errorState("9.9.9", "The running application is outside its managed update directory")
      : { state: "ready", version: "9.9.9" });
  }, 1000);
}
