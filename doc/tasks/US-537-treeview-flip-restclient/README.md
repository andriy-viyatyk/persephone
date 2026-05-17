# US-537: RestClient `TreeView` → UIKit `Tree` flip

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 —
single-file cleanup that empties the legacy `components/TreeView/`
folder. Deferred-review model: this task does NOT run `/review`,
`/document`, or `/userdoc` — those run at epic close.

## Goal

Migrate the single remaining caller of legacy `components/TreeView/`
to UIKit `Tree`. After this task,
`src/renderer/components/TreeView/` has zero callers and can be
deleted by US-532.

## Background

### Single caller

`src/renderer/editors/rest-client/RestClientEditor.tsx:2`:

```ts
import { TreeView, TreeItem } from "../../components/TreeView";
```

This was carried forward through US-501 because the RestClient
collection tree is a non-trivial surface, and US-501 was already
large. US-501's README documents the deferral.

### Reference implementations

UIKit `Tree` is the destination. It is used by:

- `editors/notebook/NotebookEditor.tsx` (US-512) — outline tree
- `editors/link-editor/` (US-523) — link list / tag list
- `editors/category/CategoryEditor.tsx` (post-US-497) — category tree

Choose the reference closest to RestClient's interaction model
(probably the LinkEditor lists, since RestClient items have a similar
"folder + item" structure).

### `components/TreeView/` inventory

The legacy folder contains three files:

- `TreeView.tsx` — the React component
- `TreeView.model.ts` — model class (state + actions)
- `CategoryTree.tsx` — a different tree variant (no consumers
  outside `components/TreeView/`, verify)
- `index.ts` — barrel

None of `CategoryTree` / `TreeView.model` has external callers per
the audit. The full folder is deletable once RestClient flips.

## Implementation plan (high-level)

1. Read `RestClientEditor.tsx` to find every place `TreeView` and
   `TreeItem` are consumed.
2. Map the legacy `TreeView` model API (selection, expand state,
   item rendering) onto UIKit `Tree`'s props.
3. Replace the imports + JSX + any tree-specific state hooks.
4. Verify the collection tree still works: load a `.rest.json`
   collection, expand/collapse folders, click items, context menus,
   drag-and-drop (if applicable to the rest-client tree).
5. Confirm `grep -rE 'from "[^"]*components/TreeView' src/renderer`
   returns zero matches outside the folder itself.

## Concerns / open questions

### A. Drag-and-drop in RestClient tree

If the legacy `TreeView` supports drag-and-drop and the RestClient
tree uses it, the migration must rely on
[US-488](../US-488-uikit-tree-dnd/README.md) (UIKit Tree DnD via
traits). Verify before starting whether RestClient's tree is
drag-enabled today.

### B. Selection / context menu parity

UIKit Tree's selection and `getContextMenu` API differ from the
legacy `TreeView`. Audit how RestClient uses those before flipping
to avoid behaviour regression.

### C. CategoryTree.tsx — verify zero callers

`components/TreeView/CategoryTree.tsx` should have no external
callers per the audit. Re-verify with a fresh grep before US-532
deletes the folder; if a caller surfaces, file a follow-up.

## Acceptance criteria

- [ ] `src/renderer/editors/rest-client/RestClientEditor.tsx` has
      zero imports from `components/TreeView/`.
- [ ] Repo-wide grep `from "[^"]*components/TreeView` returns zero
      matches outside `src/renderer/components/TreeView/` itself.
- [ ] RestClient tree behaviour preserved: expand/collapse,
      selection, item click, item add/remove, context menu.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.

## Test surface (manual smoke)

- Open a `.rest.json` file: collection tree renders in left panel.
- Click a request: opens in editor.
- Add a new folder / request via the toolbar `+`: tree updates.
- Context menu on a tree item: rename / duplicate / delete actions.
- Expand / collapse a folder: chevron toggles, persistence on
  reload.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration cleanup
- Depends on: [US-485](../US-485-uikit-tree/README.md) (UIKit Tree)
- Related: [US-501](../US-501-rest-client-migration/README.md)
  deferred this caller flip
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/TreeView/`
