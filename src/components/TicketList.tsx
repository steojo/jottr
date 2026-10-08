import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Board, Status, Ticket } from "../bindings";
import { useMoveTicket, useUpdateTicket } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import { LIST_ORDER, PRIORITIES, STATUSES, SWATCH_BG, byPosition, patch, statusLabel, ticketKey } from "../lib/tickets";
import { PlusIcon, PriorityIcon, StatusIcon } from "./icons";
import { Picker, type PickerOption } from "./Picker";
import { TicketMenu } from "./TicketMenu";
import { Kbd } from "./ui";

type PickerKind = "status" | "priority" | "move";

const STATUS_OPTIONS: PickerOption<Status>[] = STATUSES.map((s) => ({
  ...s,
  icon: <StatusIcon status={s.value} />,
}));
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ ...p, icon: <PriorityIcon priority={p.value} /> }));

export function TicketList({
  tickets,
  grouped,
  boards,
  activeId,
  onActiveChange,
  onCreate,
  empty,
}: {
  tickets: Ticket[] | undefined;
  /** Group by status (boards) or show one flat list (Inbox). */
  grouped: boolean;
  boards: Board[];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  onCreate: (status: Status) => void;
  empty: { title: string; hint: string };
}) {
  // Keyboard focus ring only shows after keyboard navigation, never after a click.
  const [keyboard, setKeyboard] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const update = useUpdateTicket();
  const move = useMoveTicket();

  const groups = useMemo(() => {
    const sorted = [...(tickets ?? [])].sort(byPosition);
    if (!grouped) return [{ status: null, tickets: sorted }];
    return LIST_ORDER.map((status) => ({ status, tickets: sorted.filter((t) => t.status === status) })).filter(
      (g) => g.tickets.length > 0,
    );
  }, [tickets, grouped]);
  const order = useMemo(() => groups.flatMap((g) => g.tickets), [groups]);
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

  useShortcuts({
    j: () => step(1),
    arrowdown: () => step(1),
    k: () => step(-1),
    arrowup: () => step(-1),
    s: () => openPicker("status"),
    p: () => openPicker("priority"),
    m: () => openPicker("move"),
    escape: () => onActiveChange(null),
  });

  const moveOptions = useMemo<PickerOption<string | null>[]>(() => {
    const options: PickerOption<string | null>[] = boards
      .filter((b) => b.id !== active?.boardId)
      .map((b) => ({ value: b.id, label: b.name, icon: <span className={`size-2 rounded-sm ${SWATCH_BG[b.color]}`} /> }));
    if (active?.boardId) options.push({ value: null, label: "Inbox" });
    return options;
  }, [boards, active?.boardId]);

  function moveTicket(ticket: Ticket, boardId: string | null) {
    // Keep the selection in place by handing it to a neighbour.
    const i = order.findIndex((t) => t.id === ticket.id);
    const neighbour = order[i + 1] ?? order[i - 1];
    move.mutate({ ticket, boardId });
    if (ticket.id === activeId) onActiveChange(neighbour?.id ?? null);
  }

  if (tickets === undefined) return <div className="flex-1" />;

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

  const context = active ? (ticketKey(active) ?? active.title) : undefined;

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
              onMove={(boardId) => moveTicket(ticket, boardId)}
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
                onClick={() => select(ticket)}
                onPick={(kind) => openPickerFor(ticket, kind)}
              />
            </TicketMenu>
          ))}
        </section>
      ))}

      <Picker
        open={picker === "status"}
        onOpenChange={(open) => !open && setPicker(null)}
        title="Change status"
        context={context}
        options={STATUS_OPTIONS}
        current={active?.status}
        onSelect={(status) => active && update.mutate({ ticket: active, patch: patch({ status }) })}
      />
      <Picker
        open={picker === "priority"}
        onOpenChange={(open) => !open && setPicker(null)}
        title="Change priority"
        context={context}
        options={PRIORITY_OPTIONS}
        current={active?.priority}
        onSelect={(priority) => active && update.mutate({ ticket: active, patch: patch({ priority }) })}
      />
      <Picker
        open={picker === "move" && moveOptions.length > 0}
        onOpenChange={(open) => !open && setPicker(null)}
        title="Move to"
        context={context}
        options={moveOptions}
        onSelect={(boardId) => active && moveTicket(active, boardId)}
      />
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
  const finished = ticket.status === "done" || ticket.status === "canceled";
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
      <span className={`flex-1 truncate ${finished ? "text-fg-tertiary" : ""}`}>{ticket.title}</span>
      {ticket.dueDate && <span className="font-mono text-[11px] text-fg-tertiary">{ticket.dueDate}</span>}
    </div>
  );
}

/** A row icon that opens a picker. The negative margin keeps the row layout unchanged. */
function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="-m-[3px] rounded p-[3px] hover:bg-surface-elevated"
    >
      {children}
    </button>
  );
}
