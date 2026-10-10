// Loaded lazily, like the description editor.
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, type Editor } from "@tiptap/react";
import { useEffect, useRef, type RefObject } from "react";

import type { Ticket, TicketDraft } from "../bindings";
import { useMarkdownEditor } from "../lib/editor";
import { linkLine, pickIdeas, TICKET_LINK } from "../lib/notes";

/** Lets the header's Make tickets button reach the editor. */
export type NotesHandle = { makeTickets: () => void };

/** Lines picked out of the notes, and how to swap them for ticket links once the tickets exist. */
export type TicketRequest = { drafts: TicketDraft[]; replace: (tickets: Ticket[]) => void; cancel: () => void };

export default function NotesEditor({
  value,
  onSave,
  onMakeTickets,
  onOpenTicket,
  handle,
}: {
  value: string;
  onSave: (markdown: string) => void;
  onMakeTickets: (request: TicketRequest) => void;
  onOpenTicket: (id: string) => void;
  handle: RefObject<NotesHandle | null>;
}) {
  // The editor keeps its first props, so its handlers read the latest ones from here.
  const actions = useRef({ makeTickets: () => {}, onOpenTicket });
  const editor = useMarkdownEditor({
    value,
    onSave,
    placeholder: "Dump ideas here, one per line. Put the cursor on a line and press ⌘↵ to make it a ticket.",
    extensions: [TaskList, TaskItem.configure({ nested: true })],
    editorProps: {
      attributes: { class: "description outline-none min-h-[60vh]" },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && event.metaKey) {
          actions.current.makeTickets();
          return true;
        }
        if (event.key === "Escape") {
          (view.dom as HTMLElement).blur();
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const href = (event.target as HTMLElement).closest("a")?.getAttribute("href");
        if (!href?.startsWith(TICKET_LINK)) return false;
        actions.current.onOpenTicket(href.slice(TICKET_LINK.length));
        return true;
      },
    },
  });
  actions.current = { makeTickets: () => editor && requestTickets(editor, onMakeTickets), onOpenTicket };

  useEffect(() => {
    handle.current = { makeTickets: () => actions.current.makeTickets() };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  return <EditorContent editor={editor} className="select-text" />;
}

function requestTickets(editor: Editor, onMakeTickets: (request: TicketRequest) => void) {
  const { doc, selection } = editor.state;
  const ideas = pickIdeas(doc, selection.from, selection.to, (nodes) =>
    nodes.length > 0 ? (editor.markdown?.serialize({ type: "doc", content: nodes.map((n) => n.toJSON()) }).trim() ?? "") : "",
  );
  onMakeTickets({
    drafts: ideas.map((idea) => idea.draft),
    replace: (tickets) => {
      if (editor.isDestroyed) return;
      // Leave the notes alone if they changed while the dialog was open.
      if (editor.state.doc === doc) {
        const tr = editor.state.tr;
        // From the bottom up, so the earlier positions stay put.
        for (let i = ideas.length - 1; i >= 0; i--) {
          tr.replaceWith(ideas[i].from, ideas[i].to, linkLine(editor.schema, ideas[i].node, tickets[i]));
        }
        editor.view.dispatch(tr);
      }
      editor.commands.focus();
    },
    cancel: () => !editor.isDestroyed && editor.commands.focus(),
  });
}
