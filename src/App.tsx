import { useState } from "react";

import type { Status } from "./bindings";
import { CreateBoardDialog } from "./components/CreateBoardDialog";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { Picker } from "./components/Picker";
import { Sidebar, type View } from "./components/Sidebar";
import { TicketList } from "./components/TicketList";
import { useBoards, useTickets } from "./lib/queries";
import { useShortcuts } from "./lib/shortcuts";
import { SWATCH_BG } from "./lib/tickets";

function App() {
  const [view, setView] = useState<View>({ kind: "inbox" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Status for the new ticket; `null` when the dialog is closed.
  const [creating, setCreating] = useState<Status | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [switchingBoard, setSwitchingBoard] = useState(false);

  const boards = useBoards().data ?? [];
  const board = view.kind === "board" ? boards.find((b) => b.id === view.boardId) : undefined;
  const tickets = useTickets(view.kind === "board" ? view.boardId : null).data;
  const inboxCount = useTickets(null).data?.length ?? 0;

  function navigate(next: View) {
    setView(next);
    setActiveId(null);
  }

  useShortcuts({
    c: () => setCreating("backlog"),
    "g i": () => navigate({ kind: "inbox" }),
    "g b": () => boards.length > 0 && setSwitchingBoard(true),
    "mod+\\": () => setSidebarOpen((open) => !open),
  });

  return (
    <div className="flex h-full select-none">
      {sidebarOpen && (
        <Sidebar
          boards={boards}
          view={view}
          inboxCount={inboxCount}
          onNavigate={navigate}
          onNewBoard={() => setCreatingBoard(true)}
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
          <span className="pointer-events-none flex items-center gap-2 font-medium">
            {board && <span className={`size-2 rounded-sm ${SWATCH_BG[board.color]}`} />}
            {board ? board.name : "Inbox"}
          </span>
          <button
            type="button"
            title="New ticket · C"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCreating("backlog")}
            className="ml-auto h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
          >
            New ticket
          </button>
        </header>

        <TicketList
          key={view.kind === "board" ? view.boardId : "inbox"}
          tickets={tickets}
          grouped={view.kind === "board"}
          boards={boards}
          activeId={activeId}
          onActiveChange={setActiveId}
          onCreate={setCreating}
          empty={
            board
              ? { title: "No tickets yet", hint: "to create a ticket" }
              : { title: "Inbox is empty", hint: "to capture a ticket" }
          }
        />
      </main>

      <CreateTicketDialog
        status={creating}
        board={board}
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
    </div>
  );
}

export default App;
