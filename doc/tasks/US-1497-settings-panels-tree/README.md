# US-1497 — Settings page: per-group panels and the Content tree

**Status:** Planned  ·  **Epic:** [EPIC-111](../../epics/EPIC-111.md)  ·  **Depends on:** none  ·  **Followed by:** US-1498 (scroll linkage)

## Goal

Restructure the existing Settings page into a height-constrained two-pane view: a fixed two-level
Content tree on the left and a vertically separated stack of one panel per existing settings
section on the right. Preserve every current section and its stable addressability, and update the
shared catalog and UI contract so the regrouping has one source of truth and is ready for later
board-contributed rows without implementing board settings or scroll linkage here.

## Background

The current page is assembled entirely by `SettingsView.onMount()` in
[`src/renderer/editors/settings/SettingsView.ts`](../../../src/renderer/editors/settings/SettingsView.ts):
the root is a centered column, the content panel is capped at `maxWidth: 560`, and the fifteen
sections are appended in a flat sequence with `DividerView` instances between them. The existing
`appendSection()` helper mounts each independent `VanillaView` inside a
`.settings-section-wrapper` carrying a stable `data-name="settings-section-<id>"`; the redesign
must retain those wrapper names and the `data-type="settings-section"` roots produced by
`createSectionRoot()`.

The current fifteen sections and their verified view classes are:

| Group | Existing sections, in the required Content/panel order | Existing `data-name` wrapper |
|---|---|---|
| General | Theme, Window Behavior, Clipboard, Terminal, File Search | `settings-section-theme`, `settings-section-window-behavior`, `settings-section-clipboard`, `settings-section-terminal`, `settings-section-file-search` |
| Editors | Editor Behavior, Script Library, Video Player, Drawing Library | `settings-section-editor`, `settings-section-script-library`, `settings-section-video-player`, `settings-section-drawing-library` |
| Browser | Browser Profiles, Default Browser, Links | `settings-section-browser-profiles`, `settings-section-default-browser`, `settings-section-link-behavior` |
| Integrations | MCP Server / Mneme, Git Integration, Board Environment Variables | `settings-section-mcp`, `settings-section-git-integration`, `settings-section-board-vars` |

The four groups and fifteen static sections come from EPIC-111’s “The fifteen sections, and where
they would go” table. The current task keeps the existing “Drawing Library” title and
`drawing-library` identifier; US-1502 owns the later Excalidraw board-setting migration. No board
rows or empty “Boards” group are created here. The page’s group/item model must remain open-ended
so US-1501 can add board rows under Editors or a non-empty Boards group according to S13 and
`getBoardEditorAssociation(manifest)`.

The two sections that do not render their own heading are deliberately handled in the current
`SettingsView`: it adds the “Links” heading/description before `LinkBehaviorSectionView` and the
“Default Browser” heading before `DefaultBrowserSectionView`. The refactor must keep those visible
inside their new section panels; it must not duplicate headings already rendered by the other
section views.

The page does not currently own scrolling. `PageContentView.syncContent()` creates the shared
`.page-editor-container` (`[data-name="page-editor"]`) with `overflow-y: auto`, and because
`SettingsEditor.showBackgroundOrnament` is true, that container is inside `.ornament-page-area`,
whose `overflow` is hidden in `src/renderer/ui/app/Pages.css`. `RenderEditorView` and
`AsyncEditorView` both use `display: contents`, so the Settings root is effectively a direct flex
child of the shared page container. The structural fix is therefore local to `SettingsView`: make
the root a full-width, flex-growing, `min-height: 0`, height-constrained child; make the Content
layout fill that root; and give only the right-hand panel stack `overflow-y: auto`, `min-height: 0`,
and flex growth. The host remains unchanged for other editors, while its scroll extent is reduced
to the constrained Settings root and the inner stack becomes the future US-1498 scroll boundary.

`src/renderer/uikit/Tree` already supplies the required controlled selection and two-level item
model. `TreeProps` supports `items`, nested `items`, `value`/`isSelected`, `onChange`, expansion
defaults, keyboard navigation, and `TreeView.model.expandItem()`. Its current default row renderer
supports a `name` prop internally, but `TreeView` does not pass a per-source row name, so a small
`getName(item, level)` prop must be threaded through the existing default item/section renderer.
That preserves the Tree’s established styling, keyboard behavior, virtualization, and row pooling
while making the UI-element contract addressable.

The third page model is the hand-written `SETTINGS_CATALOG` in
`src/renderer/scripting/ai-vision/namespaces/settings.ts`. It currently owns section order,
titles, descriptions, wrapper selectors, `where` text, and the 27 catalogued setting rows, and its
`help` text hardcodes “15 fixed-order sections and 27 catalogued setting rows”. The catalog is not
consumed outside this namespace today (`settings.sections` and generated `settings.elements` are
the relevant API surfaces), so the regrouping should move one exported, data-only catalog into the
Settings editor area. `SettingsView` and the AiVision namespace will both consume that export;
`SETTINGS_ELEMENTS` will continue to derive its rows from the same ordered list, while selectors
target the existing box-bearing section wrappers.

The UI contract in [`doc/architecture/ui-element-contract.md`](../../architecture/ui-element-contract.md)
currently describes a fixed-order single content panel and lists only the fifteen section
wrappers. It must describe the new layout, stack/tree roots, group and row names, outer panel
names, and the unchanged section-wrapper selectors. `doc/architecture/scripting.md` also repeats
the obsolete fixed-order/count wording and should be corrected as directly stale developer prose.

## Implementation Plan

### 1. Create one grouped static catalog for the page and AiVision

Add `src/renderer/editors/settings/settings-catalog.ts` as a data-only module. Export the catalog
types and one `SETTINGS_CATALOG` flat ordered list whose descriptors carry `groupId` and
`groupTitle`. The list is ordered by the four groups — `general`, `editors`, `browser`, and
`integrations` — and then by the section order in the table above. This keeps `settings.sections`
as a section catalog while making the hierarchy explicit; `SettingsView` derives the four group
nodes from this same list rather than maintaining a second hand-written grouping map. Each
descriptor retains the current section `id`, title, description, existing `elementName`, `where`,
and setting rows. Keep the existing 27 row keys, labels, purposes, and the five no-row error
entries unchanged.

The catalog’s section descriptor should also carry the stable outer panel name
`settings-panel-<section-id>`, while its existing `elementName` remains
`settings-section-<id>`. Use the group in generated `where` strings, for example
`Settings > General > Theme`, so the agent-facing model reflects the new hierarchy without
changing the selectors used by `settings.highlight()`.

The shape should be extensible rather than a closed union of the four current groups: future
board-contributed descriptors can use `groupId: "editors"`, and a future non-empty `boards` group
can be represented by descriptors with `groupId: "boards"`. The tree builder must omit a group
that has no descriptors. This task does not populate either with board data and does not consult a
board registry.

Before → after catalog ownership:

```ts
// Before: src/renderer/scripting/ai-vision/namespaces/settings.ts
const SETTINGS_CATALOG: readonly SettingsCatalogSection[] = [
    // fifteen flat section descriptors in render order
];

// After: src/renderer/editors/settings/settings-catalog.ts
export const SETTINGS_CATALOG: readonly SettingsCatalogSection[] = [
    { groupId: "general", groupTitle: "General", id: "theme", /* ... */ },
    // ...the remaining descriptors in group/section order...
];
```

### 2. Refactor `SettingsView` into the constrained two-pane layout

Change `src/renderer/editors/settings/SettingsView.ts` as follows:

1. Remove the `DividerView` import and stylesheet import, the old `maxWidth: 560` content-panel
   construction, and the `appendDivider()` helper. Keep `ButtonView`, the settings-file action,
   all fifteen section view imports, and the existing wrapper names.
2. Construct the `settings-root` Panel with `direction: "column"`, `align: "stretch"`,
   `flex: true`, `height: 0`, `minHeight: 0`, and `width: "100%"` plus the existing padding.
   This is the explicit height constraint that prevents the shared page host from becoming the
   Settings scroll surface.
3. Keep the `Settings` heading outside the scroll stack. Append a two-pane `settings-content`
   layout below it with `direction: "row"`, `flex: true`, `minHeight: 0`, `minWidth: 0`, and
   `width: "100%"`.
4. Add a fixed-width, non-growing left Content pane (`data-name="settings-content-pane"`; use the
   existing Panel geometry contract with an explicit basis such as `width: 220` and
   `shrink: false`) and mount a `TreeView<SettingsContentItem>` named
   `settings-content-tree` in it. The pane must be a sibling of the panel stack, not a descendant
   of the stack or the stack’s scroll element.
5. Add the right panel stack (`data-name="settings-panels"`) as a column Panel with
   `flex: true`, `minWidth: 0`, `minHeight: 0`, and `overflowY: "auto"`. Give it the vertical
   token-based gap used for panel separation. Do not add a `DividerView`; the gap is the separator.
6. Put one outer light, rounded Panel per catalog section in the exact group/section order. Name
   it `settings-panel-<id>` and place the existing `.settings-section-wrapper` with its unchanged
   `data-name="settings-section-<id>"` inside it. The panel must contain the existing Links and
   Default Browser intro nodes where those are currently emitted, so those two sections retain
   their current visible headings without changing the section view classes.
7. Append the existing “View Settings File” button in a small footer at the end of the panel
   stack, still named `settings-view-file`, so it remains reachable by scrolling the stack and is
   not mistaken for a settings section.
8. Build section panels from the shared catalog plus a static `id → section-view factory` map. Do
   not switch on group names in the rendering path. Store the mounted section wrapper elements in
   a section-id map for US-1498’s later scroll implementation; this task must not add
   `scrollIntoView`, `IntersectionObserver`, scroll listeners, or top-panel calculations.
9. Register the Tree and section views with `this.child()`, mount them exactly once after their
   roots are attached, and clear retained view/map references in `onDispose()`.

Before → after page assembly:

```ts
// Before: SettingsView.onMount(), current source
const content = createPanelElement({
    name: "settings-content",
    direction: "column",
    width: "100%",
    maxWidth: 560,
    padding: "xxxl",
    background: "light",
    rounded: "lg",
});
this.appendSection(new ThemeSectionView({}), content, "settings-section-theme");
this.appendDivider(content);
// ...fourteen more sections and dividers...
this.root.append(content);

// After: structural shape; exact section creation is catalog-driven.
const content = createPanelElement({
    name: "settings-content",
    direction: "row",
    flex: true,
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    gap: "xxl",
});
const treePane = createPanelElement({ name: "settings-content-pane", direction: "column", width: 220, shrink: false });
const panels = createPanelElement({ name: "settings-panels", direction: "column", flex: true, minWidth: 0, minHeight: 0, overflowY: "auto", gap: "xl" });
// mount the controlled Tree in treePane; append one named panel per catalog section to panels
content.append(treePane, panels);
this.root.append(title, content);
```

The root’s `height: 0` plus flex growth and `minHeight: 0` are intentional: the flex child fills
the shared `.page-editor-container` without contributing the full natural height of fifteen
sections to the host’s scrollbar. The only element with a potentially growing scroll extent is
`settings-panels`. Verify this relationship against the actual DOM: the page host may retain its
generic `overflow-y: auto` rule, but its `scrollHeight` must not be the Settings panel stack’s
natural height; the stack must be the element whose `scrollTop` changes.

### 3. Build the fixed two-level Content tree with controlled selection

Define a local `SettingsContentItem` shape in `SettingsView.ts` (or a small adjacent Settings
module if needed) with an explicit `kind: "group" | "section"`, stable `value`, display `label`,
and optional `items`. Derive the tree items directly from `SETTINGS_CATALOG`, grouping consecutive
descriptors by their catalog `groupId`/`groupTitle`:

- group values are namespaced, such as `group:general`;
- static section values are namespaced, such as `section:theme`;
- group children are the section items in catalog order;
- no third level is created;
- no `boards` node is emitted while it has no children.

Use `TreeView` with `defaultExpandAll: true`, `keyboardNav: true`, and the stable root name
`settings-content-tree`. Keep selection in `SettingsView` as a key, initially the first visible
section (`section:theme`). Supply `isSelected` to compare each item’s value to that key and use
`onChange` to update the key and repaint the Tree. This is controlled selection; do not let Tree
internal state, `activeIndex`, or a future scroll-spy own selection.

When `onChange` receives a group item, select that group and call the mounted Tree model’s
`expandItem()` so S12’s “group expands” half is represented now. Do not scroll from this handler;
US-1498 will add the first-child target and programmatic-scroll suppression. A section item only
updates the controlled selection in US-1497. The Tree’s chevron remains the native expansion
control, and its own active-row behavior must not be wired to the panel stack.

Pass a `getName` callback using these stable row names:

- group row: `settings-content-group-<group-id>`;
- section row: `settings-content-section-<section-id>`.

These names are addressing handles, not styling hooks. The panel stack and each outer panel use
`data-part` values for local layout styling so `data-name` remains a contract-only identifier.

### 4. Extend the existing Tree row contract for row addressability

Make the minimal reusable API change in `src/renderer/uikit/Tree/types.ts` and
`src/renderer/uikit/Tree/TreeView.ts`:

1. Add optional `getName?: (item: T, level: number) => string | undefined` to `TreeProps`, next
   to the existing row projection callbacks.
2. Pass `getName?.(row.source, row.level)` as `name` in both `itemProps()` and `sectionProps()`.
   `TreeItemProps` and `SectionItemProps` already accept `name` and already emit `data-name`.
3. Exclude `getName` from `restProps()` so it is not treated as a native DOM property.
4. Add `getName` to `src/renderer/uikit/Tree/TreeModel.ts`’s `repaintSignature()` and exclude it
   from `TreeView.restProps()` so recycled rows receive a new name when the callback or its
   projection changes. This matters because Tree is RenderGrid-backed and pooled row roots outlive
   the source item currently displayed in them.

Do not add a new Tree primitive, custom Content-row renderer, colors, or Tree-specific CSS. The
existing Tree CSS and default `TreeItemView` remain the visual implementation.

### 5. Move the catalog consumer and remove stale page modeling

Update `src/renderer/scripting/ai-vision/namespaces/settings.ts`:

- remove its local `SettingsCatalogRow`, `SettingsCatalogSection`, and local `SETTINGS_CATALOG`;
- import the exported catalog and its types from
  `src/renderer/editors/settings/settings-catalog.ts` using a direct relative import;
- derive `SETTINGS_ELEMENTS` from the catalog’s existing flat section list, preserving one element
  per existing setting row and the existing wrapper selector for `settings.highlight()`;
- return that catalog from `settings.sections`, and update the member summary to describe grouped
  section metadata rather than an ungrouped fixed-order list;
- replace the help sentence that hardcodes “15 fixed-order sections and 27 catalogued setting
  rows” with wording that describes the grouped catalog and its generated row elements without a
  brittle count. Preserve the guidance about `highlight`, five real settings without page rows,
  and the self-severing keys;
- leave `waitForSettingsSection()` targeting the existing
  `[data-name="settings-section-<id>"]` wrapper and leave `SETTINGS_NO_ROW_ERRORS` unchanged.

Update `doc/architecture/scripting.md`’s Settings paragraph to match the grouped catalog and stop
claiming that the descriptor is a fixed-order 15-section/27-row model. This is a direct correction
of the same stale contract, not a new scripting feature.

### 6. Add the structural styles without hardcoded colors

Update `src/renderer/editors/settings/settings.css` only for Settings-owned layout hooks:

- ensure the Settings root/layout can shrink to the host viewport (`min-height: 0`, full width,
  stretch behavior as needed by the Panel props);
- keep the left Content pane fixed beside the stack and prevent the stack’s overflow from moving
  the pane;
- use the panel-stack gap for vertical separation and preserve full-width section wrappers;
- add any required `[hidden]` counter-rule for a root whose stylesheet sets `display`, following
  the UIKit/app CSS rules;
- use only existing `var(--color-...)` values and spacing/gap/radius tokens. No hex, `rgb()`/`rgba()`,
  named colors, or styling selectors based on `data-name`.

Do not edit `src/renderer/ui/app/Pages.css` or `PageContentView.ts`: their verified generic host
behavior is the reason the Settings root must be constrained locally, and changing the shared host
would affect every editor.

### 7. Update the UI-element contract

Update the Settings section of `doc/architecture/ui-element-contract.md` from “fixed-order editor
with one content panel” to the grouped two-pane structure. Retain all existing section selector
rows exactly, and add these stable selectors:

- root/layout: `settings-root`, `settings-content`, `settings-content-pane`, `settings-panels`;
- Content tree root: `settings-content-tree`;
- group rows: `settings-content-group-general`, `settings-content-group-editors`,
  `settings-content-group-browser`, `settings-content-group-integrations`;
- section rows: `settings-content-section-<id>` for each of the fifteen static section IDs;
- outer panels: `settings-panel-<id>` for each of the fifteen static section IDs;
- the existing `settings-view-file` button.

Document that section selectors target the box-bearing `.settings-section-wrapper`, not the
`display: contents` section root, and that future board rows must use the same group/section naming
scheme without adding an empty Boards group. Document the inner panel stack as the future scroll
boundary while explicitly leaving click-to-scroll and scroll-spy behavior to US-1498.

## Concerns / Open Questions

No product decisions remain open for this task; S1–S14 and the revised EPIC-111 concerns are
settled. The implementation constraints to preserve are:

- **Host scroll ownership:** if the Settings root omits `height: 0`/`minHeight: 0` or the panel
  stack omits `minHeight: 0`, the shared page host can regain the natural-height scrollbar and the
  Content tree will move with it. Acceptance must inspect the actual scroll elements, not only the
  CSS declarations.
- **Virtualized row names:** `Tree` recycles row roots. A one-time DOM query or capture-phase click
  listener is not sufficient for `data-name`; the name must be part of the default row projection
  and repaint signature.
- **Selection versus active row:** `TreeView.syncActiveScroll()` scrolls the active row. The
  structural task must keep Content selection in `isSelected`/the controlled key and must not use
  active-row changes as a substitute. US-1498’s scroll-spy must update selection only.
- **Legacy section introductions:** Links and Default Browser currently receive their headings in
  `SettingsView`, while the other thirteen section views render headings internally. The panel
  factory must preserve that asymmetry exactly once.
- **Catalog API compatibility:** `settings.sections` remains a section list, now with explicit group
  metadata. The verified repository consumers are the Settings AiVision namespace and its generated
  element declarations; the implementation must update both together and preserve all row
  keys/selectors.
  User-facing guide wording is outside this planning-only change and can be refreshed by the
  completion documentation workflow if needed.
- **US-1498 boundary:** this task may retain wrapper maps and selected IDs as integration seams, but
  it must not implement `scrollIntoView`, smooth/instant scroll policy, scroll suppression timers,
  scroll listeners, IntersectionObserver logic, or topmost-visible calculations.
- **Future boards:** do not import board registries or add board settings now. The static Editors
  group must accept later children, and the eventual Boards group must be omitted when empty per
  S13.

## Acceptance Criteria

1. `SettingsView` no longer creates a centered `maxWidth: 560` single column or any
   `DividerView`; it renders the title, a fixed left Content pane, and a right panel stack with
   token-based vertical gaps.
2. The Settings root is full-width, flex-growing, height-constrained, and shrinkable; the right
   panel stack is the only Settings-owned vertical scroller. With the page mounted, the shared
   `[data-name="page-editor"]` does not grow to the stack’s natural height, while the panel stack
   can scroll independently and the Content pane remains in place.
3. The Content tree has exactly two levels and contains General, Editors, Browser, and
   Integrations, with the fifteen sections mapped exactly as specified in Background and in
   EPIC-111. There is no board row and no empty Boards group in this task.
4. Tree selection is controlled through the Settings view (`isSelected`/stable selected key and
   `onChange`). The initial selection is the first section; clicking a group selects it and expands
   it without scrolling the panel stack; clicking a section selects it without scrolling. No
   scroll-spy or click-to-scroll behavior is present.
5. Every static section remains mounted and reachable, keeps its existing
   `data-name="settings-section-<id>"` wrapper and `data-type="settings-section"` root, and is
   inside a distinct named outer `settings-panel-<id>` panel. Links and Default Browser retain
   their existing visible introductions.
6. Every Content group/section row has its specified `data-name`, including after Tree row
   recycling, and the Content tree root and panel stack have stable names from the updated UI
   contract.
7. The shared catalog is the sole static source used by `SettingsView` and the AiVision namespace.
   All existing row metadata and highlight selectors remain valid; `settings.sections` and its
   member/help descriptions expose the new group metadata without a brittle section/row count.
8. The UI-element contract and developer scripting description document the grouped layout, stable
   tree/panel names, unchanged section wrappers, and the future inner-scroll boundary.
9. No board registry, manifest settings, board store, Excalidraw migration, click-to-scroll,
   scroll-spy, unit test, test harness, `doc/active-work.md`, or commit is added or changed.

## Files Changed Summary

| File | Change |
|---|---|
| `src/renderer/editors/settings/settings-catalog.ts` | New exported grouped catalog and shared catalog types for the four static groups and fifteen existing sections. |
| `src/renderer/editors/settings/SettingsView.ts` | Replace the flat 560px/divider layout with constrained two-pane layout, named section panels, controlled Tree selection, group expansion support, and retained section wrapper map. |
| `src/renderer/editors/settings/settings.css` | Settings-owned flex/shrink/stack layout rules using existing tokens and theme custom properties. |
| `src/renderer/uikit/Tree/types.ts` | Add the optional per-source `getName` row projection to the existing Tree props. |
| `src/renderer/uikit/Tree/TreeView.ts` | Thread `getName` into default item/section rows and exclude it from DOM rest props. |
| `src/renderer/uikit/Tree/TreeModel.ts` | Include `getName` in the Tree repaint signature so pooled rows update their stable names. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Consume the shared catalog, preserve generated setting elements/selectors and rows, and remove stale flat-count help text. |
| `doc/architecture/ui-element-contract.md` | Document the two-pane Settings layout and all root, group-row, section-row, panel, and existing wrapper selectors. |
| `doc/architecture/scripting.md` | Replace stale fixed-order/count wording with the grouped catalog description. |
| `src/renderer/editors/settings/sections/*.ts` | No changes; existing section views remain the mounted content, including their current headers and settings behavior. |
| `src/renderer/ui/app/PageContentView.ts` | No changes; the generic host remains the shared page container, while Settings constrains itself locally. |
| `src/renderer/ui/app/Pages.css` | No changes; shared host overflow rules must not be altered for this editor-specific layout. |
| `src/renderer/editors/settings/SettingsEditor.ts` | No changes; its `showBackgroundOrnament` behavior is part of the verified host geometry. |
| `src/renderer/uikit/Tree/TreeItem.ts` and `src/renderer/uikit/Tree/SectionItem.ts` | No changes; both already accept and emit a `name`/`data-name` value. |
| `src/renderer/uikit/Tree/Tree.css` | No changes; the existing default Tree styling remains in use. |
| `doc/active-work.md` | No changes; the US-1497 dashboard entry already exists. |
| `doc/epics/EPIC-111.md` | No changes; S1–S14, concerns, and the linked-task scope are already settled there. |
| `assets/guides/**` and `qa/**` | No changes in this planning/implementation scope; no tests or harnesses are to be written. |
