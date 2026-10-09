import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Board, Project, Ticket } from "../bindings";
import { useLabels, useUpdateTicket } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import { PRIORITIES, SWATCH_BG, formatDue, isOverdue, patch, statusLabel, type Destination } from "../lib/tickets";
import { Checklist } from "./Checklist";
import { LabelChip } from "./Labels";
import { PriorityIcon, ProjectIcon, StatusIcon } from "./icons";
import { TicketPickers, type PickerKind } from "./TicketPickers";
import { Kbd } from "./ui";

const DescriptionEditor = lazy(() => import("./DescriptionEditor"));

/** PRD §6.8: the title is the interface; properties sit in a right-hand column. */
export function TicketPage({
  ticket,
  boards,
  projects,
  onClose,
  onStep,
  onMove,
}: {
  ticket: Ticket;
  boards: Board[];
  projects: Project[];
  onClose: () => void;
  /** Opens the next (1) or previous (-1) ticket in the list. */
  onStep: (delta: 1 | -1) => void;
  onMove: (ticket: Ticket, to: Destination) => void;
}) {
  const [picker, setPicker] = useState<PickerKind | null>(null);
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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto">
        {/* Keyed by ticket so moving with J/K remounts the editors, saving any pending edits. */}
        <div key={ticket.id} className="mx-auto flex max-w-[720px] flex-col gap-6 px-10 pt-8 pb-24">
          <Title ticket={ticket} onSave={(title) => update.mutate({ ticket, patch: patch({ title }) })} />
          <Suspense fallback={<p className="description text-fg-tertiary">{ticket.description || "Add a description…"}</p>}>
            <DescriptionEditor
              value={ticket.description}
              onSave={(description) => update.mutate({ ticket, patch: patch({ description }) })}
            />
          </Suspense>
          <Checklist ticket={ticket} />
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
