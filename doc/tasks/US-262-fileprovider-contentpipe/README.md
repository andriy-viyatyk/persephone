# US-262: FileProvider & ContentPipe

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement `FileProvider` (binary file I/O with watch support) and `ContentPipe` (provider + transformer chain assembler). Also implement `createPipeFromDescriptor()` factory and a provider/transformer registry for descriptor-based reconstruction.

## Why

- `FileProvider` is the first concrete provider — needed by all subsequent pipeline tasks
- `ContentPipe` is the core assembler that chains provider + transformers — every pipe flows through it
- `createPipeFromDescriptor()` is needed by pipe serialization (US-276) and restore flow

## Background

### What FileProvider replaces

Currently `app.fs` (`src/renderer/api/fs.ts`) handles all file I/O with archive transparency (detects `!` in paths, delegates to `archiveService`). `FileWatcher` (`src/renderer/core/utils/file-watcher.ts`) handles external change detection.

With the new architecture:
- **FileProvider** handles plain binary file read/write (no archive logic — that moves to `ZipTransformer` in US-269)
- **FileProvider.watch()** wraps native `fs.watch()` with debounced callbacks (same pattern as current `FileWatcher`)
- **FileProvider.stat()** returns file metadata
- `app.fs` remains for non-pipe operations (dialogs, cache management, data files, etc.)

### ContentPipe responsibilities

- Chain `provider.readBinary()` through ordered `transformer.read()` calls
- Reverse-chain `transformer.write()` back to `provider.writeBinary()` for saves
- `readText()` / `writeText()` convenience: decode/encode UTF-8 (EncodingTransformer support added later in US-268)
- `clone()` / `cloneWithProvider()` for clone-and-try pattern
- `addTransformer()` / `removeTransformer()` for pipe manipulation
- `toDescriptor()` serialization (only persistent transformers)
- `dispose()` cleanup

### Provider/transformer registry

`createPipeFromDescriptor()` needs to reconstruct providers and transformers from `{ type, config }` descriptors. A simple registry maps type strings to factory functions:

```typescript
const providerRegistry = new Map<string, (config: Record<string, unknown>) => IProvider>();
const transformerRegistry = new Map<string, (config: Record<string, unknown>) => ITransformer>();
```

For now only `"file"` provider is registered. US-269, US-270, US-272, US-275 register their types.

## Acceptance Criteria

- [ ] `FileProvider` implements `IProvider` — binary read/write, stat, watch, dispose, toDescriptor
- [ ] `FileProvider` uses `nodefs` directly for file I/O (not `app.fs` — avoids archive transparency)
- [ ] `FileProvider.watch()` uses native `fs.watch()` with debounced callbacks
- [ ] `ContentPipe` implements `IContentPipe` — full read/write chain, clone, dispose, toDescriptor
- [ ] `ContentPipe.readText()` decodes buffer as UTF-8 by default
- [ ] `ContentPipe.writeText()` encodes string as UTF-8 by default
- [ ] `clone()` creates a deep copy (new provider instance, new transformer instances via descriptors)
- [ ] `cloneWithProvider()` creates a new pipe with different provider, same transformers
- [ ] `addTransformer()` / `removeTransformer()` work on the pipe's transformer list
- [ ] `toDescriptor()` only includes persistent transformers
- [ ] `createPipeFromDescriptor()` reconstructs pipe from `IPipeDescriptor`
- [ ] Provider and transformer registries exist with registration functions
- [ ] `"file"` provider type registered
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create folder structure

```
src/renderer/content/
  ContentPipe.ts
  registry.ts
  providers/
    FileProvider.ts
```

### Step 2: Implement FileProvider

File: `src/renderer/content/providers/FileProvider.ts`

```typescript
import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import type { SubscriptionObject } from "../../api/events/EventChannel";
import { debounce } from "../../../shared/utils";

const nodefs = require("fs");

export class FileProvider implements IProvider {
    readonly type = "file";
    readonly restorable = true;
    readonly writable = true;
    readonly sourceUrl: string;
    readonly displayName: string;

    constructor(private readonly filePath: string) {
        this.sourceUrl = filePath;
        // Extract filename from path for display
        this.displayName = filePath.split(/[/\\]/).pop() || filePath;
    }

    async readBinary(): Promise<Buffer> {
        return nodefs.readFileSync(this.filePath);
    }

    async writeBinary(data: Buffer): Promise<void> {
        nodefs.writeFileSync(this.filePath, data);
    }

    async stat(): Promise<IProviderStat> {
        try {
            const stats = nodefs.statSync(this.filePath);
            return {
                size: stats.size,
                mtime: new Date(stats.mtime).toISOString(),
                exists: true,
            };
        } catch {
            return { exists: false };
        }
    }

    watch(callback: (event: string) => void): SubscriptionObject {
        const debouncedCallback = debounce((event: string) => {
            callback(event);
        }, 300);

        try {
            const watcher = nodefs.watch(this.filePath, (eventType: string) => {
                debouncedCallback(eventType);
            });
            return {
                unsubscribe: () => watcher.close(),
            };
        } catch {
            return {
                unsubscribe: () => {},
            };
        }
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "file",
            config: { path: this.filePath },
        };
    }

    dispose(): void {
        // FileProvider has no resources to release.
        // Watch subscriptions are managed by the caller via unsubscribe().
    }
}
```

Key decisions:
- Uses `nodefs` directly (not `app.fs`) — no archive path transparency
- `readBinary()` / `writeBinary()` are sync under the hood (same as current `fs.ts` pattern) but return Promises per interface
- `watch()` returns `SubscriptionObject` (same shape as `ISubscriptionObject` from events.d.ts)
- `displayName` extracts filename from path

### Step 3: Implement ContentPipe

File: `src/renderer/content/ContentPipe.ts`

Core read flow:
```
provider.readBinary() → transformer[0].read(bytes) → transformer[1].read(bytes) → ... → result
```

Core write flow (reverse):
```
content → ... → transformer[1].write(content, original[1]) → transformer[0].write(content, original[0]) → provider.writeBinary()
```

The write flow needs the original bytes at each stage (for ZipTransformer to rebuild the archive). On write:
1. Read original bytes from provider
2. For each transformer in forward order, apply `read()` to get the original bytes at that stage
3. Walk transformers in reverse, calling `write(newData, originalAtThisStage)`
4. Write final result to provider

`readText()` / `writeText()`:
- `readText()`: call `readBinary()` then decode as UTF-8 (`Buffer.toString("utf-8")`)
- `writeText()`: encode as UTF-8 (`Buffer.from(content, "utf-8")`) then call `writeBinary()`
- When EncodingTransformer is added (US-268), it handles non-UTF-8 in the transformer chain

`clone()`:
- Reconstruct via `createPipeFromDescriptor(this.toDescriptor())` — round-trips through descriptors
- This only preserves persistent transformers (by design — DecryptTransformer is stripped)
- Note: clone() for clone-and-try needs ALL transformers (including non-persistent). So clone() should create a direct copy, not go through descriptors.

Revised `clone()` approach:
- Direct copy: new ContentPipe with same provider (reconstructed from descriptor) and new transformer instances (reconstructed from constructors or a clone method)
- Simplest: store the transformer constructors or use a registry-based reconstruction

Actually, the simplest approach: `clone()` creates a new `ContentPipe` with the same provider reference and copies the transformer array. Transformers are stateless (they just have `read`/`write` + config), so sharing references is safe. The provider is also stateless for reads. The `dispose()` on the clone should NOT dispose the shared provider — only the "owner" pipe disposes.

This means we need ownership tracking. Simpler alternative: `clone()` reconstructs provider from descriptor (new instance) and reconstructs ALL transformers from their descriptors (new instances). Non-persistent transformers still have `toDescriptor()` — it's just not included in `pipe.toDescriptor()`.

### Step 4: Implement registry

File: `src/renderer/content/registry.ts`

```typescript
type ProviderFactory = (config: Record<string, unknown>) => IProvider;
type TransformerFactory = (config: Record<string, unknown>) => ITransformer;

const providers = new Map<string, ProviderFactory>();
const transformers = new Map<string, TransformerFactory>();

export function registerProvider(type: string, factory: ProviderFactory): void { ... }
export function registerTransformer(type: string, factory: TransformerFactory): void { ... }
export function createProviderFromDescriptor(descriptor: IProviderDescriptor): IProvider { ... }
export function createTransformerFromDescriptor(descriptor: ITransformerDescriptor): ITransformer { ... }
export function createPipeFromDescriptor(descriptor: IPipeDescriptor): IContentPipe { ... }
```

Register FileProvider:
```typescript
registerProvider("file", (config) => new FileProvider(config.path as string));
```

### Step 5: Convenience factory

File: `src/renderer/content/ContentPipe.ts` (exported function)

```typescript
export function createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe {
    return new ContentPipe(provider, transformers);
}
```

## Files to Create

| File | Contents |
|------|----------|
| `src/renderer/content/providers/FileProvider.ts` | `FileProvider` class implementing `IProvider` |
| `src/renderer/content/ContentPipe.ts` | `ContentPipe` class implementing `IContentPipe`, `createPipe()` |
| `src/renderer/content/registry.ts` | Provider/transformer registries, `createPipeFromDescriptor()`, registers `"file"` type |

## Design Decisions

### FileProvider does NOT handle archive paths
Archive transparency (`!` detection) was in `app.fs`. In the new architecture, `FileProvider` reads plain files. Archive support comes from `FileProvider + ZipTransformer` (US-269).

### ContentPipe.clone() reconstructs from descriptors + transformer registry
`clone()` creates new provider and transformer instances via the registry. For non-persistent transformers (DecryptTransformer), `clone()` must still reconstruct them — so it uses each transformer's `toDescriptor()` (which exists even for non-persistent ones) and the transformer registry.

### ContentPipe write flow needs original bytes
ZipTransformer.write() needs the original ZIP archive bytes to replace one entry. The write chain must first read originals at each transformer stage, then walk backwards applying `write(newData, originals)`.

### readText()/writeText() default to UTF-8
No EncodingTransformer exists yet. These convenience methods do simple UTF-8 encode/decode. When EncodingTransformer is added in US-268, the transformer chain handles encoding transparently — `readBinary()` returns UTF-8 bytes (after EncodingTransformer converts), and `readText()` just does `buffer.toString("utf-8")`.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-261 (interfaces)
- Needed by: US-265 (pipe resolvers), US-269 (ZipTransformer), US-276 (pipe serialization), US-268 (TextFileIOModel migration)
