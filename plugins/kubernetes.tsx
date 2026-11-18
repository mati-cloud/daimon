// Kubernetes for daimon: the current context and namespace as a status item, and a
// context switcher in the header (⌘J). Install with `daimon plugin add kubernetes`.
//
// Reads kubectl's own view of the config (KUBECONFIG from your shell, else
// ~/.kube/config) after every prompt, so `kubectl config use-context`, kubectx and the
// like show up right away. Switching runs `kubectl config use-context` in the focused tab.
import { useEffect, useRef, useState } from "react";
import {
  components, exec, focusComposer, onShellContext, registerHeaderButton, registerShortcut,
  registerStatusItem, runCommand, watchEnv,
} from "daimon";

const ICON = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHdpZHRoPSI4MDBweCIgaGVpZ2h0PSI4MDBweCIgdmlld0JveD0iMCAwIDE2IDE2IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiPjxwYXRoIGZpbGw9IiMzMjZERTYiIGQ9Ik00LjUgMTQuNTY5Yy4yMTQuMjc4LjUzOS40MzEuODc0LjQzMWg1LjI1MWMuMzM1IDAgLjY2LS4xNjUuODc1LS40MzRsMy4yNTgtNC4xNzhjLjIxNC0uMjc4LjI4OC0uNjMzLjIxNC0uOTc4bC0xLjE2NS01LjIwN2ExLjEyOCAxLjEyOCAwIDAwLS42MDYtLjc3N2wtNC43MTQtMi4zMUExLjA2MiAxLjA2MiAwIDAwOC4wMDIgMWMtLjE2OCAwLS4zMzUuMDM4LS40ODUuMTE1bC00LjcxNSAyLjMyYTEuMTI5IDEuMTI5IDAgMDAtLjYwNS43NzdMMS4wMzIgOS40MmMtLjA4NC4zNDUgMCAuNy4yMTQuOTc4TDQuNSAxNC41Njh6Ii8+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTIuNzQxIDkuMTI4Yy4wOTguMDAyLjE5Ni4wMS4yOTMuMDI0bC4wNTguMDEzLjAzMS4wMDhhLjMwOC4zMDggMCAwMS4yNi4zNzEuMzA2LjMwNiAwIDAxLS4zOTYuMjIzaC0uMDA0bC0uMDAzLS4wMDEtLjAwMy0uMDAyYTEuNTggMS41OCAwIDAwLS4wMy0uMDA2bC0uMDUtLjAxYTIuNTUgMi41NSAwIDAxLS4yNzQtLjEwNiAyLjg2NyAyLjg2NyAwIDAwLS41MzMtLjE1Ny4yNDIuMjQyIDAgMDAtLjE3MS4wNjQgNC42NTYgNC42NTYgMCAwMC0uMTMxLS4wMjMgMy45NzEgMy45NzEgMCAwMS0xLjc2NCAyLjIxMmMuMDE1LjA0Mi4wMzIuMDgzLjA1MS4xMjNhLjIzOS4yMzkgMCAwMC0uMDIzLjE4Yy4wNzQuMTcuMTY1LjMzMi4yNzEuNDg0LjA2LjA3OC4xMTQuMTYuMTY0LjI0NGwuMDI4LjA1Ny4wMTIuMDI1YS4zMDYuMzA2IDAgMDEtLjM4MS40NC4zMDguMzA4IDAgMDEtLjE3Mi0uMThsLS4wMS0uMDJhMS41NyAxLjU3IDAgMDEtLjAyOC0uMDU4IDIuNTQ2IDIuNTQ2IDAgMDEtLjA4OS0uMjggMi44MzcgMi44MzcgMCAwMC0uMjEtLjUxMi4yNDIuMjQyIDAgMDAtLjE1Ni0uMDk1bC0uMDMtLjA1My0uMDM1LS4wNjRhMy45NyAzLjk3IDAgMDEtMi44MjMtLjAwN2wtLjA3LjEyNWEuMjUuMjUgMCAwMC0uMTMyLjA2NCAyLjEzIDIuMTMgMCAwMC0uMjM3LjU0OCAyLjUxOCAyLjUxOCAwIDAxLS4wODguMjggMS4xOTYgMS4xOTYgMCAwMS0uMDI1LjA1bC0uMDEzLjAyN3YuMDAxYS4zMDYuMzA2IDAgMDEtLjQyMS4xNzMuMzA4LjMwOCAwIDAxLS4xNzMtLjMxNC4zMDYuMzA2IDAgMDEuMDQxLS4xMmwuMDE0LS4wMy4wMjYtLjA1MmMuMDUtLjA4NS4xMDQtLjE2Ni4xNjQtLjI0NC4xMDgtLjE1Ni4yLS4zMjIuMjc3LS40OTZhLjMwMi4zMDIgMCAwMC0uMDI4LS4xNzNsLjA1Ni0uMTMzQTMuOTcyIDMuOTcyIDAgMDE0LjIyIDkuNTMybC0uMTM0LjAyM2EuMzQuMzQgMCAwMC0uMTc2LS4wNjIgMi44NzEgMi44NzEgMCAwMC0uNTMzLjE1NmMtLjA5LjA0LS4xODEuMDc1LS4yNzQuMTA1YTEuMDE3IDEuMDE3IDAgMDEtLjA1LjAxMWwtLjAzLjAwN0gzLjAybC0uMDAyLjAwMmgtLjAwNWEuMzA4LjMwOCAwIDAxLS4zOTctLjM0OS4zMDYuMzA2IDAgMDEuMjYxLS4yNDVsLjAwNS0uMDAxaC4wMDJsLjAwNi0uMDAyYy4wMjQtLjAwNi4wNTQtLjAxNC4wNzYtLjAxOC4wOTctLjAxMy4xOTUtLjAyMS4yOTMtLjAyMy4xODYtLjAxMy4zNy0uMDQzLjU0OS0uMDlhLjQyMi40MjIgMCAwMC4xMzEtLjEzM2wuMTI4LS4wMzdhMy45MzggMy45MzggMCAwMS42MjUtMi43NTJsLS4wOTgtLjA4N2EuMzM4LjMzOCAwIDAwLS4wNjItLjE3NiAyLjg1NCAyLjg1NCAwIDAwLS40NTUtLjMxOSAyLjU1NyAyLjU1NyAwIDAxLS4yNTQtLjE0OGwtLjA0OC0uMDM4LS4wMTUtLjAxMy0uMDA0LS4wMDNhLjMyMy4zMjMgMCAwMS0uMDc2LS40NS4yOTUuMjk1IDAgMDEuMjQ0LS4xMDcuMzY1LjM2NSAwIDAxLjIxMy4wOGwuMDIyLjAxN2MuMDE2LjAxMy4wMzQuMDI2LjA0Ni4wMzcuMDcyLjA2Ny4xMzkuMTM5LjIwMi4yMTMuMTI1LjEzNy4yNjMuMjYyLjQxMi4zNzIuMDU2LjAzLjEyMS4wMzYuMTgyLjAxOGwuMTEuMDc4YTMuOTM4IDMuOTM4IDAgMDEyLjU1Mi0xLjIyNGwuMDA4LS4xMjlhLjMzMi4zMzIgMCAwMC4wOTktLjE1OCAyLjg0NCAyLjg0NCAwIDAwLS4wMzQtLjU1MyAyLjU2IDIuNTYgMCAwMS0uMDQyLS4yOXYtLjA4Mi0uMDA1QS4zMDYuMzA2IDAgMDE4IDIuODJhLjMwOC4zMDggMCAwMS4zMDYuMzM3di4wODdhMi41MjkgMi41MjkgMCAwMS0uMDQxLjI5IDIuODUgMi44NSAwIDAwLS4wMzUuNTUzLjI0Mi4yNDIgMCAwMC4xLjE1M3YuMDA3bC4wMDcuMTI5Yy45NjcuMDg4IDEuODcuNTIyIDIuNTQgMS4yMjNsLjExNi0uMDgyYS4zNC4zNCAwIDAwLjE4Ni0uMDJjLjE0OS0uMTEuMjg3LS4yMzYuNDEyLS4zNzMuMDYzLS4wNzUuMTMtLjE0Ni4yMDItLjIxM2wuMDUxLS4wNC4wMTctLjAxNGEuMzA3LjMwNyAwIDExLjM4MS40NzdsLS4wMjQuMDJjLS4wMTUuMDEyLS4wMy4wMjUtLjA0My4wMzRhMi41MzcgMi41MzcgMCAwMS0uMjU0LjE0OCAyLjg3IDIuODcgMCAwMC0uNDU1LjMyLjI0MS4yNDEgMCAwMC0uMDU4LjE3MmwtLjA1LjA0NC0uMDU4LjA1M2MuNTQyLjgwNi43NyAxLjc4My42MzcgMi43NDVsLjEyMy4wMzZjLjAzMS4wNTUuMDc3LjEwMS4xMzMuMTMyLjE3OS4wNDguMzYzLjA3OC41NDguMDl6TTcuMjkxIDUuMjRjLjEwNy0uMDI0LjIxNi0uMDQzLjMyNi0uMDU2bC0uMDkgMS42LS4wMDguMDA0YS4yNjguMjY4IDAgMDEtLjI5My4yNTYuMjcuMjcgMCAwMS0uMTM1LS4wNWwtLjAwMi4wMDEtMS4zMTYtLjkzYy40MTktLjQxLjk0NS0uNjk2IDEuNTE4LS44MjV6bTEuNjE4IDEuNzVsMS4zMDgtLjkyNGEzLjE4MiAzLjE4MiAwIDAwLTEuODMzLS44ODJsLjA5IDEuNTk4aC4wMDJhLjI2OC4yNjggMCAwMC4yOTQuMjU2LjI3LjI3IDAgMDAuMTM1LS4wNWwuMDA0LjAwMnptMi4yNDggMS42NTZMOS42MDkgOC4ybC0uMDAyLS4wMDZhLjI3LjI3IDAgMDEtLjE4NS0uMzQzLjI3LjI3IDAgMDEuMDgtLjEyTDkuNSA3LjczbDEuMTk1LTEuMDY3Yy4zNjYuNTk0LjUyNyAxLjI5LjQ2IDEuOTgzek05LjA5NiA5LjVsLjYxOCAxLjQ5YTMuMTQ4IDMuMTQ4IDAgMDAxLjI3NS0xLjU5OGwtMS41OTMtLjI2OS0uMDAyLjAwM2EuMjYuMjYgMCAwMC0uMTY2LjAyMy4yNy4yNyAwIDAwLS4xMy4zNDhsLS4wMDIuMDAzem0tLjM4NSAxLjkwNWMtLjU3My4xMy0xLjE3LjEtMS43MjctLjA4OGwuNzc3LTEuNGguMDAxYS4yNy4yNyAwIDAxLjQ3NS0uMDAxaC4wMDZsLjc3OSAxLjQwMmEzLjI4NiAzLjI4NiAwIDAxLS4zMTEuMDg3em0tMi40MTgtLjQyMmwuNjExLTEuNDc0LS4wMDQtLjAwNmEuMjY4LjI2OCAwIDAwLS4yOTctLjM3TDYuNiA5LjEzbC0xLjU3OS4yNjdhMy4xNiAzLjE2IDAgMDAxLjI3MiAxLjU4NnptLS45OTctNC4zMmwxLjIwMSAxLjA3MS0uMDAxLjAwN2EuMjY5LjI2OSAwIDAxLS4xMDYuNDYybC0uMDAxLjAwNS0xLjU0LjQ0M2EzLjEzNCAzLjEzNCAwIDAxLjQ0Ny0xLjk4OHptMi45NSAxLjE1NGgtLjQ5MmwtLjMwNy4zOC4xMS40NzYuNDQzLjIxMy40NDItLjIxMi4xMS0uNDc2LS4zMDYtLjM4MXoiIGNsaXAtcnVsZT0iZXZlbm9kZCIvPjwvc3ZnPg==";
const BLUE = "#326DE6";

// ── State shared by the status item and the switcher ────────────────────────────────────

type Kube = { context: string; namespace: string };

let kube: Kube | null = null;
/** False when kubectl is missing or has no config: everything stays hidden. */
let available = false;
let open = false;
let kubeconfig: string | undefined;
let cwd: string | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function useStore() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { kube, available, open };
}

const kubectlEnv = () => (kubeconfig ? { KUBECONFIG: kubeconfig } : undefined);

let seq = 0;
async function refresh() {
  const mine = ++seq;
  let next: Kube | null = null;
  let ok = false;
  try {
    const r = await exec(
      "kubectl",
      ["config", "view", "--minify", "-o", 'jsonpath={.current-context}{"\\n"}{..namespace}'],
      { env: kubectlEnv(), cwd, timeoutMs: 5000 },
    );
    ok = r.code === 0;
    const [context = "", namespace = ""] = r.stdout.split("\n");
    if (ok && context.trim()) next = { context: context.trim(), namespace: namespace.trim() || "default" };
  } catch {
    // kubectl not installed
  }
  if (mine !== seq) return; // a newer prompt already asked
  kube = next;
  available = ok || next !== null;
  notify();
}

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  notify();
  if (!next) focusComposer();
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function switchTo(name: string) {
  setOpen(false);
  runCommand(`kubectl config use-context ${shq(name)}`);
}

// ── Switcher ─────────────────────────────────────────────────────────────────────────────

function highlight(text: string, query: string) {
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-signal/20 text-signal not-italic">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function ContextSwitcher() {
  const { kube, available, open } = useStore();
  const [contexts, setContexts] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const load = async () => {
    setContexts(null);
    try {
      const r = await exec("kubectl", ["config", "get-contexts", "-o", "name"], { env: kubectlEnv(), cwd, timeoutMs: 5000 });
      if (r.code !== 0) throw new Error(r.stderr.trim() || `kubectl exited with ${r.code}`);
      setContexts(r.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
      setError("");
    } catch (e) {
      setContexts([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    setQ("");
    setCursor(0);
    setTimeout(() => input.current?.focus(), 0);
    const click = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", click);
    return () => window.removeEventListener("mousedown", click);
  }, [open]);

  const filtered = (contexts ?? []).filter((c) => !q || c.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => { setCursor(0); }, [q]);
  useEffect(() => { items.current[cursor]?.scrollIntoView({ block: "nearest" }); }, [cursor]);

  if (!available) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = filtered[cursor]; if (c) switchTo(c); }
    else if (e.key === "Escape") { e.preventDefault(); if (q) setQ(""); else setOpen(false); }
    e.stopPropagation();
  };

  const border = open ? "border-signal/60" : "border-border";
  const current = kube?.context ?? "";

  return (
    <div className="no-drag relative" ref={box}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Kubernetes context"
          aria-expanded={open}
          className={`flex items-center gap-2 border-y border-l bg-card/70 veil-surface py-1.5 pl-2.5 pr-3 glass transition-colors hover:border-signal/50 ${border}`}
        >
          <img src={ICON} alt="" className="size-3.5 shrink-0" />
          <span className={`font-mono text-[12px] ${current ? "text-foreground" : "text-muted-foreground"}`}>{current || "no context"}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Switch context (⌘J)"
          tabIndex={-1}
          className={`flex items-center border bg-card/70 veil-surface px-1.5 glass transition-colors hover:border-signal/50 ${border}`}
        >
          <components.Keys combo="⌘J" size="xs" />
        </button>
      </div>

      {open && (
        <div data-state="open" className="popover-panel absolute right-0 top-[calc(100%+0.5rem)] z-20 w-72 overflow-hidden rounded-xl border border-border bg-card/90 glass shadow-[0_24px_60px_-28px_oklch(0.2_0.02_265_/_0.45)]">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
            <input
              ref={input}
              value={q}
              onChange={(e: { target: HTMLInputElement }) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search contexts…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {contexts === null && <li className="px-3.5 py-2 font-mono text-[12px] text-muted-foreground">Loading…</li>}
            {contexts?.length === 0 && (
              <li className="px-3.5 py-2 font-mono text-[12px] text-muted-foreground">{error || "No contexts found"}</li>
            )}
            {contexts && contexts.length > 0 && filtered.length === 0 && (
              <li className="px-3.5 py-2 font-mono text-[12px] text-muted-foreground">No match</li>
            )}
            {filtered.map((c, i) => (
              <li key={c}>
                <button
                  type="button"
                  ref={(el: HTMLButtonElement | null) => { items.current[i] = el; }}
                  onClick={() => switchTo(c)}
                  onMouseMove={() => setCursor(i)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors ${i === cursor ? "bg-accent" : c === current ? "bg-accent/50" : "hover:bg-accent/40"}`}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${c === current ? "bg-signal" : "bg-muted-foreground/40"}`} />
                  <span className="font-mono text-[13px] text-foreground">{highlight(c, q)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Registration ─────────────────────────────────────────────────────────────────────────

export default function () {
  watchEnv("KUBECONFIG");

  registerStatusItem("kubernetes", () => {
    const { kube } = useStore();
    if (!kube) return null;
    return {
      icon: <img src={ICON} alt="" />,
      label: kube.context,
      detail: kube.namespace !== "default" ? kube.namespace : null,
      color: BLUE,
      title: "Kubernetes context (⌘J to switch)",
      onClick: () => setOpen(true),
    };
  });

  registerHeaderButton("kubernetes-context", ContextSwitcher);
  registerShortcut("kubernetes-switch", "mod+j", () => setOpen(!open));

  const off = onShellContext((ctx) => {
    kubeconfig = ctx.env?.KUBECONFIG;
    cwd = ctx.pwd;
    void refresh();
  });
  return () => { off(); open = false; };
}
