import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, type NewBoard, type NewTicket, type Ticket, type TicketPatch } from "../bindings";
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
