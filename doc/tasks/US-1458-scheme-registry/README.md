# US-1458 — Scheme registry

**Status:** Planned  ·  **Epic:** [EPIC-105](../../epics/EPIC-105.md)  ·  **Depends on:** none

## Goal

Introduce one registry-backed scheme seam for the content pipeline. A built-in or future module
will register `registerScheme(scheme, { parse, resolve })`; the registry will dispatch by scheme,
the existing event channels will remain the transport, and `PIPELINE_SCHEMES` will be derived from
the registry rather than maintained as a second list.

This task is investigation and planning only. It must not change production code until the user
reviews this document. US-1459 depends on this registry and is documented separately.

Final layout: provider/transformer factories remain in `registry.ts`; scheme mechanics live in
`scheme-registry.ts`; built-in hooks and their declarations live in `builtin-schemes.ts`.

## Background

The requested architecture is Phase A of the [platform roadmap](../../platform-roadmap.md),
especially §2, §3.2, and §4 Phase A. The binding epic decisions are:

- **D1:** `openRawLink`, `openLink`, and `openContent` remain `EventChannel`s with their current
  LIFO async and `handled` semantics. The registry is a facade that installs dispatch, not a new
  pipeline that replaces those channels.
- **D2:** `createPipeFromDescriptor()` keeps throwing for an unknown provider or transformer type.
  The provider-missing placeholder and pending provider are Phase C, not this task.
- **D3:** plain file paths and archive `!` paths remain the two special non-scheme fallbacks. They
  are not registry entries; archive still beats the file fallback.
- **D8:** verification is by observable QA-surface behavior and a scheme-by-scheme walk, not by a
  claim that the code compiled.

The architecture table in [content-pipeline.md](../../architecture/content-pipeline.md) lists the
current Layer 1 inputs and the registered scheme set. The current implementation is split across:

- `src/renderer/content/parsers.ts:44-232` — Layer 1 subscribers installed by
  `registerRawLinkParsers()`.
- `src/renderer/content/resolvers.ts:110-392` — Layer 2 subscribers installed by
  `registerResolvers()`.
- `src/renderer/content/registry.ts:17-48` — provider/transformer maps and pipe reconstruction.
- `src/renderer/api/pages/open-url-validation.ts:1-104` — a hand-maintained acceptance set used by
  `validatePipelineOpenInput()`.
- `src/renderer/api/events/EventChannel.ts:12-73` — FIFO `send()`, LIFO async `sendAsync()`, and
  short-circuiting when `data.handled` becomes `true`.

The current `registry.ts` provider map uses `Map.set()` at lines 20-25, so duplicate provider or
transformer registration silently replaces the first entry. The current scheme maps do not exist.

### Verified Layer 1 inventory

The table below is the complete set of current `openRawLink` subscribers inside
`registerRawLinkParsers()`. “Delegates” means the subscriber calls `app.events.openLink.sendAsync`
with the same mutable `ILinkData`; after that returns it sets `data.handled = true`, except for
validation failures that handle the event themselves.

| Current entry and source | Match | `ILinkData` changes and delegation | Classification and migration row |
|---|---|---|---|
| File parser, `parsers.ts:45-65` | `file://` or a plausible Windows/UNC path after the archive subscriber declines | Normalizes a `file://` URL, copies its decoded fragment to `data.fragment`, sets `data.url`, rejects an implausible path with a warning and `handled = true`, otherwise delegates to `openLink` and then handles | **D3 file fallback.** Keep as a fallback subscriber; do not register as a scheme. |
| Archive parser, `parsers.ts:67-80` | `isArchivePath(data.href)` — a `!` archive form | Normalizes a `file://` archive URL, copies its fragment, sets `data.url`, delegates to `openLink`, then handles | **D3 archive fallback.** Keep as a fallback subscriber installed after the file fallback so LIFO keeps archive ahead of file. |
| HTTP parser, `parsers.ts:82-89` | `http://` or `https://` prefix | Sets `data.url = data.href`, delegates to `openLink`, then handles | Scheme entries for `http` and `https` in the registry. The dedicated browser/content decision remains in the resolve hook. |
| Data parser, `parsers.ts:91-98` | `data:` prefix | Sets `data.url = data.href`, delegates to `openLink`, then handles | `data` scheme entry. Its resolve hook must retain both ordinary `DataUrlProvider` opening and the drawing-image interception. |
| Mneme parser, `parsers.ts:100-113` | `mneme://` prefix | Splits a URL fragment, sets the fragment-free `data.url` and `data.fragment`, delegates, then handles | `mneme` scheme entry. |
| Tree-category parser, `parsers.ts:115-123` | `tree-category://` prefix | Sets `data.url`, defaults `data.target` to `category-view`, delegates, then handles | `tree-category` scheme entry. |
| Git-tree parser, `parsers.ts:125-135` | `git-tree://` prefix | Sets `data.url`, defaults `data.target` to `git-tree`, delegates, then handles | `git-tree` scheme entry. |
| Mneme-folder parser, `parsers.ts:137-148` | `mneme-folder://` prefix | Sets `data.url`, defaults `data.target` to `mneme-root`, delegates, then handles | `mneme-folder` scheme entry. |
| Folder-editor parser, `parsers.ts:150-166` | `folder-editor://` prefix | Decodes the payload; invalid input warns and handles. Valid input sets `data.url`, overwrites `data.target` with the encoded editor id, sets `data.folderPath`, delegates, then handles | `folder-editor` scheme entry. |
| Persephone-board parser, `parsers.ts:168-178` | `persephone-board://` prefix | Sets `data.url`, defaults `data.target` to `board-view`, delegates, then handles | `persephone-board` scheme entry. |
| Persephone-toolset parser, `parsers.ts:180-190` | `persephone-toolset://` prefix | Sets `data.url`, defaults `data.target` to `toolset-view`, delegates, then handles | `persephone-toolset` scheme entry. |
| Persephone-guide parser, `parsers.ts:192-212` | `persephone-guide://` prefix | Runs `parseGuideUrl()`. Invalid input warns and handles. Valid input sets canonical fragment-free `data.url`, copies `data.fragment`, defaults `data.target` to `md-view`, delegates, then handles | `persephone-guide` scheme entry. |
| cURL/fetch parser, `parsers.ts:214-231` | Trimmed href starts with `curl ` or `fetch(` and `parseHttpRequest()` succeeds | Preserves caller fields, conditionally adds parsed method/headers/body, sets `data.url` to the parsed HTTP URL, delegates, then handles | **Neither a URI scheme nor either D3 fallback.** Keep as an explicitly named auxiliary parser in `parsers.ts`; do not fake a `curl` scheme or silently leave it in the scheme map. |

The cURL row is important: the requested `registerScheme(scheme, ...)` key cannot match a command
whose raw input begins with `curl ` or `fetch(`. Keeping this one auxiliary parser is the explicit
exception to the scheme inventory, and its delegation still reaches the registered HTTP resolver.

### Verified Layer 2 inventory

There are five current `openLink` subscribers in `registerResolvers()` (not seven):

| Current entry and source | Match | `ILinkData` changes, side effects, and delegation | Classification and migration row |
|---|---|---|---|
| File resolver, `resolvers.ts:111-185` | All non-HTTP `data.url` values; it also catches virtual `://` paths | Browser intent converts local paths with `toFileUrl()`, opens the browser, and handles. A real directory opens an empty page with Explorer and sets `openedPageId`. Otherwise it calls `resolveUrlToPipeDescriptor()`: normal files/archives get a descriptor, `data.pipe`, an editor target, and `openContent`; virtual paths return no descriptor and receive a placeholder `file` descriptor with `target ||= "monaco"`, then delegate to `openContent` | **D3 file fallback plus the current resolve fallback for tree-category, git-tree, mneme-folder, folder-editor, persephone-board, and persephone-toolset.** The fallback remains in `resolvers.ts`; each scheme dispatcher runs first and its scheme hook reproduces the virtual placeholder behavior. |
| Guide resolver, `resolvers.ts:187-232` | `data.url` starts with `persephone-guide://` | Parses and validates the guide again, asynchronously calls `getGuidePage()`, handles invalid/not-found/error cases with an error toast, and for success sets canonical `data.url`, `data.title`, `data.target = "md-view"`, a `guide` descriptor, `data.pipe`, delegates to `openContent`, then handles | Move to the `persephone-guide` resolve hook. It must retain async index work and the fragment set by Layer 1. |
| Mneme resolver, `resolvers.ts:234-249` | `data.url` starts with `mneme://` | Derives the provider path, sets `data.target` to the caller target or `editorRegistry.resolveId(path)` or `monaco`, creates a `mneme` descriptor and pipe, delegates to `openContent`, then handles | Move to the `mneme` resolve hook. |
| HTTP resolver, `resolvers.ts:251-370` | `isHttpUrl(data.url)` | Handles `rest-client`, browser mode, browser fallback extensions, header-based target selection, board/editor target resolution, HTTP descriptor creation, pipe creation, and `openContent` delegation. It may handle without a pipe when opening a browser | Move to the `http`/`https` resolve hooks. The normal open context preserves browser routing; source-path mode used by US-1459 must deliberately produce an `HttpProvider` pipe, because today’s rebuild function does so for every HTTP URL. |
| Drawing-image resolver, `resolvers.ts:372-391` | `data.target === "draw-view"` and `data.url` starts with `data:image/` | Asynchronously calls `pagesModel.addDrawPage()`, reports failures with an error toast, and always sets `data.handled = true` without delegating to the file-backed open path | Move into the `data` resolve hook as an explicit first branch. It must remain before generic data/file resolution and must not be left as an unkeyed subscriber. |

### Exact scheme migration map

The following is the one-row-per-scheme migration plan required by Phase A. The destination is
`src/renderer/content/registry.ts`, which will own the scheme map and declaration calls alongside
the existing provider/transformer declarations. Hook bodies must use the hook context and dynamic
imports for app-facing services; the declaration path must not import `app` or execute a hook.

| Scheme | Parse logic moves from | Resolve logic moves from | Destination behavior |
|---|---|---|---|
| `persephone-board` | `parsers.ts:168-178` | `resolvers.ts:111-185` virtual-path branch | Registry parse sets `url` and default `board-view`; resolve creates the current placeholder `file` pipe for the virtual identity and delegates to `openContent`. |
| `persephone-guide` | `parsers.ts:192-212` | `resolvers.ts:187-232` | Registry parse retains canonical URL and fragment extraction; resolve retains async guide lookup, title, `GuideProvider` descriptor, Markdown target, and error handling. |
| `persephone-toolset` | `parsers.ts:180-190` | `resolvers.ts:111-185` virtual-path branch | Registry parse sets default `toolset-view`; resolve retains the placeholder `file` pipe and normal open-content path. |
| `mneme` | `parsers.ts:100-113` | `resolvers.ts:234-249` | Registry parse retains URL-fragment splitting; resolve retains `MnemeProvider`, target fallback, descriptor, and open-content delegation. |
| `mneme-folder` | `parsers.ts:137-148` | `resolvers.ts:111-185` virtual-path branch | Registry parse sets default `mneme-root`; resolve retains the placeholder `file` pipe and navigation behavior. |
| `git-tree` | `parsers.ts:125-135` | `resolvers.ts:111-185` virtual-path branch | Registry parse sets default `git-tree`; resolve retains the placeholder `file` pipe and current-page navigation. |
| `tree-category` | `parsers.ts:115-123` | `resolvers.ts:111-185` virtual-path branch | Registry parse sets default `category-view`; resolve retains the placeholder `file` pipe used by `CategoryEditor`. |
| `folder-editor` | `parsers.ts:150-166` | `resolvers.ts:111-185` virtual-path branch | Registry parse retains UTF-8/base64 decode, invalid-link warning, encoded target, and `folderPath`; resolve retains the placeholder `file` pipe. |
| `data` | `parsers.ts:91-98` | `resolvers.ts:111-185` data descriptor path plus `resolvers.ts:372-391` drawing-image branch | Registry parse forwards the raw data URL; resolve first handles `draw-view` image imports, then creates the existing `data` descriptor/pipe for ordinary data content. |

HTTP and HTTPS are also registry entries because they are current Layer 1/Layer 2 schemes:
`parsers.ts:82-89` and `resolvers.ts:251-370` move into shared `http`/`https` hooks. `file://` is
deliberately not an entry: it remains in the file fallback under D3. Archive `!` is also not an
entry. The cURL/fetch parser is the explicitly documented auxiliary exception above.

## Implementation Plan

### 1. Add the scheme registry without changing pipe-descriptor behavior

- Extend `src/renderer/content/registry.ts` with a normalized lower-case scheme map and the public
  `registerScheme`, `isSchemeRegistered`, `listRegisteredSchemes`, and source-path lookup helpers.
  Keep all existing provider/transformer factory functions in the same module. At module load,
  register the built-in declarations by name and hook function reference, following the existing
  `registerProvider(...)` / `registerTransformer(...)` calls at `registry.ts:52-73`.
- The declaration path must be side-effect-free: it may import types and pure parsing helpers, but
  it must not import `app`, `ui`, `pagesModel`, or editor services. Those services are loaded by
  `await import(...)` inside hook bodies only. Module evaluation calls `registerScheme(...)`, but
  never calls `parse` or `resolve`; no hook body runs at module load. Verify this separately for
  `http`, `https`, `data`, `folder-editor`, `git-tree`, `mneme`, `mneme-folder`,
  `persephone-board`, `persephone-guide`, `persephone-toolset`, and `tree-category`. This avoids a
  cycle through the existing `resolvers.ts -> registry.ts` import while making the map available
  as soon as `registry.ts` is imported.
- In particular, do not statically import `src/renderer/content/persephone-toolset-link.ts:14`
  into the declaration path: that module imports `app`. Use a local pure decoder/constants helper
  or a dynamic import inside the hook body, and verify the equivalent helper imports for every
  migrated scheme. A declaration is only a name plus hook references; no hook body may run while
  `registry.ts` is evaluating.
- Use this exact hook contract:

  ```ts
  type SchemePhase = "open" | "source-path";

  interface SchemeHookContext {
      readonly phase: SchemePhase;
      readonly delegate: () => Promise<boolean>;
      readonly createPipe: (descriptor: IPipeDescriptor) => IContentPipe;
  }

  type SchemeParseHook =
      (data: ILinkData, context: SchemeHookContext) => void | Promise<void>;
  type SchemeResolveHook =
      (data: ILinkData, context: SchemeHookContext) => void | Promise<void>;

  interface SchemeHooks {
      parse: SchemeParseHook;
      resolve: SchemeResolveHook;
  }

  function registerScheme(scheme: string, hooks: SchemeHooks): void;
  ```

  The hooks mutate the same `ILinkData` object. `delegate()` is `openLink.sendAsync(data)` for a
  parse hook and `openContent.sendAsync(data)` for a resolve hook in `"open"` mode. A hook may
  `await` it, set any of `url`, `fragment`, `pipe`, `pipeDescriptor`, or `target`, set
  `handled = true`, or return without handling. In `"source-path"` mode, `delegate()` advances
  only through the registry's next layer and never opens a page; `createPipe()` lets a hook set
  `data.pipe`, while the lookup also materializes a returned `data.pipeDescriptor` with
  `createPipeFromDescriptor()`.
- This shape expresses every existing subscriber. The current guide resolver's async
  `getGuidePage()` is awaited inside the hook. The drawing-image branch sets `handled` without
  delegating. The HTTP resolver's browser branches handle without a pipe. The file/archive/cURL
  fallbacks remain event subscribers because they are not scheme hooks; cURL is not silently
  represented as a fake scheme.
- For source-path mode, the HTTP hook must bypass browser-vs-content routing and return the same
  `HttpProvider` pipe that the current `rebuild-pipe.ts:23-25` creates. The guide hook may validate
  a canonical guide path and build the `guide` descriptor without opening a page; its normal open
  mode retains the asynchronous page-index existence check and user-facing errors.

Before:

```ts
app.events.openLink.subscribe(async (data) => {
    if (!data.url?.startsWith("mneme://")) return;
    data.pipeDescriptor = /* ... */;
    data.pipe = createPipeFromDescriptor(data.pipeDescriptor);
    await app.events.openContent.sendAsync(data);
    data.handled = true;
});
```

After (planned shape):

```ts
registerScheme("mneme", {
    async parse(data, { delegate }) {
        // set data.url and data.fragment, then await delegate()
    },
    async resolve(data, { delegate }) {
        // set target, pipeDescriptor, pipe, then await delegate()
    },
});
```

The dispatcher, rather than each registration body, performs the scheme match. It calls only the
entry selected from the map, so registration order among schemes is no longer behavior.

### 2. Install fixed dispatchers around the two D3 fallbacks

- Refactor `src/renderer/content/parsers.ts` so `registerRawLinkParsers()` installs the file
  fallback first and archive fallback second, preserving archive-over-file LIFO. Keep the cURL /
  fetch parser as an explicit auxiliary subscriber installed after the registry parse dispatcher,
  so it still runs first for command-shaped input and then reaches the HTTP scheme resolver.
- Refactor `src/renderer/content/resolvers.ts` so the file resolver remains the first-installed
  Layer 2 fallback. Move guide, Mneme, HTTP, and drawing-image bodies into the scheme registrations
  and leave only the fallback implementation plus the dispatcher installation in this file.
- Install one registry dispatcher per layer, after that layer's fallback subscribers. The parse
  dispatcher selects by the scheme in `data.href`; the resolve dispatcher selects by the scheme in
  `data.url`. A registered scheme therefore gets its chance before every fallback regardless of
  the order in which other schemes were registered. A deliberate hook decline leaves
  `data.handled` false and lets the existing fallback continue.
- Preserve these current ordering dependencies explicitly: archive before file; cURL before the
  scheme/file path; guide and Mneme before virtual-file handling; drawing-image before generic data
  handling; and HTTP before the file resolver. No scheme-to-scheme ordering is retained.
- Keep `src/renderer/content/open-handler.ts:15-78` unchanged as the sole Layer 3 subscriber. It
  still receives `data.pipe`, reconstructs `sourceLink.url`, and owns the page-open/navigation
  operation.

### 3. Register all built-ins and make validation derived

- Register `http`, `https`, `data`, `folder-editor`, `git-tree`, `mneme`, `mneme-folder`,
  `persephone-board`, `persephone-guide`, `persephone-toolset`, and `tree-category` through the
  new API. Do not register `file` or archive `!` forms.
- Change `src/renderer/api/pages/open-url-validation.ts:1-11` so its scheme membership is obtained
  from `listRegisteredSchemes()` (or the registry's live `isSchemeRegistered()` query) at validation
  time. Do not keep a second literal set. Preserve the dedicated HTTP and data URL validation
  branches, so current error messages and URL syntax checks remain unchanged.
- Do **not** move bootstrap order. The verified current
  order is `src/renderer.ts:13-18` → `app.initServices()` → `app.initPages()` → `app.initEvents()`;
  `src/renderer/api/app.ts:236-241` remains the place where dispatcher subscribers are installed.
  Module-load declarations solve only registry-read timing: importing `registry.ts` during
  service/editor/rebuild-pipe loading populates the scheme map synchronously before
  `validatePipelineOpenInput()` or the US-1459 source-path lookup asks it. Dispatcher installation
  still happens only after the two D3 fallbacks are subscribed, inside
  `registerRawLinkParsers()` / `registerResolvers()`.
- `PagesPersistenceModel.ts:340-348` remains unchanged by this task. Its cold-start file and URL
  events still occur before pipeline subscribers and are out of scope; the code-reading diagnosis
  and runtime reproduction belong to [US-1463](../US-1463-cold-start-file-open/README.md).

### 4. Report duplicates and preserve D2 exactly

- Make `registerScheme()` detect an existing normalized key. On a duplicate, keep the first hooks,
  do not replace its map entry, do not install a second dispatcher entry, and report through the
  existing renderer toast mechanism: dynamically call `ui.notify(message, "error")` from
  `src/renderer/api/ui.ts:62-64`; the report must name the scheme and state that the first
  registration remains active.
- This toast is deliverable even for a declaration-time duplicate. `ui.ts:15` obtains the global
  `alertsBarModel`; `AlertsBar.ts:35-70` stores the alert in `TGlobalState` immediately and logs
  error alerts to the console; `src/renderer/index.ts:29-31` mounts the view later; and
  `AlertsBar.ts:140-155` plus `VanillaView.ts:293-294` bind and apply the current alert state when
  the view mounts. Use a dynamic import inside the duplicate-report path to avoid importing app/UI
  during registry declaration evaluation, and call it with `void` so module-load registration does
  not await the user's toast dismissal. Later script/board registrations use the same toast path.
- Apply the same first-wins/report behavior to the existing provider and transformer registration
  guards at `src/renderer/content/registry.ts:20-25`; a second factory is ignored after the named
  error report. These duplicate guards and the new scheme map/declarations are the **only** changes
  to `registry.ts`'s registration surface. Do not treat this file as open for provider behavior
  improvements.
- `createProviderFromDescriptor()`, `createTransformerFromDescriptor()`, and
  `createPipeFromDescriptor()` retain their current bodies and throwing behavior at
  `registry.ts:28-48`: unknown provider/transformer types still throw. In particular, do not add a
  provider-missing placeholder or catch an unknown provider here.

### 5. Verify against the actual pipeline walk

Walk the table in [content-pipeline.md](../../architecture/content-pipeline.md) one scheme at a
time, then the archive and plain-file fallbacks. For each, observe the same target editor, page
navigation/new-page behavior, title, fragment behavior, browser routing, and source restore as
before. Include the special cases that the hook inventory calls out: guide not-found, Mneme target
selection, `data:image/*` with `draw-view`, virtual board/toolset/folder targets, cURL/fetch, and
HTTP browser fallback.

## Concerns

All design questions found during investigation are resolved for implementation:

1. **cURL is not a scheme.** It is the only current parser that is neither a URI scheme nor a D3
   fallback. It stays as one named auxiliary parser, and the documents explicitly call out why.
  2. **The declaration path is deliberately side-effect-free.** `registry.ts` owns the scheme map
     and built-in declaration calls, but scheme hooks use the context's delegate/create-pipe seam
     and dynamic imports inside the hook body for page/editor/UI work. No declaration path imports
     `app`, and no hook body runs while the module is evaluating. This keeps the existing
     `resolvers.ts -> registry.ts` dependency one-way.
3. **Source-path resolution is asynchronous.** A registered scheme can perform the guide/index
   work already present in the resolver. `pipeFromSourcePath` in US-1459 must therefore become
   async and its four callers must await it; no caller currently requires a synchronous return.
4. **A source-path lookup never opens a page.** Its `source-path` context delegates only inside the
   registry and returns a pipe/descriptor. This prevents a restored image or board from invoking
   `openContent` as a side effect.
  5. **Startup order is intentionally unchanged.** The current source restores pages and calls
     startup link handlers in `initPages()` before registering pipeline subscribers in `initEvents()`.
     That cold-start loss is not fixed here. The module-load scheme declarations make the map
     available to US-1459's lookup without moving the subscribers; the separate diagnosis and
     reproduction are in US-1463.
  6. **No provider-missing behavior is pulled forward.** An unregistered source path still follows
   US-1459's existing shape guesses, and an unknown descriptor provider still throws as D2 requires.

## Acceptance Criteria

These are observations someone can make while using the app, consistent with EPIC-105 D8:

- Opening each registered scheme from the content-pipeline table produces the same editor target,
  page/new-page or current-page navigation, title, and fragment behavior as the current build.
- Opening a cURL/fetch command, an archive entry, and a plain file still reaches the same HTTP,
  archive, and file paths; an archive is not treated as a plain file.
- Opening a `data:image/*` link with `draw-view` creates the same new untitled drawing, while an
  ordinary data URL still opens as data content.
- A guide link that is invalid or absent from the guide index shows the existing error/warning
  toast; a valid guide opens in Markdown with its title and anchor behavior.
- A `mneme://` document still selects the same editor from its path, and the folder, Git-tree,
  category, board, and toolset links still navigate to their existing targets.
- Cold-start command-line file and URL delivery is excluded from this task; its code-reading
  diagnosis and runtime reproduction are specified separately in US-1463.
- `pages.openUrl` accepts the same HTTP, data, and registered scheme inputs and rejects an
  unregistered scheme with the existing validation error. Its accepted scheme membership is the
  registry's live set, not a second literal list.
- A deliberate duplicate scheme/provider registration produces an error toast naming the duplicate
  and leaves the first registration in use; it does not silently switch the active handler.
- A restored descriptor with an unknown provider type still follows the existing throwing/failure
  path; no provider-missing placeholder appears in this phase.

## Files that need no changes

- `src/renderer/content/open-handler.ts` — Layer 3 remains the existing pipe consumer.
- `src/renderer/content/rebuild-pipe.ts` — handled by dependent US-1459, not this task.
- `doc/architecture/content-pipeline.md` — read as the verification baseline; no architecture-doc
  edit is authorized by this request.
- `doc/active-work.md` and `doc/epics/EPIC-105.md` — explicitly excluded by the user despite the
  normal dashboard/epic-link workflow.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/content/registry.ts` | Scheme map/API and module-load declarations; first-wins duplicate reporting; preserve all descriptor factories | No |
| `src/renderer/content/parsers.ts` | Retain D3 fallbacks/cURL auxiliary parser; remove migrated scheme bodies; install parse dispatcher | No |
| `src/renderer/content/resolvers.ts` | Retain file fallback; remove migrated scheme bodies; install resolve dispatcher | No |
| `src/renderer/api/pages/open-url-validation.ts` | Derive accepted scheme membership from the registry | No |
| `src/renderer/api/app.ts` | No change to bootstrap order; dispatcher calls remain in `initEvents()` | No |
| `src/renderer/content/open-handler.ts` | No change; remains Layer 3 | No |
| `src/renderer/content/rebuild-pipe.ts` | No change in US-1458; registry-aware async behavior is US-1459 | No |
| `doc/architecture/content-pipeline.md` | Evidence only; no update is authorized by this task request | No |
| `doc/active-work.md` | Dashboard entry would normally be required, but the user explicitly forbids editing it | No |
| `doc/epics/EPIC-105.md` | Epic link is recorded above; the user explicitly forbids editing it | No |
| `doc/tasks/US-1458-scheme-registry/README.md` | This investigation and implementation plan | Yes |
