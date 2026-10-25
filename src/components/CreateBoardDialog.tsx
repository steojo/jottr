import { useState } from "react";

import type { Board, Color } from "../bindings";
import { useCreateBoard, useUpdateBoard } from "../lib/queries";
import { COLORS, SWATCH_BG, suggestKey } from "../lib/tickets";
import { Dialog, Kbd } from "./ui";

export function CreateBoardDialog({
  open,
  board,
  onClose,
  onCreated,
}: {
  open: boolean;
  board?: Board;
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={board ? "Edit board" : "New board"} width="w-[400px]">
      {open && <BoardForm board={board} onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function BoardForm({ board, onClose, onCreated }: { board?: Board; onClose: () => void; onCreated: (board: Board) => void }) {
  const [name, setName] = useState(board?.name ?? "");
  // The key follows the name until it's edited by hand.
  const [customKey, setCustomKey] = useState<string | null>(board?.key ?? null);
  const [color, setColor] = useState<Color>(board?.color ?? "blue");
  const create = useCreateBoard();
  const update = useUpdateBoard();
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const key = customKey ?? suggestKey(name);

  async function submit() {
    if (!name.trim() || !key || saving) return;
    const input = { name: name.trim(), key, color };
    try {
      const saved = board ? await update.mutateAsync({ id: board.id, input }) : await create.mutateAsync(input);
      onClose();
      if (!board) onCreated(saved);
    } catch {
      // The mutation error stays visible in the form.
    }
  }

  const field = "h-8 rounded-md border border-line bg-surface px-2.5 outline-none focus:border-line-strong";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex h-10 items-center border-b border-line-subtle px-4 font-medium">{board ? "Edit board" : "New board"}</div>
      <div className="flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1.5 text-fg-secondary">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering"
            className={`${field} text-fg placeholder:text-fg-quaternary`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-fg-secondary">
          <span>
            Key <span className="text-fg-tertiary">· used in ticket IDs, like {key || "ENG"}-1</span>
          </span>
          <input
            aria-label="Key"
            value={key}
            maxLength={5}
            onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            className={`${field} w-24 font-mono text-fg`}
          />
        </label>
        {board && <p className="text-fg-secondary">Changing the key updates the IDs shown on this board’s tickets.</p>}
        <div className="flex flex-col gap-1.5 text-fg-secondary">
          Colour
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={`size-6 rounded-md ${SWATCH_BG[c]} ${
                  c === color ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-elevated" : ""
                }`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex h-10 items-center justify-between border-t border-line-subtle px-3 text-fg-tertiary">
        <span role="alert" className="text-status-error">{error ? String(error) : ""}</span>
        {/* A real submit button: forms with several fields only submit on Enter if they have one. */}
        <button
          type="submit"
          disabled={saving || !name.trim() || !key}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-fg"
        >
          {board ? "Save" : "Create"} <Kbd>↵</Kbd>
        </button>
      </div>
    </form>
  );
}
