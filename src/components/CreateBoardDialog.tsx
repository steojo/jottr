import { useState } from "react";

import type { Board, BoardColor } from "../bindings";
import { useCreateBoard } from "../lib/queries";
import { BOARD_COLORS, SWATCH_BG, suggestKey } from "../lib/tickets";
import { Dialog, Kbd } from "./ui";

export function CreateBoardDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  const [name, setName] = useState("");
  // The key follows the name until it's edited by hand.
  const [customKey, setCustomKey] = useState<string | null>(null);
  const [color, setColor] = useState<BoardColor>("blue");
  const create = useCreateBoard();
  const key = customKey ?? suggestKey(name);

  function close() {
    setName("");
    setCustomKey(null);
    setColor("blue");
    create.reset();
    onClose();
  }

  function submit() {
    if (!name.trim() || !key) return;
    create.mutate(
      { name, key, color },
      {
        onSuccess: (board) => {
          close();
          onCreated(board);
        },
      },
    );
  }

  const field = "h-8 rounded-md border border-line bg-surface px-2.5 outline-none focus:border-line-strong";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="New board" width="w-[400px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex h-10 items-center border-b border-line-subtle px-4 font-medium">New board</div>
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
              value={key}
              maxLength={5}
              onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className={`${field} w-24 font-mono text-fg`}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-fg-secondary">
            Colour
            <div className="flex gap-2">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
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
          <span className="truncate text-status-error">{create.error ? String(create.error) : ""}</span>
          {/* A real submit button: forms with several fields only submit on Enter if they have one. */}
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-fg"
          >
            Create <Kbd>↵</Kbd>
          </button>
        </div>
      </form>
    </Dialog>
  );
}
