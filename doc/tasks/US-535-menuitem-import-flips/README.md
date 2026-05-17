# US-535: `MenuItem` caller-import flips

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 —
small mechanical sweep that unblocks deletion of
`components/overlay/PopupMenu.tsx`. Deferred-review model: this task does
NOT run `/review`, `/document`, or `/userdoc` — those run at epic close.

## Goal

Flip every remaining caller that imports `MenuItem` from
`components/overlay/PopupMenu` over to UIKit `Menu` (or directly to the
canonical declaration). After this task, no file outside
`src/renderer/components/overlay/` imports `MenuItem` from that legacy
path, and `components/overlay/PopupMenu.tsx` has zero external callers.

## Background

### Why this is trivial

`MenuItem` is declared exactly once in the repo:

- `src/renderer/api/types/events.d.ts:12` — `export interface MenuItem`.

Both the legacy `components/overlay/PopupMenu.tsx` (line 18-19) and
`uikit/Menu/types.ts:1` re-export the **same** interface from that
canonical location. The two re-exports are shape-identical. The
migration is a pure import-path swap — no code shape changes anywhere.

This was originally deferred from
[US-531](../US-531-show-popup-menu-migration/README.md) (see its
Concerns section C) into the US-532 prep. Tracking it as its own task
gives it explicit visibility and keeps the eventual US-532 diff
focused on folder deletion only.

### Caller inventory

Callers that still import `MenuItem` from `components/overlay/PopupMenu`
(deep grep across `src/renderer/`):

| File | Imported symbol |
|---|---|
| `src/renderer/editors/browser/BrowserUrlBarModel.ts` | `MenuItem` (type only) |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | `MenuItem` (type only) |
| `src/renderer/editors/shared/link-open-menu.tsx` | `MenuItem` (type only) |

A full grep of the form
`from "[^"]*components/overlay/(PopupMenu|Popper|WithPopupMenu)"` may
surface additional stragglers — re-run before implementation and add
any new finds to the list.

Note: rest-client (`RestClientEditor.tsx`, `RequestBuilder.tsx`,
`ResponseViewer.tsx`) previously imported `MenuItem` from this path,
but US-501 already flipped them to `uikit` during that migration.
Verify zero rest-client matches before claiming the task done.

### Target import

```ts
import type { MenuItem } from "../../uikit";
// or, for editors that don't already pull from the uikit barrel:
import type { MenuItem } from "../../uikit/Menu";
```

Either form is acceptable. Prefer the barrel (`uikit`) form to match
the other migrated editors.

## Implementation plan (high-level)

1. For each file in the caller inventory, swap the import path. Keep
   the symbol name `MenuItem`. No other change in the file.
2. Re-run `grep -rE 'from "[^"]*components/overlay/(PopupMenu|WithPopupMenu)"' src/renderer`
   to catch any new caller that landed between this audit and
   implementation. Flip them too.
3. Verify `components/overlay/PopupMenu.tsx` and `WithPopupMenu.tsx`
   have no external callers left for `MenuItem` (Popper usage by
   `editors/grid/components/{Csv,Columns}Options.tsx` is out of scope —
   that's [US-509](../US-509-grid-editor-chrome-migration/README.md)).

## Concerns / open questions

None. This is a shape-identical type re-export swap.

## Acceptance criteria

- [ ] Repo-wide grep
      `from "[^"]*components/overlay/(PopupMenu|WithPopupMenu)"` returns
      zero matches outside `src/renderer/components/overlay/` itself.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] No behavioural change — `MenuItem` is a type, all changes are
      pure import-path swaps.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — overlay infrastructure cleanup
- Related: [US-531](../US-531-show-popup-menu-migration/README.md)
  (originally deferred this work)
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/overlay/PopupMenu.tsx` and `WithPopupMenu.tsx`
