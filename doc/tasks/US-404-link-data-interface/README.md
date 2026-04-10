# US-404: Define ILinkData Interface and Helper Functions

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** Planned

## Goal

Create the `ILinkData` interface — the unified link descriptor that will flow through the entire `openRawLink → openLink → openContent` pipeline — and provide helper functions for creating, converting, and cleaning ILinkData objects. This is the foundation task; all other EPIC-023 tasks depend on it.

## Background

### Current State

The link pipeline uses three separate event classes (`RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent`) with different shapes. Metadata travels via a loosely-typed `ILinkMetadata` bag. When a link is opened from an `ILink` object (e.g., in LinkEditor), only `href` survives — all other ILink fields (title, category, tags, imgSrc) are lost at the pipeline entry point.

### Relevant Existing Types

**`ILink`** (`src/renderer/api/types/io.tree.d.ts:97-130`):
```typescript
export interface ILink {
    id?: string;
    title: string;        // required
    href: string;         // required
    category: string;     // required
    tags: string[];       // required
    isDirectory: boolean; // required
    size?: number;
    mtime?: string;
    imgSrc?: string;
    hasSubDirectories?: boolean;
    hasItems?: boolean;
    target?: string;
}
```

**`ILinkMetadata`** (`src/renderer/api/types/io.events.d.ts:15-53`):
```typescript
export interface ILinkMetadata {
    pageId?: string;
    revealLine?: number;
    highlightText?: string;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    title?: string;
    fallbackTarget?: string;
    browserMode?: string;
    browserPageId?: string;
    browserTabMode?: "navigate" | "addTab";
    [key: string]: unknown;  // ← kills TypeScript safety
}
```

**`ISourceLink`** (`src/shared/types.ts:4-12` and `src/renderer/api/types/io.events.d.ts:4-12`):
```typescript
export interface ISourceLink {
    readonly url: string;
    readonly target?: string;
    readonly metadata?: Record<string, unknown>;
}
```

**`IPipeDescriptor`** (`src/renderer/api/types/io.pipe.d.ts:6-13`):
```typescript
export interface IPipeDescriptor {
    provider: IProviderDescriptor;
    transformers: ITransformerDescriptor[];
    encoding?: string;
}
```

### File Placement Pattern

- **Script-visible** type definitions go in `src/renderer/api/types/` as `.d.ts` files — auto-copied to `assets/editor-types/` by `editorTypesPlugin()` in `vite.renderer.config.ts` (provides Monaco IntelliSense for scripts)
- **Implementation** types shared between main/renderer go in `src/shared/` (e.g., `src/shared/types.ts`)
- Helper functions (runtime code) cannot live in `.d.ts` files — they go in a `.ts` file

## Implementation Plan

### Step 1: Create canonical `ILinkData` type in `src/renderer/api/types/io.link-data.d.ts`

**New file** — the canonical ILinkData definition. Lives in `api/types/` so it:
- Is auto-copied to `assets/editor-types/` by the Vite plugin
- Provides IntelliSense for scripts in the Monaco editor
- Can import `IPipeDescriptor` from sibling `io.pipe.d.ts` (same directory)

```typescript
// src/renderer/api/types/io.link-data.d.ts

import type { IPipeDescriptor } from "./io.pipe";

/**
 * Unified link data descriptor.
 *
 * Flows through the entire `openRawLink → openLink → openContent` pipeline.
 * Created by the caller, enriched by each layer (parsers, resolvers, open handler),
 * and stored on the page as the source link.
 *
 * When subscribing to link pipeline events, the event IS an ILinkData:
 * @example
 * app.events.openRawLink.subscribe((data) => {
 *     console.log(data.href);    // raw input
 *     data.target = "browser";   // override target editor
 * });
 *
 * @example
 * // Open a link with full context
 * await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com", {
 *     target: "browser",
 *     browserMode: "incognito",
 * }));
 */
export interface ILinkData {
    // ── Pipeline control ──────────────────────────────────────────
    /** Set to `true` to short-circuit the current channel's pipeline. */
    handled: boolean;

    // ── Core identity (always present) ────────────────────────────
    /** Raw link string — file path, URL, cURL command, etc. Set by caller. */
    href: string;
    /** Resolved URL after Layer 1 parsing (normalized path, extracted URL from cURL, etc.).
     *  If not set by a parser, open-handler uses `href` as fallback. */
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
    pipe?: any; // IContentPipe at runtime

    // ── Navigation hints (ephemeral — not persisted) ──────────────
    /** Open in this specific page instead of a new tab. */
    pageId?: string;
    /** Scroll to this line after opening. */
    revealLine?: number;
    /** Highlight occurrences of this text after opening. */
    highlightText?: string;

    // ── HTTP metadata (from cURL parser or callers) ───────────────
    /** HTTP headers. */
    headers?: Record<string, string>;
    /** HTTP method. */
    method?: string;
    /** HTTP body. */
    body?: string;

    // ── Browser routing (ephemeral — not persisted) ───────────────
    /** Browser routing mode ("os-default" | "internal" | "incognito" | "profile:<name>"). */
    browserMode?: string;
    /** Route URL to a specific browser page (add/navigate tab). */
    browserPageId?: string;
    /** How to open in the target browser page ("navigate" | "addTab"). */
    browserTabMode?: "navigate" | "addTab";

    // ── Content hints (ephemeral — not persisted) ─────────────────
    /** Fallback editor target when URL has no recognized extension. */
    fallbackTarget?: string;

    // ── Source tracking ───────────────────────────────────────────
    /** ID of the source editor/model that initiated this link opening.
     *  Used by ArchiveEditorModel to track provenance. */
    sourceId?: string;
}
```

### Step 2: Create helper functions in `src/shared/link-data.ts`

**New file** — runtime helper functions. Lives in `src/shared/` so it can be imported from both main and renderer processes. Imports `ILinkData` from the canonical `.d.ts` definition and `ILink` from `io.tree.d.ts` (both type-only imports, erased at compile time).

```typescript
// src/shared/link-data.ts

import type { ILinkData } from "../renderer/api/types/io.link-data";
import type { ILink } from "../renderer/api/types/io.tree";

// Re-export ILinkData for convenience — consumers can import from here or from io.link-data.d.ts
export type { ILinkData };

// ── Ephemeral fields — stripped before persistence ────────────────

/** Fields that are NOT persisted when storing ILinkData as sourceLink on a page. */
const EPHEMERAL_FIELDS: ReadonlySet<string> = new Set([
    "handled",
    "pipe",
    "pageId",
    "revealLine",
    "highlightText",
    "browserMode",
    "browserPageId",
    "browserTabMode",
    "fallbackTarget",
]);

// ── Helper functions ──────────────────────────────────────────────

/**
 * Create an ILinkData from a raw link string.
 *
 * @example
 * createLinkData("C:\\file.txt")
 * createLinkData("https://example.com", { target: "browser", browserMode: "incognito" })
 */
export function createLinkData(
    href: string,
    options?: Partial<Omit<ILinkData, "href" | "handled">>,
): ILinkData {
    return { handled: false, href, ...options };
}

/**
 * Convert an ILink to ILinkData.
 * Spreads all ILink fields so they survive the entire pipeline.
 *
 * @example
 * const data = linkToLinkData(link); // title, category, tags, imgSrc all preserved
 * await app.events.openRawLink.sendAsync(data);
 */
export function linkToLinkData(link: ILink): ILinkData {
    return { handled: false, ...link };
}

/**
 * Extract an ILink from ILinkData, filling required defaults for missing fields.
 * Used when storing a link back into a `.link.json` collection.
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

/**
 * Strip ephemeral fields for persistence as sourceLink on pages.
 * Returns a new object — does not mutate the input.
 */
export function cleanForStorage(data: ILinkData): Partial<ILinkData> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (EPHEMERAL_FIELDS.has(key)) continue;
        if (value !== undefined) cleaned[key] = value;
    }
    return cleaned as Partial<ILinkData>;
}
```

### Step 3: Update `src/shared/types.ts` — deprecate ISourceLink

Add `@deprecated` JSDoc tag to `ISourceLink` interface and `IEditorState.sourceLink` field. Keep the original interface shape intact so existing consumers (`open-handler.ts`, `ArchiveEditorModel.ts`) continue compiling without changes. The actual type change (`ISourceLink` → `Partial<ILinkData>`) happens in US-408 when all consumers are migrated.

```typescript
// src/shared/types.ts

/**
 * Describes the link that opened a page — origin identity + metadata.
 * @deprecated Will be replaced by `Partial<ILinkData>` in US-408.
 */
export interface ISourceLink {
    url: string;
    target?: string;
    metadata?: Record<string, unknown>;
}

export interface IEditorState {
    // ... existing fields ...
    /** The link that opened this page — informational, not functional. Persisted across restarts.
     *  @deprecated Will be changed to `Partial<ILinkData>` in US-408. */
    sourceLink?: ISourceLink,
    // ...
}
```

**Why not a type alias?** `ISourceLink` has `metadata?: Record<string, unknown>` which ILinkData doesn't have (those fields are absorbed as direct properties). Making it `type ISourceLink = Partial<ILinkData>` would break consumers that read `sourceLink.metadata`. The migration happens properly in US-408.

## Concerns

All resolved:

| # | Concern | Decision |
|---|---------|----------|
| C1 | Where to define ILinkData | Canonical definition in `src/renderer/api/types/io.link-data.d.ts` — same directory as `io.pipe.d.ts`, `io.tree.d.ts`, etc. Auto-copied to `assets/editor-types/` for Monaco IntelliSense. Helper functions in `src/shared/link-data.ts` (type-only imports from the `.d.ts`). |
| C2 | `pipeDescriptor` type | Import `IPipeDescriptor` directly from sibling `./io.pipe` — both files are in `api/types/`, no cross-boundary issue. |
| C3 | Removing ISourceLink | Keep original interface with `@deprecated` tag. Cannot use type alias because ISourceLink has `metadata?: Record<string, unknown>` which ILinkData replaces with direct fields — alias would break consumers. Actual replacement happens in US-408. |

## Acceptance Criteria

- [ ] `src/renderer/api/types/io.link-data.d.ts` exists with canonical `ILinkData` interface
- [ ] `src/shared/link-data.ts` exists with four helper functions and re-exports `ILinkData`
- [ ] `ILinkData` has all fields from the epic spec: `handled`, `href`, `url`, ILink-compatible fields, pipeline resolution, navigation hints, HTTP metadata, browser routing, content hints, `sourceId`
- [ ] No `[key: string]: unknown` index signature on ILinkData
- [ ] `pipeDescriptor` field imports `IPipeDescriptor` from `./io.pipe`
- [ ] `createLinkData(href, options?)` creates minimal ILinkData with `handled: false`
- [ ] `linkToLinkData(link)` spreads all ILink fields into ILinkData
- [ ] `linkDataToLink(data)` fills required ILink defaults (title, category, tags, isDirectory)
- [ ] `cleanForStorage(data)` strips all ephemeral fields (handled, pipe, pageId, revealLine, highlightText, browserMode, browserPageId, browserTabMode, fallbackTarget)
- [ ] `EPHEMERAL_FIELDS` set is not exported (internal implementation detail)
- [ ] `ISourceLink` kept as original interface with `@deprecated` tag in `src/shared/types.ts`
- [ ] `IEditorState.sourceLink` stays `ISourceLink` with `@deprecated` note pointing to US-408
- [ ] Project compiles (`npm run lint` passes)
- [ ] `assets/editor-types/io.link-data.d.ts` auto-generated on next dev/build

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/api/types/io.link-data.d.ts` | **Create** | Canonical ILinkData interface (auto-copied to `assets/editor-types/`) |
| `src/shared/link-data.ts` | **Create** | Helper functions + ILinkData re-export |
| `src/shared/types.ts` | **Modify** | Add `@deprecated` tags to ISourceLink and IEditorState.sourceLink (shape unchanged until US-408) |

### Files NOT changed in this task

| File | Reason |
|------|--------|
| `src/renderer/api/types/io.events.d.ts` | ISourceLink copy and ILinkMetadata stay until US-410 |
| `src/renderer/api/events/events.ts` | Event classes stay until US-405 |
| `src/renderer/api/events/EventChannel.ts` | Constraint change in US-405 |
| `src/renderer/api/events/AppEvents.ts` | Channel types change in US-405 |
| `src/renderer/content/parsers.ts` | Parser refactor in US-406 |
| `src/renderer/content/resolvers.ts` | Resolver refactor in US-407 |
| `src/renderer/content/open-handler.ts` | Open handler refactor in US-408 |
| All pipeline callers | Updated in US-409 |
| `src/renderer/editors/base/EditorModel.ts` | sourceLink consumer — updated in US-408 |
| `assets/editor-types/*` | Auto-generated by Vite plugin, no manual changes |
