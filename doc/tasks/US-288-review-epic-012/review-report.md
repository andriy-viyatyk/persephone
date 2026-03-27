# US-288: EPIC-012 Review Report

**Date:** 2026-03-27
**Type:** Review (no code changes)
**Scope:** All EPIC-012 (Unified Link & Provider Architecture) changes — 16 tasks, 84 files, 6,420 insertions

---

## Overall Verdict

The architecture is **solid and well-designed**. The 3-layer pipeline is clean, editors are properly decoupled from data sources, and the LIFO event pattern provides good extensibility. Non-migrated editors are fully compatible without changes. The ContentViewModel base class insulates 12+ editors from content source details automatically.

**Main areas needing attention:**
1. Text editor pipe serialization — HTTP pages won't survive app restart
2. Rename drops transformers — encrypted/archive files lose protection on rename
3. Security edge cases — plaintext cache fallback for encrypted files
4. Pipeline gaps — `openDiff()` and `navigatePageTo()` bypass the pipeline

---

## Phase 1: Content Pipeline Core

**Files reviewed:** ContentPipe.ts (183), registry.ts (62), encoding.ts (109), parsers.ts (78), resolvers.ts (213), open-handler.ts (34), FileProvider.ts (78), CacheFileProvider.ts (74), HttpProvider.ts (68), ZipTransformer.ts (48), DecryptTransformer.ts (41), EventChannel.ts (97), BaseEvent.ts (5), events.ts (96), io.pipe.d.ts (61), io.provider.d.ts (53), io.transformer.d.ts (33)

### Inconsistencies

1. **ContentPipe.ts:174 — `dispose()` only disposes provider, not transformers.** The interface docstring says "Dispose provider and transformers" (`io.pipe.d.ts:59`), but the implementation only calls `this.provider.dispose?.()`. The `ITransformer` interface does not define `dispose()`, so there is a type-level inconsistency: the pipe claims to dispose transformers, but transformers have no dispose contract.
   > **Resolution:** Fix JSDoc in `io.pipe.d.ts:58` from "Dispose provider and transformers" → "Dispose the provider." No transformer dispose needed — current transformers hold no disposable state. Can be added in the future if needed. **(FIX: doc-only)**

2. **ContentPipe.ts:39 — `writable` getter checks `t.write !== undefined` on transformer instances.** For concrete classes, `write` is always defined (not `undefined`). The ITransformer interface marks `write?` as optional, but concrete classes always define it. Minor inconsistency between interface contract and practical usage.
   > **Resolution:** Make `write` required in `ITransformer` (`io.transformer.d.ts:29`) — remove `?` and update JSDoc. Simplify `ContentPipe.writable` getter to only check `this.provider.writable`. Read-only transformers are overdesign — writability is already controlled at the provider level (e.g., HttpProvider). **(FIX: code)**

3. **parsers.ts:35-42 — File parser sets `handled = true` unconditionally.** The catch-all fallback does not verify the file actually exists before forwarding to `openLink`. Any raw string (including gibberish) becomes an `OpenLinkEvent`. This makes it impossible for an external subscriber to detect "no parser understood this input."
   > **Resolution:** Add `isPlausibleFilePath()` validation in the file parser (check drive letter `X:\`/`X:/` or UNC `\\`). Non-existent files are fine (editor shows "deleted file" state). Invalid format strings → show `ui.notify("Invalid file path: ...")` and set `handled = true`. **(FIX: code)**

4. **resolvers.ts:44 — Stale comment references US-270.** Says "Future resolvers (HTTP in US-270) register after" but HTTP resolver is already implemented in the same file.
   > **Resolution:** Remove the stale comment line. **(FIX: doc-only)**

5. **FileProvider.ts:27 — `readBinary()` uses sync I/O inside an async method.** `readFileSync` is called inside `async readBinary()`. Same pattern in `writeBinary` (line 30), `stat` (line 36), and `CacheFileProvider.ts` (lines 38, 46, 52). Blocks the renderer thread for large files.
   > **Resolution:** Replace `readFileSync`/`writeFileSync`/`statSync` with `fs.promises.readFile`/`writeFile`/`stat` in both `FileProvider` and `CacheFileProvider`. Methods are already async — drop-in change. **(FIX: code)**

### Concerns

1. **ContentPipe.ts:106-118 — Write path silently degrades when original read fails.** In `_writeBinary`, if `provider.stat?.()` throws, `originals` stays `null` and each transformer receives `Buffer.alloc(0)` as the original. For `ZipTransformer.write()`, this means `JSZip.loadAsync(Buffer.alloc(0))` — likely producing a corrupt archive. The `catch` block silently swallows the error.
   > **Resolution:** The `stat.exists === false` path (deleted file → empty originals) is correct behavior — no originals to preserve. The true risk is a narrow race condition (stat succeeds but readBinary fails due to lock/IO error) — low probability, no fix needed in ContentPipe. However, `saveFile()` should force "Save As" dialog when `state.deleted === true` — better UX than silently recreating. Default path should be the original file path so the user can just click Save. **(SEPARATE TASK: saveFile should show Save As dialog for deleted files)**

2. **resolvers.ts:92-139 — Hardcoded extension map duplicates editor registry knowledge.** The `httpContentExtensions` map is a large extension-to-editor mapping that duplicates what `editorRegistry` already knows. Adding a new editor/file type requires updating two places.
   > **Resolution:** Intentional design. HTTP resolution needs different logic than local file resolution — e.g., `.html` URLs should open in browser, not Monaco. Cannot delegate to editor registry. Self-contained map is a simplification. **No fix needed.**

3. **parsers.ts:45-53 — Archive parser does not check if URL is also HTTP.** An HTTP URL like `https://example.com/data.zip!entry.csv` would match `isArchivePath`. Works correctly only by accident of LIFO registration order (HTTP parser runs first).
   > **Resolution:** Working as designed. HTTP parser (LIFO-first) catches `https://` URLs before the archive parser sees them. The HTTP resolver at Layer 2 already handles the `!` split for HTTP archive URLs (resolvers.ts:196-203), creating `HttpProvider + ZipTransformer`. Not accidental — intentional layering. **No fix needed.**

4. **open-handler.ts:25 — Pipe not disposed on error.** If `navigatePageTo` or `openFile` throws, the pipe is not disposed (no try/finally). Pipe ownership is unclear in error paths.
   > **Resolution:** Wrap `pageId` branch in `try/finally` (always dispose — navigatePageTo never uses the pipe). Wrap `else` branch in `try/catch` + rethrow (dispose only on failure — on success the page takes ownership). **(FIX: code)**

5. **encoding.ts:56 — Multiple defense layers for jschardet null.** Not a bug, but `jschardet.detect()` can return `{ encoding: null, confidence: 0 }`. Current checks handle this correctly.
   > **Resolution:** No action needed — correctly handled.

6. **ContentPipe.ts:145-158 — `clone()`/`cloneWithProvider()` round-trips through descriptor.** For `DecryptTransformer` this means the password briefly exists as a plain string in a descriptor object. Heavier than necessary for cloning.
   > **Resolution:** No action needed. The password is only in memory (same JS heap where it already exists in multiple places). Not stored to disk. Generic clone approach keeps logic simple without special-casing individual transformers.

### Improvement Ideas

1. ~~**encoding.ts:8-9 — Use `import` instead of `require`.**~~ `iconv-lite` and `jschardet` are npm packages loaded at runtime via Node's `require` — correct pattern for this project (`import` would bundle via Vite, `require` loads via Node). **No fix needed — removed.**

2. **registry.ts — Consider a `hasProvider`/`hasTransformer` check.** Allow callers to gracefully handle missing registrations when restoring pipes.
   > **Resolution:** Needs investigation — corrupt page state with invalid provider/transformer type and verify app doesn't crash. **(SEPARATE TASK: test and harden pipe restore for unknown types)**

---

## Phase 2: Providers and Transformers

**Files reviewed:** FileProvider.ts (77), HttpProvider.ts (67), CacheFileProvider.ts (73), ZipTransformer.ts (47), DecryptTransformer.ts (40), io.provider.d.ts (52), io.transformer.d.ts (32), registry.ts (62), ContentPipe.ts (183)

### Provider Interface Comparison

| Feature | FileProvider | HttpProvider | CacheFileProvider |
|---------|-------------|-------------|-------------------|
| `readBinary()` | sync fs in async | async nodeFetch | sync fs in async |
| `writeBinary()` | yes | omitted (correct) | yes |
| `stat()` | yes | omitted | yes |
| `watch()` | yes (debounced) | omitted | omitted |
| `writable` | true | false | true |

### Transformer Interface Comparison

| Feature | ZipTransformer | DecryptTransformer |
|---------|---------------|-------------------|
| `persistent` | true | false |
| `read()` | extract ZIP entry | decrypt AES-GCM |
| `write()` | uses both args (data + original) | ignores original (1 param) |

### Inconsistencies

1. **`SubscriptionObject` vs `ISubscriptionObject` type duality.** Internal implementations (`FileProvider.ts:2`, `ContentPipe.ts:4`) import `SubscriptionObject` from `EventChannel.ts`. Public type definitions (`io.provider.d.ts:1`, `io.pipe.d.ts:1`) define `ISubscriptionObject`. Structurally identical but nominally inconsistent.
   > **Resolution:** Remove `SubscriptionObject` from `EventChannel.ts`. Use `ISubscriptionObject` from `events.d.ts` everywhere — both in `EventChannel.ts` and all internal consumers (`FileProvider.ts`, `ContentPipe.ts`, etc.). One type, one name. **(FIX: code)**

2. **Error handling divergence on `readBinary`.** `FileProvider.ts:27` lets `readFileSync` throw on missing files. `CacheFileProvider.ts:39` catches all errors and returns `Buffer.alloc(0)`. Likely intentional (cache miss is normal) but undocumented.
   > **Resolution:** No action needed. Intentional divergence — missing source file is abnormal (caller sets deleted state), missing cache file is normal (no cached content yet). Callers always know which provider they're using.

3. **`DecryptTransformer.write()` signature.** `DecryptTransformer.ts:28` declares `write(data: Buffer): Promise<Buffer>` with one parameter. `ITransformer` at `io.transformer.d.ts:29` specifies `write?(data: Buffer, original: Buffer): Promise<Buffer>`. TypeScript allows this but it deviates from the declared interface.
   > **Resolution:** No action needed. TypeScript allows omitting unused trailing parameters. DecryptTransformer doesn't need `original` — no reason to add an unused parameter for visual consistency.

### Concerns

1. **`DecryptTransformer` exposes password in `config` property.** `DecryptTransformer.ts:19` stores password in `this.config = { password }`. While `persistent: false` prevents disk serialization, the `config` property is public. Any code with a reference to the transformer can read `transformer.config.password`. If `toDescriptor()` is called directly (bypassing pipe's filter), the password is included.
   > **Resolution:** Make password write-only using ES2022 `#password` private field (truly hidden at runtime — invisible to `Object.keys`, `Reflect`, bracket notation, prototype access). (1) `DecryptTransformer.config` → `{}` (empty). (2) `toDescriptor()` → throw `"Cannot serialize DecryptTransformer"`. (3) Add `clone(): ITransformer` method to `ITransformer` interface — each transformer copies itself without exposing internals. (4) `ContentPipe.clone()`/`cloneWithProvider()` use `t.clone()` instead of descriptor round-trip. Password enters via constructor, never leaves `#password`. **(FIX: code)**

2. **No `watch()` on `CacheFileProvider`.** Likely fine since cache files are only modified by the app itself.
   > **Resolution:** No action needed. Cache is write-only during page lifetime — only used for restoring after app restart. Watching makes no sense.

4. **`HttpProvider` has no `stat()`.** Cannot check if HTTP resource exists before fetching. Blocked by `writable = false` currently, but fragile if future code allows write-through.
   > **Resolution:** No action needed. By design — HttpProvider is read-only. A writable remote source would be a different provider type (WebSocket, WebDAV, etc.) with its own stat implementation.

5. **`HttpProvider` re-fetches on every `readBinary()` call.** Comment at `HttpProvider.ts:8` acknowledges this.
   > **Resolution:** Cache the response Buffer in `_cachedBuffer` after first fetch. Return cached buffer on subsequent calls. Clone starts with `null` cache (re-fetches on first read — correct). No increase in peak memory — buffer is already fully in memory after first read. **(FIX: code)**

6. **`FileProvider` and `CacheFileProvider` use `require("fs")` directly.** Coding standard says "No direct `require("fs")`." Should be verified as documented exception for content providers.
   > **Resolution:** The `app.fs` rule exists because `app.fs` handles ZIP paths transparently. FileProvider works with plain file paths only (ZIP is now a separate ZipTransformer), so it correctly uses raw `fs`. Add FileProvider and CacheFileProvider as documented exceptions in `coding-style.md`. The `app.fs` rule may need broader review after EPIC-012 is fully complete (ITreeProvider for FileExplorer/NavigationPanel is still pending). **(FIX: doc-only)**

### Improvement Ideas

1. **Add JSDoc to `CacheFileProvider.readBinary()`.** Document intentional empty buffer on error (cache miss = empty).

2. **Make `watch()` debounce configurable.** `FileProvider.ts:50` hardcodes 300ms. Constructor option would add flexibility.

3. **`HttpProvider.toDescriptor()` sparse config is well done.** Other providers could adopt the same pattern for optional config fields.

---

## Phase 3: Text Editor Migration

**Files reviewed:** TextFileIOModel.ts (339), TextPageModel.ts (333), TextFileEncryptionModel.ts (207), TextFileActionsModel.ts (119), EncryptionPanel.tsx (131), TextFooter.tsx (68), index.ts (30), ContentPipe.ts (183), FileProvider.ts (78), CacheFileProvider.ts (74), DecryptTransformer.ts (41), PageModel.ts (132), open-handler.ts (34)

### Architecture Overview

**Dual-pipe model:**
- **Primary pipe** (`model.pipe`): ContentPipe with FileProvider/HttpProvider + optional transformers. Used for reading source and saving.
- **Cache pipe** (`io.cachePipe`): Clone with CacheFileProvider. Used for auto-save.

**Key flows:**
- **Open file**: open-handler passes pipe → `createPageFromFile()` → `pageModel.pipe = pipe` → `restore()` → `ensurePipe()` (no-op) → `setupWatch()` + `recreateCachePipe()`
- **App restart**: `applyRestoreData()` → `restore()` → `ensurePipe()` creates fresh pipe from `filePath`
- **Save**: Writes through existing pipe (preserving transformers). "Save As" creates new FileProvider pipe.
- **Encryption**: Clone-and-try — clone pipe, add/remove DecryptTransformer, try `readText()`. On success swap; on failure dispose clone.
- **File watching**: `pipe.watch()` → `FileProvider.watch()` → `fs.watch()`
- **Auto-save**: Debounced writes to cache pipe. Falls back to `appFs.saveCacheFile()` if cache pipe fails.

### Inconsistencies

1. **TextFileModel.getRestoreData() does not serialize pipe descriptor** (`TextPageModel.ts:219-233`). Overrides base without calling `super`. The base `PageModel.getRestoreData()` (line 88-97) serializes `this.pipe.toDescriptor()`, but this is bypassed. HTTP-sourced pages lose their pipe on restart.

2. **TextFileModel.applyRestoreData() does not call super** (`TextPageModel.ts:235-251`). Base `PageModel.applyRestoreData()` (line 103-123) reconstructs pipe from descriptor, but TextFileModel skips this entirely.

   > **Resolution (both #1 and #2):** Bug confirmed — HTTP pages crash on app restart. `ensurePipe()` wraps the URL in a FileProvider which fails on `readFileSync("https://...")`. **(SEPARATE TASK/BUG: serialize pipe descriptor in TextFileModel getRestoreData/applyRestoreData)**

### Concerns

1. **applyRenamedPath drops all transformers** (`TextFileIOModel.ts:161-183`). When a file is renamed, a new pipe is created with NO transformers (line 165-167). ZipTransformer and DecryptTransformer are silently lost. Renaming an encrypted file would save plaintext.
   > **Resolution:** Bug — renaming encrypted file silently loses encryption. **(SEPARATE TASK/BUG: preserve transformers on rename via `cloneWithProvider`)**

2. **"Save As" does not clear password state** (`TextFileIOModel.ts:100-131`). New pipe has no DecryptTransformer (correct), but `state.password` is never cleared. UI may still show encryption controls for a file that is now plaintext. `withEncription` getter returns `true` when password is set.
   > **Resolution:** Bug — stale encryption UI after Save As from encrypted file. **(SEPARATE TASK/BUG: clear password state on Save As to new path)**

3. **`newPipe.writeText!` non-null assertion** (`TextFileIOModel.ts:107`). Safe in practice (FileProvider is always writable) but fragile if pipe creation logic changes.
   > **Resolution:** Change `writeText`/`writeBinary` from conditional getters (`() => ... | undefined`) to regular methods that throw `"Cannot write: pipe is read-only"` when `!this.writable`. Callers check `pipe.writable` explicitly before calling. Removes the need for `!` assertions and `if` guards. Clearer error messages during testing. Update `IContentPipe` type accordingly. **(FIX: code)**

4. **Direct `appFs` calls for rename** (`TextFileIOModel.ts:144, 150`). `renameFile` uses `appFs.exists()` and `appFs.rename()` directly. Would not work for archive entries or HTTP-sourced content. Guard at line 135-141 (`if (!filePath) return`) does not prevent this for archive paths.
   > **Resolution:** Currently works because `appFs` handles archive paths internally. However, this should be covered by `ITreeProvider` — designed in EPIC-012 but never implemented. `TextFileIOModel` should use the linked ITreeProvider (if present) for rename, or derive one from the pipe's provider (FileProvider → FileTreeProvider, ZipTransformer → ZipTreeProvider). **(SEPARATE TASK: implement ITreeProvider — see checklist items below)**
   >
   > **ITreeProvider task checklist (initial):**
   > - [ ] Define `ITreeProvider` interface and types (`io.tree.d.ts`)
   > - [ ] Implement `FileSystemTreeProvider` (replaces current file explorer fs logic)
   > - [ ] Implement `ZipTreeProvider` (replaces current archive NavPanel logic)
   > - [ ] Migrate NavigationPanel to use ITreeProvider
   > - [ ] Migrate FileExplorer to use ITreeProvider
   > - [ ] `TextFileIOModel.renameFile` should delegate to ITreeProvider
   > - [ ] Derive ITreeProvider from pipe provider when not explicitly linked
   > - [ ] Expose tree providers in script `io` namespace

5. **Cache fallback writes plaintext for encrypted files** (`TextFileIOModel.ts:314-321`). When `cachePipe.writeText` fails, fallback writes with `appFs.saveCacheFile(id, text)`. For encrypted files, `text` is the decrypted plaintext. Unencrypted content ends up on disk.
   > **Resolution:** Skip the plaintext fallback when the file is encrypted (pipe has DecryptTransformer). For encrypted files: cache write fails → do nothing (user's changes remain in memory, they can Save manually). For non-encrypted files: keep the fallback — it preserves unsaved work across crashes. Check `state.password` or `pipe.transformers` for DecryptTransformer presence. **(FIX: code)**

6. **`onFileChanged` reads stale `modified` value** (`TextFileIOModel.ts:264, 296`). Captures `modified` at line 264, uses at line 296 with async operations between. Benign — worst case triggers unnecessary cache save.
   > **Resolution:** No action needed. Benign race — worst case is an extra cache save.

7. **Clone-and-try on re-read for encryptWithCurrentPassword** (`TextFileEncryptionModel.ts:76-98`). Clones pipe, removes DecryptTransformer, calls `readText()` to get encrypted content from disk. If file was externally modified since last read, returned content may not match expectations.
   > **Resolution:** No action needed. Edge case — operation is read-only (reads encrypted text from disk to display). If file changed externally, showing the latest version is correct behavior for a "lock" operation.

8. **No error handling in `saveFile` when `pipe.writeText` fails** (`TextFileIOModel.ts:99`). No try/catch. Error propagates unhandled, leaving function in indeterminate state.
   > **Resolution:** Save silently fails — no notification to user, unhandled promise rejection. Reproducible: make file read-only on disk (Properties → Read-only), edit, Ctrl+S. **(SEPARATE TASK/BUG: add try/catch in saveFile, show error notification on write failure)**

---

## Phase 4: Reference Editor Migration (PDF, Image)

**Files reviewed:** PdfViewer.tsx (186), ImageViewer.tsx (260), BaseImageView.tsx (398), PageModel.ts (132), fs.ts (583)

### Inconsistencies

1. **Different caching strategies.** PDF creates a temp file on disk via `appFs.resolveCachePath()` (needed for pdf.js `safe-file://` protocol). Image creates an in-memory blob URL via `URL.createObjectURL()`. Reasonable given constraints but means cleanup mechanisms differ (file deletion vs `URL.revokeObjectURL`).

2. **Cleanup location differs.** PDF cleans up in its own `dispose()` + base class `deleteCacheFiles` (double delete, harmless). Image revokes blob URL in its own `dispose()` + base class pipe disposal.

3. **Import alias inconsistency.** `PdfViewer.tsx:13` uses `fs as appFs`. `ImageViewer.tsx:12` uses `fs` directly.

### Concerns

1. **ImageViewer "Open in Drawing Editor" bypasses pipe** (`ImageViewer.tsx:180-181`). Calls `fs.readBinary(fp)` directly instead of `pipe.readBinary()`. Works for local/archive files but skips any pipe transformers.

2. **`saveImage` also bypasses pipe** (`ImageViewer.tsx:77-117`). Fetches from blob/safe-file URL, not from pipe. Works but fragile if blob URL were revoked prematurely.

3. **No error feedback when pipe read fails.** `PdfViewer.tsx:63-65` and `ImageViewer.tsx:64-66` have empty `catch {}` blocks. User sees blank/broken display with no notification.

4. **PDF fallback for legacy pages (no pipe) is implicit but works.** Component falls back to `filePath` via `const servePath = localPdfPath || filePath`.

### Improvement Ideas

1. **Add user-visible error notification when pipe read fails.** Call `ui.notify()` instead of silently swallowing errors.

2. **Image "Open in Drawing Editor" should prefer pipe.** Use `model.pipe?.readBinary()` when available, fall back to `fs.readBinary(fp)`.

3. **Unify cache strategy documentation.** Brief comments in each editor explaining WHY different approaches are used.

---

## Phase 5: Entry Point Migration

**Files reviewed:** pipe-server.ts, open-windows.ts, main-setup.ts, renderer-events.ts, PagesModel.ts, PagesLifecycleModel.ts, PagesPersistenceModel.ts, RendererEventsService.ts, GlobalEventService.ts, AppEvents.ts, open-handler.ts, parsers.ts, resolvers.ts, RecentFileList.tsx, ScriptLibraryPanel.tsx, MenuBar.tsx, NavigationPanel.tsx, ScriptPanel.tsx, SettingsPage.tsx, BrowserWebviewModel.ts, FileExplorerModel.tsx

### Entry Point Inventory

| Entry Point | Uses Pipeline? | Notes |
|---|---|---|
| CLI file argument (first instance) | Yes | `openRawLink.sendAsync` |
| CLI file argument (second instance) | Yes | IPC → `openRawLink.sendAsync` |
| CLI URL argument | Yes | IPC → `openRawLink.sendAsync` |
| **CLI diff argument** | **No** | `pagesModel.openDiff()` directly |
| Named pipe: OPEN file | Yes | Same chain as CLI |
| Named pipe: OPEN url | Yes | Same chain as CLI |
| **Named pipe: DIFF** | **No** | Same bypass as CLI diff |
| Drag-drop file | Yes | IPC roundtrip → `openRawLink` |
| Open File dialog (Ctrl+O) | Yes | Both URL and OS dialog use `openRawLink` |
| Recent Files click | Yes | `openRawLink.sendAsync` |
| Menu bar file click | Yes | `openRawLink.sendAsync` |
| Script Library file click | Yes | `openRawLink.sendAsync` |
| File Explorer "Open in New Tab" | Yes | `openRawLink.sendAsync` |
| **NavigationPanel file click** | **No** | `pagesModel.navigatePageTo()` directly |
| **NavigationPanel search match** | **No** | `pagesModel.navigatePageTo()` directly |
| Settings "Open settings file" | Yes | `openRawLink.sendAsync` |
| ScriptPanel "Open in Tab" | Yes | `pagesModel.openFile()` redirect |
| PagesModel.openFile() (public API) | Yes | Redirects through `openRawLink` |
| Script API `app.pages.openFile()` | Yes | Uses PagesModel redirect |
| **openDiff** | **No** | `createPageFromFile()` directly |
| **navigatePageTo** | **No** | `createPageFromFile()` directly |

### `pagesModel.lifecycle.openFile` calls
- **Only in** `open-handler.ts:28` — correct single Layer 3 terminal point.

### `createPageFromFile` direct calls (bypassing pipeline)
- `PagesLifecycleModel.ts:232` — inside `lifecycle.openFile()`, used by open-handler. Correct.
- `PagesLifecycleModel.ts:305` — inside `openDiff()`. **Bypasses pipeline.**
- `PagesLifecycleModel.ts:309` — inside `openDiff()`. **Bypasses pipeline.**
- `PagesLifecycleModel.ts:367` — inside `navigatePageTo()`. **Bypasses pipeline.**

### Inconsistencies

1. **`openDiff()` bypasses pipeline** (`PagesLifecycleModel.ts:304-310`). Calls `createPageFromFile()` directly without constructing a content pipe. Functionally OK for local files but inconsistent with pipeline architecture.

2. **`navigatePageTo()` bypasses pipeline** (`PagesLifecycleModel.ts:367`). Calls `createPageFromFile()` without a pipe. The open-handler disposes the pipe before navigation (open-handler.ts:24-25), so even the pipeline path results in no pipe for navigation.

3. **Drag-drop only handles single file** (`GlobalEventService.ts:59-61`). Only `e.dataTransfer.files[0]` is processed.

### Concerns

1. **`navigatePageTo` in open-handler disposes pipe** (`open-handler.ts:24-25`). Pipe is constructed in Layer 2, passed to Layer 3, then disposed when metadata contains `pageId`. Navigated page has no pipe — always falls back to legacy file-reading.

2. **`openDiff` does not add files to recent list** (`PagesLifecycleModel.ts:291-327`). Pre-existing issue, not EPIC-012.

### Improvement Ideas

1. **Route `openDiff` through pipeline** (`PagesLifecycleModel.ts:304-310`). Complex due to needing both pages before grouping, but would ensure consistency.

2. **Pass pipe through `navigatePageTo`** (`PagesLifecycleModel.ts:331`). Add optional `pipe?: IContentPipe` parameter so open-handler can forward instead of disposing.

3. **Support multi-file drag-drop** (`GlobalEventService.ts:56-78`). Iterate all `e.dataTransfer.files`.

---

## Phase 6: Non-Migrated Editors Check

**Editors checked:** Grid, Markdown, Compare, Notebook, REST Client, Mermaid, Graph, Draw, Log View, HTML, SVG, Todo, Link Editor, Browser, About, Settings, MCP Inspector

### Key Finding: ContentViewModel Insulation

All content-based editors extend `ContentViewModel<TState>` which subscribes to `host.state` changes. The `host` is `TextFileModel` — which already has pipe integration. **All ContentViewModel-based editors already receive content through the pipe system indirectly.** They never access pipes directly, but they don't need to.

### Editor Categories

**ContentViewModel-based (12 editors):** Grid, Markdown, Notebook, REST Client, Mermaid, Graph, Draw, Log View, HTML, SVG, Todo, Link Editor — all work through content string abstraction. **Fully compatible, no migration needed.**

**Direct PageModel extensions (5 editors):** Compare (composes two TextFileModels), Browser (manages webviews), About (static), Settings (uses settings API), MCP Inspector (protocol connections). **Not affected by pipe changes.**

### Inconsistencies

1. **REST Client uses `require("fs")` directly** (line 684 in `RestClientViewModel.ts` and `multipartBuilder.ts`). For creating `ReadableStream` for HTTP uploads — legitimate streaming need, not content loading.

2. **Browser bookmarks use `require("fs")` directly** (`BrowserBookmarks.ts`, `BrowserBookmarksUIModel.ts`). For bookmark file I/O, unrelated to EPIC-012.

### Improvement Ideas

1. **Document ContentViewModel insulation benefit in EPIC-012 docs.** Strong design win that 12+ editors work with pipes without changes.

2. **Wrap REST Client `require("fs")` in utility function.** Keep the violation contained and documented.

3. **Future pipe-aware features:** Grid streaming for large files, Log View tailing, REST Client saving responses to pipe destinations.

---

## Phase 7: Script API & Type Definitions

**Files reviewed:** IoNamespace.ts, io.d.ts, io.pipe.d.ts, io.provider.d.ts, io.transformer.d.ts, io.events.d.ts, events.d.ts, AppWrapper.ts, AppEvents.ts, BaseEvent.ts, events.ts, ContentPipe.ts, all provider/transformer files, all assets/editor-types copies

### API Surface Status

- **IoNamespace exports vs IIoNamespace type:** All match (FileProvider, HttpProvider, ZipTransformer, DecryptTransformer, RawLinkEvent, OpenLinkEvent, createPipe)
- **Provider types vs implementations:** All match
- **Transformer types vs implementations:** All match (with minor write() signature note)
- **ContentPipe type vs implementation:** All match
- **Event proxy (AppWrapper):** Correctly wraps subscribe/send/sendAsync with cleanup tracking
- **Asset copies (editor-types):** All byte-identical to sources

### Inconsistencies

1. **`IOpenLinkEventConstructor` metadata type vs `IOpenLinkEvent` interface.** `io.d.ts:65` constructor uses `Record<string, unknown>`. `io.events.d.ts:35` interface uses `ILinkMetadata`. Implementation uses `Record<string, unknown>`. Scripts see different types depending on whether they look at constructor result or event channel parameter.

2. **`IOpenLinkEventConstructor` return type metadata diverges.** `io.d.ts:65-69` inline return type says `Record<string, unknown>`, but `IOpenLinkEvent` says `ILinkMetadata`.

### Concerns

1. **`DecryptTransformer.write()` ignores `original` parameter.** Not a bug — only ZipTransformer needs originals. But script authors reading the type definition might be confused.

2. **`OpenContentEvent` not exposed in IoNamespace.** Scripts cannot bypass Layer 1/2 to directly open a pre-assembled pipe. Appears intentional but not documented.

### Improvement Ideas

1. **Expose `OpenContentEvent` for advanced scripting.** Allow scripts to fire `openContent` directly with a pre-assembled pipe.

2. **Align `IOpenLinkEventConstructor` metadata type.** Change `Record<string, unknown>` to `ILinkMetadata` for better autocomplete.

3. **Add `ILinkMetadata` to `io.d.ts` re-exports.** Better discoverability.

4. **Document `io` namespace pipeline model at top of `io.d.ts`.** Brief summary explaining when to use `RawLinkEvent` vs `OpenLinkEvent` vs constructing a pipe directly.

---

## Phase 8: Pipe Serialization & State Persistence

**Files reviewed:** PageModel.ts (132), TextPageModel.ts (333), TextFileIOModel.ts (339), PagesModel.ts, PagesPersistenceModel.ts, PagesLifecycleModel.ts, ContentPipe.ts (183), registry.ts (62), all provider/transformer toDescriptor() methods, open-handler.ts (34), types.ts (IPageState)

### Serialization Round-Trip Status

| Component | Serializes | Restores | Data Loss? |
|-----------|-----------|----------|------------|
| FileProvider | Full | Full | None |
| HttpProvider | Full (sparse config) | Full | None |
| CacheFileProvider | Full | Full | None |
| ZipTransformer | Full | Full | None |
| DecryptTransformer | Has toDescriptor() but `persistent: false` | N/A | Correctly excluded from pipe persistence |
| ContentPipe | Provider + persistent transformers + encoding | Full | Non-persistent transformers excluded (correct) |
| **TextFileModel** | **Does NOT serialize pipe** | **Does NOT reconstruct pipe** | **HTTP pages lost on restart** |
| Base PageModel | Full (pipe descriptor in getRestoreData) | Full (createPipeFromDescriptor in applyRestoreData) | None |

### Inconsistencies

1. **TextFileModel.getRestoreData() does NOT serialize pipe** (`TextPageModel.ts:219-233`). Overrides base without calling `super`. Base `PageModel.getRestoreData()` adds `data.pipe = this.pipe.toDescriptor()`, but this is bypassed. HTTP pages lose their pipe on restart.

2. **TextFileModel.applyRestoreData() does NOT reconstruct pipe** (`TextPageModel.ts:235-251`). Overrides base without calling `super`. Even if pipe descriptor were present, it would be ignored.

3. **Duplicate encoding storage** (`TextPageModel.ts:244` and pipe descriptor). `TextFilePageModelState.encoding` and `IPipeDescriptor.encoding` both store encoding. During restore, `pipe.readText()` re-detects encoding. Unclear source of truth.

### Concerns

1. **DecryptTransformer.toDescriptor() includes password.** While `persistent: false` prevents inclusion in `ContentPipe.toDescriptor()`, calling `toDescriptor()` directly returns `{ password }` in plain text. Used by `clone()`/`cloneWithProvider()` paths.

2. **HTTP pages do not survive app restart.** On save, `filePath` = URL string, but pipe descriptor is not saved. On restore, `ensurePipe()` creates `FileProvider(url)` — fails when trying to read URL as local file path.

3. **Unknown provider/transformer types cause hard throws** (`registry.ts:28-31, 35-38`). Base `PageModel.applyRestoreData` wraps in try/catch, but `TextFileModel` bypasses this entirely.

4. **`createPipeFromDescriptor` does not validate descriptor structure** (`registry.ts:42-46`). If `descriptor.transformers` is `undefined` or `null`, `.map()` throws.

5. **No version field in `IPipeDescriptor`** (`io.pipe.d.ts:6-13`). No migration path if descriptor format changes.

### Improvement Ideas

1. **Serialize pipe in TextFileModel.getRestoreData().** Add `if (this.pipe) { pageData.pipe = this.pipe.toDescriptor(); }`.

2. **Add defensive validation in `createPipeFromDescriptor`.** Use `(descriptor.transformers ?? []).map(...)`.

3. **Don't include password in DecryptTransformer.config.** Store `config: {}` and use private `password` field internally.

4. **Add `version` field to `IPipeDescriptor`.** Even if unused now, simplifies future migration.

5. **`ensurePipe()` could detect URL-like filePaths.** Check if `filePath` starts with `http://` and create `HttpProvider` instead of `FileProvider` as safety net.

---

## Phase 9: Architecture Documentation

**Documents reviewed:** overview.md (253), folder-structure.md (546), scripting.md (~530), pages-architecture.md (323), state-management.md (367), coding-style.md (373), CLAUDE.md (335), EPIC-012.md (~800), user docs (partial)

### Inconsistencies

1. **overview.md: Dependency rules missing `content/` layer.** Lines 121-129 list all renderer subdirectories but omit `content/`. Its position should be between `api/` and `editors/`.

2. **EPIC-012 lists unimplemented items as current.** `io` namespace section (line 553-569) lists `BufferProvider`, `CacheFileProvider`, `GunzipTransformer`. Only `FileProvider`, `HttpProvider`, `ZipTransformer`, `DecryptTransformer` actually exist.

3. **EPIC-012: `openFile()` removal vs actual.** Resolved question #4 (line 692) says "Remove `app.pages.openFile()`." In practice, it was kept as a backward-compat wrapper through `openRawLink`.

4. **EPIC-012: `readText()`/`writeText()` mention `EncodingTransformer`.** Line 246-251 says these use `EncodingTransformer`. Actual implementation handles encoding via `decodeBuffer()`/`encodeString()` directly — no `EncodingTransformer` class.

5. **EPIC-012: OpenLinkEvent metadata type mismatch.** Code uses `Record<string, unknown>`, interface uses `ILinkMetadata`.

6. **EPIC-012: Folder structure lists nonexistent files.** Lines 516-538 list `BufferProvider.ts`, `GunzipTransformer.ts`, tree providers, `io.tree.d.ts`.

### Stale References

1. **EPIC-012: `subscribeDefault()` references** (lines 484-486). Presented as a needed change but has been completed. Should be marked as done/historical.

2. **EPIC-012: `openFile()` listed as "to be removed."** Was kept as a wrapper.

### Missing Documentation

1. **`openContent` channel not in user docs.** `docs/api/events.md` documents `openRawLink` and `openLink` but not `openContent`. It's exposed in `events.d.ts` and usable by scripts.

2. **No dedicated `io` API reference page.** Other globals (`app`, `page`, `ui`) each have dedicated API pages.

3. **`content/` not in dependency rules.** Developers have no guidance on what `content/` can import.

4. **No standalone content pipeline architecture doc.** Info is spread across overview.md, CLAUDE.md, and EPIC-012. Complexity warrants dedicated `doc/architecture/content-pipeline.md`.

### Concerns

1. **EPIC-012 mixes implemented and future items.** Reader cannot distinguish shipped from planned.

2. **No `openFile()` deprecation notice.** `pages.d.ts` shows no `@deprecated` tag. Scripts work fine but miss pipeline extensibility.

### Improvement Ideas

1. **Add `content/` to overview.md dependency rules.**

2. **Create `doc/architecture/content-pipeline.md`.** Dedicated doc for 3-layer pipeline, dual-pipe pattern, encoding, serialization, clone-and-try.

3. **Add implementation status markers to EPIC-012.** Mark future items with "(not yet implemented)".

4. **Fix `OpenLinkEvent` constructor type.** Use `ILinkMetadata` instead of `Record<string, unknown>`.

5. **Add `@deprecated` to `openFile()`.** Point to `app.events.openRawLink.sendAsync()`.

6. **Create `docs/api/io.md`.** User-facing API reference for `io` namespace.

7. **Document `openContent` in user docs.** Add section in `docs/api/events.md`.
