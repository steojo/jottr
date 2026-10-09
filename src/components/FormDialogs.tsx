import { useState } from "react";

import { Dialog, Kbd } from "./ui";

/** One text field, e.g. naming or renaming a project. Closes once `onSubmit` succeeds. */
export function NameDialog({
  open,
  title,
  placeholder,
  initial = "",
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} width="w-[400px]">
      {/* Remounted per open so the field starts from `initial`. */}
      {open && <NameForm title={title} placeholder={placeholder} initial={initial} onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function NameForm({
  title,
  placeholder,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex h-10 items-center border-b border-line-subtle px-4 font-medium">{title}</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        placeholder={placeholder}
        className="h-12 w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-fg-quaternary"
      />
      <div className="flex h-10 items-center justify-between border-t border-line-subtle px-3 text-fg-tertiary">
        <span className="truncate text-status-error">{error ?? ""}</span>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-fg"
        >
          Save <Kbd>↵</Kbd>
        </button>
      </div>
    </form>
  );
}

/** Asks before something destructive. Enter confirms, Esc cancels. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width="w-[400px]"
      focusContent
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onClose();
          onConfirm();
        }
      }}
    >
      <div className="flex flex-col gap-1.5 px-4 pt-4 pb-3">
        <p className="font-medium">{title}</p>
        <p className="text-fg-secondary">{message}</p>
      </div>
      <div className="flex h-11 items-center justify-end gap-2 border-t border-line-subtle px-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-tertiary hover:bg-surface-hover hover:text-fg"
        >
          Cancel <Kbd>Esc</Kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            onConfirm();
          }}
          className="flex h-7 items-center gap-1.5 rounded-md bg-status-error px-2.5 font-medium text-on-accent hover:opacity-90"
        >
          {confirmLabel} <Kbd>↵</Kbd>
        </button>
      </div>
    </Dialog>
  );
}
