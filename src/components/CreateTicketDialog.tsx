import { useState } from "react";

import type { Board, Status, Ticket } from "../bindings";
import { useCreateTicket } from "../lib/queries";
import { statusLabel } from "../lib/tickets";
import { StatusIcon } from "./icons";
import { ContextChip, Dialog, Kbd } from "./ui";

export function CreateTicketDialog({
  status,
  board,
  onClose,
  onCreated,
}: {
  /** `null` when closed. */
  status: Status | null;
  /** `undefined` creates the ticket in the Inbox. */
  board: Board | undefined;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const [title, setTitle] = useState("");
  const create = useCreateTicket();

  function close() {
    setTitle("");
    create.reset();
    onClose();
  }

  function submit() {
    if (!status || !title.trim()) return;
    create.mutate(
      { boardId: board?.id ?? null, title, status, priority: "none" },
      {
        onSuccess: (ticket) => {
          close();
          onCreated(ticket);
        },
      },
    );
  }

  return (
    <Dialog open={status !== null} onOpenChange={(open) => !open && close()} title="New ticket">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex h-10 items-center gap-2 border-b border-line-subtle px-3">
          <ContextChip>{board ? board.key : "Inbox"}</ContextChip>
          {status && (
            <span className="flex items-center gap-1.5 text-fg-tertiary">
              <StatusIcon status={status} />
              {statusLabel(status)}
            </span>
          )}
        </div>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ticket title"
          className="h-12 w-full bg-transparent px-4 text-[15px] font-medium outline-none placeholder:text-fg-quaternary"
        />
        <div className="flex h-10 items-center justify-between border-t border-line-subtle px-3 text-fg-tertiary">
          <span className="truncate text-status-error">{create.error ? String(create.error) : ""}</span>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-fg"
          >
            Create <Kbd>↵</Kbd>
          </button>
        </div>
      </form>
    </Dialog>
  );
}
