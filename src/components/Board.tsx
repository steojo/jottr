import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Board as BoardModel, Label, Project, Status, Ticket } from "../bindings";
import { useLabels, useRepositionTicket, useUpdateTicket } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import { usePersistentState } from "../lib/storage";
import {
  adjacentStatus,
  BOARD_ORDER,
  boardColumns,
  dropPosition,
  formatDue,
  groupByCompletionDay,
  isFinished,
  isOverdue,
  patch,
  statusLabel,
  ticketKey,
  type Destination,
} from "../lib/tickets";
import { ChecklistProgress } from "./Checklist";
import { ChevronRightIcon, PlusIcon, PriorityIcon, ProjectIcon, StatusIcon } from "./icons";
import { LabelChips } from "./Labels";
import { TicketMenu } from "./TicketMenu";
import { TicketPickers, type PickerKind } from "./TicketPickers";
import { IconButton } from "./ui";

type Columns = Record<Status, string[]>;

const isColumn = (id: UniqueIdentifier) => BOARD_ORDER.includes(id as Status);

// Cards change columns mid-drag, so drop targets are re-measured after every change.
const measuring = { droppable: { strategy: MeasuringStrategy.Always } };

// Done is ordered by completion, so its cards never shift to make room.
const noSorting: SortingStrategy = () => null;

/** PRD §6.6: status columns, drag and drop or keyboard, collapsible columns, Done grouped by day. */
export function Board({
  boardId,
  tickets,
  boards,
  projects,
  showProject,
  activeId,
  onActiveChange,
  onOpen,
  onCreate,
  onMove,
  onDelete,
}: {
  boardId: string;
  tickets: Ticket[] | undefined;
  boards: BoardModel[];
  projects: Project[];
  /** Off inside a project, where every card would show the same one. */
  showProject: boolean;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  onOpen: (ticket: Ticket) => void;
  onCreate: (status: Status) => void;
  onMove: (ticket: Ticket, to: Destination) => void;
  onDelete: (ticket: Ticket) => void;
}) {
  const [collapsed, setCollapsed] = usePersistentState<Status[]>(`jottr.collapsed.${boardId}`, ["canceled"]);
  // Keyboard focus ring only shows after keyboard navigation, never after a click.
  const [keyboard, setKeyboard] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // While dragging, cards are rearranged locally so the drop target follows the pointer.
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const update = useUpdateTicket();
  const reposition = useRepositionTicket();
  const labels = useLabels().data ?? [];

  const columns = useMemo(() => boardColumns(tickets ?? []), [tickets]);
  const byId = useMemo(() => new Map((tickets ?? []).map((t) => [t.id, t])), [tickets]);
  const ids: Columns =
    dragColumns ?? (Object.fromEntries(columns.map((c) => [c.status, c.tickets.map((t) => t.id)])) as Columns);
  const visible = columns.filter((c) => !collapsed.includes(c.status));
  const active = activeId ? byId.get(activeId) : undefined;

  // Drags start after 5px of movement, so a plain click still opens the ticket.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // After a drop, the dropped layout stays until the saved order reaches the cache, so the card doesn't flash back.
  useEffect(() => {
    if (!dragId) setDragColumns(null);
  }, [tickets]);

  useEffect(() => {
    if (keyboard && activeId) cards.current.get(activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, keyboard, columns]);

  function select(ticket: Ticket) {
    setKeyboard(false);
    onActiveChange(ticket.id);
  }

  /** Moves the selection within a column (rows) or across visible columns (cols). */
  function navigate(rows: number, cols: number) {
    setKeyboard(true);
    const filled = visible.filter((c) => c.tickets.length > 0);
    if (filled.length === 0) return;
    let c = filled.findIndex((col) => col.tickets.some((t) => t.id === activeId));
    if (c === -1) return onActiveChange(filled[0].tickets[0].id);
    let r = filled[c].tickets.findIndex((t) => t.id === activeId);
    if (cols) {
      c = Math.min(filled.length - 1, Math.max(0, c + cols));
      r = Math.min(r, filled[c].tickets.length - 1);
    } else {
      r = Math.min(filled[c].tickets.length - 1, Math.max(0, r + rows));
    }
    onActiveChange(filled[c].tickets[r].id);
  }

  function shiftStatus(delta: 1 | -1) {
    const status = active && adjacentStatus(active.status, delta);
    if (active && status) update.mutate({ ticket: active, patch: patch({ status }) });
  }

  useShortcuts({
    j: () => navigate(1, 0),
    arrowdown: () => navigate(1, 0),
    k: () => navigate(-1, 0),
    arrowup: () => navigate(-1, 0),
    arrowright: () => navigate(0, 1),
    arrowleft: () => navigate(0, -1),
    "[": () => shiftStatus(-1),
    "]": () => shiftStatus(1),
    enter: () => active && onOpen(active),
    s: () => active && setPicker("status"),
    p: () => active && setPicker("priority"),
    d: () => active && setPicker("due"),
    l: () => active && setPicker("labels"),
    m: () => active && setPicker("move"),
    escape: () => onActiveChange(null),
  });

  const columnOf = (id: string, cols: Columns) =>
    (Object.keys(cols) as Status[]).find((s) => s === id || cols[s].includes(id));

  /**
   * Targets follow the pointer: the column under it, then the card under it or the nearest card in
   * that column. Between columns the last target holds. (Corner distance let tall, empty columns lose
   * to the cards beside them.)
   */
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const column = hits.find((hit) => isColumn(hit.id));
    if (column) {
      const inColumn = (id: UniqueIdentifier) => ids[column.id as Status].includes(String(id));
      const card =
        hits.find((hit) => inColumn(hit.id)) ??
        closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => inColumn(c.id)) })[0];
      lastOver.current = (card ?? column).id;
    }
    return lastOver.current === null ? [] : [{ id: lastOver.current }];
  };

  function onDragStart({ active: dragged }: DragStartEvent) {
    lastOver.current = null;
    setDragId(String(dragged.id));
    setDragColumns(ids);
  }

  // Moving into another column happens live, so the drop target shows where the card will land.
  function onDragOver({ active: dragged, over }: DragOverEvent) {
    if (!over) return;
    const id = String(dragged.id);
    const overId = String(over.id);
    setDragColumns((cols) => {
      const from = cols && columnOf(id, cols);
      const to = cols && columnOf(overId, cols);
      if (!cols || !from || !to || from === to) return cols;
      const target = cols[to];
      // Done is ordered by completion, newest first, so that's where the card will land.
      const index = to === "done" ? 0 : target.includes(overId) ? target.indexOf(overId) : target.length;
      return {
        ...cols,
        [from]: cols[from].filter((x) => x !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      };
    });
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    const cols = dragColumns;
    setDragId(null);
    const ticket = byId.get(String(dragged.id));
    if (!over || !cols || !ticket) return setDragColumns(null);

    const status = columnOf(String(dragged.id), cols)!;
    let list = cols[status];
    const from = list.indexOf(ticket.id);
    const to = list.indexOf(String(over.id));
    if (status !== "done" && to !== -1 && from !== to) list = arrayMove(list, from, to);

    const position = dropPosition(list, ticket.id, status, byId);
    const moved = status === "done" ? ticket.status !== "done" : status !== ticket.status || position !== ticket.position;
    if (moved) {
      // Keeps the dropped layout until the cache updates (see the effect above).
      setDragColumns(list === cols[status] ? cols : { ...cols, [status]: list });
      reposition.mutate({ ticket, status, position });
    } else {
      setDragColumns(null);
    }
    select(ticket);
  }

  if (tickets === undefined) return <div className="flex-1" />;

  const dragged = dragId ? byId.get(dragId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={measuring}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragColumns(null);
        setDragId(null);
      }}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {columns.map(({ status }) => {
          const columnTickets = ids[status].map((id) => byId.get(id)!).filter(Boolean);
          if (collapsed.includes(status)) {
            return (
              <CollapsedColumn
                key={status}
                status={status}
                count={columnTickets.length}
                onExpand={() => setCollapsed((c) => c.filter((s) => s !== status))}
              />
            );
          }
          return (
            <Column
              key={status}
              status={status}
              tickets={columnTickets}
              // Day groups only make sense once cards have settled.
              groupByDay={status === "done" && !dragColumns}
              onCreate={() => onCreate(status)}
              onCollapse={() => setCollapsed((c) => [...c, status])}
              renderCard={(ticket) => (
                <TicketMenu
                  key={ticket.id}
                  ticket={ticket}
                  boards={boards}
                  projects={projects}
                  onOpen={() => select(ticket)}
                  onStatus={(s) => update.mutate({ ticket, patch: patch({ status: s }) })}
                  onPriority={(priority) => update.mutate({ ticket, patch: patch({ priority }) })}
                  onMove={(target) => onMove(ticket, target)}
                  onDelete={() => onDelete(ticket)}
                >
                  <SortableCard
                    ticket={ticket}
                    project={showProject ? projects.find((p) => p.id === ticket.projectId) : undefined}
                    labels={labels}
                    active={ticket.id === activeId}
                    keyboard={keyboard}
                    cardRef={(el) => {
                      if (el) cards.current.set(ticket.id, el);
                      else cards.current.delete(ticket.id);
                    }}
                    onClick={() => {
                      select(ticket);
                      onOpen(ticket);
                    }}
                    onPick={(kind) => {
                      select(ticket);
                      setPicker(kind);
                    }}
                  />
                </TicketMenu>
              )}
            />
          );
        })}
      </div>

      {/* No drop animation: the card lands instantly; only the drop target fades in. */}
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <Card
            ticket={dragged}
            project={showProject ? projects.find((p) => p.id === dragged.projectId) : undefined}
            labels={labels}
            active={false}
            keyboard={false}
            lifted
          />
        )}
      </DragOverlay>

      <TicketPickers ticket={active} boards={boards} projects={projects} kind={picker} onClose={() => setPicker(null)} onMove={onMove} />
    </DndContext>
  );
}

function Column({
  status,
  tickets,
  groupByDay,
  onCreate,
  onCollapse,
  renderCard,
}: {
  status: Status;
  tickets: Ticket[];
  groupByDay: boolean;
  onCreate: () => void;
  onCollapse: () => void;
  renderCard: (ticket: Ticket) => ReactNode;
}) {
  // The whole column accepts drops, header included, so empty columns work too.
  const { setNodeRef } = useDroppable({ id: status });
  const label = statusLabel(status);

  return (
    <section ref={setNodeRef} className="flex max-w-[320px] min-w-[240px] flex-1 flex-col rounded-xl bg-surface-elevated/40">
      <div className="group flex h-10 shrink-0 items-center gap-2 px-3 font-medium">
        <StatusIcon status={status} />
        {label}
        <span className="font-mono text-[11px] font-normal text-fg-tertiary">{tickets.length}</span>
        <span className="ml-auto flex items-center opacity-0 group-hover:opacity-100">
          <IconButton title={`New ${label} ticket`} onClick={onCreate}>
            <span className="flex size-4 items-center justify-center text-fg-tertiary hover:text-fg">
              <PlusIcon />
            </span>
          </IconButton>
          <IconButton title={`Collapse ${label}`} onClick={onCollapse}>
            <span className="flex size-4 rotate-180 items-center justify-center text-fg-tertiary hover:text-fg">
              <ChevronRightIcon />
            </span>
          </IconButton>
        </span>
      </div>
      <SortableContext
        items={tickets.map((t) => t.id)}
        strategy={status === "done" ? noSorting : verticalListSortingStrategy}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {groupByDay
            ? groupByCompletionDay(tickets).map((day) => (
                <div key={day.label} className="flex flex-col gap-2">
                  <div className="flex h-6 items-end gap-1.5 px-1 font-mono text-[10px] tracking-wider text-fg-tertiary uppercase">
                    {day.label}
                    <span className="text-fg-quaternary">{day.tickets.length}</span>
                  </div>
                  {day.tickets.map(renderCard)}
                </div>
              ))
            : tickets.map(renderCard)}
        </div>
      </SortableContext>
    </section>
  );
}

/** A collapsed column: a thin strip with its name written sideways. Still accepts drops. */
function CollapsedColumn({ status, count, onExpand }: { status: Status; count: number; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = statusLabel(status);
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={`Expand ${label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onExpand}
      className={`flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl py-3 hover:bg-surface-hover ${
        isOver ? "bg-surface-hover" : "bg-surface-elevated/40"
      }`}
    >
      <StatusIcon status={status} />
      <span className="font-mono text-[11px] text-fg-tertiary">{count}</span>
      <span className="font-medium text-fg-secondary [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}

function SortableCard({
  ticket,
  project,
  labels,
  active,
  keyboard,
  cardRef,
  onClick,
  onPick,
}: {
  ticket: Ticket;
  project: Project | undefined;
  labels: Label[];
  active: boolean;
  keyboard: boolean;
  cardRef: (el: HTMLElement | null) => void;
  onClick: () => void;
  onPick: (kind: PickerKind) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({ id: ticket.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        cardRef(el);
      }}
      {...attributes}
      {...listeners}
      // Cards jump straight to their new place; no transition (PRD §6.9).
      style={{ transform: CSS.Translate.toString(transform) }}
      className="outline-none"
    >
      {isDragging ? (
        // The drop target: where the card will land.
        <div className="animate-drop-target rounded-lg border border-dashed border-line-strong motion-reduce:animate-none">
          <div className="invisible">
            <Card ticket={ticket} project={project} labels={labels} active={false} keyboard={false} />
          </div>
        </div>
      ) : (
        <Card
          ticket={ticket}
          project={project}
          labels={labels}
          active={active}
          keyboard={keyboard}
          onClick={onClick}
          onPick={onPick}
        />
      )}
    </div>
  );
}

/** Project (if any), title up to two lines, then a meta row (PRD §6.6). */
function Card({
  ticket,
  project,
  labels,
  active,
  keyboard,
  lifted,
  onClick,
  onPick,
}: {
  ticket: Ticket;
  project: Project | undefined;
  labels: Label[];
  active: boolean;
  keyboard: boolean;
  /** The copy that follows the pointer while dragging. */
  lifted?: boolean;
  onClick?: () => void;
  onPick?: (kind: PickerKind) => void;
}) {
  const key = ticketKey(ticket);
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-lg border px-3 py-2.5 group-data-[state=open]/menu:bg-surface-hover ${
        lifted
          ? "border-line-strong bg-surface-hover shadow-2xl shadow-black/60"
          : active
            ? "border-line bg-surface-hover"
            : "border-line-subtle bg-surface-elevated hover:bg-surface-hover"
      }`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      {active && keyboard && (
        <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1.5px_var(--color-accent)]" />
      )}
      {project && (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-fg-tertiary">
          <ProjectIcon />
          <span className="truncate">{project.name}</span>
        </div>
      )}
      <p className={`line-clamp-2 leading-snug ${isFinished(ticket) ? "text-fg-tertiary" : ""}`}>{ticket.title}</p>
      <div className="mt-2 flex items-center gap-2">
        {onPick ? (
          <IconButton title="Change priority · P" onClick={() => onPick("priority")}>
            <PriorityIcon priority={ticket.priority} />
          </IconButton>
        ) : (
          <PriorityIcon priority={ticket.priority} />
        )}
        {key && <span className="font-mono text-[11px] text-fg-tertiary">{key}</span>}
        <LabelChips ids={ticket.labelIds} labels={labels} max={2} />
        {ticket.checklistTotal > 0 && <ChecklistProgress done={ticket.checklistDone} total={ticket.checklistTotal} />}
        {ticket.dueDate && (
          <span
            className={`ml-auto font-mono text-[11px] ${isOverdue(ticket) ? "text-status-error" : "text-fg-tertiary"}`}
          >
            {formatDue(ticket.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}
