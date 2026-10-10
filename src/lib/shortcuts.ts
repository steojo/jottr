import { useEffect, useRef } from "react";

/**
 * Keys are combos like `c`, `shift+j`, `mod+\`, `arrowdown`, or `g i` for the
 * G-prefix navigation sequences.
 */
export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

const registry = new Set<{ current: ShortcutMap }>();
const PREFIX_TIMEOUT_MS = 1000;
let prefixAt: number | null = null;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function combo(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  const parts: string[] = [];
  if (e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Shift is implied by symbols like `?`, so it's only named for letters and named keys.
  if (e.shiftKey && (/^[a-z]$/.test(key) || key.length > 1)) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

// Work even while typing in a field.
const ALWAYS = new Set(["mod+k"]);

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  if (isTyping(e.target) && !ALWAYS.has(combo(e))) return;
  // Open dialogs and menus handle their own keys.
  if (document.querySelector("[role=dialog], [role=menu]")) return;

  let key = combo(e);
  if (prefixAt !== null && Date.now() - prefixAt < PREFIX_TIMEOUT_MS) {
    key = `g ${key}`;
    prefixAt = null;
  } else if (key === "g") {
    prefixAt = Date.now();
    e.preventDefault();
    return;
  }

  // Most recently registered maps win, so a view can override global keys.
  for (const map of [...registry].reverse()) {
    const handler = map.current[key];
    if (handler) {
      e.preventDefault();
      handler(e);
      return;
    }
  }
}

window.addEventListener("keydown", onKeyDown);

/** Runs whatever a key currently does, as if it were pressed. Returns false if nothing handles it. */
export function runShortcut(key: string): boolean {
  for (const map of [...registry].reverse()) {
    const handler = map.current[key];
    if (handler) {
      handler(new KeyboardEvent("keydown"));
      return true;
    }
  }
  return false;
}

export function useShortcuts(map: ShortcutMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    registry.add(ref);
    return () => {
      registry.delete(ref);
    };
  }, [enabled]);
}
