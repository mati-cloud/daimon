import React from "react";
import openstackIcon from "@/assets/openstack-icon.svg";
import { useHeaderButtons, reportPluginError } from "@/lib/daimon/plugins";

export function HeaderExtensionSlot({ extensions }: { extensions: React.ReactNode[] }) {
  return <>{extensions.map((e, i) => <React.Fragment key={i}>{e}</React.Fragment>)}</>;
}

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

export function OpenStackBadge({ region, project, domain }: { region: string | null; project: string | null; domain?: string | null }) {
  if (!region) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border/40 bg-card/60 px-2.5 py-1">
      <img src={openstackIcon} alt="OpenStack" className="size-3.5 shrink-0" style={{ filter: "brightness(0) saturate(100%) invert(20%) sepia(90%) saturate(4000%) hue-rotate(340deg) brightness(90%)" }} />
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        <span className="text-[#DA1A32]/90 font-medium">{region}</span>
        {project && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-foreground/80">{domain ?? ""}{domain ? "/" : ""}{project}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Placeholder — k8s context removed from landing page but slot kept for future use
export function K8sBadge(_props: { context?: string | null; namespace?: string | null }) {
  return null;
}
