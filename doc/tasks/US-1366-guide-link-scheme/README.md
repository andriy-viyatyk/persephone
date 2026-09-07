# US-1366: The `persephone-guide://` scheme, the guide pipe, and renderer guide access

## Status

**Status:** Planned  
**Epic:** [EPIC-093 — About page as guide browser](../../epics/EPIC-093.md)  
**Started:** 2026-09-07

## Goal

Give every guide a stable corpus-relative page identity and carry that identity through the
renderer content pipeline into an ordinary `md-view` page. Guide pages must restore after restart or
an installation-path change, and relative guide links must navigate in place while preserving the
existing `file://` Markdown behavior.

This document is a plan only. No product code or guide prose is changed by US-1366 planning.

## Background

EPIC-092 shipped the Markdown corpus in `assets/guides/`, the source-injected index in
`src/shared/guides/index.ts`, and the main-process `guides` node. EPIC-093 decision 1 fixes the
identity as `persephone-guide://<corpus-path>[#anchor]`, where `<corpus-path>` omits `.md` and is
the same string used by `guides.<path>` and `GuideTreePage.path`.

The existing pipeline is registered during `App.initEvents()` in
`src/renderer/api/app.ts`: the open handler is registered first, then resolvers, then raw-link
parsers. Event-channel subscribers run newest-first. Layer 1 therefore receives `data.href` in
`src/renderer/content/parsers.ts`, sets `data.url`/routing metadata, and forwards to `openLink`;
Layer 2 sets a live pipe plus `data.pipeDescriptor` and forwards to `openContent`; Layer 3 in
`src/renderer/content/open-handler.ts` derives the page source identity, calls
`cleanForStorage()`, and gives the pipe to `PagesLifecycleModel`.

### Findings recorded from the source

- `registerRawLinkParsers()` has the fallback file parser first and the specialized
  `persephone-board://` and `persephone-toolset://` parser blocks near the end. Both specialized
  parsers copy the scheme into `data.url`, set a default target, forward the same `ILinkData`, and
  mark it handled. The guide parser belongs beside those blocks and must run before the file
  fallback.
- `registerResolvers()` has a file resolver registered first (fallback), then `mneme://`, HTTP,
  and drawing special cases. A guide resolver must intercept before the file fallback; otherwise
  the current `resolveUrlToPipeDescriptor()` returns no descriptor for the virtual scheme and the
  file resolver creates its placeholder virtual pipe.
- `registerProvider()` in `src/renderer/content/registry.ts` currently registers `file`, `cache`,
  `http`, `data`, and `mneme`. `createPipeFromDescriptor()` reconstructs a provider from its
  `{ type, config }` descriptor, so a `guide` registration is sufficient for persisted pipe
  reconstruction.
- `src/renderer/api/pages/open-url-validation.ts` has a separate hard-coded `PIPELINE_SCHEMES`
  allow-list used by `validatePipelineOpenInput()`, including `pages.openUrl()`. The new
  `persephone-guide` scheme must be added there as well as to the content pipeline; otherwise the
  agent-facing opener rejects the scheme before Layer 1 with an actionable unsupported-scheme
  error. `PageCollectionWrapper.ts` deliberately remains scheme-agnostic: its `openUrl` member
  summary and `$help` text describe the generic pipeline contract, so duplicating a scheme list
  there is unnecessary.
- `api.getAssetsPath(fileName)` in `src/ipc/renderer/api.ts` is an IPC wrapper. The main handler
  returns `getAssetPath() + "/" + fileName`; `getAssetPath()` resolves to the development
  repository's `assets` directory or packaged `resources/assets`. `electron-builder.yml` ships
  the whole `assets` directory as an `extraResources` entry.
- `app.fs` is the renderer file API. `IFileSystem` exposes `listDirWithTypes()`, `stat()`,
  `read()`, and `readBinary()`. The renderer guide source can therefore enumerate
  `api.getAssetsPath("guides/...")` and read it without adding a second IPC endpoint or direct
  `fs` access. The two consumers deliberately use different paths: `GuideSource.readFile()`
  reads text with `app.fs.read()` for the shared index, while `GuideProvider.readBinary()` reads
  a `Buffer` with `app.fs.readBinary()` so `ContentPipe.readText()` can run the existing
  `decodeBuffer()` encoding path. The provider must not decode text itself; `IProvider` assigns
  text encoding to `EncodingTransformer`/the pipe.
- `src/shared/guides/index.ts` already owns `GuideSource`, front-matter parsing, recursive tree
  construction, page lookup, audience filtering, caching, search, and layout extraction. The
  shared module imports no renderer/main filesystem implementation. The renderer must instantiate
  one index over a renderer `GuideSource`; it must not copy the tree builder or front-matter parser.
- The main-process adapter is `src/main/mcp/ai-vision/guide-source.ts`. It intentionally uses
  main-process `node:fs`/`node:path`, resolves `assets/guides`, and applies a containment check.
  `src/main/mcp/ai-vision/guides.ts` is the only current owner of What's New version-section
  selection: `GuidesNode.readWhatsNew()` calls local `selectReleaseNotes()`, which in turn calls
  local `findReleaseSection()` and `escapeRegExp()`. Those pure functions belong in
  `src/shared/guides/` so the renderer browser and the main node consume one implementation. The
  main node's public `guides.whatsNew` behavior stays the same; its blast radius is the import and
  removal of three private helpers in that file, with no change to `MainAiRoot`, MCP routing, or
  `MainGuideSource`.
- `cleanForStorage()` in `src/shared/link-data.ts` removes pipeline-only fields (`pipe`, `pageId`,
  navigation hints, and browser controls) but preserves `href`, `url`, `target`, and
  `pipeDescriptor`. `open-handler.ts` then overwrites `sourceLink.url` with
  `data.pipe.provider.sourceUrl`. A guide provider must therefore expose
  `persephone-guide://<path>` as `sourceUrl`; its absolute asset path must never become the page
  identity.
- `PagesLifecycleModel.openFile()` passes `filePath` to `newTextFileModel()`, and the host stores
  that value as `IEditorState.filePath`. `TextFileIOModel.restore()` reads through the supplied
  pipe and uses `fpBasename(filePath)` only when the title is still `untitled`; the tab label comes
  from `state.title`, while `PageTabView` uses `state.filePath` for its title/pinned tooltip. The
  plan must set a guide title from guide metadata (without making the install path visible) and
  keep the scheme in `filePath`/tooltip.
- A text editor's persisted descriptor is `HostDescriptor` in `src/shared/persistence.ts`. Its
  `state` contains `filePath`, `title`, and `sourceLink`; its `pipe` is
  `TextFileModel.getDescriptor().pipe`, produced by `IContentPipe.toDescriptor()`. On restore,
  `PagesPersistenceModel.restorePage()` dynamically creates the `md-view` editor,
  `TextHostEditorModel.applyRestoreData()` stores the host descriptor, and
  `TextFileModel.fromDescriptor()` calls `createPipeFromDescriptor(desc.pipe)` before
  `TextFileIOModel.restore()` reads it. A guide round-trip is therefore:
  `provider.type = "guide"`, `provider.config.path = "editors/grid"`, no transformers, and an
  optional encoding; the absolute path is resolved afresh by `GuideProvider` after restart.
- `MarkdownBodyView.onLinkClickCapture()` handles same-document `#anchor` links directly. For a
  local Markdown file it pushes `{ href: current.filePath, title: current.title }` to the page's
  `NavBackStack`, then sends `openRawLink` with `pageId` and `target: "md-view"`. The existing
  `file://` predicate in `markdown-nav.ts` must remain unchanged; a guide predicate/branch is
  additive and pushes the scheme identity so `MarkdownEditor.navigateBack()` reopens the same kind
  of descriptor.
- `rehypeMarkdownOverrides()` calls `resolveRelatedLink()` for both `a.href` and `img.src`.
  `resolveRelatedLink()` preserves absolute URLs and anchors, but all other relative links are
  resolved against the current file path and converted with `url.pathToFileURL()`. With a current
  `persephone-guide://` path, this is not a corpus resolver and produces a `file://` value rather
  than a guide scheme. This is the exact render-time location referenced by the
  `markdown-nav.ts` comment, so guide-to-guide navigation does need the new branch and a
  guide-specific rewrite before the click handler sees the href.
- `MarkdownImageView` in `src/renderer/editors/markdown/MarkdownImage.ts` does not resolve image
  paths. It receives an already-resolved `src` from HAST properties, creates an `<img>`, and uses
  that same `src` for its Open button. Thus any future guide images must be solved in the
  Markdown HAST rewrite/source-URL layer, not in `MarkdownImageView`. The current corpus contains
  prose/code examples of images but no current guide image asset; image URL support remains a
  recorded follow-up boundary for this task.
- `FileProvider` currently uses `require("fs")` directly in
  `src/renderer/content/providers/FileProvider.ts`; that is a pre-existing documented exception
  for the neighbouring provider, not the pattern for `GuideProvider`, which must use renderer
  `app.fs`.
- The guide resolver's fragment-free `data.url` and `GuideProvider.sourceUrl` must be the exact
  same `persephone-guide://<corpus-path>` string. This is a load-bearing identity invariant:
  `cleanForStorage()` uses the provider/source identity for `sourceLink`, while restore uses the
  persisted provider descriptor, and any mismatch would make navigation and restoration disagree
  about the page.

The dashboard entry is already present under EPIC-093 in [`doc/active-work.md`](../../active-work.md);
US-1366 does not add or move it.

## Implementation Plan

### 1. Add one shared guide-link and release-notes layer

- Add `src/shared/guides/guide-links.ts` with the canonical path rules used by both hosts. Define
  `resolveGuideHref(fromGuidePath, href)` as a pure corpus-relative resolver that returns the
  canonical guide URL/path plus an optional fragment, preserves `#anchor`, accepts `./` and `../`,
  strips the required `.md` suffix for page identity, rejects absolute URLs/paths and traversal
  above the corpus, and returns a rejected/undefined result for malformed input. The function
  performs path math only; callers use the existing `GuideIndex.getPage()` membership lookup
  before opening, so a missing page cannot become a blank guide page. This keeps the named
  two-argument resolver usable by the synchronous Markdown HAST pass while letting the async
  pipeline validate existence.
- Add `src/shared/guides/release-notes.ts` with the current-section selector moved verbatim in
  behavior from `src/main/mcp/ai-vision/guides.ts`. Export the pure selector for renderer use;
  keep Electron version retrieval in the host. Update `GuidesNode.readWhatsNew()` to import the
  shared selector and remove its local `selectReleaseNotes`, `findReleaseSection`, and
  `escapeRegExp`. Do not change main tree/index construction or the public `guides.whatsNew`
  result.

Before:

```ts
// src/main/mcp/ai-vision/guides.ts
return selectReleaseNotes(page.content, version);
// selectReleaseNotes/findReleaseSection/escapeRegExp are private here
```

After:

```ts
// src/main/mcp/ai-vision/guides.ts
import { selectReleaseNotes } from "../../../shared/guides/release-notes";
return selectReleaseNotes(page.content, version);
```

### 2. Provide the renderer with the existing guide index

- Add `src/renderer/guides/guide-source.ts` implementing the existing `GuideSource` interface.
  Resolve the root with `api.getAssetsPath("guides")`; use `app.fs.listDirWithTypes()` and
  `app.fs.stat()` to return the exact `GuideSourceEntry` shape and `mtimeMs`, and use
  `app.fs.read()` for file text. `GuideSource.readFile()` therefore returns the string expected by
  the existing shared front-matter/index code; it is separate from the provider's binary read
  path. Build paths only from validated corpus-relative segments with `file-path`; do not import
  `fs` or `path` in renderer code.
- Add `src/renderer/guides/index.ts` as the renderer's single `createGuideIndex(new
  RendererGuideSource())` owner. Export narrow accessors needed by the content resolver and future
  About work, while keeping `src/shared/guides/index.ts` as the only index implementation. The
  content resolver will use this one index to validate the page and obtain its front-matter title;
  it must not create a second renderer index per link.
- Use `errMessage()` for caught `unknown` values and `guard()` where an error is only notified and
  ignored. Keep imports direct and keep any editor-module import dynamic.

### 3. Give guides a read-only, install-independent content provider

- Add `src/renderer/content/providers/GuideProvider.ts` implementing `IProvider`. Its config is
  `{ path: string }` where the value is the canonical corpus-relative path without `.md`.
  `readBinary()` and `stat()` must call `api.getAssetsPath("guides/<path>.md")` at read time and
  then use `app.fs.readBinary()`/`app.fs.stat()`; `readBinary()` reads the application-shipped
  UTF-8 source, strips its front matter with the shared `parseGuideFile()` helper, and returns
  the UTF-8 body bytes for `ContentPipe.readText()`. This decode/re-encode exception is limited
  to guides because they ship with the application and are always UTF-8, unlike user files of
  unknown encoding. The exact provider surface is `type: "guide"`, `displayName`, `sourceUrl`,
  `restorable: true`, `writable: false`,
  `readBinary()`, `stat()`, and required `toDescriptor()`. The descriptor is
  `{ type: "guide", config: { path } }`. Omit `createReadStream`, `writeBinary`, `watch`, and
  `dispose` entirely; do not define throwing stubs (the interface comments make write/watch
  optional and only expose writing when a provider is writable). `sourceUrl` must be
  `persephone-guide://<path>`, exactly the same fragment-free string assigned to resolver
  `data.url`; `displayName` must be the corpus identity, and neither the provider nor its
  descriptor may expose an absolute install path. The neighbouring `FileProvider`'s direct
  `require("fs")` is a pre-existing exception and must not be copied; this provider uses
  renderer `app.fs`.
- Register `registerProvider("guide", ...)` in `src/renderer/content/registry.ts`. The factory
  must validate the config shape/path before constructing the provider. The descriptor must
  round-trip through `createProviderFromDescriptor()` and `ContentPipe.toDescriptor()` without a
  transformer.

Before:

```ts
registerProvider("file", (config) => new FileProvider(config.path as string));
```

After:

```ts
registerProvider("file", (config) => new FileProvider(config.path as string));
registerProvider("guide", (config) => new GuideProvider(config.path as string));
```

### 4. Wire the three pipeline layers

- Modify `src/renderer/api/pages/open-url-validation.ts` to add `"persephone-guide"` to
  `PIPELINE_SCHEMES`, so `pages.openUrl()` reaches the Layer 1 parser instead of rejecting the
  scheme. Do not change `PageCollectionWrapper.ts`: its `openUrl` member summary and `$help` text
  intentionally describe the generic pipeline opener rather than duplicating the allow-list.
  Malformed guide hrefs must still be rejected with the existing actionable validation/parser
  error and must never fall through to a blank page.
- Modify `src/renderer/content/parsers.ts` beside the board/toolset parser blocks. Recognize only
  `persephone-guide://`, split and decode a trailing fragment into `data.fragment`, set
  `data.url` to the fragment-free canonical scheme, default `data.target` to `"md-view"`, and
  forward the same `ILinkData`. Reject empty, unsafe, absolute, backslash-containing, or
  trailing `.md` identities with the existing pipeline error/notification conventions rather than
  allowing the file fallback to see them; ordinary dots inside a corpus segment remain valid.
- Modify `src/renderer/content/resolvers.ts` with a guide resolver registered after the file
  fallback so LIFO gives it priority. Extract the corpus path, call the single renderer guide
  index to confirm `getPage(path)` exists and obtain its front-matter title, set the title without
  replacing a caller-supplied title, create `{ provider: { type: "guide", config: { path } },
  transformers: [] }`, instantiate it with `createPipeFromDescriptor()`, set `target` to `md-view`,
  and forward `openContent`. A missing guide must be an actionable failed open, not a file-path
  fallback or empty Monaco page.
- Keep the existing file resolver, `resolveUrlToPipeDescriptor()` file behavior, and HTTP/Mneme
  behavior unchanged. `src/renderer/content/link-utils.ts` needs no guide fallback branch when
  the dedicated resolver owns the scheme.
- Modify `src/renderer/content/open-handler.ts` only as needed to carry the guide's front-matter
  title into a new page's editor state. Preserve the existing source-link cleanup and make the
  final `sourceLink.url` the provider's scheme identity. If a generic `openFile()` title option is
  needed, keep it additive and pass it only from this guide path; do not expose the asset path.

### 5. Keep page identity and restore stable

- Verify the open path in `src/renderer/api/pages/PagesLifecycleModel.ts` and
  `src/renderer/api/pages/PageNavigator.ts`: explicit `target: "md-view"` selects the Markdown
  content-host editor, the live `GuideProvider` is assigned to the host, and the scheme is stored
  as `filePath`.
- Verify `TextFileModel.getDescriptor()`, `TextFileModel.applyRestoreData()`,
  `TextFileModel.fromDescriptor()`, `TextHostEditorModel.restore()`, and
  `PagesPersistenceModel.restorePage()`. The persisted guide descriptor must be documented and
  observed as:

```json
{
  "filePath": "persephone-guide://editors/grid",
  "sourceLink": {
    "href": "persephone-guide://editors/grid#some-heading",
    "url": "persephone-guide://editors/grid",
    "target": "md-view",
    "pipeDescriptor": {
      "provider": { "type": "guide", "config": { "path": "editors/grid" } },
      "transformers": []
    }
  },
  "pipe": {
    "provider": { "type": "guide", "config": { "path": "editors/grid" } },
    "transformers": []
  }
}
```

  The exact surrounding host/editor fields remain the existing persistence schema. On restore,
  `createPipeFromDescriptor()` constructs `GuideProvider("editors/grid")`, and the provider asks
  the current installation for `assets/guides/editors/grid.md`; no persisted absolute path is
  consulted. Verify once with an install-path change, not just a same-install restart.
- Ensure a tab displays the guide title (front matter) and the tooltip displays only the stable
  scheme/corpus identity, never `C:\...\resources\assets\guides\...`.
- Preserve the existing read-only save behavior. `TextFileActionsModel.ts:12-19` routes Ctrl+S
  (and Ctrl+Shift+S) to `TextFileIOModel.saveFile()`, whose `!pipeWritable` check at
  `TextFileIOModel.ts:86-99` forces
  `api.showSaveFileDialog({ title: "Save File As", ... })`; cancellation returns `false`, while
  choosing a path writes through a new ordinary writable `FileProvider` and updates the page to
  that saved file. A guide pipe therefore never writes into `assets/guides`, and this task does
  not need a new notification or no-op path; verify the dialog and cancellation live.

### 6. Keep guide links in the guide scheme

- Modify `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts` so that when `filePath` is a
  guide identity, anchor links use `resolveGuideHref()` and render as
  `persephone-guide://<path>[#fragment]`. Keep `resolveRelatedLink()` as the implementation for
  ordinary file/Mneme/wiki links; this is an added guide branch, not a change to its `file://`
  behavior.
- Modify `src/renderer/editors/markdown/markdown-nav.ts` with a guide predicate for a resolved
  `persephone-guide://` href. Modify `MarkdownBodyView.ts` to consume that predicate in a new
  branch after the unchanged `#anchor` handling and before/alongside the existing file branch.
  The branch must push the current scheme identity/title to `page.pushNavBack()`, dispatch the
  guide URL with the current `pageId` and `target: "md-view"`, and preserve modifier/non-left-click
  behavior. The existing `isLocalMarkdownHref()` and its file branch must remain behaviorally
  unchanged.
- Validate guide existence in the guide resolver before dispatch completes; both the md-view host
  and the future About host therefore use the same shared `resolveGuideHref()` path math and the
  same renderer `GuideIndex.getPage()` membership rule.
- Do not modify `MarkdownImage.ts`: it only consumes the already-resolved HAST `src`. Record the
  future image requirement separately: a guide image must become an asset-backed URL/file path in
  the HAST rewrite layer, not a `persephone-guide://` document URL.

Before:

```ts
if (!isLocalMarkdownHref(href)) return;
// push current.filePath, then openRawLink(href, { pageId, target: "md-view" })
```

After:

```ts
if (!isLocalMarkdownHref(href) && !isGuideHref(href)) return;
// same push/openRawLink flow; only the accepted URL family is additive
```

### 7. Verify live through the Persephone MCP `call` surface

No unit tests, test harness, or test fixture is to be added; this repository has no unit-test
surface for this pipeline. After implementation, verify the behavior in a running Persephone
instance through the `call` tool:

- call `pages.openUrl("persephone-guide://editors/grid", { editor: "md-view" })`, inspect the new
  page's editor id/content/title, and confirm its page state/source identity contains the scheme,
  not an install path;
- call malformed/unsafe inputs such as `persephone-guide://`,
  `persephone-guide://../outside`, and a missing guide through `pages.openUrl()`; confirm each
  reports an actionable validation/open error and creates no blank or fallback page;
- call `script.execute(...)` with the current page id to send a `createLinkData()` guide-relative
  link through `app.events.openRawLink` using `pageId` and `target: "md-view"`; confirm the same
  page id remains active, the rendered destination changes, and Markdown Back returns to the prior
  guide;
- exercise `#anchor`, `./`, `../`, missing-page, and unsafe/traversal links; confirm missing links
  fail without creating a blank page;
- close/restart the app and inspect the restored page; repeat after moving/reinstalling the app so
  the provider must resolve the new asset root;
- inspect the persisted/open page descriptor through the live page surface and confirm the guide
  provider descriptor is `{ type: "guide", config: { path } }`;
- modify the guide content, press Ctrl+S, confirm the existing Save As dialog opens, then cancel
  and confirm the guide remains open and no file is written under the guide assets directory;
- use `guides.whatsNew` through `call` before and after the shared-helper move to confirm the main
  node's current-version selection is unchanged. Clean up only pages created by the verification.

## Concerns

- **Title source and pipeline timing.** `GuideIndex.getPage()` is asynchronous while the HAST
  renderer is synchronous. The plan deliberately obtains front-matter title/membership in the
  Layer 2 resolver and uses pure path math in `resolveGuideHref()` during HAST rewriting. If the
  existing open-file title path cannot carry the title into a fresh `md-view`, the smallest
  additive fix is a title option on `PagesLifecycleModel.openFile()`; do not use an absolute asset
  path as a title or source identity.
- **Scheme links versus image URLs.** Document links can use the custom identity because the
  content pipeline handles them. `<img src>` cannot use that identity without an asset protocol;
  `MarkdownImageView` does not perform resolution. No current guide requires an image asset, so
  image serving is not silently broadened in US-1366.
- **Guide index ownership.** There must be one renderer `GuideIndex` instance shared by resolver,
  future About contents, and future About rendering. A main-process index remains a separate
  process-local instance; that is not a duplicate implementation or a second corpus.
- **Read-only behavior.** `TextFileActionsModel.ts:12-19` sends Ctrl+S to
  `TextFileIOModel.saveFile()`. Because the guide pipe is not writable, its existing
  `!pipeWritable` branch at `TextFileIOModel.ts:88-99` opens Save As; cancellation is a `false`
  result and choosing a path creates a new writable `FileProvider` for that path. No guide link
  may become writable by
  default or write into `assets/guides`; EPIC-093 decision 2 names the absolute `file` pipe only
  as fallback. US-1366 verifies this existing dialog/cancellation behavior rather than adding a
  silent no-op or a new notification.
- **Guide body encoding exception.** `GuideProvider` decodes only the application-shipped guide
  bytes as UTF-8 so it can reuse `parseGuideFile()` to remove front matter, then re-encodes the
  body as UTF-8 for `ContentPipe`. Guides are always UTF-8; this is not a pattern for providers
  reading user files with unknown encodings.
- **Error hygiene.** New catches handle `unknown` with `errMessage()` or use `guard()` for
  notify-and-continue paths. New renderer path operations use `file-path`; no `require("path")` or
  `require("fs")` is introduced.
- **Epic decision check.** No EPIC-093 decision appears wrong. Decision 2's install-independent
  `guide` provider is necessary once source identity, restore, and tooltips are considered; the
  named absolute `file` provider is correctly retained only as a fallback.

## Acceptance Criteria

- [ ] `persephone-guide://<corpus-path>[#anchor]` is parsed in Layer 1, with fragment metadata,
      `data.url`, and `target: "md-view"` set before Layer 2.
- [ ] `pages.openUrl("persephone-guide://editors/grid", { editor: "md-view" })` is accepted by
      the public pipeline allow-list and opens the guide page; a malformed or unsafe guide href is
      rejected with an actionable error and does not create a blank page.
- [ ] Layer 2 rejects unsafe/missing guide identities, creates a read-only `guide` provider pipe,
      persists its corpus-relative config, and opens Layer 3 as `md-view`.
- [ ] The guide provider implements exactly the required read-only surface (`type`, `displayName`,
      `sourceUrl`, `restorable`, `writable`, `readBinary`, `stat`, `toDescriptor`); optional
      `createReadStream`, `writeBinary`, `watch`, and `dispose` members are omitted, not throwing
      stubs. `GuideProvider` returns front-matter-stripped UTF-8 body bytes via the shared
      `parseGuideFile()` helper, while `GuideSource` reads index text.
- [ ] The page title uses guide metadata/path and the page tooltip/source identity never exposes
      the install directory.
- [ ] Resolver `data.url` and provider `sourceUrl` are the same fragment-free scheme string, so
      `sourceLink` and the restored guide descriptor identify the same page.
- [ ] A renderer `GuideSource` over `app.fs` + `api.getAssetsPath()` feeds the existing shared
      guide index; no second tree builder, front-matter parser, or main-process tree IPC exists.
- [ ] What's New current-section selection is implemented once in `src/shared/guides/` and used by
      both main and renderer consumers; `GuidesNode` behavior is unchanged.
- [ ] `resolveGuideHref()` handles anchors, `./`, `../`, corpus-relative `.md` links, traversal,
      and missing-page rejection through the existing index membership check.
- [ ] Relative links in an md-view guide render and navigate as guide-scheme links. The existing
      `file://` branch keeps its current behavior, and Markdown Back round-trips guide identities.
- [ ] Ctrl+S on a modified guide opens the existing Save As dialog; cancelling leaves the guide
      open and does not write under `assets/guides`.
- [ ] `IEditorState`/`HostDescriptor` persistence contains the `guide` provider config and restores
      after restart and installation-path change by resolving assets at read time.
- [ ] No About page, Menu Bar, F1, facade, guide prose, or guide image asset is changed.
- [ ] No unit test or harness is added; the implemented behavior is verified live through
      Persephone MCP `call` as described above.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/guides/guide-links.ts` | **New.** Shared guide-relative URL/path resolver and scheme/path validation. |
| `src/shared/guides/release-notes.ts` | **New.** Shared What's New current-version section selector. |
| `src/main/mcp/ai-vision/guides.ts` | Use shared release-note selection; remove duplicated private helpers. |
| `src/renderer/guides/guide-source.ts` | **New.** Renderer `GuideSource` over `app.fs` and `api.getAssetsPath()`. |
| `src/renderer/guides/index.ts` | **New.** Single renderer `GuideIndex` owner for content and future About consumers. |
| `src/renderer/content/providers/GuideProvider.ts` | **New.** Read-only, restorable, scheme-identity provider. |
| `src/renderer/api/pages/open-url-validation.ts` | Add `persephone-guide` to the `pages.openUrl()` pipeline scheme allow-list. |
| `src/renderer/content/registry.ts` | Register the `guide` provider factory. |
| `src/renderer/content/parsers.ts` | Register the `persephone-guide://` Layer 1 parser. |
| `src/renderer/content/resolvers.ts` | Resolve guide identities, validate through the renderer index, and build the guide pipe. |
| `src/renderer/content/open-handler.ts` | Preserve guide scheme/source metadata and carry the guide title if required by the open path. |
| `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts` | Rewrite relative document links from guide pages into the guide scheme. |
| `src/renderer/editors/markdown/markdown-nav.ts` | Add the guide URL predicate; leave the existing file predicate unchanged. |
| `src/renderer/editors/markdown/MarkdownBodyView.ts` | Consume the additive guide-navigation branch. |

### Files verified and intentionally not changed

| File/area | Reason |
|---|---|
| `src/shared/guides/index.ts`, `front-matter.ts`, `markdown.ts` | Existing shared index/parser implementation is reused; no duplicate is created. |
| `src/main/mcp/ai-vision/guide-source.ts` | Existing main adapter remains the main-process `GuideSource`; only the node's release-note helper moves. |
| `src/renderer/content/link-utils.ts` and `src/renderer/core/utils/path-utils.ts` | Existing file URL/archive resolution remains unchanged; guide resolution is an additive scheme branch. |
| `src/renderer/editors/markdown/MarkdownImage.ts` | It consumes resolved `src`; guide image URL serving is not part of this task. |
| `src/renderer/api/pages/PagesPersistenceModel.ts`, `src/shared/persistence.ts`, `src/shared/types.ts` | Existing descriptor/restore contracts are sufficient; they are verified, not redesigned. |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Its `openUrl` summary/help intentionally stays generic; the supported-scheme allow-list belongs to `open-url-validation.ts`. |
| `src/renderer/editors/text/TextFileActionsModel.ts`, `src/renderer/editors/text/TextFileIOModel.ts` | Existing Ctrl+S/Save As behavior is verified and reused for the read-only guide pipe. |
| `assets/guides/**` | No guide prose or assets are changed. |
| About, Menu Bar, F1, facade, and guide-browser files | Owned by US-1367 through US-1370; US-1366 supplies only the opening plumbing. |
| `doc/active-work.md` | The US-1366 entry already exists under EPIC-093. |
