# US-249: Rest Client — Requests Management

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Add collection grouping and improve request management in the Rest Client editor. Requests can be organized into named collections (one level deep). Name and collection are editable inline from the REQUEST header bar. Delete has a confirmation dialog. Drag-drop works across collections.

## Background

### Current state
- Requests are a flat list in the left panel TreeView
- `RestRequest` has no `collection` field — all requests are siblings under a single root
- **Rename exists** via right-click context menu → "Rename" → input dialog
- **Delete exists** via right-click context menu → "Delete" (no confirmation)
- **Duplicate exists** via right-click context menu → "Duplicate"
- Drag-drop reorders within the flat list (`moveRequest` swaps positions)
- The REQUEST panel header currently shows just the text "Request"

### Key files
- `src/renderer/editors/rest-client/restClientTypes.ts` — `RestRequest` interface
- `src/renderer/editors/rest-client/RestClientViewModel.ts` — CRUD methods, `moveRequest`
- `src/renderer/editors/rest-client/RestClientEditor.tsx` — TreeView setup, `SplitDetailPanel`, context menu
- `src/renderer/components/TreeView/` — TreeView component (supports nested `items: T[]`)
- `src/renderer/ui/dialogs/ConfirmationDialog.tsx` — `showConfirmationDialog()` for delete confirmation

### Collections are virtual
Collections are NOT a separate entity. They are derived from the `collection` field on each request. If all requests in a collection are deleted or moved, the collection disappears. The TreeView groups requests by `collection` value.

## Implementation Plan

### Step 1: Add `collection` field to data model

**File:** `src/renderer/editors/rest-client/restClientTypes.ts`

Add `collection` to `RestRequest`:
```typescript
export interface RestRequest {
    id: string;
    name: string;
    collection: string;    // NEW — empty string means ungrouped
    method: string;
    url: string;
    // ... rest unchanged
}
```

Update `createDefaultRequest()` to accept optional `collection` parameter:
```typescript
export function createDefaultRequest(name?: string, collection?: string): RestRequest {
    return {
        ...
        collection: collection || "",
        ...
    };
}
```

### Step 2: Update ViewModel

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

**loadData** — Add `collection` to request parsing with backward-compatible default:
```typescript
collection: r.collection || "",
```

**addRequest** — Accept optional `collection` parameter, pass to `createDefaultRequest`.

**moveRequest(fromId, toId)** — When moving to a different collection group:
- If `toId` is a collection node → set the request's `collection` to that collection name
- If `toId` is a request → set the request's `collection` to the target request's `collection`
- Reorder within the requests array (insert before or after the target)

**deleteRequest** — No changes needed (already works).

**renameRequest** — Already exists, no changes.

**updateRequestCollection(id, collection)** — New method to change a request's collection.

**deleteCollection(collectionName)** — New method: delete all requests with matching collection (with confirmation handled by the view).

### Step 3: Build tree with collection groups

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Update `RequestTreeItem` to support collection nodes:
```typescript
interface RequestTreeItem extends TreeItem {
    id: string;
    request?: RestRequest;
    isRoot?: boolean;
    isCollection?: boolean;
    collectionName?: string;
}
```

**Build grouped tree** from flat requests list:
1. Group requests by `collection` field
2. ALL requests go under a collection node — requests with empty/null/undefined `collection` go under a collection with `collectionName: ""`
3. Collection nodes with empty name display an italic *(empty)* label
4. Request nodes with empty name display an italic *(empty)* label
5. Preserve order: collections appear in the order their first request appears
6. Within a collection, requests keep their array order

```typescript
const rootItem: RequestTreeItem = {
    id: "__root__",
    isRoot: true,
    items: buildGroupedTree(state.data.requests),
};
```

**Collection node label** — show collection name with a folder-like appearance.

**Collection context menu** — right-click on collection node shows:
- "Add Request" — creates new request in this collection
- "Delete Collection" — delete all requests in collection (with confirmation)

### Step 4: Add inline name/collection editing to REQUEST header

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx` (in `SplitDetailPanel`)

Replace the static "Request" text in the panel header with editable fields:

```
[Collection / Name]                                    [🗑]
```

- **Collection input** — small TextAreaField or text input showing `request.collection`, editable. Placeholder "Collection (optional)". On blur or Enter → update via `vm.updateRequestCollection()`.
- **Separator** — "/" character between collection and name
- **Name input** — TextAreaField showing `request.name`, editable. Placeholder "Request name". On blur or Enter → update via `vm.renameRequest()`.
- **Delete button** — trash icon button aligned to the right edge. Calls delete with confirmation.

The header should still support double-click to toggle panel size (on areas that are not inputs).

### Step 5: Add confirmation dialog for delete

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Use `app.ui.confirm()` from the Object Model API (not direct dialog imports).

**Delete request** (from header button or context menu):
```typescript
const result = await app.ui.confirm(`Delete "${request.name}"?`);
if (result) vm.deleteRequest(request.id);
```

**Delete collection** (from collection context menu):
```typescript
const result = await app.ui.confirm(`Delete all requests in "${collectionName}"?`);
if (result) vm.deleteCollection(collectionName);
```

### Step 6: Drag-drop between collections

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Update `onDrop` handler:
- If dropping on a **request** → move to same position and adopt target's `collection`
- If dropping on a **collection node** → move to end of that collection, set `collection` to that name
- If dropping on **root** (ungrouped area) → set `collection` to `""` (ungrouped)

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

Update `moveRequest` to accept optional `newCollection`:
```typescript
moveRequest = (fromId: string, toId: string, newCollection?: string) => {
    // ... existing reorder logic
    // If newCollection provided, also update the moved request's collection
};
```

### Step 7: Update duplicate and paste

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Update duplicate handler to copy `collection`:
```typescript
vm.updateRequest(newReq.id, {
    ...
    collection: req.collection,    // preserve collection
});
```

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

Update `addRequest` to use the current selected request's collection as default for new requests (so "+ Add" creates in the same collection as the currently selected request).

## Concerns / Open Questions

All concerns resolved:

1. **Ungrouped requests** — All requests are always inside a collection node. Requests with empty/null/undefined `collection` go under an auto-generated collection shown with an italic *(empty)* label. Same *(empty)* italic label for requests with empty names. No validation needed — empty names and collections are allowed.
2. **No restrictions** on collection names — whatever the user wants.
3. **New request** inherits collection from currently selected request.
4. **Header layout** — single line: `[Collection / Name ... 🗑]`.

## Acceptance Criteria

- [ ] `RestRequest` has a `collection` field (backward compatible, defaults to "")
- [ ] Left panel TreeView groups all requests under collection nodes (one level: Collection → Requests)
- [ ] Requests with empty collection appear under a collection node with italic *(empty)* label
- [ ] Requests with empty name display with italic *(empty)* label
- [ ] REQUEST header shows editable collection and name fields
- [ ] REQUEST header has delete button (right-aligned)
- [ ] Delete request shows confirmation dialog
- [ ] Delete collection (via context menu) shows confirmation dialog and deletes all requests in it
- [ ] Drag-drop within collection reorders requests
- [ ] Drag-drop to another collection moves request and updates its collection
- [ ] Drag-drop to the *(empty)* collection sets request's collection to ""
- [ ] New request inherits collection from currently selected request
- [ ] Duplicate request preserves collection
- [ ] Empty collections disappear (no orphan collection nodes)
- [ ] Existing .rest.json files without collection field load correctly

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/restClientTypes.ts` | Add `collection` field to `RestRequest` |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | `updateRequestCollection`, `deleteCollection`, updated `moveRequest`, `addRequest` with collection |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Grouped tree building, collection context menu, inline name/collection editing, delete button with confirmation, drag-drop across collections |
| `src/renderer/editors/rest-client/parseClipboardRequest.ts` | No changes (collection is not in clipboard data) |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | No changes |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | No changes |
