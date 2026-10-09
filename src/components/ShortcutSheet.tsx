import { Dialog, Kbd } from "./ui";

/** Everything listed here works today; keep it in step with the shortcuts in the code (PRD §6.4). */
const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["⌘ K", "Command menu"],
      ["/", "Search tickets"],
      ["C", "New ticket"],
      ["F", "Filter"],
      ["⌘ B", "List / board view"],
      ["⌘ \\", "Toggle sidebar"],
      ["⌘ ,", "Settings"],
      ["?", "Keyboard shortcuts"],
    ],
  },
  {
    title: "Go to",
    keys: [
      ["G I", "Inbox"],
      ["G F", "My Focus"],
      ["G B", "Board…"],
      ["G P", "Project…"],
      ["G A", "Archive"],
    ],
  },
  {
    title: "Selected ticket",
    keys: [
      ["↵", "Open"],
      ["S", "Status"],
      ["P", "Priority"],
      ["L", "Labels"],
      ["D", "Due date"],
      ["M", "Move to board or project"],
      ["U", "Attach files"],
      ["[  ]", "Previous / next status"],
      ["A", "Restore from the Archive"],
      ["⌘ ⇧ C", "Copy ID"],
      ["⌘ ⌫", "Delete"],
    ],
  },
  {
    title: "Lists and boards",
    keys: [
      ["J  K", "Next / previous ticket"],
      ["←  →", "Previous / next column"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "Ticket page",
    keys: [
      ["J  K", "Next / previous ticket"],
      ["Esc", "Back to the list"],
      ["⌘ ↵", "Finish editing"],
    ],
  },
];

/** `?`: every keyboard shortcut on one sheet. */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" width="w-[640px]" focusContent>
      <div className="flex h-10 items-center border-b border-line-subtle px-4 font-medium">Keyboard shortcuts</div>
      <div className="grid max-h-[65vh] grid-cols-2 gap-x-8 gap-y-5 overflow-y-auto p-4">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="mb-1.5 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">{section.title}</h3>
            {section.keys.map(([keys, label]) => (
              <div key={label} className="flex h-7 items-center justify-between gap-3 text-fg-secondary">
                {label}
                <span className="flex gap-1">
                  {keys.split(/\s+/).map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
