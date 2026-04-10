# US-409: Update all pipeline callers to use createLinkData / linkToLinkData

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** To Do
**Depends on:** US-408 (done)

## Goal

Migrate all callers from `new RawLinkEvent(raw, target?, metadata?)` to `createLinkData(href, options?)` and remove the last adapter function from `events.ts`. After this task, no adapter functions remain and all link creation uses the canonical helpers from `src/shared/link-data.ts`.

## Background

### Current state after US-408

Only one adapter function remains in `src/renderer/api/events/events.ts`:

```typescript
export function RawLinkEvent(raw: string, target?: string, metadata?: ILinkMetadata): ILinkData {
    return { handled: false, href: raw, target, ...metadata };
}
```

### Migration target

```typescript
// src/shared/link-data.ts
export function createLinkData(
    href: string,
    options?: Partial<Omit<ILinkData, "href" | "handled">>,
): ILinkData {
    return { handled: false, href, ...options };
}
```

### Migration pattern

| Old | New |
|---|---|
| `new RawLinkEvent(path)` | `createLinkData(path)` |
| `new RawLinkEvent(href, "browser", { browserMode })` | `createLinkData(href, { target: "browser", browserMode })` |
| `new RawLinkEvent(url, undefined, { pageId, sourceId })` | `createLinkData(url, { pageId, sourceId })` |

The `target` parameter moves into the options object. When `target` is `undefined`, it's simply omitted.

## Implementation plan

### Caller inventory (18 files, ~30 call sites)

All call sites follow one of three patterns. Grouped by file below.

---

#### Group 1: Simple string — `RawLinkEvent(path)` → `createLinkData(path)`

**`src/renderer/ui/sidebar/RecentFileList.tsx`** (lines 39, 51)
Static import. Two calls: `new RawLinkEvent(item.filePath)`.

**`src/renderer/ui/sidebar/ScriptLibraryPanel.tsx`** (line 102)
Static import. One call: `new RawLinkEvent(item.href)`.

**`src/renderer/ui/sidebar/MenuBar.tsx`** (line 504)
Static import. One call: `new RawLinkEvent(item.href)`.

**`src/renderer/editors/settings/SettingsPage.tsx`** (line 1326)
Static import. One call: `new RawLinkEvent(filePath)`.

**`src/renderer/api/pages/PagesModel.ts`** (line 196)
Static import. One call: `new RawLinkEvent(filePath)`.

**`src/renderer/api/pages/PagesPersistenceModel.ts`** (line 147)
Static import. One call: `new RawLinkEvent(fileToOpen)`.

**`src/renderer/api/internal/RendererEventsService.ts`** (lines 37, 77, 86)
Static import. Three calls: `new RawLinkEvent(filePath)`, `new RawLinkEvent(url)`, `new RawLinkEvent(url)`.

**`src/renderer/content/tree-context-menus.tsx`** (line 80)
Static import. One call: `new RawLinkEvent(item.href)`.

**`src/renderer/api/pages/PagesLifecycleModel.ts`** (lines 389-390, 398-399, 672-673, 678-679)
Dynamic import ×4. Each: `const { RawLinkEvent } = await import(...)`.

---

#### Group 2: String + target — `RawLinkEvent(href, target)` → `createLinkData(href, { target })`

**`src/renderer/content/tree-context-menus.tsx`** (line 43)
`new RawLinkEvent(href, "rest-client")` → `createLinkData(href, { target: "rest-client" })`

**`src/renderer/editors/shared/link-open-menu.tsx`** (lines 25-27)
Dynamic import. `new RawLinkEvent(href, "browser", { browserMode })` → `createLinkData(href, { target: "browser", browserMode })`

---

#### Group 3: String + metadata — `RawLinkEvent(url, undefined, metadata)` → `createLinkData(url, metadata)`

**`src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx`** (lines 59-63)
`new RawLinkEvent(url, undefined, { pageId, sourceId: "explorer" })` → `createLinkData(url, { pageId, sourceId: "explorer" })`

**`src/renderer/editors/explorer/SearchSecondaryEditor.tsx`** (line 28)
`new RawLinkEvent(filePath, undefined, metadata)` where `metadata: ILinkMetadata = { pageId, revealLine?, highlightText? }`.
Change `metadata` type from `ILinkMetadata` to an inline object and pass to `createLinkData`.

**`src/renderer/editors/category/CategoryEditor.tsx`** (line 122)
`new RawLinkEvent(url, undefined, { pageId, sourceId: hostId })` → `createLinkData(url, { pageId, sourceId: hostId })`

**`src/renderer/editors/archive/ArchiveEditorView.tsx`** (lines 34-36)
`new RawLinkEvent(url, undefined, { pageId, sourceId: model.id })` → `createLinkData(url, { pageId, sourceId: model.id })`

**`src/renderer/editors/archive/ArchiveSecondaryEditor.tsx`** (lines 33-35)
`new RawLinkEvent(url, undefined, { pageId, sourceId: archiveModel.id })` → `createLinkData(url, { pageId, sourceId: archiveModel.id })`

**`src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx`** (lines 72-76)
```typescript
new RawLinkEvent(
    navUrl,
    item.target || undefined,
    pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined,
)
```
→
```typescript
createLinkData(navUrl, {
    target: item.target || undefined,
    ...(pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined),
})
```

**`src/renderer/editors/link-editor/LinkViewModel.ts`** (lines 749-763)
```typescript
const metadata: ILinkMetadata = {};
const data = { rawUrl: url, target: link.target || undefined, metadata };
this.onLinkOpen?.(data);
await app.events.openRawLink.sendAsync(
    new RawLinkEvent(data.rawUrl, data.target, data.metadata),
);
```
This is the most complex caller — it builds a mutable `data` object and lets the owner modify it via `onLinkOpen` callback before dispatch. The `metadata` object uses `ILinkMetadata` with its `[key: string]: unknown` index signature, which lets `onLinkOpen` add arbitrary fields.

Migration: Replace `data` structure with an `ILinkData` object directly:
```typescript
const linkData = createLinkData(url, { target: link.target || undefined });
// Let owner (e.g., Browser) modify linkData before pipeline dispatch
this.onLinkOpen?.(linkData);
await app.events.openRawLink.sendAsync(linkData);
```
This changes the `onLinkOpen` callback signature from `(data: { rawUrl, target, metadata }) => void` to `(data: ILinkData) => void`. Check `onLinkOpen` callers.

---

### Step 1: Migrate all static-import callers

For each file with `import { RawLinkEvent } from "..."`:
1. Replace import with `import { createLinkData } from "../../shared/link-data"` (adjust relative path)
2. Replace `new RawLinkEvent(...)` calls per patterns above
3. Remove `RawLinkEvent` from import (if also importing `ContextMenuEvent`, keep that)

Files: `RecentFileList.tsx`, `ScriptLibraryPanel.tsx`, `MenuBar.tsx`, `SettingsPage.tsx`, `PagesModel.ts`, `PagesPersistenceModel.ts`, `RendererEventsService.ts`, `tree-context-menus.tsx`, `ExplorerSecondaryEditor.tsx`, `SearchSecondaryEditor.tsx`, `CategoryEditor.tsx`, `ArchiveEditorView.tsx`, `ArchiveSecondaryEditor.tsx`, `LinkCategoryPanel.tsx`

### Step 2: Convert dynamic imports to static imports

The callers that used `const { RawLinkEvent } = await import("../events/events")` were lazy-loading a core utility unnecessarily. `createLinkData` is a tiny pure function in `src/shared/link-data.ts` with no heavy dependencies — use a static import instead.

For each dynamic import site, add a static `import { createLinkData } from "...shared/link-data"` at the top of the file and replace the `await import(...)` + usage.

Files: `PagesLifecycleModel.ts` (4 sites), `link-open-menu.tsx` (1 site), `LinkViewModel.ts` (1 site)

### Step 3: Refactor LinkViewModel.openLink

**File:** `src/renderer/editors/link-editor/LinkViewModel.ts`

This is the only complex migration. The `onLinkOpen` callback signature changes.

Before:
```typescript
openLink = async (link: ILink | { href: string; target?: string }) => {
    const url = link.href;
    if (!url) return;
    const metadata: ILinkMetadata = {};
    const data = { rawUrl: url, target: link.target || undefined, metadata };
    this.onLinkOpen?.(data);
    const { app } = await import("../../api/app");
    const { RawLinkEvent } = await import("../../api/events/events");
    await app.events.openRawLink.sendAsync(
        new RawLinkEvent(data.rawUrl, data.target, data.metadata),
    );
};
```

After (static import at top of file):
```typescript
openLink = async (link: ILink | { href: string; target?: string }) => {
    const url = link.href;
    if (!url) return;
    const linkData = createLinkData(url, { target: link.target || undefined });
    this.onLinkOpen?.(linkData);
    const { app } = await import("../../api/app");
    await app.events.openRawLink.sendAsync(linkData);
};
```

Check `onLinkOpen` type and callers — update the callback signature to accept `ILinkData`.

### Step 4: Remove ILinkMetadata usage from SearchSecondaryEditor

**File:** `src/renderer/editors/explorer/SearchSecondaryEditor.tsx`

Before:
```typescript
const metadata: ILinkMetadata = { pageId };
if (lineNumber) {
    metadata.revealLine = lineNumber;
    metadata.highlightText = model.searchState?.query;
}
app.events.openRawLink.sendAsync(new RawLinkEvent(filePath, undefined, metadata));
```

After:
```typescript
app.events.openRawLink.sendAsync(createLinkData(filePath, {
    pageId,
    ...(lineNumber ? { revealLine: lineNumber, highlightText: model.searchState?.query } : undefined),
}));
```

Remove `ILinkMetadata` import.

### Step 5: Remove RawLinkEvent adapter and cleanup events.ts

**File:** `src/renderer/api/events/events.ts`

Remove the entire adapter block (lines 67-85):
```typescript
// ── Link Pipeline Adapters (EPIC-023 transition) ─────────────────────
// ...
export function RawLinkEvent(...) { ... }
```

Also remove imports that become unused:
- `import type { ILinkData } from "../../../shared/link-data"` — check if still used
- `import type { ILinkMetadata } from "../types/io.events"` — only used by RawLinkEvent, remove

### Step 6: Verify

- `npm run lint` — no errors
- Grep for `RawLinkEvent` — zero matches in `.ts`/`.tsx` files
- Grep for `ILinkMetadata` in source files — check what remains (should only be in `io.events.d.ts` definition and its mirror)

## Concerns

### C1: LinkViewModel `onLinkOpen` callback signature change

**Resolved:** The `onLinkOpen` callback is set by `BrowserEditorModel` when the LinkEditor is hosted inside a browser tab. It modifies `data.target` and `data.metadata.browserMode`/`browserPageId`/`browserTabMode`. After migration, it receives `ILinkData` directly and sets `data.target`, `data.browserMode`, etc. — same fields, flat on the object. Need to update the `onLinkOpen` setter and the BrowserEditorModel caller.

### C2: `ILinkMetadata` removal scope

**Resolved:** US-409 removes `ILinkMetadata` usage from all source files. The `ILinkMetadata` interface definition remains in `io.events.d.ts` (script API) until US-410 removes it. After US-409, the only place `ILinkMetadata` exists is the type definition file — no source code imports it.

### C3: Dynamic vs static imports

**Resolved:** `createLinkData` is a tiny pure function in `src/shared/link-data.ts` — no reason to lazy-load it. All callers (including those that previously used `await import("../events/events")` for `RawLinkEvent`) should use a static `import { createLinkData } from "...shared/link-data"` instead.

## Acceptance criteria

- [ ] All `new RawLinkEvent(...)` calls replaced with `createLinkData(...)` (18 files, ~30 sites)
- [ ] `RawLinkEvent` adapter function removed from `events.ts`
- [ ] `ILinkMetadata` import removed from `events.ts`
- [ ] No source file imports `ILinkMetadata` (only the type definition in `io.events.d.ts`)
- [ ] `onLinkOpen` callback in LinkViewModel updated to accept `ILinkData`
- [ ] `npm run lint` passes with no errors
- [ ] Zero `RawLinkEvent` references in source files

## Files changed

| File | Action | Call sites |
|------|--------|-----------|
| `src/renderer/api/events/events.ts` | **Modify** | Remove `RawLinkEvent` adapter + imports |
| `src/renderer/api/internal/RendererEventsService.ts` | **Modify** | 3 calls |
| `src/renderer/api/pages/PagesModel.ts` | **Modify** | 1 call |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | **Modify** | 1 call |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | **Modify** | 4 dynamic imports + calls |
| `src/renderer/ui/sidebar/RecentFileList.tsx` | **Modify** | 2 calls |
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | **Modify** | 1 call |
| `src/renderer/ui/sidebar/MenuBar.tsx` | **Modify** | 1 call |
| `src/renderer/content/tree-context-menus.tsx` | **Modify** | 2 calls |
| `src/renderer/editors/settings/SettingsPage.tsx` | **Modify** | 1 call |
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | **Modify** | 1 call |
| `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` | **Modify** | 1 call |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | **Modify** | 1 call |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | **Modify** | 1 call + remove ILinkMetadata |
| `src/renderer/editors/category/CategoryEditor.tsx` | **Modify** | 1 call |
| `src/renderer/editors/shared/link-open-menu.tsx` | **Modify** | 1 dynamic import + call |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | **Modify** | Refactor openLink + onLinkOpen |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | **Modify** | 1 call |
