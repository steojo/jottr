// Turning lines of notes into tickets. Pure functions over the editor's document, so they can
// be tested without a window; only the lazy-loaded notes editor imports them.
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

import type { ChecklistDraft, Ticket, TicketDraft } from "../bindings";
import { ticketKey } from "./tickets";

/** Link to a ticket, written into notes when lines become tickets. */
export const TICKET_LINK = "jottr://ticket/";

const LISTS = ["bulletList", "orderedList", "taskList"];
const ITEMS = ["listItem", "taskItem"];

/** What a selection becomes. `node` is the list item or block it replaces; `null` when several blocks merge. */
export type Idea = { draft: TicketDraft; from: number; to: number; node: PMNode | null };

/**
 * The ideas the selection (or just the cursor) covers. Indentation decides: each top-level
 * list item is a ticket, with what's indented under it as the description and checkboxes as
 * the checklist. With no list in the selection, it's all one ticket, titled by its first line.
 */
export function pickIdeas(doc: PMNode, from: number, to: number, serialize: (nodes: PMNode[]) => string): Idea[] {
  const touched = (pos: number, node: PMNode) => pos < to && from < pos + node.nodeSize;
  const picked: { node: PMNode; pos: number }[] = [];
  let hasList = false;
  doc.forEach((node, pos) => {
    if (!touched(pos, node)) return;
    if (!LISTS.includes(node.type.name)) return void picked.push({ node, pos });
    hasList = true;
    node.forEach((item, offset) => {
      if (touched(pos + 1 + offset, item)) picked.push({ node: item, pos: pos + 1 + offset });
    });
  });
  if (picked.length === 0) return [];

  if (!hasList) {
    const [first, ...rest] = picked;
    const last = picked[picked.length - 1];
    const [title, ...more] = lines(first.node);
    if (!title) return [];
    const description = joinBlocks([more.join("\n\n"), serialize(rest.map((p) => p.node))]);
    const draft = { title, description, checklist: [] };
    return [{ draft, from: first.pos, to: last.pos + last.node.nodeSize, node: rest.length === 0 ? first.node : null }];
  }

  return picked.flatMap(({ node, pos }): Idea[] => {
    const [head, ...children] = ITEMS.includes(node.type.name) ? childNodes(node) : [node];
    const [title, ...more] = head ? lines(head) : [];
    if (!title) return [];
    const blocks: PMNode[] = [];
    const checklist: ChecklistDraft[] = [];
    sortChildren(children, blocks, checklist);
    const draft = { title, description: joinBlocks([more.join("\n\n"), serialize(blocks)]), checklist };
    return [{ draft, from: pos, to: pos + node.nodeSize, node }];
  });
}

/** Checkboxes become checklist items; everything else is description. */
function sortChildren(nodes: PMNode[], blocks: PMNode[], checklist: ChecklistDraft[]) {
  for (const node of nodes) {
    if (node.type.name !== "taskList") {
      blocks.push(node);
      continue;
    }
    node.forEach((task) => {
      const [head, ...rest] = childNodes(task);
      const text = head ? lines(head).join(" ") : "";
      if (text) checklist.push({ text, done: Boolean(task.attrs.checked) });
      sortChildren(rest, blocks, checklist);
    });
  }
}

/** The ticket's ID, linked, then its title, in place of what it was made from. */
export function linkLine(schema: Schema, node: PMNode | null, ticket: Ticket): PMNode {
  const content = [
    schema.text(ticketKey(ticket) ?? "Ticket", [schema.marks.link.create({ href: TICKET_LINK + ticket.id })]),
    schema.text(` ${ticket.title}`),
  ];
  if (node && ITEMS.includes(node.type.name)) return node.type.create(node.attrs, schema.nodes.paragraph.create(null, content));
  if (node?.type.name === "heading") return node.type.create(node.attrs, content);
  return schema.nodes.paragraph.create(null, content);
}

/** A block's text, split at line breaks, without blank lines. */
function lines(node: PMNode): string[] {
  return node
    .textBetween(0, node.content.size, "\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function childNodes(node: PMNode): PMNode[] {
  const children: PMNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

const joinBlocks = (parts: string[]) => parts.filter(Boolean).join("\n\n");
