import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";

import type { Board, Priority, Status, Ticket } from "../bindings";
import { PRIORITIES, STATUSES, SWATCH_BG } from "../lib/tickets";
import { CheckIcon, ChevronRightIcon, PriorityIcon, StatusIcon } from "./icons";
import { Kbd } from "./ui";

const panel = "z-50 min-w-48 rounded-lg border border-line bg-surface-elevated p-1 shadow-2xl shadow-black/50";
const item =
  "flex h-7 cursor-default items-center gap-2.5 rounded-md px-2 text-fg-secondary outline-none select-none " +
  "data-[disabled]:text-fg-quaternary data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg " +
  "data-[state=open]:bg-surface-hover data-[state=open]:text-fg";

const boardDot = (b: Board) => <span className={`size-2 shrink-0 rounded-sm ${SWATCH_BG[b.color]}`} />;

/**
 * Right-click menu for a ticket (PRD §6.4). Mirrors the S / P / M pickers,
 * with each option's icon and a tick on the current value.
 */
export function TicketMenu({
  ticket,
  boards,
  onOpen,
  onStatus,
  onPriority,
  onMove,
  children,
}: {
  ticket: Ticket;
  boards: Board[];
  onOpen: () => void;
  onStatus: (status: Status) => void;
  onPriority: (priority: Priority) => void;
  onMove: (boardId: string | null) => void;
  children: ReactNode;
}) {
  const destinations = boards.filter((b) => b.id !== ticket.boardId);
  const canMove = destinations.length > 0 || ticket.boardId !== null;

  return (
    <ContextMenu.Root onOpenChange={(open) => open && onOpen()}>
      {/* The wrapper carries data-state=open, so the row can stay highlighted while the menu is up. */}
      <ContextMenu.Trigger asChild>
        <div className="group/menu">{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={panel} onCloseAutoFocus={(e) => e.preventDefault()}>
          <Submenu icon={<StatusIcon status={ticket.status} />} label="Status" shortcut="S">
            {STATUSES.map((s) => (
              <Option
                key={s.value}
                icon={<StatusIcon status={s.value} />}
                label={s.label}
                current={s.value === ticket.status}
                onSelect={() => onStatus(s.value)}
              />
            ))}
          </Submenu>
          <Submenu icon={<PriorityIcon priority={ticket.priority} />} label="Priority" shortcut="P">
            {PRIORITIES.map((p) => (
              <Option
                key={p.value}
                icon={<PriorityIcon priority={p.value} />}
                label={p.label}
                current={p.value === ticket.priority}
                onSelect={() => onPriority(p.value)}
              />
            ))}
          </Submenu>
          <Submenu icon={<span className="size-3.5" />} label="Move to" shortcut="M" disabled={!canMove}>
            {destinations.map((b) => (
              <Option key={b.id} icon={boardDot(b)} label={b.name} onSelect={() => onMove(b.id)} />
            ))}
            {ticket.boardId !== null && (
              <Option icon={<span className="size-2" />} label="Inbox" onSelect={() => onMove(null)} />
            )}
          </Submenu>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Submenu({
  icon,
  label,
  shortcut,
  disabled,
  children,
}: {
  icon: ReactNode;
  label: string;
  shortcut: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={item} disabled={disabled}>
        <span className="flex size-3.5 items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        <Kbd>{shortcut}</Kbd>
        <ChevronRightIcon />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className={panel} sideOffset={6} alignOffset={-5}>
          {children}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

function Option({
  icon,
  label,
  current,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  current?: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item className={item} onSelect={onSelect}>
      <span className="flex size-3.5 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {current && <CheckIcon />}
    </ContextMenu.Item>
  );
}
