import { useMemo, useRef, useState, type ReactNode } from "react";

import type { Project, Status, Ticket } from "./bindings";
import { Board } from "./components/Board";
import { CreateBoardDialog } from "./components/CreateBoardDialog";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { ConfirmDialog, NameDialog } from "./components/FormDialogs";
import { ChevronUpDownIcon, ProjectIcon } from "./components/icons";
import { Picker } from "./components/Picker";
import { Sidebar, type View } from "./components/Sidebar";
import { TicketList } from "./components/TicketList";
import { TicketPage } from "./components/TicketPage";
import {
  useBoards,
  useCreateProject,
  useDeleteProject,
  useMoveTicket,
  useProjects,
  useRenameProject,
  useTickets,
} from "./lib/queries";
import { useShortcuts } from "./lib/shortcuts";
import { usePersistentState } from "./lib/storage";
import { SWATCH_BG, boardColumns, groupTickets, ticketKey, type Destination } from "./lib/tickets";

function App() {
  const [view, setView] = useState<View>({ kind: "inbox" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The ticket shown on the ticket page; `null` shows the list.
  const [openId, setOpenId] = useState<string | null>(null);
  // Status for the new ticket; `null` when the dialog is closed.
  const [creating, setCreating] = useState<Status | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [switchingBoard, setSwitchingBoard] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [naming, setNaming] = useState<{ boardId: string } | { project: Project } | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [expanded, setExpanded] = usePersistentState<string[]>("jottr.sidebar.expanded", []);

  const boards = useBoards().data ?? [];
  const projects = useProjects().data ?? [];
  const board = view.kind === "board" ? boards.find((b) => b.id === view.boardId) : undefined;
  const project = view.kind === "board" ? projects.find((p) => p.id === view.projectId) : undefined;
  const boardTickets = useTickets(view.kind === "board" ? view.boardId : null).data;
  // A project is a filter over its board's tickets.
  const tickets = useMemo(
    () => (project ? boardTickets?.filter((t) => t.projectId === project.id) : boardTickets),
    [boardTickets, project],
  );
  const createProject = useCreateProject();
  const renameProject = useRenameProject();
  const deleteProject = useDeleteProject();
  const inboxCount = useTickets(null).data?.length ?? 0;
  const move = useMoveTicket();
  // Each board remembers list or board layout; the Inbox is always a list.
  const [layout, setLayout] = usePersistentState<"list" | "board">(
    `jottr.layout.${view.kind === "board" ? view.boardId : "inbox"}`,
    "board",
  );
  const showBoard = view.kind === "board" && layout === "board";

  const groups = useMemo(() => tickets && groupTickets(tickets, view.kind === "board"), [tickets, view.kind]);
  // The order J/K follow on the ticket page matches what's on screen.
  const order = useMemo(
    () => (showBoard ? boardColumns(tickets ?? []) : (groups ?? [])).flatMap((g) => g.tickets),
    [showBoard, tickets, groups],
  );

  // While a moved ticket travels between lists it's briefly in neither; keep showing it.
  const lastOpen = useRef<Ticket | null>(null);
  const openTicket = order.find((t) => t.id === openId) ?? (lastOpen.current?.id === openId ? lastOpen.current : null);
  lastOpen.current = openTicket;

  function navigate(next: View) {
    setView(next);
    setActiveId(null);
    setOpenId(null);
  }

  function open(ticket: Ticket) {
    setActiveId(ticket.id);
    setOpenId(ticket.id);
  }

  function step(delta: 1 | -1) {
    const next = order[order.findIndex((t) => t.id === openId) + delta];
    if (next) open(next);
  }

  function moveTicket(ticket: Ticket, to: Destination) {
    move.mutate({ ticket, to });
    const staysInView = to.boardId === ticket.boardId && (!project || to.projectId === project.id);
    if (staysInView) return;
    if (ticket.id === openId) {
      // An open ticket travels with you to where it went.
      setView(to.boardId ? { kind: "board", boardId: to.boardId, projectId: to.projectId ?? undefined } : { kind: "inbox" });
    } else if (ticket.id === activeId) {
      // In the list, the selection passes to a neighbour.
      const i = order.findIndex((t) => t.id === ticket.id);
      setActiveId((order[i + 1] ?? order[i - 1])?.id ?? null);
    }
  }

  useShortcuts({
    c: () => setCreating("backlog"),
    "g i": () => navigate({ kind: "inbox" }),
    "g b": () => boards.length > 0 && setSwitchingBoard(true),
    "g p": () => projects.some((p) => p.boardId === board?.id) && setSwitchingProject(true),
    "mod+\\": () => setSidebarOpen((o) => !o),
    "mod+b": () => view.kind === "board" && setLayout(showBoard ? "list" : "board"),
  });

  const position = openTicket ? order.findIndex((t) => t.id === openTicket.id) : -1;
  const scopeLabel = (
    <>
      {board && <span className={`size-2 rounded-sm ${SWATCH_BG[board.color]}`} />}
      {board ? board.name : "Inbox"}
      {project && (
        <>
          <span className="text-fg-quaternary">/</span>
          <span className="text-fg-tertiary">
            <ProjectIcon />
          </span>
          {project.name}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-full select-none">
      {sidebarOpen && (
        <Sidebar
          boards={boards}
          projects={projects}
          view={view}
          inboxCount={inboxCount}
          expanded={expanded}
          onToggle={(id) => setExpanded((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
          onNavigate={navigate}
          onNewBoard={() => setCreatingBoard(true)}
          onNewProject={(boardId) => setNaming({ boardId })}
          onRenameProject={(p) => setNaming({ project: p })}
          onDeleteProject={setDeleting}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Clears the traffic lights when the sidebar is hidden. Labels ignore clicks so the bar stays draggable. */}
        <header
          data-tauri-drag-region
          className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-line-subtle pr-3 ${
            sidebarOpen ? "pl-4" : "pl-20"
          }`}
        >
          {openTicket ? (
            <>
              <HeaderButton title="Back to list · Esc" onClick={() => setOpenId(null)}>
                <span className="flex items-center gap-2 font-medium text-fg-secondary">{scopeLabel}</span>
              </HeaderButton>
              <span className="pointer-events-none text-fg-quaternary">/</span>
              <span className="pointer-events-none font-mono text-[11px] text-fg-secondary">
                {ticketKey(openTicket) ?? "Ticket"}
              </span>
              <span className="pointer-events-none ml-auto font-mono text-[11px] text-fg-tertiary">
                {position + 1} / {order.length}
              </span>
              <HeaderButton title="Previous · K" disabled={position <= 0} onClick={() => step(-1)}>
                <ChevronUpDownIcon direction="up" />
              </HeaderButton>
              <HeaderButton title="Next · J" disabled={position >= order.length - 1} onClick={() => step(1)}>
                <ChevronUpDownIcon direction="down" />
              </HeaderButton>
            </>
          ) : (
            <>
              <span className="pointer-events-none flex items-center gap-2 font-medium">{scopeLabel}</span>
              {view.kind === "board" && (
                <div className="ml-auto flex rounded-md border border-line p-px">
                  {(["list", "board"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      title={`${option === "list" ? "List" : "Board"} view · ⌘B`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setLayout(option)}
                      className={`h-6 rounded px-2.5 text-[12px] font-medium ${
                        layout === option ? "bg-surface-hover text-fg" : "text-fg-tertiary hover:text-fg"
                      }`}
                    >
                      {option === "list" ? "List" : "Board"}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                title="New ticket · C"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCreating("backlog")}
                className={`${view.kind === "board" ? "ml-2" : "ml-auto"} h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover`}
              >
                New ticket
              </button>
            </>
          )}
        </header>

        {openTicket ? (
          <TicketPage
            ticket={openTicket}
            boards={boards}
            projects={projects}
            onClose={() => setOpenId(null)}
            onStep={step}
            onMove={moveTicket}
          />
        ) : showBoard && board ? (
          <Board
            key={board.id}
            boardId={board.id}
            tickets={tickets}
            boards={boards}
            projects={projects}
            activeId={activeId}
            onActiveChange={setActiveId}
            onOpen={open}
            onCreate={setCreating}
            onMove={moveTicket}
          />
        ) : (
          <TicketList
            key={view.kind === "board" ? `${view.boardId}:${view.projectId ?? ""}` : "inbox"}
            groups={groups}
            boards={boards}
            projects={projects}
            showProject={!project}
            activeId={activeId}
            onActiveChange={setActiveId}
            onOpen={open}
            onCreate={setCreating}
            onMove={moveTicket}
            empty={
              project
                ? { title: "No tickets in this project", hint: "to create one" }
                : board
                ? { title: "No tickets yet", hint: "to create a ticket" }
                : { title: "Inbox is empty", hint: "to capture a ticket" }
            }
          />
        )}
      </main>

      <CreateTicketDialog
        status={creating}
        board={board}
        project={project}
        onClose={() => setCreating(null)}
        onCreated={(ticket) => setActiveId(ticket.id)}
      />
      <CreateBoardDialog
        open={creatingBoard}
        onClose={() => setCreatingBoard(false)}
        onCreated={(created) => navigate({ kind: "board", boardId: created.id })}
      />
      <Picker
        open={switchingBoard}
        onOpenChange={setSwitchingBoard}
        title="Go to board"
        options={boards.map((b) => ({
          value: b.id,
          label: b.name,
          icon: <span className={`size-2 rounded-sm ${SWATCH_BG[b.color]}`} />,
        }))}
        current={view.kind === "board" ? view.boardId : undefined}
        onSelect={(boardId) => navigate({ kind: "board", boardId })}
      />
      <Picker
        open={switchingProject}
        onOpenChange={setSwitchingProject}
        title="Go to project"
        options={projects
          .filter((p) => p.boardId === board?.id)
          .map((p) => ({ value: p.id, label: p.name, icon: <ProjectIcon /> }))}
        current={project?.id}
        onSelect={(projectId) => board && navigate({ kind: "board", boardId: board.id, projectId })}
      />
      <NameDialog
        open={naming !== null}
        title={naming && "project" in naming ? "Rename project" : "New project"}
        placeholder="Project name"
        initial={naming && "project" in naming ? naming.project.name : ""}
        onClose={() => setNaming(null)}
        onSubmit={async (name) => {
          if (!naming) return;
          if ("project" in naming) return renameProject.mutateAsync({ id: naming.project.id, name });
          const created = await createProject.mutateAsync({ boardId: naming.boardId, name });
          setExpanded((ids) => (ids.includes(created.boardId) ? ids : [...ids, created.boardId]));
          navigate({ kind: "board", boardId: created.boardId, projectId: created.id });
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "project"}?`}
        message="Its tickets stay on the board, just without a project."
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          deleteProject.mutate(deleting.id);
          if (project?.id === deleting.id) navigate({ kind: "board", boardId: deleting.boardId });
        }}
      />
    </div>
  );
}

function HeaderButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg disabled:text-fg-quaternary disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

export default App;
