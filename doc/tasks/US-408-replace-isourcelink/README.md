# US-408: Refactor Layer 3 open handler and replace ISourceLink

**Epic:** [EPIC-023 — Unified ILinkData Pipeline](../../epics/EPIC-023.md)
**Status:** To Do
**Depends on:** US-407 (done)

## Goal

Replace the `ISourceLink` interface with `Partial<ILinkData>` everywhere pages store source link data. After this task, the ILinkData shape is used end-to-end — from pipeline entry through page storage — with no intermediate `ISourceLink` wrapper.

## Background

### Current state after US-407

- The full pipeline (`openRawLink` → `openLink` → `openContent`) flows ILinkData objects
- All three adapter functions are removed (`RawLinkEvent` remains for callers — US-409)
- `open-handler.ts` already uses `ILinkData` type and `cleanForStorage()`, but still constructs an `ISourceLink` object

### What ISourceLink looks like

```typescript
// src/shared/types.ts:8-15
export interface ISourceLink {
    url: string;
    target?: string;
    metadata?: Record<string, unknown>;
}
```

This wraps a subset of ILinkData in a different shape: `url` (resolved), `target`, and a generic `metadata` bag. The new approach stores `Partial<ILinkData>` directly — all fields are first-class and searchable.

### How `buildSourceLink()` currently works

```typescript
// src/renderer/content/open-handler.ts:9-27
function buildSourceLink(data: ILinkData, filePath: string): ISourceLink {
    const result: ISourceLink = { url: filePath };
    if (data.target && data.target !== "monaco") {
        result.target = data.target;
    }
    const cleaned = cleanForStorage(data);
    delete cleaned.target;
    delete cleaned.href;
    delete cleaned.url;
    if (Object.keys(cleaned).length > 0) {
        result.metadata = cleaned;
    }
    return result;
}
```

After this task, it simplifies to:
```typescript
const sourceLink = cleanForStorage(data);
sourceLink.url = filePath;  // Override with reconstructed path
```

### Consumers of `.sourceLink` on pages

| File | Usage |
|---|---|
| `PagesLifecycleModel.ts:300` | `openFile()` option type: `sourceLink?: ISourceLink` |
| `PagesLifecycleModel.ts:454` | `navigatePageTo()` option type: `sourceLink?: ISourceLink` |
| `PagesLifecycleModel.ts:314,500` | Writes `s.sourceLink = options.sourceLink` |
| `ArchiveEditorModel.ts:94` | Reads `sourceLink?.url` to track selected archive entry |
| `ArchiveEditorModel.ts:117` | Reads `sourceLink?.metadata?.sourceId` to detect archive provenance |
| `EditorModel.ts:100` | Docstring references `sourceLink?.metadata?.sourceId` |
| `EditorModel.ts:154` | `applyRestoreData()` restores sourceLink from persistence |

### What changes for each consumer

- `sourceLink?.url` → stays `sourceLink?.url` (same field on ILinkData)
- `sourceLink?.metadata?.sourceId` → `sourceLink?.sourceId` (sourceId is a first-class ILinkData field)
- Type annotations `ISourceLink` → `Partial<ILinkData>`

### Backward compatibility with persisted data

Existing persisted pages have `sourceLink` in the old `ISourceLink` shape (`{ url, target?, metadata? }`). Since `Partial<ILinkData>` also has `url` and `target`, existing `.url` and `.target` reads continue to work. The `metadata?.sourceId` read is the only one that breaks — but `applyRestoreData` restores the raw persisted JSON, so old pages will have `{ url, target, metadata: { sourceId: "..." } }` while new pages have `{ url, target, sourceId: "..." }`.

The `_isOpenedFromThisArchive` check needs to handle both shapes during the transition:
```typescript
return (sourceLink?.sourceId ?? (sourceLink?.metadata as any)?.sourceId) === this.id;
```

## Implementation plan

### Step 0: Make ILinkData fully optional (prerequisite)

Make `handled` and `href` optional on ILinkData so the type works for both pipeline events and storage without needing `Partial<>`.

**File:** `src/renderer/api/types/io.link-data.d.ts`

Before:
```typescript
    handled: boolean;
    href: string;
```

After:
```typescript
    handled?: boolean;
    href?: string;
```

**File:** `assets/editor-types/io.link-data.d.ts` — mirror the same change.

**File:** `src/renderer/api/events/EventChannel.ts` (line 20)

Before:
```typescript
export class EventChannel<TEvent extends { handled: boolean }> {
```

After:
```typescript
export class EventChannel<TEvent extends { handled?: boolean }> {
```

No behavioral change — `sendAsync` already uses `if (event.handled)` (line 86), which treats `undefined` as falsy.

**File:** `src/renderer/api/types/events.d.ts` — update the script-visible constraint:

Before:
```typescript
export interface IEventChannel<T extends { handled: boolean }> {
```

After:
```typescript
export interface IEventChannel<T extends { handled?: boolean }> {
```

**File:** `assets/editor-types/events.d.ts` — mirror the same change.

**File:** `src/shared/link-data.ts` — update `createLinkData` return and `cleanForStorage` return type:

`cleanForStorage` currently returns `Partial<ILinkData>`. Since ILinkData is now fully optional, it can return `ILinkData` directly.

Before:
```typescript
export function cleanForStorage(data: ILinkData): Partial<ILinkData> {
```

After:
```typescript
export function cleanForStorage(data: ILinkData): ILinkData {
```

No other code changes — `createLinkData(href, options)` still takes `href` as a required function parameter and always sets `handled: false`. Pipeline objects always have both fields at runtime.

### Step 1: Update IEditorState in shared/types.ts

**File:** `src/shared/types.ts`

Remove `ISourceLink` interface. Change `sourceLink` field type on `IEditorState` to `ILinkData` (no `Partial` needed since all fields are now optional).

Before:
```typescript
export interface ISourceLink {
    url: string;
    target?: string;
    metadata?: Record<string, unknown>;
}

export interface IEditorState {
    // ...
    sourceLink?: ISourceLink,
    // ...
}
```

After:
```typescript
import type { ILinkData } from "../renderer/api/types/io.link-data";

export interface IEditorState {
    // ...
    /** The link that opened this page — persisted across restarts. Cleaned via cleanForStorage(). */
    sourceLink?: ILinkData,
    // ...
}
```

Note: `src/shared/types.ts` is a shared module (used by both main and renderer). It currently has no imports. Adding `import type` from `io.link-data.d.ts` is fine since it's a type-only import.

### Step 2: Simplify open-handler.ts

**File:** `src/renderer/content/open-handler.ts`

Remove `buildSourceLink()` function and `ISourceLink` import. Replace with direct `cleanForStorage()` call.

Before:
```typescript
import { cleanForStorage } from "../../shared/link-data";
import type { ILinkData } from "../../shared/link-data";
import type { ISourceLink } from "../../shared/types";

function buildSourceLink(data: ILinkData, filePath: string): ISourceLink { ... }
```

After:
```typescript
import { cleanForStorage } from "../../shared/link-data";
```

And in the handler body, replace:
```typescript
const sourceLink = buildSourceLink(data, filePath);
```
with:
```typescript
const sourceLink = cleanForStorage(data);
sourceLink.url = filePath;
```

`cleanForStorage()` now returns `ILinkData` (not `Partial<ILinkData>`) since all fields are optional. It strips ephemeral fields and keeps `url`, `href`, `target`, `title`, `headers`, `method`, `body`, `sourceId`, `pipeDescriptor`, and all ILink-compatible fields.

### Step 3: Update PagesLifecycleModel.ts

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Remove `ISourceLink` from import. Change option types to `ILinkData`.

Before (line 3):
```typescript
import { IEditorState, ISourceLink, EditorView, EditorType, PageDescriptor } from "../../../shared/types";
```

After:
```typescript
import { IEditorState, EditorView, EditorType, PageDescriptor } from "../../../shared/types";
import type { ILinkData } from "../../../shared/link-data";
```

Before (line 300):
```typescript
options?: { sourceLink?: ISourceLink; target?: string },
```

After:
```typescript
options?: { sourceLink?: ILinkData; target?: string },
```

Before (line 454):
```typescript
sourceLink?: ISourceLink;
```

After:
```typescript
sourceLink?: ILinkData;
```

### Step 4: Update ArchiveEditorModel.ts

**File:** `src/renderer/editors/archive/ArchiveEditorModel.ts`

Line 94 — reads `sourceLink?.url` — no change needed (ILinkData has `url`).

Line 117 — reads `sourceLink?.metadata?.sourceId`:

Before:
```typescript
private _isOpenedFromThisArchive(model: EditorModel): boolean {
    return model.state.get().sourceLink?.metadata?.sourceId === this.id;
}
```

After:
```typescript
private _isOpenedFromThisArchive(model: EditorModel): boolean {
    const sl = model.state.get().sourceLink;
    // Support both new format (sourceId on top level) and legacy persisted format (in metadata)
    return (sl?.sourceId ?? (sl?.metadata as Record<string, unknown> | undefined)?.sourceId) === this.id;
}
```

### Step 5: Update EditorModel.ts docstring

**File:** `src/renderer/editors/base/EditorModel.ts`

Line 100 — update comment:

Before:
```typescript
 *   - ArchiveEditorModel: keeps if newModel.sourceLink?.metadata?.sourceId === this.id
```

After:
```typescript
 *   - ArchiveEditorModel: keeps if newModel.sourceLink?.sourceId === this.id
```

Line 154 — `applyRestoreData()` — no code change needed. It restores the raw persisted JSON (which could be old ISourceLink shape or new Partial<ILinkData>). Since the type is now `Partial<ILinkData>`, the `as any` cast is still needed because the restore data comes from JSON parsing.

### Step 6: Remove ISourceLink from script API types

**File:** `src/renderer/api/types/io.events.d.ts`

Remove `ISourceLink` interface (lines 1-9). Keep `ILinkMetadata` (removed in US-410).

Before:
```typescript
/** Describes the link that opened a page — origin identity + metadata. */
export interface ISourceLink {
    readonly url: string;
    readonly target?: string;
    readonly metadata?: Record<string, unknown>;
}

/** Metadata passed through the link pipeline. */
export interface ILinkMetadata { ... }
```

After:
```typescript
/** Metadata passed through the link pipeline. */
export interface ILinkMetadata { ... }
```

**File:** `assets/editor-types/io.events.d.ts`

Mirror the same removal (this file is auto-copied by Vite's `editorTypesPlugin()`).

### Step 7: Verify

- Run `npm run lint` — no type errors
- No remaining imports or references to `ISourceLink` in source code
- Grep for `ISourceLink` returns zero matches in `.ts` files

## Concerns

### C1: Backward compatibility with persisted `sourceLink` data

**Resolved:** Old pages have `{ url, target, metadata: { sourceId: "..." } }`. New pages have `{ url, href, target, sourceId: "..." }`. The only code that reads a field from inside `metadata` is `ArchiveEditorModel._isOpenedFromThisArchive()` — updated to check both shapes with a fallback. The `url` and `target` fields are in the same position in both shapes, so all other reads are compatible.

### C2: Should `IEditorState.sourceLink` type be `Partial<ILinkData>` or `ILinkData`?

**Resolved:** `ILinkData` directly. Making `handled` and `href` optional on ILinkData means the type works for both pipeline events (where both are always set at runtime) and storage (where `handled` is stripped). No `Partial<>` wrapper needed — one type everywhere.

### C3: Import path for `ILinkData` in `shared/types.ts`

**Resolved:** `shared/types.ts` is in `src/shared/` and needs to import from `src/renderer/api/types/io.link-data.d.ts`. The relative path is `../renderer/api/types/io.link-data`. Since it's a `type`-only import, there's no runtime dependency crossing process boundaries.

### C4: `metadata` property on `Partial<ILinkData>` — doesn't exist

**Resolved:** ILinkData has no `metadata` property. Old persisted data has `metadata: { ... }` but this is from the ISourceLink shape. When restored via `applyRestoreData()`, the raw JSON is assigned to `s.sourceLink`. Code reading `sourceLink.metadata` would get `undefined` on new data (correct — no metadata bag). Only the ArchiveEditorModel legacy fallback reads it during the transition period.

## Acceptance criteria

- [ ] `handled` and `href` made optional on ILinkData (`io.link-data.d.ts` + mirror)
- [ ] EventChannel constraint updated to `{ handled?: boolean }` (+ script types mirror)
- [ ] `cleanForStorage()` returns `ILinkData` (not `Partial<ILinkData>`)
- [ ] `ISourceLink` interface removed from `src/shared/types.ts`
- [ ] `IEditorState.sourceLink` typed as `ILinkData`
- [ ] `buildSourceLink()` removed from `open-handler.ts`, replaced with `cleanForStorage()`
- [ ] `PagesLifecycleModel.ts` uses `ILinkData` in option types
- [ ] `ArchiveEditorModel.ts` reads `sourceLink?.sourceId` with legacy fallback
- [ ] `ISourceLink` removed from `io.events.d.ts` and `assets/editor-types/io.events.d.ts`
- [ ] `npm run lint` passes with no errors
- [ ] No remaining `ISourceLink` references in `.ts` source files

## Files changed

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/api/types/io.link-data.d.ts` | **Modify** | Make `handled` and `href` optional |
| `assets/editor-types/io.link-data.d.ts` | **Modify** | Mirror: make `handled` and `href` optional |
| `src/renderer/api/events/EventChannel.ts` | **Modify** | Constraint `{ handled?: boolean }` |
| `src/renderer/api/types/events.d.ts` | **Modify** | Script constraint `{ handled?: boolean }` |
| `assets/editor-types/events.d.ts` | **Modify** | Mirror: script constraint |
| `src/shared/link-data.ts` | **Modify** | `cleanForStorage` returns `ILinkData` instead of `Partial<ILinkData>` |
| `src/shared/types.ts` | **Modify** | Remove `ISourceLink`, change `sourceLink` type to `ILinkData` |
| `src/renderer/content/open-handler.ts` | **Modify** | Remove `buildSourceLink()`, use `cleanForStorage()` directly |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | **Modify** | Change `ISourceLink` to `ILinkData` in option types |
| `src/renderer/editors/archive/ArchiveEditorModel.ts` | **Modify** | Read `sourceLink?.sourceId` with legacy fallback |
| `src/renderer/editors/base/EditorModel.ts` | **Modify** | Update docstring comment |
| `src/renderer/api/types/io.events.d.ts` | **Modify** | Remove `ISourceLink` interface |
| `assets/editor-types/io.events.d.ts` | **Modify** | Remove `ISourceLink` interface (mirror) |

## Files NOT changed

| File | Why |
|------|-----|
| `src/renderer/api/events/events.ts` | No ISourceLink usage |
| `src/renderer/content/resolvers.ts` | No ISourceLink usage |
| `src/renderer/content/parsers.ts` | No ISourceLink usage |
