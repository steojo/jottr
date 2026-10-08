import type { ReactNode } from "react";

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-elevated px-1 font-mono text-[11px] text-fg-secondary">
      {children}
    </kbd>
  );
}

function App() {
  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] flex-col border-r border-line-subtle">
        {/* Space for the macOS traffic lights; doubles as a window drag handle. */}
        <div data-tauri-drag-region className="h-[52px] shrink-0" />
        <nav className="flex flex-col gap-px px-2 font-medium text-fg-secondary">
          <div className="flex h-7 items-center rounded-md px-2">Inbox</div>
          <div className="flex h-7 items-center rounded-md px-2">My Focus</div>
        </nav>
        <div className="px-4 pt-5 pb-1.5 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">
          Boards
        </div>
        <div className="px-4 text-fg-tertiary">No boards yet</div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div data-tauri-drag-region className="h-[52px] shrink-0 border-b border-line-subtle" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-[15px] font-semibold">No tickets yet</p>
          <p className="flex items-center gap-1.5 text-fg-tertiary">
            Press <Kbd>C</Kbd> to create a ticket
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
