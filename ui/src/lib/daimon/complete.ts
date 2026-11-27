import { shell } from "./rpc";

export type SuggestionKind = "command" | "subcommand" | "flag" | "file" | "dir" | "git_branch" | "git_tag" | "git_remote" | "history" | "env_var" | "arg";
export type Suggestion = {
  value: string;
  label: string;
  hint: string;
  kind: SuggestionKind;
  score: number;
  replace: "token" | "all";
  ts?: number;
};

/** Current token at cursor — everything after the last unquoted space. */
export function currentToken(input: string): string {
  const trailing = /\s$/.test(input);
  if (trailing) return "";
  const parts = input.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Native completion via gc-suggest Rust engine.
 * Returns ranked suggestions for the full buffer at the cursor.
 */
export async function completeNative(
  input: string,
  cwd: string,
  history: string[] = [],
  historyTs: number[] = [],
  tabId?: string,
): Promise<{ items: Suggestion[]; token: string }> {
  const token = currentToken(input);

  const raw = await shell.completeNative(input, cwd, tabId).catch(() => []);
  const items: Suggestion[] = raw.map((s, i) => ({
    value: s.text,
    label: s.text,
    hint: s.description ?? kindHint(s.kind),
    kind: s.kind as SuggestionKind,
    score: raw.length - i, // preserve engine rank order
    replace: "token" as const,
  }));

  // Engine returns results already ranked: startsWith (tier 0) before contains (tier 1).
  // No additional client-side prefix filtering needed — pass all engine results through.
  const filtered = items;

  // Promote exact token match to top
  if (token) {
    const ltoken = token.toLowerCase();
    filtered.sort((a, b) => {
      const ae = a.value.toLowerCase() === ltoken ? 0 : 1;
      const be = b.value.toLowerCase() === ltoken ? 0 : 1;
      if (ae !== be) return ae - be;
      return 0;
    });
  }

  // History: full-input prefix matches, most-recent first, replace the whole line.
  // These take priority over filesystem completions so "cd pro" still shows "cd projects/daimon/".
  const lowerInput = input.toLowerCase();
  const historyItems: Suggestion[] = [];
  const seen = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.toLowerCase().startsWith(lowerInput) && h.length > input.length && !seen.has(h)) {
      seen.add(h);
      historyItems.push({
        value: h,
        label: h,
        hint: historyTs[i] ? new Date(historyTs[i]!).toLocaleDateString() : "",
        kind: "history" as const,
        score: history.length - i,
        replace: "all" as const,
        ...(historyTs[i] !== undefined ? { ts: historyTs[i] } : {}),
      });
    }
  }

  // History first (most specific/recent wins), then other completions
  const result = [...historyItems, ...filtered];

  return { items: result, token };
}

function kindHint(kind: string): string {
  switch (kind) {
    case "file": return "file";
    case "dir": return "dir";
    case "git_branch": return "branch";
    case "git_tag": return "tag";
    case "git_remote": return "remote";
    case "env_var": return "env";
    case "flag": return "flag";
    default: return "";
  }
}

export function applySuggestion(input: string, token: string, value: string, s: Suggestion) {
  if (s.replace === "all") return value;
  const head = token ? input.slice(0, input.length - token.length) : input;
  const needsQuote = /[\s'"\\]/.test(value);
  const safe = needsQuote ? `'${value.replace(/'/g, "'\\''")}'` : value;
  if ((s.kind === "file" || s.kind === "dir") && value.startsWith("-") && !head.includes(" -- ")) {
    return head + "-- " + safe;
  }
  return head + safe;
}
