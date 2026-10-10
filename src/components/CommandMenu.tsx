import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { Board, Ticket } from "../bindings";
import { useSearch } from "../lib/queries";
import { SWATCH_BG, ticketKey } from "../lib/tickets";
import { StatusIcon } from "./icons";
import { ContextChip, Dialog, Kbd } from "./ui";

export type Command = {
  id: string;
  label: string;
  /** Section shown when the menu opens empty. */
  group: string;
  /** Shown as keys, e.g. "S" or "G I"; also teaches the shortcut. */
  shortcut?: string;
  icon?: ReactNode;
  /** Extra words that should find this command. */
  keywords?: string;
  run: () => void;
};

type Row = { kind: "command"; command: Command } | { kind: "ticket"; ticket: Ticket };

/** Best match first: label starts with the query, then a word does, then anywhere, then keywords. */
function rankCommands(commands: Command[], q: string): Command[] {
  if (!q) return commands;
  const score = (c: Command) => {
    const label = c.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (c.keywords?.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return commands
    .map((c) => ({ c, s: score(c) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s)
    .map(({ c }) => c);
}

/**
 * `⌘K`: every action plus ticket search across all boards. `/` opens it in
 * search-only mode. Commands run after the menu closes, so pickers they open
 * don't stack on top of it.
 */
export function CommandMenu({
  open,
  searchOnly,
  onOpenChange,
  commands,
  context,
  boards,
  onOpenTicket,
}: {
  open: boolean;
  searchOnly: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  /** The selected ticket that ticket actions apply to, e.g. `ENG-42`. */
  context?: string;
  boards: Board[];
  onOpenTicket: (ticket: Ticket) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={searchOnly ? "Search" : "Command menu"} width="w-[560px]">
      {open && (
        <Body
          searchOnly={searchOnly}
          commands={commands}
          context={context}
          boards={boards}
          close={() => onOpenChange(false)}
          onOpenTicket={onOpenTicket}
        />
      )}
    </Dialog>
  );
}

function Body({
  searchOnly,
  commands,
  context,
  boards,
  close,
  onOpenTicket,
}: {
  searchOnly: boolean;
  commands: Command[];
  context?: string;
  boards: Board[];
  close: () => void;
  onOpenTicket: (ticket: Ticket) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const tickets = useSearch(query).data ?? [];

  const matched = searchOnly ? [] : rankCommands(commands, q);
  const shownCommands = q ? matched.slice(0, 6) : matched;
  const rows: Row[] = [
    ...shownCommands.map((command): Row => ({ kind: "command", command })),
    ...(q ? tickets.map((ticket): Row => ({ kind: "ticket", ticket })) : []),
  ];
  const highlighted = Math.min(index, rows.length - 1);

  useEffect(() => {
    list.current?.querySelector(`[data-row="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function activate(row: Row | undefined) {
    if (!row) return;
    close();
    // Run once the menu has closed, so anything it opens isn't blocked by this dialog.
    setTimeout(() => (row.kind === "command" ? row.command.run() : onOpenTicket(row.ticket)), 0);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") setIndex(Math.min(rows.length - 1, highlighted + 1));
    else if (e.key === "ArrowUp") setIndex(Math.max(0, highlighted - 1));
    else if (e.key === "Enter") activate(rows[highlighted]);
    else return;
    e.preventDefault();
  }

  // Section headings: command groups when empty; "Actions" and "Tickets" when searching.
  const heading = (row: Row, i: number): string | null => {
    const label = row.kind === "ticket" ? "Tickets" : q ? "Actions" : row.command.group;
    const prev = rows[i - 1];
    const prevLabel = prev ? (prev.kind === "ticket" ? "Tickets" : q ? "Actions" : prev.command.group) : null;
    return label !== prevLabel ? label : null;
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex h-12 items-center gap-2 border-b border-line-subtle px-4">
        {context && !searchOnly && <ContextChip>{context}</ContextChip>}
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          placeholder={searchOnly ? "Search tickets…" : "Type a command or search tickets…"}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-quaternary"
        />
      </div>
      <div ref={list} className="max-h-[380px] overflow-y-auto p-1.5">
        {rows.length === 0 && (
          <p className="px-2.5 py-6 text-center text-fg-tertiary">
            {q ? "No results" : searchOnly ? "Type to search every ticket" : "No commands"}
          </p>
        )}
        {rows.map((row, i) => {
          const title = heading(row, i);
          return (
            <div key={row.kind === "command" ? row.command.id : row.ticket.id}>
              {title && (
                <div className="px-2.5 pt-2.5 pb-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">
                  {title}
                </div>
              )}
              <button
                type="button"
                tabIndex={-1}
                data-row={i}
                onMouseMove={() => setIndex(i)}
                onClick={() => activate(row)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${
                  i === highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary"
                }`}
              >
                {row.kind === "command" ? (
                  <>
                    <span className="flex size-3.5 shrink-0 items-center justify-center">{row.command.icon}</span>
                    <span className="flex-1 truncate">{row.command.label}</span>
                    {row.command.shortcut && (
                      <span className="flex shrink-0 gap-1">
                        {row.command.shortcut.split(" ").map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    )}
                  </>
                ) : (
                  <TicketResult ticket={row.ticket} boards={boards} />
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex h-9 items-center justify-end gap-3 border-t border-line-subtle px-3 text-[12px] text-fg-tertiary">
        <span className="flex items-center gap-1.5">
          Navigate <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </span>
        <span className="flex items-center gap-1.5">
          Open <Kbd>↵</Kbd>
        </span>
        <span className="flex items-center gap-1.5">
          Close <Kbd>Esc</Kbd>
        </span>
      </div>
    </div>
  );
}

function TicketResult({ ticket, boards }: { ticket: Ticket; boards: Board[] }) {
  const board = boards.find((b) => b.id === ticket.boardId);
  return (
    <>
      <StatusIcon status={ticket.status} />
      {ticketKey(ticket) && (
        <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">{ticketKey(ticket)}</span>
      )}
      <span className="flex-1 truncate">{ticket.title}</span>
      {ticket.archivedAt !== null && <span className="shrink-0 text-[12px] text-fg-quaternary">Archived</span>}
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-fg-tertiary">
        {board && <span className={`size-2 rounded-sm ${SWATCH_BG[board.color]}`} />}
        {board ? board.name : "Inbox"}
      </span>
    </>
  );
}
