import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import type { Settings } from "../bindings";
import { useSettings, useUpdateSettings } from "../lib/queries";
import { useShortcuts } from "../lib/shortcuts";
import { dayCount } from "../lib/tickets";
import { CheckIcon, ChevronUpDownIcon } from "./icons";
import { menuItem, menuPanel } from "./TicketMenu";

const ARCHIVE_DAYS = [1, 3, 7, 14, 30];

// Controls are reached with Tab, so they show the focus ring for keyboard focus only.
const ring = "outline-none focus-visible:shadow-[0_0_0_1.5px_var(--color-accent)]";

/** `⌘,`: app-wide settings. Esc goes back to where you were. */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const settings = useSettings().data;
  const update = useUpdateSettings();

  useShortcuts({ escape: onClose });

  if (!settings) return <div className="flex-1" />;
  const save = (change: Partial<Settings>) => update.mutate({ ...settings, ...change });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[640px] flex-col gap-2 px-10 pt-8 pb-24">
        <h2 className="px-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Archive</h2>
        <div className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          <Setting title="Auto-archive" detail="Move Done tickets to the Archive after a while, to keep boards clear.">
            <Switch label="Auto-archive" checked={settings.autoArchive} onChange={(autoArchive) => save({ autoArchive })} />
          </Setting>
          <Setting title="Archive after" detail="How long a ticket stays in Done first." disabled={!settings.autoArchive}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                disabled={!settings.autoArchive}
                onMouseDown={(e) => e.preventDefault()}
                className={`flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-fg-secondary enabled:hover:bg-surface-hover enabled:hover:text-fg data-[state=open]:bg-surface-hover data-[state=open]:text-fg ${ring}`}
              >
                {dayCount(settings.archiveAfterDays)}
                <span className="text-fg-tertiary">
                  <ChevronUpDownIcon direction="down" />
                </span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className={menuPanel}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  {ARCHIVE_DAYS.map((n) => (
                    <DropdownMenu.Item key={n} className={menuItem} onSelect={() => save({ archiveAfterDays: n })}>
                      <span className="flex-1">{dayCount(n)}</span>
                      {n === settings.archiveAfterDays && <CheckIcon />}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </Setting>
        </div>

        <h2 className="mt-6 px-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Board</h2>
        <div className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          <Setting
            title="Show Backlog column"
            detail="Backlog tickets still show in the list view and search. New tickets on the board start in Ready."
          >
            <Switch
              label="Show Backlog column"
              checked={settings.showBacklog}
              onChange={(showBacklog) => save({ showBacklog })}
            />
          </Setting>
          <Setting title="Show Canceled column" detail="Canceled tickets still show in the list view and search.">
            <Switch
              label="Show Canceled column"
              checked={settings.showCanceled}
              onChange={(showCanceled) => save({ showCanceled })}
            />
          </Setting>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full ${checked ? "bg-accent" : "bg-line-strong"} ${ring}`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full ${checked ? "left-[18px] bg-on-accent" : "left-0.5 bg-fg-secondary"}`}
      />
    </button>
  );
}

function Setting({
  title,
  detail,
  disabled,
  children,
}: {
  title: string;
  detail: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center gap-6 px-4 py-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-fg-tertiary">{detail}</span>
      </div>
      {children}
    </div>
  );
}
