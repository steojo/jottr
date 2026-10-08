import * as RadixDialog from "@radix-ui/react-dialog";
import type { KeyboardEvent, ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-elevated px-1 font-mono text-[11px] text-fg-secondary">
      {children}
    </kbd>
  );
}

/** Small mono chip naming what the next action applies to, e.g. `ENG-42` or `Inbox`. */
export function ContextChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 max-w-60 items-center truncate rounded border border-line px-1.5 font-mono text-[11px] text-fg-secondary">
      {children}
    </span>
  );
}

/** Command-menu style dialog anchored near the top of the window. */
export function Dialog({
  open,
  onOpenChange,
  title,
  width = "w-[480px]",
  onKeyDown,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  width?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          // Keep focus off whatever was focused before, so Enter/Space can't re-trigger it.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={`fixed top-[18vh] z-50 left-1/2 -translate-x-1/2 ${width} overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-2xl shadow-black/50 outline-none`}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
