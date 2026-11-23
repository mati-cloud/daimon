// Types for daimon plugins: editor autocomplete and checking only, nothing here runs.
// Written by `daimon plugin init`, which overwrites it to match the installed daimon.
// Source of truth: ui/src/lib/daimon/plugins.ts (`pluginApi`).

declare module "daimon" {
  import type { ComponentType, ReactNode, createElement } from "react";

  export type ExecResult = { code: number | null; stdout: string; stderr: string };

  /** The focused shell's state at its last prompt. */
  export type ShellContext = {
    pwd?: string;
    exitCode?: number;
    gitBranch?: string;
    gitDirty?: boolean;
    gitAhead?: number;
    gitBehind?: number;
    gitAdded?: number;
    gitRemoved?: number;
    /** Values of the env vars asked for with `watchEnv` that are set in the shell. */
    env?: Record<string, string>;
  };

  /** A status item: a header badge or a powerline segment, per the user's settings. */
  export type StatusItem = {
    /** Small icon, e.g. <img src="data:image/svg+xml;base64,…" /> or an inline <svg>. */
    icon?: ReactNode;
    label: ReactNode;
    /** Secondary text after a muted "·". */
    detail?: ReactNode;
    /** Label color in the badge style (any CSS color). */
    color?: string;
    title?: string;
    onClick?: () => void;
  };
  type Toast = (message: string, opts?: { description?: string; duration?: number; id?: string }) => string | number;

  /** API version; bumped on breaking changes. */
  export const version: number;
  export const React: typeof import("react");
  export const h: typeof createElement;
  /** JSX-like tagged templates for plain .js plugins: html`<b onClick=${fn}>${x}</b>`. */
  export function html(strings: TemplateStringsArray, ...values: unknown[]): ReactNode;
  /** Put a button/badge into the header's right side. Registering an id again replaces it. */
  export function registerHeaderButton(id: string, render: ComponentType | ReactNode): void;
  /** Add a status item. `use` runs while rendering, so it may call hooks (e.g.
   *  useShellContext); return null to show nothing. Registering an id again replaces it. */
  export function registerStatusItem(id: string, use: () => StatusItem | null): void;
  /** Global keyboard shortcut, e.g. "mod+j", "mod+shift+k", "alt+1" (`mod` = ⌘ or Ctrl).
   *  Wins over daimon's own shortcuts. Registering an id again replaces it. */
  export function registerShortcut(id: string, combo: string, handler: (e: KeyboardEvent) => void): void;
  /** The focused shell's prompt context; re-renders after every prompt. */
  export function useShellContext(): ShellContext;
  /** Calls `fn` now and after every prompt of the focused shell. Returns an unsubscribe. */
  export function onShellContext(fn: (ctx: ShellContext) => void): () => void;
  /** Calls `fn` after a command completes (prompt follows a commandStart) in the focused
   *  shell. Unlike onShellContext, does not fire on registration or tab-switch. Returns an unsubscribe. */
  export function onCommandComplete(fn: (ctx: ShellContext) => void): () => void;
  /** Have the shell report these env vars in `ShellContext.env` (from the next prompt on).
   *  Only the names asked for leave the shell. */
  export function watchEnv(names: string | string[]): void;
  /** Run a command line in the focused tab, as if typed. */
  export function runCommand(command: string): void;
  /** Move keyboard focus back to the focused tab's command input. */
  export function focusComposer(): void;
  /** Run a program (no shell). Rejects on spawn failure or timeout (default 10 s). `env`
   *  adds variables, e.g. the shell's KUBECONFIG from `useShellContext().env`. */
  export function exec(cmd: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult>;
  /** Persistent key/value strings (shared with daimon's own prefs: prefix your keys). */
  export function prefGet(key: string): Promise<string | null>;
  export function prefSet(key: string, value: string): Promise<boolean>;
  /** Register a settings panel under Settings → Plugins. `render` is a React component (no props). */
  export function registerSettingsPanel(id: string, label: string, render: ComponentType): void;
  /** Open an http(s) URL in the system browser. */
  export function openUrl(url: string): void;
  /** daimon's keyboard-hint chips: <Keys combo="⌘⇧T" size="xs" />. */
  export const components: {
    Keys: ComponentType<{ combo: string; size?: "xs" | "sm" | "md"; className?: string }>;
    Kbd: ComponentType<{ children?: ReactNode; size?: "xs" | "sm" | "md"; className?: string }>;
  };
  export const toast: Toast & { success: Toast; error: Toast; warning: Toast; info: Toast; dismiss(id?: string | number): void };

  /** What a default export receives (the same as this module's exports). */
  export type DaimonPluginApi = typeof import("daimon");
  /** Optional default export: may return a cleanup, called before a reload/removal. */
  export type Plugin = (daimon: DaimonPluginApi) => void | (() => void) | Promise<void | (() => void)>;
}

// Minimal React types, enough for plugins without installing @types/react.
// (Delete this block if you install @types/react in this folder.)
declare module "react" {
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
  export interface ReactElement { type: unknown; props: unknown; key: string | null }
  export type ComponentType<P = {}> = (props: P) => ReactNode;
  export type FC<P = {}> = ComponentType<P>;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface RefObject<T> { current: T }
  export type DependencyList = readonly unknown[];

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: DependencyList): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: DependencyList): void;
  export function useRef<T>(initial: T): RefObject<T>;
  export function useMemo<T>(factory: () => T, deps: DependencyList): T;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: DependencyList): T;
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
  export function useId(): string;
  export function createElement(type: unknown, props?: unknown, ...children: ReactNode[]): ReactElement;
  export const Fragment: ComponentType<{ children?: ReactNode }>;
}

declare module "react/jsx-runtime" {
  import type { ReactElement, ReactNode } from "react";
  export namespace JSX {
    type Element = ReactElement;
    /** Components may return any ReactNode (string, null, …), not only elements. */
    type ElementType = string | ((props: any) => ReactNode);
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: string | number | null }
    interface IntrinsicElements { [tag: string]: Record<string, any> }
  }
  export function jsx(type: unknown, props: unknown, key?: string): ReactElement;
  export const jsxs: typeof jsx;
  export const Fragment: unknown;
}
