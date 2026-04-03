# US-333: Replace expandSecondaryPanel event with direct method

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 4)

## Goal

Replace the `expandSecondaryPanel` Subscription event with a direct `expandPanel(panelId)` method on PageModel. Secondary editors have a `page` reference and can call `this.page.expandPanel(panelId)` directly — simpler, more readable, no event indirection to trace.

## Background

The `expandSecondaryPanel` event was created before EPIC-017/019 simplified the architecture. It was needed because secondary editors didn't have a direct reference to their page container. Now every editor has `this.page: PageModel | null` (set via `setPage()`), so the indirection is unnecessary.

### Current flow (event-based)

```
ZipEditorModel.onMainEditorChanged()
  → setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0)
    → PageModel subscription checks secondaryEditors
      → this.setActivePanel(panelId)
      → this.secondaryEditorsVersion.update(...)
```

### Target flow (direct method)

```
ZipEditorModel.onMainEditorChanged()
  → setTimeout(() => this.page?.expandPanel("zip-tree"), 0)
    → PageModel.expandPanel() sets activePanel + bumps version
```

### All senders (3)

| File | Line | Call |
|------|------|------|
| [ZipEditorModel.ts:97](../../src/renderer/editors/zip/ZipEditorModel.ts) | `expandSecondaryPanel.send("zip-tree")` |
| [ExplorerEditorModel.ts:84](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) | `expandSecondaryPanel.send("search")` |
| [ExplorerEditorModel.ts:92](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) | `expandSecondaryPanel.send("explorer")` |

### Subscriber (1)

| File | Line | Handler |
|------|------|---------|
| [PageModel.ts:95-100](../../src/renderer/api/pages/PageModel.ts) | Checks panel exists in secondaryEditors, sets activePanel, bumps version |

### Event definition

| File | Line |
|------|------|
| [events.ts:60](../../src/renderer/core/state/events.ts) | `export const expandSecondaryPanel = new Subscription<string>();` |

## Implementation Plan

### Step 1: Add `expandPanel()` method to PageModel

**File:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts)

```typescript
/** Expand a secondary panel by its panel ID. Called by secondary editors directly. */
expandPanel(panelId: string): void {
    if (!panelId) return;
    if (!this.secondaryEditors.some((m) => m.secondaryEditor?.includes(panelId))) return;
    this.setActivePanel(panelId);
    this.secondaryEditorsVersion.update((s) => { s.version++; });
}
```

### Step 2: Remove expandSecondaryPanel subscription from PageModel constructor

**File:** [src/renderer/api/pages/PageModel.ts:95-100](../../src/renderer/api/pages/PageModel.ts)

Remove the subscription and the `_expandSub` field:

```typescript
// Remove these lines:
this._expandSub = expandSecondaryPanel.subscribe((panelId) => {
    if (panelId && this.secondaryEditors.some((m) => m.secondaryEditor?.includes(panelId))) {
        this.setActivePanel(panelId);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }
});

// Remove from dispose():
this._expandSub?.unsubscribe();
this._expandSub = undefined;

// Remove field:
private _expandSub: { unsubscribe: () => void } | undefined = undefined;

// Remove import:
import { expandSecondaryPanel } from "../../core/state/events";
```

### Step 3: Update ZipEditorModel

**File:** [src/renderer/editors/zip/ZipEditorModel.ts:97](../../src/renderer/editors/zip/ZipEditorModel.ts)

```typescript
// Before:
import { expandSecondaryPanel } from "../../core/state/events";
// ...
setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0);

// After:
// (remove import)
setTimeout(() => this.page?.expandPanel("zip-tree"), 0);
```

### Step 4: Update ExplorerEditorModel

**File:** [src/renderer/editors/explorer/ExplorerEditorModel.ts:84,92](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)

```typescript
// Before:
import { expandSecondaryPanel } from "../../core/state/events";
// ...
setTimeout(() => expandSecondaryPanel.send("search"), 0);
// ...
setTimeout(() => expandSecondaryPanel.send("explorer"), 0);

// After:
// (remove import)
setTimeout(() => this.page?.expandPanel("search"), 0);
// ...
setTimeout(() => this.page?.expandPanel("explorer"), 0);
```

### Step 5: Remove expandSecondaryPanel from events.ts

**File:** [src/renderer/core/state/events.ts:60](../../src/renderer/core/state/events.ts)

Remove the line:
```typescript
export const expandSecondaryPanel = new Subscription<string>();
```

## Acceptance Criteria

- [ ] `PageModel.expandPanel(panelId)` method exists
- [ ] ZipEditorModel calls `this.page?.expandPanel("zip-tree")` directly
- [ ] ExplorerEditorModel calls `this.page?.expandPanel(...)` directly
- [ ] `expandSecondaryPanel` Subscription removed from events.ts
- [ ] No subscription/unsubscribe in PageModel constructor/dispose
- [ ] Archive panel still auto-expands when navigating inside archive
- [ ] Search panel still expands when opened
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | Add `expandPanel()`, remove subscription + field + import |
| `src/renderer/editors/zip/ZipEditorModel.ts` | Replace event with `this.page?.expandPanel()` |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Replace event with `this.page?.expandPanel()` |
| `src/renderer/core/state/events.ts` | Remove `expandSecondaryPanel` export |
