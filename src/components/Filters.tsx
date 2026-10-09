import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { Label, Priority, Project } from "../bindings";
import { useLabels } from "../lib/queries";
import { NO_PROJECT, PRIORITIES, SWATCH_BG, filterCount, type Filters } from "../lib/tickets";
import { CheckIcon, PriorityIcon, ProjectIcon } from "./icons";
import { Dialog, Kbd } from "./ui";

type Option = {
  key: string;
  section: "Priority" | "Labels" | "Project";
  label: string;
  icon: ReactNode;
  active: boolean;
  toggle: (f: Filters) => Filters;
};

const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function options(filters: Filters, labels: Label[], projects: Project[] | null): Option[] {
  const out: Option[] = PRIORITIES.map((p) => ({
    key: `p:${p.value}`,
    section: "Priority",
    label: p.label,
    icon: <PriorityIcon priority={p.value} />,
    active: filters.priorities.includes(p.value),
    toggle: (f) => ({ ...f, priorities: toggleIn<Priority>(f.priorities, p.value) }),
  }));
  for (const l of labels) {
    out.push({
      key: `l:${l.id}`,
      section: "Labels",
      label: l.name,
      icon: <span className={`size-2 rounded-full ${SWATCH_BG[l.color]}`} />,
      active: filters.labelIds.includes(l.id),
      toggle: (f) => ({ ...f, labelIds: toggleIn(f.labelIds, l.id) }),
    });
  }
  if (projects) {
    for (const p of [...projects, { id: NO_PROJECT, name: "No project" } as Project]) {
      out.push({
        key: `r:${p.id}`,
        section: "Project",
        label: p.name,
        icon: p.id === NO_PROJECT ? <span className="size-3" /> : <ProjectIcon />,
        active: filters.projectIds.includes(p.id),
        toggle: (f) => ({ ...f, projectIds: toggleIn(f.projectIds, p.id) }),
      });
    }
  }
  return out;
}

/**
 * `F`: narrow the current view by priority, label or project. Type to find an option,
 * Enter toggles it, and the menu stays open for more.
 */
export function FilterMenu({
  open,
  onOpenChange,
  filters,
  onChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Projects to offer, or `null` where filtering by project doesn't apply. */
  projects: Project[] | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Filter" width="w-[360px]">
      {open && <Body filters={filters} onChange={onChange} projects={projects} />}
    </Dialog>
  );
}

function Body({
  filters,
  onChange,
  projects,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  projects: Project[] | null;
}) {
  const labels = useLabels().data ?? [];
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const rows = options(filters, labels, projects).filter((o) => o.label.toLowerCase().includes(q));
  const highlighted = Math.min(index, rows.length - 1);

  useEffect(() => {
    list.current?.querySelector(`[data-row="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") setIndex(Math.min(rows.length - 1, highlighted + 1));
    else if (e.key === "ArrowUp") setIndex(Math.max(0, highlighted - 1));
    else if (e.key === "Enter" && rows[highlighted]) onChange(rows[highlighted].toggle(filters));
    else return;
    e.preventDefault();
  }

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex h-10 items-center gap-2 border-b border-line-subtle px-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          placeholder="Filter by…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-quaternary"
        />
      </div>
      <div ref={list} className="max-h-80 overflow-y-auto p-1.5">
        {rows.length === 0 && <p className="px-2.5 py-1.5 text-fg-tertiary">No matching options</p>}
        {rows.map((o, i) => (
          <div key={o.key}>
            {o.section !== rows[i - 1]?.section && (
              <div className="px-2.5 pt-2 pb-1 font-mono text-[10px] tracking-wider text-fg-quaternary uppercase">
                {o.section}
              </div>
            )}
            <button
              type="button"
              tabIndex={-1}
              data-row={i}
              onMouseMove={() => setIndex(i)}
              onClick={() => onChange(o.toggle(filters))}
              className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${
                i === highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary"
              }`}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-fg-tertiary">{o.icon}</span>
              <span className="flex-1 truncate">{o.label}</span>
              {o.active && <CheckIcon />}
            </button>
          </div>
        ))}
      </div>
      <div className="flex h-9 items-center justify-between border-t border-line-subtle px-3 text-[12px] text-fg-tertiary">
        <button
          type="button"
          disabled={filterCount(filters) === 0}
          onClick={() => onChange({ priorities: [], labelIds: [], projectIds: [] })}
          className="rounded px-1 hover:text-fg disabled:text-fg-quaternary"
        >
          Clear all
        </button>
        <span className="flex items-center gap-1.5">
          Toggle <Kbd>↵</Kbd> Done <Kbd>Esc</Kbd>
        </span>
      </div>
    </div>
  );
}

/** Active filters under the header, each removable, plus Clear. */
export function FilterBar({
  filters,
  onChange,
  onEdit,
  projects,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onEdit: () => void;
  projects: Project[];
}) {
  const labels = useLabels().data ?? [];
  if (filterCount(filters) === 0) return null;

  const chips = options(filters, labels, projects).filter((o) => o.active);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line-subtle px-4">
      <button
        type="button"
        title="Edit filters · F"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onEdit}
        className="mr-1 text-[12px] text-fg-tertiary hover:text-fg"
      >
        Filtered by
      </button>
      {chips.map((o) => (
        <span
          key={o.key}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-line pr-1 pl-2 text-[12px] text-fg-secondary"
        >
          <span className="flex size-3.5 items-center justify-center text-fg-tertiary">{o.icon}</span>
          {o.label}
          <button
            type="button"
            aria-label={`Remove ${o.label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(o.toggle(filters))}
            className="flex size-4 items-center justify-center rounded text-fg-tertiary hover:bg-surface-hover hover:text-fg"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange({ priorities: [], labelIds: [], projectIds: [] })}
        className="ml-1 shrink-0 text-[12px] text-fg-tertiary hover:text-fg"
      >
        Clear
      </button>
    </div>
  );
}
