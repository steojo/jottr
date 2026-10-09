import { useState } from "react";

import type { ChecklistItem, Ticket } from "../bindings";
import { useChecklist } from "../lib/queries";
import { CheckIcon } from "./icons";

/** Small accent ring plus `done/total`, used on rows and the ticket page. */
export function ChecklistProgress({ done, total }: { done: number; total: number }) {
  const r = 5;
  const circumference = 2 * Math.PI * r;
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-fg-tertiary">
      <svg width="12" height="12" viewBox="0 0 12 12" className="-rotate-90">
        <circle cx="6" cy="6" r={r} fill="none" strokeWidth="1.5" className="stroke-line-strong" />
        <circle
          cx="6"
          cy="6"
          r={r}
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - done / total)}
          className="stroke-accent"
        />
      </svg>
      {done}/{total}
    </span>
  );
}

export function Checklist({ ticket }: { ticket: Ticket }) {
  const { items, add, update, remove } = useChecklist(ticket);
  const [draft, setDraft] = useState("");

  if (!items) return null;

  return (
    <section className="flex flex-col">
      <div className="mb-1 flex h-7 items-center gap-2 font-medium text-fg-secondary">
        Checklist
        {items.length > 0 && (
          <ChecklistProgress done={items.filter((i) => i.done).length} total={items.length} />
        )}
      </div>
      {items.map((item) => (
        <Item
          key={item.id}
          item={item}
          onToggle={() => update.mutate({ item, patch: { text: null, done: !item.done } })}
          onRename={(text) => update.mutate({ item, patch: { text, done: null } })}
          onRemove={() => remove.mutate(item)}
        />
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            add.mutate(draft);
            setDraft("");
          } else if (e.key === "Escape") {
            setDraft("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Add an item…"
        className="h-8 rounded-md bg-transparent pl-8 outline-none placeholder:text-fg-quaternary focus:bg-surface-hover"
      />
    </section>
  );
}

function Item({
  item,
  onToggle,
  onRename,
  onRemove,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onRename: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  function finish(text: string) {
    setEditing(false);
    // Clearing an item's text removes it.
    if (!text.trim()) onRemove();
    else if (text.trim() !== item.text) onRename(text);
  }

  return (
    <div className="group flex h-8 items-center gap-2.5 rounded-md px-1.5 hover:bg-surface-hover">
      <button
        type="button"
        aria-label={item.done ? "Mark as not done" : "Mark as done"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
          item.done ? "border-accent bg-accent text-on-accent" : "border-line-strong hover:border-fg-tertiary"
        }`}
      >
        {item.done && <CheckIcon />}
      </button>
      {editing ? (
        <input
          autoFocus
          defaultValue={item.text}
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              e.currentTarget.value = item.text;
              e.currentTarget.blur();
            }
          }}
          className="flex-1 bg-transparent outline-none"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 truncate ${item.done ? "text-fg-tertiary line-through" : ""}`}
        >
          {item.text}
        </span>
      )}
      <button
        type="button"
        aria-label="Remove item"
        title="Remove"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="hidden size-5 items-center justify-center rounded text-fg-tertiary group-hover:flex hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
