# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jottr is a single-user, local-only Kanban app for macOS (Tauri 2 + Rust + React). It's open source at https://github.com/steojo/jottr.

**Features come from tickets in Jottr itself**, mostly the Open Source project on the Engineering board. When asked to build a ticket (e.g. `ENG-28`), read its title, description and checklist (the spec) straight from the local database, read-only:

```sh
sqlite3 -readonly ~/Library/Application\ Support/com.steojo.jottr/jottr.db \
  "SELECT t.title, t.description, (SELECT group_concat(c.text, ' | ') FROM checklist_items c WHERE c.ticket_id = t.id)
   FROM tickets t JOIN boards b ON b.id = t.board_id WHERE b.key = 'ENG' AND t.number = 28"
```

Never write to that database; the running app owns it.

## Product rules

- **Lightweight over feature-rich:** Linear without the bloat. Every feature and every dependency must earn its place.
- **Single user, macOS only, fully local:** no account, server or network calls. No Mac App Store, because its sandbox makes system-wide features like quick capture harder.
- **Structure:** Board (name, key like `ENG`, colour) → Project → Ticket, plus a global Inbox for tickets not on a board yet. Statuses are fixed for every board: Backlog → Ready → In Progress → In Review → Done, plus Canceled.
- **Performance targets:** interactions under 50ms with optimistic UI; search under 50ms per keystroke with 10,000+ tickets; drag and drop at display refresh rate; cold launch under 1s; idle memory under 100MB; download under 15MB; quick capture shown in under 100ms (create its window hidden at launch). Heavy work runs in Rust, long lists are virtualized, and heavy UI is lazy-loaded.

## Commands

```sh
npm install
npm run tauri dev     # run the app: Vite on fixed port 1420 with HMR; Rust changes recompile and relaunch
npm run tauri build   # release build → src-tauri/target/release/bundle/ (Jottr.app + .dmg)
npm run build         # tsc type-check + Vite build of the frontend only (fastest TS check)
cd src-tauri && cargo test     # Rust tests (also regenerates src/bindings.ts)
cd src-tauri && cargo test store::tests::numbers_tickets_per_board   # a single test
cd src-tauri && cargo clippy --all-targets
```

There are no frontend tests or JS linter yet. Rust is installed via rustup; if `cargo` isn't on PATH in a non-interactive shell, run `. "$HOME/.cargo/env"`.

## Architecture

Rust owns all data; the UI never touches the database directly.

- **Storage:** SQLite (`rusqlite`, bundled) at the app data dir (`~/Library/Application Support/com.steojo.jottr/jottr.db`).
  - Schema changes are new files in `src-tauri/migrations/`, registered in order in `MIGRATIONS` in `db.rs`. They're tracked with `PRAGMA user_version`. Never edit a migration that has shipped.
- **Rust layers (`src-tauri/src/`):**
  - `models.rs`: types shared with TypeScript. Enums are stored as snake_case text via the `text_enum!` macro.
  - `store.rs`: all data logic as plain functions over a `Connection`, plus the unit tests, which run against an in-memory DB.
  - `commands.rs`: thin `#[tauri::command]` wrappers that lock the shared `Mutex<Connection>`.
  - New commands must also be added to `collect_commands!` in `lib.rs`.
- **Type bridge:** `tauri-specta` writes `src/bindings.ts` on every debug launch and on `cargo test`. It's committed, so never edit it by hand.
  - Commands use `ErrorHandlingMode::Throw`: Rust `Err(String)` becomes a rejected promise.
  - Avoid `i64`/`usize` in exported types, because specta refuses them. Use `i32` or `f64`. `f64` exports as `number | null`.
- **Ticket rules (`store.rs`):**
  - Inbox tickets have `board_id = NULL` and no number.
  - Numbers are per board, from `boards.next_ticket_number`, and are reassigned when a ticket moves boards.
  - New tickets go to the bottom of their status group (`MAX(position) + 1`). Status changes, moves and restores go to the top (`MIN(position) - 1`).
  - Urgent tickets are pinned first in their status group until finished (`isPinned`/`byListOrder` in `src/lib/tickets.ts`; Board drops are placed by `dropPosition`). Changing to or from Urgent moves the ticket to the top of its group in `update_ticket`.
  - Setting `done` stamps `completed_at`.
- **UI data (`src/lib/queries.ts`):** TanStack Query, with `staleTime: Infinity` since all data is local. Mutations update the cache optimistically and roll back on error. `applyPatch` in `src/lib/tickets.ts` mirrors `update_ticket` and must stay in sync with it.
- **Labels** are global (not per board). `Ticket.labelIds` comes from a `GROUP_CONCAT` subquery in `Ticket::COLUMNS`, and the UI resolves names and colours from `useLabels()`. `set_ticket_label` adds or removes one label at a time.
- **Projects** are a filter over a board's tickets: a project view (`View.projectId`) shows the board's cached tickets filtered by `projectId`. `move_ticket` sets board and project together and rejects a project from another board. `moveDestinations` in `src/lib/tickets.ts` builds the destination list for both the `M` picker and the right-click menu.
- **Views:** `App.tsx` owns the current scope (Inbox, My Focus, a board, or a project), the active filters (`applyFilters`; reset on navigation), the selected ticket (`activeId`) and the open ticket (`openId`). With a ticket open, `TicketPage` replaces `TicketList`, and both share `TicketPickers` for the S/P/D/L/M pickers. `groupTickets` in `src/lib/tickets.ts` defines the list order that J/K follow.
- **Board view (`Board.tsx`):** dnd-kit (`@dnd-kit/core` + `sortable`).
  - While dragging, columns are rearranged in local state so the drop target follows the pointer. `collisionDetection` hit-tests with the pointer (column, then card), since corner distance made empty columns unreachable. After a drop the dragged layout is held until the cache updates, so the card never flashes back. On drop, `positionBetween` picks a fractional position from the neighbours, and `reposition_ticket` saves status and position together.
  - Cards move without transitions; the dashed drop target (`animate-drop-target`) is the app's only animation.
  - The Done column is ordered by `completedAt` and grouped by day (`groupByCompletionDay`). Cards dropped there go to the top, and it can't be reordered (`noSorting`).
  - The Backlog and Canceled columns can be hidden in Settings (`showBacklog`, `showCanceled`). With Backlog hidden, `C` on a board creates tickets in Ready.
  - Per-board UI preferences (layout, collapsed columns) live in localStorage via `usePersistentState`, not SQLite.
- **Ticket page:** the description editor (`DescriptionEditor.tsx`, TipTap + `@tiptap/markdown`) is lazy-loaded, since it's the heaviest dependency. Descriptions are stored as markdown. The page content is keyed by ticket ID so J/K remounts the editors, which flushes pending saves.
- **Archive:** `tickets.archived_at` marks archived tickets; every list except search and `list_archived` skips them. `auto_archive` (driven by the one-row `settings` table) runs at launch in `lib.rs`, hourly via `useAutoArchive`, and after `update_settings`. `restore_ticket` or any status change brings a ticket back. `storeCachedTicket` in `queries.ts` adds restored or moved tickets to their board's cache and keeps archived ones out.
- **Attachments:** files are copied to `attachments/<ticket id>/<attachment id>/<name>` in the app data dir. Store functions take that folder (the `AttachmentsDir` state). The UI shows images through the asset protocol (`convertFileSrc`, scoped in `tauri.conf.json`), opens files with macOS `open`, and picks them with `tauri-plugin-dialog`. Pasted files reach Rust as base64.
- **Search and My Focus** span every board, so a `MutationCache` hook in `queries.ts` refetches them after any change. Search uses the `tickets_fts` FTS5 table, kept in step by triggers (migration 0004).
- **Command menu (`CommandMenu.tsx`):** commands are built in `App.tsx`. Ticket actions call `runShortcut("s")` and so on, so they behave exactly like the keys.
- **Keyboard (`src/lib/shortcuts.ts`):** one global `keydown` listener with a registry of `useShortcuts` maps. The most recently mounted map wins, so views override global keys. It handles the `g x` prefix sequences.
  - Shortcuts are ignored while typing or while any `[role=dialog]` or `[role=menu]` is open. Dialogs and menus handle their own keys; see `Picker.tsx` for the numbered-option pattern.
  - Buttons call `preventDefault` on `mousedown`, and dialogs skip focus return, so focus stays on the body and Enter/Space can't re-trigger a button.
- **Window:** set in `src-tauri/tauri.conf.json`. It uses an overlay title bar with a hidden title and custom traffic light position. The top 52px strips of the sidebar and main area are `data-tauri-drag-region` elements, which both drag the window and clear the traffic lights. Dragging relies on `core:window:allow-start-dragging`.
- **Permissions:** any new Tauri plugin or window/API call needs its permission added to `src-tauri/capabilities/default.json`.

## Styling & design rules

- **Tailwind v4 via `@tailwindcss/vite`.** There's no `tailwind.config`. All design tokens live in the `@theme` block of `src/index.css`, in these groups:
  - `bg/*` → `surface*` (e.g. `bg-surface-elevated`)
  - `border/*` → `line*` (e.g. `border-line-subtle`)
  - `text/*` → `fg*` (e.g. `text-fg-tertiary`)
  - `accent/*` → `accent*`, plus `on-accent`
  - `status/*` → `status-*`
  
  These names avoid clashing with Tailwind's built-ins (e.g. `text-base`). Never use raw hex values in components.
- **The accent is monochrome (near-white)** and is used only for: the selected item, the focus ring, the primary button, progress fills and the Done status. Status and priority colours describe tickets and never use the accent. Status icons carry meaning by shape, so they still read without colour.
- **Fonts:** Inter is bundled via `@fontsource-variable/inter` (imported in `src/main.tsx`), in Regular, Medium (interactive elements) and Semibold (headings, numbers), never Bold. `font-mono` is the system SF Mono, for ticket IDs and small metadata. Nothing may load from the network: the app must work fully offline.
- **Keyboard and mouse:** every mouse action needs a shortcut, and every action must also work with the mouse (clickable control, right-click menu in `TicketMenu.tsx`, or both). Single letters act on the selection, `G` is a navigation prefix, and `⌘` is for app-level actions. Single-letter shortcuts are off while typing in a text field. Pickers are numbered (`1`–`9`), and tooltips and ⌘K show each action's key (e.g. "Change status · S"). The key map is `ShortcutSheet.tsx`; keep it in step. Reserved for planned features: `R` repeat, `⌥Space` quick capture (configurable), and `X` / `⇧J` / `⇧K` / `⌘A` multi-select.
- **States:** hover changes the background only, so nothing shifts. The selected row or card gets a 2px inset accent bar; keyboard focus adds a 1.5px inset accent ring, never shown after a click. Finished titles are dimmed. Every view has empty, filtered-empty (with Clear filters) and error states. Important text meets 4.5:1 contrast.
- **Size and motion:** UI text is 15px or smaller (the ticket page title is the only exception). The board drop target is the only animated element, and it respects Reduce Motion.

## Repo notes

- `references/` holds third-party Dribbble designs used for inspiration. It's gitignored because the repo is public and those images aren't ours to publish. `design/` holds our own design explorations.

## Working efficiently

The owner's usage limits are tight, so keep context small:
- Use one chat per feature. This file, the ticket and the code carry the context, so don't re-read files you don't need.
- Verify with `npm run build` and `cd src-tauri && cargo test` first. For UI checks, prefer reading text from the page over screenshots. Take a screenshot only when the look of something changed, at 1x scale.
- Batch checks into as few tool calls as possible, and edit with targeted edits rather than rewriting whole files.
