import * as ContextMenu from "@radix-ui/react-context-menu";
import type { MouseEvent } from "react";

import type { Board, Project } from "../bindings";
import { SWATCH_BG } from "../lib/tickets";
import { ChevronRightIcon, PlusIcon, ProjectIcon } from "./icons";

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

/** PRD §6.7: Inbox, then boards that expand to show their projects, then Archive and Settings. */
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
  onRenameProject,
  onDeleteProject,
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
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
}) {
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
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {boards.map((board) => {
          const open = expanded.includes(board.id);
          const boardProjects = projects.filter((p) => p.boardId === board.id);
          const onBoard = view.kind === "board" && view.boardId === board.id;
          return (
            <div key={board.id} className="flex flex-col gap-px">
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
                  onMouseDown={noFocus}
                  onClick={() => onNavigate({ kind: "board", boardId: board.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
              </div>
              {open &&
                boardProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    active={onBoard && view.projectId === project.id}
                    onOpen={() => onNavigate({ kind: "board", boardId: board.id, projectId: project.id })}
                    onRename={() => onRenameProject(project)}
                    onDelete={() => onDeleteProject(project)}
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
            </div>
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

/** A project under its board. Right-click to rename or delete. */
function ProjectItem({
  project,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  project: Project;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button type="button" onMouseDown={noFocus} onClick={onOpen} className={`${item(active)} pl-8`}>
          <span className="text-fg-tertiary">
            <ProjectIcon />
          </span>
          <span className="truncate">{project.name}</span>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 min-w-40 rounded-lg border border-line bg-surface-elevated p-1 shadow-2xl shadow-black/50"
        >
          <ContextMenu.Item className={menuItem} onSelect={onRename}>
            Rename…
          </ContextMenu.Item>
          <ContextMenu.Item className={`${menuItem} data-[highlighted]:text-status-error`} onSelect={onDelete}>
            Delete…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
