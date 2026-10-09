import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  commands,
  type ChecklistItem,
  type ChecklistPatch,
  type NewBoard,
  type NewTicket,
  type Ticket,
  type TicketPatch,
} from "../bindings";
import { applyPatch } from "./tickets";

// Everything is local, so data is only stale when we change it ourselves.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});

const boardsKey = ["boards"] as const;
const ticketsKey = (boardId: string | null) => ["tickets", boardId ?? "inbox"] as const;

export function useBoards() {
  return useQuery({ queryKey: boardsKey, queryFn: commands.listBoards });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBoard) => commands.createBoard(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardsKey }),
  });
}

/** Tickets on a board, or in the Inbox when `boardId` is `null`. */
export function useTickets(boardId: string | null) {
  return useQuery({ queryKey: ticketsKey(boardId), queryFn: () => commands.listTickets(boardId) });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTicket) => commands.createTicket(input),
    onSuccess: (ticket) =>
      qc.setQueryData<Ticket[]>(ticketsKey(ticket.boardId), (list) => (list ? [...list, ticket] : list)),
  });
}

/** Applies the change to the cache immediately and rolls back if Rust rejects it. */
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, patch }: { ticket: Ticket; patch: TicketPatch }) =>
      commands.updateTicket(ticket.id, patch),
    onMutate: async ({ ticket, patch }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      qc.setQueryData<Ticket[]>(key, (list) =>
        list?.map((t) => (t.id === ticket.id ? applyPatch(t, patch, list) : t)),
      );
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved, _vars, ctx) =>
      qc.setQueryData<Ticket[]>(ctx.key, (list) => list?.map((t) => (t.id === saved.id ? saved : t))),
  });
}

/** Moves a ticket to another board, or to the Inbox when `boardId` is `null`. */
export function useMoveTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, boardId }: { ticket: Ticket; boardId: string | null }) =>
      commands.moveTicket(ticket.id, boardId),
    onMutate: async ({ ticket }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      qc.setQueryData<Ticket[]>(key, (list) => list?.filter((t) => t.id !== ticket.id));
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) =>
      qc.setQueryData<Ticket[]>(ticketsKey(saved.boardId), (list) => (list ? [...list, saved] : list)),
  });
}

/** Replaces one ticket in its list's cache. */
function patchCachedTicket(qc: QueryClient, boardId: string | null, id: string, change: (t: Ticket) => Ticket) {
  qc.setQueryData<Ticket[]>(ticketsKey(boardId), (list) => list?.map((t) => (t.id === id ? change(t) : t)));
}

/** `dueDate` is `YYYY-MM-DD`, or `null` to clear it. */
export function useSetDueDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, dueDate }: { ticket: Ticket; dueDate: string | null }) =>
      commands.setDueDate(ticket.id, dueDate),
    onMutate: async ({ ticket, dueDate }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      patchCachedTicket(qc, ticket.boardId, ticket.id, (t) => ({ ...t, dueDate }));
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) => patchCachedTicket(qc, saved.boardId, saved.id, () => saved),
  });
}

const checklistKey = (ticketId: string) => ["checklist", ticketId] as const;

/**
 * A ticket's checklist plus its mutations. Changes apply to the cache at once,
 * and the ticket's progress counts in the list are kept in step.
 */
export function useChecklist(ticket: Ticket) {
  const qc = useQueryClient();
  const key = checklistKey(ticket.id);
  const query = useQuery({ queryKey: key, queryFn: () => commands.listChecklist(ticket.id) });

  function setItems(change: (items: ChecklistItem[]) => ChecklistItem[]) {
    const items = change(qc.getQueryData<ChecklistItem[]>(key) ?? []);
    qc.setQueryData(key, items);
    patchCachedTicket(qc, ticket.boardId, ticket.id, (t) => ({
      ...t,
      checklistDone: items.filter((i) => i.done).length,
      checklistTotal: items.length,
    }));
  }

  const rollback = (previous: ChecklistItem[] | undefined) => setItems(() => previous ?? []);

  const add = useMutation({
    mutationFn: (text: string) => commands.addChecklistItem(ticket.id, text),
    onSuccess: (item) => setItems((items) => [...items, item]),
  });

  const update = useMutation({
    mutationFn: ({ item, patch }: { item: ChecklistItem; patch: ChecklistPatch }) =>
      commands.updateChecklistItem(item.id, patch),
    onMutate: ({ item, patch }) => {
      const previous = qc.getQueryData<ChecklistItem[]>(key);
      setItems((items) =>
        items.map((i) =>
          i.id === item.id ? { ...i, text: patch.text ?? i.text, done: patch.done ?? i.done } : i,
        ),
      );
      return { previous };
    },
    onError: (_error, _vars, ctx) => rollback(ctx?.previous),
  });

  const remove = useMutation({
    mutationFn: (item: ChecklistItem) => commands.deleteChecklistItem(item.id),
    onMutate: (item) => {
      const previous = qc.getQueryData<ChecklistItem[]>(key);
      setItems((items) => items.filter((i) => i.id !== item.id));
      return { previous };
    },
    onError: (_error, _vars, ctx) => rollback(ctx?.previous),
  });

  return { items: query.data, add, update, remove };
}
