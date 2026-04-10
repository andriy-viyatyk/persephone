# US-407: Refactor Layer 2 resolvers to use ILinkData

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** To Do
**Depends on:** US-406 (done)

## Goal

Refactor both Layer 2 resolvers in `resolvers.ts` to enrich the same ILinkData object instead of creating new `OpenContentEvent` instances. Then remove the `OpenContentEvent` adapter from `events.ts`. Also update `open-handler.ts` which uses `OpenContentEvent` as a type annotation.

## Background

### Current state after US-406

- All three pipeline channels are typed `EventChannel<ILinkData>` (US-405)
- Layer 1 parsers enrich the ILinkData in place and forward the same object (US-406)
- `OpenLinkEvent` adapter already removed (US-406)
- Two adapters remain: `RawLinkEvent` (US-409) and `OpenContentEvent` (this task)

### How resolvers currently work

Resolvers subscribe to `openLink` and dispatch to `openContent`. There are two resolvers in `resolvers.ts`:

1. **File resolver** (lines 49-84) — handles non-HTTP URLs (file paths, archives, virtual paths like `tree-category://`)
2. **HTTP resolver** (lines 143-253) — handles `http://` and `https://` URLs

Both resolvers currently:
- Read `event.url`, `event.target`, `event.metadata` from the event
- Create pipes via `createPipeFromDescriptor()`
- Dispatch to Layer 3: `new OpenContentEvent(pipe, target, event.metadata)`

### The `event.metadata` problem

The resolvers access `event.metadata` extensively — but ILinkData has no `.metadata` property. In ILinkData, metadata fields are first-class properties (`data.method`, `data.headers`, `data.browserMode`, etc.).

Current resolver reads of `event.metadata`:
- `event.metadata` passed to `resolveUrlToPipeDescriptor(event.url, event.metadata)` — reads `.method`, `.headers`, `.body`
- `event.metadata` passed to `openInRestClient(event.url, event.metadata)` — reads `.method`, `.headers`, `.body`
- `metadata?.headers` for Accept header routing (HTTP resolver)
- `metadata?.fallbackTarget` for editor fallback
- `event.metadata?.browserMode` for browser routing
- `event.metadata?.browserPageId` for browser page routing
- `event.metadata?.browserTabMode` for tab mode
- `event.metadata` passed through to `new OpenContentEvent(pipe, target, event.metadata)`

After refactoring: all these become direct reads on `data` (e.g., `data.headers`, `data.fallbackTarget`, `data.browserMode`), and forwarding is just `sendAsync(data)`.

### `resolveUrlToPipeDescriptor` — needs signature change

**File:** `src/renderer/content/link-utils.ts:63`

```typescript
export function resolveUrlToPipeDescriptor(
    url: string,
    metadata?: ILinkMetadata,   // ← change to ILinkData
): IPipeDescriptor | null { ... }
```

The function reads `metadata?.method`, `metadata?.headers`, `metadata?.body` — all first-class ILinkData properties. The only caller is `resolvers.ts`. Change signature to accept `ILinkData` directly.

The private helper `resolveHttpPipeDescriptor(url, metadata?)` also takes `ILinkMetadata` — update it too. After this change, `link-utils.ts` no longer imports `ILinkMetadata`.

### `openInRestClient` — needs signature change

**File:** `src/renderer/editors/rest-client/open-in-rest-client.ts:9`

```typescript
export async function openInRestClient(url: string, metadata?: ILinkMetadata): Promise<void>
```

Reads `metadata?.method`, `metadata?.headers`, `metadata?.body` — all on ILinkData. The only caller is `resolvers.ts`. Change signature to accept `ILinkData` directly. After this change, `open-in-rest-client.ts` no longer imports `ILinkMetadata`.

### `open-handler.ts` type annotation

**File:** `src/renderer/content/open-handler.ts:5,8`

```typescript
import type { OpenContentEvent } from "../api/events/events";

function buildSourceLink(event: OpenContentEvent, filePath: string): ISourceLink { ... }
```

Since US-405, `OpenContentEvent` is a function (not a class). As a type, it's the function signature, NOT an instance type. This type annotation is incorrect — the function reads `.pipe`, `.target`, `.metadata` from `event`, which don't exist on a function type. This needs to be changed to `ILinkData`.

Additionally, `buildSourceLink` reads `event.metadata` (which doesn't exist on ILinkData) and strips ephemeral fields to build an `ISourceLink`. This function should be updated to work with ILinkData properties directly. However, **replacing ISourceLink and refactoring the full open-handler is US-408's scope**. For US-407, we only fix the type import so the code compiles correctly.

## Implementation plan

### Step 1: Refactor resolvers.ts — file resolver (lines 49-84)

**File:** `src/renderer/content/resolvers.ts`

Before:
```typescript
app.events.openLink.subscribe(async (event) => {
    // Skip HTTP URLs — handled by HTTP resolver
    if (isHttpUrl(event.url)) return;

    const pipeDescriptor = resolveUrlToPipeDescriptor(event.url);
    if (!pipeDescriptor) {
        if (event.url.includes("://")) {
            const target = event.target || "monaco";
            const placeholder = createPipeFromDescriptor({
                provider: { type: "file", config: { path: event.url } },
                transformers: [],
            });
            await app.events.openContent.sendAsync(
                new OpenContentEvent(placeholder, target, event.metadata),
            );
            event.handled = true;
        }
        return;
    }

    const target = event.target
        || editorRegistry.resolveId(extractEffectivePath(event.url))
        || "monaco";

    const pipe = createPipeFromDescriptor(pipeDescriptor);

    // Fire Layer 3
    await app.events.openContent.sendAsync(
        new OpenContentEvent(pipe, target, event.metadata)
    );
    event.handled = true;
});
```

After:
```typescript
app.events.openLink.subscribe(async (data) => {
    // Skip HTTP URLs — handled by HTTP resolver
    if (isHttpUrl(data.url)) return;

    const pipeDescriptor = resolveUrlToPipeDescriptor(data.url);
    if (!pipeDescriptor) {
        if (data.url.includes("://")) {
            data.target ||= "monaco";
            data.pipeDescriptor = {
                provider: { type: "file", config: { path: data.url } },
                transformers: [],
            };
            data.pipe = createPipeFromDescriptor(data.pipeDescriptor);
            data.handled = false;
            await app.events.openContent.sendAsync(data);
            data.handled = true;
        }
        return;
    }

    data.target = data.target
        || editorRegistry.resolveId(extractEffectivePath(data.url))
        || "monaco";
    data.pipeDescriptor = pipeDescriptor;
    data.pipe = createPipeFromDescriptor(pipeDescriptor);

    // Fire Layer 3
    data.handled = false;
    await app.events.openContent.sendAsync(data);
    data.handled = true;
});
```

Changes:
- `event` → `data`; `.url` stays (already an ILinkData field)
- `event.target || "monaco"` → `data.target ||= "monaco"` (enriches in place)
- Set `data.pipeDescriptor` (new — persisted by the page for restore)
- Set `data.pipe` (temporal)
- Reset `data.handled = false` before forwarding, set `true` after
- No `new OpenContentEvent(...)` — forward same `data`

### Step 2: Refactor resolvers.ts — HTTP resolver (lines 143-253)

Before (key sections):
```typescript
app.events.openLink.subscribe(async (event) => {
    if (!isHttpUrl(event.url)) return;

    if (event.target === "rest-client") {
        const { openInRestClient } = await import("../editors/rest-client/open-in-rest-client");
        await openInRestClient(event.url, event.metadata);
        event.handled = true;
        return;
    }

    const metadata = event.metadata;
    // ... extension matching, Accept header routing ...
    // ... browser routing using event.metadata?.browserMode, etc. ...

    const target = event.target || mapping?.editor;
    const pipeDescriptor = resolveUrlToPipeDescriptor(event.url, event.metadata);
    if (!pipeDescriptor) return;
    const pipe = createPipeFromDescriptor(pipeDescriptor);

    await app.events.openContent.sendAsync(
        new OpenContentEvent(pipe, target, event.metadata)
    );
    event.handled = true;
});
```

After:
```typescript
app.events.openLink.subscribe(async (data) => {
    if (!isHttpUrl(data.url)) return;

    if (data.target === "rest-client") {
        const { openInRestClient } = await import("../editors/rest-client/open-in-rest-client");
        await openInRestClient(data.url, data);
        data.handled = true;
        return;
    }

    const openInBrowser = data.target === "browser";
    const effectivePath = extractEffectivePath(data.url);
    const ext = effectivePath.includes(".")
        ? effectivePath.slice(effectivePath.lastIndexOf(".")).toLowerCase()
        : "";
    let mapping = ext ? httpContentExtensions[ext] : undefined;

    // For cURL/fetch requests without file extension: use Accept header to pick editor
    if (!mapping && data.headers) {
        const accept = data.headers["accept"] || data.headers["Accept"] || "";
        if (accept.includes("json")) mapping = { editor: "monaco" };
        else if (accept.includes("xml")) mapping = { editor: "monaco" };
        else if (accept.includes("css")) mapping = { editor: "monaco" };
        else if (accept.includes("javascript")) mapping = { editor: "monaco" };
        else if (accept.includes("image/")) mapping = { editor: "image-view" };
        else if (accept.includes("pdf")) mapping = { editor: "pdf-view" };
        else if (accept.includes("text/") || accept.includes("*/*")) mapping = { editor: "monaco" };
    }

    if (!mapping && data.headers) {
        mapping = { editor: "monaco" };
    }

    if (!mapping && data.fallbackTarget) {
        mapping = { editor: data.fallbackTarget };
    }

    const hasExplicitEditorTarget = data.target && data.target !== "browser";

    const browserMode = data.browserMode;
    if (browserMode || openInBrowser || (!mapping && !hasExplicitEditorTarget)) {
        // Browser routing — uses data.browserPageId, data.browserTabMode, data.browserMode
        const browserPageId = data.browserPageId;
        if (browserPageId) {
            // ... (same logic, referencing data.url, data.browserTabMode)
        }
        // ... (same browser mode routing, referencing data.url)
        data.handled = true;
        return;
    }

    // Content pipe dispatch
    data.target = data.target || mapping?.editor;
    const pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data);
    if (!pipeDescriptor) return;

    data.pipeDescriptor = pipeDescriptor;
    data.pipe = createPipeFromDescriptor(pipeDescriptor);
    data.handled = false;
    await app.events.openContent.sendAsync(data);
    data.handled = true;
});
```

Key changes across the HTTP resolver:
- `event` → `data` throughout
- `event.metadata` → direct field access: `data.headers`, `data.fallbackTarget`, `data.browserMode`, `data.browserPageId`, `data.browserTabMode`
- `const metadata = event.metadata;` line removed — no longer needed
- `metadata?.headers` → `data.headers`; `metadata?.fallbackTarget` → `data.fallbackTarget`
- `event.metadata?.browserMode` → `data.browserMode`
- `resolveUrlToPipeDescriptor(event.url, event.metadata)` → `resolveUrlToPipeDescriptor(data.url, data)` (signature changed to ILinkData)
- `openInRestClient(event.url, event.metadata)` → `openInRestClient(data.url, data)` (signature changed to ILinkData)
- Set `data.pipeDescriptor` and `data.pipe` before forwarding
- Forward same `data` instead of `new OpenContentEvent(...)`

### Step 3: Update resolvers.ts imports

Before:
```typescript
import { app } from "../api/app";
import { OpenContentEvent } from "../api/events/events";
import { editorRegistry } from "../editors/registry";
import { isArchivePath, parseArchivePath } from "../core/utils/file-path";
import { createPipeFromDescriptor } from "./registry";
import { resolveUrlToPipeDescriptor, isHttpUrl } from "./link-utils";
```

After:
```typescript
import { app } from "../api/app";
import { editorRegistry } from "../editors/registry";
import { isArchivePath, parseArchivePath } from "../core/utils/file-path";
import { createPipeFromDescriptor } from "./registry";
import { resolveUrlToPipeDescriptor, isHttpUrl } from "./link-utils";
```

Removed: `OpenContentEvent` import.

### Step 4: Update open-handler.ts type annotation

**File:** `src/renderer/content/open-handler.ts`

Before:
```typescript
import type { OpenContentEvent } from "../api/events/events";

function buildSourceLink(event: OpenContentEvent, filePath: string): ISourceLink {
```

After:
```typescript
import type { ILinkData } from "../../shared/link-data";

function buildSourceLink(event: ILinkData, filePath: string): ISourceLink {
```

The function body reads `event.target` and `event.metadata`. `event.target` exists on ILinkData. `event.metadata` does NOT — but this function is fully refactored in US-408 (which replaces ISourceLink). For now, the type annotation fix means TypeScript will correctly flag `.metadata` access. To keep compilation clean, update `buildSourceLink` to read ILinkData properties directly:

Before (body):
```typescript
function buildSourceLink(event: OpenContentEvent, filePath: string): ISourceLink {
    const result: ISourceLink = { url: filePath };
    if (event.target && event.target !== "monaco") {
        result.target = event.target;
    }
    if (event.metadata) {
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(event.metadata)) {
            if (key === "pageId" || key === "revealLine" || key === "highlightText"
                || key === "browserMode" || key === "browserPageId" || key === "browserTabMode") continue;
            if (value !== undefined) cleaned[key] = value;
        }
        if (Object.keys(cleaned).length > 0) {
            result.metadata = cleaned;
        }
    }
    return result;
}
```

After (body — use `cleanForStorage` from link-data.ts):
```typescript
import { cleanForStorage } from "../../shared/link-data";
import type { ILinkData } from "../../shared/link-data";

function buildSourceLink(data: ILinkData, filePath: string): ISourceLink {
    const result: ISourceLink = { url: filePath };
    if (data.target && data.target !== "monaco") {
        result.target = data.target;
    }
    const cleaned = cleanForStorage(data);
    delete cleaned.target; // already on result directly
    delete cleaned.href;   // filePath is the canonical url
    delete cleaned.url;    // filePath is the canonical url
    if (Object.keys(cleaned).length > 0) {
        result.metadata = cleaned;
    }
    return result;
}
```

Also update the handler body references: `event.metadata` reads in the handler (lines 53-54, 62-64) become direct `data` property reads:

Before:
```typescript
const metadata = event.metadata;
const pageId = metadata?.pageId;
// ...
revealLine: metadata?.revealLine,
highlightText: metadata?.highlightText,
title: metadata?.title,
```

After:
```typescript
const pageId = data.pageId;
// ...
revealLine: data.revealLine,
highlightText: data.highlightText,
title: data.title,
```

### Step 5: Change `resolveUrlToPipeDescriptor` signature in link-utils.ts

**File:** `src/renderer/content/link-utils.ts`

Change the public function and private helper to accept `ILinkData` instead of `ILinkMetadata`:

Before:
```typescript
import type { ILinkMetadata } from "../api/types/io.events";

export function resolveUrlToPipeDescriptor(
    url: string,
    metadata?: ILinkMetadata,
): IPipeDescriptor | null { ... }

function resolveHttpPipeDescriptor(url: string, metadata?: ILinkMetadata): IPipeDescriptor { ... }
```

After:
```typescript
import type { ILinkData } from "../../shared/link-data";

export function resolveUrlToPipeDescriptor(
    url: string,
    data?: ILinkData,
): IPipeDescriptor | null { ... }

function resolveHttpPipeDescriptor(url: string, data?: ILinkData): IPipeDescriptor { ... }
```

The body of `resolveHttpPipeDescriptor` stays the same — it reads `data?.method`, `data?.headers`, `data?.body`, which are the same property names on ILinkData.

### Step 6: Change `openInRestClient` signature in open-in-rest-client.ts

**File:** `src/renderer/editors/rest-client/open-in-rest-client.ts`

Before:
```typescript
import type { ILinkMetadata } from "../../api/types/io.events";

export async function openInRestClient(
    url: string,
    metadata?: ILinkMetadata,
): Promise<void> { ... }
```

After:
```typescript
import type { ILinkData } from "../../../shared/link-data";

export async function openInRestClient(
    url: string,
    data?: ILinkData,
): Promise<void> { ... }
```

The body stays the same — reads `data?.method`, `data?.headers`, `data?.body`, same property names on ILinkData.

### Step 7: Remove OpenContentEvent adapter from events.ts

**File:** `src/renderer/api/events/events.ts`

Remove the function (lines 89-101 after US-406 removal):
```typescript
// DELETE:
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

Also remove `IContentPipe` import if no longer used. Check: `ILinkMetadata` is still used by `RawLinkEvent` adapter, so it stays. `ILinkData` is still used by `RawLinkEvent`, so it stays.

### Step 8: Verify

- Run `npm run lint` — no type errors
- No remaining imports of `OpenContentEvent` in source code

## Concerns

### C1: Should `resolveUrlToPipeDescriptor` and `openInRestClient` signatures change to ILinkData?

**Resolved:** Yes — change them in this task. Both functions only read `method`, `headers`, `body` which are explicit ILinkData properties. Both are only called from `resolvers.ts`. Changing signatures now avoids relying on ILinkMetadata's `[key: string]: unknown` index signature as a compatibility hack, and makes all property usage explicit and searchable. This also removes two of the remaining `ILinkMetadata` consumers, progressing toward its eventual removal.

### C3: `buildSourceLink` in open-handler.ts — how much to refactor?

**Resolved:** Minimal changes for compilation: update type annotation to `ILinkData`, use `cleanForStorage()` for ephemeral field stripping (it already strips `handled`, `pipe`, `pageId`, `revealLine`, `highlightText`, `browserMode`, `browserPageId`, `browserTabMode`, `fallbackTarget`). The full ISourceLink replacement is US-408's scope.

### C4: Setting `data.pipeDescriptor` — this is new behavior

**Resolved:** Yes, this is intentional per EPIC-023 design. The old code created a new `OpenContentEvent` that had no descriptor (only a temporal `pipe`). The new code enriches the same `data` object with both `pipeDescriptor` (for serialization/restore) and `pipe` (temporal instance). This is the right time to add it since we're already changing the dispatch pattern.

## Acceptance criteria

- [ ] Both resolvers in `resolvers.ts` enrich the same `data` object instead of creating `new OpenContentEvent(...)`
- [ ] Both resolvers set `data.pipeDescriptor` and `data.pipe` before forwarding
- [ ] Both resolvers reset `data.handled = false` before `openContent.sendAsync(data)`
- [ ] HTTP resolver reads `data.headers`, `data.fallbackTarget`, `data.browserMode`, etc. directly (no `.metadata`)
- [ ] `OpenContentEvent` import removed from `resolvers.ts`
- [ ] `OpenContentEvent` adapter function removed from `events.ts`
- [ ] `resolveUrlToPipeDescriptor` in `link-utils.ts` accepts `ILinkData` (not `ILinkMetadata`)
- [ ] `openInRestClient` in `open-in-rest-client.ts` accepts `ILinkData` (not `ILinkMetadata`)
- [ ] No `ILinkMetadata` import in `link-utils.ts` or `open-in-rest-client.ts`
- [ ] `open-handler.ts` type annotation updated from `OpenContentEvent` to `ILinkData`
- [ ] `open-handler.ts` reads `data.pageId`, `data.revealLine`, etc. directly
- [ ] `npm run lint` passes with no errors
- [ ] Existing link resolution behavior preserved (files, HTTP, browser routing, rest-client)

## Files changed

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/content/resolvers.ts` | **Modify** | Refactor both resolvers to enrich ILinkData in place |
| `src/renderer/content/open-handler.ts` | **Modify** | Update type annotation, read ILinkData properties directly |
| `src/renderer/content/link-utils.ts` | **Modify** | Change `resolveUrlToPipeDescriptor` signature from `ILinkMetadata` to `ILinkData` |
| `src/renderer/editors/rest-client/open-in-rest-client.ts` | **Modify** | Change `openInRestClient` signature from `ILinkMetadata` to `ILinkData` |
| `src/renderer/api/events/events.ts` | **Modify** | Remove `OpenContentEvent` adapter function |

## Files NOT changed

| File | Why |
|------|-----|
| `src/shared/link-data.ts` | Already has `cleanForStorage()` used by open-handler |
| `src/renderer/api/events/AppEvents.ts` | Already uses ILinkData (US-405) |
