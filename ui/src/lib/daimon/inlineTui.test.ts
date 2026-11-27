import { expect, test, describe } from "bun:test";
import { InlineTuiBuffer } from "./inlineTui";

// Real byte stream captured from prompt_toolkit 3.0.53 (full_screen=False, PROMPT_TOOLKIT_NO_CPR=1)
// under an 80-col PTY: initial frame (4 items, "> Choose for me"), two down-arrow redraws
// (incremental, cursor-move only), final full repaint ("> Port B"), then teardown (\x1b[?2004l).
// The bug: every redraw stacked into the block, printing the menu 2-3 times with garbled
// incremental diffs between. Fix: replay the whole stream through the terminal emulator so the
// final frame's in-place overwrites land correctly → one clean copy.
const STREAM =
  "\x1b[?12l\x1b[?25h\x1b[?2004h\x1b[?1l\x1b[?25l\x1b[0m\x1b[?7l\x1b[0m\x1b[J\x1b[0mSelect device / port to check:\x1b[0m\r\r\n\r\r\n\x1b[0m  > Choose for me\x1b[0m\r\r\n\x1b[0m    Port A\x1b[0m\r\r\n\x1b[0m    Port B\x1b[0m\r\r\n\x1b[0m    Port C\x1b[0m\r\r\n\x1b[0m \x08\x1b[6A\x1b[?7h\x1b[0m\x1b[?12l\x1b[?25h\x1b[?25l\x1b[?7l\x1b[0m\r\r\n\r\r\n\x1b[2C\x1b[0m \x1b[0m\r\r\n\x1b[2C\x1b[0m>\x1b[3A\x1b[3D\x1b[?7h\x1b[0m\x1b[?12l\x1b[?25h\x1b[?25l\x1b[?7l\x1b[0m\r\r\n\r\r\n\r\r\n\x1b[2C\x1b[0m \x1b[0m\r\r\n\x1b[2C\x1b[0m>\x1b[4A\x1b[3D\x1b[?7h\x1b[0m\x1b[?12l\x1b[?25h\x1b[?25l\x1b[?7l\x1b[0m\x1b[J\x1b[0mSelect device / port to check:\x1b[0m\r\r\n\r\r\n\x1b[0m    Choose for me\x1b[0m\r\r\n\x1b[0m    Port A\x1b[0m\r\r\n\x1b[0m  > Port B\x1b[0m\r\r\n\x1b[0m    Port C\x1b[0m\r\r\n\x1b[0m \x08\x1b[0m\r\r\n\x1b[J\x1b[?7h\x1b[0m\x1b[?12l\x1b[?25h\x1b[?2004l";

const EXPECTED =
  "Select device / port to check:\n\n    Choose for me\n    Port A\n  > Port B\n    Port C\n";

describe("InlineTuiBuffer", () => {
  test("renders exactly one clean copy when all frames arrive in one chunk", () => {
    const b = new InlineTuiBuffer(80);
    b.feed(STREAM);
    const out = b.flush();
    expect(out).toBe(EXPECTED);
    // The menu header must appear exactly once (the bug tripled it).
    expect(out.match(/Select device/g)!.length).toBe(1);
  });

  test("renders one clean copy when each frame is its own chunk (the real bug)", () => {
    const b = new InlineTuiBuffer(80);
    // Split on frame boundaries (\x1b[?25l) to simulate per-write daemon delivery.
    for (const part of STREAM.split(/(?=\x1b\[\?25l)/)) b.feed(part);
    expect(b.flush()).toBe(EXPECTED);
  });

  test("flush is idempotent — a second flush yields nothing", () => {
    const b = new InlineTuiBuffer(80);
    b.feed(STREAM);
    b.flush();
    expect(b.flush()).toBe("");
  });
});
