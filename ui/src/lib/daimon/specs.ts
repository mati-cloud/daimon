/// User-defined output specs: data-only JSON in ~/.config/daimon/specs/, served by the daemon
/// (specs.rs) and watched for changes. A spec says *when* to apply (a regex over the typed
/// command) and *how* to turn the command's plaintext output into one of daimon's existing
/// block shapes (table / pairs / lines). No code runs — hence no approval gate.
///
/// A spec file may be flat (`{match, render}`) or a unified tool file that also carries a
/// `completion` section for the Rust completion engine: `{name, completion:{…}, output:{match,
/// render}}`. This loader reads the `output` section (or the flat form); the completion engine
/// reads `completion`. One file can describe a tool for both.

import { useSyncExternalStore } from "react";
import { tableHeader, tableRow, type Out } from "./parse";

/** The output-render part of a spec: either the whole (flat) file or its `output` section. */
type SpecRender = {
  match?: { command?: string; firstLine?: string };
  render?: {
    kind?: "table" | "pairs" | "lines";
    /** Only keep lines after the first that matches this regex (until a blank line / EOF). */
    section?: string;
    /** How to break a line into cells. */
    split?: "whitespace" | "fields" | "indent" | "regex";
    /** For split "regex": a pattern whose capture groups become the cells. */
    pattern?: string;
    /** Column headers for kind "table". */
    columns?: string[];
    /** "first": use the output's first (captured) line as the table header. */
    header?: "first";
    /** Drop the output's first captured line (its own header) but use `columns` as the header. */
    skipHeader?: boolean;
  };
};

/** A whole spec file: a flat render spec, or a unified tool file with an `output` section.
 *  `completion` (read by the Rust engine) is accepted and ignored here. */
type SpecJson = SpecRender & { name?: string; output?: SpecRender; completion?: unknown };

type CompiledSpec = {
  name: string;
  match: (input: string, text: string) => boolean;
  toOut: (text: string) => Out | null;
};

/** The part of the output a spec acts on: after `section` (if given), blank lines dropped. */
function captured(text: string, sectionRe: RegExp | null): string[] {
  const all = text.split("\n");
  if (!sectionRe) return all.filter((l) => l.trim() !== "");
  const start = all.findIndex((l) => sectionRe.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < all.length; i++) {
    if (all[i]!.trim() === "") break; // section ends at the first blank line
    out.push(all[i]!);
  }
  return out;
}

/** One line → cells. `whitespace` uses the shared header-position slicer; `fields` splits on
 *  runs of spaces with the last column keeping the remainder; `indent` is first-gap split. */
function splitLine(line: string, mode: string, cols: number, starts: number[] | null, re: RegExp | null): string[] {
  if (mode === "regex" && re) {
    const m = re.exec(line);
    return m ? m.slice(1).map((c) => (c ?? "").trim()) : [line.trim()];
  }
  if (mode === "whitespace" && starts) return tableRow(starts, line);
  if (mode === "indent") {
    const m = line.match(/^(\s*\S+)(\s{2,})(.*)$/) ?? line.match(/^(\s*\S+)(\s+)(.*)$/);
    return m ? [m[1]!.trim(), m[3]!.trim()] : [line.trim()];
  }
  // fields: first cols-1 whitespace-separated tokens, last cell is the remainder.
  const parts = line.trim().split(/\s+/);
  if (cols <= 0 || parts.length <= cols) return parts;
  return [...parts.slice(0, cols - 1), parts.slice(cols - 1).join(" ")];
}

function compile(spec: SpecJson): CompiledSpec | null {
  const name = spec.name ?? "spec";
  // Unified tool files keep the render rules under `output`; flat files have them at the top.
  const rspec: SpecRender = spec.output ?? spec;
  if (!rspec.match && !rspec.render) return null; // completion-only file, nothing to render
  const cmdRe = rspec.match?.command ? new RegExp(rspec.match.command) : null;
  if (!cmdRe) throw new Error(`spec "${name}": match.command is required`);
  const firstLineRe = rspec.match?.firstLine ? new RegExp(rspec.match.firstLine) : null;
  const r = rspec.render ?? {};
  const kind = r.kind ?? "table";
  const sectionRe = r.section ? new RegExp(r.section) : null;
  const splitRe = r.split === "regex" && r.pattern ? new RegExp(r.pattern) : null;
  const split = r.split ?? "whitespace";

  const match = (input: string, text: string) =>
    cmdRe.test(input.trim()) && (!firstLineRe || firstLineRe.test(text.split("\n").find((l) => l.trim())?.trim() ?? ""));

  const toOut = (text: string): Out | null => {
    let lines = captured(text, sectionRe);
    if (lines.length === 0) return null;

    if (kind === "lines") return { kind: "lines", lines };

    // Derive a header: the output's own first line, or the spec's declared columns.
    let head = r.columns ?? null;
    if (r.header === "first") {
      head = (tableHeader(lines[0]!)?.names) ?? lines[0]!.trim().split(/\s+/);
      lines = lines.slice(1);
    } else if (r.skipHeader) {
      lines = lines.slice(1); // its own header line; `columns` names the table instead
    }
    const cols = head?.length ?? 0;
    const starts = split === "whitespace" ? tableHeader(lines[0] ?? "")?.starts ?? null : null;
    const rows = lines.map((l) => splitLine(l, split, cols, starts, splitRe)).filter((cells) => cells.some((c) => c));
    if (rows.length === 0) return null;

    if (kind === "pairs") {
      return { kind: "pairs", pairs: rows.map((cells) => [cells[0] ?? "", cells.slice(1).join(" ")] as [string, string]) };
    }
    const names = head ?? rows[0]!.map((_, i) => `COL ${i + 1}`);
    return { kind: "table", head: names, rows, accentCol: names.length - 1 };
  };

  return { name, match, toOut };
}

let specs: CompiledSpec[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** Bumps when specs reload, so views using applySpec re-render. */
export const useSpecsVersion = (): number =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => version, () => version);

/** The first spec that matches `input`+`text`, as a replacement Out, or null for none. */
export function applySpec(input: string, text: string): Out | null {
  for (const s of specs) {
    if (!s.match(input, text)) continue;
    try {
      const out = s.toOut(text);
      if (out) return out;
    } catch (e) {
      console.warn(`[specs] ${s.name} failed:`, e);
    }
  }
  return null;
}

async function reload() {
  try {
    const { shell } = await import("./rpc");
    const { toast } = await import("sonner");
    const entries = await shell.specList();
    const next: CompiledSpec[] = [];
    for (const e of entries) {
      try {
        const c = compile(JSON.parse(e.source) as SpecJson);
        if (c) next.push({ ...c, name: e.name });
      } catch (err) {
        console.warn(`[specs] ${e.name}:`, err);
        toast.error(`Spec "${e.name}" is invalid`, { id: `spec-error-${e.name}`, description: err instanceof Error ? err.message : String(err) });
      }
    }
    specs = next;
    version++;
    listeners.forEach((fn) => fn());
  } catch (e) {
    console.warn("[specs] could not load specs:", e);
  }
}

/** Load specs and follow file changes (the daemon watches ~/.config/daimon/specs/). */
export async function loadSpecs() {
  const { shell } = await import("./rpc");
  shell.onSpecsChanged(() => { void reload(); });
  await reload();
}

/** Test helper: compile a spec object and return its match/toOut, bypassing the daemon. */
export function compileForTest(spec: SpecJson) {
  return compile(spec);
}
