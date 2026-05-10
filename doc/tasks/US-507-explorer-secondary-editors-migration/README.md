# US-507: Explorer + Search secondary editors — UIKit migration

## Status

**Plan ready for review** — Phase 4 per-screen migration under
[EPIC-025](../../epics/EPIC-025.md).

## Goal

Migrate the chrome of the Explorer and Search secondary editors (right
panel) to UIKit primitives. After this task, no file under
`src/renderer/editors/explorer/` imports from
`components/basic|form|layout|overlay/`.

The embedded `TreeProviderView` ([US-497](../US-497-treeproviderview-migration/README.md)
already migrated) and `FileSearch` (`components/file-search/` — separate
task, not yet created) are **out of scope**. This task migrates only the
header controls portalled into `headerRef` — the file tree and search
component are passed through unchanged.

## Background

### Where the components are used

Both files are **secondary editor sidebar panels**, registered in
`src/renderer/editors/register-editors.ts:685-695`:

| ID | Label | Component |
|---|---|---|
| `"explorer"` | Explorer | `ExplorerSecondaryEditor` |
| `"search"` | Search | `SearchSecondaryEditor` |

Activation flow:

1. An editor model adds `"explorer"` (or `"search"`) to its
   `secondaryEditor: string[]` field. `ExplorerEditorModel` does this for
   itself; other editor models opt in similarly.
2. `PageNavigator` (in `src/renderer/ui/navigation/PageNavigator.tsx`)
   renders a `CollapsiblePanelStack` containing one `CollapsiblePanel`
   per registered ID.
3. Each `CollapsiblePanel` exposes a `headerRef` callback to its
   content. `LazySecondaryEditor`
   (`src/renderer/ui/navigation/LazySecondaryEditor.tsx`) imports the
   registered component on demand and forwards `headerRef`.
4. The component renders its body in place and uses
   `createPortal(headerContent, headerRef)` to inject controls into the
   panel header `<div class="panel-header">`.

The Explorer panel is the right-sidebar file tree; Search replaces it
when the user clicks the Search button (or chooses "Search in Folder"
from a tree context menu).

### Files in scope

- `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx`
- `src/renderer/editors/explorer/SearchSecondaryEditor.tsx`

### Files NOT changed

- `src/renderer/editors/explorer/ExplorerEditorModel.ts` — model is
  unaffected.
- `src/renderer/editors/register-editors.ts` — registration unchanged.
- `src/renderer/ui/navigation/secondary-editor-registry.ts` —
  `SecondaryEditorProps` unchanged.
- `src/renderer/ui/navigation/LazySecondaryEditor.tsx` — chrome under
  `ui/`; exempt under Rule 7 chrome exception.
- `src/renderer/components/layout/CollapsiblePanelStack.tsx` — host
  panel container; owns the `.panel-header` CSS (height, font, color,
  border, hover) that bare text inside the portal still inherits.
- `src/renderer/components/tree-provider/*` — already migrated under
  US-497.
- `src/renderer/components/file-search/*` — separate (uncreated) task.

### Reference migration

`src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` (US-505) is
the gold-standard pattern for this task. It shows:

- `IconButton size="sm"` replaces `Button type="icon" size="small"`;
  icon passes via the `icon` prop (no explicit `width/height`).
- `<Spacer />` replaces `<span className="panel-spacer" />`.
- Bare title text (`Archive`) is **not** wrapped in `<Text>` — the host
  `.panel-header` provides font/color, and bare text inherits it.
- `e.stopPropagation()` is preserved on every header button so the
  click does not bubble to `CollapsiblePanel`'s header-toggle handler.
- Imports drop `components/basic/Button` entirely.

### Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` (`type="icon" size="small"`) | UIKit `IconButton` (`size="sm"`) |
| `<span className="panel-spacer" />` | UIKit `<Spacer />` |
| Truncating `<span style={{ overflow, textOverflow, whiteSpace }}>` (Search title) | UIKit `<Text truncate title={fullPath}>` |
| Bare `Explorer` text node | unchanged — bare text inherits `.panel-header` styling |
| Plain `<>...</>` fragment with `createPortal` | unchanged — fragment + portal pattern stays |

### Spacing / sizing reference

- `IconButton size="sm"` → button frame `height.controlSm = 24`, svg
  inside sized to `height.iconMd = 16`.
- The host `.panel-header` is `min-height: 27`, `gap: 4`,
  `padding: 2px 4px` — unchanged.
- The host has a CSS rule `.panel-header > svg { width: 14, height: 14 }`
  but it targets **direct** svg children only. After migration, svgs
  live inside `<button>` (the `IconButton`), so the rule no longer
  applies and IconButton's own 16px sizing wins.

## Implementation plan

### Step 1 — Migrate `ExplorerSecondaryEditor.tsx`

**Imports to remove:**

```ts
import { Button } from "../../components/basic/Button";
```

**Imports to add:**

```ts
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
```

**Header JSX — before** (lines 91-124):

```tsx
const headerContent = (
    <>
        Explorer
        <span className="panel-spacer" />
        {provider?.navigable && (
            <Button type="icon" size="small"
                title={canNavigateUp ? `Up to ${fpBasename(parentPath)}` : "Already at root"}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.navigateUp(); }}
                disabled={!canNavigateUp}
            >
                <FolderUpIcon width={14} height={14} />
            </Button>
        )}
        <Button type="icon" size="small" title="Search"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.openSearch(); }}>
            <SearchIcon width={14} height={14} />
        </Button>
        <Button type="icon" size="small" title="Collapse All"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); treeProviderRef.current?.collapseAll(); }}>
            <CollapseAllIcon width={14} height={14} />
        </Button>
        <Button type="icon" size="small" title="Refresh"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); treeProviderRef.current?.refresh(); }}>
            <RefreshIcon width={14} height={14} />
        </Button>
        <Button type="icon" size="small" title="Close Panel"
            onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                model.page?.pageNavigatorModel?.close();
            }}>
            <CloseIcon width={14} height={14} />
        </Button>
    </>
);
```

**Header JSX — after:**

```tsx
const headerContent = (
    <>
        Explorer
        <Spacer />
        {provider?.navigable && (
            <IconButton
                size="sm"
                title={canNavigateUp ? `Up to ${fpBasename(parentPath)}` : "Already at root"}
                disabled={!canNavigateUp}
                icon={<FolderUpIcon />}
                onClick={(e) => { e.stopPropagation(); model.navigateUp(); }}
            />
        )}
        <IconButton
            size="sm"
            title="Search"
            icon={<SearchIcon />}
            onClick={(e) => { e.stopPropagation(); model.openSearch(); }}
        />
        <IconButton
            size="sm"
            title="Collapse All"
            icon={<CollapseAllIcon />}
            onClick={(e) => { e.stopPropagation(); treeProviderRef.current?.collapseAll(); }}
        />
        <IconButton
            size="sm"
            title="Refresh"
            icon={<RefreshIcon />}
            onClick={(e) => { e.stopPropagation(); treeProviderRef.current?.refresh(); }}
        />
        <IconButton
            size="sm"
            title="Close Panel"
            icon={<CloseIcon />}
            onClick={(e) => { e.stopPropagation(); model.page?.pageNavigatorModel?.close(); }}
        />
    </>
);
```

Notes:
- `e` type is inferred from `IconButton` (`React.MouseEvent<HTMLButtonElement>`) — no explicit annotation needed.
- All five icons drop their explicit `width={14} height={14}`; UIKit
  `IconButton` sizes its svg via `height.iconMd = 16`.
- The bare text `Explorer` is left as-is (matches Archive precedent).
- `e.stopPropagation()` is preserved on every button.
- `disabled` and `title` continue to work — `IconButton` exposes both.
- The `SearchIcon` import (already present for context-menu use at
  line 80) is reused; no new icon imports needed.

The rest of `ExplorerSecondaryEditor.tsx` is untouched — model
subscription, provider creation, reveal handling, click handler, state
change handler, context-menu handler, and the
`<TreeProviderView ... />` body all remain identical.

### Step 2 — Migrate `SearchSecondaryEditor.tsx`

**Imports to remove:**

```ts
import { Button } from "../../components/basic/Button";
```

**Imports to add:**

```ts
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
import { Text } from "../../uikit/Text";
```

**Header JSX — before** (lines 28-39):

```tsx
const headerContent = (
    <>
        <span title={searchFolder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Search [{searchFolderName}]
        </span>
        <span className="panel-spacer" />
        <Button type="icon" size="small" title="Close Search"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.closeSearch(); }}>
            <CloseIcon width={14} height={14} />
        </Button>
    </>
);
```

**Header JSX — after:**

```tsx
const headerContent = (
    <>
        <Text truncate title={searchFolder}>
            Search [{searchFolderName}]
        </Text>
        <Spacer />
        <IconButton
            size="sm"
            title="Close Search"
            icon={<CloseIcon />}
            onClick={(e) => { e.stopPropagation(); model.closeSearch(); }}
        />
    </>
);
```

Notes:
- `<Text truncate>` sets `overflow: hidden`, `text-overflow: ellipsis`,
  `white-space: nowrap`, and `min-width: 0` — equivalent to the
  original inline style. The native `title` HTML attribute passes
  through via `...rest` (Text omits only `style`/`className`/`color`).
- `<Text>` defaults to `color="default"` (`color.text.default`).
  However the host `.panel-header` already sets `color: color.text.light`
  on the wrapper, and the Text's data-color rule is a more specific
  selector — so the title text will appear in `text.default` (slightly
  darker) instead of `text.light`. See **Concern 3** below.
- The body (the `<FileSearch ... />`) is untouched.

The rest of the file — `searchFolder` derivation, `pageId` lookup, the
result-click handler, and the `createPortal` invocation — is unchanged.

### Step 3 — Verify

- `npx tsc --noEmit 2>&1 | rg "explorer/(Explorer|Search)SecondaryEditor"` → no output
- `npx eslint src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx src/renderer/editors/explorer/SearchSecondaryEditor.tsx` → clean
- Manual smoke per the **Test surface** below.

## Concerns

### 1. Icon size grows from 14 px to 16 px (resolved — accepted)

The original `Button` had `width={14} height={14}` on each icon.
`IconButton size="sm"` sizes its svg via `height.iconMd = 16`. The host
CSS rule `.panel-header > svg { width: 14, height: 14 }` does not apply
once svgs are nested inside the IconButton's `<button>`.

**Resolution:** matches the precedent set by `ArchiveSecondaryEditor`
(US-505) and the sidebar migration (US-479…US-497). Visual delta is
+2 px per icon, well within the existing UIKit conventions. Accepted.

### 2. `<Spacer />` vs `<span className="panel-spacer" />` (resolved — equivalent)

The host's `.panel-header .panel-spacer { flex: 1 1 auto }` rule
(`CollapsiblePanelStack.tsx:99-101`) is replaced by UIKit `Spacer`
which sets the same `flex: 1 1 auto` inline. Behavior is identical.

### 3. Search title color shift (resolved — accepted)

The host `.panel-header` sets `color: color.text.light` on the wrapper.
The original `<span>` inherited that. After migration, `<Text>` carries
its own `color="default"` data-attr → resolves to `color.text.default`
(slightly darker). Consequence: the Search panel's truncated title is
slightly more emphasised than the Explorer title (which stays as bare
text and inherits `color.text.light`).

**Resolution:** acceptable — the Search title carries the searched
folder name and benefits from being readable. The Explorer title is a
fixed label and matches sibling panels. If the user dislikes the
asymmetry, the Search title can be switched to bare text:
`Search [{searchFolderName}]` plus `title={searchFolder}` on a wrapping
`<span>` — but that re-introduces a non-UIKit element. The UIKit-only
fix is `<Text truncate color="light" title={searchFolder}>`. Decision:
**use `color="light"`** to preserve the original visual exactly.

Updated **after** snippet for SearchSecondaryEditor:

```tsx
<Text truncate color="light" title={searchFolder}>
    Search [{searchFolderName}]
</Text>
```

### 4. Bare `Explorer` text inheriting `.panel-header` styling (resolved — keep bare)

Wrapping `Explorer` in `<Text>` would override the inherited
`color.text.light` and `font-size: 12` from `.panel-header`. The
ArchiveSecondaryEditor migration left the title as bare text for the
same reason. Decision: keep bare text — preserves the panel's existing
visual exactly.

### 5. `e.stopPropagation()` on header buttons (resolved — preserved)

`CollapsiblePanel`'s header `<div class="panel-header" onClick={...}>`
toggles the panel when clicked. Without `stopPropagation`, every header
button click would also collapse the panel. Preserved on every button.

### 6. `disabled` prop on Up button (resolved — IconButton supports it)

`IconButton`'s `disabled` prop sets `data-disabled` and the styled-rule
applies `pointer-events: none` + dimmed icon color. Behavior matches
the old `Button`'s disabled state.

### 7. `React` import after migration (resolved — no longer needed for typing)

After migration, the `(e: React.MouseEvent)` annotation is unnecessary
because the `IconButton` `onClick` prop already types `e` as
`React.MouseEvent<HTMLButtonElement>`. The `React` default import in
`ExplorerSecondaryEditor.tsx` (line 1) is still used for `React`
namespace types elsewhere in the file? Check: `useCallback`,
`useEffect`, `useMemo`, `useRef` are named imports, no `React.*`
remains after migration. Drop `React` from the default import in both
files; keep the named hook imports. Confirms with `tsc --noEmit`.

`SearchSecondaryEditor.tsx`: same — drop `React` from line 1.

### 8. `headerRef` type in `LazySecondaryEditor.tsx` (resolved — out of scope)

`LazySecondaryEditor.tsx:32` uses `style={{ padding: 8, color: color.text.light }}` for an
error path. That file is under `ui/navigation/` (chrome) and exempt
under Rule 7's chrome exception. Not migrated in this task.

## Test surface (manual smoke)

### Explorer panel

- [ ] Open Explorer secondary panel: tree renders for current root.
- [ ] Header label shows `Explorer` left-aligned in `text.light` with
      panel-header font; matches sibling panel labels.
- [ ] **Up** button: hover tooltip = `Up to <parentBasename>` when
      navigable; tooltip = `Already at root` and button is dimmed (disabled)
      when at root; click → moves root to parent.
- [ ] **Search** button: click switches to the Search panel.
- [ ] **Collapse All** button: click collapses all expanded directories.
- [ ] **Refresh** button: click rebuilds the tree.
- [ ] **Close Panel** button: click closes the secondary editor sidebar.
- [ ] Click any header button → does NOT collapse the panel
      (stopPropagation works).
- [ ] Tree body: select / double-click / context menu work as before.

### Search panel

- [ ] Open Search panel via Explorer's Search button or via tree
      context menu's "Search in Folder".
- [ ] Header label shows `Search [<folderBasename>]`, truncates with
      ellipsis on narrow widths, hovering shows full path.
- [ ] **Close Search** button: click returns to the Explorer panel.
- [ ] Search input + results list still function; clicking a result
      opens the file (with `revealLine` and `highlightText` when
      applicable).

### Cross-panel

- [ ] Resize the secondary editor sidebar narrow → header buttons stay
      visible (no overflow); long folder name in Search title truncates
      correctly.
- [ ] Switch between panels (Explorer ↔ Search) repeatedly → state
      preserved (Explorer tree expansion survives, Search query persists).

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in
      `editors/explorer/`.
- [ ] No `@emotion/styled`, no `style={…}` (other than what is already
      banned by UIKit Rule 7), and no `className=…` on UIKit components
      in either file.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Header controls behave identically; portalled rendering still
      works for both panels.
- [ ] Manual smoke (above) passes for both panels.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred review model.

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Header JSX migrated to `IconButton` + `Spacer`; drop `Button` import; drop `React` default import. |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | Title `<span>` → `<Text truncate color="light">`; close button → `IconButton`; spacer → `Spacer`; drop `Button` import; drop `React` default import. |

## Files unchanged (verified)

- `src/renderer/editors/explorer/ExplorerEditorModel.ts`
- `src/renderer/editors/register-editors.ts`
- `src/renderer/ui/navigation/secondary-editor-registry.ts`
- `src/renderer/ui/navigation/LazySecondaryEditor.tsx`
- `src/renderer/components/layout/CollapsiblePanelStack.tsx`
- `src/renderer/components/tree-provider/*` (US-497 territory)
- `src/renderer/components/file-search/*` (separate task TBD)

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related: [US-497](../US-497-treeproviderview-migration/README.md) — `TreeProviderView` (already migrated)
- Reference: [US-505](../US-505-archive-editor-migration/README.md) — Archive editor migration (gold-standard pattern)
