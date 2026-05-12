# US-524: LogView editor — UIKit migration

## Status

**Placeholder** — Phase 4 per-screen migration under [EPIC-025](../../epics/EPIC-025.md).
Plan to be authored before implementation.

## Goal

Migrate the LogView editor and all its embedded dialog/output items to
UIKit primitives. After this task, no file under
`src/renderer/editors/log-view/` imports from
`components/basic|form|layout|overlay/`.

LogView is the runtime UI surface for scripts: scripts emit log
entries, dialogs, output panels, and progress indicators that all
render through these item views. Migrating it standardises the script
runtime UI on UIKit.

## Background

### Files in scope

Confirmed via grep for legacy imports under `editors/log-view/`:

**Top-level views:**

- `LogViewEditor.tsx` — host editor; uses legacy `Button`.
- `LogEntryWrapper.tsx` — per-entry frame; verify imports.
- `LogEntryContent.tsx` — entry body dispatcher; verify imports.
- `LogMessageView.tsx` — text message renderer; verify imports.
- `StyledTextView.tsx` — styled-text renderer; verify imports.

**Item views (`items/`):**

- `ButtonsDialogView.tsx` — multi-button dialog; verify imports.
- `ButtonsPanel.tsx` — uses legacy `Button`.
- `CheckboxesDialogView.tsx` — uses legacy `Checkbox`.
- `ConfirmDialogView.tsx` — confirm dialog; verify imports.
- `DialogContainer.tsx` — dialog frame; verify imports.
- `DialogHeader.tsx` — dialog header; verify imports.
- `GridOutputView.tsx` — uses legacy `Button`; embedded grid.
- `MarkdownOutputView.tsx` — uses legacy `Button`.
- `McpRequestView.tsx` — MCP request snapshot; verify imports.
- `MermaidOutputView.tsx` — uses legacy `Button`.
- `ProgressOutputView.tsx` — uses legacy `CircularProgress`.
- `RadioboxesDialogView.tsx` — uses legacy `Radio`.
- `SelectDialogView.tsx` — uses legacy `ComboSelect`.
- `TextInputDialogView.tsx` — uses legacy `TextField`.
- `TextOutputView.tsx` — uses legacy `Button`.

### Reference migrations

- **US-432 Dialog component** — Confirm/Input/Password dialogs landed
  the dialog-shell pattern. The `items/*DialogView.tsx` files render
  inline within the log stream (not as modal Dialogs), so this is a
  pattern reference, not a direct reuse.
- **US-502 MCP Inspector** — closest analogue for script-runtime UI
  with mixed input forms + result panels. Especially relevant for
  `McpRequestView`, `ToolResultView` look-and-feel parity.
- **US-477 Progress dialog** — landed UIKit `Progress` primitive used
  for modal progress; `ProgressOutputView` will reuse the same
  primitive inline.

### UIKit primitive availability

All primitives needed are landed:

- `Button`, `IconButton`, `Checkbox`, `RadioGroup`, `Select`,
  `Input`, `Textarea` — Phase 4 baseline.
- `Progress` — US-477.
- `Notification` / `Notification` items — US-476.
- `Panel`, `Text` — Phase 4 baseline.
- `Dialog` — US-432 (for items that should escalate to modals; most
  log-stream dialogs are inline).
- `name?: string` debug prop on every primitive — US-521.

### Risk surface

The log-view is the runtime UI for **all** scripts. A regression here
breaks every script's interactive dialogs and output rendering.
Migration must keep the existing prop-shapes of every item view
(invoked by `LogEntryContent.tsx` via a dispatch table) **byte-for-byte
identical** — only the JSX implementation changes.

## Implementation plan

*To be authored.* High-level outline:

1. **Audit each item view's public props** — `LogEntryContent.tsx`
   dispatches based on `LogItem.type`; produce a contract list so each
   item view's prop shape is locked before the rewrite.
2. **Migrate the host editor** — `LogViewEditor.tsx`, `LogEntryWrapper`,
   `LogEntryContent`, `LogMessageView`, `StyledTextView` chrome.
3. **Migrate dialog item views** — `ConfirmDialogView`,
   `ButtonsDialogView`, `CheckboxesDialogView`, `RadioboxesDialogView`,
   `SelectDialogView`, `TextInputDialogView`. Each uses UIKit
   `Checkbox` / `RadioGroup` / `Select` / `Input` for its central
   control plus `Button`s for action row.
4. **Migrate output item views** — `TextOutputView`,
   `MarkdownOutputView`, `MermaidOutputView`, `GridOutputView`,
   `ProgressOutputView`, `McpRequestView`, `ButtonsPanel`.
5. **Migrate `DialogContainer` + `DialogHeader`** chrome.
6. Adopt `name?` debug attribute on every primitive per US-521
   convention. Static script-author-facing names (e.g.
   `log-confirm-yes`, `log-progress-bar`, `log-input-ok`).
7. Baseline-relative `tsc` + `lint` pass; full script-runtime smoke.

## Concerns / Open questions

*Authored placeholder — to be expanded.*

- **Script API surface.** Scripts call into log-view via the `page` /
  `log` API. Confirm no item view's external prop names change during
  migration — those are part of the script API contract.
- **GridOutputView embeds an `AVGrid`** which is its own large
  component (`components/data-grid/`). The grid is out of scope for
  UIKit migration; only the surrounding chrome migrates.
- **`McpRequestView`** embeds collapsible JSON / result panels —
  reuse `CollapsiblePanelStack` (US-517) or roll a simpler folder
  affordance? Decide during planning.
- **Dialog focus management.** Inline dialogs in the log stream are
  not modals — focus / keyboard-trap semantics differ from
  `uikit/Dialog`. Decide whether dialog items should use UIKit
  `Dialog` host or render as plain `Panel`s with their own focus
  handling.

## Acceptance criteria

- No imports from `components/basic|form|layout|overlay/` in any file
  under `src/renderer/editors/log-view/`.
- No `@emotion/styled` usage beyond per-file Rule-7 chrome exceptions.
- All migrated UIKit primitives carry meaningful `name` debug
  attributes per US-521.
- Script-runtime API surface (item view prop names) unchanged.
- `npm run lint` baseline unchanged.
- `npx tsc --noEmit` baseline unchanged.
- Manual smoke covering: every `log.*Dialog`, `log.*Output`, MCP
  request panel, progress bar, button panel, confirm dialog,
  markdown / mermaid / grid output rendering and interaction.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the deferred-review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related primitives: US-477 Progress, US-476 Notification, US-432
  Dialog, US-481 Menu, US-468 ListBox, US-469 RadioGroup, US-470
  Textarea, US-472 Select
- Related screens: US-502 MCP Inspector
