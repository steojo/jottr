import * as ContextMenu from "@radix-ui/react-context-menu";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { Board, Note, Project, Status, TicketDraft } from "../bindings";
import { useCreateTickets, useNoteActions, useNotes } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import { usePersistentState } from "../lib/storage";
import { STATUSES } from "../lib/tickets";
import { ConfirmDialog, NameDialog } from "./FormDialogs";
import { PlusIcon } from "./icons";
import type { EditorHandle, TicketRequest } from "./NotesEditor";
import { menuItem, menuPanel } from "./TicketMenu";
import { Dialog, Kbd } from "./ui";

const NotesEditor = lazy(() => import("./NotesEditor"));

/** Lets the header and ⌘K reach the open note. */
export type NotesHandle = EditorHandle & { newNote: () => void; renameNote: () => void; deleteNote: () => void };

const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();
const ring = "outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-accent)]";

/**
 * Free-form notes on a board or project: a place for brain dumps that later become tickets.
 * Each board and project has one or more named notes, shown as tabs.
 */
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
  const actions = useNoteActions(board.id, projectId);
  const createTickets = useCreateTickets();
  const [request, setRequest] = useState<TicketRequest | null>(null);
  // Each board and project reopens the note it was last on.
  const [selectedId, setSelectedId] = usePersistentState<string | null>(
    `jottr.note.${board.id}.${projectId ?? "board"}`,
    null,
  );
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  // A note made from the New note dialog is ready to type in.
  const [fresh, setFresh] = useState<string | null>(null);
  const editor = useRef<EditorHandle | null>(null);

  const list = notes.data ?? [];
  const note = list.find((n) => n.id === selectedId) ?? list[0];

  function step(by: 1 | -1) {
    if (!note || list.length < 2) return;
    setSelectedId(list[(list.indexOf(note) + by + list.length) % list.length].id);
  }

  function askToDelete(target: Note | undefined) {
    if (!target) return;
    if (list.length < 2) return onToast("A board or project keeps at least one note");
    setDeleting(target);
  }

  // Tabs work while writing, so they're also in the shortcut registry's always-on keys.
  useShortcuts({
    "mod+t": () => setCreating(true),
    "mod+alt+arrowleft": () => step(-1),
    "mod+alt+arrowright": () => step(1),
  });

  useEffect(() => {
    handle.current = {
      makeTickets: () => editor.current?.makeTickets(),
      newNote: () => setCreating(true),
      renameNote: () => note && setRenaming(note),
      deleteNote: () => askToDelete(note),
    };
  });
  useEffect(
    () => () => {
      handle.current = null;
    },
    [handle],
  );

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
    <div className="flex min-h-0 flex-1 flex-col">
      {note && (
        <div className="shrink-0 border-b border-line-subtle">
          <div
            role="tablist"
            aria-label="Notes"
            className="mx-auto flex h-10 max-w-[720px] items-center gap-1 overflow-x-auto px-[30px] [scrollbar-width:none]"
          >
            {list.map((n) => (
              <NoteMenu
                key={n.id}
                canDelete={list.length > 1}
                onRename={() => setRenaming(n)}
                onDelete={() => askToDelete(n)}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={n.id === note.id}
                  title={`${n.title} · double-click to rename`}
                  onMouseDown={noFocus}
                  onClick={() => setSelectedId(n.id)}
                  onDoubleClick={() => setRenaming(n)}
                  className={`h-7 max-w-[200px] shrink-0 truncate rounded-md px-2.5 text-[13px] font-medium ${ring} ${
                    n.id === note.id ? "bg-surface-hover text-fg" : "text-fg-tertiary hover:text-fg"
                  }`}
                >
                  {n.title}
                </button>
              </NoteMenu>
            ))}
            <button
              type="button"
              title="New note · ⌘T"
              aria-label="New note"
              onMouseDown={noFocus}
              onClick={() => setCreating(true)}
              className={`flex size-7 shrink-0 items-center justify-center rounded-md text-fg-tertiary hover:bg-surface-hover hover:text-fg ${ring}`}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-10 pt-8 pb-24">
          {notes.isError ? (
            <p className="text-fg-secondary">Couldn't load the notes: {String(notes.error)}</p>
          ) : (
            note && (
              <Suspense fallback={<p className="description whitespace-pre-wrap text-fg-tertiary">{note.body}</p>}>
                <NotesEditor
                  // Remounting on each note flushes the previous note's pending save.
                  key={note.id}
                  value={note.body}
                  autofocus={note.id === fresh}
                  onSave={(markdown) => actions.save(note.id, markdown).catch((e) => onToast(`Couldn't save the note: ${e}`))}
                  onMakeTickets={(next) => {
                    if (next.drafts.length === 0) return onToast("Put the cursor on a line to make it a ticket");
                    createTickets.reset();
                    setRequest(next);
                  }}
                  onOpenTicket={onOpenTicket}
                  handle={editor}
                />
              </Suspense>
            )
          )}
        </div>
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
      <NameDialog
        open={creating}
        title="New note"
        placeholder="Note name"
        onClose={() => setCreating(false)}
        onSubmit={async (title) => {
          const created = await actions.create(title);
          setSelectedId(created.id);
          setFresh(created.id);
        }}
      />
      <NameDialog
        open={renaming !== null}
        title="Rename note"
        placeholder="Note name"
        initial={renaming?.title}
        onClose={() => setRenaming(null)}
        onSubmit={async (title) => {
          if (renaming) await actions.rename(renaming.id, title);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.title ?? "note"}”?`}
        message="Its text will be deleted. Tickets made from it stay where they are."
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const index = list.findIndex((n) => n.id === deleting.id);
          await actions.remove(deleting.id);
          if (deleting.id === note?.id) setSelectedId((list[index - 1] ?? list[index + 1])?.id ?? null);
        }}
      />
    </div>
  );
}

/** Right-click a tab to rename or delete its note. */
function NoteMenu({
  canDelete,
  onRename,
  onDelete,
  children,
}: {
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content onCloseAutoFocus={noFocus} className={menuPanel}>
          <ContextMenu.Item className={menuItem} onSelect={onRename}>
            Rename…
          </ContextMenu.Item>
          <ContextMenu.Item
            className={`${menuItem} data-[highlighted]:text-status-error`}
            disabled={!canDelete}
            onSelect={onDelete}
          >
            Delete…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
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
