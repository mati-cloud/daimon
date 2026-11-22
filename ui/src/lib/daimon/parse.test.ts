import { expect, test } from "bun:test";
import { normalizeTerminal, parseOutput, OutputStream } from "./parse";

// Queries and mode resets a full-screen program prints around its session (Claude Code:
// XTVERSION, DA1, modifyOtherKeys reset, kitty keyboard pop) must not show as text.
test("private-marker CSI sequences are stripped, colours kept", () => {
  const html = JSON.stringify(parseOutput("\x1b[>0q\x1b[c\x1b[>4m\x1b[<u\x1b[31mred\x1b[0m done\n", "claude"));
  expect(html).not.toContain("\\u001b");
  expect(html).toContain("color:#ff3b30");
  expect(normalizeTerminal("a\x1b[>4m\x1b[Kb\r")).not.toContain("\x1b[>");
});

// A table printed after a preamble banner (kubectl via a wrapper that logs first) still renders
// as a table, with the banner kept as a leading lines block.
test("table after a preamble banner is detected", () => {
  const raw =
    "Syncing kubeconfig with registry\n" +
    "NAME    STATUS   ROLES          AGE   VERSION\n" +
    "kcp-1   Ready    control-plane  25d   v1.34.8\n" +
    "wrk-1   Ready    <none>         25d   v1.34.8\n";
  const out = parseOutput(raw, "u8s kubectl get nodes");
  const table = out.find((o) => o.kind === "table");
  expect(table).toBeDefined();
  expect((table as { head: string[] }).head).toEqual(["NAME", "STATUS", "ROLES", "AGE", "VERSION"]);
  expect((table as { rows: string[][] }).rows.length).toBe(2);
  expect(out.some((o) => o.kind === "lines")).toBe(true);
});

// Same, through the streaming parser (the live-render path).
test("table after a preamble banner is detected while streaming", () => {
  const raw =
    "Syncing kubeconfig with registry\n" +
    "NAME    STATUS   ROLES          AGE   VERSION\n" +
    "kcp-1   Ready    control-plane  25d   v1.34.8\n" +
    "wrk-1   Ready    <none>         25d   v1.34.8\n";
  const s = new OutputStream("u8s kubectl get nodes");
  s.push(raw);
  const out = s.snapshot(raw, undefined, true);
  const table = out.find((o) => o.kind === "table");
  expect(table).toBeDefined();
  expect((table as { rows: string[][] }).rows.length).toBe(2);
});


