# US-405: Loosen EventChannel Constraint and Consolidate Link Pipeline Events

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** Done
**Depends on:** US-404 (ILinkData interface — completed)

## Goal

Change `EventChannel`'s generic constraint from `TEvent extends BaseEvent` (class-based) to `TEvent extends { handled: boolean }` (interface-based) so plain `ILinkData` objects can flow through event channels. Then update `AppEvents` to type the three link pipeline channels as `EventChannel<ILinkData>`, and remove the now-unused `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` event classes from `events.ts`.

This is a **type-level + wiring** change only — parsers, resolvers, open handler, and pipeline callers are NOT touched in this task (those are US-406 through US-409). The channels accept `ILinkData`, but existing subscribers still receive it (since `ILinkData` has `handled: boolean`, all existing property reads compile). The event constructors are removed because no consumer should use them after this task — all call sites will be migrated in US-406–US-409.

## Background

### Current State

**`EventChannel<TEvent extends BaseEvent>`** (`src/renderer/api/events/EventChannel.ts:21`):
```typescript
export class EventChannel<TEvent extends BaseEvent> {
    // ...
    sendAsync = async (event: TEvent): Promise<boolean> => {
        // ... iterates handlers in LIFO order
        if (event.handled) { return true; }  // ← accesses .handled
        // ...
    };
    send = (event: TEvent): void => {
        // ... sends frozen event in FIFO order
    };
}
```

The only thing `EventChannel` needs from `TEvent` is `event.handled` (a boolean property checked after each handler in `sendAsync`). The `send()` method freezes the event — no `.handled` check. So the minimum constraint is `{ handled: boolean }`.

**`BaseEvent`** (`src/renderer/api/events/BaseEvent.ts`):
```typescript
export class BaseEvent {
    handled = false;
}
```

Still used by `ContextMenuEvent` and `BookmarkEvent` — stays as-is.

**Link event classes** (`src/renderer/api/events/events.ts:70-100`):
```typescript
export class RawLinkEvent extends BaseEvent {
    constructor(public readonly raw: string, public target?: string, public metadata?: ILinkMetadata) { super(); }
}
export class OpenLinkEvent extends BaseEvent {
    constructor(public readonly url: string, public target?: string, public metadata?: ILinkMetadata) { super(); }
}
export class OpenContentEvent extends BaseEvent {
    constructor(public readonly pipe: IContentPipe, public readonly target: string, public readonly metadata?: ILinkMetadata) { super(); }
}
```

These three classes are removed. `ILinkData` replaces them.

**`AppEvents`** (`src/renderer/api/events/AppEvents.ts:14-25`):
```typescript
export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
    readonly browser = new BrowserEvents();
    readonly openRawLink = new EventChannel<RawLinkEvent>({ name: "openRawLink" });
    readonly openLink = new EventChannel<OpenLinkEvent>({ name: "openLink" });
    readonly openContent = new EventChannel<OpenContentEvent>({ name: "openContent" });
    readonly linkContextMenu = new EventChannel<ContextMenuEvent<ILink>>({ name: "linkContextMenu" });
}
```

**Events barrel export** (`src/renderer/api/events/index.ts`):
```typescript
export { BaseEvent } from "./BaseEvent";
export { EventChannel } from "./EventChannel";
export type { EventHandler, EventChannelOptions } from "./EventChannel";
export type { ISubscriptionObject } from "../types/events";
export { ContextMenuEvent } from "./events";
export { AppEvents, FileExplorerEvents } from "./AppEvents";
export type { MenuItem } from "../types/events";
```

Does NOT export `RawLinkEvent`, `OpenLinkEvent`, or `OpenContentEvent` — they are imported directly from `./events` by consumers.

### Import Analysis — Who Imports the Link Event Classes

Every file that imports `RawLinkEvent`, `OpenLinkEvent`, or `OpenContentEvent` from `"../../api/events/events"`:

| File | Imports | Usage |
|------|---------|-------|
| `src/renderer/content/parsers.ts` | `OpenLinkEvent` | Creates `new OpenLinkEvent(...)` to forward to Layer 2 |
| `src/renderer/content/resolvers.ts` | `OpenContentEvent` | Creates `new OpenContentEvent(...)` to forward to Layer 3 |
| `src/renderer/content/open-handler.ts` | `type OpenContentEvent` | Type-only import for `buildSourceLink()` parameter |
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | `RawLinkEvent, OpenLinkEvent, OpenContentEvent` | Exports to script `io` namespace |
| `src/renderer/api/events/AppEvents.ts` | `type RawLinkEvent, OpenLinkEvent, OpenContentEvent` | Channel generic types |
| `src/renderer/api/pages/PagesModel.ts` | `RawLinkEvent` | `new RawLinkEvent(filePath)` in drag-drop handler |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | `RawLinkEvent` | `new RawLinkEvent(url)` in restore handler |
| `src/renderer/api/internal/RendererEventsService.ts` | `RawLinkEvent` | `new RawLinkEvent(filePath)` in IPC handler |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | `RawLinkEvent` | `new RawLinkEvent(navUrl, ...)` |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | `RawLinkEvent` | `new RawLinkEvent(url, ...)` |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | `RawLinkEvent` | `new RawLinkEvent(filePath, ...)` |
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | `RawLinkEvent` | `new RawLinkEvent(url, ...)` |
| `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` | `RawLinkEvent` | `new RawLinkEvent(url, ...)` |
| `src/renderer/editors/category/CategoryEditor.tsx` | `RawLinkEvent` | `new RawLinkEvent(url, ...)` |
| `src/renderer/editors/settings/SettingsPage.tsx` | `RawLinkEvent` | `new RawLinkEvent(...)` |
| `src/renderer/ui/sidebar/RecentFileList.tsx` | `RawLinkEvent` | `new RawLinkEvent(filePath)` |
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | `RawLinkEvent` | `new RawLinkEvent(...)` |
| `src/renderer/ui/sidebar/MenuBar.tsx` | `RawLinkEvent` | `new RawLinkEvent(...)` |
| `src/renderer/content/tree-context-menus.tsx` | `RawLinkEvent` | `new RawLinkEvent(href, ...)` |

**Important:** All call-site files listed above (except `AppEvents.ts`) are migrated in **US-409** (callers), **US-406** (parsers), **US-407** (resolvers), **US-408** (open handler), and **US-410** (IoNamespace). This task only touches the channel infrastructure and removes the class definitions. The callers will have **temporary compilation errors** until US-406–US-409 are applied.

### Compilation Strategy

Since removing the event classes breaks ~18 call sites, there are two approaches:

**Option A — Remove classes now, fix callers in US-406–US-409.** The project won't compile between US-405 and US-409. Each subsequent task fixes its slice.

**Option B — Keep deprecated class re-exports temporarily.** Add thin wrappers that construct `ILinkData` from the old constructor signatures, so existing callers keep compiling. Remove them in US-409.

**Decision: Option A.** The tasks are designed to be implemented in sequence within the same branch. Intermediate non-compilation is acceptable because the project compiles after all tasks are done, and each task is too small to warrant compatibility shims.

However, to keep `npm run lint` passing after this task alone, we add **temporary adapter functions** at the bottom of `events.ts` that create `ILinkData` from the old constructor signatures. These adapters have `@deprecated` tags and are removed in US-409. This is the lightest-weight approach: no class hierarchy, just plain functions that return `ILinkData`.

## Implementation Plan

### Step 1: Loosen EventChannel constraint

**File:** `src/renderer/api/events/EventChannel.ts`

Change:
```typescript
// Before (line 21):
export class EventChannel<TEvent extends BaseEvent> {

// After:
export class EventChannel<TEvent extends { handled: boolean }> {
```

Remove the `BaseEvent` import (line 1):
```typescript
// Before:
import { BaseEvent } from "./BaseEvent";

// After:
// (line removed entirely)
```

No other changes — `send()`, `sendAsync()`, `subscribe()`, `hasSubscribers` all work with the new constraint.

### Step 2: Update AppEvents to use ILinkData channels

**File:** `src/renderer/api/events/AppEvents.ts`

```typescript
// Before:
import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent, BookmarkEvent, RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "./events";
import type { IFileTarget } from "../types/events";
import type { ILink } from "../types/io.tree";

// After:
import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent, BookmarkEvent } from "./events";
import type { IFileTarget } from "../types/events";
import type { ILink } from "../types/io.tree";
import type { ILinkData } from "../../../shared/link-data";
```

Channel type changes:
```typescript
// Before:
readonly openRawLink = new EventChannel<RawLinkEvent>({ name: "openRawLink" });
readonly openLink = new EventChannel<OpenLinkEvent>({ name: "openLink" });
readonly openContent = new EventChannel<OpenContentEvent>({ name: "openContent" });

// After:
readonly openRawLink = new EventChannel<ILinkData>({ name: "openRawLink" });
readonly openLink = new EventChannel<ILinkData>({ name: "openLink" });
readonly openContent = new EventChannel<ILinkData>({ name: "openContent" });
```

### Step 3: Remove link event classes from events.ts

**File:** `src/renderer/api/events/events.ts`

Remove the three link event classes (lines 67–100):
```typescript
// REMOVE:
// ── Link Pipeline Events (EPIC-012) ────────────────────────────────

/** Layer 1: Raw link string to be parsed. */
export class RawLinkEvent extends BaseEvent { ... }

/** Layer 2: Structured link to be resolved into provider + transformers. */
export class OpenLinkEvent extends BaseEvent { ... }

/** Layer 3: Content pipe + target to be opened in an editor. */
export class OpenContentEvent extends BaseEvent { ... }
```

Remove the `ILinkMetadata` import (line 5):
```typescript
// Before:
import type { ILinkMetadata } from "../types/io.events";
// After:
// (line removed entirely)
```

Remove the `IContentPipe` import (line 4):
```typescript
// Before:
import type { IContentPipe } from "../types/io.pipe";
// After:
// (line removed entirely)
```

**What remains in events.ts:**
- `import { BaseEvent } from "./BaseEvent";`
- `import React from "react";`
- `import type { MenuItem } from "../types/events";`
- `ContextMenuTargetKind` type
- `BookmarkEvent` class
- `ContextMenuEvent<T>` class

### Step 4: Add temporary adapter functions for callers

**File:** `src/renderer/api/events/events.ts` (append at bottom)

Add `@deprecated` adapter functions that produce `ILinkData` objects. This keeps existing call sites compiling until they are migrated in US-406–US-409.

```typescript
import type { ILinkData } from "../../../shared/link-data";
import type { ILinkMetadata } from "../types/io.events";
import type { IContentPipe } from "../types/io.pipe";

/**
 * Temporary adapter — creates ILinkData from old RawLinkEvent constructor signature.
 * @deprecated Use `createLinkData()` from `src/shared/link-data.ts` instead. Removed in US-409.
 */
export function RawLinkEvent(raw: string, target?: string, metadata?: ILinkMetadata): ILinkData {
    return {
        handled: false,
        href: raw,
        target,
        ...metadata,
    };
}

/**
 * Temporary adapter — creates ILinkData from old OpenLinkEvent constructor signature.
 * @deprecated Use `createLinkData()` from `src/shared/link-data.ts` instead. Removed in US-406.
 */
export function OpenLinkEvent(url: string, target?: string, metadata?: ILinkMetadata): ILinkData {
    return {
        handled: false,
        href: url,
        url,
        target,
        ...metadata,
    };
}

/**
 * Temporary adapter — creates ILinkData from old OpenContentEvent constructor signature.
 * @deprecated Use ILinkData directly. Removed in US-407.
 */
export function OpenContentEvent(pipe: IContentPipe, target: string, metadata?: ILinkMetadata): ILinkData {
    return {
        handled: false,
        href: "",
        pipe,
        target,
        ...metadata,
    };
}
```

**Key details:**
- These are plain functions (not classes), but callers currently use `new RawLinkEvent(...)`. In JavaScript, calling `new` on a plain function that returns an object returns that object (the `new` keyword is ignored when the constructor returns a non-primitive). So `new RawLinkEvent("foo")` and `RawLinkEvent("foo")` both return the same `ILinkData`.
- `ILinkMetadata` has `[key: string]: unknown` index signature, so spreading it works — all known fields (`pageId`, `revealLine`, `headers`, etc.) land on the ILinkData.
- The `OpenLinkEvent` adapter sets both `href` and `url` to the same value (since Layer 1 already resolved the URL).
- The `OpenContentEvent` adapter sets `href: ""` (placeholder — the URL is reconstructed from `pipe.provider.sourceUrl` in the open handler).

### Step 5: Update script-visible type definitions

These files are in `src/renderer/api/types/` and auto-copied to `assets/editor-types/`:

**File: `src/renderer/api/types/events.d.ts`**

Update `IAppEvents` channel types and remove old event type imports:

```typescript
// Before:
import type { IRawLinkEvent, IOpenLinkEvent, IOpenContentEvent } from "./io.events";
// ...
export interface IAppEvents {
    readonly openRawLink: IEventChannel<IRawLinkEvent>;
    readonly openLink: IEventChannel<IOpenLinkEvent>;
    readonly openContent: IEventChannel<IOpenContentEvent>;
}

// After:
import type { ILinkData } from "./io.link-data";
// ...
export interface IAppEvents {
    readonly openRawLink: IEventChannel<ILinkData>;
    readonly openLink: IEventChannel<ILinkData>;
    readonly openContent: IEventChannel<ILinkData>;
}
```

Also update `IEventChannel` constraint to match the loosened `EventChannel`:

```typescript
// Before:
export interface IEventChannel<T extends IBaseEvent> {

// After:
export interface IEventChannel<T extends { handled: boolean }> {
```

**File: `src/renderer/api/types/io.events.d.ts`**

Remove the link event interfaces (`IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`). Keep `ISourceLink` and `ILinkMetadata` — they are still referenced by callers until US-408 and US-410.

```typescript
// Before:
import type { IBaseEvent } from "./events";
import type { IContentPipe } from "./io.pipe";

export interface ISourceLink { ... }      // KEEP (removed in US-408/US-410)
export interface ILinkMetadata { ... }     // KEEP (removed in US-410)
export interface IRawLinkEvent { ... }     // REMOVE
export interface IOpenLinkEvent { ... }    // REMOVE
export interface IOpenContentEvent { ... } // REMOVE

// After:
export interface ISourceLink { ... }
export interface ILinkMetadata { ... }
// (IRawLinkEvent, IOpenLinkEvent, IOpenContentEvent removed)
// (IBaseEvent and IContentPipe imports removed — no longer needed here)
```

**File: `src/renderer/api/types/io.d.ts`**

Remove event constructor interfaces and add `createLinkData`/`linkToLinkData` factory types:

```typescript
// Before:
import type { IBaseEvent } from "./events";
import type { ILinkMetadata } from "./io.events";
// ...
export interface IRawLinkEventConstructor { ... }
export interface IOpenLinkEventConstructor { ... }
export interface IOpenContentEventConstructor { ... }
export interface IIoNamespace {
    readonly RawLinkEvent: IRawLinkEventConstructor;
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    readonly OpenContentEvent: IOpenContentEventConstructor;
    // ...
}

// After:
import type { ILinkData } from "./io.link-data";
import type { ILink } from "./io.tree";
// ...
// (IRawLinkEventConstructor, IOpenLinkEventConstructor, IOpenContentEventConstructor removed)
export interface IIoNamespace {
    /**
     * Create an ILinkData from a raw link string.
     * @example
     * await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com"));
     * await app.events.openRawLink.sendAsync(io.createLinkData("C:\\file.txt", { target: "browser" }));
     */
    createLinkData(href: string, options?: Partial<Omit<ILinkData, "href" | "handled">>): ILinkData;
    /**
     * Convert an ILink to ILinkData — preserves all ILink fields through the pipeline.
     * @example
     * await app.events.openRawLink.sendAsync(io.linkToLinkData(link));
     */
    linkToLinkData(link: ILink): ILinkData;
    // ... (FileProvider, HttpProvider, etc. unchanged)
}
```

### Step 6: Update IoNamespace runtime

**File:** `src/renderer/scripting/api-wrapper/IoNamespace.ts`

Replace event constructor exports with helper function exports:

```typescript
// Before:
import { RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "../../api/events/events";
// ...
return {
    // ...
    RawLinkEvent,
    OpenLinkEvent,
    OpenContentEvent,
};

// After:
import { createLinkData, linkToLinkData } from "../../../../shared/link-data";
// ...
return {
    // ...
    createLinkData,
    linkToLinkData,
};
```

**Note:** The old `io.RawLinkEvent`, `io.OpenLinkEvent`, `io.OpenContentEvent` stop working for scripts. This is a breaking change for scripts — documented in what's-new as part of US-410 or the overall EPIC-023 completion.

## Concerns

| # | Concern | Decision |
|---|---------|----------|
| C1 | Compilation breaks for ~18 callers when event classes are removed | Add temporary adapter functions (plain functions with same names) that return `ILinkData`. The `new` keyword on a function that returns an object is ignored in JS — so `new RawLinkEvent("foo")` works with both the old class and the new function. Adapters removed in US-409. |
| C2 | `ILinkMetadata` spread has `[key: string]: unknown` — will it pollute ILinkData? | At runtime the metadata objects only contain known fields (`pageId`, `headers`, etc.). The index signature is a TypeScript artifact. Spreading works correctly. After US-410 removes `ILinkMetadata`, callers pass typed ILinkData fields directly. |
| C3 | `IEventChannel` constraint in `events.d.ts` must match `EventChannel` | Both updated to `{ handled: boolean }`. `IBaseEvent` still exists (used by `IContextMenuEvent`, `IBookmarkEvent`) — no breaking change for those. |
| C4 | Script API breaking change (`io.RawLinkEvent` → `io.createLinkData`) | Intentional. The old event constructors go away. This is documented as a breaking change in the EPIC-023 completion notes. |

## Acceptance Criteria

- [ ] `EventChannel<TEvent>` constraint is `TEvent extends { handled: boolean }` (not `BaseEvent`)
- [ ] `BaseEvent` import removed from `EventChannel.ts`
- [ ] `BaseEvent` class stays in `BaseEvent.ts` (used by `ContextMenuEvent`, `BookmarkEvent`)
- [ ] `AppEvents` channels typed as `EventChannel<ILinkData>` for all three link channels
- [ ] `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` class definitions removed from `events.ts`
- [ ] Temporary `RawLinkEvent()`, `OpenLinkEvent()`, `OpenContentEvent()` adapter functions added to `events.ts` with `@deprecated` tags
- [ ] Adapter functions return `ILinkData` objects and work with `new` keyword (JS constructor return behavior)
- [ ] `events.d.ts`: `IAppEvents` channels use `IEventChannel<ILinkData>`
- [ ] `events.d.ts`: `IEventChannel<T>` constraint loosened to `T extends { handled: boolean }`
- [ ] `io.events.d.ts`: `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent` removed; `ISourceLink` and `ILinkMetadata` kept
- [ ] `io.d.ts`: Event constructor interfaces removed; `createLinkData` and `linkToLinkData` factories added to `IIoNamespace`
- [ ] `IoNamespace.ts`: Exports `createLinkData` and `linkToLinkData` instead of event constructors
- [ ] Project compiles (`npm run lint` passes)
- [ ] `assets/editor-types/` files auto-generated on next dev/build

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/api/events/EventChannel.ts` | **Modify** | Loosen constraint to `{ handled: boolean }`, remove `BaseEvent` import |
| `src/renderer/api/events/AppEvents.ts` | **Modify** | Channel types → `EventChannel<ILinkData>`, update imports |
| `src/renderer/api/events/events.ts` | **Modify** | Remove 3 event classes, add 3 temporary adapter functions |
| `src/renderer/api/types/events.d.ts` | **Modify** | `IAppEvents` channels → `IEventChannel<ILinkData>`, `IEventChannel` constraint loosened |
| `src/renderer/api/types/io.events.d.ts` | **Modify** | Remove `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`; keep `ISourceLink`, `ILinkMetadata` |
| `src/renderer/api/types/io.d.ts` | **Modify** | Remove event constructors, add `createLinkData`/`linkToLinkData` to `IIoNamespace` |
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | **Modify** | Replace event constructor exports with `createLinkData`/`linkToLinkData` |

### Files NOT changed in this task

| File | Reason |
|------|--------|
| `src/renderer/api/events/BaseEvent.ts` | Stays — used by `ContextMenuEvent`, `BookmarkEvent` |
| `src/renderer/api/events/index.ts` | Already doesn't export link event classes |
| `src/renderer/content/parsers.ts` | Migrated in US-406 (uses temporary adapters until then) |
| `src/renderer/content/resolvers.ts` | Migrated in US-407 |
| `src/renderer/content/open-handler.ts` | Migrated in US-408 |
| All pipeline callers (~15 files) | Migrated in US-409 |
| `src/shared/link-data.ts` | Already created in US-404 |
| `src/renderer/api/types/io.link-data.d.ts` | Already created in US-404 |
| `src/shared/types.ts` | ISourceLink deprecation already done in US-404 |
| `assets/editor-types/*` | Auto-generated by Vite plugin |
