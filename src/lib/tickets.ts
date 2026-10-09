import type { Board, BoardColor, Priority, Project, Status, Ticket, TicketPatch } from "../bindings";

/** Picker order; `S` then `3` = In Progress. */
export const STATUSES: { value: Status; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

/** List groups, most active first. */
export const LIST_ORDER: Status[] = ["in_progress", "in_review", "ready", "backlog", "done", "canceled"];

/** Board columns, left to right in workflow order. */
export const BOARD_ORDER: Status[] = ["backlog", "ready", "in_progress", "in_review", "done", "canceled"];

/** The status `delta` steps along the workflow, for `[` and `]`. Canceled sits outside the flow. */
export function adjacentStatus(status: Status, delta: 1 | -1): Status | null {
  const flow: Status[] = ["backlog", "ready", "in_progress", "in_review", "done"];
  const i = flow.indexOf(status);
  return i === -1 ? null : (flow[i + delta] ?? null);
}

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

export const statusLabel = (s: Status) => STATUSES.find((o) => o.value === s)!.label;

/** e.g. `ENG-42`; `null` for Inbox tickets, which have no board yet. */
export function ticketKey(t: Ticket): string | null {
  return t.boardKey && t.number !== null ? `${t.boardKey}-${t.number}` : null;
}

export const byPosition = (a: Ticket, b: Ticket) => (a.position ?? 0) - (b.position ?? 0);

export type TicketGroup = { status: Status | null; tickets: Ticket[] };

/** The list's display order: status groups (boards) or one flat list (Inbox). */
export function groupTickets(tickets: Ticket[], grouped: boolean): TicketGroup[] {
  const sorted = [...tickets].sort(byPosition);
  if (!grouped) return [{ status: null, tickets: sorted }];
  return LIST_ORDER.map((status) => ({ status, tickets: sorted.filter((t) => t.status === status) })).filter(
    (g) => g.tickets.length > 0,
  );
}

export const isFinished = (t: Ticket) => t.status === "done" || t.status === "canceled";

/** Board columns. Done is ordered by completion, newest first, so it can be grouped by day. */
export function boardColumns(tickets: Ticket[]): { status: Status; tickets: Ticket[] }[] {
  const sorted = [...tickets].sort(byPosition);
  return BOARD_ORDER.map((status) => {
    const column = sorted.filter((t) => t.status === status);
    if (status === "done") column.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    return { status, tickets: column };
  });
}

/** A position that sorts between two neighbours (either may be missing). */
export function positionBetween(before: Ticket | undefined, after: Ticket | undefined): number {
  const a = before?.position ?? null;
  const b = after?.position ?? null;
  if (a !== null && b !== null) return (a + b) / 2;
  if (a !== null) return a + 1;
  if (b !== null) return b - 1;
  return 0;
}

/** Done tickets grouped by completion day: "Today", "Yesterday", "Sun, Sep 27". */
export function groupByCompletionDay(tickets: Ticket[]): { label: string; tickets: Ticket[] }[] {
  const today = toDateKey(new Date());
  const yesterday = toDateKey(addDays(-1));
  const groups: { label: string; tickets: Ticket[] }[] = [];
  for (const t of tickets) {
    const day = t.completedAt ? new Date(t.completedAt) : null;
    const key = day ? toDateKey(day) : "";
    const label =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : day
            ? day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
            : "Earlier";
    const last = groups[groups.length - 1];
    if (last?.label === label) last.tickets.push(t);
    else groups.push({ label, tickets: [t] });
  }
  return groups;
}

/** Every key is required by the bindings; `null` leaves a field unchanged. */
export function patch(fields: Partial<TicketPatch>): TicketPatch {
  return { title: null, description: null, status: null, priority: null, ...fields };
}

/** Mirrors `update_ticket` in Rust so optimistic updates match the server. */
export function applyPatch(ticket: Ticket, p: TicketPatch, siblings: Ticket[]): Ticket {
  const next = { ...ticket };
  if (p.title !== null) next.title = p.title.trim();
  if (p.description !== null) next.description = p.description;
  if (p.priority !== null) next.priority = p.priority;
  if (p.status !== null && p.status !== ticket.status) {
    const group = siblings.filter((t) => t.status === p.status).map((t) => t.position ?? 0);
    next.status = p.status;
    next.position = (group.length ? Math.min(...group) : 1) - 1;
    next.completedAt = p.status === "done" ? Date.now() : null;
  }
  return next;
}

export const BOARD_COLORS: BoardColor[] = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"];

/** Full class names so Tailwind can see them. */
export const SWATCH_BG: Record<BoardColor, string> = {
  gray: "bg-swatch-gray",
  red: "bg-swatch-red",
  orange: "bg-swatch-orange",
  yellow: "bg-swatch-yellow",
  green: "bg-swatch-green",
  blue: "bg-swatch-blue",
  purple: "bg-swatch-purple",
  pink: "bg-swatch-pink",
};

/** "Engineering" → "ENG", "Side Projects" → "SP". */
export function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : words[0];
  return key.replace(/^[0-9]+/, "").slice(0, words.length > 1 ? 5 : 3);
}

// Due dates are local calendar days stored as `YYYY-MM-DD`.

export function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(days: number, from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Today", "Tomorrow", "Oct 14", or "Oct 14, 2027" outside the current year. */
export function formatDue(key: string): string {
  if (key === toDateKey(new Date())) return "Today";
  if (key === toDateKey(addDays(1))) return "Tomorrow";
  const date = parseDateKey(key);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export const isOverdue = (t: Ticket) => t.dueDate !== null && !isFinished(t) && t.dueDate < toDateKey(new Date());

/** Picker presets for `D`. "Next week" is the coming Monday. */
export function duePresets(): { value: string; label: string }[] {
  const today = new Date();
  const toMonday = ((8 - today.getDay()) % 7) || 7;
  return [
    { value: toDateKey(today), label: "Today" },
    { value: toDateKey(addDays(1)), label: "Tomorrow" },
    { value: toDateKey(addDays(toMonday)), label: "Next week" },
    { value: toDateKey(addDays(14)), label: "In two weeks" },
  ];
}

/** Where a ticket can be moved: a board (or the Inbox when `boardId` is `null`) and a project on it. */
export type Destination = { boardId: string | null; projectId: string | null };

export type MoveOption = {
  key: string;
  to: Destination;
  label: string;
  /** The board, for projects on other boards. */
  detail?: string;
  kind: "project" | "board" | "inbox" | "no-project";
  board?: Board;
};

/**
 * Everywhere a ticket can go, nearest first: other projects on its board, then other
 * boards (each followed by its projects), then the Inbox.
 */
export function moveDestinations(ticket: Ticket, boards: Board[], projects: Project[]): MoveOption[] {
  const options: MoveOption[] = [];
  const current = boards.find((b) => b.id === ticket.boardId);
  if (current) {
    for (const p of projects.filter((p) => p.boardId === current.id && p.id !== ticket.projectId)) {
      options.push({ key: `p:${p.id}`, to: { boardId: current.id, projectId: p.id }, label: p.name, kind: "project", board: current });
    }
    if (ticket.projectId) {
      options.push({ key: "no-project", to: { boardId: current.id, projectId: null }, label: "No project", kind: "no-project" });
    }
  }
  for (const b of boards.filter((b) => b.id !== ticket.boardId)) {
    options.push({ key: `b:${b.id}`, to: { boardId: b.id, projectId: null }, label: b.name, kind: "board", board: b });
    for (const p of projects.filter((p) => p.boardId === b.id)) {
      options.push({ key: `p:${p.id}`, to: { boardId: b.id, projectId: p.id }, label: p.name, detail: b.name, kind: "project", board: b });
    }
  }
  if (ticket.boardId) options.push({ key: "inbox", to: { boardId: null, projectId: null }, label: "Inbox", kind: "inbox" });
  return options;
}
