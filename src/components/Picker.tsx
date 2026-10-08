import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { ContextChip, Dialog, Kbd } from "./ui";

export type PickerOption<T> = { value: T; label: string; icon?: ReactNode };

/**
 * Keyboard-first option list: `1`–`9` picks directly, arrows or `J`/`K` move,
 * `Enter` picks, `Esc` closes.
 */
export function Picker<T>({
  open,
  onOpenChange,
  title,
  context,
  options,
  current,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  context?: string;
  options: PickerOption<T>[];
  current?: T;
  onSelect: (value: T) => void;
}) {
  const [index, setIndex] = useState(0);

  // Start on the current value each time the picker opens.
  useEffect(() => {
    if (open) setIndex(Math.max(0, options.findIndex((o) => o.value === current)));
  }, [open]);

  function pick(i: number) {
    const option = options[i];
    if (!option) return;
    onOpenChange(false);
    onSelect(option.value);
  }

  function onKeyDown(e: KeyboardEvent) {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 9) pick(n - 1);
    else if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => (i + 1) % options.length);
    else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => (i - 1 + options.length) % options.length);
    else if (e.key === "Enter") pick(index);
    else return;
    e.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width="w-[360px]" onKeyDown={onKeyDown}>
      <div>
        <div className="flex h-10 items-center gap-2 border-b border-line-subtle px-3">
          {context && <ContextChip>{context}</ContextChip>}
          <span className="text-fg-tertiary">{title}</span>
        </div>
        <div className="p-1.5">
          {options.map((option, i) => (
            <button
              key={String(option.value)}
              type="button"
              // Not focusable: the highlight follows `index`, and keys go to the dialog.
              tabIndex={-1}
              onMouseMove={() => setIndex(i)}
              onClick={() => pick(i)}
              className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${
                i === index ? "bg-surface-hover text-fg" : "text-fg-secondary"
              }`}
            >
              {option.icon}
              <span className="flex-1">{option.label}</span>
              {option.value === current && <span className="text-[11px] text-fg-tertiary">Current</span>}
              {i < 9 && <Kbd>{i + 1}</Kbd>}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
