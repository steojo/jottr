import type { Board, Color, Priority, Project, Status, Ticket, TicketPatch } from "../bindings";

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

/** Urgent tickets are pinned above the rest of their status group until they're finished. */
export const isPinned = (t: Pick<Ticket, "priority" | "status">) => t.priority === "urgent" && !isFinished(t);

/** Order within a status group: pinned tickets first, then by position. */
export const byListOrder = (a: Ticket, b: Ticket) =>
  Number(isPinned(b)) - Number(isPinned(a)) || (a.position ?? 0) - (b.position ?? 0);

/** A list section, headed by a status or, in My Focus, a plain label. */
export type TicketGroup = { status: Status | null; label?: string; tickets: Ticket[] };

/** The list's display order: status groups (boards) or one flat list (Inbox). */
export function groupTickets(tickets: Ticket[], grouped: boolean): TicketGroup[] {
  const sorted = [...tickets].sort(byListOrder);
  if (!grouped) return [{ status: null, tickets: sorted }];
  return LIST_ORDER.map((status) => ({ status, tickets: sorted.filter((t) => t.status === status) })).filter(
    (g) => g.tickets.length > 0,
  );
}

export const isFinished = (t: Pick<Ticket, "status">) => t.status === "done" || t.status === "canceled";

/** Board columns. Done is ordered by completion, newest first, so it can be grouped by day. */
export function boardColumns(tickets: Ticket[]): { status: Status; tickets: Ticket[] }[] {
  const sorted = [...tickets].sort(byListOrder);
  return BOARD_ORDER.map((status) => {
    const column = sorted.filter((t) => t.status === status);
    if (status === "done") column.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    return { status, tickets: column };
  });
}

/**
 * Position for a ticket dropped at its index in `ids` (a column in `status`). Only neighbours on
 * its side of the pin line count, so a drop across the line snaps back to the nearest end of its side.
 */
export function dropPosition(ids: string[], id: string, status: Status, byId: Map<string, Ticket>): number {
  const pinned = (x: string) => {
    const t = byId.get(x);
    return t !== undefined && isPinned({ priority: t.priority, status });
  };
  const side = ids.filter((x) => pinned(x) === pinned(id));
  const i = side.indexOf(id);
  return positionBetween(byId.get(side[i - 1]), byId.get(side[i + 1]));
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

/** Mirrors `update_ticket` in Rust so optimistic updates match the server. A status change
 * also brings the ticket back from the Archive. */
export function applyPatch(ticket: Ticket, p: TicketPatch, siblings: Ticket[]): Ticket {
  const next = { ...ticket };
  const top = (status: Status) => {
    const group = siblings.filter((t) => t.status === status).map((t) => t.position ?? 0);
    return (group.length ? Math.min(...group) : 1) - 1;
  };
  if (p.title !== null) next.title = p.title.trim();
  if (p.description !== null) next.description = p.description;
  if (p.priority !== null) {
    next.priority = p.priority;
    if ((p.priority === "urgent") !== (ticket.priority === "urgent")) next.position = top(ticket.status);
  }
  if (p.status !== null && p.status !== ticket.status) {
    next.status = p.status;
    next.position = top(p.status);
    next.completedAt = p.status === "done" ? Date.now() : null;
    next.archivedAt = null;
  }
  return next;
}

export const COLORS: Color[] = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"];

/** The first colour no label uses yet, so new labels look distinct; cycles once all are taken. */
export function nextLabelColor(labels: { color: Color }[]): Color {
  const order: Color[] = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];
  return order.find((c) => !labels.some((l) => l.color === c)) ?? order[labels.length % order.length];
}

/** Full class names so Tailwind can see them. */
export const SWATCH_BG: Record<Color, string> = {
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

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

/** Like Linear: "Aug 13" for the last three months, then "Mar 2026" once the day stops mattering. */
export function formatCreated(ms: number): string {
  return (ms > addDays(-90).getTime() ? monthDay : monthYear).format(ms);
}

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const fullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Today 2:32 PM", "Yesterday 9:10 AM", "Oct 8" this year, or "Oct 8, 2025" before it. */
export function formatTimestamp(ms: number): string {
  const day = toDateKey(new Date(ms));
  if (day === toDateKey(new Date())) return `Today ${time.format(ms)}`;
  if (day === toDateKey(addDays(-1))) return `Yesterday ${time.format(ms)}`;
  return new Date(ms).getFullYear() === new Date().getFullYear() ? monthDay.format(ms) : fullDate.format(ms);
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

/** My Focus sections. Each ticket appears once, in the most urgent section it fits. */
export function focusGroups(tickets: Ticket[]): TicketGroup[] {
  const today = toDateKey(new Date());
  const overdue = tickets.filter((t) => t.dueDate !== null && t.dueDate < today);
  const dueSoon = tickets.filter((t) => t.dueDate !== null && t.dueDate >= today);
  const active = tickets.filter((t) => t.dueDate === null);
  return [
    { status: null, label: "Overdue", tickets: overdue },
    { status: null, label: "Due soon", tickets: dueSoon },
    { status: null, label: "In progress", tickets: active.sort(byListOrder) },
  ].filter((g) => g.tickets.length > 0);
}

/** The Archive, grouped by the month each ticket was finished, newest first. */
export function archiveGroups(tickets: Ticket[]): TicketGroup[] {
  const sorted = [...tickets].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const groups: TicketGroup[] = [];
  for (const t of sorted) {
    const label = t.completedAt
      ? new Date(t.completedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "Earlier";
    const last = groups[groups.length - 1];
    if (last?.label === label) last.tickets.push(t);
    else groups.push({ status: null, label, tickets: [t] });
  }
  return groups;
}

/** "1 day", "7 days". */
export const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Narrowing the current view. Within a kind, any match counts; across kinds, all must match. */
export type Filters = { priorities: Priority[]; labelIds: string[]; projectIds: string[] };

export const NO_FILTERS: Filters = { priorities: [], labelIds: [], projectIds: [] };

/** The `projectIds` value standing for "no project". */
export const NO_PROJECT = "none";

export const filterCount = (f: Filters) => f.priorities.length + f.labelIds.length + f.projectIds.length;

export function applyFilters(tickets: Ticket[], f: Filters): Ticket[] {
  return tickets.filter(
    (t) =>
      (f.priorities.length === 0 || f.priorities.includes(t.priority)) &&
      (f.labelIds.length === 0 || t.labelIds.some((id) => f.labelIds.includes(id))) &&
      (f.projectIds.length === 0 || f.projectIds.includes(t.projectId ?? NO_PROJECT)),
  );
}
