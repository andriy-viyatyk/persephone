# US-1459 — Registry-aware `pipeFromSourcePath`

**Status:** Planned  ·  **Epic:** [EPIC-105](../../epics/EPIC-105.md)  ·  **Depends on:** [US-1458 — Scheme registry](../US-1458-scheme-registry/README.md)

## Goal

Make `src/renderer/content/rebuild-pipe.ts:22-36` consult the US-1458 scheme registry before its
existing `http(s)` / archive-`!` / file shape guesses. A restored or path-only consumer with a
registered scheme must receive that scheme's pipe; an unregistered scheme must retain today's
shape-guessing behavior and must not gain the Phase C provider-missing placeholder.

This task is investigation and planning only. No production source, test harness, or test file is
changed by this document.

## Background

EPIC-105 D2 requires that `createPipeFromDescriptor()` continue to throw for unknown provider and
transformer types. This task only changes how a bare source path is rebuilt; it must not add a
missing-provider state or catch an unknown provider. D3 still governs the archive and file
fallbacks, and D8 requires app-observable restore/open verification.

The current implementation is synchronous and shape-based:

```ts
export function pipeFromSourcePath(path: string): IContentPipe {
    if (path.startsWith("http://") || path.startsWith("https://")) {
        return new ContentPipe(new HttpProvider(path));
    }
    const bangIndex = path.indexOf("!");
    if (bangIndex >= 0) {
        return new ContentPipe(
            new FileProvider(path.slice(0, bangIndex)),
            [new ArchiveTransformer(path.slice(0, bangIndex), path.slice(bangIndex + 1))],
        );
    }
    return new ContentPipe(new FileProvider(path));
}
```

The exact current source is `rebuild-pipe.ts:22-36`. Its docstring at lines 7-20 says it is the
fallback when a live pipe is absent, that callers should prefer `createPipeFromDescriptor()` when
available, and that the three recognized shapes are HTTP(S), archive `!`, and everything else as a
file. The first two statements remain true after this task; the “three recognized shapes” wording
must include a registered-scheme lookup ahead of those fallbacks.

### All current callers and the user-visible consequence of a wrong pipe

`rg` finds four direct consumers of `pipeFromSourcePath()`:

| Caller and exact line | Current call path | What a wrong pipe means today |
|---|---|---|
| `src/renderer/editors/link-editor/pipe-image-src.ts:68-93`, call at `:77` in `resolvePipeImageSrc()` | A tile source that `isPipeImageSrc()` has classified as an archive entry is read once, converted to a blob URL, and cached. The current predicate at `:57-59` only selects archive paths; ordinary HTTP/data/blob/file/plain paths stay in the DOM. | For the current archive inputs, a wrong pipe makes the read fail, so the tile renders its fallback glyph and the failed source is cached in `failed`. A registered non-archive scheme is not currently sent here because of the predicate; the registry-aware function must still preserve archive behavior and be safe if that predicate later admits a scheme source. |
| `src/renderer/editors/image/ImageEditor.ts:68-75`, call at `:74` in `ensurePipe()`; callers at `:114` (`restore`) and `:240` (`saveOriginal`) | A restored or otherwise path-only image model rebuilds its pipe when no live pipe is attached. `restore()` reads it and creates a blob URL; if reading fails it tries the image cache and shows the existing error toast at `:146-149`. `saveOriginal()` reads the same pipe for the save action. | A registered-scheme path is currently guessed as a `FileProvider` path. Restore therefore cannot read the source, falls back to cache or shows “Failed to load image”, and Save Original fails or saves nothing useful. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:98-100`, called by `openDiff()` at `:589` and `:596` | Each missing side of a two-file compare gets a path-derived pipe before `createEditorFromFile()`; `openDiff()` is asynchronous and uses `guard()` to abort a half-built comparison. | A registered-scheme side is treated as a local file or archive guess. The side cannot be read or is opened with the wrong source; the guarded operation reports `Failed to open <basename>` and refuses to group a half-built compare. |
| `src/renderer/editors/board/BoardEditorModel.ts:511-547`, call at `:524` in `ensureContentPath()` | When a board has no live pipe and no persisted `sourceLink.pipeDescriptor`, it rebuilds one and either returns a plain file provider's `sourceUrl` directly (`:527-533`) or materializes non-local/transformed bytes to the board cache (`:535-546`). | A registered-scheme source becomes a file provider whose `sourceUrl` is literally the scheme URI. Because it has no transformer, the board receives that URI as if it were a local path and cannot read the content. This is the silent “wrong local path” failure the registry lookup fixes. |

The board's persisted-descriptor branch at `BoardEditorModel.ts:518-524` already prefers
`createPipeFromDescriptor()`. US-1459 changes only its fallback branch, not the preferred
descriptor path.

## Implementation Plan

### Decision: `pipeFromSourcePath()` becomes asynchronous

This is a deliberate API decision, not an incidental implementation detail. The registry hook
contract must remain able to perform asynchronous work such as the current guide resolver's
`await getGuidePage()` at `src/renderer/content/resolvers.ts:203-205`; keeping a synchronous
`pipeFromSourcePath()` would permanently exclude that valid registered-scheme hook from restored
and path-only sources. The known cost is exactly four consumers: `resolvePipeImageSrc()` at
`src/renderer/editors/link-editor/pipe-image-src.ts:77`, `ImageEditor.ensurePipe()` and its
`restore()` / `saveOriginal()` callers at `ImageEditor.ts:70-75,114,240`,
`PagesLifecycleModel.createPipeFromPath()` and `openDiff()` at `PagesLifecycleModel.ts:98-100,589,596`,
and `BoardEditorModel.ensureContentPath()` at `BoardEditorModel.ts:511-524`. All four are already
inside async workflows, so this is a contained cost rather than a reason to weaken the hook shape.

### 1. Define the registry lookup contract from US-1458

US-1458 should expose a source-path lookup from its scheme registry, conceptually:

```ts
resolveRegisteredSourcePath(path: string): Promise<IContentPipe | undefined>;
```

It extracts the URI scheme (including `data:` forms), finds the registered entry, and runs the
entry's parse and resolve hooks in the registry's `phase: "source-path"` context. The context's
delegate never sends `openRawLink`, `openLink`, or `openContent` to the application; it only lets a
parse hook advance to its registered resolve hook. The lookup returns:

- the hook's `data.pipe`, if supplied;
- otherwise `createPipeFromDescriptor(data.pipeDescriptor)`, if supplied; or
- `undefined` when there is no registered entry or the entry deliberately declines without a pipe.

For a valid registered built-in source, the result is therefore the same provider/transformer
shape as the normal pipeline: `HttpProvider` for HTTP(S), `DataUrlProvider` for data URLs,
`MnemeProvider` for `mneme://`, `GuideProvider` for a valid `persephone-guide://`, and the current
placeholder `FileProvider` for the virtual board/toolset/tree/folder identities. A scheme hook that
constructs an unknown provider descriptor still reaches `createPipeFromDescriptor()` and throws;
US-1459 must not turn that error into `undefined` or a provider-missing object.

The lookup is asynchronous because the existing guide resolver awaits `getGuidePage()` at
`resolvers.ts:203-205`, and the US-1458 hook contract must be able to preserve that async work.

### 2. Make the registered-scheme branch first, then preserve every old shape

Change `pipeFromSourcePath()` to an async function and put the registry lookup before the current
branches:

Before:

```ts
export function pipeFromSourcePath(path: string): IContentPipe {
    if (path.startsWith("http://") || path.startsWith("https://")) return httpPipe(path);
    if (path.includes("!")) return archivePipe(path);
    return filePipe(path);
}
```

After (planned shape):

```ts
export async function pipeFromSourcePath(path: string): Promise<IContentPipe> {
    const registered = await resolveRegisteredSourcePath(path);
    if (registered) return registered;
    if (path.startsWith("http://") || path.startsWith("https://")) return httpPipe(path);
    if (path.includes("!")) return archivePipe(path);
    return filePipe(path);
}
```

The exact implementation must retain the current `indexOf("!")`, archive provider path, inner
entry path, and transformer construction. The explicit precedence is:

1. **Registered scheme lookup.** A registered scheme wins even when its payload contains `!`; the
   payload must not be split as an archive path. A registered HTTP(S) entry is returned from the
   lookup in source-path mode, preserving the current unconditional HTTP provider behavior even
   when the URL has no recognized content extension.
2. **Current HTTP(S) shape fallback.** This is a safety fallback for a future/unusual build where
   the HTTP scheme is not registered; it remains exactly `new HttpProvider(path)`.
3. **Current archive `!` shape.** This remains the second non-scheme fallback and still beats the
   plain file branch.
4. **Current file shape.** Everything else becomes `new FileProvider(path)`.

For an unregistered scheme, the registry lookup returns `undefined` and steps 2–4 run unchanged.
Thus `unknown://resource` still becomes a `FileProvider("unknown://resource")`; an unknown path
containing `!` still follows the existing archive guess. No provider-missing placeholder, reinstall
entry, or pending provider is introduced, which is the explicit EPIC-105 D2 requirement and keeps
the current user-visible failure mode.

### 3. Await all four consumers without changing their higher-level behavior

- `src/renderer/editors/link-editor/pipe-image-src.ts:77`: await the async pipe before
  `readBinary()`. Keep the cache, failed-source set, MIME lookup, and blob URL behavior unchanged.
- `src/renderer/editors/image/ImageEditor.ts:70-75,105-164,238-247`: make `ensurePipe()` async,
  await it in `restore()` and `saveOriginal()`, and leave the existing cache fallback, error toast,
  save dialog, and pipe ownership unchanged. Verify that no synchronous caller remains; the only
  two callers are the lines identified above.
- `src/renderer/api/pages/PagesLifecycleModel.ts:98-100,577-606`: make the private helper async
  and await each side's pipe before the existing guarded `createEditorFromFile()` call. Preserve
  the existing “abort rather than group a half-built comparison” behavior.
- `src/renderer/editors/board/BoardEditorModel.ts:511-547`: await the registry-aware fallback
  only in the no-descriptor branch. Preserve the plain-file fast path, cache materialization,
  content-path state updates, and disposal behavior.

No caller should invoke the source-path resolver in a way that can open a page. In particular,
`ImageEditor.restore()` and `BoardEditorModel.ensureContentPath()` must receive only a pipe.

### 4. Correct the `rebuild-pipe.ts` documentation

The current docstring remains directionally true but becomes incomplete. Update it to say that the
function is asynchronous, first asks the scheme registry for a registered source-path pipe, still
falls back to HTTP(S), archive `!`, and file shape guessing, and still should not be used when a
persisted descriptor is available.

Before:

```text
Recognized shapes:
- http(s) → HttpProvider
- archive!entry → FileProvider + ArchiveTransformer
- anything else → FileProvider
```

After:

```text
Resolution order:
- registered scheme → the registry's source-path pipe
- http(s) → HttpProvider fallback
- archive!entry → FileProvider + ArchiveTransformer fallback
- anything else → FileProvider fallback
```

The updated comment must explicitly say that unknown schemes retain the final shape guess and that
`createPipeFromDescriptor(pipeDescriptor)` remains preferred for persisted descriptors.

### 5. Verify restores and fallback behavior by using the app

Exercise each direct consumer with the source forms it can receive. The verification should include
a restored built-in-scheme source (especially an image), an HTTP source, an archive image/entry, a
plain file, a compare operation, and a board with a path-only source. Also exercise an unregistered
scheme and observe the existing failed-local-path behavior rather than a provider-missing UI.

## Concerns

1. **The function's return type changes from synchronous to asynchronous.** All four current direct
   consumers are already in async workflows, but `ImageEditor.saveOriginal()` is an async arrow
   method whose internal `ensurePipe()` call must be updated explicitly. The call-site inventory
   above resolves the only known impact; any new `rg` hit found during implementation must be
   handled before code is considered complete.
2. **Registered resolver hooks must distinguish opening from rebuilding.** Reusing the normal HTTP
   resolver without a source-path context would incorrectly route an extensionless URL to the
   browser instead of returning the current `HttpProvider`. Reusing the drawing-image hook without
   a context could create a new drawing during image restore. The two-phase hook context from
   US-1458 is therefore required, not optional.
3. **A registered scheme can still fail for its own provider.** That failure is intentionally not
   softened. `createPipeFromDescriptor()` remains the single construction boundary and keeps its
   current throw behavior under D2.
4. **Startup ordering is a dependency, not a local rebuild detail.** `src/renderer/api/app.ts:232-242`
   currently registers pipeline subscribers in `initEvents()` after `initPages()`, and US-1458
   intentionally leaves that ordering unchanged. Its module-load declarations make the registry map
   available whenever the source-path lookup runs, while the cold-start file/URL event loss remains
   a separate, unimplemented US-1463 diagnosis.
5. **No tests or provider placeholder are in scope.** The project explicitly has no unit-test
   framework for this work, and Phase C owns missing-provider UX. Verification is manual and
   observable as required by D8.

## Acceptance Criteria

These are app observations rather than compilation claims:

- After restarting with a page whose path carries a registered built-in scheme, the page reads the
  same content it had before restart; a registered-scheme image displays instead of falling back to
  a blank/failed image, and no extra page opens during restore.
- A normal HTTP(S) source still reads through HTTP, including an extensionless URL supplied to a
  path-only consumer; it is not accidentally routed to the browser by the rebuild helper.
- An archive image/entry still displays and saves through the same `FileProvider` plus archive
  transformer behavior, and a plain local file still uses the direct file path behavior.
- Opening a two-sided compare with path-only sources still creates the same grouped compare page;
  if one source cannot be read, the existing failure toast/abort behavior remains and no half-built
  comparison is grouped.
- A board that materializes a registered-scheme source receives readable content, while a plain
  local file still takes the no-copy fast path.
- A path with an unregistered scheme behaves as it did before this task: it follows the HTTP,
  archive-`!`, or file guess, and users do not see a provider-missing placeholder or reinstall
  affordance.
- A source whose registered resolver produces an unknown provider type still follows the existing
  thrown/failure path from `createPipeFromDescriptor()`; the task has not hidden that error.
- The source-path helper's updated documentation accurately describes registry-first lookup,
  fallback precedence, async callers, and continued preference for persisted descriptors.

## Files that need no changes

- `src/renderer/content/registry.ts` — its descriptor-construction behavior is governed by US-1458
  and D2; this task must not alter the unknown-provider throw.
- `src/renderer/content/parsers.ts`, `src/renderer/content/resolvers.ts`, and
  `src/renderer/api/pages/open-url-validation.ts` — their scheme migration and derived validation
  are US-1458 work, not a second implementation in this task.
- `doc/active-work.md` and `doc/epics/EPIC-105.md` — explicitly excluded by the user.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/content/rebuild-pipe.ts` | Registry-first async lookup, unchanged HTTP/archive/file fallbacks, corrected docstring | No |
| `src/renderer/content/registry.ts` | US-1458 source-path lookup contract used by this task; descriptor construction remains unchanged | No |
| `src/renderer/editors/link-editor/pipe-image-src.ts` | Await path-derived pipe before reading image bytes | No |
| `src/renderer/editors/image/ImageEditor.ts` | Await `ensurePipe()` from restore and Save Original | No |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Await path-derived pipes for compare sides | No |
| `src/renderer/editors/board/BoardEditorModel.ts` | Await registry-aware fallback in the no-descriptor branch | No |
| `src/renderer/content/registry.ts` | No US-1459 behavior change; D2 factory semantics remain unchanged | No |
| `src/renderer/content/parsers.ts` | No direct US-1459 change; registry registration is US-1458 | No |
| `src/renderer/content/resolvers.ts` | No direct US-1459 change; hook migration is US-1458 | No |
| `src/renderer/api/pages/open-url-validation.ts` | No direct US-1459 change; derived validation is US-1458 | No |
| `doc/active-work.md` | Dashboard update normally required, explicitly forbidden by the user | No |
| `doc/epics/EPIC-105.md` | Epic update normally required, explicitly forbidden by the user | No |
| `doc/tasks/US-1459-registry-aware-pipe-from-source-path/README.md` | This investigation and implementation plan | Yes |
