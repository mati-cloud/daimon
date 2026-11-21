/// While a modal must not be bypassed (PluginGate), no keyboard shortcut may run: not
/// daimon's, not a plugin's, not a full-screen program's. This module is imported first
/// (main.tsx), so its window capture listeners run before every other key listener; when
/// locked they end the event there.
///
/// Inside the modal (`[data-key-lock-allow]`) the browser's own handling still happens
/// (typing, Tab, paste), only the listeners are skipped. So the modal must not rely on
/// onKeyDown: Enter submits its <form> instead.

let locked = false;

export function setKeyLock(on: boolean) {
  locked = on;
}

function swallow(e: KeyboardEvent) {
  if (!locked) return;
  const inModal = e.target instanceof Element && e.target.closest("[data-key-lock-allow]");
  if (inModal) return; // let key-capture overlays receive the event normally
  e.stopImmediatePropagation();
  e.preventDefault();
}

for (const type of ["keydown", "keyup", "keypress"] as const) {
  window.addEventListener(type, swallow, { capture: true });
}
