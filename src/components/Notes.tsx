import { lazy, Suspense, useState, type RefObject } from "react";

import type { Board, Project, Status, TicketDraft } from "../bindings";
import { useCreateTickets, useNotes, useSaveNotes } from "../lib/queries";
import { STATUSES } from "../lib/tickets";
import type { NotesHandle, TicketRequest } from "./NotesEditor";
import { Dialog, Kbd } from "./ui";

const NotesEditor = lazy(() => import("./NotesEditor"));

/** Free-form notes on a board or project: a place for brain dumps that later become tickets. */
export function Notes({
  board,
  project,
  status,
  handle,
  onOpenTicket,
  onToast,
}: {
  board: Board;
  project: Project | undefined;
  /** Where tickets made from the notes start. */
  status: Status;
  handle: RefObject<NotesHandle | null>;
  onOpenTicket: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const projectId = project?.id ?? null;
  const notes = useNotes(board.id, projectId);
  const save = useSaveNotes(board.id, projectId);
  const createTickets = useCreateTickets();
  const [request, setRequest] = useState<TicketRequest | null>(null);

  async function confirm() {
    if (!request || createTickets.isPending) return;
    try {
      const tickets = await createTickets.mutateAsync({ boardId: board.id, projectId, status, drafts: request.drafts });
      setRequest(null);
      request.replace(tickets);
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-10 pt-8 pb-24">
        {notes.isError ? (
          <p className="text-fg-secondary">Couldn't load the notes: {String(notes.error)}</p>
        ) : (
          notes.data !== undefined && (
            <Suspense fallback={<p className="description whitespace-pre-wrap text-fg-tertiary">{notes.data}</p>}>
              <NotesEditor
                value={notes.data}
                onSave={(markdown) => save(markdown).catch((e) => onToast(`Couldn't save the notes: ${e}`))}
                onMakeTickets={(next) => {
                  if (next.drafts.length === 0) return onToast("Put the cursor on a line to make it a ticket");
                  createTickets.reset();
                  setRequest(next);
                }}
                onOpenTicket={onOpenTicket}
                handle={handle}
              />
            </Suspense>
          )
        )}
      </div>
      <MakeTicketsDialog
        drafts={request?.drafts ?? null}
        where={project?.name ?? board.name}
        status={status}
        error={createTickets.error ? String(createTickets.error) : null}
        onCancel={() => {
          setRequest(null);
          request?.cancel();
        }}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

/** Shows what the selected lines will become before anything is made. Enter makes them, Esc cancels. */
function MakeTicketsDialog({
  drafts,
  where,
  status,
  error,
  onCancel,
  onConfirm,
}: {
  drafts: TicketDraft[] | null;
  where: string;
  status: Status;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = drafts?.length === 1 ? "1 ticket" : `${drafts?.length ?? 0} tickets`;
  return (
    <Dialog
      open={drafts !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={`Make ${count}`}
      width="w-[480px]"
      focusContent
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <div className="flex h-10 items-center border-b border-line-subtle px-4 font-medium">
        Make {count} in {where}
      </div>
      <ul className="max-h-[50vh] overflow-y-auto py-1.5">
        {drafts?.map((draft, i) => (
          <li key={i} className="flex flex-col gap-0.5 px-4 py-1.5">
            <span className="truncate">{draft.title}</span>
            {(draft.description || draft.checklist.length > 0) && (
              <span className="text-[12px] text-fg-tertiary">{contents(draft)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex h-11 items-center justify-between gap-2 border-t border-line-subtle px-3">
        <span className={`truncate ${error ? "text-status-error" : "text-fg-tertiary"}`}>
          {error ?? `Added to ${STATUSES.find((s) => s.value === status)?.label}`}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-tertiary hover:bg-surface-hover hover:text-fg"
          >
            Cancel <Kbd>Esc</Kbd>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 font-medium text-on-accent hover:bg-accent-hover"
          >
            Make tickets <Kbd>↵</Kbd>
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function contents(draft: TicketDraft) {
  const items = draft.checklist.length;
  return [
    draft.description && "Description",
    items > 0 && (items === 1 ? "1 checklist item" : `${items} checklist items`),
  ]
    .filter(Boolean)
    .join(" · ");
}
