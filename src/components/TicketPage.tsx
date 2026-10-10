import { listen, TauriEvent } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Board, Project, Ticket } from "../bindings";
import { useLabels, useUpdateTicket, type AttachSource } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import {
  PRIORITIES,
  SWATCH_BG,
  formatDue,
  isOverdue,
  patch,
  statusLabel,
  ticketKey,
  type Destination,
} from "../lib/tickets";
import { Attachments } from "./Attachments";
import { Checklist } from "./Checklist";
import { LabelChip } from "./Labels";
import { PriorityIcon, ProjectIcon, StatusIcon } from "./icons";
import { TicketPickers, type PickerKind } from "./TicketPickers";
import { Kbd } from "./ui";

const DescriptionEditor = lazy(() => import("./DescriptionEditor"));

/** The title is the interface; properties sit in a right-hand column. */
export function TicketPage({
  ticket,
  boards,
  projects,
  onClose,
  onStep,
  onMove,
  onDelete,
  onRestore,
  onAttach,
  onPickFiles,
}: {
  ticket: Ticket;
  boards: Board[];
  projects: Project[];
  onClose: () => void;
  /** Opens the next (1) or previous (-1) ticket in the list. */
  onStep: (delta: 1 | -1) => void;
  onMove: (ticket: Ticket, to: Destination) => void;
  onDelete: (ticket: Ticket) => void;
  onRestore: (ticket: Ticket) => void;
  onAttach: (ticket: Ticket, source: AttachSource) => void;
  /** Opens the file picker to attach files. */
  onPickFiles: (ticket: Ticket) => void;
}) {
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // Files are being dragged over the window.
  const [dropping, setDropping] = useState(false);
  const latest = useRef({ ticket, onAttach });
  latest.current = { ticket, onAttach };
  const update = useUpdateTicket();
  const board = boards.find((b) => b.id === ticket.boardId);
  const project = projects.find((p) => p.id === ticket.projectId);
  const labels = (useLabels().data ?? []).filter((l) => ticket.labelIds.includes(l.id));

  useShortcuts({
    escape: onClose,
    j: () => onStep(1),
    k: () => onStep(-1),
    s: () => setPicker("status"),
    p: () => setPicker("priority"),
    d: () => setPicker("due"),
    l: () => setPicker("labels"),
    m: () => setPicker("move"),
  });

  // Files dropped anywhere on the window, or pasted anywhere on the page, are attached.
  useEffect(() => {
    // Listened to directly: the webview module's wrapper for these adds ~25 KB.
    type Drag = { paths: string[] };
    const listeners = [
      listen<Drag>(TauriEvent.DRAG_ENTER, (e) => setDropping(e.payload.paths.length > 0)),
      listen(TauriEvent.DRAG_LEAVE, () => setDropping(false)),
      listen<Drag>(TauriEvent.DRAG_DROP, ({ payload }) => {
        setDropping(false);
        if (payload.paths.length > 0) latest.current.onAttach(latest.current.ticket, { paths: payload.paths });
      }),
    ];

    // Capturing, so a pasted image is attached before the description editor sees it.
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onAttach(latest.current.ticket, { files });
    }
    window.addEventListener("paste", onPaste, true);

    return () => {
      for (const unlisten of listeners) void unlisten.then((stop) => stop());
      window.removeEventListener("paste", onPaste, true);
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1">
      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface/80">
          <span className="font-medium text-fg-secondary">Drop to attach to {ticketKey(ticket) ?? "this ticket"}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {/* Keyed by ticket so moving with J/K remounts the editors, saving any pending edits. */}
        <div key={ticket.id} className="mx-auto flex max-w-[720px] flex-col gap-6 px-10 pt-8 pb-24">
          {ticket.archivedAt !== null && (
            <div className="flex h-9 items-center gap-2 rounded-md border border-line-subtle pr-1 pl-3 text-fg-secondary">
              <span className="flex-1">
                Archived on{" "}
                {new Date(ticket.archivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <button
                type="button"
                title="Restore · A"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onRestore(ticket)}
                className="h-7 rounded-md px-2.5 font-medium text-fg hover:bg-surface-hover"
              >
                Restore
              </button>
            </div>
          )}
          <Title ticket={ticket} onSave={(title) => update.mutate({ ticket, patch: patch({ title }) })} />
          <Suspense fallback={<p className="description text-fg-tertiary">{ticket.description || "Add a description…"}</p>}>
            <DescriptionEditor
              value={ticket.description}
              onSave={(description) => update.mutate({ ticket, patch: patch({ description }) })}
            />
          </Suspense>
          <Checklist ticket={ticket} />
          <Attachments ticket={ticket} onAdd={() => onPickFiles(ticket)} />
        </div>
      </div>

      <aside className="flex w-64 shrink-0 flex-col gap-px border-l border-line-subtle px-2 py-5">
        <div className="px-2 pb-2 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Properties</div>
        <Property label="Status" shortcut="S" onClick={() => setPicker("status")}>
          <StatusIcon status={ticket.status} />
          {statusLabel(ticket.status)}
        </Property>
        <Property label="Priority" shortcut="P" onClick={() => setPicker("priority")}>
          <PriorityIcon priority={ticket.priority} />
          {PRIORITIES.find((p) => p.value === ticket.priority)!.label}
        </Property>
        <Property label="Labels" shortcut="L" onClick={() => setPicker("labels")}>
          {labels.length > 0 ? (
            <span className="flex flex-wrap justify-end gap-1 py-1">
              {labels.map((l) => (
                <LabelChip key={l.id} label={l} />
              ))}
            </span>
          ) : (
            <span className="text-fg-quaternary">None</span>
          )}
        </Property>
        <Property label="Due date" shortcut="D" onClick={() => setPicker("due")}>
          {ticket.dueDate ? (
            <span className={isOverdue(ticket) ? "text-status-error" : ""}>{formatDue(ticket.dueDate)}</span>
          ) : (
            <span className="text-fg-quaternary">Not set</span>
          )}
        </Property>
        <Property label="Board" shortcut="M" onClick={() => setPicker("move")}>
          {board && <span className={`size-2 rounded-sm ${SWATCH_BG[board.color]}`} />}
          {board ? board.name : "Inbox"}
        </Property>
        {board && (
          <Property label="Project" shortcut="M" onClick={() => setPicker("move")}>
            {project ? (
              <>
                <span className="text-fg-tertiary">
                  <ProjectIcon />
                </span>
                <span className="truncate">{project.name}</span>
              </>
            ) : (
              <span className="text-fg-quaternary">None</span>
            )}
          </Property>
        )}
        <button
          type="button"
          title="Delete ticket · ⌘⌫"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onDelete(ticket)}
          className="mt-auto flex h-8 items-center rounded-md px-2 text-left text-fg-tertiary hover:bg-surface-hover hover:text-status-error"
        >
          Delete ticket
        </button>
      </aside>

      <TicketPickers ticket={ticket} boards={boards} projects={projects} kind={picker} onClose={() => setPicker(null)} onMove={onMove} />
    </div>
  );
}

/** Label on the left, value right-aligned so an empty one stands out. */
function Property({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={`Change ${label.toLowerCase()} · ${shortcut}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex min-h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover"
    >
      <span className="w-16 shrink-0 text-fg-tertiary">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">{children}</span>
      <span className="hidden group-hover:inline-flex">
        <Kbd>{shortcut}</Kbd>
      </span>
    </button>
  );
}

/** The only text above 15px in the app. Enter or blur saves; Esc reverts. */
function Title({ ticket, onSave }: { ticket: Ticket; onSave: (title: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(ticket.title);
  const reverting = useRef(false);

  // Grow to fit wrapped lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function commit() {
    const title = value.trim();
    if (reverting.current || !title) {
      reverting.current = false;
      setValue(ticket.title);
    } else if (title !== ticket.title) {
      onSave(title);
    }
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          reverting.current = true;
          e.currentTarget.blur();
        }
      }}
      className="resize-none overflow-hidden bg-transparent text-[20px] leading-snug font-semibold outline-none select-text"
    />
  );
}
