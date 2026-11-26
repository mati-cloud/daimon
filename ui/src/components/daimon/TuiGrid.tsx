import { memo } from "react";
import type { GridSnapshot } from "../../lib/daimon/headlessTerminal";

const FLAG_BOLD        = 1 << 0;
const FLAG_ITALIC      = 1 << 1;
const FLAG_FAINT       = 1 << 2;
const FLAG_STRIKE      = 1 << 5;
const FLAG_INVISIBLE   = 1 << 4;
const FLAG_WIDE        = 1 << 16;
const FLAG_SPACER_TAIL = 1 << 20;

// 0xBBGGRR → "rgb(r,g,b)" or "" for default (0).
function toRgb(c: number): string {
  if (!c) return "";
  const r = c & 0xff;
  const g = (c >> 8) & 0xff;
  const b = (c >> 16) & 0xff;
  return `rgb(${r},${g},${b})`;
}

// Relative luminance (0–1) of a 0xBBGGRR color.
function luminance(c: number): number {
  const r = (c & 0xff) / 255;
  const g = ((c >> 8) & 0xff) / 255;
  const b = ((c >> 16) & 0xff) / 255;
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// When fg and bg are identical (reverse video resolved both to same palette entry)
// or when fg is unset and bg is light, the text becomes unreadable.
// Return an auto-contrasting fg override, or null if no fix needed.
function autoContrastFg(fg: number, bg: number): string | null {
  if (!bg) return null; // transparent bg — text inherits fine
  const bgLum = luminance(bg);
  if (fg !== 0) {
    if (fg === bg) return bgLum > 0.5 ? "rgb(0,0,0)" : "rgb(255,255,255)";
    const fgLum = luminance(fg);
    const contrast = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);
    if (contrast < 2) return bgLum > 0.5 ? "rgb(0,0,0)" : "rgb(255,255,255)";
    return null;
  }
  // fg is default/inherited — check if bg would clash with typical inherited colors
  // (#cdd6f4 on dark, ~near-black on light). Use bg luminance to decide.
  if (bgLum > 0.7) return "rgb(15,15,20)"; // very light bg: force near-black text
  if (bgLum < 0.1) return "rgb(205,214,244)"; // very dark bg: force catppuccin text
  return null;
}

interface Props {
  snap: GridSnapshot;
  focused: boolean;
}

export const TuiGrid = memo(function TuiGrid({ snap, focused }: Props) {
  const { cells, cols, rows, cursorCol, cursorRow, cursorVisible, cursorStyle } = snap;

  // Find last row with any visible content (non-zero scalar or bg).
  // Cursor position is not used to inflate height — an idle cursor parked at row 23
  // (bottom of a 24-row PTY) would otherwise render 24 rows of empty space below content.
  let lastContentRow = 0;
  for (let r = 0; r < rows; r++) {
    const base = r * cols * 4;
    for (let c = 0; c < cols; c++) {
      const idx = base + c * 4;
      if (cells[idx] || cells[idx + 2]) { lastContentRow = r; break; }
    }
  }
  const renderRows = lastContentRow + 1;

  const rowEls: React.ReactNode[] = [];
  for (let r = 0; r < renderRows; r++) {
    const spans: React.ReactNode[] = [];
    let c = 0;
    while (c < cols) {
      const idx = (r * cols + c) * 4;
      const scalar = cells[idx]!;
      const fg     = cells[idx + 1]!;
      const bg     = cells[idx + 2]!;
      const flags  = cells[idx + 3]!;

      if (flags & FLAG_SPACER_TAIL) { c++; continue; }

      const isWide   = !!(flags & FLAG_WIDE);
      const isCursor = cursorVisible && focused && r === cursorRow && c === cursorCol;

      const isInvisible = !!(flags & FLAG_INVISIBLE);
      const fgCss = toRgb(fg); // "" = inherit (var(--foreground) via Tailwind class on container)
      const bgCss = toRgb(bg); // "" = transparent
      const contrastFg = !isCursor ? autoContrastFg(fg, bg) : null;

      const style: React.CSSProperties = {
        display: "inline-block",
        width: isWide ? "2ch" : "1ch",
        fontWeight:     flags & FLAG_BOLD   ? "bold"         : undefined,
        fontStyle:      flags & FLAG_ITALIC ? "italic"       : undefined,
        opacity:        (flags & FLAG_FAINT) && !isInvisible ? 0.5 : undefined,
        visibility:     isInvisible ? "hidden" : undefined,
        textDecoration: flags & FLAG_STRIKE ? "line-through" : undefined,
        color:           contrastFg ?? (fgCss || undefined),
        backgroundColor: bgCss || undefined,
        // Cursor overlays — block inverts cell, bar/underline use border.
        ...(isCursor && cursorStyle === 0 ? { backgroundColor: fgCss || "var(--foreground)", color: bgCss || "var(--background)" } : {}),
        ...(isCursor && cursorStyle === 1 ? { borderLeft: `2px solid ${fgCss || "var(--foreground)"}` } : {}),
        ...(isCursor && cursorStyle === 2 ? { borderBottom: `2px solid ${fgCss || "var(--foreground)"}` } : {}),
      };

      const ch = scalar ? String.fromCodePoint(scalar) : " ";
      spans.push(<span key={c} style={style}>{ch}</span>);
      c += isWide ? 2 : 1;
    }
    rowEls.push(<div key={r}>{spans}</div>);
  }

  // Match daimon's native SearchableOutput: font-mono text-[13px] leading-6 whitespace-pre
  return (
    <div className="font-mono text-[13px] leading-6 whitespace-pre select-text overflow-x-hidden w-full">
      {rowEls}
    </div>
  );
});
