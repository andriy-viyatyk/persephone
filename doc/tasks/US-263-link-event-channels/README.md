# US-263: Link Event Channels

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Add three new event channels to `app.events` for the link pipeline: `openRawLink` (Layer 1), `openLink` (Layer 2), and `openContent` (Layer 3). Also create the event classes and script-facing type definitions (`io.events.d.ts`).

## Why

- These three channels are the backbone of the link pipeline — all subsequent Phase B tasks (parsers, resolvers, open handler, entry point migration) subscribe to them
- Scripts need typed access via `app.events.openRawLink`, `app.events.openLink`, `app.events.openContent`

## Background

### Current state

`AppEvents` (`src/renderer/api/events/AppEvents.ts`) has two event group classes:
- `FileExplorerEvents` — `itemContextMenu` channel
- `BrowserEvents` — `onBookmark` channel
- `AppEvents` — composes both groups

Script-facing types are in `src/renderer/api/types/events.d.ts` with `IAppEvents`, `IFileExplorerEvents`, `IBrowserEvents`.

### What this task adds

**Three new channels on `AppEvents`** (not nested in a group — they're top-level):
- `openRawLink: EventChannel<RawLinkEvent>` — Layer 1 raw string parsing
- `openLink: EventChannel<OpenLinkEvent>` — Layer 2 provider/transformer resolution
- `openContent: EventChannel<OpenContentEvent>` — Layer 3 open in editor

**Three event classes** in `src/renderer/api/events/events.ts`:
- `RawLinkEvent extends BaseEvent` — `{ raw: string }`
- `OpenLinkEvent extends BaseEvent` — `{ url: string, target?: string, metadata?: ILinkMetadata }`
- `OpenContentEvent extends BaseEvent` — `{ pipe: IContentPipe, target: string, metadata?: ILinkMetadata }`

**Script-facing types** in `src/renderer/api/types/io.events.d.ts`:
- `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`

**Updated `IAppEvents`** in `events.d.ts` to include the three new channels.

## Acceptance Criteria

- [ ] `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` classes created in `events.ts`
- [ ] Three channels added to `AppEvents` class
- [ ] `io.events.d.ts` created with `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`
- [ ] `IAppEvents` in `events.d.ts` updated with three new channels
- [ ] `AppWrapper` events proxy works with new channels (no changes needed — proxy is recursive)
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create event classes

File: `src/renderer/api/events/events.ts` — add after existing classes:

```typescript
/** Layer 1: Raw link string to be parsed. */
export class RawLinkEvent extends BaseEvent {
    constructor(
        public readonly raw: string,
    ) {
        super();
    }
}

/** Layer 2: Structured link to be resolved into provider + transformers. */
export class OpenLinkEvent extends BaseEvent {
    constructor(
        public readonly url: string,
        public target?: string,
        public metadata?: Record<string, unknown>,
    ) {
        super();
    }
}

/** Layer 3: Content pipe + target to be opened in an editor. */
export class OpenContentEvent extends BaseEvent {
    constructor(
        public readonly pipe: IContentPipe,
        public readonly target: string,
        public readonly metadata?: Record<string, unknown>,
    ) {
        super();
    }
}
```

Note: `metadata` uses `Record<string, unknown>` in the implementation class (matching `ILinkMetadata`'s index signature). The typed properties (`pageId`, `revealLine`, etc.) are defined in the script-facing `ILinkMetadata` interface.

`OpenLinkEvent` needs `IContentPipe` import — use `import type` from `io.pipe.d.ts`.

### Step 2: Add channels to AppEvents

File: `src/renderer/api/events/AppEvents.ts`:

```typescript
import type { RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "./events";

export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
    readonly browser = new BrowserEvents();

    // Link pipeline (EPIC-012)
    readonly openRawLink = new EventChannel<RawLinkEvent>({ name: "openRawLink" });
    readonly openLink = new EventChannel<OpenLinkEvent>({ name: "openLink" });
    readonly openContent = new EventChannel<OpenContentEvent>({ name: "openContent" });
}
```

### Step 3: Create script-facing types

File: `src/renderer/api/types/io.events.d.ts`:

```typescript
import type { IBaseEvent } from "./events";
import type { IContentPipe } from "./io.pipe";

/** Metadata passed through the link pipeline. */
export interface ILinkMetadata {
    /** Open in this specific page instead of a new tab. */
    pageId?: string;
    /** Scroll to this line after opening. */
    revealLine?: number;
    /** Highlight occurrences of this text after opening. */
    highlightText?: string;
    /** HTTP headers (from cURL parser, etc.). */
    headers?: Record<string, string>;
    /** HTTP method (from cURL parser). */
    method?: string;
    /** HTTP body (from cURL parser). */
    body?: string;
    /** Additional custom data (for script/extension use). */
    [key: string]: unknown;
}

/** Layer 1: Raw link string to be parsed. */
export interface IRawLinkEvent extends IBaseEvent {
    /** The raw link string (file path, URL, cURL, etc.). */
    readonly raw: string;
}

/** Layer 2: Structured link to be resolved into provider + transformers. */
export interface IOpenLinkEvent extends IBaseEvent {
    /** Normalized URL (file path, https://, archive path, etc.). */
    readonly url: string;
    /** Target editor ID — optional, auto-resolved by handler if omitted. */
    target?: string;
    /** Open hints and pass-through metadata. */
    metadata?: ILinkMetadata;
}

/** Layer 3: Content pipe + target to be opened in an editor. */
export interface IOpenContentEvent extends IBaseEvent {
    /** Assembled content pipe (provider + transformers). */
    readonly pipe: IContentPipe;
    /** Resolved editor ID. */
    readonly target: string;
    /** Pass-through metadata (pageId, revealLine, etc.). */
    readonly metadata?: ILinkMetadata;
}
```

### Step 4: Update IAppEvents

File: `src/renderer/api/types/events.d.ts` — add imports and channels:

```typescript
import type { IRawLinkEvent, IOpenLinkEvent, IOpenContentEvent } from "./io.events";

export interface IAppEvents {
    readonly fileExplorer: IFileExplorerEvents;
    readonly browser: IBrowserEvents;
    /** Layer 1: Raw string → parsed link. Parsers subscribe here. */
    readonly openRawLink: IEventChannel<IRawLinkEvent>;
    /** Layer 2: Structured link → provider + transformers. Resolvers subscribe here. */
    readonly openLink: IEventChannel<IOpenLinkEvent>;
    /** Layer 3: Content pipe + target → open page. Openers subscribe here. */
    readonly openContent: IEventChannel<IOpenContentEvent>;
}
```

### Step 5: Verify AppWrapper proxy

The recursive `createEventsProxy` in `AppWrapper.ts` auto-wraps any object with a `subscribe` method. Since the new channels are `EventChannel` instances on `AppEvents`, the proxy will wrap them automatically. No changes needed — just verify.

## Files to Modify/Create

| File | Change |
|------|--------|
| `src/renderer/api/events/events.ts` | Add `RawLinkEvent`, `OpenLinkEvent`, `OpenContentEvent` classes |
| `src/renderer/api/events/AppEvents.ts` | Add three new channels to `AppEvents` |
| `src/renderer/api/types/io.events.d.ts` | **NEW** — `IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata` |
| `src/renderer/api/types/events.d.ts` | Update `IAppEvents` with three new channels |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-260 (EventChannel LIFO — `sendAsync()` uses LIFO for the pipeline)
- Needed by: US-264 (raw link parsers), US-265 (pipe resolvers), US-266 (open handler)
