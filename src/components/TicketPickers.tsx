import { useMemo, useState } from "react";

import type { Board, Status, Ticket } from "../bindings";
import { useSetDueDate, useUpdateTicket } from "../lib/queries";
import { PRIORITIES, STATUSES, SWATCH_BG, duePresets, formatDue, patch, ticketKey } from "../lib/tickets";
import { PriorityIcon, StatusIcon } from "./icons";
import { Picker, type PickerOption } from "./Picker";

export type PickerKind = "status" | "priority" | "due" | "move";

const STATUS_OPTIONS: PickerOption<Status>[] = STATUSES.map((s) => ({ ...s, icon: <StatusIcon status={s.value} /> }));
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ ...p, icon: <PriorityIcon priority={p.value} /> }));

/** The `S` / `P` / `D` / `M` pickers for one ticket, shared by the list and the ticket page. */
export function TicketPickers({
  ticket,
  boards,
  kind,
  onClose,
  onMove,
}: {
  ticket: Ticket | undefined;
  boards: Board[];
  kind: PickerKind | null;
  onClose: () => void;
  onMove: (ticket: Ticket, boardId: string | null) => void;
}) {
  const update = useUpdateTicket();
  const setDue = useSetDueDate();
  const close = (open: boolean) => !open && onClose();
  const context = ticket ? (ticketKey(ticket) ?? ticket.title) : undefined;

  const moveOptions = useMemo(() => {
    const options: PickerOption<string | null>[] = boards
      .filter((b) => b.id !== ticket?.boardId)
      .map((b) => ({ value: b.id, label: b.name, icon: <span className={`size-2 rounded-sm ${SWATCH_BG[b.color]}`} /> }));
    if (ticket?.boardId) options.push({ value: null, label: "Inbox" });
    return options;
  }, [boards, ticket?.boardId]);

  // Cheap to build, and rebuilding each render keeps "Today" correct across midnight.
  const dueOptions: PickerOption<string | null>[] = duePresets().map((p) => ({
    ...p,
    detail: new Date(`${p.value}T00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  }));
  if (ticket?.dueDate) dueOptions.push({ value: null, label: "No due date" });

  if (!ticket) return null;

  return (
    <>
      <Picker
        open={kind === "status"}
        onOpenChange={close}
        title="Change status"
        context={context}
        options={STATUS_OPTIONS}
        current={ticket.status}
        onSelect={(status) => update.mutate({ ticket, patch: patch({ status }) })}
      />
      <Picker
        open={kind === "priority"}
        onOpenChange={close}
        title="Change priority"
        context={context}
        options={PRIORITY_OPTIONS}
        current={ticket.priority}
        onSelect={(priority) => update.mutate({ ticket, patch: patch({ priority }) })}
      />
      <Picker
        open={kind === "due"}
        onOpenChange={close}
        title={ticket.dueDate ? `Due ${formatDue(ticket.dueDate)}` : "Set due date"}
        context={context}
        options={dueOptions}
        current={ticket.dueDate ?? undefined}
        onSelect={(dueDate) => setDue.mutate({ ticket, dueDate })}
        footer={
          <DateInput
            initial={ticket.dueDate}
            onSubmit={(dueDate) => {
              onClose();
              setDue.mutate({ ticket, dueDate });
            }}
          />
        }
      />
      <Picker
        open={kind === "move" && moveOptions.length > 0}
        onOpenChange={close}
        title="Move to"
        context={context}
        options={moveOptions}
        onSelect={(boardId) => onMove(ticket, boardId)}
      />
    </>
  );
}

/** A specific date. Commits on Enter, not on change: typing a year passes through invalid years. */
function DateInput({ initial, onSubmit }: { initial: string | null; onSubmit: (date: string) => void }) {
  const [value, setValue] = useState(initial ?? "");
  return (
    <label className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-fg-secondary">
      <span className="flex-1">Pick a date</span>
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value) {
            e.preventDefault();
            onSubmit(value);
          }
        }}
        className="rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-fg [color-scheme:dark] outline-none focus:border-line-strong"
      />
    </label>
  );
}
