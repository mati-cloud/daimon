import { expect, test } from "bun:test";
import { normalizeTerminal, parseOutput } from "./parse";

// Queries and mode resets a full-screen program prints around its session (Claude Code:
// XTVERSION, DA1, modifyOtherKeys reset, kitty keyboard pop) must not show as text.
test("private-marker CSI sequences are stripped, colours kept", () => {
  const html = JSON.stringify(parseOutput("\x1b[>0q\x1b[c\x1b[>4m\x1b[<u\x1b[31mred\x1b[0m done\n", "claude"));
  expect(html).not.toContain("\\u001b");
  expect(html).toContain("color:#ff3b30");
  expect(normalizeTerminal("a\x1b[>4m\x1b[Kb\r")).not.toContain("\x1b[>");
});
