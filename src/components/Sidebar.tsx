import type { MouseEvent } from "react";

import type { Board } from "../bindings";
import { SWATCH_BG } from "../lib/tickets";
import { PlusIcon } from "./icons";

export type View = { kind: "inbox" } | { kind: "board"; boardId: string };

// Buttons don't take focus on click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

export function Sidebar({
  boards,
  view,
  inboxCount,
  onNavigate,
  onNewBoard,
}: {
  boards: Board[];
  view: View;
  inboxCount: number;
  onNavigate: (view: View) => void;
  onNewBoard: () => void;
}) {
  const item = (active: boolean) =>
    `flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${
      active ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"
    }`;

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-line-subtle font-medium">
      {/* Space for the macOS traffic lights; doubles as a window drag handle. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <nav className="flex flex-col gap-px px-2">
        <button
          type="button"
          title="Inbox · G then I"
          onMouseDown={noFocus}
          onClick={() => onNavigate({ kind: "inbox" })}
          className={item(view.kind === "inbox")}
        >
          Inbox
          {inboxCount > 0 && (
            <span className="ml-auto font-mono text-[11px] font-normal text-fg-tertiary">{inboxCount}</span>
          )}
        </button>
      </nav>

      <div className="group flex items-center px-4 pt-5 pb-1.5">
        <span className="font-mono text-[10px] font-normal tracking-wider text-fg-quaternary uppercase">Boards</span>
        <button
          type="button"
          aria-label="New board"
          title="New board"
          onMouseDown={noFocus}
          onClick={onNewBoard}
          className="ml-auto flex size-5 items-center justify-center rounded text-fg-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
        >
          <PlusIcon />
        </button>
      </div>
      <nav className="flex flex-col gap-px px-2">
        {boards.map((board) => (
          <button
            key={board.id}
            type="button"
            onMouseDown={noFocus}
            onClick={() => onNavigate({ kind: "board", boardId: board.id })}
            className={item(view.kind === "board" && view.boardId === board.id)}
          >
            <span className={`size-2 shrink-0 rounded-sm ${SWATCH_BG[board.color]}`} />
            <span className="truncate">{board.name}</span>
          </button>
        ))}
        {boards.length === 0 && (
          <button type="button" onClick={onNewBoard} className={item(false)}>
            <span className="text-fg-tertiary">
              <PlusIcon />
            </span>
            <span className="text-fg-tertiary">New board</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
