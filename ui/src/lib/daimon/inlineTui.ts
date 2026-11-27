import { renderScreen } from "./screen";

// Rebuilds the final frame of a prompt_toolkit inline (full_screen=False) menu from the raw
// PTY stream, so the block shows ONE clean copy instead of every redraw stacked up.
//
// prompt_toolkit repaints by moving the cursor up over the previous frame and overwriting in
// place — it never erases whole lines. Reconstructing that from bytes needs a real terminal
// emulator, which renderScreen already is. So: buffer the raw bytes, and on flush replay them
// through renderScreen at the PTY's actual width (prompt_toolkit hard-wraps at that width; a
// mismatch loses the wrapped tail of long lines).
export class InlineTuiBuffer {
  private raw = "";
  constructor(private cols = 0) {}
  feed(data: string): void { this.raw += data; }
  /** The final rendered screen as clean text (trailing newline), or "" if empty. */
  flush(): string {
    const out = renderScreen(this.raw, this.cols).replace(/\n+$/, "");
    this.raw = "";
    return out.trim() ? out + "\n" : "";
  }
}
