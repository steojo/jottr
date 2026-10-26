import { keepPreviousData, MutationCache, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import {
  commands,
  type Attachment,
  type Board,
  type ChecklistItem,
  type ChecklistPatch,
  type Color,
  type LabelPatch,
  type NewBoard,
  type NewTicket,
  type Note,
  type Project,
  type Settings,
  type Status,
  type Ticket,
  type TicketDraft,
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

export function useUpdateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: NewBoard }) => commands.updateBoard(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: boardsKey });
      const previous = qc.getQueryData<Board[]>(boardsKey);
      qc.setQueryData<Board[]>(boardsKey, (list) => list?.map((b) => (b.id === id ? { ...b, ...input } : b)));
      return { previous };
    },
    onError: (_error, _vars, ctx) => qc.setQueryData(boardsKey, ctx?.previous),
    onSuccess: (board) => {
      qc.setQueryData<Board[]>(boardsKey, (list) => list?.map((b) => (b.id === board.id ? board : b)));
      // Keep cached board tickets in step; the mutation cache refreshes cross-board views.
      qc.setQueriesData<Ticket[]>({ queryKey: ["tickets"] }, (list) =>
        list?.map((t) => (t.boardId === board.id ? { ...t, boardKey: board.key } : t)),
      );
    },
  });
}

/** Tickets are preserved in the Inbox; projects, labels, and notes belong to the deleted board. */
export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.deleteBoard(id),
    onSuccess: async (_result, id) => {
      qc.setQueryData<Board[]>(boardsKey, (list) => list?.filter((b) => b.id !== id));
      qc.removeQueries({ queryKey: ticketsKey(id) });
      qc.removeQueries({ queryKey: ["notes", id] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectsKey }),
        qc.invalidateQueries({ queryKey: labelsKey }),
        qc.invalidateQueries({ queryKey: ticketsKey(null) }),
      ]);
    },
  });
}

type ReorderInput = { id: string; beforeId: string | null };

/** Both sidebar lists update immediately. Rust keeps project moves within their board. */
function useReorderSidebar<T extends { id: string }>(
  key: readonly string[],
  save: (id: string, beforeId: string | null) => Promise<unknown>,
  sameGroup: (a: T, b: T) => boolean,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: key,
    scope: { id: key[0] },
    mutationFn: ({ id, beforeId }: ReorderInput) => save(id, beforeId),
    onMutate: async ({ id, beforeId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<T[]>(key);
      qc.setQueryData<T[]>(key, (list) => {
        if (!list) return list;
        const moved = list.find((item) => item.id === id);
        if (!moved || beforeId === id) return list;
        const peers = list.filter((item) => sameGroup(item, moved) && item.id !== id);
        const next = beforeId === null ? peers.length : peers.findIndex((item) => item.id === beforeId);
        if (next < 0) return list;
        peers.splice(next, 0, moved);
        let index = 0;
        return list.map((item) => (sameGroup(item, moved) ? peers[index++] : item));
      });
      return { previous };
    },
    onError: (_error, _vars, ctx) => qc.setQueryData(key, ctx?.previous),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: key }) === 1) return qc.invalidateQueries({ queryKey: key });
    },
  });
}

export const useReorderBoard = () => useReorderSidebar<Board>(boardsKey, commands.reorderBoard, () => true);
export const useReorderProject = () =>
  useReorderSidebar<Project>(projectsKey, commands.reorderProject, (a, b) => a.boardId === b.boardId);

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

/** One ticket, wherever it is now, e.g. one linked from notes. */
export const fetchTicket = (id: string) => commands.getTicket(id);

/** Tickets made from lines of notes. */
export function useCreateTickets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { boardId: string; projectId: string | null; status: Status; drafts: TicketDraft[] }) =>
      commands.createTickets(input.boardId, input.projectId, input.status, input.drafts),
    onSuccess: (tickets, { boardId }) =>
      qc.setQueryData<Ticket[]>(ticketsKey(boardId), (list) => (list ? [...list, ...tickets] : list)),
  });
}

const notesKey = (boardId: string, projectId: string | null) => ["notes", boardId, projectId ?? "board"] as const;

/** Notes on a project, or on the board itself when `projectId` is `null`, in tab order. */
export function useNotes(boardId: string, projectId: string | null) {
  return useQuery({ queryKey: notesKey(boardId, projectId), queryFn: () => commands.listNotes(boardId, projectId) });
}

/**
 * Changes notes outside the mutation cache: they don't change any tickets, so My Focus and
 * search needn't refresh after every pause in typing.
 */
export function useNoteActions(boardId: string, projectId: string | null) {
  const qc = useQueryClient();
  const key = notesKey(boardId, projectId);
  const change = (update: (notes: Note[]) => Note[]) => qc.setQueryData<Note[]>(key, (notes) => notes && update(notes));
  return {
    save: (id: string, body: string) => {
      // An editor saves as it closes, which can be just after its note was deleted.
      if (!qc.getQueryData<Note[]>(key)?.some((n) => n.id === id)) return Promise.resolve(null);
      change((notes) => notes.map((n) => (n.id === id ? { ...n, body } : n)));
      return commands.setNoteBody(id, body);
    },
    create: async (title: string) => {
      const note = await commands.createNote(boardId, projectId, title);
      change((notes) => [...notes, note]);
      return note;
    },
    rename: async (id: string, title: string) => {
      const note = await commands.renameNote(id, title);
      change((notes) => notes.map((n) => (n.id === id ? note : n)));
    },
    remove: async (id: string) => {
      await commands.deleteNote(id);
      change((notes) => notes.filter((n) => n.id !== id));
    },
  };
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
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: projectsKey });
      const previous = qc.getQueryData<Project[]>(projectsKey);
      qc.setQueryData<Project[]>(projectsKey, (list) => list?.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
      return { previous };
    },
    onError: (_error, _vars, ctx) => qc.setQueryData(projectsKey, ctx?.previous),
    onSuccess: (project) => qc.setQueryData<Project[]>(projectsKey, (list) => list?.map((p) => (p.id === project.id ? project : p))),
  });
}

/** Its tickets stay on the board without a project, so ticket lists are refetched too. */
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.deleteProject(id),
    onSuccess: async (_result, id) => {
      qc.removeQueries({ predicate: (query) => query.queryKey[0] === "notes" && query.queryKey[2] === id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectsKey }),
        qc.invalidateQueries({ queryKey: ["tickets"] }),
      ]);
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

/** Bumps `updatedAt` on a cached ticket after an edit saved outside it, e.g. an attachment. */
function touchCachedTicket(qc: QueryClient, id: string) {
  qc.setQueriesData<Ticket[]>({ queryKey: ["tickets"] }, (list) =>
    list?.map((t) => (t.id === id ? { ...t, updatedAt: Date.now() } : t)),
  );
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
      updatedAt: Date.now(),
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

/** Every board's labels, sorted by name. Each belongs to one board; narrow by `boardId`. */
export function useLabels() {
  return useQuery({ queryKey: labelsKey, queryFn: commands.listLabels });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, name, color }: { boardId: string; name: string; color: Color }) =>
      commands.createLabel(boardId, name, color),
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

/**
 * Quick capture runs in its own window, so Rust sends each ticket it adds (`ticket-captured`)
 * for the Inbox to show at once.
 */
export function useCapturedTickets() {
  const qc = useQueryClient();
  useEffect(() => {
    const unlisten = listen<Ticket>("ticket-captured", ({ payload }) => {
      storeCachedTicket(qc, payload);
      for (const queryKey of [["focus"], ["search"]]) void qc.invalidateQueries({ queryKey });
    });
    return () => void unlisten.then((stop) => stop());
  }, [qc]);
}

const settingsKey = ["settings"] as const;
const notificationStatusKey = ["notification-status"] as const;

/** System permission can change outside Jottr, so refresh it whenever Settings regains focus. */
export function useNotificationStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    const stop = listen("notification-status-changed", () => {
      void qc.invalidateQueries({ queryKey: notificationStatusKey });
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [qc]);
  return useQuery({
    queryKey: notificationStatusKey,
    queryFn: commands.getNotificationStatus,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
}

/** Subscribe before draining Rust's mailbox, including a click which launched the app. */
export function useNotificationTickets(onOpen: (ticket: Ticket) => void, onError: (message: string) => void) {
  const callbacks = useRef({ onOpen, onError });
  callbacks.current = { onOpen, onError };
  useEffect(() => {
    let disposed = false;
    async function drain() {
      try {
        const id = await commands.takeNotificationTicket();
        if (id) callbacks.current.onOpen(await fetchTicket(id));
      } catch {
        callbacks.current.onError("Couldn't open that reminder's ticket. It may have been deleted.");
      }
    }
    const stop = listen("notification-open-ticket", () => { void drain(); }).then((unlisten) => {
      if (!disposed) void drain();
      return unlisten;
    });
    return () => { disposed = true; void stop.then((unlisten) => unlisten()); };
  }, []);
}

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
    onSettled: () => qc.invalidateQueries({ queryKey: notificationStatusKey }),
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
    onSettled: (_added, _error, { ticket }) => {
      touchCachedTicket(qc, ticket.id);
      return qc.invalidateQueries({ queryKey: attachmentsKey(ticket.id) });
    },
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
      touchCachedTicket(qc, attachment.ticketId);
      return { key, previous };
    },
    onError: (_error, _attachment, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
  });
}
