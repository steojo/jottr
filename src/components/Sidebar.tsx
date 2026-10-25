import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { Board, Project } from "../bindings";
import { SWATCH_BG } from "../lib/tickets";
import { ChevronRightIcon, MoreIcon, PlusIcon, ProjectIcon } from "./icons";

export type SidebarAction = { value: string; label: string; run: () => void; destructive?: boolean };
export type SidebarScope = { boardId: string; projectId?: string };
type DragItem = { kind: "board" | "project"; id: string; boardId: string };
type DropTarget = { key: string; before: boolean };
type DragHandle = Pick<ReturnType<typeof useDraggable>, "attributes" | "listeners" | "setActivatorNodeRef">;
const dragKey = (item: DragItem) => `${item.kind}:${item.id}`;

// Board groups move together; projects can only land among projects on their own board.
const sidebarCollisions: CollisionDetection = (args) => {
  const item = args.active.data.current as DragItem;
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const target = container.data.current as DragItem;
      return container.id !== args.active.id && target.kind === item.kind &&
        (item.kind === "board" || target.boardId === item.boardId);
    }),
  });
};

/** The Inbox, My Focus, a board optionally narrowed to one of its projects, the Archive, or Settings. */
export type View =
  | { kind: "inbox" }
  | { kind: "focus" }
  | { kind: "board"; boardId: string; projectId?: string }
  | { kind: "archive" }
  | { kind: "settings" };

// Buttons don't take focus on click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

const item = (active: boolean) =>
  `group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${
    active ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"
  }`;

const menuItem =
  "flex h-7 cursor-default items-center rounded-md px-2 text-fg-secondary outline-none select-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg";

/** Inbox, then boards that expand to show their projects, then Archive and Settings. */
export function Sidebar({
  boards,
  projects,
  view,
  inboxCount,
  focusCount,
  expanded,
  onToggle,
  onNavigate,
  onNewBoard,
  onNewProject,
  onManage,
  boardActions,
  projectActions,
  onReorder,
  reordering,
}: {
  boards: Board[];
  projects: Project[];
  view: View;
  inboxCount: number;
  focusCount: number;
  /** Board IDs whose projects are showing. */
  expanded: string[];
  onToggle: (boardId: string) => void;
  onNavigate: (view: View) => void;
  onNewBoard: () => void;
  onNewProject: (boardId: string) => void;
  onManage: (scope: SidebarScope) => void;
  boardActions: (board: Board) => SidebarAction[];
  projectActions: (project: Project) => SidebarAction[];
  onReorder: (kind: "board" | "project", id: string, beforeId: string | null) => void;
  reordering: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggedBoard = dragging?.kind === "board" ? boards.find((b) => b.id === dragging.id) : undefined;
  const draggedProject = dragging?.kind === "project" ? projects.find((p) => p.id === dragging.id) : undefined;

  function placement(event: Pick<DragOverEvent, "active" | "over">) {
    const item = event.active.data.current as DragItem;
    const target = event.over?.data.current as DragItem | undefined;
    if (!target || target.kind !== item.kind || (item.kind === "project" && item.boardId !== target.boardId)) return null;
    const peers = item.kind === "board" ? boards : projects.filter((p) => p.boardId === item.boardId);
    const from = peers.findIndex((p) => p.id === item.id);
    const to = peers.findIndex((p) => p.id === target.id);
    if (from < 0 || to < 0 || from === to) return null;
    const before = from > to;
    return { key: dragKey(target), before, beforeId: before ? target.id : (peers[to + 1]?.id ?? null) };
  }

  function finishDrag(event: DragEndEvent) {
    const drop = placement(event);
    const item = event.active.data.current as DragItem;
    setDragging(null);
    setDropTarget(null);
    if (drop) onReorder(item.kind, item.id, drop.beforeId);
  }

  const dragName = (item: DragItem) =>
    (item.kind === "board" ? boards : projects).find((p) => p.id === item.id)?.name ?? item.kind;

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-line-subtle font-medium">
      {/* Space for the macOS traffic lights; doubles as a window drag handle. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <nav className="flex flex-col gap-px px-2">
        <button
          type="button"
          title="Inbox · G then I"
          onMouseDown={noFocus}
          onClick={() => onNavigate({ kind: "inbox" })}
          className={item(view.kind === "inbox")}
        >
          Inbox
          {inboxCount > 0 && (
            <span className="ml-auto font-mono text-[11px] font-normal text-fg-tertiary">{inboxCount}</span>
          )}
        </button>
        <button
          type="button"
          title="My Focus · G then F"
          onMouseDown={noFocus}
          onClick={() => onNavigate({ kind: "focus" })}
          className={item(view.kind === "focus")}
        >
          My Focus
          {focusCount > 0 && (
            <span className="ml-auto font-mono text-[11px] font-normal text-fg-tertiary">{focusCount}</span>
          )}
        </button>
      </nav>

      <div className="group flex items-center px-4 pt-5 pb-1.5">
        <span className="font-mono text-[10px] font-normal tracking-wider text-fg-quaternary uppercase">Boards</span>
        <button
          type="button"
          aria-label="New board"
          title="New board"
          onMouseDown={noFocus}
          onClick={onNewBoard}
          className="ml-auto flex size-5 items-center justify-center rounded text-fg-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
        >
          <PlusIcon />
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={sidebarCollisions}
        onDragStart={({ active }) => setDragging(active.data.current as DragItem)}
        onDragOver={(event) => setDropTarget(placement(event))}
        onDragEnd={finishDrag}
        onDragCancel={() => { setDragging(null); setDropTarget(null); }}
        accessibility={{
          screenReaderInstructions: { draggable: "Drag to reorder, or use Command Option Up or Down from the open board or project." },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${dragName(active.data.current as DragItem)}.`,
            onDragOver: ({ active, over }) => {
              if (!over) return "Outside the list. Release to cancel.";
              const drop = placement({ active, over });
              return drop ? `Place ${dragName(active.data.current as DragItem)} ${drop.before ? "before" : "after"} ${dragName(over.data.current as DragItem)}.` : undefined;
            },
            onDragEnd: ({ active, over }) => over ? `Dropped ${dragName(active.data.current as DragItem)}.` : "Reordering canceled.",
            onDragCancel: () => "Reordering canceled.",
          },
        }}
      >
        <nav aria-label="Boards and projects" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
          {boards.map((board) => {
            const open = expanded.includes(board.id);
            const boardProjects = projects.filter((p) => p.boardId === board.id);
            const onBoard = view.kind === "board" && view.boardId === board.id;
            return (
              <SidebarDraggable key={board.id} item={{ kind: "board", id: board.id, boardId: board.id }} target={dropTarget} disabled={reordering}>
                {(handle) => (
                  <>
                    <SidebarMenu actions={boardActions(board)}>
                      <div className={item(onBoard && !view.projectId)}>
                        <button
                          type="button"
                          aria-label={open ? `Hide ${board.name} projects` : `Show ${board.name} projects`}
                          onMouseDown={noFocus}
                          onClick={() => onToggle(board.id)}
                          className="-ml-1 flex size-4 items-center justify-center rounded text-fg-quaternary hover:text-fg"
                        >
                          <span className={open ? "rotate-90" : ""}>
                            <ChevronRightIcon />
                          </span>
                        </button>
                        <button
                          type="button"
                          ref={handle.setActivatorNodeRef}
                          {...handle.attributes}
                          {...handle.listeners}
                          title="Drag to reorder board · ⌘⌥↑ / ⌘⌥↓"
                          onMouseDown={noFocus}
                          onClick={() => onNavigate({ kind: "board", boardId: board.id })}
                          className="flex min-w-0 flex-1 touch-none cursor-grab items-center gap-2 text-left active:cursor-grabbing"
                        >
                          <span className={`size-2 shrink-0 rounded-sm ${SWATCH_BG[board.color]}`} />
                          <span className="truncate">{board.name}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`New project in ${board.name}`}
                          title="New project"
                          onMouseDown={noFocus}
                          onClick={() => onNewProject(board.id)}
                          className="flex size-5 items-center justify-center rounded text-fg-tertiary opacity-0 group-hover:opacity-100 hover:text-fg"
                        >
                          <PlusIcon />
                        </button>
                        <ManageButton name={board.name} onClick={() => onManage({ boardId: board.id })} />
                      </div>
                    </SidebarMenu>
                    {open &&
                      boardProjects.map((project) => (
                        <ProjectItem
                          key={project.id}
                          project={project}
                          active={onBoard && view.projectId === project.id}
                          onOpen={() => onNavigate({ kind: "board", boardId: board.id, projectId: project.id })}
                          onManage={() => onManage({ boardId: board.id, projectId: project.id })}
                          actions={projectActions(project)}
                          target={dropTarget}
                          disabled={reordering}
                        />
                      ))}
                    {open && boardProjects.length === 0 && (
                      <button
                        type="button"
                        onMouseDown={noFocus}
                        onClick={() => onNewProject(board.id)}
                        className={`${item(false)} pl-8 text-fg-tertiary`}
                      >
                        New project
                      </button>
                    )}
                  </>
                )}
              </SidebarDraggable>
            );
          })}
          {boards.length === 0 && (
            <button type="button" onMouseDown={noFocus} onClick={onNewBoard} className={item(false)}>
              <span className="text-fg-tertiary">
                <PlusIcon />
              </span>
              <span className="text-fg-tertiary">New board</span>
            </button>
          )}
        </nav>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {dragging && <div className={`${item(false)} w-[204px] cursor-grabbing border border-line bg-surface-elevated shadow-lg shadow-black/30`}>
              {draggedBoard && <span className={`size-2 shrink-0 rounded-sm ${SWATCH_BG[draggedBoard.color]}`} />}
              {draggedProject && <ProjectIcon />}
              <span className="truncate">{draggedBoard?.name ?? draggedProject?.name}</span>
            </div>}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <nav className="flex flex-col gap-px border-t border-line-subtle px-2 py-2">
        <button
          type="button"
          title="Archive · G then A"
          onMouseDown={noFocus}
          onClick={() => onNavigate({ kind: "archive" })}
          className={item(view.kind === "archive")}
        >
          Archive
        </button>
        <button
          type="button"
          title="Settings · ⌘,"
          onMouseDown={noFocus}
          onClick={() => onNavigate({ kind: "settings" })}
          className={item(view.kind === "settings")}
        >
          Settings
        </button>
      </nav>
    </aside>
  );
}

/** A project under its board, with the same actions by mouse and keyboard. */
function ProjectItem({
  project,
  active,
  onOpen,
  onManage,
  actions,
  target,
  disabled,
}: {
  project: Project;
  active: boolean;
  onOpen: () => void;
  onManage: () => void;
  actions: SidebarAction[];
  target: DropTarget | null;
  disabled: boolean;
}) {
  return (
    <SidebarDraggable item={{ kind: "project", id: project.id, boardId: project.boardId }} target={target} disabled={disabled}>
      {(handle) => (
        <SidebarMenu actions={actions}>
          <div className={`${item(active)} pl-8`}>
            <button
              type="button"
              ref={handle.setActivatorNodeRef}
              {...handle.attributes}
              {...handle.listeners}
              title="Drag to reorder project · ⌘⌥↑ / ⌘⌥↓"
              onMouseDown={noFocus}
              onClick={onOpen}
              className="flex min-w-0 flex-1 touch-none cursor-grab items-center gap-2 text-left active:cursor-grabbing"
            >
              <span className="text-fg-tertiary"><ProjectIcon /></span>
              <span className="truncate">{project.name}</span>
            </button>
            <ManageButton name={project.name} onClick={onManage} />
          </div>
        </SidebarMenu>
      )}
    </SidebarDraggable>
  );
}

/** The original group stays in place while a lightweight overlay follows the pointer. */
function SidebarDraggable({ item, target, disabled, children }: {
  item: DragItem;
  target: DropTarget | null;
  disabled: boolean;
  children: (handle: DragHandle) => ReactNode;
}) {
  const key = dragKey(item);
  const drag = useDraggable({ id: key, data: item, disabled });
  const drop = useDroppable({ id: key, data: item, disabled });
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }, [drag.setNodeRef, drop.setNodeRef]);
  return (
    <div ref={setNodeRef} data-sidebar-id={item.id} className={`relative flex flex-col gap-px ${drag.isDragging ? "opacity-30" : ""}`}>
      {children(drag)}
      {target?.key === key && <div aria-hidden className={`pointer-events-none absolute right-0 left-0 z-10 border-t-2 border-fg-tertiary ${target.before ? "-top-px" : "-bottom-px"}`} />}
    </div>
  );
}

function ManageButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Manage ${name}`}
      title="Manage board or project · G then M"
      onMouseDown={noFocus}
      onClick={onClick}
      className="flex size-5 shrink-0 items-center justify-center rounded text-fg-tertiary outline-none hover:bg-surface-elevated hover:text-fg focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
    >
      <MoreIcon />
    </button>
  );
}

function SidebarMenu({ actions, children }: { actions: SidebarAction[]; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 min-w-40 rounded-lg border border-line bg-surface-elevated p-1 shadow-2xl shadow-black/50"
        >
          {actions.map((action) => (
            <ContextMenu.Item key={action.value} className={`${menuItem} ${action.destructive ? "data-[highlighted]:text-status-error" : ""}`} onSelect={action.run}>
              {action.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
