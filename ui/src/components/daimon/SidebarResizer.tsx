/**
 * Drag handle on the sidebar's right edge. Drag to resize, double-click to reset.
 * The width is remembered per machine (localStorage: a view preference, not data).
 */
import { useRef } from "react";

const KEY = "daimon-sidebar-width";
export const SIDEBAR_DEFAULT = 224;
const MIN = 180;
const MAX = 480;

const clamp = (w: number) => Math.round(Math.min(MAX, Math.max(MIN, w)));

export function loadSidebarWidth(): number {
  try {
    const w = Number(localStorage.getItem(KEY));
    return w ? clamp(w) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function save(w: number) {
  try { localStorage.setItem(KEY, String(w)); } catch { /* not persisted: fine */ }
}

export function SidebarResizer({ width, onWidth, onDragging }: {
  width: number;
  onWidth: (w: number) => void;
  onDragging: (on: boolean) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);

  // Zero-width in the layout (no gap next to the sidebar); the invisible grab strip
  // overlaps the sidebar's own border, which stays the only thing you see.
  return (
    <div className="relative z-20 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to reset"
        className="no-drag absolute inset-y-0 -left-1 w-2 cursor-col-resize select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, w: width };
          onDragging(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          last.current = clamp(start.current.w + e.clientX - start.current.x);
          onWidth(last.current);
        }}
        onPointerUp={(e) => {
          if (!start.current) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          start.current = null;
          onDragging(false);
          save(last.current);
        }}
        onDoubleClick={() => { onWidth(SIDEBAR_DEFAULT); save(SIDEBAR_DEFAULT); }}
      />
    </div>
  );
}
