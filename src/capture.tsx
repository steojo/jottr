import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import { commands } from "./bindings";
import { ContextChip, Kbd } from "./components/ui";
import "@fontsource-variable/inter";
import "./index.css";

/**
 * The quick capture box (`capture.rs`), in its own window so it can float over other apps.
 * Enter adds the title to the bottom of the Inbox. Esc closes and clears it; clicking away
 * closes it but keeps what you typed.
 */
function Capture() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The window is hidden rather than closed between captures, so focus the field each time it shows.
  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    commands
      .captureTicket(title)
      .then(
        () => {
          setTitle("");
          setError(null);
        },
        (e) => setError(String(e)),
      )
      .finally(() => setSaving(false));
  }

  function close() {
    setTitle("");
    setError(null);
    void commands.closeCapture();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => e.key === "Escape" && close()}
      className="flex h-full flex-col bg-surface-elevated"
    >
      <input
        ref={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ticket title"
        aria-label="Ticket title"
        className="h-12 w-full shrink-0 bg-transparent px-4 text-[15px] font-medium outline-none placeholder:text-fg-quaternary"
      />
      <div className="flex h-10 items-center gap-2 border-t border-line-subtle px-3 text-fg-tertiary">
        <ContextChip>Inbox</ContextChip>
        <span className="flex-1 truncate text-status-error">{error}</span>
        <button
          type="submit"
          disabled={saving}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-fg"
        >
          Add to Inbox <Kbd>↵</Kbd>
        </button>
      </div>
    </form>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Capture />
  </React.StrictMode>,
);
