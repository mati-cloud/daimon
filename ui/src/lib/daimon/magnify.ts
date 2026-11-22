/// Pinch / Ctrl + wheel magnification, on every platform.
///
/// macOS pinches arrive as WebKit gesture events, taken here before WKWebView's own
/// magnification (app/src/bun/macMagnification.ts, still on as the fallback should they
/// not arrive): that one can't be panned from the page, and a terminal canvas stays blurry.
/// Elsewhere pinches arrive as ctrl+wheel. While magnified, holding ⌘ (macOS) / Ctrl shows
/// a grab cursor and dragging pans the page.
///
/// Like the macOS one it is a *visual* zoom: the page is scaled as a picture around the
/// pointer, nothing reflows. It eases toward each new level instead of jumping, gives a
/// little past 100% and springs back (rubber band), and at exactly 100% the transform is
/// removed altogether so text is crisp again. Touchpad pinches arrive as ctrl+wheel too.
/// Ctrl +/- (the keyboard) is left alone.

const MAX = 4;
/** How far past 100% a zoom-out may stretch before springing back. */
const RUBBER_MIN = 0.92;
/** Zoom per wheel pixel: a mouse notch (~100px) is ~×1.22, a pinch step a little. */
const PER_PX = 0.002;
/** Share of the remaining distance covered each frame (60 fps): smooth, still snappy. */
const EASE = 0.22;
/** Wheel quiet for this long ends a gesture: an overshoot springs back to 100%. */
const SETTLE_MS = 140;

/** The settled magnification (1 = none), announced with the `daimon:magnify` event
 *  ({ scale }) once the page stops moving. The browser re-rasterizes the page's HTML at
 *  the new scale by itself, but a canvas keeps its pixels and is only stretched — the
 *  full-screen terminal listens and re-renders at the magnified resolution
 *  (lib/daimon/tuiTerminal.ts). */
let settledScale = 1;
export const magnifyScale = () => settledScale;
function announce(scale: number) {
  if (scale === settledScale) return;
  settledScale = scale;
  window.dispatchEvent(new CustomEvent("daimon:magnify", { detail: { scale } }));
}

export function installMagnify(target: HTMLElement): () => void {
  // Current (drawn) and target transform: translate(x, y) scale(s), origin top-left.
  let s = 1, x = 0, y = 0;
  let ts = 1, tx = 0, ty = 0;
  let frame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  // Live scale readout (e.g. "1.3×") shown while pinching; hidden at 100%.
  const badge = document.createElement("div");
  badge.className = "magnify-badge";
  let badgeTimer: ReturnType<typeof setTimeout> | null = null;
  const showBadge = (scale: number) => {
    badge.textContent = `${scale.toFixed(1)}×`;
    if (!badge.isConnected) document.body.appendChild(badge);
    badge.classList.toggle("magnify-badge-show", scale > 1.001);
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove("magnify-badge-show"), 900);
  };

  /** Keep the scaled page covering the window: no empty margin on any side. */
  const clampPan = (scale: number, px: number, py: number): [number, number] => {
    if (scale === 1) return [0, 0];
    // Below 100% (rubber band only): shrink towards the pointer, as if pulled there.
    if (scale < 1) return [px, py];
    const w = innerWidth, h = innerHeight;
    return [Math.min(0, Math.max(w - w * scale, px)), Math.min(0, Math.max(h - h * scale, py))];
  };

  const apply = () => {
    if (s === 1 && x === 0 && y === 0) {
      target.style.transform = "";
      target.style.transformOrigin = "";
      target.style.willChange = "";
      document.body.style.overflow = "";
      return;
    }
    target.style.transformOrigin = "0 0";
    target.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    // A scaled element still counts towards the page's scroll area — no page scrollbars.
    document.body.style.overflow = "hidden";
  };

  const step = () => {
    frame = 0;
    s += (ts - s) * EASE; x += (tx - x) * EASE; y += (ty - y) * EASE;
    const done = Math.abs(ts - s) < 0.0005 && Math.abs(tx - x) < 0.05 && Math.abs(ty - y) < 0.05;
    if (done) { s = ts; x = tx; y = ty; }
    // Smooth while moving; once still, drop the hint so the text is re-rendered sharp.
    target.style.willChange = done ? "" : "transform";
    apply();
    if (done) announce(s); else frame = requestAnimationFrame(step);
  };
  const animate = () => { if (!frame) frame = requestAnimationFrame(step); };

  /** Aim at `scale`, keeping the page point under (px, py) where it is on screen. */
  const zoomTo = (scale: number, px: number, py: number) => {
    const k = scale / ts;
    const [nx, ny] = clampPan(scale, px - (px - tx) * k, py - (py - ty) * k);
    ts = scale; tx = nx; ty = ny;
    showBadge(scale);
    animate();
  };

  const settle = () => {
    settleTimer = null;
    // Released below 100%: spring back to the plain page.
    if (ts < 1) { ts = 1; tx = 0; ty = 0; animate(); }
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey || e.metaKey) return;
    if (gestureBase) { e.preventDefault(); e.stopPropagation(); return; } // the pinch already zooms
    // Ours, not the webview's page zoom (which would reflow everything) — and not a scroll:
    // nothing else sees it (an output pane would take it for "the user scrolled up").
    e.preventDefault();
    e.stopPropagation();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    // Past 100% the page resists, more the further it is pulled (rubber band).
    const resist = ts < 1 ? 0.35 : 1;
    const next = Math.min(MAX, Math.max(RUBBER_MIN, ts * Math.exp(-px * PER_PX * resist)));
    // Snap the last bit onto 100% so a zoom-out lands exactly there.
    zoomTo(Math.abs(next - 1) < 0.01 ? 1 : next, e.clientX, e.clientY);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS);
  };

  // macOS trackpad pinch (WebKit GestureEvent: scale relative to the gesture's start).
  type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
  let gestureBase = 0;
  const onGestureStart = (e: Event) => { e.preventDefault(); gestureBase = ts; };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as Gesture;
    if (!gestureBase) gestureBase = ts;
    const next = Math.min(MAX, Math.max(RUBBER_MIN, gestureBase * g.scale));
    zoomTo(Math.abs(next - 1) < 0.01 ? 1 : next, g.clientX, g.clientY);
  };
  const onGestureEnd = (e: Event) => { e.preventDefault(); gestureBase = 0; settle(); };

  // Pan: hold the modifier while magnified → grab cursor; drag → grabbing, page follows.
  const isMac = /Mac/.test(navigator.platform);
  const panKey = (e: MouseEvent) => (isMac ? e.metaKey : e.ctrlKey) && ts > 1;
  const root = document.documentElement;
  let drag: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
  const setCursor = (c: "" | "grab" | "grabbing") => {
    root.classList.toggle("magnify-grab", c === "grab");
    root.classList.toggle("magnify-grabbing", c === "grabbing");
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !panKey(e)) return;
    // Ours: the terminal / block under the pointer must not start a selection or click.
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: tx, oy: ty, moved: false };
    root.setPointerCapture?.(e.pointerId);
    setCursor("grabbing");
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      e.stopPropagation();
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      // Follow the hand directly — no easing while dragging.
      [tx, ty] = clampPan(ts, drag.ox + dx, drag.oy + dy);
      x = tx; y = ty; s = ts;
      apply();
      return;
    }
    setCursor(panKey(e) ? "grab" : "");
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    const moved = drag.moved;
    drag = null;
    root.releasePointerCapture?.(e.pointerId);
    setCursor(panKey(e) ? "grab" : "");
    // A drag isn't a click (⌘-click opens links in the terminal).
    if (moved) window.addEventListener("click", (c) => { c.preventDefault(); c.stopPropagation(); }, { capture: true, once: true });
  };
  // Modifier released (or the window left) without moving the mouse: drop the grab cursor.
  const onKeyUp = (e: KeyboardEvent) => { if (!drag && !(isMac ? e.metaKey : e.ctrlKey)) setCursor(""); };
  const onBlur = () => { drag = null; setCursor(""); };

  // The window changed size: keep the magnified page covering it.
  const onResize = () => { [tx, ty] = clampPan(ts, tx, ty); [x, y] = clampPan(s, x, y); apply(); };

  // Capture + non-passive: before anything else sees it, and allowed to prevent the default.
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("resize", onResize);
  const gestures: [string, EventListener][] = [["gesturestart", onGestureStart], ["gesturechange", onGestureChange], ["gestureend", onGestureEnd]];
  for (const [type, fn] of gestures) window.addEventListener(type, fn, { passive: false, capture: true });
  const pointer: [string, EventListener][] = [["pointerdown", onPointerDown as EventListener], ["pointermove", onPointerMove as EventListener], ["pointerup", onPointerUp as EventListener], ["pointercancel", onPointerUp as EventListener]];
  for (const [type, fn] of pointer) window.addEventListener(type, fn, { capture: true });
  // Passive (never prevents anything): only to drop the cursor when the modifier is let go.
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("resize", onResize);
    for (const [type, fn] of [...gestures, ...pointer]) window.removeEventListener(type, fn, { capture: true });
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    setCursor("");
    if (frame) cancelAnimationFrame(frame);
    if (settleTimer) clearTimeout(settleTimer);
    if (badgeTimer) clearTimeout(badgeTimer);
    badge.remove();
    s = ts = 1; x = y = tx = ty = 0;
    apply();
    announce(1);
  };
}
