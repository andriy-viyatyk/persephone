# Task 2 Phase A — Interface Cleanup & Type Consistency

## Goal

Clean up ITransformer interface (make `write` required, add `clone()`), simplify ContentPipe internals, unify `SubscriptionObject` type, and convert `writeText`/`writeBinary` from conditional getters to throwing methods.

---

## Files Changed

| # | File | Changes |
|---|------|---------|
| 1 | `src/renderer/api/types/io.transformer.d.ts` | Make `write` required, add `clone()` |
| 2 | `assets/editor-types/io.transformer.d.ts` | Mirror of #1 |
| 3 | `src/renderer/content/transformers/ZipTransformer.ts` | Add `clone()` method |
| 4 | `src/renderer/content/transformers/DecryptTransformer.ts` | `#password`, `config: {}`, safe `toDescriptor()`, add `clone()` |
| 5 | `src/renderer/content/registry.ts` | Update decrypt factory (no longer receives password from descriptor) |
| 6 | `src/renderer/content/ContentPipe.ts` | Simplify `writable`, use `t.clone()` in clone methods, convert `writeText`/`writeBinary` to throwing methods, import `ISubscriptionObject` |
| 7 | `src/renderer/api/types/io.pipe.d.ts` | Change `writeText?`/`writeBinary?` to required methods |
| 8 | `assets/editor-types/io.pipe.d.ts` | Mirror of #7 |
| 9 | `src/renderer/api/events/EventChannel.ts` | Remove `SubscriptionObject` interface, import from types |
| 10 | `src/renderer/api/events/index.ts` | Update re-export |
| 11 | `src/renderer/content/providers/FileProvider.ts` | Import `ISubscriptionObject` instead of `SubscriptionObject` |
| 12 | `src/renderer/editors/text/TextFileIOModel.ts` | Import `ISubscriptionObject`, update `writeText`/`writeBinary` call sites |
| 13 | `src/renderer/editors/text/TextFileEncryptionModel.ts` | Update `writeText` call sites (remove truthiness checks, use `writable`) |
| 14 | `docs/api/io.md` | Update user docs if `writeText`/`writeBinary` signatures changed (optional, verify) |

---

## Implementation Plan

### Step 1: ITransformer — Make `write` required, add `clone()`

**Files:** `src/renderer/api/types/io.transformer.d.ts`, `assets/editor-types/io.transformer.d.ts`

Both files are identical and need the same changes.

**Before:**
```typescript
/** Reverse-transform bytes on write (editor -> source).
 *  Receives new content and original source bytes (needed by ZIP to rebuild archive).
 *  Undefined means this transformer is read-only. */
write?(data: Buffer, original: Buffer): Promise<Buffer>;
/** Serialize to descriptor for persistence. */
toDescriptor(): ITransformerDescriptor;
```

**After:**
```typescript
/** Reverse-transform bytes on write (editor -> source).
 *  Receives new content and original source bytes (needed by ZIP to rebuild archive). */
write(data: Buffer, original: Buffer): Promise<Buffer>;
/** Create a deep copy of this transformer (avoids descriptor round-trip). */
clone(): ITransformer;
/** Serialize to descriptor for persistence. */
toDescriptor(): ITransformerDescriptor;
```

---

### Step 2: ZipTransformer — Add `clone()`

**File:** `src/renderer/content/transformers/ZipTransformer.ts`

Add after `toDescriptor()`:

```typescript
clone(): ITransformer {
    return new ZipTransformer(this.entryPath);
}
```

No other changes needed. `write` is already required (not optional) in the implementation.

---

### Step 3: DecryptTransformer — `#password`, safe config, safe toDescriptor, add `clone()`

**File:** `src/renderer/content/transformers/DecryptTransformer.ts`

**Before:**
```typescript
export class DecryptTransformer implements ITransformer {
    readonly type = "decrypt";
    readonly persistent = false;
    readonly config: Record<string, unknown>;

    constructor(private readonly password: string) {
        this.config = { password };
    }
    // ...
    toDescriptor(): ITransformerDescriptor {
        return {
            type: "decrypt",
            config: { password: this.password },
        };
    }
}
```

**After:**
```typescript
export class DecryptTransformer implements ITransformer {
    readonly type = "decrypt";
    readonly persistent = false;
    readonly config: Record<string, unknown> = {};

    readonly #password: string;

    constructor(password: string) {
        this.#password = password;
    }

    async read(data: Buffer): Promise<Buffer> {
        const encryptedText = data.toString("utf-8");
        const plaintext = await encryption.decrypt(encryptedText, this.#password);
        return Buffer.from(plaintext, "utf-8");
    }

    async write(data: Buffer): Promise<Buffer> {
        const plaintext = data.toString("utf-8");
        const encryptedText = await encryption.encrypt(plaintext, this.#password);
        return Buffer.from(encryptedText, "utf-8");
    }

    clone(): ITransformer {
        return new DecryptTransformer(this.#password);
    }

    toDescriptor(): ITransformerDescriptor {
        return {
            type: "decrypt",
            config: {},
        };
    }
}
```

Key changes:
- `private readonly password` -> `readonly #password` (ES2022 private field, truly private)
- `this.config = { password }` -> `this.config = {}` (password no longer leaked through config)
- `toDescriptor()` returns `config: {}` (password no longer serialized)
- Constructor: remove `private readonly` modifier since we use `#password` instead
- Add `clone()` method using `#password`

---

### Step 4: Registry — Update decrypt factory

**File:** `src/renderer/content/registry.ts` (line 61)

**Before:**
```typescript
registerTransformer("decrypt", (config) => new DecryptTransformer(config.password as string));
```

**After:** This factory is only called from `createTransformerFromDescriptor()`, which is used in two scenarios:
1. **Pipe restoration from saved descriptors** — DecryptTransformer has `persistent: false`, so it is never included in saved descriptors. This path is never reached for decrypt.
2. **`clone()`/`cloneWithProvider()`** — Currently uses `toDescriptor()` -> factory round-trip, but after this change, clone will use `t.clone()` directly (Step 5). This path is eliminated.

Since `toDescriptor()` now returns `config: {}` for decrypt, the factory would receive `undefined` for password. The factory should throw a clear error since it should never be called:

```typescript
registerTransformer("decrypt", () => {
    throw new Error("DecryptTransformer cannot be created from descriptor — use clone() instead");
});
```

---

### Step 5: ContentPipe — Simplify `writable`, use `t.clone()`, convert write methods

**File:** `src/renderer/content/ContentPipe.ts`

#### 5a. Import change (line 4)

**Before:**
```typescript
import type { SubscriptionObject } from "../api/events/EventChannel";
```

**After:**
```typescript
import type { ISubscriptionObject } from "../api/types/events";
```

#### 5b. Simplify `writable` getter (line 37-40)

**Before:**
```typescript
get writable(): boolean {
    if (!this.provider.writable) return false;
    return this._transformers.every((t) => t.write !== undefined);
}
```

**After:**
```typescript
get writable(): boolean {
    return this.provider.writable;
}
```

Since `write` is now required on `ITransformer`, all transformers always support writing. The writable check only depends on the provider.

#### 5c. Convert `writeBinary` from conditional getter to throwing method (lines 83-86)

**Before:**
```typescript
get writeBinary(): ((data: Buffer) => Promise<void>) | undefined {
    if (!this.writable) return undefined;
    return this._writeBinary;
}
```

**After:**
```typescript
async writeBinary(data: Buffer): Promise<void> {
    if (!this.writable) {
        throw new Error("Cannot write: pipe is read-only");
    }
    await this._writeBinary(data);
}
```

#### 5d. Convert `writeText` from conditional getter to throwing method (lines 88-91)

**Before:**
```typescript
get writeText(): ((content: string) => Promise<void>) | undefined {
    if (!this.writable) return undefined;
    return this._writeText;
}
```

**After:**
```typescript
async writeText(content: string): Promise<void> {
    if (!this.writable) {
        throw new Error("Cannot write: pipe is read-only");
    }
    await this._writeText(content);
}
```

#### 5e. In `_writeBinary` — remove provider.writeBinary guard (line 94)

**Before:**
```typescript
private _writeBinary = async (data: Buffer): Promise<void> => {
    if (!this.provider.writeBinary) return;
```

**After:**
```typescript
private _writeBinary = async (data: Buffer): Promise<void> => {
```

This guard is unnecessary since `writeBinary()` already checks `this.writable` (which checks `this.provider.writable`). If `writable` is `true`, the provider has `writeBinary`.

Also update line 125 — remove `!` assertion on `transformer.write`:

**Before:** `result = await transformer.write!(result, original);`
**After:** `result = await transformer.write(result, original);`

And line 128 — the `provider.writeBinary` call:

**Before:** `await this.provider.writeBinary(result);`
This still needs `!` or a cast because `IProvider.writeBinary` is still optional (`writeBinary?(data: Buffer): Promise<void>`). Keep the `!` for now, or better yet, we already know `writable` is true. Keep as-is — the non-null assertion is justified.

#### 5f. Update `watch` getter type (line 138)

**Before:**
```typescript
get watch(): ((callback: (event: string) => void) => SubscriptionObject) | undefined {
```

**After:**
```typescript
get watch(): ((callback: (event: string) => void) => ISubscriptionObject) | undefined {
```

#### 5g. Use `t.clone()` in `cloneWithProvider()` (lines 145-150)

**Before:**
```typescript
cloneWithProvider(provider: IProvider): IContentPipe {
    const transformers = this._transformers.map(
        (t) => createTransformerFromDescriptor(t.toDescriptor())
    );
    return new ContentPipe(provider, transformers, this._encoding);
}
```

**After:**
```typescript
cloneWithProvider(provider: IProvider): IContentPipe {
    const transformers = this._transformers.map((t) => t.clone());
    return new ContentPipe(provider, transformers, this._encoding);
}
```

#### 5h. Use `t.clone()` in `clone()` (lines 152-158)

**Before:**
```typescript
clone(): IContentPipe {
    const provider = createProviderFromDescriptor(this.provider.toDescriptor());
    const transformers = this._transformers.map(
        (t) => createTransformerFromDescriptor(t.toDescriptor())
    );
    return new ContentPipe(provider, transformers, this._encoding);
}
```

**After:**
```typescript
clone(): IContentPipe {
    const provider = createProviderFromDescriptor(this.provider.toDescriptor());
    const transformers = this._transformers.map((t) => t.clone());
    return new ContentPipe(provider, transformers, this._encoding);
}
```

Note: Provider still uses descriptor round-trip because `IProvider` does not have `clone()`. This is acceptable — providers are restorable from descriptors (unlike DecryptTransformer which loses its password). No need to add `clone()` to IProvider in this phase.

#### 5i. Remove unused import

After using `t.clone()`, the import of `createTransformerFromDescriptor` is only needed if it is used elsewhere in this file. Check: it is NOT used elsewhere — remove from import on line 7.

**Before:**
```typescript
import {
    createProviderFromDescriptor,
    createTransformerFromDescriptor,
} from "./registry";
```

**After:**
```typescript
import { createProviderFromDescriptor } from "./registry";
```

---

### Step 6: IContentPipe type — Change writeText/writeBinary to required methods

**Files:** `src/renderer/api/types/io.pipe.d.ts`, `assets/editor-types/io.pipe.d.ts`

Both files are identical and need the same changes.

**Before:**
```typescript
/** Write binary content — reverse-piped through transformers back to provider. */
writeBinary?(data: Buffer): Promise<void>;
/** Write text — encode using detected encoding, then writeBinary(). */
writeText?(content: string): Promise<void>;
```

**After:**
```typescript
/** Write binary content — reverse-piped through transformers back to provider.
 *  Throws if `!writable`. Check `writable` before calling. */
writeBinary(data: Buffer): Promise<void>;
/** Write text — encode using detected encoding, then writeBinary().
 *  Throws if `!writable`. Check `writable` before calling. */
writeText(content: string): Promise<void>;
```

---

### Step 7: SubscriptionObject -> ISubscriptionObject everywhere

#### 7a. EventChannel.ts (line 3-5)

**File:** `src/renderer/api/events/EventChannel.ts`

**Before:**
```typescript
export interface SubscriptionObject {
    unsubscribe: () => void;
}
```

**After:** Remove this interface entirely. Import `ISubscriptionObject` from types:

```typescript
import type { ISubscriptionObject } from "../types/events";
```

Update `subscribe` return type (line 45):

**Before:** `subscribe = (handler: EventHandler<TEvent>): SubscriptionObject => {`
**After:** `subscribe = (handler: EventHandler<TEvent>): ISubscriptionObject => {`

#### 7b. events/index.ts (line 3)

**File:** `src/renderer/api/events/index.ts`

**Before:**
```typescript
export type { SubscriptionObject, EventHandler, EventChannelOptions } from "./EventChannel";
```

**After:**
```typescript
export type { EventHandler, EventChannelOptions } from "./EventChannel";
export type { ISubscriptionObject } from "../types/events";
```

Note: Check if any file imports `SubscriptionObject` from `../../api/events` or `../../api/events/index`. If so, those need updating too. Based on grep, all imports come from `EventChannel` directly, not from the barrel `index.ts`.

#### 7c. FileProvider.ts (line 2, 47)

**File:** `src/renderer/content/providers/FileProvider.ts`

**Before:**
```typescript
import type { SubscriptionObject } from "../../api/events/EventChannel";
// ...
watch(callback: (event: string) => void): SubscriptionObject {
```

**After:**
```typescript
import type { ISubscriptionObject } from "../../api/types/events";
// ...
watch(callback: (event: string) => void): ISubscriptionObject {
```

#### 7d. TextFileIOModel.ts (line 10, 20)

**File:** `src/renderer/editors/text/TextFileIOModel.ts`

**Before:**
```typescript
import type { SubscriptionObject } from "../../api/events/EventChannel";
// ...
private watchSubscription: SubscriptionObject | null = null;
```

**After:**
```typescript
import type { ISubscriptionObject } from "../../api/types/events";
// ...
private watchSubscription: ISubscriptionObject | null = null;
```

#### 7e. Note on `core/state/events.ts`

`src/renderer/core/state/events.ts` also defines its own `SubscriptionObject` interface (line 9) and is imported in `BrowserPageModel.ts` (line 6). This is a **different** `SubscriptionObject` — it belongs to the internal state event system, not the `EventChannel` system. **Do NOT change this one** in this task. It is a separate concern.

---

### Step 8: Update all callers of writeText/writeBinary

After converting `writeText`/`writeBinary` from conditional getters (`| undefined`) to always-present methods (that throw), callers no longer need truthiness checks or `!` assertions.

#### 8a. TextFileIOModel.ts — `saveFile()` (line 97)

**Before:**
```typescript
if (savePath === filePath && this.model.pipe?.writeText) {
    await this.model.pipe.writeText(text);
```

**After:**
```typescript
if (savePath === filePath && this.model.pipe?.writable) {
    await this.model.pipe.writeText(text);
```

Rationale: `writeText` is now always a method (never undefined). The truthiness check was used to determine writability. Replace with explicit `writable` check.

#### 8b. TextFileIOModel.ts — `saveFile()` (line 107)

**Before:**
```typescript
await newPipe.writeText!(text);
```

**After:**
```typescript
await newPipe.writeText(text);
```

The `!` non-null assertion is no longer needed — `writeText` is always a method. (A freshly created `ContentPipe(new FileProvider(...))` is always writable, so it won't throw.)

#### 8c. TextFileIOModel.ts — `doSaveModifications()` (lines 310-322)

**Before:**
```typescript
if (this.cachePipe?.writeText) {
    try {
        await this.cachePipe.writeText(text);
    } catch {
        const { id } = this.model.state.get();
        await appFs.saveCacheFile(id, text);
    }
} else {
    console.log("[doSaveModifications] no cachePipe.writeText — using appFs.saveCacheFile fallback");
    const { id } = this.model.state.get();
    await appFs.saveCacheFile(id, text);
}
```

**After:**
```typescript
if (this.cachePipe) {
    try {
        await this.cachePipe.writeText(text);
    } catch {
        const { id } = this.model.state.get();
        await appFs.saveCacheFile(id, text);
    }
} else {
    console.log("[doSaveModifications] no cachePipe — using appFs.saveCacheFile fallback");
    const { id } = this.model.state.get();
    await appFs.saveCacheFile(id, text);
}
```

Rationale: `cachePipe` uses `CacheFileProvider` which has `writable = true`, so `writeText` will never throw for the writable check. The truthiness check on `writeText` was really checking if `cachePipe` exists. Simplify to just null-check `cachePipe`.

#### 8d. TextFileEncryptionModel.ts — `encript()` (line 37-39)

**Before:**
```typescript
if (this.model.pipe?.writeText) {
    await this.model.pipe.writeText(encryptedContent);
}
```

**After:**
```typescript
if (this.model.pipe?.writable) {
    await this.model.pipe.writeText(encryptedContent);
}
```

#### 8e. TextFileEncryptionModel.ts — `makeUnencrypted()` (lines 182-184)

**Before:**
```typescript
if (candidate.writeText) {
    await candidate.writeText(content);
}
```

**After:**
```typescript
if (candidate.writable) {
    await candidate.writeText(content);
}
```

#### 8f. ContentPipe.ts — `_writeBinary` (line 125)

**Before:**
```typescript
result = await transformer.write!(result, original);
```

**After:**
```typescript
result = await transformer.write(result, original);
```

(Already covered in Step 5e, listed here for completeness.)

---

## Concerns

### 1. DecryptTransformer descriptor / registry interaction
After `toDescriptor()` returns `config: {}`, the registry factory for "decrypt" will receive an empty config. Currently the factory does `new DecryptTransformer(config.password as string)` which would produce `new DecryptTransformer(undefined as string)`. The factory should be updated to throw (Step 4) since DecryptTransformer is `persistent: false` and should never be restored from a descriptor.

**Risk:** If any code path tries to create a DecryptTransformer from a descriptor (e.g., saved page state from before this change), it will throw. This is safe because DecryptTransformer has `persistent: false` and is never included in saved descriptors.

### 2. Provider `writeBinary` still optional on IProvider
`IProvider.writeBinary?` remains optional. In `ContentPipe._writeBinary`, we call `this.provider.writeBinary(result)` which needs `!` assertion or a guard. Currently line 94 has `if (!this.provider.writeBinary) return;` which we remove. But the outer `writeBinary()` method checks `this.writable` (which checks `provider.writable`). If a provider has `writable = true` but no `writeBinary` method, it would fail. In practice all writable providers (`FileProvider`, `CacheFileProvider`) define `writeBinary`. Keep the `!` assertion on `this.provider.writeBinary!(result)` at line 128, or better yet, leave the guard check at line 94 as a safety net. **Decision: keep the `if (!this.provider.writeBinary) return;` guard** — it is defensive and cheap.

### 3. `core/state/events.ts` has its own `SubscriptionObject`
This is a separate interface used by the internal state management system (`BrowserPageModel.ts` imports it). It is NOT the same as the EventChannel `SubscriptionObject`. Do not touch it in this task. The naming collision is confusing but renaming it is out of scope.

### 4. User docs (`docs/api/io.md`)
The user documentation shows `pipe.writeText()` and `pipe.writeBinary()` usage. Since these become always-present methods (instead of optional), the docs might mention checking existence. Verify and update if needed.

### 5. Order of changes
Steps are ordered to avoid intermediate type errors:
1. Update `ITransformer` interface first (add `clone()`, make `write` required)
2. Update implementations (`ZipTransformer`, `DecryptTransformer`) to satisfy new interface
3. Update registry (decrypt factory)
4. Update `ContentPipe` (uses new `clone()`, new write methods)
5. Update `IContentPipe` type (make `writeText`/`writeBinary` required)
6. Update callers (remove `!` and truthiness checks)
7. Do `SubscriptionObject` rename at any point (independent of other changes)

---

## Testing Notes

1. **Open a plain text file** -> edit -> Ctrl+S -> verify save works
2. **Open a file in a ZIP archive** -> edit -> Ctrl+S -> verify save writes back to archive
3. **Encrypt a file** -> close app -> reopen -> verify encrypted file shows lock icon, decrypt works
4. **Decrypt a file** -> edit -> Ctrl+S -> verify pipe writes through DecryptTransformer
5. **"Save As" on any file** -> verify new file created correctly
6. **Open HTTP URL** -> verify read-only (no crash on Ctrl+S, gets "Save As" dialog)
7. **Make a modification, wait 1 second** -> verify cache write works (check cache directory)
8. **"Remove encryption"** on decrypted file -> verify plaintext written to disk
9. **Clone-and-try decrypt** -> enter wrong password -> verify clone is discarded, no crash
10. **File watch** -> modify file externally -> verify content reloads
