# US-432: Dialog component — new implementation + migration

**Epic:** [EPIC-025 — Unified Component Library and Storybook Editor](../../epics/EPIC-025.md)
**Phase:** 4 (per-screen migration — first)
**Status:** Planned

## Goal

Replace the legacy `Dialog` / `DialogContent` primitives in `src/renderer/ui/dialogs/` with a UIKit-conformant pair under `src/renderer/uikit/Dialog/`, then migrate every concrete dialog in the app to use them. The new primitive enforces EPIC-025 Rule 5 (focus trap), Rule 1 (data attributes), and the no-Emotion-in-app-code rule (Rule 7) — none of which the current implementation provides.

The work is split into phases so Phase 1 (build the primitive) can land independently from each per-dialog migration. Phase 1 is implementation-only — old dialogs keep working off the legacy `Dialog` until their migration phase ships.

## Background

### Current state

The `src/renderer/ui/dialogs/` folder contains:

- **`Dialog.tsx`** — the primitive: overlay (absolute positioned, `z-index: 100`), `pulse` 0.1s scale animation, `position="center"|"right"`, `onBackdropClick`, `autoFocus`, `tabIndex={1}` on root. Uses `@emotion/styled` and the app's legacy `Button` for the close X. **No focus trap.**
- **`DialogContent`** (also in `Dialog.tsx`) — the chrome: header (light bg, bottom border) with `title` + `buttons` slot + auto close-X (`<Button type="icon">`); body is children. Each concrete dialog wraps this in `styled(DialogContent)` to set `minWidth`/`maxWidth` and inner styles.
- **`Dialogs.tsx`** — singleton host. Subscribes to `dialogsState` (a `TGlobalState<IDialogViewData[]>`), renders queued dialogs via the view registry, and exposes `showDialog<R>()` (returns a promise that resolves on close) and `closeDialog(viewId)`. **This is app infrastructure, not a UI primitive — it stays in `ui/dialogs/`.** UIKit only owns the visual `Dialog` + `DialogContent`.
- **`index.ts`** — re-exports `Dialog`, `DialogContent`, `DialogPosition`, `Dialogs`, `dialogsState`, `showDialog`, `closeDialog`, plus alerts and poppers.

### Concrete dialogs to migrate (7 total)

All UIKit primitives needed for migration now exist (see "Phase 4 — UIKit dependency status" below). Migration order is gated by Dialog (Phase 1), then complexity.

| File | Body shape | UIKit deps |
|------|-----------|------------|
| `ui/dialogs/ConfirmationDialog.tsx` | message + 2–3 buttons | `Panel`, `Text`, `Button` |
| `ui/dialogs/InputDialog.tsx` | message + `TextField` + optional radio options + 2 buttons | `Panel`, `Text`, `Button`, `Input`, `RadioGroup` (replaces radio `Button` row) |
| `ui/dialogs/PasswordDialog.tsx` | label + 1–2 password fields + error + 2 buttons | `Panel`, `Text`, `Button`, `Input` (with `type="password"` and a `Label` above) |
| `ui/dialogs/TextDialog.tsx` | Monaco `<Editor>` + buttons (sized 600×400 by default, or `width`/`height` props) | `Panel`, `Button` + Monaco `<Editor>` (kept as-is) |
| `ui/dialogs/OpenUrlDialog.tsx` | `TextAreaField` + 3 buttons (with one left-aligned) | `Panel`, `Button`, `Textarea` |
| `ui/dialogs/LibrarySetupDialog.tsx` | folder input + Browse button + checkbox + hint + 2 buttons | `Panel`, `Text`, `Button`, `Input`, `Checkbox` |
| `editors/link-editor/EditLinkDialog.tsx` | 6 form rows (`TextAreaField`/`TextField`/`PathInput`/`ComboSelect`/tag chips/image preview) + 2 buttons | `Panel`, `Text`, `Label`, `Button`, `Input`, `Textarea`, `Select`, `PathInput`, `TagsInput` |

### EPIC-025 rules in scope

- **Rule 1 — Data attributes:** new components set `data-type="dialog"` / `data-type="dialog-content"`, use `data-position`, `data-state` for state. No `clsx`/`className` for state.
- **Rule 5 — Focus trap (mandatory):** when a dialog opens, focus moves to the first focusable element inside. Tab/Shift+Tab cycle only within the dialog. On close, focus returns to the element that was focused before. Implemented as an internal `FocusTrap` wrapper inside `uikit/Dialog/`, **not exported** as a general utility.
- **Rule 7 — No Emotion in app code:** concrete migrated dialogs cannot use `styled`, `style=`, or `className=`. All layout via UIKit props (`Panel`, `Text`, etc.). Sizing the dialog itself goes through new `DialogContent` props (`minWidth`, `maxWidth`, `width`, `height`).

### What stays where

- **`uikit/Dialog/`** — the new visual primitive. Reusable, no app state.
- **`ui/dialogs/Dialogs.tsx`** — stays. App-shell singleton; not a UI primitive.
- **`ui/dialogs/<Concrete>Dialog.tsx`** — stay in their current folders. They are *consumers* of the primitive. After migration, they import from `uikit/Dialog` instead of `./Dialog`. `EditLinkDialog.tsx` stays in `editors/link-editor/`.

## New UIKit Dialog API

### `<Dialog>` — overlay + focus trap

```tsx
export interface DialogProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Where to anchor the dialog body. Default: "center". */
    position?: "center" | "right";
    /** Click on the backdrop (outside the dialog body). */
    onBackdropClick?: () => void;
    /** Auto-focus the first focusable child on mount. Default: true. */
    autoFocus?: boolean;
    children?: React.ReactNode;
}
```

**Behavior:**
- Renders a full-area absolute overlay; `data-type="dialog"`, `data-position`.
- Centers the child for `position="center"`; right-docks (full height, hugged to right edge with a left border) for `position="right"`.
- `pulse` 0.1s scale-in animation preserved.
- Internal `<FocusTrap>` wraps children: on mount snapshots `document.activeElement`, focuses first focusable descendant; intercepts Tab/Shift+Tab to cycle within the dialog; on unmount restores focus to the snapshotted element.
- `onKeyDown`, `onClick`, etc. forwarded via `...rest` to the root.
- The dialog is mounted-as-open (the `Dialogs.tsx` host controls mount/unmount). No `open` prop — adding one would conflict with the queue-based host. Direct (non-queue) usage is out of scope for now.

### `<DialogContent>` — chrome (header + body)

```tsx
export interface DialogContentProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "title"> {
    /** Title text or rich node. */
    title?: React.ReactNode;
    /** Optional leading icon in the header (replaces the manual `<><Icon /> {title}</>` pattern). */
    icon?: React.ReactNode;
    /** Close-X button click. When unset, the X is hidden. */
    onClose?: () => void;
    /** Inline buttons rendered between the title and the close X (rare; kept for parity). */
    headerButtons?: React.ReactNode;

    /** Sizing — pass through to the root element. Numbers → px. */
    width?: number | string;
    height?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;
    minHeight?: number | string;
    maxHeight?: number | string;

    children?: React.ReactNode;
}
```

**Behavior:**
- `data-type="dialog-content"`. Column flex; `background: color.background.default`; `border: 1px solid color.border.default`; `borderRadius: radius.lg`; `boxShadow: color.shadow.default` for `position="center"`.
- Header: row, `align: center`, `gap: spacing.md`, `paddingX: spacing.sm`, `paddingY: spacing.xs`, `borderBottom: 1px solid color.border.default`, `background: color.background.light`. Renders `[icon] [title (truncated, flex 1)] [headerButtons] [close-X IconButton]`.
- Body: children, no padding by default — concrete dialogs add their own body `<Panel padding=...>`.
- The previous `buttons` prop is renamed to `headerButtons` to disambiguate from action buttons (which dialogs lay out in the body, not in the header).

### File layout

```
uikit/Dialog/
  Dialog.tsx           ← Dialog (overlay) + FocusTrap (internal)
  DialogContent.tsx    ← DialogContent (chrome)
  Dialog.story.tsx     ← Storybook entry
  index.ts             ← export { Dialog, DialogContent }; export type { DialogProps, DialogContentProps, DialogPosition }
```

## Phase Plan

### Phase 1 — Build the UIKit Dialog primitive

**Scope:** Implementation only. No migrations. Old `ui/dialogs/Dialog.tsx` keeps working untouched.

**Steps:**

1. **Create `src/renderer/uikit/Dialog/` folder** with `Dialog.tsx`, `DialogContent.tsx`, `Dialog.story.tsx`, `index.ts`.
2. **Implement `Dialog.tsx`**:
   - Root `styled.div` with `data-type="dialog"`, `data-position` selectors. Reuse the layout from the legacy `DialogRoot` (absolute overlay, `pulse` keyframe, conditional center vs. right docking on `& [data-type="dialog-content"]`).
   - Replace the legacy `& .dialog` selector with `& [data-type="dialog-content"]` so `DialogContent` styling is keyed on the data attribute.
   - Use `radius.lg` and `color.border.default` from `tokens.ts` / `color.ts`.
   - Add an internal `<FocusTrap>` wrapper that:
     - On mount: snapshots `document.activeElement`. If `autoFocus`, finds the first focusable descendant (`button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`) and calls `.focus()`. If none found, focuses the dialog root (with `tabIndex={-1}` set on the root for that case).
     - Intercepts `keydown` on the root: when `Tab` would move focus past the last focusable, redirects to the first; `Shift+Tab` past the first wraps to the last.
     - On unmount: restores focus to the snapshotted element if it is still in the document.
   - Forward `onKeyDown`, `onClick`, etc. via `...rest`. The backdrop click is the root's `onClick`; `onBackdropClick` is invoked only when `e.target === e.currentTarget` (the click landed on the overlay, not on the dialog body).
3. **Implement `DialogContent.tsx`**:
   - Column flex; `data-type="dialog-content"`, `data-has-header={!!title || undefined}`. Sizing via inline `style` from `width`/`height`/`minWidth`/`maxWidth`/`minHeight`/`maxHeight` props.
   - Header `<Panel direction="row" align="center" gap="md" paddingX="sm" paddingY="xs" borderBottom>` with `background="light"`. Renders `{icon}` + `{title}` (wrapped in `<Text truncate flex>`) + `<Spacer />` + `{headerButtons}` + `{onClose && <IconButton size="sm" icon={<CloseIcon />} onClick={onClose} title="Close" />}`.
   - Body: just `{children}`. No default padding.
4. **`Dialog.story.tsx`** — story with controls for `position`, `width`, `minWidth`, `maxWidth`, with/without `icon`, with/without `headerButtons`, demo body that includes inputs and buttons so focus trap can be observed (Tab cycles inside; Esc closes via the demo's keydown handler).
5. **Re-export from `uikit/index.ts`**:
   ```ts
   export { Dialog, DialogContent } from "./Dialog";
   export type { DialogProps, DialogContentProps, DialogPosition } from "./Dialog";
   ```
6. **Type-check + storybook smoke test** — verify all story variants render, focus trap cycles correctly, X closes, Esc closes (when consumer wires it).

**Phase 1 acceptance:**
- `import { Dialog, DialogContent } from "../../uikit"` works from a hypothetical app-side consumer.
- Storybook shows both `position` variants, with focus trap visibly working (Tab cycles, focus restores on close).
- No app code changed; legacy `ui/dialogs/Dialog.tsx` still in use everywhere.
- TypeScript prevents passing `style` / `className` to `<Dialog>` or `<DialogContent>`.

### Phase 2 — Simple dialog migrations (no missing UIKit deps)

**Scope:** Migrate `ConfirmationDialog`, `InputDialog`, `PasswordDialog`, `LibrarySetupDialog`. All four use only UIKit primitives (`Panel`, `Text`, `Button`, `Input`, `Checkbox`, `Label`, `IconButton`, `RadioGroup`). All deps are in place — [US-469 — UIKit RadioGroup](../US-469-uikit-radiogroup/README.md) (radio-options row for `InputDialog`) is merged.

For each dialog:
1. Replace `import { Dialog, DialogContent } from "./Dialog"` with `import { Dialog, DialogContent } from "../../uikit"`.
2. Drop `styled(DialogContent)` block. Move sizing (`minWidth` / `maxWidth`) onto `<DialogContent>` props.
3. Replace `import { Button } from "../../components/basic/Button"` with `import { Button } from "../../uikit"`.
4. Replace `import { TextField } from "../../components/basic/TextField"` with `import { Input } from "../../uikit"` (for `type="password"`, pass `type` through; UIKit `Input` accepts native `type` via `...rest`). Where the legacy `TextField` provided a `label` prop, render a `<Label>` above the `<Input>`.
5. Replace `<><Icon /> {state.title}</>` title pattern with `<DialogContent icon={<Icon />} title={state.title} ...>`.
6. Rebuild the body with UIKit primitives (`Panel padding gap` instead of styled `.confirmation-message`, `.confirmation-dialog-buttons`, etc.).
7. Drop `color` import where no longer used. Drop `clsx`, drop styled, drop `@emotion/styled` import.
8. For `LibrarySetupDialog`: replace the raw `<input>` with `<Input>`; replace the `<label class="checkbox-row"><input type="checkbox">…</label>` with `<Checkbox label="Copy example scripts">`. Keep the Browse button click handler unchanged.
9. For `InputDialog`'s radio options row: replace with `<RadioGroup orientation="horizontal" wrap items={state.options.map(o => ({ value: o }))} value={state.selectedOption} onChange={model.setSelectedOption} />`.

**Phase 2 acceptance:**
- All four dialogs render identically (within accepted token-driven drift in spacing).
- Focus trap is visible: tabbing cycles within the dialog; Esc closes; opening from a button restores focus to that button on close.
- TypeScript: no `style=` / `className=` on UIKit components in the migrated files.
- Manual smoke test of each dialog's flow (Confirm yes/no, Input enter+escape+radio selection, Password encrypt with mismatch error, LibrarySetup browse + link).

### Phase 3 — Monaco / Textarea migrations: `TextDialog` + `OpenUrlDialog`

**Scope:** Migrate `TextDialog` and `OpenUrlDialog`. Both use only UIKit primitives that are in place — Monaco `<Editor>` (embedded as-is) and UIKit `Textarea` ([US-470](../US-470-uikit-textarea/README.md), done).

Steps mirror Phase 2 (drop `styled(DialogContent)`, move sizing to props, rebuild body with `Panel`s).

- **`TextDialog`** — Monaco `<Editor>` instance is unchanged; it sits inside a `<Panel flex overflow="hidden">` so it claims the available space between header and buttons. Default sizing (600×400) and the `width`/`height` overrides map to `<DialogContent width height>`.
- **`OpenUrlDialog`** — replace `TextAreaField` with UIKit `<Textarea minHeight={80} maxHeight={300}>`. The legacy `TextAreaFieldRef.div.focus()` pattern becomes `TextareaRef.focus()`. Button row has a left-aligned "Open File" and right-aligned Cancel/Open: use `<Panel direction="row" justify="between">` with the Open File button on the left and an inner `<Panel direction="row" gap="sm">` for Cancel + Open on the right. The leading icon on "Open File" goes via `<Button icon={<OpenFileIcon />}>`.

**Phase 3 acceptance:**
- `TextDialog` renders at the configured size (default 600×400, configurable via `width`/`height` props on the consumer side that map to `<DialogContent width height>`).
- Monaco editor remains read-only by default with the same options.
- `OpenUrlDialog` autofocuses the textarea, accepts paths/URLs/cURL, Ctrl+Enter submits, Esc closes, "Open File" opens the file picker, "Open" is disabled when the textarea is empty/whitespace.

### Phase 4 — Complex dialog migration: `EditLinkDialog`

**Scope:** Migrate `EditLinkDialog`. All UIKit primitives needed are now in `uikit/`:

| UIKit primitive | Replaces (legacy) | Status |
|---|---|---|
| `Textarea` | `components/basic/TextAreaField` | [US-470](../US-470-uikit-textarea/README.md) — done |
| `Select` | `components/form/ComboSelect` | [US-472](../US-472-uikit-select/README.md) — done |
| `PathInput` | `components/basic/PathInput` (category row) | [US-474](../US-474-uikit-pathinput/README.md) — done |
| `Tag` + `TagsInput` | inline `tag-chip` spans + separate add `PathInput` | [US-475](../US-475-uikit-tag/README.md) — done |

**Textarea design (locked, shipped):** UIKit `Textarea` uses a `contentEditable` `<div>` (mirrors legacy `TextAreaField`), not a native `<textarea>`. This is preserved by US-470 and gives auto-grow/shrink, richer paste/key handling, and a clean `singleLine` mode.

**`EditLinkDialog`** — biggest body of work. Six form rows; each is `<Panel direction="row" align="center" gap="md">` with a `<Text>`/`<Label>` and a UIKit input. Per-row mapping:

| Row | Before | After |
|---|---|---|
| Title | `<TextAreaField className="form-field" singleLine value={state.linkTitle} … />` | `<Textarea singleLine value={…} onChange={…} placeholder="Link title…" autoFocus />` |
| URL | `<TextField value={state.href} … />` | `<Input value={…} onChange={…} placeholder="https://…" />` |
| Category | `<PathInput value={state.category} paths={state.categories} separator="/" … />` (legacy) | `<PathInput value={…} paths={…} separator="/" … />` from `uikit/` |
| Target | `<ComboSelect selectFrom={targetEditorOptions} … />` | `<Select items={targetEditorOptions} value={…} onChange={…} />` |
| Tags | inline chip-render loop + separate `<PathInput className="tag-add-input">` (driven by `state.newTag` + `addTagFromBlur` + `removeTag`) | `<TagsInput value={state.tags} onChange={model.setTags} items={state.availableTags} separator=":" maxDepth={1} />` |
| Image URL | `<TextField endButtons={[clearBtn]} … />` | `<Input value={…} onChange={…} endSlot={state.imgSrc ? <IconButton size="sm" icon={<CloseIcon />} onClick={() => model.setImgSrc("")} /> : null} />` (uses `Input`'s slot prop from US-471) |

**Model simplification (TagsInput absorbs transient state):** when `EditLinkDialog` migrates to `<TagsInput>`, the following members in `EditLinkDialogModel` and `EditLinkDialogState` (`src/renderer/editors/link-editor/EditLinkDialog.tsx`) become dead code and **must be removed**:

- State: `newTag: string`
- Methods: `setNewTag`, `addTagFromBlur`, `removeTag`

Replace them with a single setter:

```ts
setTags = (tags: string[]) => {
    this.state.update((s) => { s.tags = tags; });
};
```

The dedupe-on-add and trim-trailing-separator semantics that previously lived in `addTagFromBlur` are already implemented inside `TagsInput`, so behavior is preserved.

**Discovered-images grid** — replace the thumbnail grid with `<Panel direction="row" wrap gap="sm">` of `<img>`s wrapped in `<Panel border>` for the selected outline. Raw `<img>` is acceptable (this isn't a primitive's job).

**Phase 4 acceptance:**
- `EditLinkDialog` uses no `styled`, no `style=`, no `className=` on UIKit components.
- `EditLinkDialogModel` and `EditLinkDialogState` no longer carry `newTag` / `setNewTag` / `addTagFromBlur` / `removeTag`; tag mutation flows through `setTags(next: string[])`.
- Smoke test: create + edit a link with all six fields, tag add/remove (including dedupe-on-add and trailing-`:` strip), image preview.

### Phase 5 — Cleanup

**Scope:** Remove the legacy primitive once all consumers have migrated.

1. **Delete `src/renderer/ui/dialogs/Dialog.tsx`** (the legacy primitive file).
2. **Update `src/renderer/ui/dialogs/index.ts`**:
   - Remove `export { Dialog, DialogContent } from "./Dialog"`.
   - Remove `export type { DialogPosition } from "./Dialog"`.
   - Keep `Dialogs`, `dialogsState`, `showDialog`, `closeDialog`, alerts, poppers — they all stay.
3. **Grep `src/` for `from "./Dialog"` and `from "../dialogs/Dialog"`** — must be zero matches (both inside `ui/dialogs/` and outside).
4. **Grep `src/` for `from "../../ui/dialogs/Dialog"`** (used by `EditLinkDialog`) — must be zero matches.
5. Verify nothing else imported `DialogPosition` outside of UIKit.

**Phase 5 acceptance:**
- `git grep -E "from .*dialogs/Dialog['\"]"` returns no matches in `src/`.
- All dialogs import `Dialog` and `DialogContent` from `../../uikit` (or relative depth equivalent).
- `npm run lint` and `tsc` pass.

## Concerns / Open questions

1. **Radio row for `InputDialog`** — Resolved. `SegmentedControl` is the wrong affordance (joined pill bar, not a radio list). [US-469](../US-469-uikit-radiogroup/README.md) added a UIKit `RadioGroup` primitive (implemented and merged); Phase 2 of US-432 is now unblocked.
2. **Mount-as-open vs. `open` prop** — Resolved: mount-as-open. The `Dialogs.tsx` queue host already controls mount/unmount; an `open` prop would be redundant in the only consumer. If a non-queue use-case shows up later, add `open` then.
3. **`headerButtons` slot** — currently named `buttons` in legacy `DialogContent`. Renamed to `headerButtons` in the new API to disambiguate from body action buttons. Used by zero current dialogs (legacy `buttons` prop is never set anywhere we audited). Kept for parity; remove if Phase 5 finds it still unused.
4. **Focus trap edge cases** — what if every focusable child is `disabled`, or the dialog has only static text? **Resolution:** the FocusTrap falls back to focusing the dialog root with `tabIndex={-1}` set programmatically, so Esc still works and the trap still scopes Tab.
5. **Right-docked dialog (`position="right"`) styling** — currently full height, `borderLeft`, no shadow. Confirm this matches the new `DialogContent` styling (which adds `boxShadow` for the centered case). **Resolution:** condition the shadow on `position !== "right"` inside `DialogContent` styled definition (or via parent `[data-position="right"] > [data-type="dialog-content"]` selector on the `Dialog` root).
6. **Backdrop click vs. body click** — `onBackdropClick` must fire only when the click lands on the overlay, not on the dialog content (current legacy code uses `onClick` on root, which fires for both — bug masked because `Dialogs.tsx` host doesn't use `onBackdropClick` today, but the prop exists). **Resolution:** in the new `Dialog`, gate `onBackdropClick` with `e.target === e.currentTarget`.
7. **`pulse` animation** — preserve as-is. It is part of Persephone's dialog feel; tokens don't apply to keyframes.
8. **z-index** — Resolved: keep dialog z-index at `100` (legacy value). UIKit `Popover` uses `1000`. A popover anchored from a control *inside* a dialog renders into a body-level portal, so its z-index must be greater than the dialog's overlay so the popover appears above the dialog content. With dialog `100` < popover `1000`, popovers inside dialogs work correctly. Verified in Phase 1 storybook by opening a Popover from inside a story-wrapped Dialog.

## Acceptance Criteria (whole task)

- [ ] `src/renderer/uikit/Dialog/` exists with `Dialog`, `DialogContent`, story, and `index.ts` export
- [ ] `Dialog` enforces focus trap (visibly observable in Storybook)
- [ ] All 7 concrete dialogs render and behave identically to before, but consume the UIKit primitive
- [ ] `EditLinkDialog` uses `<TagsInput>` for the Tags row; `newTag` / `setNewTag` / `addTagFromBlur` / `removeTag` removed from its model
- [ ] No `styled(DialogContent)`, no `@emotion/styled` import in `ui/dialogs/*.tsx` or `editors/link-editor/EditLinkDialog.tsx`
- [ ] No `style=` / `className=` on `<Dialog>` or `<DialogContent>` anywhere in app code (TypeScript guarantees this)
- [ ] Legacy `ui/dialogs/Dialog.tsx` deleted; `ui/dialogs/index.ts` no longer exports `Dialog`/`DialogContent`/`DialogPosition`
- [ ] `Dialogs` host (`Dialogs.tsx`), `showDialog`, `closeDialog`, `dialogsState` unchanged in location and behavior
- [ ] `npm run lint` and `tsc` pass; manual smoke test of every dialog passes (full keyboard nav, focus restore on close, Esc closes)

## Files Changed (summary)

### Phase 1 — created

| Path | Status |
|------|--------|
| `src/renderer/uikit/Dialog/Dialog.tsx` | new |
| `src/renderer/uikit/Dialog/DialogContent.tsx` | new |
| `src/renderer/uikit/Dialog/Dialog.story.tsx` | new |
| `src/renderer/uikit/Dialog/index.ts` | new |
| `src/renderer/uikit/index.ts` | modified — adds `Dialog`/`DialogContent` exports |

### Phase 2–4 — modified per dialog

| Path | Phase |
|------|-------|
| `src/renderer/ui/dialogs/ConfirmationDialog.tsx` | 2 |
| `src/renderer/ui/dialogs/InputDialog.tsx` | 2 |
| `src/renderer/ui/dialogs/PasswordDialog.tsx` | 2 |
| `src/renderer/ui/dialogs/LibrarySetupDialog.tsx` | 2 |
| `src/renderer/ui/dialogs/TextDialog.tsx` | 3 |
| `src/renderer/ui/dialogs/OpenUrlDialog.tsx` | 3 |
| `src/renderer/editors/link-editor/EditLinkDialog.tsx` | 4 — also drop `newTag` / `setNewTag` / `addTagFromBlur` / `removeTag`; add `setTags` |

### Phase 5 — deleted / cleaned

| Path | Status |
|------|--------|
| `src/renderer/ui/dialogs/Dialog.tsx` | deleted |
| `src/renderer/ui/dialogs/index.ts` | modified — drop `Dialog`/`DialogContent`/`DialogPosition` re-exports |

### Files NOT changed

- `src/renderer/ui/dialogs/Dialogs.tsx` — the queue host. Stays as-is.
- `src/renderer/core/state/model.ts` — `TDialogModel` unchanged.
- `src/renderer/core/state/view.ts` — view registry unchanged.
- `src/renderer/api/ui.ts` — public `ui.confirm` / `ui.input` / etc. wrappers unchanged.
- All `Views.registerView(...)` calls and `showXxxDialog()` exports — unchanged signatures.
