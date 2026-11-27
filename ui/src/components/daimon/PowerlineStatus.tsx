import { GitBranch } from "lucide-react";
import { PowerlineSegment, StatusItemSlot } from "./HeaderExtension";

type Props = {
  gitBranch: string | null;
  gitDirty: boolean;
  gitAdded: number;
  gitRemoved: number;
  gitPending?: boolean;
};

// Flat, calm statusline: plugin status items, then git. Segments separated by whitespace,
// no fills or wedges. Hidden while nothing shows (`empty:hidden`).
export function PowerlineStatus({ gitBranch, gitDirty, gitAdded, gitRemoved, gitPending }: Props) {
  return (
    <div className="flex items-center gap-5 px-6 pt-4 pb-1 font-mono text-[12px] leading-none empty:hidden">
      <StatusItemSlot variant="powerline" />
      {gitPending && !gitBranch && (
        <span className="flex items-center gap-1.5 animate-pulse text-muted-foreground">
          <GitBranch className="size-3.5" strokeWidth={1.75} />
          <span className="h-2.5 w-16 rounded bg-current opacity-30" />
        </span>
      )}
      {gitBranch && (
        <PowerlineSegment
          icon={<GitBranch className={`size-3.5 ${gitDirty ? "text-amber" : "text-signal"}`} strokeWidth={1.75} />}
          value={<span className={gitDirty ? "text-amber" : "text-signal"}>{gitBranch}</span>}
        >
          {gitDirty && <span className="size-1.5 rounded-full bg-amber" />}
          {gitDirty && (gitAdded > 0 || gitRemoved > 0) && (
            <span className="flex items-center gap-1.5">
              {gitAdded > 0 && <span className="text-[oklch(0.78_0.17_150)]">+{gitAdded}</span>}
              {gitRemoved > 0 && <span className="text-[oklch(0.70_0.19_25)]">−{gitRemoved}</span>}
            </span>
          )}
        </PowerlineSegment>
      )}
    </div>
  );
}
