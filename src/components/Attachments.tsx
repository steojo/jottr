import * as ContextMenu from "@radix-ui/react-context-menu";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";

import { commands, type Attachment, type Ticket } from "../bindings";
import { extension, formatSize, isImage } from "../lib/attachments";
import { useAttachments, useDeleteAttachment } from "../lib/queries";
import { ConfirmDialog } from "./FormDialogs";
import { menuItem, menuPanel } from "./TicketMenu";
import { Kbd } from "./ui";

/** PRD §5.10: tiles with image thumbnails, below the checklist on the ticket page. */
export function Attachments({ ticket, onAdd }: { ticket: Ticket; onAdd: () => void }) {
  const attachments = useAttachments(ticket.id).data;
  const remove = useDeleteAttachment();
  const [removing, setRemoving] = useState<Attachment | null>(null);

  if (!attachments) return null;

  return (
    <section className="flex flex-col">
      <div className="mb-1 flex h-7 items-center gap-2 font-medium text-fg-secondary">
        Attachments
        {attachments.length > 0 && (
          <span className="font-mono text-[11px] font-normal text-fg-tertiary">{attachments.length}</span>
        )}
      </div>
      {attachments.length > 0 && (
        <div className="mb-1 grid grid-cols-4 gap-2">
          {attachments.map((a) => (
            <Tile key={a.id} attachment={a} onRemove={() => setRemoving(a)} />
          ))}
        </div>
      )}
      <button
        type="button"
        title="Attach files · U"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAdd}
        className="group flex h-8 items-center gap-2 rounded-md px-1.5 text-left text-fg-quaternary hover:bg-surface-hover hover:text-fg-tertiary"
      >
        Attach files…
        <span className="ml-auto">Or drop or paste them here</span>
        <span className="hidden group-hover:inline-flex">
          <Kbd>U</Kbd>
        </span>
      </button>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove “${removing?.name ?? "attachment"}”?`}
        message="Jottr's copy of the file will be deleted for good."
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </section>
  );
}

/** Click or Enter opens the file in its default app; ⌫ removes it; right-click for more. */
function Tile({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const open = (reveal: boolean) => void commands.openAttachment(attachment.id, reveal);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="button"
          tabIndex={0}
          title={`${attachment.name} · ${formatSize(attachment.size)}`}
          onClick={() => open(false)}
          onKeyDown={(e) => {
            if (e.metaKey) return;
            if (e.key === "Enter" || e.key === " ") open(false);
            else if (e.key === "Backspace" || e.key === "Delete") onRemove();
            else return;
            e.preventDefault();
          }}
          className="group relative flex flex-col overflow-hidden rounded-md border border-line-subtle bg-surface-elevated outline-none hover:border-line focus-visible:shadow-[0_0_0_1.5px_var(--color-accent)] data-[state=open]:border-line"
        >
          <div className="flex aspect-[4/3] items-center justify-center bg-surface">
            {isImage(attachment.name) ? (
              <img
                src={convertFileSrc(attachment.path)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="size-full object-cover"
              />
            ) : (
              <span className="font-mono text-[11px] text-fg-tertiary uppercase">
                {extension(attachment.name) || "file"}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="truncate">{attachment.name}</span>
            <span className="font-mono text-[11px] text-fg-tertiary">{formatSize(attachment.size)}</span>
          </div>
          <button
            type="button"
            aria-label="Remove"
            title="Remove · ⌫"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded bg-surface-elevated text-fg-tertiary group-hover:flex hover:text-fg"
          >
            ×
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuPanel} onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenu.Item className={menuItem} onSelect={() => open(false)}>
            <span className="flex-1">Open</span>
            <Kbd>↵</Kbd>
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => open(true)}>
            Show in Finder
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-line-subtle" />
          <ContextMenu.Item className={`${menuItem} data-[highlighted]:text-status-error`} onSelect={onRemove}>
            <span className="flex-1">Remove…</span>
            <Kbd>⌫</Kbd>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
