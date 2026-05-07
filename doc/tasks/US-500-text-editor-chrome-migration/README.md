# US-500: TextEditor chrome — UIKit migration

## Status

**Plan ready for implementation.** All concerns resolved (see updated
**Concerns** section). Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
per-screen migration. No prerequisites are blocking — every UIKit primitive
required (Panel, Button, IconButton, Input, SegmentedControl, Select, Splitter,
Spacer, Divider) is already in place. This task includes a small extension to
UIKit `Select` (width / minWidth / maxWidth props — see Step 0 + C3).

## Goal

Migrate the chrome around the Monaco-backed text editor to UIKit primitives.
The Monaco `<Editor>` instance itself is **not** in scope — only the surrounding
toolbar, footer, script panel, and outer chrome layout. After this task, no
file under `src/renderer/editors/text/` imports from
`components/basic|form|layout|overlay/`, and Rule 7 holds (no `@emotion/styled`,
no `style=`, no `className=` on UIKit primitives).

## Scope

Five rendering files (the model files `TextEditorModel.ts`, `TextFileIOModel.ts`,
`TextFileEncryptionModel.ts`, etc. need no changes):

- `src/renderer/editors/text/TextEditorView.tsx` — outer chrome layout
- `src/renderer/editors/text/TextToolbar.tsx` — top toolbar
- `src/renderer/editors/text/TextFooter.tsx` — bottom status bar
- `src/renderer/editors/text/ScriptPanel.tsx` — collapsible script panel (bottom)
- `src/renderer/editors/text/EncryptionPanel.tsx` — encryption password panel
  *(see C1 — recommended deletion as dead code)*

## Background

### Files that need NO changes

- `TextEditorModel.ts` — model only; chrome refs are public, no model API
  changes required
- `TextFileEncryptionModel.ts`, `TextFileIOModel.ts` — pure logic
- `ActiveEditor.tsx` — hosts Monaco / secondary editors; will be touched in
  per-secondary-editor migrations (US-501 etc.), not here
- `editors/base/EditorToolbar.tsx` (`PageToolbar`) — shared toolbar wrapper
  used by every editor; lives in `editors/base/` and stays as a `styled.div`.
  Consumers of UIKit may use it because it is **not** a UIKit primitive — it's
  a base-editor primitive shared across editor chrome surfaces

### Old → UIKit primitive map

| Old import | New |
|---|---|
| `components/basic/Button` (`type="icon"`) | `uikit/IconButton/IconButton` |
| `components/basic/Button` (`type="raised"` / default) | `uikit/Button/Button` |
| `components/basic/TextField` | `uikit/Input/Input` (with `<Label>` wrapper) |
| `components/form/SwitchButtons` | `uikit/SegmentedControl/SegmentedControl` |
| `components/form/ComboSelect` | `uikit/Select/Select` |
| `components/layout/Splitter` | `uikit/Splitter/Splitter` |
| `components/layout/Elements.FlexSpace` | `uikit/Spacer/Spacer` |

### Splitter prop mapping (old → new)

The legacy `Splitter` and the new `Splitter` use different prop names with
flipped semantics on `borderSized` / `side`. The ScriptPanel splitter is the
only consumer.

| Old (legacy) | New (UIKit) | Notes |
|---|---|---|
| `type="horizontal"` | `orientation="horizontal"` | bar resizes panel height |
| `initialHeight=H` + `onChangeHeight` | `value={H}` + `onChange` | controlled |
| `borderSized="top"` | `side="after"` | panel sits BELOW splitter; drag UP grows |
| (implicit border on top of splitter, overridden in ScriptPanelRoot CSS to bottom) | `border="after"` (default) | for horizontal, `"after"` = bottom edge — matches old visual |

`min={…}` is new; recommended `min={60}` so the panel cannot collapse to
invisible.

### SegmentedControl shape

`SwitchButtons` takes `options: string[]` + `getLabel?`. `SegmentedControl`
takes `items: ISegment[]` where `ISegment = { value: string; label?: ReactNode; icon?; disabled? }`.
Migration: convert each option string to `{ value, label: getLabel(option) ?? option }`.

The old `<SwitchButtons style={{ margin: 1 }} />` margin nudge is a 1px gap
that fit alongside the toolbar's `columnGap: 4`. The new SegmentedControl has
its own border / radius — no margin override needed; visually verify.

### Select item shape (ScriptPanel only)

`ScriptDropdownEntry` is `{ label: string; entry: ScriptPanelEntry | null }`.
The new `Select` expects `IListBoxItem = { value: string | number; label; icon?; disabled?; section? }`.
Three options:

1. **Reshape entries to satisfy `IListBoxItem`** — give each entry a stable
   `value` (e.g. `entry.path` or `"__unsaved__"`). `label` already satisfies
   IListBoxItem. Cleanest and recommended.
2. Use `Traited<ScriptDropdownEntry[]>` with a `LIST_ITEM_KEY` accessor —
   over-engineered for a one-off shape.
3. Add a `value` property by extending `ScriptDropdownEntry` — equivalent
   to (1) but without the rename.

Plan adopts (1) — `value` derives from entry path or sentinel `"__unsaved__"`.

### Footer divider rendering

The current footer uses an Emotion `::before { content: "|" }` pseudo-element
on each `.footer-label` span to draw a vertical separator before each label.
New approach: render `<Divider orientation="vertical" />` between footer
items. Each label becomes a plain `<span>` with inline color/padding (no
emotion) — TextFooter renders a sequence of `Spacer / Divider / span` segments.

### Editor-overlay div is alive (used by NotebookEditor)

`TextEditorView` renders `<div ref={setEditorOverlayRef} className="editor-overlay" />`
with absolute positioning. The overlay is **used by `NotebookEditor`** to
portal-mount its expanded-note view (`NotebookEditor.tsx:357-369`):

```tsx
{Boolean(model.editorOverlayRef) && pageState.expandedNoteId && (() => {
    …
    return createPortal(<ExpandedNoteView … />, model.editorOverlayRef!);
})()}
```

The `:empty { display: none }` rule on `.editor-overlay` keeps the overlay
hidden when no portal content is mounted. So the overlay infrastructure
(`editorOverlayRef`, `setEditorOverlayRef`, the `<div className="editor-overlay" />`,
and the corresponding CSS) **must be preserved**. Only `EncryptionPanel.tsx`
itself is dead — see **C1** below.

### Toolbar portal targets (TextToolbar)

`TextToolbar` renders two `<EditorToolbarRoot>` styled divs (a local
`styled.div`) with refs forwarded via `setEditorToolbarRefFirst` /
`setEditorToolbarRefLast`. These are portal mount points — secondary editors
(JSON grid, etc.) render their own toolbar content here.

The styled.div is just `display: flex; alignItems: center; gap: 4`. After
migration: replace with a plain `<div ref=… style={{ display:"flex", alignItems:"center", gap:4 }} />`.
A plain HTML div with inline style is fine — Rule 7 only forbids emotion and
style=/className= on UIKit components. `model.setEditorToolbarRefLast` is
also used from inside the secondary editor (JSON grid) via createPortal to
write into this target — `useRef`-style mounting must be preserved.

### Footer portal target

`TextFooter` renders `<div ref={model.setFooterRefLast} className="footer-label hide-empty" />`
when `editor !== "monaco"`. Same plain-div migration applies.

## Implementation plan

### Step 0 — Extend UIKit `Select` with `width` / `minWidth` / `maxWidth` props

Per **C3** (resolved → extend the primitive). `Select` currently has no
width controls; the inner `Input` does, so we forward.

**File:** `src/renderer/uikit/Select/SelectModel.ts` — add three optional
props to `SelectProps<T>`:

```ts
export interface SelectProps<T = IListBoxItem> extends Omit<…> {
    …
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
    /** Minimum width — number → px, string passes through. */
    minWidth?: number | string;
    /** Maximum width — number → px, string passes through. */
    maxWidth?: number | string;
}
```

**File:** `src/renderer/uikit/Select/Select.tsx` — destructure and forward
to the inner `Input`:

```tsx
const {
    placeholder,
    disabled,
    readOnly,
    size = "md",
    emptyMessage,
    resizable,
    width, minWidth, maxWidth,   // NEW
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    items: _items,
    value: _value,
    onChange: _onChange,
    onItemsLoadError: _onItemsLoadError,
    filterMode: _filterMode,
    filter: _filter,
    maxVisibleItems: _maxVisibleItems,
    rowHeight: _rowHeight,
    ...rest
} = props;
…
<Input
    ref={setInputRef}
    size={size}
    width={width}             // NEW — forwarded
    minWidth={minWidth}       // NEW
    maxWidth={maxWidth}       // NEW
    value={displayText}
    …
/>
```

The Select `Root` styled.div has `width: "100%"` — the Input width props
already constrain the input chrome. Verify the Popover still measures the
input correctly (Popover uses `matchAnchorWidth` to size the dropdown to
the anchor).

**Tests:** add a Select story variant with `minWidth={120} maxWidth={200}`
to `src/renderer/uikit/Select/Select.story.tsx` to confirm the constraint
behavior (verify in Storybook).

### Step 1 — Delete dead `EncryptionPanel.tsx`

Per **C1** (resolved → delete). Zero consumers; encryption flow goes through
`PasswordDialog`. Concrete deletions:

- Delete `src/renderer/editors/text/EncryptionPanel.tsx` outright.
- Remove the export from `src/renderer/editors/text/index.ts` (line 7:
  `export { EncryptionPanel } from './EncryptionPanel';`).

**Do NOT remove** `editorOverlayRef` / `setEditorOverlayRef` on the model or
the `<div className="editor-overlay" />` in TextEditorView — they are used
by `NotebookEditor` for the expanded-note portal. The `& .editor-overlay {…}`
CSS that previously lived inside the styled `TextEditorViewRoot` moves to
`src/renderer/theme/GlobalStyles.tsx` as a `.editor-overlay` rule (with the
critical `:empty { display: none }` guard so the overlay does not blanket
the editor when no portal content is mounted).

### Step 2 — Migrate `TextEditorView.tsx`

**Before:**

```tsx
const TextEditorViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    height: 200,
    rowGap: 2,
    position: "relative",
    outline: "none",
    "& .editor-overlay": { … },
    "& .footer-bar": { … },   // see C2 for translation
});

return (
    <TextEditorViewRoot
        ref={rootRef}
        className={clsx("file-page")}
        onKeyDown={model.handleKeyDown}
        tabIndex={0}
    >
        <PageToolbar borderBottom>…</PageToolbar>
        {restored ? <ActiveEditor … /> : <FlexSpace />}
        <ScriptPanel … />
        <PageToolbar borderTop className="footer-bar">…</PageToolbar>
        <div ref={model.setEditorOverlayRef} className="editor-overlay" />
    </TextEditorViewRoot>
);
```

**After:**

```tsx
import { Panel } from "../../uikit/Panel/Panel";
import { Spacer } from "../../uikit/Spacer/Spacer";
// remove styled, clsx, color, FlexSpace imports

return (
    <Panel
        ref={rootRef}
        direction="column"
        flex={1}
        position="relative"
        gap="xs"   // 2px — matches old rowGap
        tabIndex={0}
        onKeyDown={model.handleKeyDown}
    >
        <PageToolbar borderBottom>
            <TextToolbar … />
        </PageToolbar>
        {restored ? <ActiveEditor model={model} /> : <Spacer />}
        <ScriptPanel model={model} />
        <PageToolbar borderTop>
            <TextFooter model={model} />
        </PageToolbar>
    </Panel>
);
```

Notes:

- Drop `clsx("file-page")` — the class is unreferenced (verified).
- Drop `outline: "none"` — Panel doesn't render an outline by default.
- Drop the explicit `height: 200` from the old root; flex parents already
  size the editor. (Visually verify Monaco still mounts; if a fallback height
  is needed, pass `minHeight={200}`.)
- The footer-bar CSS rules move to TextFooter.tsx (see Step 4).
- `gap="xs"` = 2px from `gap.xs` token — matches the old `rowGap: 2`.

### Step 3 — Migrate `TextToolbar.tsx`

Drop `styled`, `Button`, `SwitchButtons`, `FlexSpace` imports. Add:

```tsx
import { Button } from "../../uikit/Button/Button";
import { IconButton } from "../../uikit/IconButton/IconButton";
import { SegmentedControl, ISegment } from "../../uikit/SegmentedControl/SegmentedControl";
import { Spacer } from "../../uikit/Spacer/Spacer";
```

Replacements:

- The local `EditorToolbarRoot` styled.div → plain `<div>` for portal targets:

  ```tsx
  // Before
  const EditorToolbarRoot = styled.div({ display: "flex", alignItems: "center", gap: 4 });
  …
  <EditorToolbarRoot key="editor-toolbar-first" ref={setEditorToolbarRefFirst} />

  // After (inline)
  <div
      key="editor-toolbar-first"
      ref={setEditorToolbarRefFirst}
      style={{ display: "flex", alignItems: "center", gap: 4 }}
  />
  ```

  Plain HTML div with `style` is allowed — Rule 7 only forbids `style=` on
  UIKit components.

- All `<Button type="icon" size="small" title="…" onClick={…}><Icon /></Button>`
  → `<IconButton size="sm" title="…" icon={<Icon />} onClick={…} />`. Five
  buttons: `nav-panel`, `compare-with-left`, `run-script`, `run-all_script`,
  `show-resources`.

- `<FlexSpace key="flex-space" />` → `<Spacer key="flex-space" />`

- `SwitchButtons` → `SegmentedControl`:

  ```tsx
  // Before
  <SwitchButtons
      key="json-editor-switch"
      options={switchOptions.options}
      value={editor || "monaco"}
      onChange={model.changeEditor}
      getLabel={switchOptions.getOptionLabel}
      style={{ margin: 1 }}
  />

  // After
  const segItems: ISegment[] = useMemo(
      () => switchOptions.options.map((opt) => ({
          value: opt,
          label: switchOptions.getOptionLabel(opt),
      })),
      [switchOptions],
  );
  …
  <SegmentedControl
      key="json-editor-switch"
      items={segItems}
      value={editor || "monaco"}
      onChange={(v) => model.changeEditor(v as EditorView)}
      size="sm"
  />
  ```

  `model.changeEditor` expects `EditorView` (typed string union); the
  SegmentedControl emits `string` — cast at the boundary. The cast is safe
  since the items array was built from `switchOptions.options: EditorView[]`.

### Step 4 — Migrate `TextFooter.tsx`

Drop `styled`, `Button`, `FlexSpace`, `clsx` imports. Add:

```tsx
import { Button } from "../../uikit/Button/Button";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { Divider } from "../../uikit/Divider/Divider";
import color from "../../theme/color";
```

Replace the styled `FooterButton` (a `styled(Button)` with active-state color
overrides) with the UIKit Button using `variant="link"` plus a `data-active`
attribute is **not** the right path here — UIKit Button doesn't expose
data-active styling. Simpler path: use UIKit Button with `variant="link"`
and inline the active-state via `<span style={{ color: open ? color.text.default : color.text.light }}>script</span>`
inside the button. Because the visual difference is just text color (light vs
default), inlining a styled span inside the Button label is the cleanest fit
without expanding Button's API:

```tsx
<Button
    variant="link"
    size="sm"
    onClick={model.script.toggleOpen}
>
    <span style={{ color: open ? color.text.default : color.text.light, fontSize: 13 }}>
        script
    </span>
</Button>
```

`<FlexSpace />` → `<Spacer />`.

The `.footer-label` divider rendering becomes:

```tsx
{editor && editor !== "monaco" && (
    <>
        <Divider orientation="vertical" />
        <div
            ref={model.setFooterRefLast}
            key="editor-place-last"
            style={{ display: "flex", alignItems: "center", color: color.text.light, padding: "0 8px 0 0" }}
        />
    </>
)}
<Divider orientation="vertical" />
<span style={{ color: color.text.light, padding: "0 8px 0 0", fontSize: 13 }}>
    {encoding || "utf-8"}
</span>
```

The old `&:empty { display: none }` guard for the portal target div is no
longer needed — when `editor !== "monaco"`, the secondary editor will always
push content there during its mount; if the brief render-window matters
visually, fall back to a plain styled div with `:empty { display: none }`
via a class on the toolbar wrapper. (This is pure plain HTML styling — Rule
7 is not violated.)

The `paddingRight: 8` from the old `.footer-bar` selector is rendered via
the trailing `padding: "0 8px 0 0"` on the encoding span itself.

### Step 5 — Migrate `ScriptPanel.tsx`

Drop `styled`, old `Splitter`, `Button`, `FlexSpace`, `ComboSelect` imports. Add:

```tsx
import { Panel } from "../../uikit/Panel/Panel";
import { Splitter } from "../../uikit/Splitter/Splitter";
import { IconButton } from "../../uikit/IconButton/IconButton";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { Select } from "../../uikit/Select/Select";
import type { IListBoxItem } from "../../uikit/ListBox";
```

Replace `ScriptPanelRoot` (styled.div) with `Panel`:

```tsx
// Before
<ScriptPanelRoot style={{ height: state.height }} onKeyDown={scriptModel.handleKeyDown}>
    <Splitter type="horizontal" initialHeight={state.height} borderSized="top" onChangeHeight={scriptModel.setHeight} />
    <PageToolbar>…</PageToolbar>
    <Editor … />
</ScriptPanelRoot>

// After
<Panel
    direction="column"
    height={state.height}
    overflow="hidden"
    shrink={false}
    onKeyDown={scriptModel.handleKeyDown}
>
    <Splitter
        orientation="horizontal"
        value={state.height}
        onChange={scriptModel.setHeight}
        side="after"
        min={60}
    />
    <PageToolbar>…</PageToolbar>
    <Panel flex={1} minHeight={0}>
        <Editor … />
    </Panel>
</Panel>
```

The `<Editor>` (Monaco) needs a flex parent that gives it height; wrap it
in a `<Panel flex={1} minHeight={0}>` so it grows into the leftover space
after toolbar + splitter. Without `minHeight={0}` flex children's
intrinsic-content min-height blocks shrinking.

Old `& .page-toolbar { marginBottom: 2 }` is dropped — `gap` on the parent
panel covers the spacing if needed; otherwise the visual delta is
negligible. (Monitor in QA — if the toolbar visibly hugs Monaco, add
`gap="xs"` to the outer Panel.)

Buttons → IconButton (run-script, run-all-script, save, open-in-tab, close).
`<FlexSpace />` → `<Spacer />`.

`ComboSelect` → `Select`. The dropdown entry type extends to satisfy
`IListBoxItem`:

```tsx
export interface ScriptDropdownEntry extends IListBoxItem {
    value: string;       // "__unsaved__" or entry.path
    label: string;       // existing
    entry: ScriptPanelEntry | null;  // existing
}
…
const UNSAVED_ENTRY: ScriptDropdownEntry = { value: "__unsaved__", label: "(unsaved script)", entry: null };

// in getAvailableScripts():
entries.push({ value: entry.path, label: entry.name, entry });
entries.push({ value: entry.path, label: "all/" + entry.name, entry });

// in render:
<Select<ScriptDropdownEntry>
    items={allEntries}
    value={selectedEntry}
    onChange={(item) => scriptModel.selectScript(item)}
    size="sm"
    minWidth={120}   // C3 — uses the new Select width props from Step 0
    maxWidth={200}
    placeholder="(unsaved script)"
/>
```

`scriptModel.selectScript` already accepts `ScriptDropdownEntry | null` — the
existing implementation handles `dropdown.entry` lookup. Pass the item
directly.

`getDropdownLabel` and the className-scoped `.script-selector` CSS go away.

Width constraints (`minWidth: 120`, `maxWidth: 200`) use the new
`Select` width props added in **Step 0** (per **C3** resolution).

### Step 6 — TextEditorView footer-bar styling cleanup

Remove the `& .footer-bar { … }` block from the deleted `TextEditorViewRoot`
styled definition (already deleted in Step 2). The translated rendering lives
inside `TextFooter.tsx` (Step 4).

## Concerns / Open questions

### C1 — `EncryptionPanel.tsx` is dead code — **RESOLVED: delete (panel only)**

Zero callers for the panel itself in `src/`. The actual encryption flow uses
`PasswordDialog` (via `ui.password()`).

**Correction during implementation:** the `editorOverlayRef` /
`setEditorOverlayRef` / `.editor-overlay` div are **not** dead — they are
used by `NotebookEditor` to portal-mount the expanded-note view. Keep all
overlay infrastructure; only delete the panel and its index export.

**Resolution:** delete `EncryptionPanel.tsx` and the `index.ts` re-export.
Move the `.editor-overlay` CSS (including `:empty { display: none }`) from
the soon-to-be-removed styled `TextEditorViewRoot` into `GlobalStyles.tsx`
so the overlay continues to behave correctly. See **Step 1**.

### C2 — Footer divider styling translation — **RESOLVED: use Divider**

The current `::before { content: "|" }` separator is replaced with
`<Divider orientation="vertical" />`. The visual width and color (`color.border.default`)
match Divider's defaults (1px, `color.border.default`). Verify in QA that
the footer still reads with the right rhythm — Divider may render slightly
thicker than the 1px-wide character glyph. If the visual differs noticeably,
tighten the surrounding spacing to compensate. See **Step 4**.

### C3 — `Select` does not expose `width` / `minWidth` / `maxWidth` — **RESOLVED: extend Select**

**Resolution:** add `width` / `minWidth` / `maxWidth` props to `SelectProps`
and forward them to the inner `Input` (which already accepts them). The
extension is part of this task — see **Step 0**. Update the Select story
with a width-constrained variant for visual confirmation.

### C4 — `TextEditorViewRoot` had `outline: "none"` on a `tabIndex={0}` element

The old root suppressed the focus ring on the outermost text-editor
container. The Panel replacement won't render a focus ring by default
(no UA outline on a div). Expect parity. If the user expected the focus
ring suppressed for a reason that comes back, add `outline: "none"` via
inline style.

### C5 — Monaco container needs a stable, non-zero height

In the new ScriptPanel, the Monaco `<Editor>` is wrapped in
`<Panel flex={1} minHeight={0}>`. `automaticLayout: true` (already set in
the Editor options) makes Monaco re-measure on parent resize, so flex sizing
is fine. Verify Monaco still grows/shrinks when the splitter is dragged.

### C6 — `model.changeEditor` type cast at SegmentedControl boundary

`SegmentedControl.onChange: (value: string) => void`; `model.changeEditor` expects
`EditorView` (typed string union). Cast at the boundary
(`(v) => model.changeEditor(v as EditorView)`). The cast is sound because the
items array is constructed from `switchOptions.options: EditorView[]`.

### C7 — Footer portal-target empty-state

When `editor !== "monaco"`, `TextFooter` renders the portal-target div even
before the secondary editor mounts content. The old `:empty { display: none }`
guard hid the empty leading separator. If the brief render-window flashes a
trailing divider with no label, fall back to a styled chrome wrapper for
just that pair (Divider + portal target). Mark for QA.

### C8 — ScriptPanel `& .page-toolbar { marginBottom: 2 }`

Old margin between toolbar and Monaco. Drop in v1; if the visual hugs
uncomfortably, add `gap="xs"` (2px) to the outer Panel.

### C9 — `TextToolbar` portal targets — first vs last must keep order

The portal mount order in `TextToolbar` is sensitive: when `editor && editor !== "monaco"`,
the code unshifts a "first" toolbar root, then conditionally unshifts the
NavPanel button before it. Migration must preserve this exact mount order
since secondary editors createPortal into the existing `setEditorToolbarRefFirst`
/ `setEditorToolbarRefLast` refs — a wrong-order mount would lose existing
toolbar content. The plain `<div ref=…>` replacement preserves identity-by-ref
and is therefore safe.

## Test surface (manual smoke)

- **Open a text file** with `.txt`, `.json`, `.ts`, `.html` extensions.
- **Toolbar buttons:** NavPanel toggles file explorer; CompareWithLeft works
  when grouped; RunScript/RunAllScript appear for script languages and
  trigger execution; ShowResources opens links list for HTML.
- **Editor switch (SegmentedControl):** toggling editors (monaco / grid-json /
  pdf etc.) swaps `ActiveEditor`; portal-mounted secondary toolbar content
  appears between the splitter buttons and the SegmentedControl.
- **Footer:** "script" toggle opens/closes ScriptPanel and reflects active
  state via text color; encoding label shows utf-8 / cp1251 / etc.; for
  non-monaco editors, the secondary footer label shows in the middle slot.
- **ScriptPanel:** open/close via footer button; drag the horizontal
  splitter — panel height updates, Monaco re-layouts; ComboSelect (now Select)
  filters and switches scripts; Save / OpenInTab / Close work; F5 runs
  script; Ctrl+S saves dirty content.
- **Encryption (still via PasswordDialog):** open an encrypted file → password
  dialog → file decrypts and re-encrypts on save. (No EncryptionPanel
  involved.)
- **Keyboard:** Tab navigation through toolbar reaches IconButtons in order;
  arrow keys cycle SegmentedControl segments.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in any file
      under `src/renderer/editors/text/`.
- [ ] No `import styled from "@emotion/styled"` in any of the 5 chrome files
      (after EncryptionPanel deletion or migration).
- [ ] No `style=` or `className=` on UIKit components in the 5 chrome files.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Monaco editor still renders, scrolls, and edits without regression.
- [ ] All toolbar / footer / script-panel features verified per the test
      surface.
- [ ] `EncryptionPanel.tsx` deleted and `index.ts` export removed (C1).
- [ ] `.editor-overlay` CSS migrated to `GlobalStyles.tsx`; overlay div +
      model's `editorOverlayRef` / `setEditorOverlayRef` preserved
      (NotebookEditor depends on them).
- [ ] `Select` exposes `width` / `minWidth` / `maxWidth` props applied to
      its `Root`; story updated (C3).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Select/SelectModel.ts` | Add `width` / `minWidth` / `maxWidth` props to `SelectProps` |
| `src/renderer/uikit/Select/Select.tsx` | Destructure new width props and apply to `Root` style |
| `src/renderer/uikit/Select/Select.story.tsx` | Add width-constrained variant for visual confirmation |
| `src/renderer/theme/GlobalStyles.tsx` | Add `.editor-overlay` rule (incl. `:empty { display: none }`) — migrated out of `TextEditorViewRoot` |
| `src/renderer/editors/text/TextEditorView.tsx` | Replace styled root with Panel + Spacer; keep overlay div (now styled via global `.editor-overlay`) |
| `src/renderer/editors/text/TextToolbar.tsx` | Buttons→IconButton, SwitchButtons→SegmentedControl, FlexSpace→Spacer; portal-target divs become plain `<div>` |
| `src/renderer/editors/text/TextFooter.tsx` | FooterButton→UIKit Button; FlexSpace→Spacer; `::before` separators→`<Divider>` |
| `src/renderer/editors/text/ScriptPanel.tsx` | ScriptPanelRoot→Panel; old Splitter→UIKit Splitter (orient/side/border mapping); Buttons→IconButton; ComboSelect→Select; ScriptDropdownEntry extended with `value` |
| `src/renderer/editors/text/EncryptionPanel.tsx` | **DELETE** (C1 resolved) |
| `src/renderer/editors/text/index.ts` | Remove EncryptionPanel export |
| `src/renderer/editors/text/TextEditorModel.ts` | (no changes — `editorOverlayRef` retained for NotebookEditor) |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Relevant prior tasks: US-498 (Settings), US-499 (TodoEditor), US-504 (ghost variants + hover-reveal infra)
