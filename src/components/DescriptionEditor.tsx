// Loaded lazily: TipTap is the heaviest dependency and only the ticket page needs it.
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

const SAVE_DELAY_MS = 500;

/**
 * Rich text with markdown shortcuts, stored as markdown. Saves after a pause
 * in typing, on blur, and when unmounted (e.g. moving to the next ticket).
 */
export default function DescriptionEditor({ value, onSave }: { value: string; onSave: (markdown: string) => void }) {
  const saved = useRef(value);
  // Kept current on every change, so saving never touches an editor that may be destroyed.
  const latest = useRef(value);
  const timer = useRef<number | undefined>(undefined);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  function flush() {
    window.clearTimeout(timer.current);
    if (latest.current !== saved.current) {
      saved.current = latest.current;
      onSaveRef.current(latest.current);
    }
  }

  const editor = useEditor({
    extensions: [
      // Links open in the webview otherwise, replacing the app.
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown,
      Placeholder.configure({ placeholder: "Add a description…" }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "description outline-none" },
      handleKeyDown: (view, event) => {
        // Esc or ⌘Enter finishes editing; the next Esc closes the ticket.
        if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
          (view.dom as HTMLElement).blur();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      latest.current = editor.getMarkdown();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    onBlur: flush,
  });

  useEffect(() => flush, []);

  return <EditorContent editor={editor} className="select-text" />;
}
