// Bottom of the sidebar: a newer daimon is downloading, or ready — click to restart into it.
// The native host (app/src/bun/updater.ts) sends `daimon:update` events; in a plain
// browser (no host) nothing ever shows.

import { useEffect, useState } from "react";
import { DownloadIcon, RotateCwIcon } from "lucide-react";

type UpdateState =
  | { state: "none" }
  | { state: "downloading"; version: string; progress?: number }
  | { state: "ready"; version: string };

function sendUpdate(action: "state" | "apply") {
  try {
    (window as { __electrobunSendToHost?: (m: unknown) => void }).__electrobunSendToHost?.({ type: "update", action });
  } catch { /* shell bridge unavailable */ }
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

  if (update.state === "none") return null;

  if (update.state === "downloading") {
    return (
      <div className="mx-3 mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] text-sidebar-foreground/45">
        <DownloadIcon className="size-3 shrink-0" />
        <span className="truncate">Downloading v{update.version}{update.progress != null && ` · ${update.progress}%`}</span>
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
