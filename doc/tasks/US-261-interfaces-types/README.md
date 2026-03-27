# US-261: Interfaces & Types

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Define all content pipe type definitions: `IProvider`, `ITransformer`, `IContentPipe`, `IPipeDescriptor`, `IProviderDescriptor`, `ITransformerDescriptor`. These are script-facing `.d.ts` files in `src/renderer/api/types/` and internal TypeScript interfaces in `src/renderer/content/`.

## Why

- All subsequent tasks (FileProvider, ContentPipe, transformers, serialization) depend on these interfaces
- Script-facing types go into `api/types/` where they're auto-copied to `assets/editor-types/` for Monaco IntelliSense
- Separating interface definition from implementation allows parallel work and clear contracts

## Background

### Existing patterns

- Script-facing types live in `src/renderer/api/types/*.d.ts` — exported interfaces with JSDoc
- Files cross-reference via `import type { ... } from "./other"`
- `ISubscriptionObject` is already in `events.d.ts` — needed by `IProvider.watch()`
- `IBaseEvent` is already in `events.d.ts` — needed by event types (created in US-263, not this task)
- Vite `editorTypesPlugin` auto-copies `api/types/` to `assets/editor-types/` — no config changes needed

### What this task creates

Script-facing types (`.d.ts` for Monaco IntelliSense):
- `io.provider.d.ts` — `IProvider`, `IProviderStat`, `IProviderDescriptor`
- `io.transformer.d.ts` — `ITransformer`, `ITransformerDescriptor`
- `io.pipe.d.ts` — `IContentPipe`, `IPipeDescriptor`

Event types (`io.events.d.ts`) are NOT part of this task — they'll be created in US-263 (Link event channels) since they depend on the event channels existing.

The `io.d.ts` namespace and `io.tree.d.ts` are NOT part of this task — they'll be created in US-271 (Script API) and when tree providers are needed.

## Acceptance Criteria

- [ ] `io.provider.d.ts` created with `IProvider`, `IProviderStat`, `IProviderDescriptor`
- [ ] `io.transformer.d.ts` created with `ITransformer`, `ITransformerDescriptor`
- [ ] `io.pipe.d.ts` created with `IContentPipe`, `IPipeDescriptor`
- [ ] All interfaces match the epic's Key Interfaces section
- [ ] JSDoc on all public members
- [ ] Files auto-copied to `assets/editor-types/` (verified by checking the folder after build or dev start)
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create `io.provider.d.ts`

File: `src/renderer/api/types/io.provider.d.ts`

```typescript
import type { ISubscriptionObject } from "./events";

/** Serializable provider descriptor for persistence. */
export interface IProviderDescriptor {
    /** Provider type (e.g., "file", "http", "buffer"). */
    type: string;
    /** Provider-specific configuration (e.g., { path: "C:\\file.txt" }). */
    config: Record<string, unknown>;
}

/** File/resource metadata. */
export interface IProviderStat {
    /** File size in bytes. */
    size?: number;
    /** Last modification time (ISO string). */
    mtime?: string;
    /** Whether the resource exists. */
    exists: boolean;
}

/**
 * IProvider — knows *where* to get bytes.
 *
 * Providers are data sources: local files, HTTP URLs, in-memory buffers.
 * They read/write raw binary content. Text encoding is handled separately
 * by EncodingTransformer.
 */
export interface IProvider {
    /** Provider type identifier (e.g., "file", "http", "buffer"). */
    readonly type: string;
    /** Display name for UI (filename, URL, etc.). */
    readonly displayName: string;
    /** Original URL/path that created this provider. */
    readonly sourceUrl: string;
    /** Whether this provider can be restored from a descriptor after app restart.
     *  Non-restorable providers (e.g., BufferProvider) return empty content after restore. */
    readonly restorable: boolean;
    /** Whether this provider supports writing. */
    readonly writable: boolean;
    /** Read binary content from the source. */
    readBinary(): Promise<Buffer>;
    /** Write binary content to the source. Only present if writable. */
    writeBinary?(data: Buffer): Promise<void>;
    /** Get resource metadata (size, modified date, existence). */
    stat?(): Promise<IProviderStat>;
    /** Watch for external changes. Returns subscription to stop watching. */
    watch?(callback: (event: string) => void): ISubscriptionObject;
    /** Serialize to descriptor for persistence. */
    toDescriptor(): IProviderDescriptor;
    /** Release resources (file handles, connections, etc.). */
    dispose?(): void;
}
```

### Step 2: Create `io.transformer.d.ts`

File: `src/renderer/api/types/io.transformer.d.ts`

```typescript
/** Serializable transformer descriptor for persistence. */
export interface ITransformerDescriptor {
    /** Transformer type (e.g., "zip", "gunzip", "base64"). */
    type: string;
    /** Transformer-specific configuration (e.g., { entryPath: "data/report.csv" }). */
    config: Record<string, unknown>;
}

/**
 * ITransformer — knows *how to process* bytes.
 *
 * Transformers sit between provider and editor in the content pipe.
 * They transform bytes on read (source → editor) and optionally
 * reverse-transform on write (editor → source).
 */
export interface ITransformer {
    /** Transformer type identifier (e.g., "zip", "decrypt", "gunzip"). */
    readonly type: string;
    /** Configuration used to construct this transformer. */
    readonly config: Record<string, unknown>;
    /** Whether this transformer should be included in saved pipe descriptor.
     *  false for DecryptTransformer (contains password — must not persist to disk). */
    readonly persistent: boolean;
    /** Transform bytes on read (source → editor). */
    read(data: Buffer): Promise<Buffer>;
    /** Reverse-transform bytes on write (editor → source).
     *  Receives new content and original source bytes (needed by ZIP to rebuild archive).
     *  Undefined means this transformer is read-only. */
    write?(data: Buffer, original: Buffer): Promise<Buffer>;
    /** Serialize to descriptor for persistence. */
    toDescriptor(): ITransformerDescriptor;
}
```

### Step 3: Create `io.pipe.d.ts`

File: `src/renderer/api/types/io.pipe.d.ts`

```typescript
import type { ISubscriptionObject } from "./events";
import type { IProvider, IProviderDescriptor } from "./io.provider";
import type { ITransformer, ITransformerDescriptor } from "./io.transformer";

/** Serializable pipe descriptor for persistence (stored in IPageState). */
export interface IPipeDescriptor {
    /** Provider descriptor. */
    provider: IProviderDescriptor;
    /** Transformer descriptors (ordered). Only persistent transformers are included. */
    transformers: ITransformerDescriptor[];
}

/**
 * IContentPipe — composed view of provider + transformers.
 *
 * The pipe is the primary abstraction editors work with.
 * It handles reading (provider → transformers → editor) and
 * writing (editor → reverse-transformers → provider).
 *
 * Pipes are immutable-by-convention: use clone() + addTransformer()
 * on the clone rather than mutating the active pipe (clone-and-try pattern).
 */
export interface IContentPipe {
    /** The root provider (data source). */
    readonly provider: IProvider;
    /** Ordered list of transformers applied after reading. */
    readonly transformers: ReadonlyArray<ITransformer>;
    /** Insert a transformer at a specific position (default: end).
     *  Typically used on a cloned pipe, not the active one (clone-and-try pattern). */
    addTransformer(transformer: ITransformer, index?: number): void;
    /** Remove a transformer by type. Returns the removed transformer or undefined.
     *  Typically used on a cloned pipe, not the active one (clone-and-try pattern). */
    removeTransformer(type: string): ITransformer | undefined;
    /** Serialize pipe to a descriptor (only includes persistent transformers). */
    toDescriptor(): IPipeDescriptor;
    /** Read binary content — provider.readBinary() piped through all transformers. */
    readBinary(): Promise<Buffer>;
    /** Read as text — readBinary() then decode. Uses EncodingTransformer if present, else UTF-8. */
    readText(): Promise<string>;
    /** Write binary content — reverse-piped through transformers back to provider. */
    writeBinary?(data: Buffer): Promise<void>;
    /** Write text — encode then writeBinary(). Uses EncodingTransformer if present, else UTF-8. */
    writeText?(content: string): Promise<void>;
    /** Whether the full pipe supports writing (provider writable + all transformers reversible). */
    readonly writable: boolean;
    /** Display name for UI (delegated to provider). */
    readonly displayName: string;
    /** Watch for external changes (delegated to provider). */
    watch?(callback: (event: string) => void): ISubscriptionObject;
    /** Clone this pipe with a different provider, keeping all transformers. */
    cloneWithProvider(provider: IProvider): IContentPipe;
    /** Clone this pipe with same provider and transformers (deep copy). */
    clone(): IContentPipe;
    /** Dispose provider and transformers. */
    dispose(): void;
}
```

## Files to Create

| File | Contents |
|------|----------|
| `src/renderer/api/types/io.provider.d.ts` | `IProvider`, `IProviderStat`, `IProviderDescriptor` |
| `src/renderer/api/types/io.transformer.d.ts` | `ITransformer`, `ITransformerDescriptor` |
| `src/renderer/api/types/io.pipe.d.ts` | `IContentPipe`, `IPipeDescriptor` |

## Notes

- Event types (`IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`) are deferred to US-263
- `io.d.ts` (the `io` global namespace for scripts) is deferred to US-271
- `io.tree.d.ts` (`ITreeProvider`, `ITreeEntry`, `ITreeStat`) is deferred until tree providers are needed
- These `.d.ts` files define the **script-facing** API. Internal implementations (in `src/renderer/content/`) may have additional methods — but they must satisfy these interfaces.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: nothing
- Needed by: US-262 (FileProvider & ContentPipe), US-269 (ZipTransformer), US-275 (DecryptTransformer), US-270 (HttpProvider), US-272 (BufferProvider)
