# US-1472: *Provider missing* placeholder and `PendingProvider`

**Status:** Planned · **Epic:** [EPIC-107](../../epics/EPIC-107.md) · **Depends on:** US-1471 board provider axes and EPIC-106 D4 lazy module-service start

## Goal

Replace the unknown-provider exception at the persisted-pipe boundary with a restorable,
read-only provider placeholder. A page must retain its identity, title, source link, and
original pipe descriptor while the declaring board is absent, then recover through the existing
page refresh paths when the board is trusted and its provider registers again.

This document is planning only. It does not change production code, add tests, or alter the
manifest owned by US-1471.

## Background

The binding specification is [EPIC-107 D8](../../epics/EPIC-107.md#d8--provider-missing-is-a-provider-placeholder-not-an-editor-fallback),
with [EPIC-105 D2](../../epics/EPIC-105.md#d2--unknown-provider-types-remain-errors-for-now) as the
deliberate deferral. The current throw is verified at
[`src/renderer/content/registry.ts:180-186`](../../../src/renderer/content/registry.ts):

```ts
const registration = providerFactories.get(descriptor.type);
if (!registration) {
    throw new Error(`Unknown provider type: "${descriptor.type}"`);
}
```

`createPipeFromDescriptor()` at `registry.ts:196-200` calls that factory and then constructs a
`ContentPipe`; transformer lookup remains a separate failure boundary. A malformed provider
descriptor must still throw before the map lookup: the factory accepts only a non-null object with
a string `type`; provider-specific config is passed through unchanged, while a well-formed descriptor whose
type is absent from the registry is the *missing* case.

`validateProviderShape()` at `registry.ts:49-83` verifies the required provider properties and
read/descriptor methods for registered providers; the placeholder must meet that same `IProvider`
shape even though it is not a new registration. `rebuild-pipe.ts:29-37` first asks the scheme
registry to reconstruct a descriptor pipe and then applies its ordinary HTTP/archive/file
fallbacks; it has no separate missing-provider recovery policy and therefore inherits the same
placeholder/read-consumer behavior.

The provider contract at
[`src/renderer/api/types/io.provider.d.ts:3-59`](../../../src/renderer/api/types/io.provider.d.ts)
already has the required shape. The placeholder will therefore be an internal implementation of
`IProvider`, not an editor and not a new public provider interface. It will expose
`restorable: true`, `writable: false`, no write or stream methods, a typed `readBinary()` failure,
and `toDescriptor()` returning the exact original `IProviderDescriptor` object without rewriting
its config.

### Verified consumers and current failure behavior

The complete direct factory inventory is:

| Verified call site | Current behavior | US-1472 behavior and user-visible result |
|---|---|---|
| `src/renderer/content/registry.ts:180`, `:196-197` | Unknown provider throws while reconstructing the pipe. Unknown transformers continue to throw. | Malformed descriptors and unknown transformers remain errors; an absent provider returns the placeholder. |
| `src/renderer/content/ContentPipe.ts:155-158` (`clone`) | Cloning a pipe whose descriptor names an absent provider throws. | The clone carries the placeholder and unchanged descriptor; its eventual read reports the typed provider error. |
| `src/renderer/content/scheme-registry.ts:106`, `:120`, `:136`, `:145`, `:151` | A scheme hook or source-path resolver can throw before a page is opened. | The pipe is created successfully and downstream consumers show the same existing provider-missing surface. A malformed descriptor still follows the existing error path. |
| `src/renderer/content/resolvers.ts:59`, `:71` | A resolver exception reaches the `openContent` event channel; `EventChannel`'s default handler logs it, so the page is not opened and the user gets no useful message. | The page opens with its identity and placeholder. Its read consumer reports the board/type and the existing reinstall/trust route. |
| `src/renderer/editors/text/TextEditorModel.ts:308-333` | `createPipeFromDescriptor()` is caught and converted to `null`; `TextFileIOModel.restore()` at `:249-283` catches the read failure, leaving default/blank content. `onFileChanged()` at `:293-327` also swallows a failed reread. | Keep the pipe for an absent provider. `TextFileIOModel` records the typed error, uses existing `ui.notify` with the board/type and “Tools & Editors → Search boards / reinstall or trust the board” route, and clears the error after the existing `pipe.watch()`/`onFileChanged()` reread succeeds. The page is never replaced or reopened. |
| `src/renderer/editors/board/BoardEditorModel.ts:511-548` and `BoardWebview.ts:513-530` | `ensureContentPath()` reads the pipe and rejects; the webview bridge posts only `errMessage(error)` back to the board. | Preserve that bridge contract, but make the typed message readable and notify through the existing UI surface. `BoardContentEditorModel` uses its existing `contentHostError` / `ContentErrorView` branch when host content is unavailable, and returns to the host branch when the existing host refresh succeeds. |

The indirect read consumers are also part of the user-facing contract:

- `src/renderer/editors/image/ImageEditor.ts:110-173` already uses `ui.notify` when its initial
  read has no cache fallback. Keep that existing error surface, with the typed message and route;
  use the provider's existing `watch` contract to retry when the provider becomes available.
- `src/renderer/editors/link-editor/pipe-image-src.ts:68-91` currently turns a failed archive
  image read into a silent `null`. Keep its deduplicated fallback, but notify once per failed
  source with the same typed message and route; a later tile refresh may retry after availability.
- `src/renderer/api/pages/PagesPersistenceModel.ts:218-223` logs an editor-restore exception and
  drops that editor. The placeholder path must not throw from normal provider reads, so this
  persistence-level fallback is not entered for an absent provider.

`ContentPipe.readBinary()` at `src/renderer/content/ContentPipe.ts:62` delegates to the provider,
and `watch` at `:142-145` delegates the provider watch. Those existing seams are sufficient for
availability-triggered rereads; no fallback editor, page replacement, or new dialog is needed.

### How the declaring board is discovered

The current sources do **not** answer this completely:

- `src/renderer/editors/board/custom-editor-registry.ts:122-167` enumerates trusted roots, but it
  only builds editor entries after `getBoardEditorAssociation()` and skips a trusted board with no
  editor association at `:142-143`. It has no provider declaration index today.
- `src/renderer/api/board-install-registry.ts` can identify an installed board independently of
  trust, but it does not currently index provider types.
- `src/renderer/api/published-boards.ts:23-130`, `src/main/published-boards-service.ts:88-187`,
  and the `PublishedBoardInfo` IPC type currently carry editor/mask/catalog data, not
  `contentProviders`. A catalog entry therefore cannot identify an uninstalled board by provider
  type today, and the type string cannot safely be reverse-engineered into a board id.

The resolved contract with US-1471 is:

1. `custom-editor-registry.ts` maintains a provider-declaration index alongside editor entries.
   It enumerates every compatible trusted manifest's `contentProviders`, including boards that
   have no file/folder editor association, and publishes each declaration to the content registry
   with `origin: "board"`, board root, board display name, and trusted status. The existing
   first-trusted-registration rule from EPIC-107 D2 remains the winner for duplicate types; later
   declarations remain diagnostics rather than silently replacing the winner.
2. The same declaration index reads installed-but-untrusted manifests through
   `board-install-registry.ts` and the existing manifest reader. It records the board and gives a
   trust/reinstall route, but it never starts an untrusted service.
3. The declaration lookup is by exact provider type and returns the best known board metadata.
   There are only two declaration tiers: trusted manifest declarations, then
   installed-but-untrusted declarations from `board-install-registry.ts` and the existing
   manifest reader. A known installed board opens its existing board-info/trust route. If no
   declaration is known (for example, a manually copied untrusted board absent from both indexes),
   the message names the missing type and directs the
   user to Tools & Editors → Search boards; it does not invent a board name or claim that a
   service can be started.

This makes the answer stable even when the board service is not loaded: local manifest metadata is
indexed without starting the board, while service startup is deferred to the pending read. The
published catalog cannot identify a provider type because the separate `persephone-boards`
catalog does not publish `contentProviders`.

### Restore ordering

The renderer bootstrap in `src/renderer.ts:13-18` imports registrations, awaits
`app.initServices()`, then `app.initPages()`, then installs events. Board enumeration is not a
blocking prerequisite: `src/renderer/editors/register-editors.ts:242` currently starts
`customEditorRegistry.ensureInitialized()` without awaiting it. Therefore a normal page restore
can call `TextEditorModel.applyRestoreData()` and reach `createProviderFromDescriptor()` before a
board declaration or provider factory has been registered.

The placeholder must cover that window. Factory lookup returns one stateful object immediately;
its first `readBinary()` awaits the declaration index's initialization signal, then rechecks the
provider registry. If a trusted declaration is present but its provider is not registered, the
object enters the `PendingProvider` state and calls the existing
`moduleService.acquire(boardRoot)` path. That path reaches
`api.requestModuleServicePort()` and `moduleServiceSupervisor.transferRendererPort()`, whose
existing `start(boardRoot, "request")` behavior is EPIC-106 D4's lazy start. US-1472 must not
create a supervisor, call a second start path, or start an untrusted board.

When the board service registers its provider, `registerProvider()` signals availability; the
pending object delegates the read to that real provider. If the service has no renderer port,
the existing acquire failure is converted to the typed provider-unavailable/missing error
specified by EPIC-107 D7, without hanging the page. This asynchronous state machine covers both
“board registration has not run yet” and “trusted service is stopped” windows without changing
bootstrap ordering.

## Implementation Plan

### 1. Define the placeholder at the provider-factory boundary

Change `src/renderer/content/registry.ts` only for the content-registry implementation and keep
its existing direct-import style.

- Add an internal `MissingProviderError` with a stable code/name, the missing provider type, and
  optional board metadata. Its message must be readable without a developer console, for example:
  `Provider "board.example/source" from board "Example Board" is unavailable. Reinstall or trust the board from Tools & Editors → Search boards.`
  With no known board, omit the board clause but retain the type and route.
- Add the `MissingProvider` state machine implementing `IProvider`. Its state is either
  `missing` or `pending`; `PendingProvider` is this same object after a trusted declaration is
  found, not a second wrapper or fallback editor. The object keeps the original descriptor,
  reports `restorable: true` and `writable: false`, omits write/stat/stream methods, and returns
  the unchanged descriptor from `toDescriptor()`.
- Implement `readBinary()` as a cached asynchronous operation. Recheck registration after the
  declaration index is ready; for an exact trusted declaration with a board root, call
  `moduleService.acquire(boardRoot)`, wait for the normal provider-registration notification,
  then delegate to the registered factory/provider. Bound the combined acquire-and-registration
  wait by the existing `SERVICE_REQUEST_DEADLINE_MS` from
  `src/ipc/module-service-channels.ts` (currently 10 seconds); do not invent a second timeout
  vocabulary. On expiry, reject with the same `MissingProviderError` or a typed
  provider-unavailable variant, and settle every waiter. Store the attempt promise on the
  placeholder (and key the registry-level acquire attempt by provider type/board root if needed)
  so a second `readBinary()` while the first is pending shares it and does not start another
  service acquire. For an untrusted, installed, or unknown declaration, reject with
  `MissingProviderError` and do not start a service.
- Give the placeholder `watch(callback)` so `ContentPipe.watch` can deliver an availability event
  when a declaration/factory becomes usable. Disposing that watch must remove the listener.
- Keep `stat()` and `createReadStream()` omitted: both are optional in `IProvider`, so the pipe
  treats them as unsupported and uses its own typed error path. Coordinate with US-1475 so its
  pipe-level `stat()`/`createReadStream()` work checks for the optional provider methods rather
  than calling either unconditionally and exposing a raw `TypeError`.
- Preserve the existing provider factory's registration semantics and notify listeners whenever a
  provider is registered or a board declaration becomes available. The declaration index must
  not replace the runtime provider map or alter first-wins duplicate handling.
- Before looking up `providerFactories`, guard the descriptor as malformed when it is not a
  non-null object or has no string `type`. Throw the malformed-descriptor error there. Pass
  provider-specific config through unchanged. Only a well-formed, unregistered type
  becomes a placeholder. Keep unknown transformer types throwing in
  `createTransformerFromDescriptor()`.

Before:

```ts
if (!registration) {
    throw new Error(`Unknown provider type: "${descriptor.type}"`);
}
```

After:

```ts
if (!isProviderDescriptor(descriptor)) {
    throw new Error("Malformed provider descriptor: expected an object with a string type.");
}
return registration
    ? registration.factory(descriptor.config)
    : new MissingProvider(descriptor, resolveProviderDeclaration(descriptor.type));
```

The final code may use the registry's concrete names, but it must preserve these two distinct
branches and must not clone or normalize the descriptor in the missing branch.

### 2. Connect declaration discovery to the registry

Add the smallest registry-facing declaration API needed by the US-1471 trusted-board refresh (for
example, a typed `registerProviderDeclaration`, exact-type lookup, initialization promise, and
availability subscription). Keep board filesystem and installed-manifest enumeration in the board registry; the
content registry should consume declarations and runtime registration events, not rescan manifests
or duplicate trust logic. US-1471's existing owner-aware registration result is the source of
trusted declaration order and collision ownership; the declaration record must survive the removal
of a board-owned runtime registration so a missing page can still name that board.

The declaration record must distinguish at least:

- exact provider type;
- board root and display name when installed;
- `trusted` and therefore eligible for lazy service start;
- declaration source/order for first-wins and duplicate diagnostics.

US-1471 also adds `board-provider-factory.ts`, which is a deferred board-provider seam rather than
proof that a live board service has registered its real provider. The seam must expose that
distinction to this state machine: a trusted declaration with no live provider is `PendingProvider`
and its first read uses `moduleService.acquire()`; once the service installs the real delegate,
the pending object delegates to it. If the seam instead returns a provider proxy, that proxy must
have the same observable behavior and ownership path. It must not make a stopped service look like
a successfully readable provider or create a second lazy-start supervisor.

US-1471 owns all manifest and catalog schema edits. In particular, do not edit
`src/renderer/editors/board/board-manifest.ts` in US-1472. The declaration index must be populated
for trusted boards even when `getBoardEditorAssociation()` returns no editor association.

### 3. Preserve page state and surface readable errors

- In `src/renderer/editors/text/TextEditorModel.ts`, retain the existing try/catch for genuinely
  malformed descriptors so a corrupt persisted page cannot crash page restore, but ensure the
  well-formed missing-provider result is non-null and passed to `setPipe()`. `getRestoreData()`
  already serializes `this.pipe.toDescriptor()` at `:292-305`; that is the persistence guarantee.
- In `src/renderer/editors/text/TextFileIOModel.ts`, track the most recent typed provider read
  error separately from the text content. On initial restore and `onFileChanged`, notify through
  existing `ui.notify` using `errMessage` for caught values and the typed message for the missing
  provider. Do not convert the missing provider into `deleted`, an empty replacement, or a new
  page. Clear the error only after a successful reread. Expose the transient error to the board
  content host through the existing `TextFileModel.io` relationship.
- In `src/renderer/editors/board/BoardContentEditorModel.ts`, after the host restore, use that
  transient error to populate the existing `contentHostError` state and therefore the existing
  `ContentErrorView` in `BoardEditorView.ts:181-190` and `:239-260`. Clear it when the host's
  existing reread succeeds; do not add a dialog or fallback editor.
- In `src/renderer/editors/board/BoardWebview.ts`, preserve the existing `filePath:result`
  rejection contract, but ensure the error sent to the board is the typed readable message. Use
  one existing `ui.notify` surface for the app user rather than inventing an alert action.
- In `src/renderer/editors/image/ImageEditor.ts`, retain its existing initial-read
  `ui.notify`/cache fallback and subscribe the pipe through the existing `IProvider.watch`
  contract so a missing image retries when the provider becomes available. Dispose that
  subscription with the editor.
- In `src/renderer/editors/link-editor/pipe-image-src.ts`, retain the one-at-a-time failure cache
  but add a deduplicated existing `ui.notify` for a typed missing-provider failure. Do not turn
  the tile fallback into a new modal surface.
- Keep `src/renderer/api/ui.ts` and the `ui.alerts` types unchanged. `ui.alerts` is the existing
  alert observation/dismissal API; `ui.notify` and `ContentErrorView` are the user-facing surfaces
  that fit these call sites.

Every new catch that handles an unknown value must pass it through `errMessage` or `guard`; do not
use `error as Error`. Keep colors out of this work; no UI color is needed, and any future styling
must use `theme/color`. Use `file-path` utilities and direct imports; do not add `require("path")`
or barrel imports.

### 4. Recover without reopening

The recovery sequence is:

```text
re-trust board
  → board trust subscription refreshes declarations
  → board service registers provider (lazy-started on demand if needed)
  → registry availability event reaches MissingProvider.watch()
  → existing TextFileIOModel.onFileChanged()/editor refresh rereads pipe
  → placeholder delegates and the existing error surface clears
```

The text and content-host paths reuse `TextFileIOModel.setupWatch()` and
`onFileChanged()`; image recovery reuses the provider `watch` contract and its existing restore
read; link tiles retry through their existing tile refresh. No page reload, editor replacement,
new route, or user reopening is allowed. `sourceLink.pipeDescriptor`, the text page's pipe
descriptor, title, identity, and source metadata remain unchanged throughout.

### 5. Type and compatibility boundaries

Do not change `IProvider` or `IProviderDescriptor` unless implementation proves a public contract
is missing; the current contract already supports a read-only placeholder and optional `watch`.
If a public declaration is changed despite that, mirror the byte-identical change in
`assets/editor-types/`, update `_imports.txt`, and document both copies. Do not add tests or test
harnesses, per project policy.

## Concerns

### Declaration metadata must outlive board services

The current trusted editor registry is insufficient on its own because it does not yet retain
provider declarations after a board-owned runtime registration is removed. US-1471 provides the
trusted manifest axis and owner-aware registration; US-1472 must retain the two local declaration
tiers without starting an untrusted service. The published catalog has no `contentProviders`
field, so the safe result for an uninstalled or otherwise unknown board is a type-only error and
Search Boards route, never a guessed board or an untrusted service start.

### Lazy start must remain single-owner

`src/renderer/api/module-service.ts` already acquires the renderer port, and
`src/main/module-service-supervisor.ts` already starts the service from
`transferRendererPort()` with the D4 request reason. Pending reads must call that existing path
only. A no-port or start failure must reject promptly with the typed provider-unavailable error;
it must not leave a pending read unresolved.

### Restore can precede declaration enumeration

The unawaited `ensureInitialized()` call means page restore can reach the factory first. Returning
the stateful placeholder synchronously and awaiting declaration readiness inside `readBinary()` is
the required ordering solution. Do not “fix” it by awaiting every board service before
`pages.init()`, which would violate lazy-start behavior and delay unrelated pages.

### Descriptor integrity and corrupt state

The placeholder is for an absent registration only. A non-object descriptor or a descriptor without
a string `type` remains an exception at the factory boundary. Provider-specific config is passed
through unchanged so the placeholder can round-trip it; provider factories remain responsible for
their own config validation once available. A caller may catch a malformed-descriptor exception to
protect page restoration, but it must not serialize a replacement descriptor. An absent
transformer remains an exception too; D8 changes provider absence, not general persistence
corruption.

### User messaging and duplicate notifications

The typed error must carry board/type/route once. Text, board, image, and link consumers must
avoid stacking the same notification on every watcher tick; notify on the initial failed read and
again only after a meaningful retry/failure transition. A failed availability reread must not
re-enter its own notify/retry cycle: `pipe-image-src.ts` keeps its existing per-source failed set,
and `TextFileIOModel` clears the in-flight/error latch and re-arms only for a later availability
event. The board's existing content error state may remain visible until the same provider's
successful reread clears it.

### Files deliberately outside this task

US-1471 owns `board-manifest.ts`, the manifest axis, provider registration from trusted boards,
and catalog schema. Do not edit those files here. Do not edit
`doc/active-work.md` or `doc/epics/EPIC-107.md`; Claude owns both. Do not add a fallback editor.

## Deferred

A catalog-driven “install a board that provides this type” route is deferred until the separate
`persephone-boards` catalog publishes `contentProviders`. This task does not add speculative
catalog plumbing; until that data exists, unknown or uninstalled boards receive the honest
type-only Search Boards route.

## Acceptance Criteria

- A non-object or missing-`type` provider descriptor still throws a malformed-descriptor error;
  a well-formed unregistered type no longer throws from `createProviderFromDescriptor()`.
- The missing object satisfies `IProvider` with `restorable === true`, `writable === false`, no
  write capability, and a typed `readBinary()` rejection naming the exact type and the declaring
  board when the declaration index knows one.
- `toDescriptor()` returns the original provider descriptor unchanged, including unknown config
  fields; saving/restoring a page does not discard the board provider's state.
- A trusted declaration whose service is stopped enters the same object's pending state, starts
  the service through `moduleService.acquire()`/EPIC-106 D4, delegates after provider registration,
  and rejects promptly if the service has no renderer port. No second supervisor is introduced.
- A board that is installed but untrusted is identified without starting through
  `board-install-registry.ts` and the existing manifest reader. An uninstalled or otherwise
  unknown board gets a type-only Search Boards route rather than a guessed board.
- A pending acquire/registration attempt uses `SERVICE_REQUEST_DEADLINE_MS`, settles with a typed
  missing/unavailable error on expiry, and shares one in-flight attempt for concurrent reads.
- Text restore, board content, image restore, archive image tiles, scheme hooks, and source-path
  resolution no longer turn missing providers into blank content or an unhelpful console-only
  failure. Each applicable existing surface shows the readable type/board/reinstall-or-trust
  message.
- Re-trusting or reinstalling the declaring board makes the existing pipe watch/refresh path
  reread the page and clear the error without reopening it. Page identity, title, source link, and
  descriptor remain intact.
- Restore ordering is safe when `pages.init()` reaches the factory before trusted-board
  enumeration: the pending read waits for declaration readiness and provider registration.
- Unknown transformer behavior, provider first-wins duplicate behavior, trust enforcement, and
  module-service ownership remain unchanged.
- Verification uses the repository's normal typecheck, lint, and production build gates only; no
  unit tests or test harnesses are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/content/registry.ts` | Add malformed-descriptor guard, declaration bridge, typed error, stateful missing/pending provider, availability signaling, and missing-provider factory behavior. |
| `src/renderer/editors/text/TextEditorModel.ts` | Preserve the placeholder returned by the factory and expose/retain its transient read-error state as needed by the existing host path. |
| `src/renderer/editors/text/TextFileIOModel.ts` | Report typed provider failures through `ui.notify`, track transient failure, and clear it through the existing watch reread. |
| `src/renderer/editors/board/BoardContentEditorModel.ts` | Feed the existing `contentHostError` / `ContentErrorView` branch and clear it after recovery. |
| `src/renderer/editors/board/BoardWebview.ts` | Preserve the existing bridge reply while surfacing the typed message through the existing UI path. |
| `src/renderer/editors/image/ImageEditor.ts` | Reuse provider watch for missing-image recovery while retaining its existing notification/cache behavior. |
| `src/renderer/editors/link-editor/pipe-image-src.ts` | Add a deduplicated existing-surface notification for silent archive-image read failures. |

The following files need **no changes in US-1472**: `src/renderer/api/types/io.provider.d.ts`,
`assets/editor-types/io.provider.d.ts`, `assets/editor-types/_imports.txt`,
`src/renderer/api/ui.ts`, `src/renderer/api/types/ui.d.ts`,
`src/renderer/api/module-service.ts`, `src/main/module-service-supervisor.ts`,
`src/renderer/content/ContentPipe.ts`, `src/renderer/content/rebuild-pipe.ts`,
`src/renderer/content/scheme-registry.ts`, `src/renderer/content/resolvers.ts`,
`src/renderer/api/board-install-registry.ts`, `src/renderer/editors/board-info/open-board-info.ts`,
`src/main/published-boards-service.ts`, `src/ipc/api-param-types.ts`, and
`src/renderer/api/published-boards.ts`.
The US-1471-owned manifest axis, trusted provider/scheme registration, owner-aware registries, and
Board Info diagnostics are prerequisites to consume, not edits to make in this task. Catalog-driven
provider discovery is deferred until the external catalog publishes the required field.
