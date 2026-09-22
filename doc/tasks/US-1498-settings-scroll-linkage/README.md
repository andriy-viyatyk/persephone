# US-1498 — Scroll linkage: click-to-scroll and the scroll-spy

**Status:** Planned  ·  **Epic:** [EPIC-111](../../epics/EPIC-111.md)  ·  **Depends on:** [US-1497](../US-1497-settings-panels-tree/README.md)

## Goal

Connect the existing Settings Content tree to the `[data-name="settings-panels"]` stack in both
directions. Clicking a section scrolls its `.settings-section-wrapper` into view; clicking a group
expands it and scrolls to its first visible child per S12. Scrolling the stack selects the tree node
whose panel is topmost in the stack viewport, without moving the fixed Content pane or fighting a
programmatic navigation.

## Background

US-1497 has already supplied the two-pane structure and controlled tree selection. The current
`SettingsView` creates the tree at `SettingsView.ts:167-170`, mounts the fifteen catalog sections at
`SettingsView.ts:172`, and retains box-bearing wrapper elements in `sectionWrappers` at
`SettingsView.ts:105-109` and `SettingsView.ts:200-225`. The tree currently updates only the
controlled selection and expands groups in `handleContentChange` (`SettingsView.ts:241-247`); it does
not scroll the stack.

The scroll boundary is already owned by Settings. The stack is created with `overflowY: "auto"` at
[`SettingsView.ts:152-160`](../../../src/renderer/editors/settings/SettingsView.ts:152), and the
co-located CSS repeats that ownership at
[`settings.css:24-29`](../../../src/renderer/editors/settings/settings.css:24). The measured live
geometry remains the required baseline: `.page-editor-container` is 1011/1011 and does not scroll,
`[data-name="settings-panels"]` is 3551/903 and scrolls, and the Content pane is 903/903 and does
not scroll. The generic host remains `overflow-y: auto` in
[`Pages.css:2`](../../../src/renderer/ui/app/Pages.css:2), but the constrained Settings root and
inner stack make the stack the only Settings-owned scroller.

Every navigation and spy operation must target the wrapper, not the section root. The section root is
`display: contents` at
[`settings.css:155-157`](../../../src/renderer/editors/settings/settings.css:155), while the
`.settings-section-wrapper` is the box-bearing block at
[`settings.css:159-162`](../../../src/renderer/editors/settings/settings.css:159). The catalog
already provides stable section IDs and outer panel names in
[`settings-catalog.ts:8-18`](../../../src/renderer/editors/settings/settings-catalog.ts:8).

Tree selection and the active row are separate. `TreeView.syncActiveScroll()` scrolls the active row
at [`TreeView.ts:600-604`](../../../src/renderer/uikit/Tree/TreeView.ts:600), and `getName` is already
threaded through the existing row projection. The spy must therefore update only
`selectedContentValue` and repaint through `contentTree.update(...)`; it must not set `activeIndex`,
call an active-row API, or otherwise make the Content tree scroll. A direct tree click may set the
normal selection/active-row state through the existing Tree event, but the spy may not.

There is no current Settings producer of `hidden`: the only matching Settings rule is
`[data-type="settings-section"][hidden] { display: none; }` at
[`settings.css:164-166`](../../../src/renderer/editors/settings/settings.css:164), and the source
search found no `hidden` toggle in `src/renderer/editors/settings/**`. The implementation must still
define hidden-panel eligibility now so a future board panel cannot remain a selectable or spy target.

## Implementation Plan

### 1. Keep the existing catalog and wrapper/panel seams

Modify only `src/renderer/editors/settings/SettingsView.ts` for the linkage behavior. Continue using
`SETTINGS_CATALOG` and the existing `sectionWrappers` map; do not introduce a second ID list or change
the selectors/names established by US-1497. Retain the existing outer panel order, so document order
is the catalog order from `SETTINGS_CATALOG`.

Retain a reference to the mounted `[data-name="settings-panels"]` element and, if needed for
settling/visibility checks, the corresponding outer section-panel elements. Register all event and
observer cleanup with the view lifecycle and cancel any pending `requestAnimationFrame` settle check
in `onDispose()`.

### 2. Make navigable tree items reflect visible mounted panels

Replace the module-level assumption that `SETTINGS_CONTENT_ITEMS` is always selectable with a
SettingsView-owned list derived after `appendSectionPanel()` has mounted the wrappers. Preserve the
existing values (`group:<id>` and `section:<id>`), labels, group order, and `getName` output from
`getSettingsContentName()`.

Use one `isNavigableSection(sectionId)` predicate for tree construction, click validation, and spy
eligibility. A section is navigable only when its outer panel and wrapper are not hidden, and its
`[data-type="settings-section"]` root is not hidden. A zero-box target is also ineligible. This
handles the current CSS hidden rule on the section root as well as a future hidden outer panel.

If hidden state changes after mount, observe `hidden` attribute changes within the Settings panel
stack and rebuild the tree items. If the selected value is no longer present, select the first
remaining visible section; if no visible section remains, clear the selection and make the spy a
no-op. `handleContentChange` must reject a stale click whose target has become hidden between tree
render and event delivery. No current code produces this state, but the rule must be enforced at the
navigation boundary rather than left to geometry accidentally.

### 3. Add click-to-scroll with S12 group behavior

Extend `handleContentChange` in
`src/renderer/editors/settings/SettingsView.ts`:

1. For a section item, resolve its section ID and wrapper from the retained map.
2. For a group item, call the existing `tree.model.expandItem(item.value)`, then choose the first
   visible child in catalog/document order. A group has no panel of its own; this first child wrapper
   is its S12 scroll target.
3. Set the controlled selection to the clicked value and repaint the tree before scrolling. A group
   click therefore selects the group while it navigates to the first child; the navigation gesture is
   allowed to keep that selection after its own programmatic scroll. The next user-driven stack scroll
   runs the normal spy and selects the section actually owning the topmost visible panel.
4. Mark the navigation as programmatic, then call
   `targetWrapper.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" })`.
   The wrapper is the target; the stack is the only Settings-owned scroll container verified above.

Before → after handler shape:

```ts
// Before: SettingsView.ts:241-247
private readonly handleContentChange = (item: SettingsContentItem): void => {
    this.selectedContentValue = item.value;
    const tree = this.contentTree;
    if (!tree) return;
    tree.update(this.contentTreeProps());
    if (item.kind === "group") tree.model.expandItem(item.value);
};

// After: the implementation adds target resolution and guarded instant navigation.
private readonly handleContentChange = (item: SettingsContentItem): void => {
    const target = this.resolveNavigationTarget(item);
    if (!target) return;
    this.selectedContentValue = item.value;
    this.contentTree?.update(this.contentTreeProps());
    if (item.kind === "group") this.contentTree?.model.expandItem(item.value);
    this.beginProgrammaticScroll(item.value, target);
};
```

### 4. Suppress the spy until an instant programmatic scroll settles

Use instant scrolling deliberately. Smooth scrolling creates intermediate panels and makes the
selection flicker unless a reliable animation-end boundary is maintained; the requirement values
stable clicked selection over animated motion, and the stack contains only fifteen panels. An explicit
`behavior: "instant"` also avoids relying on a fixed timer or on optional `scrollend` support.

Use a pending navigation record containing the clicked selection value, target wrapper, last observed
`scrollTop`, and consecutive stable-frame count. The stack scroll handler must return without running
the spy while this record exists, then queue a `requestAnimationFrame` settle check. The check ends
suppression only when both conditions hold:

- the target is at the requested top alignment within a small geometry tolerance, or the stack is at
  its maximum scroll position and the target is the final visible panel that cannot reach the top; and
- the stack `scrollTop` is unchanged across two consecutive animation-frame samples.

This also handles a target that was already visible and caused no scroll: the same frame-based check
settles it without waiting on a timer. On settlement, cancel the pending record and re-assert the
clicked controlled selection without invoking the spy. A later user-generated scroll, with no pending
record, runs the spy normally. If the view is disposed, cancel the pending frame and remove the stack
listener so no late callback can repaint a disposed tree.

Do not use a timeout as the completion signal. Do not let `scrollend` be the only completion signal;
the geometry/stability check is deterministic for the chosen instant behavior and remains correct if
the browser emits no `scrollend` event.

### 5. Compute the topmost visible panel with a stack scroll handler

Use the stack's `scroll` event and `getBoundingClientRect()` rather than `IntersectionObserver`.
There are only fifteen static panels, and the handler can inspect them in catalog order on each scroll
without introducing an observer-maintained set. `IntersectionObserver` reports intersection changes,
not the topmost element; reproducing the required result would still require a maintained intersecting
set and document-order selection.

On each non-suppressed stack scroll:

1. Read the stack viewport rectangle.
2. Iterate the mounted section wrappers in `SETTINGS_CATALOG` order, skipping hidden/ineligible
   sections. A wrapper is visible when its rectangle intersects the stack viewport
   (`rect.bottom > viewport.top` and `rect.top < viewport.bottom`); the first intersecting wrapper in
   document order owns the topmost visible panel.
3. At the bottom boundary, if `scrollTop` is within a small tolerance of
   `scrollHeight - clientHeight`, choose the last eligible section even when its short panel cannot
   be aligned to the viewport top. This explicit rule ensures the last node is selected at the very
   bottom.
4. If a visible owner exists, update only `selectedContentValue` to `section:<id>` and call
   `contentTree.update(this.contentTreeProps())`. Do not update `activeIndex`, call
   `onActiveChange`, focus a row, or use any API that invokes `syncActiveScroll()`.

Before → after linkage shape:

```ts
// Before: the panel stack is mounted but has no scroll listener.
for (const section of SETTINGS_CATALOG) this.appendSectionPanel(section, panels);

// After: retain the stack, install one cleaned-up listener, and spy on wrapper boxes.
this.panelsElement = panels;
for (const section of SETTINGS_CATALOG) this.appendSectionPanel(section, panels);
this.panelsScrollCleanup = this.observePanelScroll(panels);
```

### 6. Preserve the fixed Content pane and existing styling contract

Do not change `src/renderer/editors/settings/settings.css`: its current layout already keeps the pane
fixed and the stack scrollable, and it contains no smooth-scroll rule. Do not add colors, row styling,
or selectors based on `data-name`. Do not change `Pages.css`, `PageContentView.ts`, `SettingsEditor.ts`,
the Tree primitive, or any section view. The only expected production-code change is the Settings
view's linkage state, event handling, visibility filtering, and lifecycle cleanup.

### 7. Verify manually against the measured geometry

After implementation, exercise the mounted Settings page and inspect the actual elements:

- `[data-name="page-editor"]` remains non-scrolling for Settings;
- `[data-name="settings-panels"]` is the element whose `scrollTop` changes;
- `[data-name="settings-content-pane"]` remains fixed;
- section navigation lands on wrappers, never on `display: contents` roots;
- a click does not flicker through intermediate selections, including a click near the bottom;
- manual scrolling selects the first document-order intersecting wrapper;
- reaching `scrollTop === scrollHeight - clientHeight` selects the final eligible section;
- hidden panels are absent from the tree and ignored by both click resolution and the spy.

No unit tests or test harnesses are to be added for this task.

## Concerns / Open Questions

No product decisions remain open. The implementation constraints are:

- **Programmatic-scroll race:** the suppression record must cover every scroll event caused by the
  click and must end through the two-frame geometry/stability check, not a guessed delay. The clicked
  selection is restored at settlement so the spy cannot overwrite it during navigation.
- **Group selection:** a group click selects the group while it navigates to the first visible child.
  The first subsequent user scroll selects the child section whose wrapper owns the topmost visible
  panel; this is the intentional distinction between navigation selection and scroll-spy selection.
- **Bottom alignment:** the last panel may be shorter than the viewport and cannot reach the top.
  Bottom-of-stack detection is mandatory and takes precedence over top-alignment assumptions.
- **Hidden state:** no current Settings source sets `hidden`, but the CSS rule already defines the
  hidden section-root behavior. Hidden outer panels, wrappers, and section roots must be filtered from
  the tree and spy, and stale click events must be ignored.
- **Tree movement:** selection repaint must not become active-row movement. The Content pane is fixed;
  only a direct user click may use the Tree's normal active-row behavior.
- **Scope:** no catalog redesign, board settings work, shared host CSS changes, hardcoded colors,
  tests, test harnesses, dashboard edits, epic edits, or commit belongs in US-1498.

## Acceptance Criteria

1. Clicking a visible section row selects it and scrolls its `.settings-section-wrapper` into the
   `[data-name="settings-panels"]` stack; the Content pane does not scroll.
2. Clicking a visible level-1 group expands it and scrolls to its first visible child wrapper, per
   EPIC-111 S12.
3. Programmatic navigation uses instant scrolling and suppresses the spy until the target reaches its
   clamped position and the stack has been stable for two animation-frame samples; no fixed timer or
   `scrollend`-only completion is used.
4. The clicked selection does not flicker through intermediate panels or get replaced by an
   intermediate spy result during programmatic navigation. Group clicks retain the group selection
   through their own navigation.
5. Manual scrolling selects the first eligible wrapper in catalog/document order whose box intersects
   the stack viewport, and updates selection only; the Tree active row and Content-pane scroll
   position are untouched by the spy.
6. At the exact bottom of the stack, the last eligible panel is selected even when its height is less
   than the viewport and it cannot align its top edge with the viewport top.
7. Hidden outer panels, wrappers, and section roots are neither tree nodes nor spy targets. A stale
   click for a hidden section is ignored. The current Settings source remains behaviorally unchanged
   because it produces no hidden panels today.
8. Existing stable catalog IDs, `data-name` values, panel order, section views, and the US-1497
   layout/scroll ownership remain intact.
9. No changes are made to `settings-catalog.ts`, `settings.css`, the Tree primitive, shared page-host
   files, section views, `doc/active-work.md`, or `doc/epics/EPIC-111.md`; no tests, test harnesses, or
   commit are added.

## Files Changed Summary

| File | Change |
|---|---|
| `src/renderer/editors/settings/SettingsView.ts` | Add wrapper-targeted click navigation, S12 group target resolution, instant-scroll suppression/settling, stack scroll-spy selection, hidden-panel filtering, and lifecycle cleanup. |
| `src/renderer/editors/settings/settings-catalog.ts` | No change; existing ordered IDs, group metadata, and panel names remain the source of document order. |
| `src/renderer/editors/settings/settings.css` | No change; existing stack overflow, wrapper box, `display: contents`, and hidden-root rules are sufficient. |
| `src/renderer/uikit/Tree/TreeView.ts` | No change; existing active-row scrolling is the reason the spy must update selection only. |
| `src/renderer/uikit/Tree/types.ts` and `src/renderer/uikit/Tree/TreeModel.ts` | No change; US-1497 already supplied the controlled-selection and row-addressability seams. |
| `src/renderer/editors/settings/sections/*.ts` | No changes; existing section views remain mounted content. |
| `src/renderer/ui/app/PageContentView.ts` and `src/renderer/ui/app/Pages.css` | No changes; the Settings-owned inner stack remains the local scroll boundary. |
| `doc/active-work.md` and `doc/epics/EPIC-111.md` | No changes, per task scope. |
| `doc/tasks/US-1498-settings-scroll-linkage/README.md` | New task document. |
| `assets/guides/**` and `qa/**` | No changes; no user-guide update, unit test, or test harness is in scope. |
