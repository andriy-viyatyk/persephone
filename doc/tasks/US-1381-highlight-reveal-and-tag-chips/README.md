# US-1381 — `highlight` reveal for hover-gated controls; notebook tag chips

This is an investigation and implementation plan only. It does not implement the reveal,
change notebook rendering, run a test harness, update the dashboard, or commit.

## Goal

Make the existing `highlight` overlay able to point at the grid's row-filter button while it is
hidden by av-grid's hover-only CSS, without changing app state or leaving a reveal behind. Keep a
genuinely absent control as `found: false`.

The notebook half is implemented at the stable note-level tag area, not at individual chips. The
area container survives the chip rebuilds and answers the guide's actual "where are this note's
tags?" pointing question without pretending that one repeated chip is a stable target.

This task belongs to [EPIC-095](../../epics/EPIC-095.md), task US-1381. The dashboard entry already
exists in [`doc/active-work.md`](../../active-work.md); it must not be duplicated.

## Background

### Part A — current highlight path and verified DOM behavior

`assets/agent/ui-highlight.js` is the one dependency-free overlay used by the Persephone window,
board frames, and browser pages. Its `show()` method validates the CSS selector, calls
`document.querySelectorAll(selector)`, clears a prior item with the same id, and returns
`{ found: false, count: 0, selector }` when the selector has no matches. A match becomes one or
more ring targets (`all` is capped at 20), optionally gets a callout card, and is positioned by
`place()`.

The overlay treats a target as gone when it is disconnected or has no rectangle. A 500 ms poll,
scroll/resize listeners, and layout reflow therefore remove rings when the target disappears.
`Escape`, the card's **Close** button, `clear(id)`, and `clear()` all reach `removeAt()`, which
removes rings/cards; when the last item is gone it also removes listeners, the poll, and the
overlay host. The reveal cleanup must use this same `removeAt()` path.

`src/renderer/api/ui.ts:16-20,110-130` loads that asset once through `app-asset://agent`, passes
`{ ...options, selector, text }` to `show()`, and delegates `clearHighlights()` to the overlay.
`src/renderer/api/types/ui.d.ts:119-149` defines the public `IHighlightOptions` and result. The
public options currently contain only `text`, `title`, `all`, `scroll`, and `id`; there is no
reveal option today.

`src/renderer/scripting/ai-vision/elements.ts:14-22,64-75,99-145` resolves a declaration's
default `[data-name="..."]` or explicit `selector`, applies the page scope, runs the facade's
`beforeHighlight`, and passes the facade-wide `highlightOptions` to the bound UI method. Grid
already opts into `{ all: true }` at `GridEditorFacade.aiVision` (`GridEditorFacade.ts:122-144`).

The current grid declaration is deliberately state-sensitive:

```ts
// src/renderer/scripting/api-wrapper/GridEditorFacade.ts:32-36 (current)
{
    name: "grid-column-filter",
    purpose: "Open the row filter for one grid column.",
    where: "filter button at the right edge of each column header; appears when the header is hovered, the column is filtered, or its filter popup is open",
    selector: '.avg-filter-button.avg-column-filtered, .avg-filter-button.avg-filter-open, .avg-header-cell:hover .avg-filter-button',
},
```

The installed package's manifest exports `av-grid/av-grid.css`, and
`src/renderer/uikit/DataGrid/DataGrid.css:1-13` imports it into the `uikit` layer. The actual
rule in `node_modules/av-grid/dist/av-grid.css:161-182,1023-1027` is:

```css
.avg-grid .avg-filter-button {
    display: none;
}

.avg-grid .avg-header-cell:hover .avg-filter-button,
.avg-grid .avg-filter-button.avg-column-filtered {
    display: inline-flex;
}

.avg-grid .avg-filter-button.avg-filter-open {
    display: inline-flex;
}
```

There is no Persephone-side override for `.avg-filter-button` or `.avg-header-cell:hover`. The
button is mounted in the DOM and hidden by CSS; it is not conditionally created by the grid. A
synthetic `mouseover` or `mouseenter` dispatch cannot satisfy this rule: those are DOM events,
whereas `:hover` is the browser's real-pointer pseudo-class state. The workable approaches are
therefore a temporary class/stylesheet that mirrors the rule or temporary inline style.

### Part A — selected reveal design

Use temporary inline `display` styling on the declaration's explicitly named reveal candidates.
This is the smaller and safer mechanism for this one verified case: it does not add a global
stylesheet or a CSS hook to the app, works inside the existing overlay in every supported context,
and can restore the exact prior inline value. The implementation must never dispatch pointer
events, click, focus, open the popup, or otherwise mutate grid state.

The opt-in belongs semantically on the `IAiElementDeclaration`, not on public
`IHighlightOptions`: only a curated declaration has enough context to name a safe candidate
selector and its legitimate display value. This prevents an arbitrary script from force-showing
any matching selector and accidentally converting a broad selector into a false positive. The
resolved reveal request may travel through an internal renderer-only argument to
`highlightElement()` and the overlay, but it must not be added to the public script-facing
`IHighlightOptions` or `assets/editor-types/ui.d.ts`.

The grid declaration's planned addition is:

```ts
// after: declaration-level opt-in; current selector remains the reported selector
{
    name: "grid-column-filter",
    purpose: "Open the row filter for one grid column.",
    where: "filter button at the right edge of each column header; appears when the header is hovered, the column is filtered, or its filter popup is open",
    selector: '.avg-filter-button.avg-column-filtered, .avg-filter-button.avg-filter-open, .avg-header-cell:hover .avg-filter-button',
    reveal: { selector: ".avg-filter-button", display: "inline-flex" },
},
```

The reveal candidate is scoped with the same page selector as the declaration. The existing
state-sensitive selector remains the returned `selector` and is still checked first, so an
already-visible filtered/open/hovered button is not modified.

### Part B — contract and notebook lifecycle findings

`doc/architecture/ui-element-contract.md:7-70,214-223` defines `data-name` as an addressing
handle and deliberately does not enumerate exhaustive editor internals. The note-level tag area is
on the addressable side of that boundary: it is a visible note-card metadata control, not a
Monaco/Grid embedded-editor internal; the existing notebook facade exposes note-card controls from
`NoteItemView` (`note-delete`, `note-expand`) as repeated `elements`. EPIC-094 decision 9 is the
applicable rule for adding an entry to a drawn editor schema. The change adds no tag-area selector
to the shell contract's stable selector table.

`NoteItemView.tagsContainer` is a field initializer (`NoteItemView.ts:30`) and is appended once in
`buildStaticDom()` (`NoteItemView.ts:181-191`). `syncTags()` replaces only its children and
rebuilds the chip spans (`NoteItemView.ts:268-313`), so the container is stable for the life of
the retained note view even though individual chips are not. `note-delete` and `note-expand` are
not precedent for naming an unstable child: their `IconButtonView` children are constructed once
in `NoteItemView`'s constructor (`NoteItemView.ts:80-93`), whereas chips are rebuilt by `syncTags()`.

This is not React: `NoteItemView` is a `VanillaView`, and `NotebookBodyView` retains its cells with
`keepCellsAttached: true` (`NotebookBodyView.ts:108-146,287-299`). It is nevertheless unstable.
`NoteItemEditModel.changeContent()` calls `NotebookEditor.updateNoteContent()` for each editor
change (`note-editor/NoteItemEditModel.ts:219-229`). `NotebookEditor.replaceNote()` then calls
`publishNoteCollectionChange()`, which increments `notesVersion` and `filteredVersion`
(`NotebookEditor.ts:617-631,582-607`); `NotebookBodyView.handleState()` responds with
`grid.model.update({ all: true })` (`NotebookBodyView.ts:225-239`), and the retained note view is
updated, causing `syncTags()` to rebuild its chips. Thus a chip can be recreated per keystroke.

The guide already describes the interaction as the **tag area** (`assets/guides/editors/notebook.md`:
30-32, 104-110), and EPIC-094's gate asks where a note's tags are, not which individual tag to
edit. A ring around the stable area answers that question; `highlight` cannot edit or delete one
specific tag anyway. Individual-chip addressing is explicitly rejected: `syncTags()` rebuilds
those spans on every note update, including per-keystroke content changes, and the overlay drops a
ring whose target disconnects. No `data-name` is added to individual chips.

## Implementation Plan

### A. Implement declaration-scoped reveal in the existing overlay

1. Extend `IAiElementDeclaration` in `src/shared/ai-vision/types.ts` with an optional internal
   `reveal` object containing `selector` and `display`. Keep `IAiElement` unchanged: the agent sees
   the resolved normal selector, purpose, `where`, and visibility, not implementation styling.

2. In `src/renderer/scripting/ai-vision/elements.ts`, add selector resolution for the reveal
   candidate using the same `scopeSelector` and `scopeRootNames` rules as `resolvedSelector()`.
   Pass the resolved declaration reveal as an internal fourth request value to the bound
   `highlightElement`; merge it per declaration rather than mutating the facade-wide
   `highlightOptions`. Keep `{ all: true }` for the grid and notebook facades unchanged.

3. In `src/renderer/api/ui.ts`, define the renderer-only reveal request shape used between
   `UserInterface.highlightElement()` and `IHighlightApi.show()`. Keep the public method's
   `IHighlightOptions` parameter and the public `src/renderer/api/types/ui.d.ts` contract unchanged;
   the internal request is forwarded in the object spread to the asset.

4. In `assets/agent/ui-highlight.js`, make `show()`:

   - validate the normal selector, clear an existing item with the same id, and query the normal
     selector first;
   - only when the normal selector has no matches and a declaration supplied `reveal`, query the
     reveal selector; if it has no matches, return today's `{ found: false, count: 0, selector }`;
   - for each reveal candidate, save its exact inline `display` value and priority, set only the
     requested temporary display value, then check its rendered rectangle **after** that temporary
     style is applied. A candidate that still has no rectangle (for example, a button retained
     outside a virtualized viewport or a control on an inactive/unrendered page) is restored
     immediately and individually and is not added to the overlay item; only candidates that
     render are kept as targets;
   - treat those rendered candidates as the highlight targets and report their count. If none
     renders after the temporary style, restore all candidate styles immediately and return
     `found: false`;
   - store the saved style records on the overlay item. `removeAt()` must restore them before
     removing rings/cards, including when `place()` drops a disconnected target; `clear()`, Escape,
     Close, same-id replacement, and automatic target disappearance consequently all clean up;
   - retain the existing `all` cap, scroll behavior, ring/card creation, and result shape. No
     synthetic mouse event, click, focus, popup open, or app-state write is allowed.

   The key false-negative guard is the candidate query: reveal is possible only when a declaration
   opted in and its reveal selector actually matches a mounted element. A nonexistent selector
   never receives a style, never becomes a target, and still returns `found: false`.

5. Update the agent-facing description in `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`
   (`GRID_EDITOR_HELP`) and the grid guide's Agent API paragraph in
   `assets/guides/editors/grid.md` to say that `grid-column-filter` can temporarily reveal its
   hover-gated button for highlighting. Do not advertise a general-purpose reveal option on
   `app.ui.highlightElement()` because the public option is intentionally unchanged.

Before → after for the overlay's no-match branch:

```js
// before: assets/agent/ui-highlight.js:257-268
clear(id);
if (!matches.length) {
    return { id, found: false, count: 0, selector };
}

// after: query the opted-in reveal selector only after the normal selector is empty;
// no reveal candidate means the same result, while matched candidates receive reversible style.
clear(id);
if (!matches.length && opts.reveal) {
    matches = revealCandidates(opts.reveal); // saves/restores inline display per item
}
if (!matches.length) {
    return { id, found: false, count: 0, selector };
}
```

### B. Add the stable note-level tag-area handle

1. In `src/renderer/editors/notebook/NoteItemView.ts`, set
   `this.tagsContainer.dataset.name = "note-tags"` once beside the container's static style setup
   in `buildStaticDom()` (`NoteItemView.ts:181-190`). Do not set it in `syncTags()` and do not set
   any `data-name` on `createTagElement()`'s individual spans. The before → after change is:

```ts
// before: NoteItemView.buildStaticDom()
this.tagsContainer.style.flexShrink = "1";
const spacer = document.createElement("div");
this.firstToolbar.append(this.categoryHost, this.tagsContainer, spacer, this.dateText);

// after: the stable note-level target is named once, before its children are rebuilt
this.tagsContainer.style.flexShrink = "1";
this.tagsContainer.dataset.name = "note-tags";
const spacer = document.createElement("div");
this.firstToolbar.append(this.categoryHost, this.tagsContainer, spacer, this.dateText);
```

2. Add this repeated note-area declaration to `NOTEBOOK_ELEMENTS` in
   `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts`, next to the other mounted
   note-card controls. It describes the area-level action and does not claim to target one tag:

```ts
{
    name: "note-tags",
    purpose: "Add or edit a tag on the owning note; this control occurs once per mounted note, and visible means at least one instance is mounted.",
    where: "each card's tag area on its title row after the title",
},
```

Update `NOTEBOOK_EDITOR_HELP` in the same file to list `note-tags` and explain that the repeated
area is highlighted across mounted notes with `{ all: true }`, while individual chips remain
unaddressed.

3. In `assets/guides/editors/notebook.md`, make the layout margin phrase describe the area rather
   than a chip, and use that exact phrase in the facade declaration:

```md
<!-- before -->
| [Categories]  | [Note card: title  tags…       [Expand] [Delete]]   |  sidebar panels on the left; note cards fill the body to their
| [Tags]        | [Note card: title  tags…       [Expand] [Delete]]   |  right, each card's tag chips on its title row after the title

<!-- after -->
| [Categories]  | [Note card: title  tags…       [Expand] [Delete]]   |  sidebar panels on the left; note cards fill the body to their
| [Tags]        | [Note card: title  tags…       [Expand] [Delete]]   |  right, each card's tag area on its title row after the title
```

Add `Tag area → note-tags` to the mapping under the diagram. Keep the sidebar statement, but
disambiguate it as `Categories/Tags sidebar panel nodes → no entry: panel-owned content`; the
sidebar panels remain genuinely unaddressed. The prose at the existing “To tag a note” paragraphs
already describes the area and should remain consistent with the diagram.

4. Do not change `src/renderer/editors/notebook/ExpandedNoteView.ts`: the stable target and guide
   mapping are for the repeated note-card area owned by `NoteItemView`; the separate transient
   expanded overlay remains outside this addition.

## Concerns

- **Reveal cleanup is the primary correctness risk.** The saved inline display value must be tied
  to the overlay item, not global state, and restored on every removal path. Verify Escape, Close,
  `clearHighlights(id)`, `clearHighlights()`, same-id replacement, and target disappearance.
- **The normal selector must remain state-sensitive.** Replacing it with `.avg-filter-button` alone
  would make hidden controls count as ordinary matches and would undermine `elements.visible` and
  the absent-control guarantee. The declaration's reveal selector is a separate candidate query.
- **A user interaction must win.** If the button is already hovered, filtered, or open, the normal
  selector matches first and no temporary style is applied. The reveal path performs no pointer or
  focus operation; existing `scroll` behavior is retained as an overlay behavior only.
- **The av-grid stylesheet is third-party package output.** Do not edit
  `node_modules/av-grid/dist/av-grid.css` or mirror its rule in a second app stylesheet. Inline
  reveal is deliberately scoped to the overlay item and restored afterward.
- **Notebook chip identity is not the area identity.** Individual chips are vanilla rather than
  React, yet `replaceChildren()` plus all-cell updates on each content change recreates them. The
  stable `tagsContainer` is the correct area-level target; do not add a name to the ephemeral chip
  spans.
- **No unit tests or test harnesses are planned.** This project uses the running app and
  `script.execute`/agent facade checks for this behavior.

## Acceptance Criteria

### Part A

- With an active grid at rest, `page.editor.highlight("grid-column-filter", "...")` returns
  `{ found: true, count: N, highlighted: Math.min(N, 20) }` for the mounted column-filter buttons,
  even though their computed display was `none` immediately before the call. `N` is the number of
  mounted column-filter candidates in the active page.
- A filtered or open column filter is highlighted without applying a reveal style; no click,
  focus change, popup opening, or filter-state change occurs.
- A grid with no mounted filter candidates, and a selector that has no normal or opted-in reveal
   candidate, returns `{ found: false, count: 0 }` with no `highlighted` value and leaves the DOM
   unchanged.
- A reveal candidate that matches but still has no rectangle after its temporary `display` is
  applied is restored immediately, before target registration; it returns no false positive and
  leaves no inline `display` on that scrolled-out, inactive, or otherwise unrendered control.
- After Escape, the callout's Close button, `app.ui.clearHighlights(result.id)`,
  `app.ui.clearHighlights()`, same-id replacement, and automatic target removal, no reveal style,
  reveal class, temporary stylesheet, ring, card, or highlight host remains. An unhovered,
  unfiltered button is again computed as `display: none`.
- The implementation continues to use `assets/agent/ui-highlight.js` and its existing result
  shape; no second overlay or app-state interaction mechanism is introduced.

### Part B

- Every mounted `NoteItemView` exposes one stable `[data-name="note-tags"]` container, and no
  individual chip receives a `data-name`.
- `page.editor.highlight("note-tags", "...")` returns
  `{ found: true, count: N, highlighted: Math.min(N, 20) }` for `N` mounted note areas; its ring
  survives a note content update while the note view remains mounted because only the container's
  children are replaced.
- The notebook guide maps `Tag area → note-tags`, uses the exact same area phrase in its diagram
  margin and the declaration's `where`, and still says Categories/Tags sidebar panel nodes have no
  entry.

### Running-app verification snippets

Run these in `script.execute` with the relevant page visible. The first snippet is the required
addressable-element enumeration; the grid filter itself has no `data-name` because it belongs to
the published av-grid package.

```js
// Notebook: enumerate the stable areas and verify the repeated facade element.
const named = [...document.querySelectorAll("[data-name]")]
    .map((element) => [element.getAttribute("data-name"), element.offsetParent !== null]);
const areasBefore = [...document.querySelectorAll('[data-name="note-tags"]')];
const result = await page.editor.highlight("note-tags", "Note tags");
({
    tagAreas: named.filter(([name]) => name === "note-tags"),
    allNamed: named,
    areaCount: areasBefore.length,
    found: result.found,
    count: result.count,
    highlighted: result.highlighted,
});
// Expected with N mounted notes: areaCount === N and
// { found: N > 0, count: N, highlighted: Math.min(N, 20) }
```

```js
// Grid: inspect the actual package-owned candidates, then use the facade highlight.
const named = [...document.querySelectorAll("[data-name]")]
    .map((element) => [element.getAttribute("data-name"), element.offsetParent !== null]);
const filters = [...document.querySelectorAll(".avg-filter-button")]
    .map((element) => ({
        visibleBefore: element.getBoundingClientRect().width > 0,
        displayBefore: getComputedStyle(element).display,
    }));
const result = await page.editor.highlight("grid-column-filter", "Column filters");
({ named, filters, found: result.found, count: result.count, highlighted: result.highlighted });
// Expected with N mounted columns at rest:
// { found: true, count: N, highlighted: Math.min(N, 20) }
// Expected with no mounted candidates: { found: false, count: 0, highlighted: undefined }
```

```js
// Notebook: after editing note content while the same note remains mounted, the area node remains
// the same node even though its chip children were rebuilt.
const areaBefore = document.querySelector('[data-name="note-tags"]');
// Edit one note's content or title, wait for the retained row to repaint, then run:
const areaAfter = document.querySelector('[data-name="note-tags"]');
({ sameNode: areaBefore === areaAfter, chipNames: [...areaAfter.querySelectorAll("[data-name]")] });
// Expected: { sameNode: true, chipNames: [] }
```

After the grid call, dismiss through Escape and `app.ui.clearHighlights(result.id)`, then rerun
the filter inspection. The expected post-dismissal state is an empty
`[data-persephone-highlight]` host and the original inline/computed display values, with no
temporary reveal residue.

## Files Changed Summary

| File | Status in this plan | Change or reason for no change |
|---|---|---|
| `assets/agent/ui-highlight.js` | Change | Add declaration-driven, reversible inline-display reveal and cleanup on every existing dismissal/removal path. |
| `src/shared/ai-vision/types.ts` | Change | Add the internal optional reveal description to `IAiElementDeclaration`; keep `IAiElement` unchanged. |
| `src/renderer/scripting/ai-vision/elements.ts` | Change | Scope the reveal selector and pass the per-declaration request through the existing highlight path. |
| `src/renderer/api/ui.ts` | Change | Carry the renderer-only reveal request to the already-loaded overlay without widening public `IHighlightOptions`. |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Change | Opt `grid-column-filter` into reveal and document the behavior in its descriptor help. |
| `assets/guides/editors/grid.md` | Change | Clarify the named grid filter can be temporarily revealed for highlighting. |
| `src/renderer/editors/notebook/NoteItemView.ts` | Change | Add stable `data-name="note-tags"` once to `tagsContainer`; do not name individual rebuilt chips. |
| `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts` | Change | Publish the repeated `note-tags` area declaration and update its facade help. |
| `assets/guides/editors/notebook.md` | Change | Map the tag area, align the diagram margin and `where` phrase, and disambiguate sidebar no-entry content. |
| `src/renderer/api/types/ui.d.ts` | No change | Public `IHighlightOptions` remains unchanged; direct arbitrary reveal is not exposed. |
| `assets/editor-types/ui.d.ts` | No change | Generated mirror of the unchanged public UI type; never hand-edit it. |
| `src/renderer/uikit/DataGrid/DataGrid.css` | No change | It only imports av-grid CSS and owns host sizing; the package rule is verified, not overridden. |
| `node_modules/av-grid/dist/av-grid.css` | No change | Third-party generated CSS; its hover/filter/open rules are evidence only. |
| `src/renderer/editors/notebook/ExpandedNoteView.ts` | No change | The stable target and guide mapping are for the repeated note-card area owned by `NoteItemView`; the separate transient expanded overlay remains out of scope. |
| `doc/active-work.md` | No change | The existing EPIC-095 → US-1381 link is retained. |
