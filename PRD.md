# PRD — Jottr

_Last updated: 2026-10-08 · Status: Spec complete (v1)_

## 1. Overview

**Jottr** is a lightweight, fast Kanban app for macOS for planning projects and work, and secondarily life. Think Linear without the bloat: clean, minimal, snappy.

**Name:** a play on "jotter". In many African countries, "jotter" is the everyday word for a notepad or notebook.

**Principles**
- **Lightweight over feature-rich.** Every feature must earn its place.
- **Fast and snappy.** Instant interactions, native performance.
- **Clean and minimal UI.** Modern and uncluttered (see §6).

## 2. Platform & Tech

- **Platform:** macOS only (v1)
- **Users:** Single user, personal use
- **Data:** Fully local. No account, no server, no network required.

### 2.1 Stack

| Layer | Choice |
|---|---|
| App shell | Tauri 2 |
| Core logic | Rust: data, search, repeating tickets, notifications, auto-archive |
| Database | SQLite via `rusqlite`, FTS5 for full-text search |
| Rust ↔ UI types | `tauri-specta` (generates TypeScript bindings from Rust) |
| UI | React + TypeScript + Vite |
| Styling | Tailwind CSS |
| Components | Radix UI primitives (unstyled) |
| Command menu | `cmdk` |
| Drag & drop | `dnd-kit` |
| Rich text | TipTap |
| UI data layer | TanStack Query (optimistic updates) |
| Long lists | TanStack Virtual |
| Tauri plugins | global-shortcut, notification, fs/dialog, autostart |

### 2.2 Performance Targets

Lightweight, snappy and fast is the #1 product requirement.

| Metric | Target |
|---|---|
| App download size | < 15 MB |
| Cold launch to usable | < 1 s |
| Quick capture window appears | < 100 ms |
| UI interactions (status change, open ticket, etc.) | < 50 ms, feels instant |
| Drag & drop | Smooth at display refresh rate (60–120 fps) |
| Search results | < 50 ms per keystroke with 10,000+ tickets |
| Idle memory | < 100 MB |

### 2.3 Performance Rules

- **Local only:** no network calls in any core flow.
- **Optimistic UI:** update the screen first, then save in the background.
- **Pre-warmed quick capture:** the capture window is created hidden at launch and shown instantly.
- **Lazy-load heavy parts:** e.g. load the rich text editor only when a ticket is opened.
- **Virtualize long lists** so boards and lists stay smooth with thousands of tickets.
- **Heavy work runs in Rust,** off the UI thread (search, repeating tickets, auto-archive).
- **Minimal dependencies:** every new library must justify its weight.

### 2.4 Build & Release

**Prerequisites:** Xcode Command Line Tools, Node.js, Rust (via `rustup`).

| Step | Command | Result |
|---|---|---|
| Develop | `npm run tauri dev` | Opens Jottr in a native window. UI changes reload instantly; Rust changes recompile and restart the app. |
| Build | `npm run tauri build` | `Jottr.app` and a `.dmg` installer |

**Distribution, in phases:**

| Phase | Audience | How | Needs |
|---|---|---|---|
| **v1 (now)** | Just me | Build locally, drag `Jottr.app` into Applications | Nothing |
| Later (optional) | Others | Signed and notarized `.dmg` published on GitHub Releases | Apple Developer account ($99 a year) |
| Later (optional) | Everyone | Auto-updates via the Tauri updater. A GitHub Action builds, signs and publishes a release whenever a version tag is pushed. | Updater signing key (separate from Apple's) |

**Not planned:** Mac App Store. Its sandbox rules make system-wide features like quick capture harder.

## 3. Core Concepts

```
Board  (e.g. Engineering, Marketing, Life)
 └── Project  (e.g. "Auth rewrite", "Q4 launch", "Move apartments")
      └── Ticket
```

### 3.1 Boards
- Top-level containers for an area of work or life, e.g. **Engineering**, **Marketing**, **Life**.
- A user can have multiple boards.
- Each board holds many projects and tickets.
- Each board has a name, a short key used in ticket IDs (e.g. `ENG`), and a colour from a small fixed set.

### 3.2 Projects
- A grouping of related tickets within a board.
- A board can have many projects.
- A ticket belongs to at most one project, on its own board. Moving a ticket to another board removes it from its project unless a project on the new board is chosen.

### 3.3 Tickets
- The unit of work. Tickets move through statuses on the board.
- Standard fields:
  - **ID**: board-prefixed key (e.g. `ENG-42`). Numbers count up per board. A ticket that moves to another board gets that board's next number.
  - **Title**
  - **Description**: stored as markdown, edited as rich text with markdown shortcuts
  - **Status**
  - **Priority**: None, Low, Medium, High, Urgent
  - **Labels**: shared by every board. Each has a name (unique, ignoring case) and a colour from the swatch set.
  - **Due date**
  - **Project**

### 3.4 Inbox
- A single, global holding area for tickets that aren't on a board yet.
- Quick-captured tickets land here (see §5.2).
- Tickets are triaged from the Inbox by moving them to a board (and optionally a project).
- Inbox tickets have no ID until they're moved to a board.

### 3.5 Statuses
Standard, fixed workflow shared by all boards:

`Backlog → Ready → In Progress → In Review → Done` (+ `Canceled`)

## 4. Views

Standard views:
- **Board view**: Kanban columns by status, drag and drop tickets between columns
- **List view**: Compact rows grouped by status

## 5. Features

### 5.1 Command menu & keyboard shortcuts
- **⌘K** opens a command menu for creating tickets, changing status or priority, jumping to boards and projects, and more.
- Every action has a keyboard shortcut. The app is fully usable without a mouse. See §6.4 for the keyboard and mouse rules.

### 5.2 Quick capture
- A system-wide hotkey opens a small floating input from anywhere on macOS, without switching apps.
- Type a ticket title and press Enter to add it to the **top of the Inbox** (see §3.4).

### 5.3 Search
- Instant search across all boards, projects and tickets (titles and descriptions).

### 5.4 My Focus view
- A single view across **all boards** showing tickets that are in progress, due soon or overdue.

### 5.5 Checklists
- Simple checkbox lists inside a ticket for small steps. Lighter weight than sub-tickets.

### 5.6 Repeating tickets
- Tickets can repeat on a schedule (daily, weekly, monthly, yearly), e.g. "Pay rent" monthly.
- Two repeat modes, chosen per ticket:
  - **On a fixed schedule** (default): the next ticket appears on the set date whether or not the last one is done, e.g. "Pay rent" on the 1st of each month.
  - **After completion**: the next ticket appears a set time after the last one is marked Done, e.g. "Gym" 2 days after the last session.
- Mainly for the Life board, but available on any board.

### 5.7 Due date notifications
- Native macOS notifications when a ticket is due or overdue.

### 5.8 Auto-archive
- Done tickets are automatically archived after a set number of days to keep boards clean.
- **Can be turned on or off** in settings. One global setting for all boards.
- Default delay: **7 days** (configurable).
- Archived tickets remain searchable and can be restored.

### 5.9 Export & backup
- One-click export or backup of all data to a file.

### 5.10 Attachments
- Attach files and images to tickets.

### 5.12 Labels
- `L` opens the label picker: type to filter, `Enter` adds or removes the highlighted label, and it stays open for more. Typing a new name offers to create it, using the first colour not yet taken.
- Right-click a label in the picker to change its colour, rename it, or delete it. Deleting removes it from every ticket, after a confirmation.
- The right-click menu on a ticket has a Labels submenu that stays open while you tick several.

### 5.11 Multi-select & bulk edit
- Select multiple tickets in the list or board (`X` to select, `⌘A` to select all).
- Change status, priority, labels, project or due date for all selected tickets at once, using the same shortcuts as for a single ticket.

## 6. UI & Design Principles

Design references are saved in `references/` and kept out of git. We are adopting their **principles, not their visuals**.
- [Notch case study](https://dribbble.com/shots/27629772-Notch-Issue-Tracker): the main reference for the design system, keyboard rules and list rows
- [Blitzit for macOS](https://dribbble.com/shots/27770145-Blitzit-Project-Management-for-macOS-Kanban-Board-Task-Lists): board columns and cards
- [Personal task dashboard](https://dribbble.com/shots/27637209-Personal-Task-Workflow-Organization-Tablet-Dashboard-Design): list grouping and the sidebar

### 6.1 Theme & colour
- **Dark mode first.** Light mode can come later as a token swap.
- **Every colour is a named token.** No raw hex values in components. Token groups:
  - **Surface:** base, elevated, hover
  - **Border:** subtle, base, strong
  - **Text:** primary, secondary, tertiary, quaternary
  - **Accent:** base, hover, deep
  - **Status:** one per status, plus urgent and error
- **The colour rule: the accent means "you".** It is used only for things the user did or is doing: the selected ticket, the focus ring, the primary button, progress fills and the Done status. Status and priority colours describe the ticket and never use the accent.
- **Accent: Monochrome.** The accent is near-white, so the only hues in the app are the ones that describe tickets (status, priority, labels, board colours).

#### Dark theme tokens

| Token | Value |
|---|---|
| `bg/base` | `#0C0C0E` |
| `bg/elevated` | `#121215` |
| `bg/hover` | `#18181C` |
| `border/subtle` | `#1C1C21` |
| `border/base` | `#26262C` |
| `border/strong` | `#33333A` |
| `text/primary` | `#EDEDEF` |
| `text/secondary` | `#A0A0A8` |
| `text/tertiary` | `#6E6E77` |
| `text/quaternary` | `#4A4A52` |
| `accent/base` | `#EDEDEF` |
| `accent/hover` | `#FFFFFF` |
| `accent/deep` | `rgba(255,255,255,0.07)` (multi-select tint) |
| `accent/on` | `#0C0C0E` (text and icons on the accent) |
| `status/progress` | `#EDB543` (amber) |
| `status/review` | `#4FA0F2` (blue) |
| `status/urgent` | `#F2924A` (orange) |
| `status/error` | `#EB5757` (red, also used for overdue dates) |

Backlog, Ready and Canceled use the neutral text greys. Done uses the accent.

### 6.2 Typography
- **One typeface: Inter**, in three weights: Regular for content, Medium for interactive elements, Semibold for headings and numbers. No Bold.
- **Monospace: SF Mono**, using the system `ui-monospace` font. It's used for ticket IDs and small metadata. It's built into macOS, so there's nothing to bundle and it looks native.
- UI text stays at 15px or smaller. The ticket title on the ticket page is the only large text in the app.

### 6.3 Status & priority icons
**Shape carries the meaning; colour only reinforces it.** With all colour removed, everything is still readable.

| Status | Icon |
|---|---|
| Backlog | Dashed circle |
| Ready | Empty circle |
| In Progress | Half-filled circle |
| In Review | Three-quarter-filled circle |
| Done | Filled circle with a tick (accent colour) |
| Canceled | Filled circle with an × (muted) |

| Priority | Icon |
|---|---|
| None | Dashes |
| Low / Medium / High | Signal bars: 1 / 2 / 3 filled |
| Urgent | Filled square with `!` |

### 6.4 Keyboard & mouse rules
- **Everything works with the mouse too.** The keyboard is faster, but never required.
  - Click a row's status or priority icon to open that picker.
  - Right-click a ticket for a menu with Status, Priority and Move to. It shows each option's icon, a tick on the current value, and the shortcut key.
  - Hover tooltips name the shortcut (e.g. "Change status · S"), so mouse users learn the keys over time.
- **Every mouse action has a shortcut.** ⌘K is the fallback, not the main path. It shows each command's shortcut so the user learns them.
- **Single letters act on the selection** (one ticket or many), e.g. `S` status, `P` priority.
- **`G` is a prefix for navigation only.** Pressing `G` alone does nothing; it waits for the next key.
- **⌘ combinations act on the app, not the content,** e.g. command menu, sidebar, settings.
- **Pickers are numbered:** in any picker, `1`–`9` chooses an option (e.g. `S` then `3` = In Progress).
- **Single-letter shortcuts are off while typing** in a text field.

#### Key map

**Global**

| Keys | Action |
|---|---|
| `⌘K` | Command menu |
| `/` | Search |
| `C` | Create ticket |
| `⌥Space` | Quick capture, system-wide (configurable) |
| `⌘B` | Toggle list / board view |
| `⌘\` | Toggle sidebar |
| `⌘,` | Settings |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘[` / `⌘]` | Back / forward |
| `?` | Show all shortcuts |

**Go to** (`G` then…)

| Keys | Action |
|---|---|
| `G` `I` | Inbox |
| `G` `F` | My Focus |
| `G` `B` | Switch board (opens the board picker) |
| `G` `P` | Projects in the current board |
| `G` `A` | Archive |

**On the selected ticket(s)**

| Keys | Action |
|---|---|
| `S` | Status |
| `P` | Priority |
| `L` | Labels |
| `D` | Due date |
| `M` | Move to board / project |
| `R` | Repeat |
| `⌘⇧C` | Copy ticket ID |
| `⌘⌫` | Delete (undoable) |

**In a list or board**

| Keys | Action |
|---|---|
| `J` / `K` (or `↓` / `↑`) | Next / previous ticket |
| `←` / `→` | Previous / next column (board) |
| `Enter` | Open ticket |
| `X` | Select / deselect |
| `⇧J` / `⇧K` (or `⇧↓` / `⇧↑`) | Extend selection |
| `⌘A` | Select all |
| `[` / `]` | Move selected ticket(s) to the previous / next status |
| `F` | Filter |
| `Esc` | Clear selection |

**On the ticket page**

| Keys | Action |
|---|---|
| `Esc` | Back to the list |
| `J` / `K` | Next / previous ticket |
| `⌘Enter` | Finish editing |

### 6.5 List rows
- **Row height: 40px.** Clicking anywhere on a row opens the ticket.
- Grouped by status by default. Each group header shows the status icon, name and count, plus a **"+"** on hover that creates a ticket in that status.
- **Fixed layout on every row:** status, priority and ID on the left, then the title, then fixed slots on the right in the same order on every row: labels, checklist progress, project, due date. Empty slots take no space.
- **Checklist progress:** a small progress ring plus a count (e.g. `2/5`). Only shown if the ticket has a checklist.
- **Done and Canceled tickets** have dimmed titles, so finished work recedes.
- **Row states:**
  - **Default:** base surface, one hairline below
  - **Hover:** background change only. No border change, so text never shifts.
  - **Selected:** a 2px accent bar drawn inside the row, so nothing reflows
  - **Keyboard focus:** a 1.5px inset accent ring. Keyboard only, never shown on mouse click.
  - **Multi-selected:** accent tint, plus a checkbox that only appears once more than one row is selected

### 6.6 Board view
- Columns are the statuses, in workflow order. They stretch between 240px and 320px to fill the window, and the board scrolls sideways if needed.
- Each board remembers whether it shows the list or the board (`⌘B`, or the List/Board toggle in the header). New boards open as a board. The Inbox is always a list.
- Tickets move by drag and drop **or** by keyboard. Dragging works within a column (reorder) and across columns (status change). On the keyboard, `[` / `]` move the selected ticket to the previous/next status, and `J`/`K` and `←`/`→` move the selection.
- **Column header:** status icon, name, ticket count, a **"+"** that creates a ticket in that status, and a collapse button.
- **Collapsible columns:** any column can collapse to a thin vertical strip showing its icon, its name (written sideways) and its count. Click the strip to expand it. Collapsed columns are remembered per board. Canceled starts collapsed.
- **Done column grouped by day:** Done tickets are grouped by the day they were completed, newest first ("Today", "Yesterday", "Sun, 27 Sept"), each with a count.

**Cards**
- Elevated surface, subtle border, rounded corners.
- **Title:** up to 2 lines, then truncated.
- **Meta row** below the title: priority, ID, labels, checklist progress, with the due date right-aligned. Empty slots take no space.
- **Project:** shown in small text above the title. Hidden inside a project view, where every card would show the same one.
- Card states match the list row states (§6.5): hover, selected, keyboard focus, multi-selected.
- Done and Canceled cards have dimmed titles.

### 6.7 Sidebar
- **Top:** Inbox (with a count of untriaged tickets) and My Focus.
- **Boards:** each board is shown with its colour dot. Expand a board to see its projects. Expanded state is remembered.
- Clicking a board shows all its tickets; clicking a project shows only that project's tickets.
- Hover a board for **+** to add a project. Right-click a project to rename or delete it. Deleting keeps its tickets on the board, without a project.
- Toggle with `⌘\`.

### 6.8 Ticket page
- **The title is the largest element on the page.** No label above it, no extra chrome.
- Main column: description, checklist, attachments.
- The description saves automatically after a short pause in typing, and when leaving the ticket.
- Checklist: click an item to edit it; clearing its text removes it. Enter in "Add an item…" adds and stays ready for the next.
- The header shows the ticket's position in the list (e.g. `3 / 12`) with previous/next buttons (`K` / `J`).
- Right column: properties (status, priority, labels, project, due date, repeat). The label is on the left and the value is right-aligned, so empty values are easy to spot.

### 6.9 Motion
- **Only one animated element:** the drop target on the board. Everything else changes instantly.
- Respects the macOS Reduce Motion setting.

### 6.10 Screen states
Every view has a designed version of each state:
- **Empty:** nothing here yet, with a hint (e.g. "Press C to create a ticket")
- **Filtered empty:** nothing matches, with a "Clear filters" action
- **Loading:** a skeleton. This should rarely be seen, since everything is local.
- **Error:** what went wrong, plus a retry

### 6.11 Accessibility
- Status is shown by shape, not just colour.
- The focus ring is always visible for keyboard users.
- Important text meets a 4.5:1 contrast ratio.

## 7. Out of Scope (v1)

- Non-macOS platforms
- Multi-user / collaboration
- Life-planning-specific features (secondary; revisit later)
- Sprints / cycles
- Time tracking
- Sub-tickets
- Ticket dependencies (blocked by / blocking)
- Templates
- Analytics / reports
- Assignees, teams, comments
- Light mode (planned later as a token swap; see §6.1)
- Mac App Store distribution (see §2.4)
- Code signing, notarization and auto-updates (later, if shared; see §2.4)

## 8. Open Questions

_None currently._
