// Bottom of the sidebar: a newer daimon is downloading (stage + progress), ready — click to
// restart into it — or failed (why, with a retry, the release page and the host log).
// The native host (app/src/bun/updater.ts) sends `daimon:update` events; in a plain
// browser (no host) nothing ever shows.

import { useEffect, useState } from "react";
import { AlertTriangleIcon, DownloadIcon, RotateCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { openInBrowser } from "@/lib/daimon/rpc";

// Mirrors app/src/bun/updater.ts.
type UpdateState =
  | { state: "none" }
  | { state: "downloading"; version: string; stage: string; progress?: number }
  | { state: "ready"; version: string }
  | { state: "error"; version: string; message: string; notInstalled: boolean; releaseUrl: string; logPath: string };

type CheckResult =
  | { result: "up-to-date"; version: string }
  | { result: "available"; version: string }
  | { result: "busy" }
  | { result: "unsupported" }
  | { result: "error"; message: string };

function sendUpdate(action: "state" | "apply" | "check"): boolean {
  const send = (window as { __electrobunSendToHost?: (m: unknown) => void }).__electrobunSendToHost;
  if (!send) return false;
  try { send({ type: "update", action }); return true; } catch { return false; /* shell bridge unavailable */ }
}

/** "Check for updates" (command palette): asks the host and reports the answer as a toast. */
export function checkForUpdates() {
  const id = "update-check";
  if (!sendUpdate("check")) {
    toast("Updates are only available in the desktop app", { id });
    return;
  }
  toast.loading("Checking for updates…", { id });
  const timeout = setTimeout(() => {
    window.removeEventListener("daimon:update-check", onResult);
    toast.error("Update check timed out", { id });
  }, 30_000);
  function onResult(e: Event) {
    clearTimeout(timeout);
    window.removeEventListener("daimon:update-check", onResult);
    const r = (e as CustomEvent<CheckResult>).detail;
    switch (r?.result) {
      case "up-to-date":  toast.success(`daimon is up to date (v${r.version})`, { id }); break;
      case "available":   toast.success(`v${r.version} is available — it's downloading; restart from the sidebar when it's ready`, { id }); break;
      case "busy":        toast("Already checking for updates", { id }); break;
      case "unsupported": toast("Dev builds don't update", { id }); break;
      case "error":
        toast.error(/outside its managed update directory/i.test(r.message)
          ? "This copy isn't the installed app, so it can't update itself — see the sidebar"
          : `Update failed: ${r.message}`, { id });
        break;
      default:            toast.dismiss(id);
    }
  }
  window.addEventListener("daimon:update-check", onResult);
}

export function UpdatePill() {
  const [update, setUpdate] = useState<UpdateState>({ state: "none" });
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const onUpdate = (e: Event) => setUpdate((e as CustomEvent<UpdateState>).detail ?? { state: "none" });
    window.addEventListener("daimon:update", onUpdate);
    sendUpdate("state"); // the host may have found one before the page loaded
    return () => window.removeEventListener("daimon:update", onUpdate);
  }, []);

  // A failure is dismissed until the next one (another version or message).
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (update.state === "none") return null;

  if (update.state === "downloading") {
    const pct = update.progress;
    return (
      <div
        title={`Downloading daimon v${update.version} in the background`}
        className="mx-3 mb-3 rounded-md border border-border/60 px-2 py-1.5 font-mono text-[11px] text-sidebar-foreground/60"
      >
        <div className="flex items-center gap-2">
          <DownloadIcon className="size-3 shrink-0 animate-pulse text-amber" />
          <span className="truncate">{update.stage} v{update.version}{pct != null && ` · ${pct}%`}</span>
        </div>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-sidebar-foreground/10">
          {pct != null
            ? <div className="h-full bg-amber transition-[width] duration-300" style={{ width: `${pct}%` }} />
            : <div className="h-full w-1/3 animate-pulse bg-amber/60" />}
        </div>
      </div>
    );
  }

  if (update.state === "error") {
    const key = `${update.version}\n${update.message}`;
    if (dismissed === key) return null;
    return (
      <div className="mx-3 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-sidebar-foreground">
        <div className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-px size-3 shrink-0 text-destructive" />
          <span className="flex-1">
            {update.notInstalled
              ? `v${update.version} is out, but this copy isn't the installed app, so it can't update itself.`
              : `Couldn't download v${update.version}: ${update.message}`}
          </span>
          <button onClick={() => setDismissed(key)} title="Dismiss" className="no-drag shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground">
            <XIcon className="size-3" />
          </button>
        </div>
        <div className="mt-1.5 flex gap-3 pl-5 text-sidebar-foreground/60">
          <button onClick={() => openInBrowser(update.releaseUrl)} className="no-drag underline-offset-2 hover:text-sidebar-foreground hover:underline">
            {update.notInstalled ? "Get the installer" : "Release page"}
          </button>
          {!update.notInstalled && (
            <button onClick={() => checkForUpdates()} className="no-drag underline-offset-2 hover:text-sidebar-foreground hover:underline">Retry</button>
          )}
          <button
            onClick={() => { void navigator.clipboard?.writeText(update.logPath); toast("Log path copied", { description: update.logPath }); }}
            title={update.logPath}
            className="no-drag underline-offset-2 hover:text-sidebar-foreground hover:underline"
          >
            Log
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      disabled={restarting}
      onClick={() => { setRestarting(true); sendUpdate("apply"); }}
      title="Restart daimon into the new version. Your sessions keep running."
      className="no-drag mx-3 mb-3 flex items-center gap-2 rounded-md border border-amber/40 bg-amber/10 px-2 py-1.5 text-left font-mono text-[11px] text-sidebar-foreground transition-colors hover:bg-amber/20 disabled:opacity-60"
    >
      <RotateCwIcon className={`size-3 shrink-0 text-amber ${restarting ? "animate-spin" : ""}`} />
      <span className="truncate">{restarting ? "Restarting…" : `v${update.version} ready · Restart`}</span>
    </button>
  );
}
