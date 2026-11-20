/**
 * Blocked plugins (see lib/daimon/plugins.ts): a modal that can't be dismissed, one plugin
 * at a time, until each is approved or quarantined.
 *
 * Approving takes typing the plugin's name (not for an unmodified official plugin), then
 * the OS admin prompt the daemon shows. The typing is friction against clicking through;
 * the admin prompt is the security boundary (only it can write the root-owned approvals).
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approvePlugin, quarantinePlugin, useBlockedPlugins } from "@/lib/daimon/plugins";

export function PluginGate() {
  const blocked = useBlockedPlugins();
  const p = blocked[0];
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"approve" | "quarantine" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);

  // A new plugin (or a new version of it) starts from scratch.
  const key = p ? `${p.name}:${p.sha256}` : "";
  useEffect(() => { setTyped(""); setError(null); setCommand(null); setBusy(null); }, [key]);

  if (!p) return null;

  const needsName = !p.official;
  const nameOk = !needsName || typed === p.name;
  const privileged = p.findings.filter((f) => f.privileged);
  // The banner's heading already says it ("act as you"), so exec isn't listed again.
  const privilegedList = privileged.filter((f) => f.id !== "exec");
  const other = p.findings.filter((f) => !f.privileged);

  const approve = async () => {
    setBusy("approve"); setError(null); setCommand(null);
    try {
      const r = await approvePlugin(p.name);
      // Approved: the daemon reports the change and the modal moves on by itself.
      if (!r.approved) { setError(r.error ?? "not approved"); setCommand(r.command ?? null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const quarantine = async () => {
    setBusy("quarantine"); setError(null);
    try {
      const r = await quarantinePlugin(p.name);
      if (!r.ok) setError(r.error ?? "couldn't quarantine it");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent
        className="max-w-xl"
        data-key-lock-allow
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Plugin “{p.name}” is blocked
            {blocked.length > 1 && <span className="ml-2 text-sm font-normal text-muted-foreground">1 of {blocked.length}</span>}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {p.reason === "changed since it was approved"
              ? "This plugin's file changed since you approved it."
              : "A new plugin appeared in your plugins folder."}{" "}
            It won't run until you approve it. If you didn't add or edit it yourself, quarantine it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-all">
            <div>~/.config/daimon/plugins/{p.file}</div>
            <div className="text-muted-foreground">sha256 {p.sha256}</div>
            {p.official && <div className="mt-1 font-sans text-signal">Official daimon plugin, unmodified.</div>}
          </div>

          {privileged.length > 0 && (
            <div className="rounded-md border border-alarm/40 bg-alarm/5 p-3">
              <div className="font-medium text-alarm">⚠ Privileged: it can act as you</div>
              {privilegedList.length > 0 && (
                <ul className="mt-1 list-disc pl-5">{privilegedList.map((f) => <li key={f.id}>{f.what}</li>)}</ul>
              )}
            </div>
          )}
          {other.length > 0 && (
            <div className="text-muted-foreground">It can also {other.map((f) => f.what).join(", ")}.</div>
          )}
          {p.findings.length === 0 && <div className="text-muted-foreground">No risky capabilities found by the scan.</div>}

          {needsName && (
            <form
              className="grid"
              onSubmit={(e) => { e.preventDefault(); if (nameOk && !busy) void approve(); }}
            >
              <label className="grid gap-1.5">
                <span>Type <b className="font-mono">{p.name}</b> to approve:</span>
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  disabled={busy !== null}
                />
              </label>
            </form>
          )}

          {busy === "approve" && <div className="text-muted-foreground">Waiting for the system admin prompt…</div>}
          {error && <div className="text-alarm">{error}</div>}
          {command && (
            <div className="grid gap-1.5">
              <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{command}</pre>
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(command)}>Copy sudo command</Button>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={() => void quarantine()}>
            {busy === "quarantine" ? "Quarantining…" : "Quarantine"}
          </Button>
          <Button disabled={!nameOk || busy !== null} onClick={() => void approve()}>
            {busy === "approve" ? "Authenticating…" : "Approve…"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
