import { keepPreviousData, MutationCache, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  commands,
  type Attachment,
  type ChecklistItem,
  type ChecklistPatch,
  type Color,
  type LabelPatch,
  type NewBoard,
  type NewTicket,
  type Settings,
  type Status,
  type Ticket,
  type TicketPatch,
} from "../bindings";
import { pastedName, toBase64 } from "./attachments";
import { addDays, applyPatch, toDateKey, type Destination } from "./tickets";

// Everything is local, so data is only stale when we change it ourselves.
// My Focus, search and the Archive span every board, so any change refreshes them.
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  mutationCache: new MutationCache({
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["focus"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      void queryClient.invalidateQueries({ queryKey: archiveKey });
    },
  }),
});

const boardsKey = ["boards"] as const;
const ticketsKey = (boardId: string | null) => ["tickets", boardId ?? "inbox"] as const;
const archiveKey = ["archive"] as const;

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
      if (ticket.archivedAt !== null) {
        // Edits show in the Archive at once; a status change takes the ticket out of it.
        qc.setQueryData<Ticket[]>(archiveKey, (list) =>
          list?.map((t) => (t.id === ticket.id ? applyPatch(t, patch, []) : t)).filter((t) => t.archivedAt !== null),
        );
      }
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) => storeCachedTicket(qc, saved),
  });
}

/** Moves a ticket to a board and project. Within the same board, only its project changes. */
export function useMoveTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, to }: { ticket: Ticket; to: Destination }) =>
      commands.moveTicket(ticket.id, to.boardId, to.projectId),
    onMutate: async ({ ticket, to }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      qc.setQueryData<Ticket[]>(key, (list) =>
        to.boardId === ticket.boardId
          ? list?.map((t) => (t.id === ticket.id ? { ...t, projectId: to.projectId } : t))
          : list?.filter((t) => t.id !== ticket.id),
      );
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) => storeCachedTicket(qc, saved),
  });
}

const projectsKey = ["projects"] as const;

export function useProjects() {
  return useQuery({ queryKey: projectsKey, queryFn: commands.listProjects });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, name }: { boardId: string; name: string }) => commands.createProject(boardId, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => commands.renameProject(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey }),
  });
}

/** Its tickets stay on the board without a project, so ticket lists are refetched too. */
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsKey });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

/** Places a ticket at an exact status and position, e.g. after a drag and drop. */
export function useRepositionTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, status, position }: { ticket: Ticket; status: Status; position: number }) =>
      commands.repositionTicket(ticket.id, status, position),
    onMutate: async ({ ticket, status, position }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      patchCachedTicket(qc, ticket.boardId, ticket.id, (t) => ({
        ...t,
        status,
        position,
        completedAt: status === t.status ? t.completedAt : status === "done" ? Date.now() : null,
      }));
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) => patchCachedTicket(qc, saved.boardId, saved.id, () => saved),
  });
}

/** Replaces one ticket in its list's cache. */
function patchCachedTicket(qc: QueryClient, boardId: string | null, id: string, change: (t: Ticket) => Ticket) {
  qc.setQueryData<Ticket[]>(ticketsKey(boardId), (list) => list?.map((t) => (t.id === id ? change(t) : t)));
}

/** Puts a saved ticket in its list's cache, adding it if it has just arrived (moved or restored). */
function storeCachedTicket(qc: QueryClient, saved: Ticket) {
  if (saved.archivedAt !== null) return;
  qc.setQueryData<Ticket[]>(ticketsKey(saved.boardId), (list) =>
    !list ? list : list.some((t) => t.id === saved.id) ? list.map((t) => (t.id === saved.id ? saved : t)) : [...list, saved],
  );
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

const labelsKey = ["labels"] as const;

/** All labels, sorted by name. Labels are shared by every board. */
export function useLabels() {
  return useQuery({ queryKey: labelsKey, queryFn: commands.listLabels });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: Color }) => commands.createLabel(name, color),
    onSuccess: () => qc.invalidateQueries({ queryKey: labelsKey }),
  });
}

export function useUpdateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LabelPatch }) => commands.updateLabel(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: labelsKey }),
  });
}

/** Deleting removes the label from every ticket, so ticket lists are refetched too. */
export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.deleteLabel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: labelsKey });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

/** Adds or removes one label on a ticket. */
export function useSetTicketLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, labelId, applied }: { ticket: Ticket; labelId: string; applied: boolean }) =>
      commands.setTicketLabel(ticket.id, labelId, applied),
    onMutate: async ({ ticket, labelId, applied }) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      patchCachedTicket(qc, ticket.boardId, ticket.id, (t) => ({
        ...t,
        labelIds: applied ? [...new Set([...t.labelIds, labelId])] : t.labelIds.filter((id) => id !== labelId),
      }));
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (saved) => patchCachedTicket(qc, saved.boardId, saved.id, () => saved),
  });
}

/** Permanently deletes a ticket; the UI asks first, since there's no undo. */
export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticket: Ticket) => commands.deleteTicket(ticket.id),
    onMutate: async (ticket) => {
      const key = ticketsKey(ticket.boardId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Ticket[]>(key);
      qc.setQueryData<Ticket[]>(key, (list) => list?.filter((t) => t.id !== ticket.id));
      // A failed delete puts it back when the Archive refetches.
      qc.setQueryData<Ticket[]>(archiveKey, (list) => list?.filter((t) => t.id !== ticket.id));
      return { key, previous };
    },
    onError: (_error, _vars, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
    onSuccess: (_result, ticket) => {
      qc.removeQueries({ queryKey: checklistKey(ticket.id) });
      qc.removeQueries({ queryKey: attachmentsKey(ticket.id) });
    },
  });
}

/** Days ahead that count as "due soon" in My Focus. */
export const FOCUS_DAYS = 7;

/** My Focus: in-progress, in-review and soon-due tickets from every board and the Inbox. */
export function useFocus() {
  const dueBy = toDateKey(addDays(FOCUS_DAYS));
  return useQuery({ queryKey: ["focus", dueBy], queryFn: () => commands.listFocus(dueBy) });
}

/** Full-text search over every ticket. Keeps the last results on screen while typing. */
export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => commands.searchTickets(q),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Archived tickets from every board and the Inbox. Only loaded while the Archive is showing. */
export function useArchive(enabled: boolean) {
  return useQuery({ queryKey: archiveKey, queryFn: commands.listArchived, enabled });
}

/** Brings a ticket back from the Archive to the top of its status group. */
export function useRestoreTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticket: Ticket) => commands.restoreTicket(ticket.id),
    onMutate: async (ticket) => {
      await qc.cancelQueries({ queryKey: archiveKey });
      const previous = qc.getQueryData<Ticket[]>(archiveKey);
      qc.setQueryData<Ticket[]>(archiveKey, (list) => list?.filter((t) => t.id !== ticket.id));
      return { previous };
    },
    onError: (_error, _ticket, ctx) => ctx && qc.setQueryData(archiveKey, ctx.previous),
    onSuccess: (saved) => storeCachedTicket(qc, saved),
  });
}

const AUTO_ARCHIVE_EVERY_MS = 60 * 60 * 1000;

/** Rust archives at launch; this keeps archiving hourly while the app stays open. */
export function useAutoArchive() {
  const qc = useQueryClient();
  useEffect(() => {
    const timer = setInterval(() => {
      void commands.autoArchive().then((archived) => {
        if (archived === 0) return;
        for (const queryKey of [["tickets"], archiveKey, ["search"]]) void qc.invalidateQueries({ queryKey });
      });
    }, AUTO_ARCHIVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [qc]);
}

const settingsKey = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: commands.getSettings });
}

/** Saving can archive tickets straight away, so ticket lists are refetched too. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => commands.updateSettings(settings),
    onMutate: async (settings) => {
      await qc.cancelQueries({ queryKey: settingsKey });
      const previous = qc.getQueryData<Settings>(settingsKey);
      qc.setQueryData(settingsKey, settings);
      return { previous };
    },
    onError: (_error, _settings, ctx) => ctx && qc.setQueryData(settingsKey, ctx.previous),
    onSuccess: (saved) => {
      qc.setQueryData(settingsKey, saved);
      void qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

const attachmentsKey = (ticketId: string) => ["attachments", ticketId] as const;

/** A ticket's attachments, oldest first. */
export function useAttachments(ticketId: string) {
  return useQuery({ queryKey: attachmentsKey(ticketId), queryFn: () => commands.listAttachments(ticketId) });
}

/** Files to attach: paths from the file picker or a drop, or files pasted from the clipboard. */
export type AttachSource = { paths: string[] } | { files: File[] };

/** Copies files into Jottr's storage and attaches them. Resolves with what was added. */
export function useAddAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticket, source }: { ticket: Ticket; source: AttachSource }): Promise<Attachment[]> =>
      "paths" in source
        ? commands.addAttachments(ticket.id, source.paths)
        : Promise.all(
            source.files.map(async (file) => commands.addAttachmentData(ticket.id, pastedName(file), await toBase64(file))),
          ),
    // Some files may have been added before one failed, so refetch either way.
    onSettled: (_added, _error, { ticket }) => qc.invalidateQueries({ queryKey: attachmentsKey(ticket.id) }),
  });
}

/** Deletes an attachment and its file; the UI asks first. */
export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachment: Attachment) => commands.deleteAttachment(attachment.id),
    onMutate: async (attachment) => {
      const key = attachmentsKey(attachment.ticketId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Attachment[]>(key);
      qc.setQueryData<Attachment[]>(key, (list) => list?.filter((a) => a.id !== attachment.id));
      return { key, previous };
    },
    onError: (_error, _attachment, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
  });
}
