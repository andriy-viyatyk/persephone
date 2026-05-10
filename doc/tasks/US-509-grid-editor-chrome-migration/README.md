# US-509: Grid editor chrome — UIKit migration

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration. Per the deferred-review model, this task
will not run `/review`, `/document`, or `/userdoc` — those run when the
epic closes.

## Goal

Migrate the Grid editor's chrome (toolbar, search field, Columns- and
CSV-options popups) to UIKit primitives. After this task, the three
listed files contain no `@emotion/styled` definitions and import
nothing from `components/basic/`, `components/form/`,
`components/layout/`, or `components/overlay/`.

`AVGrid`, `RenderGrid`, `FilterBar`, and `FiltersProvider` are **out of
scope** — those move with the Phase 5 adopt-in-place migration.
`Popper` (the popup positioning primitive) and `TPopperModel` /
`showPopper` plumbing also stay — only the popup *body* migrates.

## Background

### Where the Grid editor renders

- Registered in `register-editors.ts` as `"grid-json"` and `"grid-csv"`
  content-view editors. It hosts inside a `TextFileModel`, so toolbar
  chrome portals into three slots owned by the text-editor host:
  `editorToolbarRefFirst` (set in `TextEditorModel.ts:155-167`),
  `editorToolbarRefLast` (line 168-180), and `editorFooterRefLast`
  (line 161-173).
- All three host portal targets already lay children out as
  `display: flex; alignItems: center; gap: 4` (see
  `TextToolbar.tsx:28-32`). Portaled children sit in a horizontal row.
  Migration does not change the portal-target layout.

### Toolbar / footer slots used by GridEditor (3 portals)

| Slot                    | Content                                                                                |
|-------------------------|----------------------------------------------------------------------------------------|
| `editorToolbarRefFirst` | "Edit Columns" button + (csv only) "⚒-csv" CSV-options button                          |
| `editorToolbarRefLast`  | Search field with end-icon clear button                                                |
| `editorFooterRefLast`   | `<span className="records-count">{vm.recordsCount}</span>` — visible records counter   |

### Popups (anchored, NOT centered modals)

| Trigger                         | Popup                | File                       |
|---------------------------------|----------------------|----------------------------|
| "Edit Columns" toolbar button   | Columns-options grid | `components/ColumnsOptions.tsx` |
| "⚒-csv" toolbar button (csv only) | CSV-options form     | `components/CsvOptions.tsx`     |

Both popups are anchored to their trigger via `Popper` with
`offset = [0, 2]`. They use the existing `showPopper` / `TPopperModel`
plumbing. **The Popper wrapper, the `showPopper` flow, and the model
classes stay unchanged.** Only the styled-div body inside the Popper
migrates to UIKit Panel.

### Reference migrations

- `editors/draw/DrawView.tsx` (US-508 just landed) — gold standard for
  toolbar IconButton sizing (`size="sm"` = 24×24 frame with 16×16 svg),
  matching `Button type="icon" size="small"` exactly. No visual change.
- `editors/explorer/SearchSecondaryEditor.tsx` (US-507) — confirms
  the toolbar portal idiom: portal target layout (`gap: 4`) is reused;
  individual buttons just need `size="sm"`.
- `editors/settings/SettingsPage.tsx` — gold standard for Panel as the
  outer container of a popup body (no need to duplicate
  border/background/radius — `Popper` already supplies those).

## Files in scope

| File                                                          | What changes |
|---------------------------------------------------------------|--------------|
| `src/renderer/editors/grid/GridEditor.tsx`                    | Remove `GridPageRoot` + `SearchFieldRoot` styled defs, swap `TextField` → UIKit `Input`, `Button (basic)` → UIKit `IconButton` / `Button`, outer wrapper → UIKit `Panel`. |
| `src/renderer/editors/grid/components/CsvOptions.tsx`         | Remove `CsvOptionsRoot` styled def, swap manual checkbox/radio Buttons → UIKit `Checkbox` + `RadioGroup`, `TextField` → UIKit `Input`, body container → UIKit `Panel`. |
| `src/renderer/editors/grid/components/ColumnsOptions.tsx`     | Remove `ColumnsOptionsRoot` styled def, body container → UIKit `Panel`, header/buttons-bar → nested `Panel`s, `Button (basic)` → UIKit `Button`, `FlexSpace` → UIKit `Spacer`. |

## Files NOT changed

| File                                                          | Why |
|---------------------------------------------------------------|-----|
| `src/renderer/editors/grid/GridViewModel.ts`                  | Pure state/model logic — no chrome. |
| `src/renderer/editors/grid/utils/grid-utils.ts`               | `getRowKey` and helpers. |
| `src/renderer/editors/grid/index.ts`                          | Re-exports only. |
| `src/renderer/editors/register-editors.ts`                    | Editor registration unchanged. |
| `src/renderer/editors/text/TextEditorModel.ts`                | Toolbar / footer portal owner. |
| `src/renderer/editors/text/TextToolbar.tsx`                   | Portal target — `gap: 4` layout reused. |
| `src/renderer/components/data-grid/AVGrid/**`                 | Phase 5 adopt-in-place — out of scope. |
| `src/renderer/components/data-grid/AVGrid/filters/**`         | Phase 5 adopt-in-place — out of scope. |
| `src/renderer/components/overlay/Popper.tsx`                  | Anchored popup primitive — stays. UIKit `Popover` migration is a separate task. |
| `src/renderer/ui/dialogs/poppers/Poppers.tsx`                 | `showPopper` + `TPopperModel` plumbing. |
| `src/renderer/editors/base/EditorError.tsx`                   | Error chrome — separate task if migrated. |

## Old → UIKit primitives

| Old                                                              | New                                                                                                  |
|------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `styled.div` (`GridPageRoot`)                                    | UIKit `Panel` (`direction="column" flex={1} position="relative" height={fitContent ? "fit-content" : 200}`) |
| `styled(TextField)` (`SearchFieldRoot` — blue text override)     | UIKit `Input` (`size="sm"`, `endSlot=<IconButton CloseIcon />`) — **drop the blue text** (visual sugar; placeholder already cues purpose; see Concerns) |
| `components/basic/TextField` (other usages)                      | UIKit `Input` (`size="sm"`)                                                                          |
| `components/basic/Button` (`type="flat"`, icon-only — Edit Cols) | UIKit `IconButton` (`size="sm"`)                                                                     |
| `components/basic/Button` (`type="icon"`, text label — ⚒-csv)    | UIKit `Button` (`variant="ghost" size="sm"`) — keeps the "⚒-csv" Unicode label as children          |
| `components/basic/Button` (clear-search end-icon)                | UIKit `IconButton` (`size="sm"`) inside the new `Input.endSlot` (rendered conditionally on search)   |
| `components/basic/Button` (Apply / Cancel — ColumnsOptions)      | UIKit `Button` (`variant="primary"` for Apply, default for Cancel)                                   |
| `components/basic/Button` + manual `Checked/UncheckedIcon` (CsvOptions "First row is header") | UIKit `Checkbox` (built-in Checked/Unchecked icons)                          |
| `components/basic/Button` + manual `RadioChecked/UncheckedIcon` (CsvOptions delimiter group) | UIKit `RadioGroup` (`orientation="vertical"`, items: `,` `;` `\t`)            |
| `styled.div` (`CsvOptionsRoot` — bg/border/radius/padding)       | UIKit `Panel` — drop inner bg/border/radius (Popper already supplies them; see Concerns)             |
| `styled.div` (`ColumnsOptionsRoot` — bg/border/radius + nested `.edit-columns-header` + `.buttons-bar` rules) | UIKit `Panel` (outer) + nested `Panel`s (header + buttons-bar) — drop inner bg/border/radius (Popper supplies them) |
| `components/layout/Elements` `FlexSpace`                         | UIKit `Spacer`                                                                                       |
| `& .error-message` styled-descendant rule (`color.misc.red`)     | UIKit `<Text color="error">` — single token-driven affordance                                        |
| `<div className="edit-columns-header">` styled-descendant rule (bg.dark + text.light + 13px + padding + borderBottom) | UIKit `<Panel background="dark" paddingX="sm" paddingY="xs" borderBottom>` containing `<Text size="sm" color="light">Edit Columns</Text>` |

## Sizing reference (no behaviour change)

| Token                                | Old `Button type="icon" size="small"` | New `IconButton size="sm"` |
|--------------------------------------|---------------------------------------|----------------------------|
| Button frame (width × height)        | 24 × 24 (`.small` rule)               | 24 × 24 (`height.controlSm`) |
| Icon size                            | 16 × 16 (`.small` svg rule)           | 16 × 16 (`height.iconMd`)  |
| Hover/active feedback                | svg color → `icon.default` / `icon.dark` | same — IconButton uses identical color tokens |

| Token                                | Old `Button size="small" type="flat"` (icon child) | New `IconButton size="sm"` |
|--------------------------------------|----------------------------------------------------|----------------------------|
| Button frame                         | 24 × 24, with hover background fill                | 24 × 24, no hover background fill (icon-color hover only) |

The Edit Columns button currently has a hover-background tint (`type="flat"` adds the `notIcon` class which fills `background.light` on hover). UIKit `IconButton` is fully transparent — hover changes only the icon color. This is the **standard UIKit toolbar pattern** (matches every IconButton already on the text-editor toolbar — NavPanel, RunScript, Compare, etc.). Acceptable and preferred.

| Token                                | Old `TextField` (in basic)            | New `Input size="sm"` |
|--------------------------------------|---------------------------------------|------------------------|
| Inner input height                   | 26 (`& input { height: 26 }`)         | `height.controlSm` = 24 (control height; input is `100%`) |
| Padding                              | (basic Input internals)               | `spacing.md` (12) horizontal |

The 2px height drop on the search field is the only intentional dimensional shift, and it brings the field into alignment with the rest of the toolbar (every other toolbar control is `height.controlSm` = 24).

## Implementation plan

### Step 1 — `GridEditor.tsx` imports

**Remove:**
```ts
import styled from "@emotion/styled";
import { TextField } from "../../components/basic/TextField";
import { Button } from "../../components/basic/Button";
import color from "../../theme/color";
```

**Add:**
```ts
import { Panel } from "../../uikit/Panel";
import { Input } from "../../uikit/Input";
import { IconButton } from "../../uikit/IconButton";
import { Button } from "../../uikit/Button";
```

`color` was used only by the `SearchFieldRoot` blue override, which is being dropped (see Concerns). All other `color.*` references are absent in this file.

### Step 2 — `GridEditor.tsx` remove styled definitions

**Remove (lines 24-37 of the current file):**
```tsx
const GridPageRoot = styled.div<{ fitContent?: boolean }>(({ fitContent }) => ({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    height: fitContent ? "fit-content" : 200,
    position: "relative",
}));

const SearchFieldRoot = styled(TextField)({
    "& input": {
        color: color.misc.blue,
    },
});
```

### Step 3 — `GridEditor.tsx` migrate the search portal (`editorToolbarRefLast`)

**Before:**
```tsx
<SearchFieldRoot
    value={gridState.search}
    onChange={vm.setSearch}
    placeholder="Search..."
    endButtons={[
        <Button
            size="small"
            type="icon"
            key="clear-search"
            title="Clear Search"
            onClick={vm.clearSearch}
            invisible={!gridState.search}
        >
            <CloseIcon />
        </Button>,
    ]}
/>
```

**After:**
```tsx
<Input
    size="sm"
    value={gridState.search}
    onChange={vm.setSearch}
    placeholder="Search..."
    endSlot={
        gridState.search ? (
            <IconButton
                size="sm"
                title="Clear Search"
                icon={<CloseIcon />}
                onClick={vm.clearSearch}
            />
        ) : undefined
    }
/>
```

`vm.setSearch` already accepts `(value: string) => void` — UIKit Input passes the string directly (matches the old `TextField` callback shape).

### Step 4 — `GridEditor.tsx` migrate the toolbar-first portal (`editorToolbarRefFirst`)

**Before:**
```tsx
<>
    <Button
        size="small"
        type="flat"
        title="Edit Columns"
        onClick={(e) => {
            if (vm.gridRef) {
                showColumnsOptions(
                    e.currentTarget,
                    vm.gridRef,
                    editorId === "grid-csv",
                    vm.onUpdateRows
                );
            }
        }}
    >
        <ColumnsIcon />
    </Button>
    {editorId === "grid-csv" && (
        <Button
            size="small"
            type="icon"
            color="light"
            key="csv-options"
            className="csv-options-button"
            title="Csv Options"
            onClick={(e) => {
                showCsvOptions(e.currentTarget, vm);
            }}
        >
            ⚒-csv
        </Button>
    )}
</>
```

**After:**
```tsx
<>
    <IconButton
        size="sm"
        title="Edit Columns"
        icon={<ColumnsIcon />}
        onClick={(e) => {
            if (vm.gridRef) {
                showColumnsOptions(
                    e.currentTarget,
                    vm.gridRef,
                    editorId === "grid-csv",
                    vm.onUpdateRows
                );
            }
        }}
    />
    {editorId === "grid-csv" && (
        <Button
            size="sm"
            variant="ghost"
            title="Csv Options"
            onClick={(e) => showCsvOptions(e.currentTarget, vm)}
        >
            ⚒-csv
        </Button>
    )}
</>
```

The `className="csv-options-button"` is dropped (the only reason for it was the `allowClickInClass` whitelist on the closed Popper — confirm by grep'ing `allowClickInClass="csv-options-button"`; if found, retain via Popper's `allowClickInClass` prop on the popup body instead, or keep the className on the trigger button).

> **Verify during implementation:** `Grep "csv-options-button"` — if any code uses this class to detect outside-clicks (`allowClickInClass`), preserve the className verbatim. If unused, drop it.

### Step 5 — `GridEditor.tsx` migrate the page-root container

**Before:**
```tsx
<GridPageRoot fitContent={editorConfig.maxEditorHeight !== undefined}>
    <FiltersProvider ... >
        <FilterBar className="filter-bar" gridModel={vm.gridRef} />
        <AVGrid ... />
    </FiltersProvider>
</GridPageRoot>
```

**After:**
```tsx
<Panel
    direction="column"
    flex={1}
    position="relative"
    height={editorConfig.maxEditorHeight !== undefined ? "fit-content" : 200}
>
    <FiltersProvider ...>
        <FilterBar className="filter-bar" gridModel={vm.gridRef} />
        <AVGrid ... />
    </FiltersProvider>
</Panel>
```

`FilterBar` is from `components/data-grid/`, **not** UIKit — passing `className="filter-bar"` is allowed (Rule 7 only blocks className on UIKit components).

### Step 6 — `GridEditor.tsx` records-count footer (no change)

```tsx
<span className="records-count">{vm.recordsCount}</span>
```

Plain HTML element with className for the editor-footer host CSS — Rule 7 does not affect plain HTML. Leaving as-is keeps the external footer styling intact.

### Step 7 — `CsvOptions.tsx` imports

**Remove:**
```ts
import styled from "@emotion/styled";
import color from "../../../theme/color";
import {
    CheckedIcon,
    RadioCheckedIcon,
    RadioUncheckedIcon,
    UncheckedIcon,
} from "../../../theme/icons";
import { Button } from "../../../components/basic/Button";
import { TextField } from "../../../components/basic/TextField";
```

**Add:**
```ts
import { Panel } from "../../../uikit/Panel";
import { Checkbox } from "../../../uikit/Checkbox";
import { RadioGroup } from "../../../uikit/RadioGroup";
import { Input } from "../../../uikit/Input";
import { Text } from "../../../uikit/Text";
```

### Step 8 — `CsvOptions.tsx` remove styled and migrate body

**Remove (lines 20-41):**
```tsx
const CsvOptionsRoot = styled.div({
    minWidth: 140,
    minHeight: 60,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    backgroundColor: color.background.default,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    rowGap: 8,
    color: color.text.default,
    padding: 16,
    "& .delimiter-text": { color: color.text.light, marginTop: 8 },
    "& .delimiter-other": { display: "flex", alignItems: "center", columnGap: 8 },
});
```

**Replace the inner `<CsvOptionsRoot>` body with:**

```tsx
const delimiterItems: IRadio[] = [
    { value: ",",  label: "," },
    { value: ";",  label: ";" },
    { value: "\t", label: "\\t" },
];

return ReactDOM.createPortal(
    <Popper
        elementRef={model.el}
        offset={defaultOffset}
        open
        onClose={model.close}
        placement="bottom-end"
    >
        <Panel
            direction="column"
            align="start"
            gap="sm"
            padding="lg"
            minWidth={140}
            minHeight={60}
        >
            <Checkbox
                checked={gridViewState.csvWithColumns}
                onChange={() => model.gridModel?.toggleWithColumns()}
            >
                First row is header
            </Checkbox>
            <Text color="light">Delimiter:</Text>
            <RadioGroup
                items={delimiterItems}
                value={gridViewState.csvDelimiter}
                onChange={(v) => model.gridModel?.setDelimiter(v)}
            />
            <Panel direction="row" align="center" gap="sm">
                <Text>Other:</Text>
                <Input
                    size="sm"
                    value={other}
                    onChange={setOtherProxy}
                    width={40}
                />
            </Panel>
        </Panel>
    </Popper>,
    document.body
);
```

Add `import type { IRadio } from "../../../uikit/RadioGroup"` at the top.

`Panel.padding="lg"` resolves to `spacing.lg = 16` (matches old `padding: 16`). `Panel.gap="sm"` resolves to `gap.sm = 8` (matches old `rowGap: 8`).

The bg/border/radius are dropped — `Popper` already supplies them (see Concerns).

### Step 9 — `ColumnsOptions.tsx` imports

**Remove:**
```ts
import styled from "@emotion/styled";
import color from "../../../theme/color";
import { FlexSpace } from "../../../components/layout/Elements";
import { Button } from "../../../components/basic/Button";
```

**Add:**
```ts
import { Panel } from "../../../uikit/Panel";
import { Button } from "../../../uikit/Button";
import { Spacer } from "../../../uikit/Spacer";
import { Text } from "../../../uikit/Text";
```

### Step 10 — `ColumnsOptions.tsx` remove styled and migrate body

**Remove (lines 28-58):**
```tsx
const ColumnsOptionsRoot = styled.div<{ width?: number; height?: number }>((props) => ({
    flex: "1 1 auto",
    minWidth: props.width ?? minWidth,
    minHeight: props.height ?? minHeight,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    backgroundColor: color.background.default,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    "& .buttons-bar": { ..., "& .error-message": { color: color.misc.red } },
    "& .edit-columns-header": { backgroundColor: color.background.dark, color: color.text.light, fontSize: 13, padding: "4px 8px", borderBottom: `1px solid ${color.border.light}` },
}));
```

**Replace the inner JSX (lines 333-366):**

```tsx
<Panel
    direction="column"
    flex={1}
    position="relative"
    minWidth={model.width ?? minWidth}
    minHeight={model.height ?? minHeight}
>
    <Panel
        direction="row"
        background="dark"
        paddingX="sm"
        paddingY="xs"
        borderBottom
    >
        <Text size="sm" color="light">Edit Columns</Text>
    </Panel>
    <AVGrid
        ref={gridRef}
        columns={columns}
        rows={state.rows}
        getRowKey={getRowKey}
        disableSorting
        focus={state.focus}
        setFocus={model.setFocus}
        editRow={model.editRow}
        onAddRows={model.onAddRows}
        onDeleteRows={model.onDeleteRows}
        entity="column"
    />
    {state.changed && (
        <Panel
            direction="row"
            align="center"
            justify="end"
            gap="lg"
            paddingX="lg"
            paddingY="xs"
        >
            {Boolean(state.error) && <Text color="error">{state.error}</Text>}
            <Spacer />
            <Button onClick={() => model.close(undefined)}>Cancel</Button>
            <Button variant="primary" onClick={() => model.applyChanges()}>Apply</Button>
        </Panel>
    )}
</Panel>
```

`Panel` accepts `flex={1}` (= `1 1 auto`). The bg/border/radius are dropped (Popper supplies). The edit-columns-header migrates to a `Panel direction="row" background="dark" borderBottom` containing a UIKit `Text size="sm" color="light"` — token-driven, no `fontSize: 13` magic.

> **`fontSize: 13` mapping:** UIKit `Text size="sm"` resolves to `fontSize.sm`. If the design intent is to keep exactly 13px, verify `fontSize.sm` in `uikit/tokens.ts` matches (otherwise pick the closest available size). The header is a non-interactive label, so a 1px difference is acceptable.

### Step 11 — Verify

- `npm run lint` clean.
- `npx tsc --noEmit` reports no new errors in the three migrated files.
- Manual smoke test (see Test surface).

## Concerns / Open questions

1. **Drop the blue search-input text?** The current `SearchFieldRoot`
   forces `& input { color: color.misc.blue }` purely for visual flair
   — a hint that the field is a search/filter. UIKit `Input` has no
   color prop, and adding one is a UIKit primitive change (out of
   scope for this per-screen task). The placeholder `"Search..."`
   already cues the field's purpose.
   - **Recommendation:** drop the blue.
   - **Alternative:** add a `<SearchIcon />` inside `Input.startSlot`
     for a more standard visual cue (no Rule 7 violation; `startSlot`
     already exists).

2. **Drop the inner border/background/radius on CsvOptions and
   ColumnsOptions popups?** `Popper` (`PopperRoot`) already supplies
   `backgroundColor: color.background.default`, `border: 1px solid
   color.border.default`, `borderRadius: 6`, and a shadow — the inner
   `CsvOptionsRoot` / `ColumnsOptionsRoot` were duplicating those,
   producing a (mild) double-border visual.
   - **Recommendation:** drop the duplicates. The popup retains a
     single, clean Popper-supplied border.
   - **Alternative:** preserve the duplication via a `Panel` with
     `border background="default" rounded="md"` — if the visual was
     intentional or a stakeholder asks.

3. **CSV-options "⚒-csv" Unicode label.** The original button uses an
   emoji-style hammer-and-pick character inline as text. UIKit
   `Button variant="ghost" size="sm"` renders it identically, just
   with `padding: 0 spacing.sm = 8px` instead of the old 2px (so a few
   extra pixels of whitespace around the label).
   - **Recommendation:** keep "⚒-csv" verbatim. Acceptable spacing
     change; aligns with the rest of the UIKit toolbar.
   - **Alternative:** replace with a real `<SettingsIcon />` and a
     tooltip — cleaner, but a deliberate visual change. Defer to a
     follow-up if requested.

4. **Edit-Columns hover-background loss.** `Button type="flat"` with
   children fills `background.light` on hover (`notIcon` rule).
   `IconButton` is fully transparent and only changes the icon color.
   Every other IconButton on the text-editor toolbar (NavPanel,
   RunScript, Compare) uses the transparent style, so the migration
   makes the Edit Columns button **consistent with its peers** rather
   than an outlier.
   - **Recommendation:** accept the consistency win.
   - **Alternative:** if hover-fill is desired, use UIKit
     `Button size="sm" variant="default" icon={<ColumnsIcon />}` (no
     children) — but this is wider (8px padding × 2) than IconButton's
     square frame.

5. **`csv-options-button` className.** Used only locally as a CSS
   selector in the old button OR potentially as a Popper
   `allowClickInClass` token. Step 4 in the plan flags a verification
   `Grep` to be done during implementation. If used by `Popper`'s
   outside-click whitelist, retain the className on the new UIKit
   `Button` (UIKit `Button` does NOT accept `className`, so this would
   need a workaround — recommend dropping the className and adjusting
   the Popper outside-click logic instead).

6. **`Popper` → UIKit `Popover` migration.** Out of scope here.
   Migrating the anchored-popup primitive itself is a separate task
   (would touch every popup in the app). This task changes only the
   *body inside* the Popper.

7. **Records-count footer.** Plain `<span className="records-count">`
   stays — it's a plain HTML element with a className for external
   editor-footer host CSS targeting. Rule 7 only forbids `className`
   on UIKit components. Leaving as-is.

8. **`FilterBar className="filter-bar"`.** `FilterBar` is from
   `components/data-grid/`, **not** UIKit — passing `className` is
   allowed. Phase 5 will migrate FilterBar with the rest of AVGrid.

9. **Header font-size 13px.** The old `.edit-columns-header` rule
   uses `fontSize: 13`. UIKit `Text size="sm"` resolves via tokens —
   verify `fontSize.sm` is 13 (or accept the 1-2px deviation as
   token-driven design alignment).

10. **Search field height shift (26 → 24).** The old `TextField`
    forces `& input { height: 26 }`; UIKit `Input size="sm"` is 24
    (`height.controlSm`). This brings the search field into alignment
    with every other 24px control on the toolbar. Acceptable.

## Test surface (manual smoke)

- Open a JSON file in grid view: data rendered, sorting works, filter
  bar works, search field works, clear-search button hides when search
  is empty.
- Open a CSV file in grid view: same as above, plus the "⚒-csv"
  button appears alongside Edit Columns.
- Click "Edit Columns" → popup anchored under button. Toggle visibility
  on a column → AVGrid hides/shows the column. Add a row → new column
  appears in the grid. Delete a row → column removed from grid. Apply
  buttons-bar appears only when state is dirty. Error message shown on
  duplicate keys / missing keys.
- Click "⚒-csv" → popup anchored under button. Toggle "First row is
  header" → grid re-parses with/without header. Click `,` / `;` / `\t`
  delimiter radios → grid re-parses. Type into "Other" field → grid
  re-parses with custom delimiter (max 1 char enforced — verify the
  proxy still trims to first char).
- Pop both popups, click outside → both close cleanly.
- Records-count footer reflects current filter / search.

## Acceptance criteria

- [ ] No `@emotion/styled` import in the three listed files.
- [ ] No imports from `components/basic/`, `components/form/`,
      `components/layout/`, or `components/overlay/` in those files.
      `components/data-grid/` imports remain (Phase 5 scope).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors compared to pre-task
      baseline.
- [ ] All toolbar / search / Columns-options / CSV-options interactions
      behave identically to pre-task. Visual changes are limited to
      those listed under Concerns 1, 2, 4, 9, and 10.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the epic's deferred review model.

## Files Changed

| File                                                          | Lines (approx) | Notes                                  |
|---------------------------------------------------------------|----------------|----------------------------------------|
| `src/renderer/editors/grid/GridEditor.tsx`                    | ~30 changed    | Imports, styled defs, 3 portal bodies. |
| `src/renderer/editors/grid/components/CsvOptions.tsx`         | ~40 changed    | Imports, styled def, popup body.       |
| `src/renderer/editors/grid/components/ColumnsOptions.tsx`     | ~30 changed    | Imports, styled def, popup body.       |
| `doc/active-work.md`                                          | 1 line         | Status: placeholder → plan ready.      |

## Files Not Changed

See "Files NOT changed" table above.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Recent reference migrations: US-505 (Archive), US-506 (Category), US-507 (Explorer/Search), US-508 (Draw)
- Related: AVGrid Phase 5 adopt-in-place migration (separate, end-of-epic)
