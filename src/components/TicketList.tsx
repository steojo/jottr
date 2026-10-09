import { useEffect, useMemo, useRef, useState } from "react";

import type { Board, Status, Ticket } from "../bindings";
import { useUpdateTicket } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import {
  adjacentStatus,
  formatDue,
  isFinished,
  isOverdue,
  patch,
  statusLabel,
  ticketKey,
  type TicketGroup,
} from "../lib/tickets";
import { ChecklistProgress } from "./Checklist";
import { PlusIcon, PriorityIcon, StatusIcon } from "./icons";
import { TicketMenu } from "./TicketMenu";
import { TicketPickers, type PickerKind } from "./TicketPickers";
import { IconButton, Kbd } from "./ui";

export function TicketList({
  groups,
  boards,
  activeId,
  onActiveChange,
  onOpen,
  onCreate,
  onMove,
  empty,
}: {
  /** `undefined` while loading. */
  groups: TicketGroup[] | undefined;
  boards: Board[];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  onOpen: (ticket: Ticket) => void;
  onCreate: (status: Status) => void;
  onMove: (ticket: Ticket, boardId: string | null) => void;
  empty: { title: string; hint: string };
}) {
  // Keyboard focus ring only shows after keyboard navigation, never after a click.
  const [keyboard, setKeyboard] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const update = useUpdateTicket();

  const order = useMemo(() => groups?.flatMap((g) => g.tickets) ?? [], [groups]);
  const active = order.find((t) => t.id === activeId);
  // IDs share one column, sized to the longest so titles line up.
  const idWidth = Math.max(0, ...order.map((t) => ticketKey(t)?.length ?? 0));

  useEffect(() => {
    if (keyboard && activeId) rows.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, keyboard, order]);

  function step(delta: number) {
    setKeyboard(true);
    if (order.length === 0) return;
    const i = order.findIndex((t) => t.id === activeId);
    const next = i === -1 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, i + delta));
    onActiveChange(order[next].id);
  }

  function openPicker(kind: PickerKind) {
    if (active) setPicker(kind);
  }

  /** Mouse paths select the ticket first, then act on it like the keyboard does. */
  function select(ticket: Ticket) {
    setKeyboard(false);
    onActiveChange(ticket.id);
  }

  function openPickerFor(ticket: Ticket, kind: PickerKind) {
    select(ticket);
    setPicker(kind);
  }

  function shiftStatus(delta: 1 | -1) {
    const status = active && adjacentStatus(active.status, delta);
    if (active && status) update.mutate({ ticket: active, patch: patch({ status }) });
  }

  useShortcuts({
    "[": () => shiftStatus(-1),
    "]": () => shiftStatus(1),
    j: () => step(1),
    arrowdown: () => step(1),
    k: () => step(-1),
    arrowup: () => step(-1),
    enter: () => active && onOpen(active),
    s: () => openPicker("status"),
    p: () => openPicker("priority"),
    d: () => openPicker("due"),
    m: () => openPicker("move"),
    escape: () => onActiveChange(null),
  });

  if (groups === undefined) return <div className="flex-1" />;

  if (order.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-[15px] font-semibold">{empty.title}</p>
        <p className="flex items-center gap-1.5 text-fg-tertiary">
          Press <Kbd>C</Kbd> {empty.hint}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
        <section key={group.status ?? "all"}>
          {group.status && (
            <div className="group sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line-subtle bg-surface-elevated px-4 font-medium">
              <StatusIcon status={group.status} />
              {statusLabel(group.status)}
              <span className="font-mono text-[11px] font-normal text-fg-tertiary">{group.tickets.length}</span>
              <button
                type="button"
                aria-label={`New ${statusLabel(group.status)} ticket`}
                title={`New ${statusLabel(group.status)} ticket`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onCreate(group.status!)}
                className="ml-auto flex size-6 items-center justify-center rounded-md text-fg-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
              >
                <PlusIcon />
              </button>
            </div>
          )}
          {group.tickets.map((ticket) => (
            <TicketMenu
              key={ticket.id}
              ticket={ticket}
              boards={boards}
              onOpen={() => select(ticket)}
              onStatus={(status) => update.mutate({ ticket, patch: patch({ status }) })}
              onPriority={(priority) => update.mutate({ ticket, patch: patch({ priority }) })}
              onMove={(boardId) => onMove(ticket, boardId)}
            >
              <TicketRow
                ticket={ticket}
                idWidth={idWidth}
                active={ticket.id === activeId}
                keyboard={keyboard}
                rowRef={(el) => {
                  if (el) rows.current.set(ticket.id, el);
                  else rows.current.delete(ticket.id);
                }}
                onClick={() => {
                  select(ticket);
                  onOpen(ticket);
                }}
                onPick={(kind) => openPickerFor(ticket, kind)}
              />
            </TicketMenu>
          ))}
        </section>
      ))}

      <TicketPickers ticket={active} boards={boards} kind={picker} onClose={() => setPicker(null)} onMove={onMove} />
    </div>
  );
}

function TicketRow({
  ticket,
  idWidth,
  active,
  keyboard,
  rowRef,
  onClick,
  onPick,
}: {
  ticket: Ticket;
  /** In `ch`, so the mono IDs fit exactly. */
  idWidth: number;
  active: boolean;
  keyboard: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onClick: () => void;
  onPick: (kind: PickerKind) => void;
}) {
  const key = ticketKey(ticket);
  return (
    <div
      ref={rowRef}
      onClick={onClick}
      className={`relative flex h-10 items-center gap-2.5 border-b border-line-subtle px-4 group-data-[state=open]/menu:bg-surface-hover ${
        active ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
    >
      {/* Selected: a 2px bar drawn inside the row so nothing reflows (PRD §6.5). */}
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      {active && keyboard && (
        <span className="pointer-events-none absolute inset-0 rounded-md shadow-[inset_0_0_0_1.5px_var(--color-accent)]" />
      )}
      <IconButton title="Change priority · P" onClick={() => onPick("priority")}>
        <PriorityIcon priority={ticket.priority} />
      </IconButton>
      <IconButton title="Change status · S" onClick={() => onPick("status")}>
        <StatusIcon status={ticket.status} />
      </IconButton>
      {idWidth > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-fg-tertiary" style={{ width: `${idWidth}ch` }}>
          {key}
        </span>
      )}
      <span className={`flex-1 truncate ${isFinished(ticket) ? "text-fg-tertiary" : ""}`}>{ticket.title}</span>
      {/* Fixed slots, same order on every row (PRD §6.5). Empty slots take no space. */}
      {ticket.checklistTotal > 0 && <ChecklistProgress done={ticket.checklistDone} total={ticket.checklistTotal} />}
      {ticket.dueDate && (
        <span
          className={`shrink-0 font-mono text-[11px] ${isOverdue(ticket) ? "text-status-error" : "text-fg-tertiary"}`}
        >
          {formatDue(ticket.dueDate)}
        </span>
      )}
    </div>
  );
}
