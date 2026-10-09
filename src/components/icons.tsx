import type { Priority, Status } from "../bindings";
import { SWATCH_BG, type MoveOption } from "../lib/tickets";

/** Shape carries the meaning; colour only reinforces it (PRD §6.3). */
export function StatusIcon({ status }: { status: Status }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", className: "shrink-0" };
  switch (status) {
    case "backlog":
      return (
        <svg {...common} className="shrink-0 text-fg-tertiary">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 2" />
        </svg>
      );
    case "ready":
      return (
        <svg {...common} className="shrink-0 text-fg-secondary">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common} className="shrink-0 text-status-progress">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3A4 4 0 0 0 7 11Z" fill="currentColor" />
        </svg>
      );
    case "in_review":
      return (
        <svg {...common} className="shrink-0 text-status-review">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7L7 3A4 4 0 1 1 3 7Z" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg {...common} className="shrink-0 text-accent">
          <circle cx="7" cy="7" r="6.75" fill="currentColor" />
          <path
            d="M4.2 7.2l1.9 1.9 3.7-3.9"
            fill="none"
            className="stroke-on-accent"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "canceled":
      return (
        <svg {...common} className="shrink-0 text-fg-tertiary">
          <circle cx="7" cy="7" r="6.75" fill="currentColor" />
          <path d="M5 5l4 4M9 5l-4 4" className="stroke-surface" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

const BARS: Record<Exclude<Priority, "none" | "urgent">, number> = { low: 1, medium: 2, high: 3 };

export function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === "none") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-fg-quaternary">
        <path d="M2 7h2M6 7h2M10 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (priority === "urgent") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-status-urgent">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 4v3.6" className="stroke-surface" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.9" className="fill-surface" />
      </svg>
    );
  }
  const filled = BARS[priority];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      {[
        [1.5, 8, 4],
        [5.75, 5, 7],
        [10, 2, 10],
      ].map(([x, y, h], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="2.5"
          height={h}
          rx="0.75"
          className={i < filled ? "fill-fg-secondary" : "fill-fg-quaternary"}
        />
      ))}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      <path
        d="M2.5 6.2l2.3 2.3 4.7-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      <path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronUpDownIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      <path
        d={direction === "up" ? "M2.5 7.5L6 4l3.5 3.5" : "M2.5 4.5L6 8l3.5-3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Projects: a small grid of four squares. */
export function ProjectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      {[
        [1.5, 1.5],
        [6.5, 1.5],
        [1.5, 6.5],
        [6.5, 6.5],
      ].map(([x, y]) => (
        <rect key={`${x}${y}`} x={x} y={y} width="4" height="4" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Icon for a move destination: a board's colour dot, or the project grid. */
export function DestinationIcon({ option }: { option: MoveOption }) {
  // A fixed box keeps labels aligned whichever icon (or none) a row has.
  return (
    <span className="flex size-3 shrink-0 items-center justify-center text-fg-tertiary">
      {option.kind === "board" && option.board && (
        <span className={`size-2 rounded-sm ${SWATCH_BG[option.board.color]}`} />
      )}
      {option.kind === "project" && <ProjectIcon />}
    </span>
  );
}
