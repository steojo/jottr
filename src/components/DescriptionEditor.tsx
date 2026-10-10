// Loaded lazily: TipTap is the heaviest dependency and only the ticket page and notes need it.
import { EditorContent } from "@tiptap/react";

import { useMarkdownEditor } from "../lib/editor";

export default function DescriptionEditor({ value, onSave }: { value: string; onSave: (markdown: string) => void }) {
  const editor = useMarkdownEditor({
    value,
    onSave,
    placeholder: "Add a description…",
    editorProps: {
      handleKeyDown: (view, event) => {
        // Esc or ⌘Enter finishes editing; the next Esc closes the ticket.
        if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
          (view.dom as HTMLElement).blur();
          return true;
        }
        return false;
      },
    },
  });

  return <EditorContent editor={editor} className="select-text" />;
}
