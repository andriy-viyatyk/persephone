# US-542: Grid options popovers — `Popper` → UIKit `Popover` flip

## Status

**Implemented — awaiting user testing + epic-close review.** Part
of [EPIC-025](../../epics/EPIC-025.md) Phase 4 — overlay
infrastructure cleanup. **Unblocks** [US-532](../US-532-legacy-components-removal/README.md)
deletion of `components/overlay/`.

### Implementation summary

- `CsvOptions.tsx` — `Popper` import flipped to `Popover` from
  `../../../uikit/Popover`; JSX `<Popper>` → `<Popover>`. Props
  `elementRef`, `offset`, `open`, `onClose` carried over unchanged.
  `placement` adjusted from `"bottom-end"` to `"bottom-start"` so
  the popover opens to the right (top-left corner aligned with the
  anchor's bottom-left corner), matching the neighboring
  ColumnsOptions popover's placement — both toolbar buttons sit on
  the left side of the grid toolbar and now drop down consistently.
- `ColumnsOptions.tsx` — same flip; `resizable` and the
  `visiblePoppers()`-guarded `onClose` callback both preserved.
- Repo-wide grep `from "[^"]*components/overlay` — **zero**
  matches in `src/`.
- `npx tsc --noEmit` — 20 errors, all pre-existing in unrelated
  files (`automation/commands.ts`, `VideoPlayerEditor.tsx`,
  `WorkerRunner.ts`, `PageTab.tsx`); baseline unchanged.
- `npm run lint` (the 2 files) — 0 errors, 22 warnings; all
  pre-existing (`no-explicit-any`, `no-non-null-assertion`);
  baseline unchanged.

## Goal

Flip the two remaining `Popper` consumers in
`src/renderer/editors/grid/components/` to UIKit `Popover`. After
this task, `components/overlay/` is fully callerless and US-532 can
delete the folder.

This is a **2-file, import-swap-only** task. No logic, no styling,
no API surface changes.

## Background

### Why these two files were left behind

[US-509](../US-509-grid-editor-chrome-migration/README.md) (commit
`e506c81`) migrated the Grid editor's *chrome* (toolbar / header /
status bar) to UIKit. The popover sub-components inside
`src/renderer/editors/grid/components/` (`ColumnsOptions.tsx`,
`CsvOptions.tsx`) were not part of that chrome and were left on
the legacy `Popper`.

Subsequent overlay work — [US-531](../US-531-show-popup-menu-migration/README.md)
(showPopupMenu → UIKit Menu) and [US-535](../US-535-menuitem-import-flips/README.md)
(MenuItem caller flips) — addressed the `PopupMenu` half of
`components/overlay/`, but no task picked up these two `Popper`
consumers. They are the **only remaining callers** of
`components/overlay/` repo-wide (verified via grep on 2026-05-18).

### Why this is a 1:1 import swap

UIKit `Popover`'s prop surface is documented as "shape-identical to
legacy `PopperPosition` (minus `anchorType`)" (see
`uikit/Popover/PopoverModel.ts` doc comment on `PopoverPosition`).
The props used by these two files all exist on `Popover` with
identical names and types:

| Legacy `Popper` prop | UIKit `Popover` prop | Notes |
|---|---|---|
| `elementRef` | `elementRef` | anchor element |
| `offset` | `offset` | `[skidding, distance]` |
| `placement` | `placement` | `"bottom-start"` / `"bottom-end"` etc. |
| `open` | `open` | boolean |
| `onClose` | `onClose` | close callback |
| `resizable` | `resizable` | `ColumnsOptions` only |

No behavioral difference; no callsite of `showPopper` /
`TPopperModel` changes (those are in `ui/dialogs/poppers/`, not
the overlay folder).

## Implementation Plan

### Step 1 — Flip `CsvOptions.tsx`

`src/renderer/editors/grid/components/CsvOptions.tsx`:

```diff
-import { Popper } from "../../../components/overlay/Popper";
+import { Popover } from "../../../uikit/Popover";
```

```diff
-        <Popper
+        <Popover
             elementRef={model.el}
             offset={defaultOffset}
             open
             onClose={model.close}
             placement="bottom-end"
         >
             …
-        </Popper>,
+        </Popover>,
```

### Step 2 — Flip `ColumnsOptions.tsx`

`src/renderer/editors/grid/components/ColumnsOptions.tsx`:

```diff
-import { Popper } from "../../../components/overlay/Popper";
+import { Popover } from "../../../uikit/Popover";
```

```diff
-        <Popper
+        <Popover
             key="avgrid-columns-options"
             elementRef={model.el}
             offset={defaultOffset}
             open
             onClose={() => {
                 if (visiblePoppers().length === 1 && !state.changed) {
                     model.close(undefined);
                 }
             }}
             placement="bottom-start"
             resizable
         >
             …
-        </Popper>,
+        </Popover>,
```

### Step 3 — Verify

- Grep `src/` for `from "[^"]*components/overlay` — MUST be empty.
- `npx tsc --noEmit` — no NEW errors vs baseline.
- `npm run lint` — no NEW warnings or errors vs baseline.
- Manual smoke:
  - Open a CSV in the Grid editor. Click the CSV-options chip on
    the toolbar. The CsvOptions popover opens at `bottom-end`,
    closes on outside-click / Escape.
  - In the same Grid editor, open the column-options popover (gear
    / "Edit Columns" affordance). Verify it opens at
    `bottom-start`, is `resizable`, and the resize handle works.
    Confirm Apply / Cancel buttons still work as expected.

## Concerns

### A. Different `onClose` semantics between Popper and Popover

`ColumnsOptions` passes a conditional `onClose` that only closes
when no other poppers are visible AND state is unchanged. UIKit
`Popover`'s `onClose` is documented as "Called on click-outside or
Escape" — same trigger surface as legacy `Popper.onClose`.

**Resolution:** No change. The conditional logic lives inside the
callback body, not in `Popover`'s trigger mechanism. The flip is
safe.

### B. `visiblePoppers()` / `showPopper` / `TPopperModel` references

`ColumnsOptions.tsx` uses `visiblePoppers()` and both files use
`showPopper` + `TPopperModel` from
`src/renderer/ui/dialogs/poppers/`. These are NOT part of
`components/overlay/` — they are the application-level popper
registry built on top.

**Resolution:** No change. These imports stay as-is. The flip only
swaps the JSX `<Popper>` for `<Popover>`, not the dispatch
machinery.

### C. Visual regressions

UIKit `Popover` has its own styled `Root` with border, radius,
shadow, and a default `backgroundColor`. Legacy `Popper` may have
been styled differently or relied on the inner `Panel` for its
visible chrome.

**Resolution:** Verified by smoke test (Step 3). If a visual
regression appears (e.g. doubled border because the inner `Panel`
also paints one), fix inline by adjusting the inner `Panel` props,
NOT by re-styling `Popover`. UIKit `Popover` is the canonical
look and other migrated screens already match it.

## Acceptance criteria

- [ ] `src/renderer/editors/grid/components/CsvOptions.tsx` imports
      `Popover` from `../../../uikit/Popover` (not `Popper` from
      `components/overlay/`).
- [ ] `src/renderer/editors/grid/components/ColumnsOptions.tsx`
      imports `Popover` from `../../../uikit/Popover` (not `Popper`
      from `components/overlay/`).
- [ ] Both JSX usages render `<Popover>` (not `<Popper>`).
- [ ] Repo-wide grep `from "[^"]*components/overlay` returns zero
      matches.
- [ ] `npx tsc --noEmit` — no NEW errors vs baseline.
- [ ] `npm run lint` — clean.
- [ ] Manual smoke (Step 3) passes — both popovers open at their
      expected placements, close on outside-click / Escape,
      ColumnsOptions resize handle works, Apply / Cancel still
      function.

## Files Changed

| Path | Change |
|---|---|
| `src/renderer/editors/grid/components/CsvOptions.tsx` | Replace `Popper` import + JSX with `Popover` |
| `src/renderer/editors/grid/components/ColumnsOptions.tsx` | Replace `Popper` import + JSX with `Popover` |

## Files NOT changed

- `src/renderer/components/overlay/` — deleted by US-532 after
  this task lands; not modified here.
- `src/renderer/ui/dialogs/poppers/` — application-level popper
  dispatch machinery (`showPopper`, `TPopperModel`, `Poppers`,
  `visiblePoppers`); unrelated to the `Popper` JSX component.
- `src/renderer/uikit/Popover/` — destination primitive; already
  in place and used by ~20 other consumers.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — overlay infrastructure cleanup
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  — deletion of `components/overlay/`
- Related: [US-509](../US-509-grid-editor-chrome-migration/README.md)
  (Grid chrome migration; deliberately scoped to chrome, left these
  popovers behind), [US-531](../US-531-show-popup-menu-migration/README.md),
  [US-535](../US-535-menuitem-import-flips/README.md)
