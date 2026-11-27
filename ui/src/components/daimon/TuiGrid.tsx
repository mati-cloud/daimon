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
  if (!bg) {
    // Transparent bg — check if fg is too light to read on a light page background.
    // White (0xffffff) or near-white fg on transparent would be invisible in light theme.
    if (fg && luminance(fg) > 0.7) return "inherit";
    return null;
  }
  const bgLum = luminance(bg);
  if (fg !== 0) {
    if (fg === bg) return bgLum > 0.5 ? "rgb(0,0,0)" : "rgb(255,255,255)";
    const fgLum = luminance(fg);
    const contrast = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);
    if (contrast < 2) return bgLum > 0.5 ? "rgb(0,0,0)" : "rgb(255,255,255)";
    return null;
  }
  if (bgLum > 0.7) return "rgb(15,15,20)";
  if (bgLum < 0.1) return "rgb(205,214,244)";
  return null;
}

interface Props {
  snap: GridSnapshot;
  focused: boolean;
}

export const TuiGrid = memo(function TuiGrid({ snap, focused }: Props) {
  const { cells, cols, rows, cursorCol, cursorRow, cursorVisible, cursorStyle } = snap;

  // Find last row with real content (non-space scalar or explicit bg).
  let lastRow = 0;
  for (let r = 0; r < rows; r++) {
    const base = r * cols * 4;
    for (let c = 0; c < cols; c++) {
      const idx = base + c * 4;
      const sc = cells[idx]!;
      const bg = cells[idx + 2]!;
      if ((sc && sc !== 32) || bg) { lastRow = r; break; }
    }
  }

  // Clamp to cursorRow and isolate current frame when cursor is significantly above
  // last content — signals an inline TUI redrawing via cursor-up (prompt_toolkit).
  // Threshold of 3: cursor must be at least 3 rows above lastRow to trigger isolation.
  const frameBottom = (cursorVisible && lastRow - cursorRow >= 3)
    ? cursorRow
    : lastRow;

  // Find frameTop: scan backward from frameBottom looking for a gap of ≥3 consecutive
  // blank rows — the separator between the current frame and stale prior redraws.
  // ≥3 to skip the single blank row between "Select device..." and the input box.
  let frameTop = 0;
  if (frameBottom < lastRow) {
    let blankRun = 0;
    for (let r = frameBottom; r > 0; r--) {
      const base = r * cols * 4;
      let rowBlank = true;
      for (let c = 0; c < cols; c++) {
        const idx = base + c * 4;
        const sc = cells[idx]!;
        const bg = cells[idx + 2]!;
        if ((sc && sc !== 32) || bg) { rowBlank = false; break; }
      }
      if (rowBlank) { blankRun++; if (blankRun >= 3) { frameTop = r + blankRun; break; } }
      else blankRun = 0;
    }
  }

  const renderRows = Math.max(0, frameBottom - frameTop + 1);

  const rowEls: React.ReactNode[] = [];
  for (let ri = 0; ri < renderRows; ri++) {
    const r = frameTop + ri;
    const spans: React.ReactNode[] = [];
    let c = 0;
    while (c < cols) {
      const idx = (r * cols + c) * 4;
      const scalar = cells[idx]!;
      const fg     = cells[idx + 1]!;
      const bg     = cells[idx + 2]!;
      const flags  = cells[idx + 3]!;

      if (flags & FLAG_SPACER_TAIL) { c++; continue; }

      const isCursor = cursorVisible && focused && r === cursorRow && c === cursorCol;

      // Visually empty: null/space scalar, no bg, no visible flags, no cursor.
      // Batch into one unstyled text node — no span overhead, no color noise.
      const VISIBLE_FLAGS = FLAG_BOLD | FLAG_ITALIC | FLAG_FAINT | FLAG_STRIKE | FLAG_INVISIBLE;
      const isBlankChar = !scalar || scalar === 32;
      if (!isCursor && isBlankChar && !bg && !(flags & VISIBLE_FLAGS)) {
        let run = 1;
        while (c + run < cols) {
          const ni = (r * cols + c + run) * 4;
          const ns = cells[ni]!;
          if ((ns && ns !== 32) || cells[ni + 2]! || (cells[ni + 3]! & VISIBLE_FLAGS) ||
              (cursorVisible && focused && r === cursorRow && c + run === cursorCol)) break;
          run++;
        }
        spans.push(" ".repeat(run));
        c += run;
        continue;
      }

      const isWide   = !!(flags & FLAG_WIDE);
      const isInvisible = !!(flags & FLAG_INVISIBLE);
      const fgCss = toRgb(fg);
      const bgCss = toRgb(bg);
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
