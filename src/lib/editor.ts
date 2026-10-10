// Only the lazy-loaded editors import this, so TipTap stays out of the main bundle.
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { EditorProps } from "@tiptap/pm/view";
import { useEditor, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import { TICKET_LINK } from "./notes";

const SAVE_DELAY_MS = 500;

/**
 * Rich text with markdown shortcuts, stored as markdown. Saves after a pause in typing,
 * on blur, and when unmounted (e.g. moving to the next ticket).
 */
export function useMarkdownEditor({
  value,
  onSave,
  placeholder,
  extensions = [],
  editorProps,
}: {
  value: string;
  onSave: (markdown: string) => void;
  placeholder: string;
  extensions?: Extensions;
  editorProps?: EditorProps;
}) {
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
      StarterKit.configure({
        link: {
          // Links open in the webview otherwise, replacing the app.
          openOnClick: false,
          isAllowedUri: (url, { defaultValidate }) => url.startsWith(TICKET_LINK) || defaultValidate(url),
        },
      }),
      Markdown,
      Placeholder.configure({ placeholder }),
      ...extensions,
    ],
    content: value,
    contentType: "markdown",
    editorProps: { attributes: { class: "description outline-none" }, ...editorProps },
    onUpdate: ({ editor }) => {
      latest.current = editor.getMarkdown();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    onBlur: flush,
  });

  useEffect(() => flush, []);

  return editor;
}
