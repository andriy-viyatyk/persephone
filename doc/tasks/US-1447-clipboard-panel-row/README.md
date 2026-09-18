# US-1447: Clipboard panel row redesign and arrow-key review

## Goal

Redesign each Clipboard sidebar row so its file type is visible at the leading edge, its preview
text remains primary, and its capture time is a compact right-aligned badge with a worded tooltip.
Make Arrow Up/Down move the active Clipboard row, select it, and open it in the existing host page
with the same navigation route used by a click.

This is a renderer-only follow-up to the shipped Clipboard panel work. It does not change clipboard
capture, persistence, IPC, editor routing, or the retention policy.

## Background

### Current Clipboard row and navigation behavior

`src/renderer/editors/explorer/ClipboardSecondaryView.ts` owns the panel. `rebuildRows()` currently
creates one `IListBoxItem` per `ClipboardHistoryItem` with the complete label
`${dateText(item.capturedAt)} — ${previewLabel(item)}` and puts the per-row `IconButtonView` Copy
button in `trailingElement`. `dateText` is imported from
`src/renderer/components/git-tree/git-date.ts`, where it is a shared Git-history formatter for
local `YYYY-MM-DD HH:mm` timestamps; changing it would alter unrelated Git views.

`listProps()` supplies `variant: "browse"`, `selectionStyle: "focus"`, the controlled `value`
derived from `selectedId`, and `onChange: this.handleSelection`, but no `activeIndex`,
`onActiveChange`, or `keyboardNav`. `handleSelection()` updates `selectedId`, repaints the list,
and calls `openItem()`. `openItem()` navigates the existing host page with
`app.events.openRawLink.sendAsync(createLinkData(path, { pageId }))`, falling back to
`app.pages.openFile(path)` only when there is no host page. The Explorer search path in
`src/renderer/editors/explorer/ExplorerEditorModel.ts` uses the same `openRawLink` plus `pageId`
route.

### ListBox active state is separate from selection

`src/renderer/uikit/ListBox/types.ts` already exposes the required controls:

- `icon` / `iconElement` are leading row content.
- `trailing` / `trailingElement` are right-side content and replace the default selection glyph.
- `activeIndex` / `onActiveChange` control the highlighted active row.
- `keyboardNav: true` makes `ListBoxModel.onKeyDown()` handle Arrow Up/Down, Home, End, Page Up,
  Page Down, and Enter on the ListBox root.

`src/renderer/uikit/ListBox/ListBoxModel.ts` moves only the active index for Arrow Up/Down and
calls `onItemClick()` only for Enter. `onItemMouseEnter()` also calls `onActiveChange`, so opening
from `onActiveChange` would incorrectly open an item merely because the pointer crossed its row.
`src/renderer/uikit/ListBox/ListBoxView.ts` makes the root a focusable `role="listbox"` with
`tabIndex=0` when `keyboardNav` is enabled or `selectionStyle` is `"focus"`, and wires
`aria-activedescendant` from the active index. The implementation must therefore retain two
controlled states:

- `selectedId` remains the persistent row whose payload is shown in the host page and is supplied
  through `value`.
- A new `activeIndex` is the ListBox keyboard/hover cursor and is supplied through
  `activeIndex`. Mouse hover may change it for the existing focus styling, but does not select or
  open a row.

The Clipboard view attaches one capture-phase `keydown` listener to the ListBox root and handles
Arrow Up/Down itself, calling `preventDefault()` and `stopImmediatePropagation()` so the ListBox
does not also move its active index. Home/End/Page Up/Page Down and Enter stay on ListBox's own
path untouched.

An earlier revision of this plan instead let ListBox move the active index and tried to tell an
arrow-driven `onActiveChange` from the hover-driven one with a short-lived flag cleared by a
`queueMicrotask`. It was implemented and did not work: the arrow moved the ListBox's active row
while selection never followed, so the panel highlighted an item without opening it and only Enter
opened anything — exactly the behaviour the task exists to remove. Owning the two keys outright is
deterministic and does not depend on listener ordering or on separating two callers of one
callback, so it replaces that design.

Arrow stepping is measured from the SELECTED row, not the active one, so a mouse resting over a
distant row cannot teleport the next arrow press away from where the user is reading.
`onActiveChange` remains wired for the ListBox's own hover/active presentation and never opens.

Enter remains entirely on ListBox's existing path and therefore still calls `handleSelection()`.
If Enter follows an arrow to the same row, it may re-navigate the host page to the same content;
that operation is idempotent and accepted rather than guarded by a second state machine.

### Existing file-icon machinery

`src/renderer/components/file-search/FileSearchView.ts` resolves a row icon with
`createFileIconElement({ path, width: 16, height: 16 })` from
`src/renderer/components/icons/icon-elements.ts` and subscribes with
`subscribeFileIconElements()` so a later system-icon or board-icon resolution refreshes visible
rows. The Clipboard view will follow this pattern.

`createFileIconElement()` calls the synchronous `resolveFileIcon()` in
`src/renderer/components/icons/language-icon-resolver.ts`. That resolver uses
`getLanguageByExtension()` from `src/renderer/core/utils/language-mapping.ts`, static icons from
`src/renderer/theme/language-icons.ts`, and a cached system icon. If a system icon is not cached,
`prepareFileIcon()` starts the asynchronous API request; the resolver still returns a default
icon synchronously. It is therefore suitable for a sidebar row and does not require constructing
a `TModel` in the view.

The fixed row-to-extension mapping will be:

| Clipboard primary | Icon resolver input |
| --- | --- |
| `text` | synthetic `clipboard.txt` |
| `image` | synthetic `clipboard.png` |
| `html` | synthetic `clipboard.html` |
| `files` | extensionless synthetic `clipboard` |

`ClipboardHistoryItem` can contain many copied files with different extensions, so choosing one
representative extension would be a guess. `src/main/clipboard-service.ts` stores the file-list
payload using `paths.join("\r\n")` and exposes only `preview: "N file(s)"`; the panel will not read
that payload just to choose an icon. The extensionless input makes `resolveFileIcon()` return its
generic file icon, which is honest for a heterogeneous list and costs no asynchronous read, cache,
generation guard, or legacy-payload parser. A real per-file icon can be added later if the user
wants file-list rows to expose more detail.

Keep `subscribeFileIconElements()` because the fixed `.txt`, `.png`, and `.html` inputs still pass
through the shared resolver: an uncached extension can request a system icon asynchronously, and
the subscription is the existing invalidation path for replacing that default when the request
completes. Clipboard's synthetic names do not need board-specific resolution, but that does not
remove the system-icon invalidation use.

### Time badge, tooltip, and colors

The new time formatting belongs in a Clipboard-local helper rather than the shared Git helper.
`src/renderer/components/git-tree/git-date.ts` verifies the app convention that local time is
zero-padded and 24-hour (`getHours()` plus `HH:mm`). The new helper will compare local calendar
midnights, not elapsed 24-hour periods:

- Same local date: badge `hh:mm`; tooltip `Today at hh:mm`.
- Previous local date: badge `-1d hh:mm`; tooltip `1 day ago`.
- Older local date: badge `-Nd hh:mm`; tooltip `${N} days ago`.
- A future clock value is clamped to the today presentation rather than producing a negative day
  count.

The history is capped by item count in `clipboard.max-items`, not by age, so an item older than the
retention window has no special badge state: it keeps its actual `-Nd hh:mm` value and day-count
tooltip.

The time badge will reuse the already imported `TagView` with `variant: "outlined"` and `size:
"sm"`. `src/renderer/uikit/Tag/Tag.css` supplies its border and text from existing theme CSS
tokens, including `--color-border-default` and `--color-text-default`; it also already fits the
health badge's lifecycle. A plain span would duplicate that badge styling and its token mapping.
No new color is missing, so `src/renderer/theme/color.ts` and every file under
`src/renderer/theme/themes/` remain unchanged. The Clipboard stylesheet will add layout and
visibility rules only; it will contain no color literal.

### Hover Copy affordance and the `display: contents` trap

`src/renderer/editors/explorer/ClipboardSecondaryView.css` documents that the ListItem trailing
host is assigned inline `display: contents` by `src/renderer/uikit/ListBox/ListItemView.ts`.
Applying `display` or `opacity` to that host cannot create a useful box. The current CSS correctly
targets the descendant `[data-type="icon-button"]` instead.

The redesigned trailing area will be one wrapper supplied as `trailingElement`, containing the
outlined time `TagView` and the existing Copy `IconButtonView` in the same CSS grid cell. The
wrapper reserves the larger of the two controls, while the time badge is hidden and the Copy
button is shown on row `:hover` or `:focus-within`. The button remains focusable while visually
transparent, so keyboard focus reveals it; pointer events are enabled only when it is the visible
affordance. This satisfies the requested in-place swap without putting two competing controls in
a narrow sidebar or causing row labels to move.

## Implementation Plan

### 1. Add Clipboard-local relative-time formatting

Create `src/renderer/editors/explorer/clipboard-date.ts` with a small pure formatter returning the
badge text and tooltip text for a `capturedAt` millisecond epoch value. Use `Date` local getters,
zero-padding, local-midnight day difference, and the rules above. Keep `dateText()` untouched.

Before (`src/renderer/editors/explorer/ClipboardSecondaryView.ts`):

```ts
import { dateText } from "../../components/git-tree/git-date";

label: `${dateText(item.capturedAt)} — ${previewLabel(item)}`,
```

After (planned shape):

```ts
import { clipboardTimeLabel } from "./clipboard-date";

const time = clipboardTimeLabel(item.capturedAt);

label: previewLabel(item),
// time badge receives time.badge and time.tooltip
```

The helper will be the only owner of the `-Nd hh:mm` display and worded tooltip contract.

### 2. Build file-icon and trailing-control row content

Update `src/renderer/editors/explorer/ClipboardSecondaryView.ts` to:

- Import `createFileIconElement` and `subscribeFileIconElements` from
  `src/renderer/components/icons/icon-elements.ts`. Do not add an `app.fs` read, an icon-path
  cache, a generation guard, or legacy file-list parsing: a heterogeneous list does not have one
  truthful representative extension, and the service's stored payload is CRLF-joined data rather
  than an icon input.
- Subscribe to `subscribeFileIconElements()` for the lifetime of the view, refresh the row
  `iconElement` values when the resolver's system/board cache changes, and dispose the subscription
  with the view. This follows the invalidation pattern in `FileSearchView`.
- Replace the `copyButtons`-only ownership map with row controls that own a wrapper element, one
  `TagView` time badge, and one Copy `IconButtonView` per item. Update a reused badge's `label` and
  `title` when a row is rebuilt; release controls for IDs no longer in the snapshot.
- Use `createFileIconElement({ path: "clipboard.txt" | "clipboard.png" | "clipboard.html" |
  "clipboard", width: 16, height: 16 })` as the leading `iconElement`; `files` deliberately uses
  the extensionless generic file icon. A per-file icon can be a later product enhancement.
- Pass only `previewLabel(item)` as `label`, so text is first and ellipsizes through the existing
  ListItem `.label` flex rule. Pass the wrapper as `trailingElement`, keeping time and Copy in the
  same trailing slot.

Before (`rebuildRows()`):

```ts
return {
    value: item.id,
    label: `${dateText(item.capturedAt)} — ${previewLabel(item)}`,
    rowClass: "clipboard-row",
    trailingElement: button.root,
    clipboardItem: item,
};
```

After (planned shape):

```ts
const time = clipboardTimeLabel(item.capturedAt);
return {
    value: item.id,
    label: previewLabel(item),
    iconElement: createFileIconElement({ path: iconPathFor(item), width: 16, height: 16 }),
    rowClass: "clipboard-row",
    trailingElement: controls.host,
    clipboardItem: item,
};
```

The actual control wrapper remains a DOM node owned by the view; the snippet shows the row contract,
not a new UIKit component.

### 3. Swap time and Copy in place in the Clipboard stylesheet

Update `src/renderer/editors/explorer/ClipboardSecondaryView.css` while preserving its `@layer app`
boundary and the documented trailing-host explanation. Target the wrapper's descendants, not
`[data-part="trailing"]` itself. Use a grid overlap or equivalent same-slot layout:

```css
.clipboard-row [data-clipboard-trailing] {
    display: inline-grid;
    align-items: center;
}

.clipboard-row [data-clipboard-time],
.clipboard-row [data-clipboard-copy] {
    grid-area: 1 / 1;
}

.clipboard-row [data-clipboard-copy] {
    opacity: 0;
    pointer-events: none;
}

.clipboard-row:hover [data-clipboard-time],
.clipboard-row:focus-within [data-clipboard-time] { visibility: hidden; }

.clipboard-row:hover [data-clipboard-copy],
.clipboard-row:focus-within [data-clipboard-copy] {
    opacity: 1;
    pointer-events: auto;
}
```

The final selectors must match the data attributes assigned to the wrapper, TagView root, and
Copy button. No hardcoded color or new global selector is permitted.

### 4. Add controlled active navigation without opening on hover

In `src/renderer/editors/explorer/ClipboardSecondaryView.ts`:

- Add `activeIndex: number | null`. Reconcile it to the selected row after each history snapshot or
  row removal; clear `selectedId` and active state when the selected row no longer exists.
- Extend `listProps()` as follows:

```ts
activeIndex: this.activeIndex,
keyboardNav: true,
```

- No `onActiveChange` is supplied at all, so `activeIndex` follows the selected row and nothing
  else. The ListBox reports hover through that callback, and while it was wired the last row the
  pointer touched stayed painted as active after the mouse had left the list — an active row is
  only ever moved, never cleared on leave. Hover keeps its own cue from the `browse` variant's
  `:hover` rule, which ends when the pointer does.
- The capture-phase listener handles Arrow Up/Down itself: it steps one row from the currently
  selected index, clamps at both ends, and calls `handleSelection(this.rows[next])`, which selects,
  takes focus, and queues the open. `preventDefault()` and `stopImmediatePropagation()` stop the
  ListBox from moving its own active index for the same press. Home/End/Page Up/Page Down remain
  ListBox's active-row-only operations, and Enter remains its activation path.
- `handleSelection` also claims focus for the list root, and each completed open restores it.
  Clicking a row does not focus the list on its own, and opening the first item creates the host
  page's editor, which takes focus — without this the first arrow press after opening the panel
  moved that editor's caret instead of stepping the history.

The implementation must also confirm the active and selected treatments do not fight in the narrow
sidebar. The indices coincide for every arrow press and click; they diverge only when the pointer
hovers another row. If the active hover treatment obscures the selected navigation treatment, make
the Clipboard row's nonselected active styling subordinate to the selected styling without
changing ListBox's shared UIKit files or replacing `selectedId` as the source of selection.

Before (`listProps()`):

```ts
selectionStyle: "focus",
value: this.rows.find((row) => row.value === this.selectedId) ?? null,
onChange: this.handleSelection,
```

After (planned shape):

```ts
selectionStyle: "focus",
value: this.rows.find((row) => row.value === this.selectedId) ?? null,
activeIndex: this.activeIndex,
onActiveChange: this.handleActiveChange,
keyboardNav: true,
onChange: this.handleSelection,
```

No changes are required in `src/renderer/uikit/ListBox/types.ts`,
`src/renderer/uikit/ListBox/ListBoxModel.ts`, or `src/renderer/uikit/ListBox/ListBoxView.ts`; their
existing active/value split and root key handling are the intended API.

### 5. Serialize host-page opens in strict FIFO order

Change the view's fire-and-forget `void this.openItem(...)` calls to an owned serial promise chain.
Every changed Arrow Up/Down press queues exactly one `openItem()` request for its row; no request is
dropped, skipped, or superseded by a newer selection. Requests execute one at a time in press order,
each awaited and its failure caught before the next request runs. Selection and active-row repaint
remain synchronous, so the list responds immediately while host-page navigation drains the queue.

This is deliberately no debounce and no coalescing: intermediate rows the user passes over are
opened because the user wants to review every item in the sequence, not only the row where they
land. A generation/disposed guard must discard queued work after the panel is disposed. The
existing `openItem()` error notification remains the per-request failure path. The trade-off is
that a held arrow key can make the host page lag behind the selected row until the queue drains;
that lag is intentional.

The guard is necessary because `EventChannel.sendAsync()` awaits asynchronous parser/resolver/open
handlers, and `openRawLink` has multiple asynchronous content-pipeline subscribers. Independent
`openItem()` calls can otherwise overlap and complete out of order, leaving the host page on a
different item than the selected row. The serial promise chain prevents that interleaving without
changing the shared content pipeline.

### 6. Preserve all existing Clipboard actions

Keep the current Copy, Remove, Clear, health, disabled-state, same-page navigation, and snapshot
revision logic unchanged except where row control ownership or selection state must be updated.
Copy remains an action inside the trailing wrapper and must continue stopping propagation so it does
not select/open the row. Enter remains ListBox's unmodified activation path.

## Concerns / Open questions

All requested design questions are resolved here:

- **Today tooltip:** use `Today at hh:mm`; it is understandable in a sidebar and still gives the
  exact local time without repeating a date. Yesterday and older tooltips use `1 day ago` and
  `${N} days ago` respectively.
- **Older-than-retention items:** the service retention rule is a count cap, not an age window.
  Do not invent an "expired" appearance; display the true calendar-day distance for any item still
  present in history.
- **Clock basis:** `hh:mm` is local 24-hour time, matching `git-date.ts`'s verified `getHours()`
  and zero-padded `HH:mm` convention. Day age is local calendar-date distance so daylight-saving
  transitions do not create a misleading `-0d` or `-2d` label.
- **Files with multiple paths:** use the extensionless generic file icon. A list may contain many
  copied paths of different types, so any single representative extension would be a guess. If the
  user later wants per-file detail, a real per-file icon treatment can be designed separately.
- **Arrow speed versus `openItem()`:** yes, rapid key presses can outrun the awaited content
  pipeline. The view's serial promise chain is the guard: every changed Arrow Up/Down press queues
  exactly one request in order, and each request is awaited with its failure caught before the next
  runs. A held key can leave the host page behind the selected row until the queue drains; that is
  intentional because review includes every item passed over. A disposed view invalidates queued
  work through the generation/disposed guard.
- **Enter after an arrow:** Enter on the same row may re-navigate the host page to identical content.
  This is idempotent and invisible to the user, so the existing ListBox behavior is retained rather
  than adding a suppression marker.
- **Color tokens:** no new border or badge token is needed. `TagView` outlined styling already uses
  existing theme variables, and the new Clipboard CSS adds no color declarations. Therefore no
  `color.ts` or theme-file changes are planned.
- **CSS trap:** the in-place swap targets the wrapper's actual child controls because ListItem's
  trailing host is inline `display: contents`. If implementation reveals that the wrapper cannot
  preserve its measured width under virtualization, retain the same single-slot contract with an
  absolutely overlaid badge/button inside a fixed-width wrapper; do not revert to two visible
  trailing controls or style the `display: contents` host.

## Acceptance Criteria

- [ ] Every text row uses the existing file-icon resolver with a `.txt` input; every image row uses
      `.png`; every HTML row uses `.html`; every file-list row uses an extensionless input and the
      resolver's generic file icon.
- [ ] Each row displays preview text first, with the time control in the right-aligned trailing
      slot; long previews continue to ellipsize through the ListItem label.
- [ ] Today displays `hh:mm`; yesterday displays `-1d hh:mm`; older items display `-Nd hh:mm`.
      The badge tooltips are `Today at hh:mm`, `1 day ago`, and `${N} days ago` as applicable.
- [ ] The time badge is an outlined `TagView`, the Copy button swaps into the same trailing slot on
      hover/focus, and the row does not shift or show both controls at once.
- [ ] Arrow Up/Down on the focused Clipboard ListBox steps one row from the selected row, selects
      the target, and opens its primary payload through the existing `handleSelection()`/
      `openItem()` host route. Hover, Home, End, and boundary presses do not open rows, and hover
      leaves no active highlight behind once the pointer leaves the list.
- [ ] Enter continues to open the active row through the unmodified ListBox path, including when
      it repeats the same row an arrow just opened.
- [ ] Rapid arrow presses queue exactly one `openItem()` request per changed press; requests execute
      serially in press order, with each awaited and its failure caught before the next, host
      navigations cannot interleave, and queued work is ignored after the view is disposed.
- [ ] Copy, Remove, Clear, health status, disabled state, revision ordering, and same-page fallback
      behavior remain unchanged.
- [ ] `src/renderer/components/git-tree/git-date.ts`, ListBox UIKit files, clipboard IPC/service
      files, `src/renderer/theme/color.ts`, and all theme files remain unchanged.
- [ ] No source implementation outside this plan, unit tests, test harnesses, or commit is created
      as part of the planning task.

## Files Changed

### This planning task

| File | Change |
| --- | --- |
| `doc/tasks/US-1447-clipboard-panel-row/README.md` | Investigation, resolved decisions, implementation plan, concerns, and acceptance criteria. |
| `doc/active-work.md` | Active dashboard link under `*(no epic)*`. |

### Planned implementation touch set

| File | Planned responsibility |
| --- | --- |
| `src/renderer/editors/explorer/ClipboardSecondaryView.ts` | Clipboard-local row icon construction, Tag/Copy trailing controls, controlled active navigation, and serial FIFO host opens. |
| `src/renderer/editors/explorer/ClipboardSecondaryView.css` | Same-slot time-badge/Copy swap and row trailing layout; preserve the inline `display: contents` trap handling and use no color literals. |
| `src/renderer/editors/explorer/clipboard-date.ts` | Pure local-calendar `hh:mm` / `-Nd hh:mm` badge and tooltip formatter. |

### Explicitly unchanged

- `src/renderer/components/git-tree/git-date.ts` — shared Git timestamp formatting must not change.
- `src/renderer/uikit/ListBox/types.ts`, `src/renderer/uikit/ListBox/ListBoxModel.ts`, and
  `src/renderer/uikit/ListBox/ListBoxView.ts` — the existing `activeIndex`, `onActiveChange`,
  `keyboardNav`, root focus, and Enter behavior are sufficient.
- `src/renderer/components/file-search/FileSearchView.ts` — its icon resolver/subscription pattern
  is followed, not modified.
- `src/renderer/components/icons/language-icon-resolver.ts`,
  `src/renderer/components/icons/icon-elements.ts`, `src/renderer/core/utils/language-mapping.ts`,
  and `src/renderer/theme/language-icons.ts` — existing synchronous extension resolution is reused.
- `src/ipc/clipboard-ipc.ts` and `src/main/clipboard-service.ts` — the existing payload path and
  file-list storage contract are sufficient; no new IPC field is needed.
- `src/renderer/theme/color.ts` and every file under `src/renderer/theme/themes/` — outlined
  `TagView` styling already supplies the required theme tokens.
- Test files and test harnesses — explicitly out of scope.
