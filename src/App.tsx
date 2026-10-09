import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Project, Status, Ticket } from "./bindings";
import { Board } from "./components/Board";
import { CommandMenu, type Command } from "./components/CommandMenu";
import { CreateBoardDialog } from "./components/CreateBoardDialog";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { FilterBar, FilterMenu } from "./components/Filters";
import { ConfirmDialog, NameDialog } from "./components/FormDialogs";
import { ChevronUpDownIcon, PlusIcon, ProjectIcon } from "./components/icons";
import { Picker } from "./components/Picker";
import { SettingsPage } from "./components/Settings";
import { ShortcutSheet } from "./components/ShortcutSheet";
import { Sidebar, type View } from "./components/Sidebar";
import { TicketList } from "./components/TicketList";
import { TicketPage } from "./components/TicketPage";
import {
  useArchive,
  useAutoArchive,
  useBoards,
  useCreateProject,
  useDeleteProject,
  useDeleteTicket,
  useFocus,
  useMoveTicket,
  useProjects,
  useRenameProject,
  useRestoreTicket,
  useSettings,
  useTickets,
} from "./lib/queries";
import { runShortcut, useShortcuts } from "./lib/shortcuts";
import { usePersistentState } from "./lib/storage";
import {
  NO_FILTERS,
  SWATCH_BG,
  applyFilters,
  archiveGroups,
  boardColumns,
  dayCount,
  filterCount,
  focusGroups,
  groupTickets,
  ticketKey,
  type Destination,
  type Filters,
} from "./lib/tickets";

function App() {
  const [view, setView] = useState<View>({ kind: "inbox" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The ticket shown on the ticket page; `null` shows the list.
  const [openId, setOpenId] = useState<string | null>(null);
  // Filters apply to the current view and reset when you leave it.
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Status for the new ticket; `null` when the dialog is closed.
  const [creating, setCreating] = useState<Status | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [switchingBoard, setSwitchingBoard] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [commandMenu, setCommandMenu] = useState<"all" | "search" | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [naming, setNaming] = useState<{ boardId: string } | { project: Project } | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deletingTicket, setDeletingTicket] = useState<Ticket | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = usePersistentState<string[]>("jottr.sidebar.expanded", []);
  // Where Esc or ⌘, on Settings goes back to.
  const settingsReturn = useRef<View>({ kind: "inbox" });

  const boards = useBoards().data ?? [];
  const projects = useProjects().data ?? [];
  const board = view.kind === "board" ? boards.find((b) => b.id === view.boardId) : undefined;
  const project = view.kind === "board" ? projects.find((p) => p.id === view.projectId) : undefined;
  const boardTickets = useTickets(view.kind === "board" ? view.boardId : null).data;
  const inboxCount = useTickets(null).data?.length ?? 0;
  const focusTickets = useFocus().data;
  const archive = useArchive(view.kind === "archive");
  const settings = useSettings().data;
  const restoreTicket = useRestoreTicket();
  useAutoArchive();
  const createProject = useCreateProject();
  const renameProject = useRenameProject();
  const deleteProject = useDeleteProject();
  const removeTicket = useDeleteTicket();
  const move = useMoveTicket();
  // Each board remembers list or board layout; the Inbox and My Focus are always lists.
  const [layout, setLayout] = usePersistentState<"list" | "board">(
    `jottr.layout.${view.kind === "board" ? view.boardId : view.kind}`,
    "board",
  );
  const showBoard = view.kind === "board" && layout === "board";

  // What's on screen: the view's tickets, narrowed to a project (a project is a filter
  // over its board), then by the active filters.
  const tickets = useMemo(() => {
    const scoped =
      view.kind === "focus"
        ? focusTickets
        : view.kind === "archive"
          ? archive.data
          : project
            ? boardTickets?.filter((t) => t.projectId === project.id)
            : boardTickets;
    return scoped && applyFilters(scoped, filters);
  }, [view.kind, focusTickets, archive.data, boardTickets, project, filters]);

  const groups = useMemo(
    () =>
      tickets &&
      (view.kind === "focus"
        ? focusGroups(tickets)
        : view.kind === "archive"
          ? archiveGroups(tickets)
          : groupTickets(tickets, view.kind === "board")),
    [tickets, view.kind],
  );
  // The order J/K follow on the ticket page matches what's on screen.
  const order = useMemo(
    () => (showBoard ? boardColumns(tickets ?? []) : (groups ?? [])).flatMap((g) => g.tickets),
    [showBoard, tickets, groups],
  );
  const activeTicket = order.find((t) => t.id === activeId);

  // While a moved ticket travels between lists it's briefly in neither; keep showing it.
  const lastOpen = useRef<Ticket | null>(null);
  const openTicket = order.find((t) => t.id === openId) ?? (lastOpen.current?.id === openId ? lastOpen.current : null);
  lastOpen.current = openTicket;
  // What ticket actions (S, P, ⌘⇧C, …) apply to.
  const target = openTicket ?? activeTicket;

  // A ticket restored while open (with Restore, or by changing its status) goes back to
  // its board, still open. Waits for the Archive to load so a stale list can't trigger it.
  useEffect(() => {
    if (view.kind !== "archive" || !openTicket || !archive.data || archive.isFetching) return;
    if (archive.data.some((t) => t.id === openTicket.id)) return;
    setView(openTicket.boardId ? { kind: "board", boardId: openTicket.boardId } : { kind: "inbox" });
    setFilters(NO_FILTERS);
  }, [view.kind, openTicket, archive.data, archive.isFetching]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(timer);
  }, [toast]);

  function navigate(next: View) {
    if (next.kind === "settings" && view.kind !== "settings") settingsReturn.current = view;
    setView(next);
    setActiveId(null);
    setOpenId(null);
    setFilters(NO_FILTERS);
  }

  function open(ticket: Ticket) {
    setActiveId(ticket.id);
    setOpenId(ticket.id);
  }

  /** Opens a ticket from anywhere (e.g. search) on its own board, in the Inbox, or in the Archive. */
  function openAnywhere(ticket: Ticket) {
    navigate(
      ticket.archivedAt !== null
        ? { kind: "archive" }
        : ticket.boardId
          ? { kind: "board", boardId: ticket.boardId }
          : { kind: "inbox" },
    );
    // Show it straight away, before its board's tickets have loaded.
    lastOpen.current = ticket;
    open(ticket);
  }

  function step(delta: 1 | -1) {
    const next = order[order.findIndex((t) => t.id === openId) + delta];
    if (next) open(next);
  }

  function moveTicket(ticket: Ticket, to: Destination) {
    move.mutate({ ticket, to });
    // My Focus and the Archive span every board, so a move never takes a ticket out of them.
    const staysInView =
      view.kind === "focus" ||
      view.kind === "archive" ||
      (to.boardId === ticket.boardId && (!project || to.projectId === project.id));
    if (staysInView) return;
    if (ticket.id === openId) {
      // An open ticket travels with you to where it went.
      setView(to.boardId ? { kind: "board", boardId: to.boardId, projectId: to.projectId ?? undefined } : { kind: "inbox" });
      setFilters(NO_FILTERS);
    } else if (ticket.id === activeId) {
      // In the list, the selection passes to a neighbour.
      const i = order.findIndex((t) => t.id === ticket.id);
      setActiveId((order[i + 1] ?? order[i - 1])?.id ?? null);
    }
  }

  function deleteTicket(ticket: Ticket) {
    // The selection passes to a neighbour; an open ticket returns you to the list.
    const i = order.findIndex((t) => t.id === ticket.id);
    removeTicket.mutate(ticket);
    if (ticket.id === openId) setOpenId(null);
    if (ticket.id === activeId || ticket.id === openId) setActiveId((order[i + 1] ?? order[i - 1])?.id ?? null);
  }

  function restore(ticket: Ticket) {
    if (ticket.archivedAt === null) return;
    restoreTicket.mutate(ticket);
    // In the list, the selection passes to a neighbour. An open ticket goes back to its board (see above).
    if (ticket.id === activeId && ticket.id !== openId) {
      const i = order.findIndex((t) => t.id === ticket.id);
      setActiveId((order[i + 1] ?? order[i - 1])?.id ?? null);
    }
  }

  function copyId(ticket: Ticket) {
    const text = ticketKey(ticket) ?? ticket.title;
    navigator.clipboard.writeText(text).then(
      () => setToast(`Copied ${text}`),
      () => setToast("Couldn't copy to the clipboard"),
    );
  }

  const toggleLayout = () => view.kind === "board" && setLayout(showBoard ? "list" : "board");
  const toggleSettings = () => navigate(view.kind === "settings" ? settingsReturn.current : { kind: "settings" });

  useShortcuts({
    c: () => setCreating("backlog"),
    "mod+k": () => setCommandMenu("all"),
    "/": () => setCommandMenu("search"),
    "?": () => setShowShortcuts(true),
    f: () => !openTicket && view.kind !== "settings" && setFiltering(true),
    a: () => target && restore(target),
    "mod+shift+c": () => target && copyId(target),
    "mod+backspace": () => target && setDeletingTicket(target),
    "g i": () => navigate({ kind: "inbox" }),
    "g f": () => navigate({ kind: "focus" }),
    "g a": () => navigate({ kind: "archive" }),
    "g b": () => boards.length > 0 && setSwitchingBoard(true),
    "g p": () => projects.some((p) => p.boardId === board?.id) && setSwitchingProject(true),
    "mod+\\": () => setSidebarOpen((o) => !o),
    "mod+b": toggleLayout,
    "mod+,": toggleSettings,
  });

  // ⌘K. Ticket actions reuse the views' own shortcuts, so they behave exactly like the keys.
  const commands: Command[] = [];
  if (target) {
    const ticketCommand = (id: string, label: string, shortcut: string, run: () => void, keywords?: string) =>
      commands.push({ id, label, group: ticketKey(target) ?? "Ticket", shortcut, run, keywords });
    if (target.archivedAt !== null) {
      ticketCommand("restore", "Restore from the Archive", "A", () => restore(target), "unarchive");
    }
    if (!openTicket) ticketCommand("open", "Open ticket", "↵", () => open(target));
    ticketCommand("status", "Change status…", "S", () => runShortcut("s"));
    ticketCommand("priority", "Change priority…", "P", () => runShortcut("p"));
    ticketCommand("labels", "Labels…", "L", () => runShortcut("l"), "tag");
    ticketCommand("due", "Set due date…", "D", () => runShortcut("d"), "deadline");
    ticketCommand("move", "Move to board or project…", "M", () => runShortcut("m"));
    if (!openTicket) {
      ticketCommand("next-status", "Move to next status", "]", () => runShortcut("]"), "advance forward");
      ticketCommand("prev-status", "Move to previous status", "[", () => runShortcut("["), "back");
    }
    ticketCommand("copy", "Copy ticket ID", "⌘ ⇧ C", () => copyId(target), "clipboard");
    ticketCommand("delete", "Delete ticket…", "⌘ ⌫", () => setDeletingTicket(target), "remove");
  }
  commands.push(
    { id: "new-ticket", label: "New ticket", group: "Create", shortcut: "C", icon: <PlusIcon />, run: () => setCreating("backlog") },
    { id: "new-board", label: "New board", group: "Create", icon: <PlusIcon />, run: () => setCreatingBoard(true) },
  );
  if (board) {
    commands.push({
      id: "new-project",
      label: `New project in ${board.name}`,
      group: "Create",
      icon: <PlusIcon />,
      run: () => setNaming({ boardId: board.id }),
    });
  }
  commands.push(
    { id: "go-inbox", label: "Go to Inbox", group: "Go to", shortcut: "G I", run: () => navigate({ kind: "inbox" }) },
    { id: "go-focus", label: "Go to My Focus", group: "Go to", shortcut: "G F", run: () => navigate({ kind: "focus" }) },
    { id: "go-archive", label: "Go to Archive", group: "Go to", shortcut: "G A", run: () => navigate({ kind: "archive" }) },
    {
      id: "go-settings",
      label: "Go to Settings",
      group: "Go to",
      shortcut: "⌘ ,",
      keywords: "preferences auto-archive",
      run: () => navigate({ kind: "settings" }),
    },
    ...boards.map(
      (b): Command => ({
        id: `go-${b.id}`,
        label: `Go to ${b.name}`,
        group: "Go to",
        keywords: `board ${b.key}`,
        icon: <span className={`size-2 rounded-sm ${SWATCH_BG[b.color]}`} />,
        run: () => navigate({ kind: "board", boardId: b.id }),
      }),
    ),
    ...projects.map(
      (p): Command => ({
        id: `go-${p.id}`,
        label: `Go to ${p.name}`,
        group: "Go to",
        keywords: `project ${boards.find((b) => b.id === p.boardId)?.name ?? ""}`,
        icon: (
          <span className="text-fg-tertiary">
            <ProjectIcon />
          </span>
        ),
        run: () => navigate({ kind: "board", boardId: p.boardId, projectId: p.id }),
      }),
    ),
  );
  if (!openTicket && view.kind !== "settings") {
    commands.push({ id: "filter", label: "Filter…", group: "View", shortcut: "F", run: () => setFiltering(true) });
  }
  if (view.kind === "board") {
    commands.push({
      id: "layout",
      label: showBoard ? "Switch to list view" : "Switch to board view",
      group: "View",
      shortcut: "⌘ B",
      keywords: "kanban layout",
      run: toggleLayout,
    });
  }
  commands.push(
    { id: "sidebar", label: "Toggle sidebar", group: "View", shortcut: "⌘ \\", run: () => setSidebarOpen((o) => !o) },
    { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", shortcut: "?", keywords: "keys help", run: () => setShowShortcuts(true) },
  );

  const position = openTicket ? order.findIndex((t) => t.id === openTicket.id) : -1;
  const scopeLabel =
    view.kind === "focus" ? (
      "My Focus"
    ) : view.kind === "archive" ? (
      "Archive"
    ) : view.kind === "settings" ? (
      "Settings"
    ) : (
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
  const activeFilters = filterCount(filters);

  const empty =
    activeFilters > 0
      ? { title: "Nothing matches these filters", action: { label: "Clear filters", onClick: () => setFilters(NO_FILTERS) } }
      : view.kind === "focus"
        ? { title: "Nothing needs your focus", hint: "to capture a ticket" }
        : view.kind === "archive"
          ? settings?.autoArchive === false
            ? {
                title: "Archive is empty",
                detail: "Auto-archive is off.",
                action: { label: "Open settings", onClick: () => navigate({ kind: "settings" }) },
              }
            : {
                title: "Archive is empty",
                detail: `Done tickets move here ${dayCount(settings?.archiveAfterDays ?? 7)} after they're finished.`,
              }
        : project
          ? { title: "No tickets in this project", hint: "to create one" }
          : board
            ? { title: "No tickets yet", hint: "to create a ticket" }
            : { title: "Inbox is empty", hint: "to capture a ticket" };

  return (
    <div className="flex h-full select-none">
      {sidebarOpen && (
        <Sidebar
          boards={boards}
          projects={projects}
          view={view}
          inboxCount={inboxCount}
          focusCount={focusTickets?.length ?? 0}
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
                {position >= 0 ? `${position + 1} / ${order.length}` : ""}
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
              <span className="pointer-events-none flex-1" />
              {view.kind !== "settings" && (
                <>
                  <button
                    type="button"
                    title="Filter · F"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setFiltering(true)}
                    className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium ${
                      activeFilters > 0
                        ? "border-line-strong text-fg"
                        : "border-line text-fg-tertiary hover:text-fg"
                    }`}
                  >
                    Filter
                    {activeFilters > 0 && <span className="font-mono text-[11px] text-fg-secondary">{activeFilters}</span>}
                  </button>
                  {view.kind === "board" && (
                    <div className="flex rounded-md border border-line p-px">
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
                    className="ml-1 h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
                  >
                    New ticket
                  </button>
                </>
              )}
            </>
          )}
        </header>

        {!openTicket && view.kind !== "settings" && (
          <FilterBar
            filters={filters}
            onChange={setFilters}
            onEdit={() => setFiltering(true)}
            projects={projects.filter((p) => p.boardId === board?.id)}
          />
        )}

        {view.kind === "settings" ? (
          <SettingsPage onClose={toggleSettings} />
        ) : openTicket ? (
          <TicketPage
            ticket={openTicket}
            boards={boards}
            projects={projects}
            onClose={() => setOpenId(null)}
            onStep={step}
            onMove={moveTicket}
            onDelete={setDeletingTicket}
            onRestore={restore}
          />
        ) : showBoard && board ? (
          <Board
            key={board.id}
            boardId={board.id}
            tickets={tickets}
            boards={boards}
            projects={projects}
            showProject={!project}
            activeId={activeId}
            onActiveChange={setActiveId}
            onOpen={open}
            onCreate={setCreating}
            onMove={moveTicket}
            onDelete={setDeletingTicket}
          />
        ) : (
          <TicketList
            key={view.kind === "board" ? `${view.boardId}:${view.projectId ?? ""}` : view.kind}
            groups={groups}
            boards={boards}
            projects={projects}
            showProject={!project}
            activeId={activeId}
            onActiveChange={setActiveId}
            onOpen={open}
            onCreate={setCreating}
            onMove={moveTicket}
            onDelete={setDeletingTicket}
            onRestore={view.kind === "archive" ? restore : undefined}
            empty={empty}
          />
        )}
      </main>

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-surface-elevated px-3 py-2 text-fg-secondary shadow-2xl shadow-black/50">
          {toast}
        </div>
      )}

      <CommandMenu
        open={commandMenu !== null}
        searchOnly={commandMenu === "search"}
        onOpenChange={(o) => !o && setCommandMenu(null)}
        commands={commands}
        context={target ? (ticketKey(target) ?? target.title) : undefined}
        boards={boards}
        onOpenTicket={openAnywhere}
      />
      <FilterMenu
        open={filtering}
        onOpenChange={setFiltering}
        filters={filters}
        onChange={setFilters}
        projects={board && !project ? projects.filter((p) => p.boardId === board.id) : null}
      />
      <ShortcutSheet open={showShortcuts} onOpenChange={setShowShortcuts} />
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
        open={deletingTicket !== null}
        title={`Delete ${deletingTicket ? (ticketKey(deletingTicket) ?? `“${deletingTicket.title}”`) : "ticket"}?`}
        message="It'll be gone for good, along with its checklist."
        confirmLabel="Delete"
        onClose={() => setDeletingTicket(null)}
        onConfirm={() => deletingTicket && deleteTicket(deletingTicket)}
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
