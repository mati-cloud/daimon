/**
 * Toasts in daimon's type system: Geist for the message (it's prose, meant to be read),
 * Geist Mono only for the chrome (action buttons, like the app's uppercase labels).
 * The kind shows as a small tinted icon tile (signal = ok/info, amber = warning,
 * alarm = error), not as coloured text. Sonner's own styling is off (`unstyled`):
 * everything is the app's theme tokens, so light/dark just follow.
 */
import { Toaster } from "sonner";
import { CheckIcon, InfoIcon, TriangleAlertIcon, XIcon, LoaderIcon } from "lucide-react";

const tile = "flex size-6 shrink-0 items-center justify-center [&>svg]:size-3.5";

export function DaimonToaster() {
  return (
    <Toaster
      // Top-right, under the title bar: clear of the command input at the bottom.
      position="top-right"
      offset={{ top: 48, right: 16 }}
      gap={8}
      visibleToasts={4}
      icons={{
        success: <span className={`${tile} bg-signal/12 text-signal`}><CheckIcon strokeWidth={2.5} /></span>,
        info: <span className={`${tile} bg-signal/12 text-signal`}><InfoIcon strokeWidth={2.25} /></span>,
        warning: <span className={`${tile} bg-amber/15 text-amber`}><TriangleAlertIcon strokeWidth={2.25} /></span>,
        error: <span className={`${tile} bg-alarm/12 text-alarm`}><XIcon strokeWidth={2.5} /></span>,
        loading: <span className={`${tile} bg-muted text-muted-foreground`}><LoaderIcon className="animate-spin" /></span>,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group flex w-[360px] items-center gap-3 " +
            "border border-border bg-popover/90 px-3 py-2.5 text-popover-foreground backdrop-blur-xl " +
            "shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset,0_16px_40px_-20px_oklch(0.1_0.02_265_/_0.5)]",
          icon: "flex shrink-0 self-start",
          content: "flex min-w-0 flex-1 flex-col gap-0.5 py-[3px]",
          title: "font-sans text-[13px] font-medium leading-[18px] tracking-[-0.005em] break-words",
          description:
            "font-sans text-[12px] leading-[17px] text-muted-foreground whitespace-pre-line break-words line-clamp-3",
          actionButton:
            "no-drag shrink-0 border border-border px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider " +
            "text-foreground transition-colors hover:bg-accent",
          cancelButton:
            "no-drag shrink-0 px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground hover:text-foreground",
          closeButton: "hidden",
        },
      }}
    />
  );
}
