import React from "react";
import { useHeaderButtons, useStatusItems, reportPluginError, type UseStatusItem } from "@/lib/daimon/plugins";

/** Keeps a crashing plugin button from taking the header down with it. */
class PluginBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(err: unknown) { reportPluginError(this.props.id, err); }
  override render() { return this.state.failed ? null : this.props.children; }
}

/** Renders all plugin-registered header buttons. Drop this into the header right-side area. */
export function HeaderButtonSlot() {
  const buttons = useHeaderButtons();
  return (
    <>
      {buttons.map(({ id, render: R }) => (
        <PluginBoundary key={id} id={id}>{typeof R === "function" ? <R /> : R}</PluginBoundary>
      ))}
    </>
  );
}

export type StatusVariant = "badge" | "powerline";

/** Plugin status items, drawn as header badges or powerline segments. */
export function StatusItemSlot({ variant }: { variant: StatusVariant }) {
  const items = useStatusItems();
  return (
    <>
      {items.map(({ id, use, serial }) => (
        <PluginBoundary key={`${id}:${serial}`} id={id}><StatusItemHost use={use} variant={variant} /></PluginBoundary>
      ))}
    </>
  );
}

function StatusItemHost({ use, variant }: { use: UseStatusItem; variant: StatusVariant }) {
  const item = use();
  if (!item) return null;
  const { icon, label, detail, color, title, onClick } = item;
  const clickable = onClick ? { onClick, role: "button", tabIndex: 0 } : {};
  if (variant === "powerline") {
    return (
      <PowerlineSegment icon={icon} value={label} sub={detail} title={title} className={onClick ? "cursor-pointer" : ""} {...clickable} />
    );
  }
  return (
    <div
      title={title}
      {...clickable}
      className={`flex items-center gap-2.5 rounded-md border border-border/40 bg-card/60 veil-surface px-2.5 py-1 ${onClick ? "no-drag cursor-pointer hover:border-border" : ""}`}
    >
      {icon && <span className="flex size-3.5 shrink-0 items-center [&>*]:size-3.5">{icon}</span>}
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        <span className="font-medium" style={color ? { color } : undefined}>{label}</span>
        {detail != null && detail !== "" && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-foreground/80">{detail}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Flat, calm statusline segment: glyph + value, optional sub joined with a muted "·". */
export function PowerlineSegment({ icon, value, sub, children, ...rest }: { icon?: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={`flex items-center gap-2 ${rest.className ?? ""}`}>
      {icon && <span className="flex items-center text-muted-foreground/60 [&>img]:size-3.5 [&>svg]:size-3.5">{icon}</span>}
      <span className="text-foreground/80">{value}</span>
      {sub != null && sub !== "" && <span className="text-muted-foreground/40">· {sub}</span>}
      {children}
    </span>
  );
}
