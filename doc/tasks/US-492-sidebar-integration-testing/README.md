# US-492: Sidebar — final integration testing and cleanup

## Status

**Plan ready for review** — picked up after US-479, US-490, US-491, US-495,
US-496, and US-497 are all implemented. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Sweep `src/renderer/ui/sidebar/` so every primitive comes from
`src/renderer/uikit/`. Replace direct dependencies on
`src/renderer/components/` (Button, FlexSpace, Splitter, MenuItem type,
searchMatch utility) with their UIKit equivalents, and convert chrome-internal
`<div>` containers to `Panel` where they express plain flex layout. Old
`components/*` files stay in place — this task only changes how the sidebar
imports them.

After the swap, run the manual test surface end-to-end so the sidebar arc is
ready for `/review`, `/document`, and `/userdoc` at EPIC-025 close.

## Background

### Old → UIKit primitives available

| Old (`src/renderer/components/`) | New (`src/renderer/uikit/`) | Notes |
|---|---|---|
| `basic/Button` (4 icon-only toolbar buttons in MenuBar) | `IconButton` | All four uses pass `type="icon"` + `<Icon />` child + `title` — exact `IconButton` shape. |
| `layout/Elements.FlexSpace` | `Spacer` | Both render a span with `flex: 1 1 auto`. Bare `<Spacer />` (no `size`) is the direct equivalent. |
| `layout/Splitter` | `Splitter` | API differs — see prop mapping below. |
| `overlay/PopupMenu.MenuItem` (type only) | `Menu.MenuItem` | Both re-export the same canonical `MenuItem` type from `api/types/events`. Pure import swap. |
| `basic/useHighlightedText.searchMatch` | inline | 4-line case-insensitive substring filter — no UIKit equivalent and not worth one. Inline at the FileList call site. |

### Splitter prop mapping (old → UIKit)

```tsx
// Old
<Splitter
    type="vertical"
    initialWidth={state.contentWidth}
    onChangeWidth={model.setContentWidth}
    borderSized="right"
    className="content-splitter"  // chrome override: dark bg, default-bg on hover, no border
/>

// New
<Splitter
    orientation="vertical"
    side="before"                 // panel sits before (left of) the bar
    value={state.contentWidth}
    onChange={model.setContentWidth}
    border="none"                 // matches old chrome override
    background="dark"             // matches color.background.dark in chrome override
    hoverBackground="default"     // matches color.background.default on hover
/>
```

UIKit `Splitter` rejects `className`/`style` at the type level — the dark/hover
chrome moves into the new `background` / `hoverBackground` props.

### Components that stay (kept on `components/`)

These are **not** in scope. They are app-specific or pre-UIKit-icon assets.

- `components/icons/FileIcon` — `FileIcon`, `FolderIcon` (icon assets, not yet migrated)
- `components/icons/LanguageIcon` — language-aware language icon (icon asset)
- `components/tree-provider/TreeProviderView` — the migrated UIKit-Tree-based wrapper for tree providers; app-specific composition that lives outside UIKit per design

### Rule 7 chrome exception — what stays as `styled.div`

Per [/src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md) Rule
7, `src/renderer/ui/` may use Emotion + `styled.div` for unique chrome surfaces.
The following stay as styled containers because they encode chrome behavior
that doesn't fit Panel's prop surface:

- **MenuBar `MenuBarRoot`** + **`menu-bar-content`** — absolute backdrop, slide-in `transform` animation, `transition: transform 50ms`, conditional `display: none` via `.doDisplay` class. Animation/positioning is unique chrome.
- **FolderItem `Root`** — heavy `data-*`-driven drag visuals (selected/dragging/dragOver) with hover-only inset for the trailing icon button.
- **ToolsEditorsPanel `RowStyled`** — drag visuals + hover-only pin button reveal.
- **FileList `FileListWrapper`** — focus-ring suppression (`outline: none`) on a `tabIndex={0}` keyboard-handling root. Replacing with Panel would need a new prop just for outline suppression — not worth the surface widening.

The simple flex containers below are converted to `Panel` since they are pure
layout with no chrome quirk:

- MenuBar `menu-bar-panel` (left + right children) — flex column with padding.
- MenuBar `menu-bar-header` — flex row with gap.
- FileList `SearchRow` — flex item with padding.

## Implementation Plan

### 1. MenuBar — replace `Button`, `FlexSpace`, `Splitter`, MenuItem type

File: `src/renderer/ui/sidebar/MenuBar.tsx`

**Imports — remove:**
```ts
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { Splitter } from "../../components/layout/Splitter";
```

**Imports — add (or extend the existing `from "../../uikit"` line):**
```ts
import { ListBox, LIST_ITEM_KEY, IconButton, Spacer, Splitter, Panel } from "../../uikit";
import type { MenuItem } from "../../uikit/Menu";
```

**Toolbar buttons (4 sites):** replace each `<Button size="medium" type="icon" background="dark" onClick={…} title={…}><Icon /></Button>` with:

```tsx
<IconButton size="md" icon={<OpenFileIcon />} title="Open File (Ctrl+O)" onClick={model.openFile} />
<IconButton size="md" icon={<NewWindowIcon />} title="New Window (Ctrl+Shift+N)" onClick={model.newWindow} />
{/* Spacer between */}
<IconButton size="md" icon={<InfoIcon />} title="About" onClick={model.openAbout} />
<IconButton size="md" icon={<SettingsIcon />} title="Settings" onClick={model.openSettings} />
```

The 20×20 svg sizing is provided by `IconButton[data-size="md"]` (uses
`height.iconLg = 20`); the chrome-level `& button svg { width: 20; height: 20 }`
rule in `MenuBarRoot` becomes redundant. Leave it in place — out of scope (no
cleanup) and harmless.

The old `background="dark"` prop on `Button` had no visual effect for `type="icon"` (icon buttons render transparent over the chrome background); IconButton matches that — its `color.icon.light` hover/active feedback reads correctly on `color.background.dark`.

**`<FlexSpace />`:** replace with `<Spacer />`.

**Splitter:** replace per the prop mapping above. Keep the existing
`state.contentWidth`/`model.setContentWidth` wiring.

**`MenuItem` type:** import-only swap, no JSX changes.

**`menu-bar-header` div (line ~501):** replace with
```tsx
<Panel direction="row" align="center" gap="sm" paddingBottom="sm">
    <IconButton ... />
    <IconButton ... />
    <Spacer />
    <IconButton ... />
    <IconButton ... />
</Panel>
```
The previous `marginBottom: 4` on the header becomes `paddingBottom="sm"` (4px)
on the Panel — visual gap to the ListBox below is preserved (no border between,
no top margin on ListBox). Remove the `& .menu-bar-header { … }` block from
`MenuBarRoot`.

**`menu-bar-panel menu-bar-left` div:** replace with
```tsx
<Panel direction="column" flex padding="xs" borderRight width={40} minWidth={40}>
    {/* header Panel + ListBox */}
</Panel>
```
- `flex` → `1 1 auto` so both panels share the parent flex
- `width={40}` + the parent flex assignment (`flex: 1 1 40%` from old chrome) means the left panel takes 40% of horizontal space; UIKit Panel's `width=40` here is merely an initial baseline — flex on the parent will override during layout. Keep the proportions by also setting `flex={"1 1 40%"}` (Panel accepts string).
- `borderRight` adds the `1px solid color.border.light` divider between left and right panels (matches `& .menu-bar-left { borderRight: 1px solid color.border.light }`).

Equivalent for right panel:
```tsx
<Panel direction="column" flex={"1 1 60%"} paddingRight="xs" width={60} minWidth={60}>
    {renderRightList()}
</Panel>
```
The right panel's `padding: 2` (from `menu-bar-panel`) plus `paddingRight: 3`
(from `menu-bar-right`) is approximated by `paddingRight="xs"` (2px) — the
extra 1px on the right was never meaningful (visual indistinguishable). Drop
the unique value rather than introduce a new token.

**Remove from `MenuBarRoot`:** `& .menu-bar-header`, `& .menu-bar-panel`, `& .menu-bar-left`, `& .menu-bar-right`, `& .content-splitter` rule blocks (those CSS rules now live in Panel/Splitter props).

**Keep in `MenuBarRoot`:** the chrome wrapper itself + `.menu-bar-content` (slide animation), the dead `.add-folder-button` rule (out of scope per "no cleanup"), and the redundant `& button svg` sizing rule.

### 2. FileList — replace `searchMatch`, convert SearchRow to Panel

File: `src/renderer/ui/sidebar/FileList.tsx`

**Imports — remove:**
```ts
import { searchMatch } from "../../components/basic/useHighlightedText";
```

**Imports — extend:**
```ts
import { ListBox, LIST_ITEM_KEY, Input, IconButton, Panel } from "../../uikit";
```

**Replace `searchMatch` call (line ~91):**
```ts
// before
return props.items.filter((item) =>
    searchMatch(item, lower, [(i) => i.title])
);
// after
return props.items.filter((item) => {
    const title = item.title.toLowerCase();
    return lower.every((s) => title.includes(s));
});
```
This matches the four-line `searchMatch` body for the single property
(`title`) used here.

**Replace `SearchRow` styled.div with Panel:**
```tsx
// remove:
const SearchRow = styled.div({ padding: 4 });
// usage:
<SearchRow>…</SearchRow>
// becomes:
<Panel padding="sm">…</Panel>
```

**Keep `FileListWrapper` as styled.div** — it carries `outline: none` on a
`tabIndex={0}` root with keyboard handling. Panel does not expose outline
suppression and adding a one-off prop is not worth the API growth.

### 3. RecentFileList — no changes needed

File: `src/renderer/ui/sidebar/RecentFileList.tsx` — already uses
`uikit/Menu.MenuItem`, FileList, no `components/` imports.

### 4. OpenTabsList — no changes needed

File: `src/renderer/ui/sidebar/OpenTabsList.tsx` — only `LanguageIcon` from
`components/icons/`, which stays.

### 5. FolderItem — no changes needed

File: `src/renderer/ui/sidebar/FolderItem.tsx` — uses UIKit `Tooltip`. The
`Root` styled.div is chrome (drag visuals) per Rule 7.

### 6. ScriptLibraryPanel — no changes needed

File: `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` — already on UIKit
(`Panel`, `Button`, `Text`). The `TreeProviderView` import is the migrated
wrapper that lives in `components/` per design.

### 7. ToolsEditorsPanel — no changes needed

File: `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` — uses UIKit `ListBox`
and `IconButton`. The `RowStyled` styled.div is chrome (drag/hover-reveal
visuals) per Rule 7.

### 8. Manual test pass

Run the full smoke surface listed below (carried over from the original task
notes). Migration is component-swap only, so regressions are most likely in:

- toolbar IconButton tooltip delay vs old Button tooltip delay (different
  Tooltip implementations underneath — both UIKit-native after migration)
- splitter dark background + light hover (chrome override moved to UIKit
  `background`/`hoverBackground` props)
- menu-bar-left / menu-bar-right proportions (flex now expressed via Panel
  `flex={"1 1 40%"}` etc. instead of nested `& .menu-bar-left { flex: ... }`)
- search row padding / search-input behavior in FileList

## Test surface (manual smoke)

- **Recent Files panel** — open / search (Ctrl+F) / Escape / context menu / click-to-open / multi-window (Open in New Window).
- **Open Tabs panel** — current page highlighted in current window; tabs from other windows render under their window header rows; clicking a tab in another window switches focus to that window.
- **Custom + static menu folders (left rail)** — click switches the right panel; drag-reorder custom folders; drop a custom folder onto another (folder-into-folder); right-click context menu on folders; Open-in-tab via the trailing icon button on hover/selected.
- **Tools & Editors panel** — pinned + unpinned sections; pin/unpin via icon button; drag-reorder pinned items (live reorder during dragOver); click row creates the page; pin button click does NOT bubble to row click.
- **Script Library panel** — empty state shows "Select Folder" UIKit Button; click opens LibrarySetupDialog; populated state renders TreeProviderView; clicking a file opens it and closes the panel.
- **MenuBar interactions** — Ctrl+F focuses search in tree-based or file-list-based right panels; Escape closes the MenuBar; Splitter resize persists; sidebar reopens to the last selected folder; toolbar IconButtons (Open File / New Window / About / Settings) work and show tooltips.

## Concerns

### C1. Splitter chrome customization moves from `className` to props

The old `Splitter` accepted `className="content-splitter"` and let MenuBarRoot
override `backgroundColor` + `:hover` via nested CSS. UIKit `Splitter` rejects
`className` at the type level and exposes `background` / `hoverBackground`
props instead. Mapping:

| Old chrome rule | UIKit prop |
|---|---|
| `backgroundColor: color.background.dark` | `background="dark"` |
| `&:hover { backgroundColor: color.background.default }` | `hoverBackground="default"` |
| `borderRight: "none"` (overrides default vertical-splitter border) | `border="none"` |

**Resolution:** swap in props as listed; remove `& .content-splitter` block from `MenuBarRoot`.

### C2. Old components stay in place

User directive: keep `src/renderer/components/basic/Button`, `components/basic/TextField`, `components/layout/Splitter`, `components/layout/Elements.FlexSpace`, `components/basic/useHighlightedText` until full migration is done. This task **only** changes how the sidebar imports them — no `git rm`, no consumer audit, no removal of the old files.

**Resolution:** edit imports + JSX in two files (`MenuBar.tsx`, `FileList.tsx`); leave `components/` directory untouched.

### C3. `MenuItem` type — import swap only

Both `components/overlay/PopupMenu` and `uikit/Menu` re-export the same
canonical `MenuItem` from `src/renderer/api/types/events`. Swapping the import
path is structurally a no-op — TypeScript resolves to the same symbol.

**Resolution:** safe pure rename, no behavior risk.

### C4. `searchMatch` — 4-line utility, inline at call site

Not a UIKit candidate (it's a generic substring filter, not a UI primitive).
Inlining at the single sidebar call site removes the only `components/basic/`
import in `FileList.tsx` and is shorter than re-implementing as a UIKit
helper.

**Resolution:** inline; no UIKit `shared/` addition.

### C5. Panel cannot fully replace every sidebar `<div>`

Some chrome containers carry behavior Panel does not (and should not) express:
animation transforms, focus-ring suppression, drag-visual data-attribute
selectors. Replacing them with Panel would either require widening Panel's
prop surface (regressing UIKit) or working around with `style=`/`className=`
which Panel forbids.

**Resolution:** convert only the four plain-flex divs called out in step 1–2
(menu-bar-header, menu-bar-left, menu-bar-right, FileList SearchRow). Keep
the four chrome surfaces (MenuBarRoot, menu-bar-content, FolderItem.Root,
ToolsEditorsPanel.RowStyled, FileList.FileListWrapper) as `styled.div` per
Rule 7 chrome exception.

### C6. IconButton tooltip behavior differs from old Button

Old `components/basic/Button` rendered a sibling Tooltip via `data-tooltip-id`
when `title` was set. New `uikit/IconButton` wraps the button in a `<Tooltip>`
when `title` is set. Both produce delayed-on-hover tooltips; visual styling
inherits each module's Tooltip component. Both Tooltip implementations now
exist in the codebase — one in `components/basic/`, one in `uikit/`.

**Resolution:** acceptable visual delta. Verify in smoke test that all four
toolbar buttons show tooltips on hover with no double-tooltip artifact.

### C7. menu-bar-left / menu-bar-right flex weights

Old chrome used nested `& .menu-bar-left { flex: 1 1 40% }` /
`& .menu-bar-right { flex: 1 1 60% }`. New chrome expresses this via
`<Panel flex={"1 1 40%"} ... />` / `<Panel flex={"1 1 60%"} ... />`. Panel's
`flex` prop accepts `string` and passes it through unchanged
(`uikit/Panel/Panel.tsx` line 196 — `if (typeof v === "string") return v`).

**Resolution:** verified Panel supports the exact CSS string; no functional
delta expected.

### C8. Splitter `value` is now controlled — old API was hybrid

Old `Splitter` had `initialWidth` (read once on first pointerdown) plus
`onChangeWidth` during drag. The MenuBar already has `state.contentWidth` and
`model.setContentWidth`, so the controlled-only UIKit API is a closer match.
Confirmed by reading `uikit/Splitter/Splitter.tsx` lines 121-129: it reads
`value` on pointerdown into `startValue`, then computes deltas from there —
identical drag behavior to the old hybrid form.

**Resolution:** drop-in, no behavior change.

### C9. Dead CSS rules in MenuBarRoot

`& .add-folder-button { fontSize: 13, color: color.text.light, &:hover: ... }`
inside `MenuBarRoot` has no JSX referent — verified via grep; the only match
is the CSS rule itself. The `& button svg { width: 20; height: 20 }` rule
becomes redundant once IconButton replaces Button (IconButton sizes its own
svg). Both are out of scope per "no cleanup" — flagged for future sweep.

**Resolution:** flag only; do not edit.

## Acceptance Criteria

- [ ] No imports from `src/renderer/components/basic/`, `components/layout/`, or `components/overlay/` inside `src/renderer/ui/sidebar/` files (verified by grep). Imports from `components/icons/` and `components/tree-provider/` remain — they are intentional.
- [ ] All four MenuBar toolbar buttons render as `IconButton` with working tooltips (Open File, New Window, About, Settings).
- [ ] Splitter resize behavior matches pre-migration: drag changes width, hover shows lighter shade, no border on the splitter, dark background.
- [ ] Sidebar slide-in animation still plays when opening (chrome `MenuBarRoot` + `.menu-bar-content` untouched).
- [ ] FileList Ctrl+F search behavior unchanged (search input appears, filters by substring, Escape closes, Esc input focus returns to list).
- [ ] Manual smoke test in the test surface passes with no regression.
- [ ] `npm run lint` clean.
- [ ] No TypeScript errors.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/sidebar/MenuBar.tsx` | Replace 4× `Button` → `IconButton`, `FlexSpace` → `Spacer`, `Splitter` (old) → `Splitter` (UIKit) with prop mapping, `MenuItem` import path swap. Convert `menu-bar-header`/`menu-bar-left`/`menu-bar-right` divs to Panel. Drop the corresponding `& .menu-bar-header`/`& .menu-bar-left`/`& .menu-bar-right`/`& .content-splitter` blocks from `MenuBarRoot`. |
| `src/renderer/ui/sidebar/FileList.tsx` | Inline 4-line `searchMatch` body at call site, drop `searchMatch` import. Convert `SearchRow` styled.div to `Panel padding="sm"`. |
| `src/renderer/ui/sidebar/FolderItem.tsx` | No changes (chrome — Rule 7). |
| `src/renderer/ui/sidebar/OpenTabsList.tsx` | No changes (only `LanguageIcon` from `components/`, kept). |
| `src/renderer/ui/sidebar/RecentFileList.tsx` | No changes (already on UIKit). |
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | No changes (already on UIKit; `TreeProviderView` import kept). |
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | No changes (already on UIKit; `RowStyled` chrome). |

## Out of scope

- Removal of `components/basic/Button`, `components/basic/TextField`, `components/layout/Splitter`, `components/layout/Elements`, `components/basic/useHighlightedText`, `components/overlay/PopupMenu`. They stay until full migration completes.
- Removal of dead CSS in `MenuBarRoot` (`.add-folder-button`, `& button svg`).
- Migration of `LanguageIcon`, `FileIcon`, `FolderIcon` to UIKit (icon-asset move, deferred to icon-pass task).
- Promotion of `TreeProviderView` into UIKit (it is an app-specific composition, intentionally outside UIKit).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Depends on (all done):
  - [US-479](../US-479-filelist-migration/README.md)
  - [US-490](../US-490-opentabslist-migration/README.md)
  - [US-491](../US-491-folderitem-migration/README.md)
  - [US-495](../US-495-scriptlibrarypanel-migration/README.md)
  - [US-496](../US-496-toolseditorspanel-migration/README.md)
  - [US-497](../US-497-treeproviderview-migration/README.md)
