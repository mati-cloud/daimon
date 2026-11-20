// Link previews: Open Graph cards for URLs in command output.
// The on/off setting lives in localStorage (like the markdown toggle); the metadata is fetched
// by the daemon (the webview can't read other origins) and memoised here per URL.
import { useEffect, useState, useSyncExternalStore } from "react";
import { shell } from "./rpc";

export type LinkPreview = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
  icon?: string | null;
};

const KEY = "daimon-link-previews";
const listeners = new Set<() => void>();
// Opt-in: a fetched URL tells its server you looked at the output it appeared in.
let enabled = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export function setLinkPreviewsEnabled(v: boolean) {
  enabled = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useLinkPreviewsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => enabled,
  );
}

const cache = new Map<string, Promise<LinkPreview | null>>();

export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    // A timeout or a dropped socket isn't a verdict on the page: forget it so a later render retries.
    p = shell.linkPreview(url).catch(() => { cache.delete(url); return null; });
    cache.set(url, p);
  }
  return p;
}

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
const IMG_RE = /\.(?:png|jpe?g|gif|webp|svg)(?:\?|$)/i;
const MAX_PREVIEWS = 3;

/** Unique URLs in `text`, in order of appearance (trailing punctuation dropped, images skipped). */
export function previewUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?)'"]+$/, "");
    if (IMG_RE.test(u) || seen.has(u)) continue;
    seen.add(u);
    if (seen.size >= MAX_PREVIEWS) break;
  }
  return [...seen];
}

// Remote images (preview cards, image URLs in output) come through the daemon as data:
// URLs: the webview itself never connects anywhere (the CSP has no https: images), and
// the daemon only fetches public addresses, pinned against DNS rebinding.
const images = new Map<string, Promise<string | null>>();
const MAX_IMAGES = 64;

function fetchImage(url: string): Promise<string | null> {
  let p = images.get(url);
  if (!p) {
    if (images.size >= MAX_IMAGES) images.delete(images.keys().next().value!);
    p = shell.image(url).catch(() => { images.delete(url); return null; });
    images.set(url, p);
  }
  return p;
}

/** `url` as a data: URL once the daemon has fetched it; null while loading, on failure, or
 *  when link previews (which also cover remote images) are off. */
export function useRemoteImage(url: string | null | undefined): string | null {
  const enabled = useLinkPreviewsEnabled();
  const [src, setSrc] = useState<{ url: string; data: string | null } | null>(null);
  useEffect(() => {
    if (!url || !enabled) return;
    let live = true;
    void fetchImage(url).then((data) => { if (live) setSrc({ url, data }); });
    return () => { live = false; };
  }, [url, enabled]);
  return enabled && src && src.url === url ? src.data : null;
}
