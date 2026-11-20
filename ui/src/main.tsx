// First: its key listeners must run before any other (see keyLock.ts).
import "./lib/daimon/keyLock";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";
import { applyGlass, loadGlass } from "./lib/daimon/appearance";
import { installMagnify } from "./lib/daimon/magnify";
import { loadPlugins } from "./lib/daimon/plugins";
import { openInBrowser } from "./lib/daimon/rpc";
import { toast } from "sonner";

// The native shell appends ?transparent=1 only when the window really is see-through
// (and &blur=native when the compositor also blurs the desktop behind it).
// Without it, the page keeps a solid base so nothing can ever render blank.
{
  const url = new URL(window.location.href);
  if (url.searchParams.get("transparent") === "1") {
    sessionStorage.setItem("daimon-native-transparent", "1");
    // How the compositor's blur responds to the slider: "variable" (continuous), "steps"
    // (fixed looks) or "none" (no blur: Linux). Decides what the Settings blur slider displays.
    const blur = url.searchParams.get("blur");
    if (blur === "variable" || blur === "steps" || blur === "none") sessionStorage.setItem("daimon-native-blur", blur);
    else sessionStorage.removeItem("daimon-native-blur");
    url.searchParams.delete("transparent");
    url.searchParams.delete("blur");
    history.replaceState(history.state, "", url);
  }
  if (sessionStorage.getItem("daimon-native-transparent") === "1") {
    const root = document.documentElement;
    root.classList.add("native-transparent");
    const nativeBlur = sessionStorage.getItem("daimon-native-blur");
    if (nativeBlur) root.dataset["nativeBlur"] = nativeBlur;
    // WebKitGTK/WSLg: a partial repaint of a transparent window blanks everything
    // outside the damaged rect. Force every frame to be a full-window repaint.
    // (macOS/WKWebView, Windows/WebView2 and the Linux app's Chromium composite correctly.)
    if (/Linux/.test(navigator.platform) && !/Chrome\//.test(navigator.userAgent)) root.classList.add("repaint-keepalive");
  }
}

// ?frame=custom: the window has no native title bar — the page draws it (TitleBar.tsx).
{
  const url = new URL(window.location.href);
  if (url.searchParams.get("frame") === "custom") {
    sessionStorage.setItem("daimon-custom-frame", "1");
    url.searchParams.delete("frame");
    history.replaceState(history.state, "", url);
  }
  const root = document.documentElement;
  if (sessionStorage.getItem("daimon-custom-frame") === "1") root.classList.add("custom-frame");
  // macOS already has overlay scrollbars that stay out of the way; everywhere else the
  // native ones are replaced with themed ones (styles.css).
  if (!/Mac/.test(navigator.platform)) root.classList.add("themed-scrollbars");
}

applyGlass(loadGlass());

// Pinch / Ctrl + wheel magnifies the window (also over full-screen programs), and a
// ⌘/Ctrl-drag pans it.
installMagnify(document.getElementById("root")!);

// A link whose text is a URL for one host but which opens another (OSC 8 lets output pick
// both) doesn't open on a click: a toast names the real host and offers to open it.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  const text = a.textContent?.trim().match(/^(?:https?:\/\/|(?=www\.))([^\s/:?#]+)/i)?.[1];
  if (!text) return;
  let real: URL, shown: string;
  // Both through URL, so a look-alike (Cyrillic "а") compares as its punycode, not as "a".
  try { real = new URL(a.href); shown = new URL(`http://${text}`).hostname; } catch { return; }
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (norm(real.hostname) === norm(shown)) return;
  e.preventDefault();
  e.stopPropagation();
  toast.warning(`This link says ${norm(shown)} but opens ${real.hostname}`, {
    id: "link-mismatch",
    duration: 8000,
    action: { label: "Open anyway", onClick: () => openInBrowser(real.href) },
  });
}, true);

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);

void loadPlugins();
