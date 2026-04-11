# EPIC-023: Unified ILinkData Pipeline

## Status

**Status:** Done
**Created:** 2026-04-10
**Completed:** 2026-04-11
**Priority:** High — must be completed before EPIC-022 (LinkEditor Embedded Scripts)

## Overview

Consolidate the link opening pipeline (`openRawLink → openLink → openContent`) to use a single `ILinkData` object that flows through all three layers. Each layer enriches the same object (adds resolved URL, pipe descriptor, target editor, etc.) instead of creating separate event instances. This eliminates data loss between layers (the original `ILink` fields survive the entire pipeline), simplifies event handling for scripts and handlers, and replaces the fragmented `ILinkMetadata` / `ISourceLink` types with one unified descriptor.

## Goals

- **Single data object through all layers** — one `ILinkData` flows from caller through parsers, resolvers, and open handler to the final page
- **Preserve original link data** — when opened from an ILink (LinkEditor, tree provider), all fields (title, category, tags, imgSrc) survive the entire pipeline
- **Consolidate event types** — replace `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` with one `ILinkData` type on all three channels
- **Move `handled` to ILinkData** — handlers and scripts can inspect and set `handled` directly on the link data
- **Replace ISourceLink** — the cleaned ILinkData stored on pages replaces the separate `ISourceLink` type
- **Absorb ILinkMetadata** — all metadata fields become first-class ILinkData fields
- **Serializable descriptor** — ILinkData is a plain object (no class instances); temporal references like `pipe` are stripped before persistence

## Architecture

### ILinkData Interface

The unified type that replaces `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent`, `ILinkMetadata`, and `ISourceLink`:

```typescript
// Canonical type: src/renderer/api/types/io.link-data.d.ts (auto-copied to assets/editor-types/ for IntelliSense)
// Helper functions: src/shared/link-data.ts (re-exports ILinkData + createLinkData, linkToLinkData, etc.)

/**
 * Unified link data — flows through the entire openRawLink → openLink → openContent pipeline.
 *
 * Created by the caller (from a raw path, URL, or ILink), enriched by each layer,
 * and stored on the page as the source link descriptor.
 */
export interface ILinkData {
    // ── Pipeline control ──────────────────────────────────────────
    /** Set to `true` to short-circuit the current channel's pipeline. */
    handled: boolean;

    // ── Core identity (always present) ────────────────────────────
    /** Raw link string — file path, URL, cURL command, etc. Set by caller. */
    href: string;
    /** Resolved URL after Layer 1 parsing (normalized path, extracted URL from cURL, etc.).
     *  If not set by a parser, defaults to `href`. */
    url?: string;

    // ── ILink-compatible fields (present when opened from an ILink) ──
    /** Unique identifier of the originating link item. */
    id?: string;
    /** Display title. */
    title?: string;
    /** Category path (using "/" separators). */
    category?: string;
    /** Metadata tags. */
    tags?: string[];
    /** Whether the originating item is a directory. */
    isDirectory?: boolean;
    /** Preview image URL. */
    imgSrc?: string;
    /** File size in bytes. */
    size?: number;
    /** Last modified time (ISO string). */
    mtime?: string;

    // ── Pipeline resolution (set by layers) ───────────────────────
    /** Target editor ID. Can be set by caller (from ILink.target), overridden by pipeline. */
    target?: string;
    /** Resolved pipe descriptor (set by Layer 2 resolvers). Persisted in page state. */
    pipeDescriptor?: IPipeDescriptor;
    /** Temporal pipe instance (set by Layer 2, consumed by Layer 3).
     *  NOT persisted — stripped before storage. */
    pipe?: IContentPipe;

    // ── Navigation hints ──────────────────────────────────────────
    /** Open in this specific page instead of a new tab. Ephemeral — not persisted. */
    pageId?: string;
    /** Scroll to this line after opening. Ephemeral — not persisted. */
    revealLine?: number;
    /** Highlight occurrences of this text after opening. Ephemeral — not persisted. */
    highlightText?: string;

    // ── HTTP metadata (from cURL parser or callers) ───────────────
    /** HTTP headers. */
    headers?: Record<string, string>;
    /** HTTP method. */
    method?: string;
    /** HTTP body. */
    body?: string;

    // ── Browser routing ───────────────────────────────────────────
    /** Browser routing mode ("os-default" | "internal" | "incognito" | "profile:<name>"). */
    browserMode?: string;
    /** Route URL to a specific browser page (add/navigate tab). Ephemeral. */
    browserPageId?: string;
    /** How to open in the target browser page ("navigate" | "addTab"). */
    browserTabMode?: "navigate" | "addTab";

    // ── Content hints ─────────────────────────────────────────────
    /** Fallback editor target when URL has no recognized extension. */
    fallbackTarget?: string;

    // ── Source tracking ───────────────────────────────────────────
    /** ID of the source editor/model that initiated this link opening.
     *  Used by ArchiveEditorModel to track provenance. */
    sourceId?: string;
}
```

**Key design decisions:**
- `href` is always present (the raw input), `url` is set by Layer 1 (resolved form)
- `pipe` is typed as `any` in the interface to avoid importing `IContentPipe` in the type definition; at runtime it's an `IContentPipe` instance
- Fields marked "Ephemeral" are stripped before persistence (same set currently stripped in `buildSourceLink()`)
- No index signature (`[key: string]: unknown`) — all fields are explicitly defined for TypeScript safety
- `handled: boolean` replaces `BaseEvent.handled` — checked by `EventChannel.sendAsync()` after each handler

### Helper Functions

Located in `src/shared/link-data.ts`:

```typescript
/** Ephemeral fields stripped before persistence. */
const EPHEMERAL_FIELDS: (keyof ILinkData)[] = [
    "handled", "pipe", "pageId", "revealLine", "highlightText",
    "browserMode", "browserPageId", "browserTabMode", "fallbackTarget",
];

/** Create an ILinkData from a raw link string. */
export function createLinkData(href: string, options?: Partial<Omit<ILinkData, "href" | "handled">>): ILinkData {
    return { handled: false, href, ...options };
}

/** Convert an ILink to ILinkData (spread all fields, set handled=false). */
export function linkToLinkData(link: ILink): ILinkData {
    return { handled: false, ...link };
}

/**
 * Extract an ILink from ILinkData (fills required defaults for missing fields).
 * Used when storing a link back into a .link.json collection.
 */
export function linkDataToLink(data: ILinkData): ILink {
    return {
        id: data.id,
        title: data.title ?? data.url ?? data.href,
        href: data.url ?? data.href,
        category: data.category ?? "",
        tags: data.tags ?? [],
        isDirectory: data.isDirectory ?? false,
        imgSrc: data.imgSrc,
        size: data.size,
        mtime: data.mtime,
        target: data.target,
    };
}

/** Strip ephemeral fields for persistence as sourceLink on pages. */
export function cleanForStorage(data: ILinkData): Partial<ILinkData> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (EPHEMERAL_FIELDS.includes(key as keyof ILinkData)) continue;
        if (value !== undefined) cleaned[key] = value;
    }
    return cleaned as Partial<ILinkData>;
}
```

### EventChannel Constraint Update

Change the generic constraint from class-based to interface-based:

```typescript
// Before:
export class EventChannel<TEvent extends BaseEvent> { ... }

// After:
export class EventChannel<TEvent extends { handled: boolean }> { ... }
```

`BaseEvent` class stays for `ContextMenuEvent` and `BookmarkEvent` (unchanged). `ILinkData` satisfies the `{ handled: boolean }` constraint directly without needing a class.

### Consolidated Event Channels

```typescript
// In AppEvents.ts — before:
readonly openRawLink = new EventChannel<RawLinkEvent>({ name: "openRawLink" });
readonly openLink = new EventChannel<OpenLinkEvent>({ name: "openLink" });
readonly openContent = new EventChannel<OpenContentEvent>({ name: "openContent" });

// After:
readonly openRawLink = new EventChannel<ILinkData>({ name: "openRawLink" });
readonly openLink = new EventChannel<ILinkData>({ name: "openLink" });
readonly openContent = new EventChannel<ILinkData>({ name: "openContent" });
```

Three channels remain (they represent different processing stages), but they all carry the same `ILinkData` type. The old `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` classes are removed.

### Pipeline Flow (After Refactor)

```
Caller creates ILinkData { href: "...", handled: false, ...spread ILink if available }
    │
    ▼
openRawLink channel (Layer 1 — Parsers)
    Parser enriches: data.url = resolvedUrl
    Parser resets: data.handled = false
    Parser forwards: await openLink.sendAsync(data)
    Parser marks: data.handled = true
    │
    ▼
openLink channel (Layer 2 — Resolvers)
    Resolver enriches: data.target, data.pipeDescriptor, data.pipe (temporal)
    Resolver resets: data.handled = false
    Resolver forwards: await openContent.sendAsync(data)
    Resolver marks: data.handled = true
    │
    ▼
openContent channel (Layer 3 — Open Handler)
    Handler consumes: data.pipe → page creation
    Handler stores: cleanForStorage(data) as page sourceLink
    Handler marks: data.handled = true
```

**`handled` reset pattern:** Each layer resets `handled = false` before forwarding to the next channel, then sets `handled = true` after the next channel returns. This ensures:
- The next channel's subscribers see `handled = false` (can process)
- The current channel sees `handled = true` after forwarding (short-circuits remaining handlers)

### Caller Migration Examples

**Simple file path (most common):**
```typescript
// Before:
await app.events.openRawLink.sendAsync(new RawLinkEvent(filePath));

// After:
await app.events.openRawLink.sendAsync(createLinkData(filePath));
```

**With target and metadata:**
```typescript
// Before:
await app.events.openRawLink.sendAsync(
    new RawLinkEvent(href, "browser", { browserMode }),
);

// After:
await app.events.openRawLink.sendAsync(
    createLinkData(href, { target: "browser", browserMode }),
);
```

**From ILink (LinkEditor, tree providers — the big win):**
```typescript
// Before (ILink data lost):
await app.events.openRawLink.sendAsync(
    new RawLinkEvent(link.href, link.target),
);

// After (all ILink fields preserved):
await app.events.openRawLink.sendAsync(
    linkToLinkData(link),
);
```

**With navigation metadata:**
```typescript
// Before:
await app.events.openRawLink.sendAsync(new RawLinkEvent(
    url, undefined, { pageId, sourceId: model.id },
));

// After:
await app.events.openRawLink.sendAsync(
    createLinkData(url, { pageId, sourceId: model.id }),
);
```

### ISourceLink Replacement

`ISourceLink` is replaced by the persisted (cleaned) `ILinkData`:

```typescript
// In shared/types.ts — before:
export interface IEditorState {
    sourceLink?: ISourceLink;
    // ...
}

// After:
export interface IEditorState {
    /** Cleaned ILinkData from the opening pipeline. Persisted across restarts. */
    sourceLink?: Partial<ILinkData>;
    // ...
}
```

The `ISourceLink` interface is removed. Consumers that read `sourceLink.url` now read `sourceLink.url ?? sourceLink.href`. The `buildSourceLink()` function in open-handler.ts is replaced by `cleanForStorage()`.

### Script API Updates

**IoNamespace changes:**
```typescript
// Before:
export function createIoNamespace() {
    return {
        RawLinkEvent,
        OpenLinkEvent,
        OpenContentEvent,
        // ...
    };
}

// After:
export function createIoNamespace() {
    return {
        createLinkData,
        linkToLinkData,
        // ...
    };
}
```

**Script usage (before):**
```javascript
await app.events.openRawLink.sendAsync(new io.RawLinkEvent("https://example.com"));
```

**Script usage (after):**
```javascript
await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com"));
// Or with full control:
await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com", {
    target: "browser",
    browserMode: "incognito",
}));
```

**Type definitions update:**
- `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent` removed from `io.events.d.ts`
- `ILinkData` added to `io.events.d.ts` (or new `io.link-data.d.ts`)
- `ILinkMetadata` removed (fields absorbed into `ILinkData`)
- Channel types in `events.d.ts` updated to `IEventChannel<ILinkData>`
- `IRawLinkEventConstructor`, `IOpenLinkEventConstructor`, `IOpenContentEventConstructor` removed from `io.d.ts`
- `createLinkData` and `linkToLinkData` factories added to `io.d.ts`

## Affected Files Summary

### Core type changes
| File | Change |
|------|--------|
| `src/renderer/api/types/io.link-data.d.ts` | **NEW** — Canonical ILinkData interface (auto-copied to `assets/editor-types/`) |
| `src/shared/link-data.ts` | **NEW** — Helper functions (createLinkData, linkToLinkData, etc.) + ILinkData re-export |
| `src/shared/types.ts` | Deprecate `ISourceLink` as alias for `Partial<ILinkData>`, update `IEditorState.sourceLink` type |
| `src/renderer/api/types/io.events.d.ts` | Remove `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`, `ISourceLink`; add import of ILinkData |
| `src/renderer/api/types/events.d.ts` | Update `IAppEvents` channel types to `IEventChannel<ILinkData>` |
| `src/renderer/api/types/io.d.ts` | Replace event constructors with `createLinkData`/`linkToLinkData` factories |
| `assets/editor-types/io.link-data.d.ts` | **NEW** — Copy of script-visible type |
| `assets/editor-types/io.events.d.ts` | Mirror changes from `src/renderer/api/types/io.events.d.ts` |
| `assets/editor-types/events.d.ts` | Mirror changes from `src/renderer/api/types/events.d.ts` |
| `assets/editor-types/io.d.ts` | Mirror changes from `src/renderer/api/types/io.d.ts` |

### EventChannel and events
| File | Change |
|------|--------|
| `src/renderer/api/events/EventChannel.ts` | Loosen constraint: `TEvent extends BaseEvent` → `TEvent extends { handled: boolean }` |
| `src/renderer/api/events/events.ts` | Remove `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` classes |
| `src/renderer/api/events/AppEvents.ts` | Change channel types to `EventChannel<ILinkData>` |

### Pipeline (parsers, resolvers, handler)
| File | Change |
|------|--------|
| `src/renderer/content/parsers.ts` | All parsers: enrich `data.url` on ILinkData, forward same object |
| `src/renderer/content/resolvers.ts` | Both resolvers: set `data.pipeDescriptor`, `data.pipe`, `data.target` |
| `src/renderer/content/open-handler.ts` | Consume `data.pipe`, store `cleanForStorage(data)` as sourceLink |
| `src/renderer/content/link-utils.ts` | No change expected (utility functions work on strings) |

### All pipeline callers (openRawLink.sendAsync)
| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/LinkViewModel.ts` | `openLink()`: use `linkToLinkData(link)` — preserves full ILink |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Use `createLinkData(navUrl, ...)` |
| `src/renderer/editors/shared/link-open-menu.tsx` | Use `createLinkData(href, { target, browserMode })` |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Use `createLinkData(url, { pageId, sourceId })` |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | Use `createLinkData(filePath, { pageId, ... })` |
| `src/renderer/editors/category/CategoryEditor.tsx` | Use `createLinkData(url, { pageId, sourceId })` |
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | Use `createLinkData(url, { pageId, sourceId })` |
| `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` | Use `createLinkData(url, { pageId, sourceId })` |
| `src/renderer/content/tree-context-menus.tsx` | Use `createLinkData(href, ...)` |
| `src/renderer/ui/sidebar/RecentFileList.tsx` | Use `createLinkData(filePath)` |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Use `createLinkData(url)` in open dialog handlers |
| `src/renderer/api/internal/RendererEventsService.ts` | Use `createLinkData(filePath)` in IPC handlers |

### Storage consumers (ISourceLink → ILinkData)
| File | Change |
|------|--------|
| `src/renderer/editors/base/EditorModel.ts` | Update sourceLink type in state, getRestoreData, applyRestoreData |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Update sourceLink passing in openFile/navigatePageTo |
| `src/renderer/editors/archive/ArchiveEditorModel.ts` | Read `sourceLink.sourceId` instead of `sourceLink.metadata.sourceId` |

### Script API
| File | Change |
|------|--------|
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Export `createLinkData`, `linkToLinkData` instead of event constructors |

### No changes expected
| File | Reason |
|------|--------|
| `src/renderer/api/events/BaseEvent.ts` | Stays — used by ContextMenuEvent, BookmarkEvent |
| `src/renderer/editors/link-editor/linkTypes.ts` | ILink/LinkItem unchanged — ILinkData is for the pipeline |
| `src/renderer/content/registry.ts` | Provider/transformer registry — no event types used |
| `src/renderer/content/ContentPipe.ts` | Pipe implementation — no event types used |
| `src/renderer/content/providers/*.ts` | Providers — no event types used |
| `src/renderer/components/tree-provider/*.tsx` | Uses ILink for display — no pipeline events |
| All link-editor UI files (LinkItemList, LinkItemTiles, PinnedLinksPanel, etc.) | Use ILink/LinkItem for display — opening goes through LinkViewModel.openLink() |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-404 | Define `ILinkData` interface and helper functions | Done |
| US-405 | Loosen EventChannel constraint and consolidate link pipeline events | Done |
| US-406 | Refactor Layer 1 parsers to use ILinkData | Done |
| US-407 | Refactor Layer 2 resolvers to use ILinkData | Done |
| US-408 | Refactor Layer 3 open handler and replace ISourceLink (remove deprecated alias) | Done |
| US-409 | Update all pipeline callers to use createLinkData / linkToLinkData | Done |
| US-410 | Update script API types, IoNamespace, and editor-types | Done |
| US-411 | Update architecture documentation | Done |

## Resolved Concerns

All concerns reviewed and decided on 2026-04-10:

| # | Concern | Decision |
|---|---------|----------|
| C1 | Large refactor scope | Accept — needed for cleaner architecture before EPIC-022. Break into 8 focused tasks. |
| C2 | Index signature `[key: string]: unknown` kills TypeScript safety | No index signature. All fields explicitly defined on ILinkData. Use `any` for `pipe` field to avoid importing complex types in the interface. |
| C3 | Event classes vs plain object | Consolidate to single ILinkData type (plain object with `handled: boolean`). Remove RawLinkEvent/OpenLinkEvent/OpenContentEvent classes. Keep 3 channels for architectural layers. |
| C4 | ILink required fields → optional in ILinkData | ILinkData has ILink-compatible fields as optional. Use `linkDataToLink()` helper to extract ILink with default fills when needed. |
| C5 | `target` field collision (ILink.target vs pipeline target) | Not a collision — desirable behavior. `target` has one meaning: the target editor. Any handler (parser, resolver, script) can override it. |
| C6 | `handled` flag on ILinkData vs BaseEvent | Move `handled` to ILinkData. Change EventChannel constraint to interface `{ handled: boolean }`. Each layer resets `handled = false` before forwarding to next channel, sets `true` after. |

## Notes

### 2026-04-10
- Epic created to simplify the link pipeline architecture before EPIC-022
- Core insight: currently ILink data is lost at the pipeline entry point (only `href` survives as `raw` string). With ILinkData, all original fields flow through all layers.
- `handled` reset pattern between layers is key: parser resets before forwarding to openLink, sets after return. Same for resolver → openContent.
- ILink interface stays unchanged — it's the display/storage type for tree items and link collections. ILinkData is the pipeline type. They share field names but serve different purposes.
- `ISourceLink` replacement: `cleanForStorage()` strips ephemeral fields. `ArchiveEditorModel` reads `sourceLink.sourceId` directly instead of `sourceLink.metadata.sourceId`.
- Script API: `io.RawLinkEvent` → `io.createLinkData()`. More discoverable and consistent.
- Breaking change for scripts: old `new io.RawLinkEvent(url)` stops working. Migration: `io.createLinkData(url)`. Document in what's-new.
