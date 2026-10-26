import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { commands, type Settings } from "../bindings";
import { useNotificationStatus, useSettings, useUpdateSettings } from "../lib/queries";
import { formatShortcut, globalShortcut, useShortcuts } from "../lib/shortcuts";
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
  const notifications = useNotificationStatus();
  const [notificationError, setNotificationError] = useState<string | null>(null);

  useShortcuts({ escape: onClose });

  if (!settings) return <div className="flex-1" />;
  const save = (change: Partial<Settings>) => update.mutate({ ...settings, ...change });

  return (
    <div className="flex-1 overflow-y-auto">
      <fieldset disabled={update.isPending} className="mx-auto flex max-w-[640px] flex-col gap-2 px-10 pt-8 pb-24">
        {update.isError && <p role="alert" className="mb-2 px-1 text-status-error">{String(update.error)}</p>}
        <h2 className="px-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Notifications</h2>
        <div className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          <Setting title="Due-date reminders" detail={
            // Only turning reminders on asks macOS for permission.
            update.isPending && update.variables?.dueReminders && !settings.dueReminders
              ? <span role="status">Waiting for macOS notification permission. If no prompt appears, check System Settings → Notifications.</span>
              : "One notification per unfinished ticket on its due date, even when Jottr is closed."
          }>
            <Switch
              label="Due-date reminders"
              checked={settings.dueReminders}
              disabled={notifications.data?.permission === "unavailable"}
              onChange={(dueReminders) => save({ dueReminders })}
            />
          </Setting>
          <Setting title="Remind me at" detail="Local time. Tickets already due today remind you once when enabled." disabled={!settings.dueReminders}>
            <ReminderTime
              value={settings.reminderTime}
              disabled={!settings.dueReminders}
              onSave={(reminderTime) => save({ reminderTime })}
            />
          </Setting>
          {notifications.data?.permission === "denied" && (
            <Setting title="Notifications are blocked" detail="Allow notifications for Jottr in System Settings.">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setNotificationError(null);
                  void commands.openNotificationSettings().catch((error) => setNotificationError(String(error)));
                }}
                className={`rounded-md border border-line px-2.5 py-1 text-fg-secondary hover:bg-surface-hover ${ring}`}
              >
                Open System Settings
              </button>
            </Setting>
          )}
        </div>
        {notifications.data?.permission === "unavailable" && (
          <p className="px-1 text-fg-tertiary">Reminders are available in the packaged Jottr.app.</p>
        )}
        {(notifications.isError || notifications.data?.error || notificationError) && (
          <p role="alert" className="px-1 text-status-error">
            {notificationError ?? notifications.data?.error ?? String(notifications.error)}
          </p>
        )}
        <h2 className="mt-6 px-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Archive</h2>
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
          <Setting title="Show created dates" detail="Shows when each ticket was created at the bottom of its card.">
            <Switch
              label="Show created dates"
              checked={settings.showCreated}
              onChange={(showCreated) => save({ showCreated })}
            />
          </Setting>
        </div>

        <h2 className="mt-6 px-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">Quick capture</h2>
        <div className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          <Setting
            title="Quick capture"
            detail="Press the shortcut in any app to add a ticket to the bottom of the Inbox, without leaving the app."
          >
            <Switch
              label="Quick capture"
              checked={settings.quickCapture}
              onChange={(quickCapture) => save({ quickCapture })}
            />
          </Setting>
          <Setting
            title="Shortcut"
            detail="Click, then press the keys you want. It needs ⌘, ⌃ or ⌥."
            disabled={!settings.quickCapture}
          >
            <ShortcutButton
              shortcut={settings.captureShortcut}
              disabled={!settings.quickCapture}
              onChange={(captureShortcut) => save({ captureShortcut })}
            />
          </Setting>
        </div>
      </fieldset>
    </div>
  );
}

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"} ${ring}`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full ${checked ? "left-[18px] bg-on-accent" : "left-0.5 bg-fg-secondary"}`}
      />
    </button>
  );
}

function ReminderTime({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="time"
      aria-label="Reminder time"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(draft) && draft !== value) onSave(draft);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.stopPropagation(); setDraft(value); }
      }}
      className={`h-7 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px] text-fg-secondary scheme-dark ${ring}`}
    />
  );
}

/** Records the next key pressed with ⌘, ⌃ or ⌥ as the shortcut. Esc or clicking away cancels. */
function ShortcutButton({
  shortcut,
  disabled,
  onChange,
}: {
  shortcut: string;
  disabled: boolean;
  onChange: (shortcut: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      // Listening in the capture phase and marking keys handled keeps the app's shortcuts out.
      e.preventDefault();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return setRecording(false);
      const next = globalShortcut(e);
      if (!next) return;
      setRecording(false);
      if (next !== shortcut) onChange(next);
    }
    function onPointerDown(e: PointerEvent) {
      if (!button.current?.contains(e.target as Node)) setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [recording, shortcut, onChange]);

  return (
    <button
      ref={button}
      type="button"
      disabled={disabled}
      title="Change shortcut"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setRecording(!recording)}
      className={`flex h-7 min-w-24 items-center justify-center rounded-md border border-line px-2.5 font-mono text-[12px] enabled:hover:bg-surface-hover enabled:hover:text-fg ${recording ? "bg-surface-hover text-fg" : "text-fg-secondary"} ${ring}`}
    >
      {recording ? "Press keys…" : formatShortcut(shortcut)}
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
  detail: ReactNode;
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
