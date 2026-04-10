# US-406: Refactor Layer 1 parsers to use ILinkData

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** To Do
**Depends on:** US-405 (done)

## Goal

Refactor all six Layer 1 parsers in `parsers.ts` to work directly with `ILinkData` objects instead of the old event properties (`event.raw`, `event.metadata`) and the temporary `OpenLinkEvent` adapter function. Then remove the `OpenLinkEvent` adapter from `events.ts`.

## Background

### Current state after US-405

US-405 retyped the three link pipeline channels to `EventChannel<ILinkData>`:

```typescript
// AppEvents.ts — already done
readonly openRawLink = new EventChannel<ILinkData>({ name: "openRawLink" });
readonly openLink = new EventChannel<ILinkData>({ name: "openLink" });
readonly openContent = new EventChannel<ILinkData>({ name: "openContent" });
```

However, the parsers in `parsers.ts` still access `event.raw` and `event.metadata` — properties that don't exist on `ILinkData`. This causes type errors. The code currently compiles only because of the temporary `OpenLinkEvent` adapter function that creates ILinkData objects.

### ILinkData property mapping

| Old property | ILinkData equivalent | Notes |
|---|---|---|
| `event.raw` | `data.href` | Raw input string |
| `event.target` | `data.target` | Same name, same semantics |
| `event.metadata` | *(no equivalent)* | Metadata fields are spread directly onto ILinkData |
| `event.metadata.method` | `data.method` | First-class ILinkData property |
| `event.metadata.headers` | `data.headers` | First-class ILinkData property |
| `event.metadata.body` | `data.body` | First-class ILinkData property |

### Pipeline enrichment pattern (EPIC-023 design)

Each layer enriches the **same** ILinkData object instead of creating new event instances:

```typescript
app.events.openRawLink.subscribe(async (data) => {
    // 1. Read from data.href (raw input)
    // 2. Enrich: set data.url, data.method, etc.
    // 3. Reset handled and forward same object:
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

### OpenLinkEvent adapter (to be removed)

```typescript
// src/renderer/api/events/events.ts:88-100 — marked "Removed in US-406"
export function OpenLinkEvent(url: string, target?: string, metadata?: ILinkMetadata): ILinkData {
    return { handled: false, href: url, url, target, ...metadata };
}
```

This adapter exists solely because parsers still call `new OpenLinkEvent(...)`. Once parsers are refactored, it has zero consumers and can be removed.

## Implementation plan

### Step 1: Refactor parsers.ts — all 6 parser functions

**File:** `src/renderer/content/parsers.ts`

**Imports — before:**
```typescript
import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";
import type { ILinkMetadata } from "../api/types/io.events";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";
import { TREE_CATEGORY_PREFIX } from "./tree-providers/tree-provider-link";
import { normalizeFileUrl, isFileUrl, isPlausibleFilePath } from "./link-utils";
```

**Imports — after:**
```typescript
import { app } from "../api/app";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";
import { TREE_CATEGORY_PREFIX } from "./tree-providers/tree-provider-link";
import { normalizeFileUrl, isFileUrl, isPlausibleFilePath } from "./link-utils";
```

Removed: `OpenLinkEvent` import and `ILinkMetadata` type import.

---

**Parser 1: File parser (lines 20-33) — fallback for file paths**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    let filePath = event.raw;
    if (isFileUrl(filePath)) {
        filePath = normalizeFileUrl(filePath);
    }
    if (!isPlausibleFilePath(filePath)) {
        const { ui } = await import("../api/ui");
        ui.notify(`Invalid file path: ${filePath}`, "warning");
        event.handled = true;
        return;
    }
    await app.events.openLink.sendAsync(new OpenLinkEvent(filePath, event.target, event.metadata));
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    let filePath = data.href;
    if (isFileUrl(filePath)) {
        filePath = normalizeFileUrl(filePath);
    }
    if (!isPlausibleFilePath(filePath)) {
        const { ui } = await import("../api/ui");
        ui.notify(`Invalid file path: ${filePath}`, "warning");
        data.handled = true;
        return;
    }
    data.url = filePath;
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

Changes: `event.raw` -> `data.href`; enrich same object (`data.url = filePath`); reset + forward; no `OpenLinkEvent`.

---

**Parser 2: Archive parser (lines 36-44)**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    if (!isArchivePath(event.raw)) return;
    let archivePath = event.raw;
    if (isFileUrl(archivePath)) {
        archivePath = normalizeFileUrl(archivePath);
    }
    await app.events.openLink.sendAsync(new OpenLinkEvent(archivePath, event.target, event.metadata));
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    if (!isArchivePath(data.href)) return;
    let archivePath = data.href;
    if (isFileUrl(archivePath)) {
        archivePath = normalizeFileUrl(archivePath);
    }
    data.url = archivePath;
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

---

**Parser 3: HTTP parser (lines 47-51)**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    if (!event.raw.startsWith("http://") && !event.raw.startsWith("https://")) return;
    await app.events.openLink.sendAsync(new OpenLinkEvent(event.raw, event.target, event.metadata));
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    if (!data.href.startsWith("http://") && !data.href.startsWith("https://")) return;
    data.url = data.href;
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

---

**Parser 4: Data URL parser (lines 54-58)**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    if (!event.raw.startsWith("data:")) return;
    await app.events.openLink.sendAsync(new OpenLinkEvent(event.raw, event.target, event.metadata));
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    if (!data.href.startsWith("data:")) return;
    data.url = data.href;
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

---

**Parser 5: Tree category parser (lines 61-67)**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    if (!event.raw.startsWith(TREE_CATEGORY_PREFIX)) return;
    await app.events.openLink.sendAsync(
        new OpenLinkEvent(event.raw, event.target ?? "category-view", event.metadata),
    );
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    if (!data.href.startsWith(TREE_CATEGORY_PREFIX)) return;
    data.url = data.href;
    data.target ??= "category-view";
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

Note: `data.target ??= "category-view"` — uses nullish assignment to default target only if caller didn't set it. The old code passed a new target value to `OpenLinkEvent` without persisting it back on the original event; the new code enriches in place.

---

**Parser 6: cURL/fetch parser (lines 70-86)**

Before:
```typescript
app.events.openRawLink.subscribe(async (event) => {
    const trimmed = event.raw.trim();
    if (!/^(curl\s|fetch\()/i.test(trimmed)) return;

    const parsed = parseHttpRequest(trimmed);
    if (!parsed) return;

    const metadata: ILinkMetadata = {};
    if (parsed.method !== "GET") metadata.method = parsed.method;
    if (Object.keys(parsed.headers).length > 0) metadata.headers = parsed.headers;
    if (parsed.body) metadata.body = parsed.body;

    // Merge cURL metadata with caller metadata (caller overrides)
    const merged = event.metadata ? { ...metadata, ...event.metadata } : metadata;
    await app.events.openLink.sendAsync(new OpenLinkEvent(parsed.url, event.target, merged));
    event.handled = true;
});
```

After:
```typescript
app.events.openRawLink.subscribe(async (data) => {
    const trimmed = data.href.trim();
    if (!/^(curl\s|fetch\()/i.test(trimmed)) return;

    const parsed = parseHttpRequest(trimmed);
    if (!parsed) return;

    // Set cURL-parsed fields, but don't override caller-provided values
    if (parsed.method !== "GET") data.method ??= parsed.method;
    if (Object.keys(parsed.headers).length > 0) data.headers ??= parsed.headers;
    if (parsed.body) data.body ??= parsed.body;

    data.url = parsed.url;
    data.handled = false;
    await app.events.openLink.sendAsync(data);
    data.handled = true;
});
```

Key change: The old code created a temporary `ILinkMetadata` object and merged it with caller metadata (caller wins). The new code writes parsed fields directly on `data` using `??=` (nullish assignment) — this achieves the same "caller overrides" behavior because caller fields are already on `data`.

---

### Step 2: Remove OpenLinkEvent adapter from events.ts

**File:** `src/renderer/api/events/events.ts`

Remove the `OpenLinkEvent` function (lines 88-100):

```typescript
// DELETE this entire block:
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
```

Also remove the `ILinkMetadata` import if it becomes unused after this removal. Check whether `RawLinkEvent` or `OpenContentEvent` still use it — yes, both do (`...metadata` spread), so the import stays.

### Step 3: Verify

- Run `npm run lint` — no type errors in parsers.ts or events.ts
- No other file imports `OpenLinkEvent`

## Concerns

### C1: cURL parser "caller overrides" semantics preserved?

**Resolved:** Yes. The original code used `{ ...cURLMetadata, ...callerMetadata }` (spread order means caller wins). The new code uses `data.field ??= parsedValue` — since caller fields are already on `data`, `??=` only writes if the field is `undefined`. Same behavior.

### C2: Tree category parser `target ??= "category-view"` — side effect on caller's object?

**Resolved:** This is the intended EPIC-023 design. Each layer enriches the same object. The old code created a new `OpenLinkEvent` with the overridden target, which means the original event's `target` was left as-is but a new object was sent downstream. In the new flow, the caller's `data.target` gets defaulted in-place. This is correct — the caller either set a target (preserved) or didn't (gets the default).

### C3: `data.handled = false` before `sendAsync` — is this necessary?

**Resolved:** Yes. The `data` object arrives with `handled: false` from the caller, but within `sendAsync()` the LIFO dispatch checks `event.handled` to short-circuit. After `sendAsync` returns from the next layer, we set `handled = true` so the current layer's dispatch also stops. Resetting to `false` before forwarding ensures the next layer starts clean. This matches the EPIC-023 design pattern.

## Acceptance criteria

- [ ] All 6 parsers in `parsers.ts` use `data.href` instead of `event.raw`
- [ ] All 6 parsers enrich the same `data` object (set `data.url`, etc.) instead of creating `new OpenLinkEvent(...)`
- [ ] All 6 parsers reset `data.handled = false` before forwarding to `openLink.sendAsync(data)`
- [ ] No `ILinkMetadata` import in `parsers.ts`
- [ ] No `OpenLinkEvent` import in `parsers.ts`
- [ ] `OpenLinkEvent` adapter function removed from `events.ts`
- [ ] `npm run lint` passes with no errors
- [ ] Existing link opening behavior preserved (files, archives, HTTP, data URLs, tree categories, cURL/fetch)

## Files changed

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/content/parsers.ts` | **Modify** | Refactor all 6 parsers to use ILinkData directly |
| `src/renderer/api/events/events.ts` | **Modify** | Remove `OpenLinkEvent` adapter function |
