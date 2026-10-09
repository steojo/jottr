import type { BoardColor, Priority, Status, Ticket, TicketPatch } from "../bindings";

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
