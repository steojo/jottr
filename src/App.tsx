import { useMemo, useRef, useState, type ReactNode } from "react";

import type { Status, Ticket } from "./bindings";
import { CreateBoardDialog } from "./components/CreateBoardDialog";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { ChevronUpDownIcon } from "./components/icons";
import { Picker } from "./components/Picker";
import { Sidebar, type View } from "./components/Sidebar";
import { TicketList } from "./components/TicketList";
import { TicketPage } from "./components/TicketPage";
import { useBoards, useMoveTicket, useTickets } from "./lib/queries";
import { useShortcuts } from "./lib/shortcuts";
import { SWATCH_BG, groupTickets, ticketKey } from "./lib/tickets";

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

  const boards = useBoards().data ?? [];
  const board = view.kind === "board" ? boards.find((b) => b.id === view.boardId) : undefined;
  const tickets = useTickets(view.kind === "board" ? view.boardId : null).data;
  const inboxCount = useTickets(null).data?.length ?? 0;
  const move = useMoveTicket();

  const groups = useMemo(() => tickets && groupTickets(tickets, view.kind === "board"), [tickets, view.kind]);
  const order = useMemo(() => groups?.flatMap((g) => g.tickets) ?? [], [groups]);

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

  function moveTicket(ticket: Ticket, boardId: string | null) {
    move.mutate({ ticket, boardId });
    if (ticket.id === openId) {
      // An open ticket travels with you to its new board.
      setView(boardId ? { kind: "board", boardId } : { kind: "inbox" });
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
    "mod+\\": () => setSidebarOpen((o) => !o),
  });

  const position = openTicket ? order.findIndex((t) => t.id === openTicket.id) : -1;
  const scopeLabel = (
    <>
      {board && <span className={`size-2 rounded-sm ${SWATCH_BG[board.color]}`} />}
      {board ? board.name : "Inbox"}
    </>
  );

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
              <button
                type="button"
                title="New ticket · C"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCreating("backlog")}
                className="ml-auto h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
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
            onClose={() => setOpenId(null)}
            onStep={step}
            onMove={moveTicket}
          />
        ) : (
          <TicketList
            key={view.kind === "board" ? view.boardId : "inbox"}
            groups={groups}
            boards={boards}
            activeId={activeId}
            onActiveChange={setActiveId}
            onOpen={open}
            onCreate={setCreating}
            onMove={moveTicket}
            empty={
              board
                ? { title: "No tickets yet", hint: "to create a ticket" }
                : { title: "Inbox is empty", hint: "to capture a ticket" }
            }
          />
        )}
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
