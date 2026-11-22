import { expect, test } from "bun:test";
import { compileForTest } from "./specs";

// A Click-style `--help`: capture the Commands: section, split each line at its indent gap.
test("spec recasts a Commands: section into a 2-col table", () => {
  const spec = compileForTest({
    name: "cld-help",
    match: { command: "^cld\\s+(--help|-h)$" },
    render: { kind: "table", section: "^Commands:", columns: ["COMMAND", "DESCRIPTION"], split: "indent" },
  })!;
  const text = [
    "Usage: ccloud-multitool [OPTIONS] COMMAND [ARGS]...",
    "",
    "Commands:",
    "  admin                     Set domain and project for admin use",
    "  clear                     Clear out all known variables.",
    "",
  ].join("\n");

  expect(spec.match("cld --help", text)).toBe(true);
  expect(spec.match("cld list-regions", text)).toBe(false);

  const out = spec.toOut(text);
  expect(out?.kind).toBe("table");
  const t = out as { head: string[]; rows: string[][] };
  expect(t.head).toEqual(["COMMAND", "DESCRIPTION"]);
  expect(t.rows).toEqual([
    ["admin", "Set domain and project for admin use"],
    ["clear", "Clear out all known variables."],
  ]);
});

// The shipped df spec: declared columns, rows split into fields with the mount path kept whole.
test("df spec names columns and keeps the mount path whole", () => {
  const spec = compileForTest({
    name: "df",
    match: { command: "^df(\\s|$)" },
    render: { kind: "table", columns: ["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"], split: "fields", skipHeader: true },
  })!;
  const text = [
    "Filesystem      Size  Used Avail Use% Mounted on",
    "/dev/disk3s1s1  926G   10G  300G   4% /",
  ].join("\n");

  expect(spec.match("df -h", text)).toBe(true);
  const out = spec.toOut(text) as { head: string[]; rows: string[][] };
  expect(out.head).toEqual(["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"]);
  expect(out.rows[0]).toEqual(["/dev/disk3s1s1", "926G", "10G", "300G", "4%", "/"]);
});

// A non-matching command yields nothing.
test("spec does not fire on an unrelated command", () => {
  const spec = compileForTest({ name: "x", match: { command: "^onlythis$" }, render: { kind: "lines" } })!;
  expect(spec.match("ls -la", "whatever")).toBe(false);
});

// A unified tool file keeps the render rules under `output`; the loader reads that section.
test("unified file renders from its output section", () => {
  const spec = compileForTest({
    name: "cld",
    completion: { name: "cld", subcommands: [{ name: "list-regions" }] },
    output: { match: { command: "^cld\\s+--help$" }, render: { kind: "lines" } },
  })!;
  expect(spec.match("cld --help", "x")).toBe(true);
  expect(spec.toOut("a\nb")?.kind).toBe("lines");
});

// A completion-only file has nothing to render → compile returns null.
test("completion-only file compiles to null", () => {
  const spec = compileForTest({ name: "cld", completion: { name: "cld" } });
  expect(spec).toBeNull();
});
