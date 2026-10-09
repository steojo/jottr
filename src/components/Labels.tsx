import * as ContextMenu from "@radix-ui/react-context-menu";
import { useRef, useState, type KeyboardEvent } from "react";

import type { Label, Ticket } from "../bindings";
import { useCreateLabel, useDeleteLabel, useLabels, useSetTicketLabel, useUpdateLabel } from "../lib/queries";
import { COLORS, SWATCH_BG, nextLabelColor, ticketKey } from "../lib/tickets";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "./icons";
import { ConfirmDialog } from "./FormDialogs";
import { ContextChip, Dialog, Kbd } from "./ui";

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex h-5 max-w-32 shrink-0 items-center gap-1.5 rounded-full border border-line px-2 text-[11px] text-fg-secondary">
      <span className={`size-1.5 shrink-0 rounded-full ${SWATCH_BG[label.color]}`} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** A ticket's labels in name order, with "+N" once there are more than `max`. */
export function LabelChips({ ids, labels, max = 3 }: { ids: string[]; labels: Label[]; max?: number }) {
  const applied = labels.filter((l) => ids.includes(l.id));
  if (applied.length === 0) return null;
  const hidden = applied.length - max;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {applied.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {hidden > 0 && <span className="font-mono text-[11px] text-fg-tertiary">+{hidden}</span>}
    </span>
  );
}

type Row = { kind: "label"; label: Label } | { kind: "create"; name: string };

/**
 * `L`: add or remove labels. Type to filter, Enter toggles the highlighted label
 * (or creates one from what you typed), and the picker stays open for more.
 * Right-click a label to recolour, rename or delete it.
 */
export function LabelPicker({
  open,
  onOpenChange,
  ticket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Labels" width="w-[360px]">
      {open && <LabelPickerBody ticket={ticket} />}
    </Dialog>
  );
}

function LabelPickerBody({ ticket }: { ticket: Ticket }) {
  const labels = useLabels().data ?? [];
  const setLabel = useSetTicketLabel();
  const createLabel = useCreateLabel();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const filter = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const rows: Row[] = labels.filter((l) => l.name.toLowerCase().includes(q)).map((label) => ({ kind: "label", label }));
  if (q && !labels.some((l) => l.name.toLowerCase() === q)) rows.push({ kind: "create", name: query.trim() });
  const highlighted = Math.min(index, rows.length - 1);

  function toggle(label: Label) {
    setLabel.mutate({ ticket, labelId: label.id, applied: !ticket.labelIds.includes(label.id) });
  }

  async function create(name: string) {
    try {
      const label = await createLabel.mutateAsync({ name, color: nextLabelColor(labels) });
      setLabel.mutate({ ticket, labelId: label.id, applied: true });
      setQuery("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function activate(row: Row | undefined) {
    if (row?.kind === "label") toggle(row.label);
    else if (row?.kind === "create") void create(row.name);
  }

  function onKeyDown(e: KeyboardEvent) {
    // Keys in the rename field belong to it.
    if (e.target !== filter.current) return;
    if (e.key === "ArrowDown") setIndex((i) => Math.min(rows.length - 1, i + 1));
    else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
    else if (e.key === "Enter") activate(rows[highlighted]);
    else return;
    e.preventDefault();
  }

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex h-10 items-center gap-2 border-b border-line-subtle px-3">
        <ContextChip>{ticketKey(ticket) ?? ticket.title}</ContextChip>
        <input
          ref={filter}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          placeholder="Add labels…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-quaternary"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {rows.length === 0 && <p className="px-2.5 py-1.5 text-fg-tertiary">Type to create a label</p>}
        {rows.map((row, i) =>
          row.kind === "create" ? (
            <button
              key="create"
              type="button"
              tabIndex={-1}
              onMouseMove={() => setIndex(i)}
              onClick={() => void create(row.name)}
              className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${
                i === highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary"
              }`}
            >
              <PlusIcon />
              <span className="flex-1 truncate">Create “{row.name}”</span>
            </button>
          ) : (
            <LabelRow
              key={row.label.id}
              label={row.label}
              applied={ticket.labelIds.includes(row.label.id)}
              highlighted={i === highlighted}
              renaming={renaming === row.label.id}
              onHover={() => setIndex(i)}
              onToggle={() => toggle(row.label)}
              onRename={() => setRenaming(row.label.id)}
              onRenamed={() => {
                setRenaming(null);
                filter.current?.focus();
              }}
              onDelete={() => setDeleting(row.label)}
            />
          ),
        )}
      </div>
      <div className="flex h-9 items-center justify-between border-t border-line-subtle px-3 text-[12px] text-fg-tertiary">
        <span className="truncate text-status-error">{error ?? ""}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          Toggle <Kbd>↵</Kbd> Done <Kbd>Esc</Kbd>
        </span>
      </div>
      <DeleteLabel label={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function LabelRow({
  label,
  applied,
  highlighted,
  renaming,
  onHover,
  onToggle,
  onRename,
  onRenamed,
  onDelete,
}: {
  label: Label;
  applied: boolean;
  highlighted: boolean;
  renaming: boolean;
  onHover: () => void;
  onToggle: () => void;
  onRename: () => void;
  onRenamed: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateLabel();
  const row = `flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${
    highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary"
  }`;

  if (renaming) {
    return (
      <div className={row}>
        <span className={`size-2 shrink-0 rounded-full ${SWATCH_BG[label.color]}`} />
        <input
          autoFocus
          defaultValue={label.name}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={onRenamed}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const name = e.currentTarget.value.trim();
              if (name && name !== label.name) update.mutate({ id: label.id, patch: { name, color: null } });
              onRenamed();
            }
            // Esc closes the whole picker (the dialog handles it), which cancels the rename via blur.
          }}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </div>
    );
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button type="button" tabIndex={-1} onMouseMove={onHover} onClick={onToggle} className={row}>
          <span className={`size-2 shrink-0 rounded-full ${SWATCH_BG[label.color]}`} />
          <span className="flex-1 truncate">{label.name}</span>
          {applied && <CheckIcon />}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuPanel} onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={menuItem}>
              <span className="flex-1">Colour</span>
              <ChevronRightIcon />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menuPanel} sideOffset={6}>
                {COLORS.map((color) => (
                  <ContextMenu.Item
                    key={color}
                    className={menuItem}
                    onSelect={() => update.mutate({ id: label.id, patch: { name: null, color } })}
                  >
                    <span className={`size-2 rounded-full ${SWATCH_BG[color]}`} />
                    <span className="flex-1 capitalize">{color}</span>
                    {color === label.color && <CheckIcon />}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Item className={menuItem} onSelect={onRename}>
            Rename…
          </ContextMenu.Item>
          <ContextMenu.Item className={`${menuItem} data-[highlighted]:text-status-error`} onSelect={onDelete}>
            Delete…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function DeleteLabel({ label, onClose }: { label: Label | null; onClose: () => void }) {
  const remove = useDeleteLabel();
  return (
    <ConfirmDialog
      open={label !== null}
      title={`Delete ${label?.name ?? "label"}?`}
      message="It will be removed from every ticket that has it."
      confirmLabel="Delete"
      onClose={onClose}
      onConfirm={() => label && remove.mutate(label.id)}
    />
  );
}

const menuPanel = "z-50 min-w-40 rounded-lg border border-line bg-surface-elevated p-1 shadow-2xl shadow-black/50";
const menuItem =
  "flex h-7 cursor-default items-center gap-2.5 rounded-md px-2 text-fg-secondary outline-none select-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg data-[state=open]:bg-surface-hover";
