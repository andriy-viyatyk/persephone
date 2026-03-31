# US-312: Source Link Persistence in IPageState

**Status:** Planned
**Epic:** EPIC-016 (Phase 0.1)
**Created:** 2026-03-31

## Goal

Store the original source link (raw string + all metadata) in `IPageState` so every page has a stable identity — what it is and how it was opened. This is persisted across app restarts and serves as foundation for EPIC-016's `secondaryEditorId` navigation identity.

## Background

### Current link pipeline flow

```
RawLinkEvent(raw, target?, metadata?)          ← user/script opens a link
    ↓
Layer 1 — Parsers (parsers.ts)
  - cURL parser: extracts method/headers/body → merges into metadata
  - HTTP parser: passes metadata through
  - Archive parser: passes metadata through
  - File parser: passes metadata through
    ↓
OpenLinkEvent(url, target?, metadata?)         ← normalized URL + accumulated metadata
    ↓
Layer 2 — Resolvers (resolvers.ts)
  - HTTP resolver: extracts method/headers/body from metadata → HttpProvider config
  - File resolver: creates FileProvider (+ ZipTransformer for archives)
    ↓
OpenContentEvent(pipe, target, metadata?)      ← assembled pipe + remaining metadata
    ↓
Layer 3 — Open Handler (open-handler.ts)
  - Consumes: pageId (routing), revealLine, highlightText
  - Calls: openFile(filePath, pipe) or navigatePageTo(pageId, filePath, options)
```

### What happens to metadata today

| Metadata field | Where consumed | Persisted? |
|---|---|---|
| `method`, `headers`, `body` | HTTP resolver → HttpProvider config | Yes (in pipe descriptor) |
| `pageId` | Open handler → routing decision | No (ephemeral) |
| `revealLine` | Open handler → TextFileModel._pendingRevealLine | No (ephemeral) |
| `highlightText` | Open handler → TextFileModel._pendingHighlightText | No (ephemeral) |
| Custom fields (e.g., future `secondaryEditorId`) | Not consumed | **Lost** |

**Problem:** After the open handler creates/navigates a page, all metadata is discarded. The page has no record of the link that opened it. Custom metadata fields (which EPIC-016 needs for `secondaryEditorId`) are lost entirely.

### Current IPageState (src/shared/types.ts:4-16)

```typescript
export interface IPageState {
    id: string,
    type: PageType,
    title: string,
    modified: boolean,
    language?: string,
    filePath?: string,
    pipe?: { provider: {...}; transformers: {...}[]; encoding?: string },
    editor?: PageEditor,
    hasNavigator?: boolean,
    pinned?: boolean,
}
```

No `sourceLink` field exists.

### Key code locations

| What | File | Lines |
|---|---|---|
| IPageState | `src/shared/types.ts` | 4-16 |
| ILinkMetadata | `src/renderer/api/types/io.events.d.ts` | 4-20 |
| RawLinkEvent | `src/renderer/api/events/events.ts` | 70-78 |
| OpenLinkEvent | `src/renderer/api/events/events.ts` | 81-88 |
| OpenContentEvent | `src/renderer/api/events/events.ts` | 92-100 |
| Parsers | `src/renderer/content/parsers.ts` | 18-80 |
| Resolvers | `src/renderer/content/resolvers.ts` | 47-200 |
| Open handler | `src/renderer/content/open-handler.ts` | 13-53 |
| openFile | `src/renderer/api/pages/PagesLifecycleModel.ts` | 244-261 |
| navigatePageTo | `src/renderer/api/pages/PagesLifecycleModel.ts` | 356-460 |
| getRestoreData | `src/renderer/editors/base/PageModel.ts` | 90-98 |
| applyRestoreData | `src/renderer/editors/base/PageModel.ts` | 105-125 |

## Implementation Plan

### Step 1: Add `sourceLink` to IPageState

**File:** `src/shared/types.ts`

Add a new optional field:

```typescript
export interface ISourceLink {
    /** The resolved URL (normalized by parsers — file path, http URL, archive path, etc.). */
    url: string;
    /** Target editor ID that was requested (if any). */
    target?: string;
    /** All accumulated metadata from the link pipeline. Ephemeral fields (pageId, revealLine, highlightText) are excluded. */
    metadata?: Record<string, unknown>;
}

export interface IPageState {
    // ... existing fields ...
    /** The link that opened this page — identity + metadata. Persisted across restarts. */
    sourceLink?: ISourceLink;
}
```

**Design notes:**
- Store the **resolved URL** (from `OpenLinkEvent`), not the raw string — the raw string may be a cURL command or other format that's hard to compare, while the URL is normalized and stable.
- Store a **cleaned metadata** object — exclude ephemeral fields (`pageId`, `revealLine`, `highlightText`) that are navigation-time hints, not page identity.
- `ISourceLink` is a plain object (no class) — trivially serializable to JSON for persistence.

### Step 2: Build sourceLink in the open handler

**File:** `src/renderer/content/open-handler.ts`

The open handler is where all 3 layers converge. It already has access to the final metadata. Add sourceLink construction here:

```typescript
// Before creating/navigating the page, build the sourceLink descriptor
function buildSourceLink(event: OpenContentEvent): ISourceLink | undefined {
    const url = event.pipe.provider.sourceUrl;
    // Include archive entry in the URL if present
    const zipTransformer = event.pipe.transformers.find((t) => t.type === "zip");
    let resolvedUrl = url;
    if (zipTransformer) {
        const entryPath = zipTransformer.config.entryPath as string | undefined;
        if (entryPath) resolvedUrl = buildArchivePath(url, entryPath);
    }

    // Clean metadata — remove ephemeral fields
    const metadata = event.metadata ? { ...event.metadata } : undefined;
    if (metadata) {
        delete metadata.pageId;
        delete metadata.revealLine;
        delete metadata.highlightText;
        // Remove empty metadata
        if (Object.keys(metadata).length === 0) return { url: resolvedUrl };
    }

    return {
        url: resolvedUrl,
        target: event.target !== "monaco" ? event.target : undefined,  // skip default
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
    };
}
```

Then pass `sourceLink` to the page creation methods.

### Step 3: Store sourceLink on the page model

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Modify `openFile` and `navigatePageTo` to accept and store sourceLink:

**Option A (preferred):** Pass sourceLink via a new options parameter on `openFile`:

```typescript
openFile = async (
    filePath?: string,
    pipe?: IContentPipe,
    options?: { sourceLink?: ISourceLink },
): Promise<PageModel | undefined> => {
    // ... existing logic ...
    const pageModel = await this.createPageFromFile(filePath, pipe);
    if (options?.sourceLink) {
        pageModel.state.update((s) => {
            s.sourceLink = options.sourceLink;
        });
    }
    this.addPage(pageModel);
    // ...
};
```

For `navigatePageTo`, add `sourceLink` to its options:

```typescript
navigatePageTo = async (
    pageId: string,
    newFilePath: string,
    options?: {
        revealLine?: number;
        highlightText?: string;
        forceTextEditor?: boolean;
        sourceLink?: ISourceLink;
    }
): Promise<boolean> => {
    // ... existing logic ...
    // After creating newModel, set sourceLink:
    if (options?.sourceLink) {
        newModel.state.update((s) => {
            s.sourceLink = options.sourceLink;
        });
    }
    // ...
};
```

### Step 4: Persist and restore sourceLink

**File:** `src/renderer/editors/base/PageModel.ts`

`getRestoreData()` already does `JSON.parse(JSON.stringify(this.state.get()))` — since `sourceLink` is a plain object in IPageState, it will be serialized automatically. No changes needed here.

`applyRestoreData()` needs to restore the field:

```typescript
applyRestoreData(data: Partial<T>): void {
    // ... existing logic ...
    this.state.update((s) => {
        // ... existing field assignments ...
        s.sourceLink = (data as any).sourceLink ?? undefined;
    });
}
```

### Step 5: Update the open handler to pass sourceLink through

**File:** `src/renderer/content/open-handler.ts`

Wire everything together:

```typescript
app.events.openContent.subscribe(async (event) => {
    let filePath = event.pipe.provider.sourceUrl;
    // ... existing archive path reconstruction ...

    const sourceLink = buildSourceLink(event);
    const metadata = event.metadata;
    const pageId = metadata?.pageId;

    if (pageId) {
        try {
            await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                revealLine: metadata?.revealLine,
                highlightText: metadata?.highlightText,
                sourceLink,
            });
        } finally {
            event.pipe.dispose();
        }
    } else {
        try {
            await pagesModel.lifecycle.openFile(filePath, event.pipe, { sourceLink });
        } catch (err) {
            event.pipe.dispose();
            throw err;
        }
    }

    event.handled = true;
});
```

### Step 6: Expose sourceLink in script API types

**File:** `src/renderer/api/types/io.events.d.ts`

Add `ISourceLink` type so scripts can read page identity:

```typescript
/** Describes the link that opened a page — identity + metadata. */
export interface ISourceLink {
    /** Resolved URL (file path, HTTP URL, archive path). */
    readonly url: string;
    /** Target editor that was requested. */
    readonly target?: string;
    /** Accumulated metadata from the link pipeline (excluding ephemeral fields). */
    readonly metadata?: Record<string, unknown>;
}
```

**File:** `assets/editor-types/page.d.ts` (or wherever page state is exposed to scripts)

Add readonly access to sourceLink on page state if needed for scripts.

## Files Changed Summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `ISourceLink` interface, add `sourceLink?` field to `IPageState` |
| `src/renderer/content/open-handler.ts` | Add `buildSourceLink()` helper, pass sourceLink to openFile/navigatePageTo |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add `sourceLink` to openFile options, add `sourceLink` to navigatePageTo options |
| `src/renderer/editors/base/PageModel.ts` | Restore `sourceLink` in `applyRestoreData()` |
| `src/renderer/api/types/io.events.d.ts` | Add `ISourceLink` type definition |

## Files NOT Changed

| File | Why |
|---|---|
| `src/renderer/content/parsers.ts` | Metadata already flows through correctly |
| `src/renderer/content/resolvers.ts` | Metadata already flows through correctly |
| `src/renderer/api/events/events.ts` | Event classes already carry metadata |
| `src/renderer/editors/base/PageModel.ts` `getRestoreData()` | Already serializes full state (sourceLink included automatically) |

## Concerns

### 1. Duplicate URL: filePath vs sourceLink.url

`IPageState` already has `filePath` which stores the page's file path or URL. `sourceLink.url` will often be the same value initially, but they diverge over time — e.g., a page opened from an HTTP URL and then saved to a local file will have `filePath` updated to the local path while `sourceLink.url` stays as the original HTTP URL. `sourceLink` is not functional for the page — it's informational metadata about the page's origin that can be used when needed (e.g., by secondary editors for identity matching).

### 2. Existing pages without sourceLink

Pages already open or restored from previous sessions won't have a `sourceLink`. This is fine — the field is optional. EPIC-016 code that reads `sourceLink` must handle `undefined`.

### 3. openFile deduplication check

`openFile` currently deduplicates by `filePath`:
```typescript
const existingPage = this.model.state.get().pages.find(
    (p) => p.state.get().filePath === filePath
);
```
If a page is already open with matching `filePath`, the new pipe is disposed and the existing page is shown. In this case, we should **not overwrite** the existing page's `sourceLink` — it already has one from when it was first opened. This matches the current behavior (page reuse, no state change).

### 4. HTTP metadata already in pipe

For HTTP pages, `method`, `headers`, `body` end up in both `sourceLink.metadata` AND `pipe.provider.config`. This is acceptable — they're read from different places for different purposes (identity vs I/O). The pipe descriptor is the authority for content restoration; sourceLink metadata is for identity and custom fields.

### 5. navigatePageTo creates new page model

When `navigatePageTo` is called, the old page model is disposed and a new one is created (line 394). The new model gets a fresh state. We set `sourceLink` on the new model after creation — this is correct because the sourceLink describes how this new page was opened.

## Acceptance Criteria

- [ ] `ISourceLink` interface defined in `src/shared/types.ts`
- [ ] `sourceLink` field added to `IPageState`
- [ ] Open handler builds sourceLink from OpenContentEvent metadata
- [ ] `openFile` stores sourceLink on new page models
- [ ] `navigatePageTo` stores sourceLink on navigated page models
- [ ] sourceLink persists across app restarts (verified by reopening app)
- [ ] Existing pages without sourceLink continue to work (field is optional)
- [ ] Script type definitions updated with `ISourceLink`
- [ ] cURL-opened pages have method/headers in sourceLink.metadata
- [ ] Pages opened with custom metadata (e.g., from scripts) retain that metadata in sourceLink
