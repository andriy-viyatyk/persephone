# Task 2 Phase C: Type Alignment & IoNamespace Completeness

## Goal

Replace `Record<string, unknown>` with `ILinkMetadata` in event classes and type definitions, expose `OpenContentEvent` in the script `io` namespace, and add the missing `IOpenContentEventConstructor` type.

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `src/renderer/api/events/events.ts` | Change `metadata` type from `Record<string, unknown>` to `ILinkMetadata` in `OpenLinkEvent` and `OpenContentEvent` |
| 2 | `src/renderer/api/types/io.d.ts` | Change `IOpenLinkEventConstructor` to use `ILinkMetadata`; add `IOpenContentEventConstructor`; add `OpenContentEvent` and `ILinkMetadata` to `IIoNamespace` |
| 3 | `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Import and export `OpenContentEvent` |
| 4 | `src/renderer/content/resolvers.ts` | Remove redundant `as Record<string, unknown>` cast on line 144 (now properly typed) |
| 5 | `src/renderer/content/open-handler.ts` | Remove redundant `as Record<string, unknown>` cast on line 15 (now properly typed) |
| 6 | `src/renderer/content/parsers.ts` | Change local `metadata` variable type from `Record<string, unknown>` to `ILinkMetadata` on line 86 |
| 7 | `assets/editor-types/io.d.ts` | Mirror changes from `src/renderer/api/types/io.d.ts` |
| 8 | `assets/editor-types/io.events.d.ts` | No change needed (already uses `ILinkMetadata`) |

## Implementation Plan

### Step 1: Update `OpenLinkEvent` and `OpenContentEvent` classes

**File:** `src/renderer/api/events/events.ts`

Add import for `ILinkMetadata` (it is a type-only import from `io.events.d.ts`, which is a `.d.ts` ambient file in the `types` folder):

```typescript
// BEFORE (line 4):
import type { IContentPipe } from "../types/io.pipe";

// AFTER:
import type { IContentPipe } from "../types/io.pipe";
import type { ILinkMetadata } from "../types/io.events";
```

Change `OpenLinkEvent.metadata`:

```typescript
// BEFORE (lines 76-84):
export class OpenLinkEvent extends BaseEvent {
    constructor(
        public readonly url: string,
        public target?: string,
        public metadata?: Record<string, unknown>,
    ) {
        super();
    }
}

// AFTER:
export class OpenLinkEvent extends BaseEvent {
    constructor(
        public readonly url: string,
        public target?: string,
        public metadata?: ILinkMetadata,
    ) {
        super();
    }
}
```

Change `OpenContentEvent.metadata`:

```typescript
// BEFORE (lines 87-95):
export class OpenContentEvent extends BaseEvent {
    constructor(
        public readonly pipe: IContentPipe,
        public readonly target: string,
        public readonly metadata?: Record<string, unknown>,
    ) {
        super();
    }
}

// AFTER:
export class OpenContentEvent extends BaseEvent {
    constructor(
        public readonly pipe: IContentPipe,
        public readonly target: string,
        public readonly metadata?: ILinkMetadata,
    ) {
        super();
    }
}
```

### Step 2: Update `IOpenLinkEventConstructor` and add `IOpenContentEventConstructor`

**File:** `src/renderer/api/types/io.d.ts`

Change `IOpenLinkEventConstructor`:

```typescript
// BEFORE (lines 64-70):
export interface IOpenLinkEventConstructor {
    new(url: string, target?: string, metadata?: Record<string, unknown>): IBaseEvent & {
        readonly url: string;
        target?: string;
        metadata?: Record<string, unknown>;
    };
}

// AFTER:
export interface IOpenLinkEventConstructor {
    new(url: string, target?: string, metadata?: ILinkMetadata): IBaseEvent & {
        readonly url: string;
        target?: string;
        metadata?: ILinkMetadata;
    };
}
```

Add `IOpenContentEventConstructor` after `IOpenLinkEventConstructor`:

```typescript
/**
 * Open content event constructor — Layer 3 input.
 * @example
 * const pipe = io.createPipe(new io.FileProvider("C:\\data.txt"));
 * await app.events.openContent.sendAsync(new io.OpenContentEvent(pipe, "monaco", {
 *     revealLine: 42,
 * }));
 */
export interface IOpenContentEventConstructor {
    new(pipe: IContentPipe, target: string, metadata?: ILinkMetadata): IBaseEvent & {
        readonly pipe: IContentPipe;
        readonly target: string;
        readonly metadata?: ILinkMetadata;
    };
}
```

Add `OpenContentEvent` and `ILinkMetadata` to `IIoNamespace`:

```typescript
// BEFORE (lines 96-111):
export interface IIoNamespace {
    /** Provider for local binary files. */
    readonly FileProvider: IFileProviderConstructor;
    /** Provider for HTTP/HTTPS URLs (read-only). */
    readonly HttpProvider: IHttpProviderConstructor;
    /** Transformer for ZIP archive entry extraction/replacement. */
    readonly ZipTransformer: IZipTransformerConstructor;
    /** Transformer for AES-GCM decryption/encryption (non-persistent). */
    readonly DecryptTransformer: IDecryptTransformerConstructor;
    /** Raw link event constructor for Layer 1 (openRawLink). */
    readonly RawLinkEvent: IRawLinkEventConstructor;
    /** Open link event constructor for Layer 2 (openLink). */
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}

// AFTER:
export interface IIoNamespace {
    /** Provider for local binary files. */
    readonly FileProvider: IFileProviderConstructor;
    /** Provider for HTTP/HTTPS URLs (read-only). */
    readonly HttpProvider: IHttpProviderConstructor;
    /** Transformer for ZIP archive entry extraction/replacement. */
    readonly ZipTransformer: IZipTransformerConstructor;
    /** Transformer for AES-GCM decryption/encryption (non-persistent). */
    readonly DecryptTransformer: IDecryptTransformerConstructor;
    /** Raw link event constructor for Layer 1 (openRawLink). */
    readonly RawLinkEvent: IRawLinkEventConstructor;
    /** Open link event constructor for Layer 2 (openLink). */
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    /** Open content event constructor for Layer 3 (openContent). */
    readonly OpenContentEvent: IOpenContentEventConstructor;
    /** Metadata type for link pipeline events. */
    readonly ILinkMetadata: ILinkMetadata;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
```

**Note on `ILinkMetadata` re-export:** `ILinkMetadata` is an interface (not a class), so it cannot be a runtime value on the `io` namespace. Instead, re-export it as a type only. The correct approach is to NOT add it as a property on `IIoNamespace` (since it has no runtime value), but instead ensure it is importable from the type system. Since `io.events.d.ts` is already in `assets/editor-types/` and loaded by Monaco, `ILinkMetadata` is already discoverable by scripts via `ILinkMetadata` directly. See **Concern #2** below.

**Revised `IIoNamespace`** (without the `ILinkMetadata` property):

```typescript
export interface IIoNamespace {
    /** Provider for local binary files. */
    readonly FileProvider: IFileProviderConstructor;
    /** Provider for HTTP/HTTPS URLs (read-only). */
    readonly HttpProvider: IHttpProviderConstructor;
    /** Transformer for ZIP archive entry extraction/replacement. */
    readonly ZipTransformer: IZipTransformerConstructor;
    /** Transformer for AES-GCM decryption/encryption (non-persistent). */
    readonly DecryptTransformer: IDecryptTransformerConstructor;
    /** Raw link event constructor for Layer 1 (openRawLink). */
    readonly RawLinkEvent: IRawLinkEventConstructor;
    /** Open link event constructor for Layer 2 (openLink). */
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    /** Open content event constructor for Layer 3 (openContent). */
    readonly OpenContentEvent: IOpenContentEventConstructor;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
```

### Step 3: Expose `OpenContentEvent` in IoNamespace

**File:** `src/renderer/scripting/api-wrapper/IoNamespace.ts`

```typescript
// BEFORE (line 6):
import { RawLinkEvent, OpenLinkEvent } from "../../api/events/events";

// AFTER:
import { RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "../../api/events/events";
```

```typescript
// BEFORE (lines 28-30):
        // Event constructors
        RawLinkEvent,
        OpenLinkEvent,

// AFTER:
        // Event constructors
        RawLinkEvent,
        OpenLinkEvent,
        OpenContentEvent,
```

### Step 4: Remove redundant casts in resolvers.ts

**File:** `src/renderer/content/resolvers.ts`

```typescript
// BEFORE (line 144):
        const metadata = event.metadata as Record<string, unknown> | undefined;

// AFTER:
        const metadata = event.metadata;
```

The `forceBrowser` access on line 145 (`metadata?.forceBrowser`) is valid because `ILinkMetadata` has an index signature `[key: string]: unknown`, so any property access is allowed. The `as boolean | undefined` cast on `forceBrowser` remains correct.

However, the `as Record<string, string>` cast on line 154 for `metadata.headers` is also no longer needed since `ILinkMetadata.headers` is already typed as `Record<string, string> | undefined`. Same for lines 190-193 where `metadata?.method`, `metadata?.headers`, and `metadata?.body` are cast. After this change, those casts become redundant too.

Updated block (lines 144-145, 153-154, 189-193):

```typescript
// line 144 — BEFORE:
        const metadata = event.metadata as Record<string, unknown> | undefined;
        const forceBrowser = metadata?.forceBrowser as boolean | undefined;
// line 144 — AFTER:
        const metadata = event.metadata;
        const forceBrowser = metadata?.forceBrowser as boolean | undefined;

// lines 153-154 — BEFORE:
            const headers = metadata.headers as Record<string, string>;
// lines 153-154 — AFTER (no cast needed, ILinkMetadata.headers is already Record<string, string>):
            const headers = metadata.headers!;

// lines 189-193 — BEFORE:
        const httpOptions = {
            method: metadata?.method as string | undefined,
            headers: metadata?.headers as Record<string, string> | undefined,
            body: metadata?.body as string | undefined,
        };
// lines 189-193 — AFTER:
        const httpOptions = {
            method: metadata?.method,
            headers: metadata?.headers,
            body: metadata?.body,
        };
```

### Step 5: Remove redundant cast in open-handler.ts

**File:** `src/renderer/content/open-handler.ts`

```typescript
// BEFORE (line 15):
        const metadata = event.metadata as Record<string, unknown> | undefined;
        const pageId = metadata?.pageId as string | undefined;

// AFTER:
        const metadata = event.metadata;
        const pageId = metadata?.pageId;
```

Lines 23-24 (`metadata?.revealLine as number | undefined` and `metadata?.highlightText as string | undefined`) also become redundant:

```typescript
// BEFORE (lines 22-24):
                await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: metadata?.revealLine as number | undefined,
                    highlightText: metadata?.highlightText as string | undefined,
                });

// AFTER:
                await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: metadata?.revealLine,
                    highlightText: metadata?.highlightText,
                });
```

### Step 6: Update local variable type in parsers.ts

**File:** `src/renderer/content/parsers.ts`

```typescript
// BEFORE (line 86):
        const metadata: Record<string, unknown> = {};

// AFTER:
        const metadata: ILinkMetadata = {};
```

Add import:

```typescript
// BEFORE (line 1-4):
import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";

// AFTER:
import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";
import type { ILinkMetadata } from "../api/types/io.events";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";
```

### Step 7: Copy updated .d.ts to assets/editor-types/

**File:** `assets/editor-types/io.d.ts`

This file is currently identical to `src/renderer/api/types/io.d.ts`. After modifying the source, copy the updated content to `assets/editor-types/io.d.ts`.

`assets/editor-types/io.events.d.ts` needs NO change — it already uses `ILinkMetadata` throughout.

## Call Site Audit

All call sites that construct `OpenLinkEvent` or `OpenContentEvent` with metadata:

| # | File | Line | Expression | Compatible with `ILinkMetadata`? |
|---|------|------|-----------|--------------------------------|
| 1 | `src/renderer/content/parsers.ts` | 56 | `new OpenLinkEvent(filePath)` | Yes (no metadata) |
| 2 | `src/renderer/content/parsers.ts` | 67 | `new OpenLinkEvent(archivePath)` | Yes (no metadata) |
| 3 | `src/renderer/content/parsers.ts` | 74 | `new OpenLinkEvent(event.raw)` | Yes (no metadata) |
| 4 | `src/renderer/content/parsers.ts` | 91 | `new OpenLinkEvent(parsed.url, undefined, metadata)` | Yes after Step 6 (local var typed as `ILinkMetadata`) |
| 5 | `src/renderer/content/resolvers.ts` | 78 | `new OpenContentEvent(pipe, target, event.metadata)` | Yes (`event.metadata` will be `ILinkMetadata`) |
| 6 | `src/renderer/content/resolvers.ts` | 209 | `new OpenContentEvent(pipe, target, event.metadata)` | Yes (`event.metadata` will be `ILinkMetadata`) |

No other source files construct these events. The remaining matches are all in `/doc/` documentation files (not compiled code).

## Concerns

### 1. `forceBrowser` is not a named property on `ILinkMetadata`

`resolvers.ts` line 145 reads `metadata?.forceBrowser`. This is valid because `ILinkMetadata` has an index signature `[key: string]: unknown`, so arbitrary properties are allowed. However, if `forceBrowser` is a recognized concept, it may deserve its own named optional property on `ILinkMetadata` for discoverability. This is a separate enhancement and should NOT be done in this phase unless the user requests it.

### 2. `ILinkMetadata` re-export for script discoverability

`ILinkMetadata` is defined in `io.events.d.ts` which is already present in `assets/editor-types/`. Monaco loads all `.d.ts` files from that folder, so `ILinkMetadata` is already available as a type in the script editor. There is no need to add it as a runtime property on the `io` namespace (interfaces have no runtime representation). No additional re-export is needed.

### 3. Index signature on `ILinkMetadata` preserves backward compatibility

Because `ILinkMetadata` includes `[key: string]: unknown`, any code that was passing arbitrary properties via `Record<string, unknown>` will continue to work. This change is fully backward-compatible.

### 4. Cast removal scope

Steps 4 and 5 remove `as Record<string, unknown>` casts that become redundant. If preferred, these can be kept as-is for a smaller diff — the code will work either way. Removing them is cleaner since the proper types now flow through.

## Testing Notes

1. **TypeScript compilation** — Run `npm run lint` to verify no type errors after all changes.
2. **Open a file via file explorer** — Verifies parsers.ts and resolvers.ts file path flow.
3. **Open a URL** — Paste `https://raw.githubusercontent.com/.../some-file.json` to verify HTTP resolver flow.
4. **Open a cURL command** — Paste a cURL command to verify metadata (method/headers/body) flows through as `ILinkMetadata`.
5. **Script API** — In script editor, verify `io.OpenContentEvent` appears in autocomplete and `ILinkMetadata` is recognized as a type.
6. **Open archive file** — Open a `.zip!entry` path to verify archive resolver still works.
