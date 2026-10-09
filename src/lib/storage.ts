import { useState } from "react";

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : (JSON.parse(raw) as T);
}

/**
 * UI preferences (layout, collapsed columns) kept in localStorage; data lives in SQLite.
 * Switching `key` (e.g. to another board) reads that key's value straight away.
 */
export function usePersistentState<T>(key: string, fallback: T) {
  const [state, setState] = useState(() => ({ key, value: read(key, fallback) }));
  const value = state.key === key ? state.value : read(key, fallback);

  function set(next: T | ((prev: T) => T)) {
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
    localStorage.setItem(key, JSON.stringify(resolved));
    setState({ key, value: resolved });
  }

  return [value, set] as const;
}
