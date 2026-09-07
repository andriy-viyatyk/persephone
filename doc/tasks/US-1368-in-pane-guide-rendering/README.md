# US-1368: In-pane guide rendering: breadcrumbs, navigation, back, and Open in tab

## Goal

Render a selected corpus guide inside the existing About right pane, using the one shipped
`MarkdownBodyView` renderer. The pane will provide corpus-title breadcrumbs, guide/anchor navigation,
the runtime history owned by `AboutEditor`, and an *Open in tab* action that uses the stable
`persephone-guide://<path>` identity.

This document is a plan only. No product code, guide prose, tests, or harnesses are changed by
US-1368 planning.

**Epic:** [EPIC-093 — About page as guide browser](../../epics/EPIC-093.md)

**Depends on:** [US-1366 — The `persephone-guide://` scheme, the guide pipe, and renderer guide
access](../US-1366-guide-link-scheme/README.md) and [US-1367 — About page split and the contents
view](../US-1367-about-split-contents/README.md), both implemented in the current history.

## Background

### Existing About seam

US-1367 already supplies the exact host needed here:

- `src/renderer/editors/about/AboutEditor.ts:21-80` defines `AboutGuideLocation` as either
  `contents` or `guide(path, fragment?)`, and `AboutGuideBrowserState` owns the runtime location,
  history, agent-guide toggle, subscription, `openGuide()`, `back()`, and `reset()` behavior.
- `src/renderer/editors/about/AboutEditor.ts:82-100` exposes that state through
  `AboutEditor.guideBrowser`; it remains runtime-only and is not part of `AboutEditorState` or page
  persistence.
- `src/renderer/editors/about/AboutGuideBrowserView.ts:143-163` exposes the current location,
  back state, `back()`, and validated `openGuide()`; `openGuide()` validates the path through the
  shared renderer index before pushing history.
- `src/renderer/editors/about/AboutGuideBrowserView.ts:165-180` creates the named
  `about-guide-page` mount region and switches it against the contents projection.
- `src/renderer/editors/about/AboutView.ts:225-235` mounts `AboutGuideBrowserView` as the flexible
  right pane. US-1368 fills that mount; it does not create another page or editor host.

The pane navigation contract is therefore:

| Action | Location/history result |
|---|---|
| Contents or guide A → guide B | Set the new guide location and push the current location. |
| Guide A → `#anchor` in A | Keep location/history unchanged; send an anchor request to the current body queue. |
| Back | Pop one `AboutGuideLocation` without pushing a new entry. |
| Open in tab | Send a guide-scheme link without `pageId`; leave About’s runtime location unchanged. |

The in-pane path must never call `app.events.openRawLink` with a `pageId`. The pipeline’s page-id
route is intentionally page navigation: `src/renderer/editors/markdown/MarkdownBodyView.ts:195-207`
pushes a page back entry and opens through `openRawLink`, while `src/renderer/api/pages/PageModel.ts:136-151`
stores that history on a real page. About has no such page for the guide body; its `AboutEditor`
history is the honest owner.

### Measured `MarkdownBodyView` dependency surface

The current props type is `model: MarkdownEditor` at
`src/renderer/editors/markdown/MarkdownBodyView.ts:20-23`, but the implementation does not require
the concrete class. The following is the complete model/host/page surface read by the body and its
direct Markdown child.

| Member actually read | Verified use | Honest About-pane supply |
|---|---|---|
| `model.state.get()` and `model.state.subscribe()` — `MarkdownBodyView.ts:158-166`, `236-237`, `334-346`, `388-405`, `429-443`, `486-501` | Reads `compactMode`, search visibility/text, current match, and total matches; subscribes to state projections to update the find bar, minimap, rendered block, and match scrolling. | Real volatile state store with those five fields. It is not persisted and does not represent a page. The pane can keep the existing transient find behavior rather than fabricating editor persistence. |
| `model.host` — `MarkdownBodyView.ts:119`, `195-203`, `229-231`, `242-244`, `348-369` | Reads `host.state.get()` for `content`, `filePath`, and the current `title`; subscribes to the host projection and passes content/path to `MarkdownBlockView`. | Real read-only host object with an `IState`-shaped store containing the index page body, `filePath: persephone-guide://<path>`, and guide title. It is not `TextFileModel` and has no write/pipe/page behavior. |
| `model.typedQueue.subscribe()` — `MarkdownBodyView.ts:384-386` | Receives queued `{ type: "focus" }` and `{ type: "anchor", fragment }` events; `handleQueueEvent` dispatches focus or anchor scrolling at `141-148`. | Real `ComponentQueue<MarkdownQueueEvent, MarkdownQueueRequest>` per pane body. It is required for queued initial fragments and anchor scrolling. A no-op queue would lose the feature. The adapter’s `revealFragment()` also uses the queue’s existing `send()` operation to seed an initial fragment. |
| `model.typedQueue.execute()` and `.pendingRequestCount` — `MarkdownBodyView.ts:218`, `400-403`, `525-528` | Requests the mounted block to scroll to a highlighted match or heading; waits until earlier requests are drained before retrying anchors. | The real queue above, with the existing `MarkdownBlockView` request handler. Read-only content still needs this view-to-block mailbox. |
| `model.typedQueue` passed to `MarkdownBlockView` — `MarkdownBodyView.ts:245-252`; queue registration at `MarkdownBlockView.ts:227-257` | `MarkdownBlockView` registers handlers for `scrollToMatch` and `scrollToAnchor`; `findAnchorTarget()` at `95-110` searches generated IDs and tolerant heading slugs, then `scrollIntoView()` at `252-256` scrolls the target. | Same queue interface; no second anchor implementation. |
| `model.page?.id` and `model.page.pushNavBack()` — `MarkdownBodyView.ts:195-207` | For a local Markdown or guide href, the ordinary page host receives the current path/title and `openRawLink` navigates that page. | `page` is absent. A pane-specific `navigateLink(href)` callback runs before this page branch, validates the guide through `AboutGuideBrowserView.openGuide()`, and uses `AboutGuideBrowserState`; it never supplies a fake page id. |
| `model.page` identity in `pagesModel.onFocus` — `MarkdownBodyView.ts:372-381` | Restores the body scroll position when its real `PageModel` is focused. | The extracted page member is optional. With no page, the body skips this subscription; About location changes own body replacement and do not need global page focus restoration. |
| `model.openSearch()`, `closeSearch()`, `prevMatch()`, `nextMatch()` — `MarkdownBodyView.ts:154-166`, `474-483` | Keyboard and find-bar commands mutate the search projection. | Real transient methods on the pane adapter, matching `MarkdownEditor` behavior. The guide remains read-only because these only change volatile view state. |
| `model.setMatchCount()` — `MarkdownBodyView.ts:210-219` | Receives the rendered highlight count and queues the active-match scroll. | Real transient method on the adapter; it does not write guide content. |
| `model.setContainer()` — `MarkdownBodyView.ts:262`, `301`, `316`, `326` | Stores the scroll container on `MarkdownEditor` for its facade’s `containerInnerHtml`/`viewMounted` accessors (`MarkdownEditor.ts:56-60`, `124-128`). | Optional in the extracted body interface. The About adapter has no facade container contract and does not need a no-op member; `MarkdownEditor` continues to provide it unchanged. |
| `editorConfig.maxEditorHeight` — `MarkdownBodyView.ts:54-64`, `76-93`, `170-174` | Selects embedded layout. Crucially, `onLinkClickCapture()` returns before even the `#anchor` branch when this value is defined. | The pane passes no `maxEditorHeight` (it may set `hideMinimap: true` only). This keeps normal link/anchor capture active. The body host gets `min-height: 0`/flex layout so its own scroll panel, not embedded mode, owns scrolling. |
| `pagesModel.onFocus` — `MarkdownBodyView.ts:1-2`, `372-381` | Global subscription used only for real page scroll restoration. | Retained for ordinary Markdown pages; skipped for the optional About page member. No About page is fabricated. |

The direct child surface is also bounded:

- `MarkdownBlockView` receives only `content`, optional highlight text, compact mode, `filePath`,
  match callback, and `commandQueue` (`MarkdownBlockView.ts:28-44`). It sends `filePath` to
  `rehypeMarkdownOverrides` at `336-355`, where the existing guide branch calls
  `resolveGuideHref()` (`rehypeMarkdownOverrides.ts:71-84`), and it attempts `detectGitRoot()` at
  `291-310`. The guide path is a virtual scheme, so the implementation must skip Git-root lookup
  for `persephone-guide://` rather than treating it as a disk path; this is a child integration
  guard, not a second renderer.
- `CodeBlock.ts:57-74` uses the HAST context to create the existing syntax-highlighted code views;
  its Mermaid toolbar opens a normal page at `233-235`, but it does not read `model`, `host`, or
  `page`. It stays unchanged.
- `MarkdownImage.ts:8-16`, `28-64`, and `72-76` consumes an already resolved `src` and opens it
  through the normal raw-link pipeline; it has no editor-model dependency. It stays unchanged.
- `rehypeHeadingIds.ts:45-76` gives headings stable IDs, and `MarkdownBlockView.ts:95-110` uses
  those IDs or the shared slug function. The body’s queue/retry path is therefore sufficient for a
  pane scroll container; no parallel anchor machinery is allowed.
- `FindBarView` receives callbacks only (`FindBarView.ts:8-16`); `MinimapView` receives the body’s
  scroll element (`MarkdownBodyView.ts:455-463`). Passing `hideMinimap: true` avoids adding an
  unnecessary second scroll affordance in the narrow About pane while retaining the same body.

This evidence supports extraction rather than the epic’s fallback adapter-only approach. The only
type boundary that reaches a child is the queue, and child rendering remains generic; no child
requires `MarkdownEditor` or `PageModel`. The pane will still use a small adapter object, but it
will implement the extracted interface rather than pretend to be either concrete class.

Find-in-guide is intentionally live in the pane, not an omitted feature: `Ctrl+F` and the existing
find bar use the adapter’s real search state and four search methods, while match counts and
next/previous-match scrolling use the existing queue. The guide remains read-only because these
operations change only transient view state. The narrow pane must therefore be checked for a
find-bar layout or overflow defect as part of live verification.

The queue union call sites were measured before choosing the extraction shape. `MarkdownBodyView.ts:17`
imports `MarkdownQueueEvent`, and `MarkdownBlockView.ts:13` imports `MarkdownQueueRequest`; there are
no other imports. `MarkdownEditor.ts:7-13` currently declares both unions and
`src/renderer/editors/markdown/index.ts:207` re-exports `MarkdownQueueEvent`. The plan will move
both unions into `MarkdownBodyModel.ts` and re-export them from `MarkdownEditor.ts`, preserving those
existing importer paths (and the existing index re-export) without needless call-site churn.

### Guide identity, body source, and front matter

US-1366’s renderer index is the source of truth:

- `src/renderer/guides/index.ts:4-9` creates one renderer `GuideIndex`, shared by the resolver and
  About browser.
- `src/shared/guides/index.ts:140-155` calls `parseGuideFile()` and stores `parsed.content` in
  `GuidePage.content`; `src/shared/guides/front-matter.ts:49-52` confirms a valid front-matter
  block is removed from that content.
- `src/renderer/content/providers/GuideProvider.ts:23-29` also strips front matter, but that
  provider belongs to the ordinary `md-view` pipeline. The pane must read
  `getGuideIndex().getPage(path, filter).content`, not read through a `GuideProvider` or a pipe.
  This preserves one index, one audience filter, one title, and one front-matter parser.
- The pane supplies the body adapter’s `filePath` as `guideUrl(path)`, not an absolute asset path.
  `rehypeMarkdownOverrides` therefore keeps relative guide links in the scheme, and the ordinary
  tab path remains identical to US-1366’s `GuideProvider.sourceUrl` at `GuideProvider.ts:15-20`.

### Breadcrumb evidence and folder titles

`GuideTreeFolder` has only `kind`, `path`, `name`, and `children`
(`src/shared/guides/index.ts:38-46`). Its `name` is the raw final folder segment created at
`242-272`; it has no front matter or title field. A folder’s `index.md`, when present, is a page
child, not metadata attached to the folder. The corpus verifies the intended title source:
`assets/guides/editors/index.md:1-4` has title `Editors`, while `assets/guides/editors/grid.md:1-4`
has title `Grid Editor`.

The current corpus check is explicit about the fallback’s coverage: `editors`, `scripting`,
`scripting/api`, and `agents` all have `index.md`; `formats` is a real GuideTreeFolder with no
`index.md`, so its humanized fallback is exercised today. `examples` contains only
`greek-gods.fg.json`, not a Markdown guide, so the GuideIndex does not create an `examples`
GuideTreeFolder and there is no breadcrumb fallback for it.

Breadcrumb construction must therefore query the same index, with the current audience filter:

1. Load the current `GuidePage` for its authoritative final title and body.
2. For each parent prefix, try `<prefix>/index` through `GuideIndex.getPage()`. Use that page’s
   `title` when it exists; for `editors/grid`, this yields `Editors › Grid Editor`.
3. If a folder has no index page, humanize its segment (`formats` → `Formats`, hyphens/underscores
   become spaces) as the explicit fallback. Do not claim that `GuideTreeFolder.name` is a title.
4. If the current page itself is an `index` page, collapse a duplicate folder/index label and show
   the index page’s title once. A root `index` page shows only its page title.

The breadcrumb model must retain the resolved path alongside each label so index-page crumbs can
use the existing About `openGuide()` transition. No second tree or title map is built.

### Link and anchor behavior verified against current code

`MarkdownBodyView.onLinkClickCapture()` currently has three ordered branches
(`MarkdownBodyView.ts:170-208`):

1. It returns immediately for `editorConfig.maxEditorHeight` and for modified/non-left clicks.
2. A raw href beginning with `#` is decoded, prevented, and sent to `scrollToAnchor()`.
3. A resolved local Markdown or `persephone-guide://` href is pushed onto a real page’s
   `NavBackStack` and opened with `pageId`.

The pane needs a fourth host route between the accepted local/guide check and the page branch. An
extracted `navigateLink(href): boolean` callback will be optional: normal `MarkdownEditor` pages
leave it unset and retain current page navigation; the About adapter sets it and returns `true` only
for a guide href it has claimed. The callback will:

- parse/validate guide URLs with `parseGuideUrl()` and use `getGuideIndex().getPage()` through the
  existing `openGuide()` path, so a missing or filter-excluded guide changes neither location nor
  history;
- treat a scheme href whose path is the current guide and whose fragment is present as an
  in-place anchor request on the adapter queue, because the existing rehype guide rewrite turns a
  relative `#heading` into `persephone-guide://current/path#heading`
  (`rehypeMarkdownOverrides.ts:80-83`, `guide-links.ts:65-97`);
- push About history only for a different guide, including a different guide with a fragment; the
  new page view queues its fragment after the body is mounted;
- prevent the browser default and never call `app.events.openRawLink` for a claimed in-pane guide
  link. A false callback result leaves the ordinary page branch/default behavior available for
  non-guide local links, and external links retain existing browser behavior.

### Known extraction consequence: registry body-view variance

`MarkdownBodyView` now consumes the narrower `MarkdownBodyModel`, while the shared
`EditorModule.BodyView` declaration still accepts only a bare `EditorModel`. The resulting
`as unknown as` at `src/renderer/editors/markdown/index.ts` documents a type-system gap rather
than a model mismatch: the sole runtime consumer is
`src/renderer/editors/notebook/note-editor/NoteItemActiveEditorView.ts`, which gets an editor
module, calls that same module's `createEditor()`, and mounts that module's `BodyView` with the
returned editor. For the Markdown module this is always `MarkdownEditor`, which satisfies
`MarkdownBodyModel`; no other repository call site reads `.BodyView`. A generic refactor of
`EditorModule` could express the per-module body model, but is outside US-1368's scope.

Anchor scrolling is honest in the pane because `MarkdownBodyView` creates `scrollPanel` with
`overflowY: "auto"` at `76-93`, passes it to the block, and the block’s existing request handler
calls `target.scrollIntoView()` at `252-256`. The new guide page layout must give the body root and
its host `flex: 1`, `min-height: 0`, and `overflow: hidden`, making that `scrollPanel` the nearest
scrolling body container. The existing ten-frame retry at `516-551` remains the only retry logic.

### Open in tab and dynamic loading

The actual *Open in tab* path is `openRawLink` → the guide parser at
`src/renderer/content/parsers.ts:173-193` → the guide resolver at
`src/renderer/content/resolvers.ts:183-227` → `open-handler.ts:16-30,51-67`. With no `pageId`,
the handler derives `filePath` from `data.pipe.provider.sourceUrl`; `GuideProvider.ts:15-20` makes
that exact value `persephone-guide://<path>`. It then calls `PagesLifecycleModel.openFile()`, whose
`PagesQueryModel.findPageByFilePath()` check at `src/renderer/api/pages/PagesLifecycleModel.ts:368-380`
and `src/renderer/api/pages/PagesQueryModel.ts:22-29` compares that exact scheme string. Therefore
*Open in tab* should send a fragment-free `createLinkData(guideUrl(path), { target: "md-view",
sourceId: "about-guide-open-in-tab" })` with no `pageId`. An already-open guide tab is focused and
its new pipe is disposed; otherwise a normal `md-view` tab is created. The About pane is not reset
to contents; returning to About shows the same runtime guide location and history, consistent with
US-1367’s singleton browser state.

The Markdown editor code must remain lazy. `src/renderer/editors/register-editors.ts:153` already
loads the normal `markdown` module with a literal dynamic import. The About guide page must not
statically import `MarkdownBodyView`; it will use a literal `await import("../markdown/MarkdownBodyView")`
only after a guide is selected and its index page is available. Type-only imports for the extracted
interfaces are permitted. This keeps MarkdownBlock/CodeBlock/MarkdownImage in an editor chunk and
out of the About startup path.

## Implementation Plan

### 1. Extract the measured Markdown body contract without changing normal Markdown behavior

- Add `src/renderer/editors/markdown/MarkdownBodyModel.ts` with the minimal structural types:
  a readable/subscribable body state projection, a readable/subscribable host state, the
  `MarkdownQueueEvent`/`MarkdownQueueRequest` unions, the queue methods actually used by the body
  and block, an optional page containing only `id` and `pushNavBack`, the search/match methods, an
  optional `setContainer`, and an optional `navigateLink(href): boolean` callback.
- Move both existing queue unions into `MarkdownBodyModel.ts`, then re-export them from
  `MarkdownEditor.ts`. This preserves the two current type-import paths in `MarkdownBodyView.ts:17`
  and `MarkdownBlockView.ts:13`, as well as the `MarkdownQueueEvent` package re-export in
  `markdown/index.ts:207`, while giving the extracted contract one owner. `MarkdownEditor` keeps the
  same runtime queue and behavior; its `TOneState`, `TextFileModel`, `IPageHost`, and
  `ComponentQueue` remain valid structural implementations, with no editor state or persistence
  shape changes. The module dependency is one-way: About imports these markdown types type-only;
  markdown never imports About, so the extraction cannot introduce a cycle.
- Change `src/renderer/editors/markdown/MarkdownBodyView.ts:20-23` to accept the new interface,
  use optional `setContainer`, skip the `pagesModel.onFocus` binding when `model.page` is absent,
  and invoke `navigateLink` after the accepted local/guide check and before the real-page branch.
  Preserve the current `#` branch, modifier filtering, local-file branch, and page back behavior
  when the callback is absent.
- Change `src/renderer/editors/markdown/MarkdownBlockView.ts:13`, `43`, `164`, and `227-257` to
  consume the extracted queue interface instead of indexing the concrete `MarkdownEditor` type.
  In `startWikiRootLookup()`, skip `detectGitRoot()` for the guide scheme while retaining it for
  ordinary files and Mneme. This is a fix to already-shipped US-1366 behavior: today a guide
  `md-view` reaches `MarkdownBlockView.startWikiRootLookup()` at `MarkdownBlockView.ts:193,200`
  with `filePath = "persephone-guide://editors/grid"`. `fpDirname()` delegates to Windows
  `path.dirname()`, so the first probe is the nonsense relative path
  `.\\persephone-guide:\\editors\\.git`; `fs.stat()` catches the filesystem miss and returns
  `{ exists: false }` (`src/renderer/api/fs.ts:356-372`), after which `detectGitRoot()` walks
  upward and returns `undefined`. It is harmless in the meantime, but needless probing of a
  virtual identity must stop. Leave parsing, HAST, code blocks, images, heading IDs, and queue
  request behavior unchanged.

Before:

```ts
export interface MarkdownBodyViewProps {
    model: MarkdownEditor;
    editorConfig?: EditorConfig;
}
```

After:

```ts
export interface MarkdownBodyViewProps {
    model: MarkdownBodyModel;
    editorConfig?: EditorConfig;
}
```

Before:

```ts
const page = this.model.page;
const pageId = page?.id;
if (!pageId) return;
// push page history and dispatch openRawLink with pageId
```

After:

```ts
if (href.startsWith("#")) {
    event.preventDefault();
    event.stopPropagation();
    let fragment = href.slice(1);
    try {
        fragment = decodeURIComponent(fragment);
    } catch {
        // Keep the raw fragment when it is not valid URI encoding.
    }
    this.scrollToAnchor(fragment);
    return;
}
if (!isLocalMarkdownHref(href) && !isGuideHref(href)) return;
if (this.model.navigateLink?.(href)) {
    event.preventDefault();
    event.stopPropagation();
    return;
}
// existing page-id push/open branch for accepted ordinary Markdown pages
```

The actual implementation must retain the existing accepted-href guard immediately before this
callback so external links are not diverted. The real `#` branch remains the existing
decode-and-`scrollToAnchor()` branch shown above; the accepted-href guard is deliberately before
`navigateLink` so an external link cannot be claimed by the pane.

### 2. Add the native About guide-page view and its honest adapter

- Add `src/renderer/editors/about/AboutGuidePageView.ts` as a `VanillaView` with no React and no
  page/editor model. It owns a fixed header row, the breadcrumb projection, the Back/Open-in-tab
  controls, async index-page loading, and the body host.
- Give the new pane elements names through primitive `name` props only:

  | Element | Name | Route |
  |---|---|---|
  | Breadcrumb container | `about-guide-breadcrumbs` | `createPanelElement({ name })` |
  | Back button | `about-guide-back` | `ButtonView({ name })` |
  | Open in tab button | `about-guide-open-in-tab` | `ButtonView({ name })` |
  | Markdown body host | `about-guide-body` | `createPanelElement({ name })` |

  The existing `about-guide-page` mount remains the view’s outer seam. Do not call
  `setAttribute("data-name", ...)` and do not use `data-name` as a CSS selector; UIKit’s `name`
  route is authoritative (`doc/architecture/ui-element-contract.md:7-20`,
  `src/renderer/uikit/Panel/panel-style.ts:303-357`, `ButtonView.ts:81-112`).
- Implement the adapter with a transient `TComponentState` for the body projection, a real
  `ComponentQueue`, an immutable guide host state (`content`, `filePath`, `title`), and the existing
  search/match methods. The adapter’s `page` is `undefined`; its `navigateLink` is the only route
  for accepted guide links. It may expose `revealFragment(fragment)` internally by sending the
  existing queue anchor event before or after the body mounts.
- On a location update, load `getGuideIndex().getPage(path, showAgentGuides ? "all" : "user")`.
  Use a generation/liveness guard so a quick guide click, Back, toggle, or dispose cannot let an
  older async result replace the current body. Use `guard()` for notify-and-continue actions and
  `errMessage()` for any catch that also updates view state.
- Render `page.content` from the index into the adapter; set the adapter path to the canonical
  `guideUrl(path)` and title to `page.title`. Do not read the `GuideProvider`, instantiate
  `MarkdownEditor`, instantiate `PageModel`, or parse front matter in the view.
- Use a literal dynamic import for the body after the page is known:

  ```ts
  const [{ MarkdownBodyView }, page] = await Promise.all([
      import("../markdown/MarkdownBodyView"),
      getGuideIndex().getPage(path, filter),
  ]);
  ```

  The implementation must avoid a static value import of `MarkdownBodyView` from any About file.
  Dispose/release the old body before installing the new one, and queue a location fragment after
  the new body/block is mounted so the existing request drain/retry path can reveal it.

### 3. Mount the page view through the US-1367 seam

- Modify `src/renderer/editors/about/AboutGuideBrowserView.ts:116-180` to own one
  `AboutGuidePageView` child in the existing `guidePageMount`, passing the `AboutEditor` browser
  state and guide-open/back actions. Keep contents loading, resource actions, tree filtering, and
  the existing `about-guide-page` name unchanged.
- Route tree/resource/What's New clicks through the same model action already used by
  `openGuide()`. For a body href, add a pane callback that recognizes the scheme URL, resolves the
  page through the same filtered index, and calls `openGuide()` only for a different guide. A
  same-guide fragment calls the body adapter’s queue reveal and does not push history.
- Keep `AboutEditor.ts` unchanged unless the implementation needs a type-only accessor; its
  runtime state and reset contract already satisfy the task and must remain outside persistence.

Before:

```ts
this.guidePageMount = createPanelElement({
    name: "about-guide-page",
    direction: "column",
    flex: true,
    minWidth: 0,
    minHeight: 0,
});
```

After:

```ts
this.guidePage = this.child(new AboutGuidePageView({
    browser: this.model.guideBrowser,
    openGuide: this.openGuide,
}));
this.guidePageMount.append(this.guidePage.root);
this.guidePage.mount();
```

The exact props may differ, but the mount region remains the parent-owned, named native seam and
the page view remains a child disposed by `VanillaView` ownership.

### 4. Make the pane layout guarantee local anchor scrolling

- Modify `src/renderer/editors/about/AboutView.css` and/or the Panel props in
  `AboutGuidePageView.ts` so the page header is fixed, the body host has `flex: 1`, `min-height: 0`,
  and `overflow: hidden`, and `MarkdownBodyView` receives no `maxEditorHeight`.
- Keep all styling in static/co-located CSS or existing Panel tokens. Use no hardcoded colors; the
  existing About border/background variables are the only permitted color sources.
- Do not introduce a second scroll/anchor implementation. Verification must demonstrate that the
  `MarkdownBodyView` `scrollPanel` is the element whose `scrollTop` changes after a heading click.

### 5. Implement breadcrumbs from index titles

- In `AboutGuidePageView`, resolve parent prefixes and current page from the single
  `GuideIndex`. Use `/index` pages for folder labels and `GuideTreeFolder.name` only as a
  humanized fallback when no index page exists.
- Render the labels in corpus order, with `Editors › Grid Editor` as the concrete verified case.
  Keep each crumb’s path so index-page crumbs can call the existing `openGuide()` validation path;
  the current page crumb is a non-navigating label.
- Handle root/index pages without duplicate labels and ensure agent-only folder/page titles are
  excluded under the default `user` filter.

### 6. Implement Back and Open in tab

- Back is a named `ButtonView` whose `onClick` calls `AboutGuideBrowserView.back()` / the
  `AboutGuideBrowserState.back()` action. Disable or hide it when `canGoBack` is false; subscribe
  to the browser state so it reflects the exact stack without adding entries.
- Open in tab uses a named `ButtonView` and sends the canonical fragment-free guide URL through the
  normal raw-link pipeline with `target: "md-view"` and no `pageId`. Wrap a user-action-only failure
  with `guard()`; do not catch and stringify errors manually.
- Leave the About pane on its current guide location. The standard pipeline focuses an existing
  matching guide tab or creates one, as verified by `PagesLifecycleModel.openFile()`; returning to
  About therefore preserves the browser state instead of unexpectedly resetting it.

### 7. Verify live through Persephone MCP `call`

No unit tests, fixtures, or harnesses are added. The implementation is verified manually in a
running Persephone instance through the `persephone` MCP `call` surface, including the user-run
screenshot:

- Open About and click `editors/grid`; verify the contents projection is replaced by the named
  `about-guide-page`, breadcrumbs read `Editors › Grid Editor`, and the body is the existing
  Markdown rendering including headings, code blocks, and links.
- Use `window.screen`/`call` inspection to verify `about-guide-breadcrumbs`, `about-guide-back`,
  `about-guide-open-in-tab`, and `about-guide-body` come from `name` props and no hand-written
  `data-name` exists.
- Click a relative link such as `../scripting/api/page.md`; verify the pane changes guide, the
  prior location is one Back entry, and Back returns exactly once. Click a same-document
  `#heading` link and verify the pane stays on the same guide/history depth and the body scrolls
  to the heading within the right-pane body.
- Press `Ctrl+F` in a long guide; verify the existing find bar renders inside the narrow pane without
  clipping or overflow, typing updates matches, and next/previous-match actions scroll the pane.
- Open a guide with an initial fragment and verify the queued fragment reveals after the body
  mounts. Exercise a missing/filter-excluded relative guide and verify the location/history is
  unchanged and no tab is created.
- Click Open in tab; verify a normal `md-view` tab has the guide title and
  `persephone-guide://<path>` identity, an already-open matching guide is focused rather than
  duplicated, and the About pane remains on its guide when revisited.
- Inspect ordinary Markdown behavior after the extraction: local `file://` links still push the
  real page back stack and navigate there; `maxEditorHeight` bodies retain their current embedded
  behavior; external/modifier/non-left clicks are unchanged.
- Verify the Markdown chunk is loaded only after selecting a guide, not while the About contents
  view starts. Verify the pane does not add a `PageModel`, `MarkdownEditor`, page collection entry,
  pipe descriptor, or duplicate guide index.

## Concerns

- **Interface variance:** `IState<T>` is write-capable, so the extracted contract should expose the
  read/subscribe subset used by the body rather than force the About adapter to implement
  `EditorStateBase`. The queue must remain request-capable; making it a no-op would break anchor
  and match scrolling.
- **Same-page guide fragments:** US-1366’s HAST rewrite turns `#heading` into a canonical guide
  URL with a fragment. The pane callback must compare parsed path to the current location before
  deciding whether to push history; checking only `href.startsWith("#")` is insufficient.
- **Virtual path Git lookup:** `MarkdownBlockView`’s existing wiki-root probe accepts a file path,
  while a guide’s `filePath` is deliberately not a filesystem path. Skipping only that probe for
  the guide scheme preserves the existing link/HAST behavior without weakening ordinary file/wiki
  support.
- **Async races:** Page lookup, dynamic import, and body disposal can complete out of order. A
  generation token and `VanillaView` ownership must guard all async continuations.
- **Audience changes:** A visible agent guide can become unavailable after the toggle changes.
  Use the same `user`/`all` index filter for validation, breadcrumbs, and body content; never leave
  the old page visible after a rejected location.
- **Open-in-tab semantics:** The pipeline intentionally deduplicates exact scheme file paths. The
  action is “open this identity in an ordinary tab,” not “force a duplicate tab”; no custom tab
  registry or page-id route is justified.
- **Renderer scope:** `MarkdownBodyView` and all markdown children remain native `VanillaView`
  classes. No React is introduced outside `editors/draw/**`, and no second Markdown renderer is
  permitted.
- **Completion gate:** This is an epic task, so the implementation should not run `/review`,
  `/document`, or `/userdoc` at this planning stage. The user reviews this plan before any code is
  implemented, as required by the project workflow.

## Acceptance Criteria

- [ ] Clicking a contents/resource/What's New guide renders its body in the existing named
      `about-guide-page` mount region in the About right pane.
- [ ] The body is rendered by `src/renderer/editors/markdown/MarkdownBodyView.ts`; no second
      Markdown renderer, real `MarkdownEditor`, or `PageModel` is created for the pane.
- [ ] `MarkdownBodyView` consumes a narrowed structural interface; `MarkdownEditor` satisfies it
      with unchanged normal-page behavior, and the About adapter supplies only honest volatile
      state, content-host data, queue, and callbacks.
- [ ] The complete measured model/host/page surface remains accounted for: optional page and
      container members are not fabricated, while queue, content, source path, title, state, and
      match/search methods have real pane behavior.
- [ ] The pane passes no `editorConfig.maxEditorHeight`, so its link capture is not disabled by
      embedded mode; its own body scroll panel owns vertical scrolling.
- [ ] Breadcrumbs use current-page and `<folder>/index.md` titles from the shared guide index;
      `editors/grid` displays `Editors › Grid Editor`, and folders without index pages use the
      documented humanized-segment fallback.
- [ ] Guide bodies come from `GuideIndex.getPage(...).content`, which is front-matter-stripped;
      the `GuideProvider`/content pipe is used only for ordinary md-view tabs.
- [ ] Relative guide links resolve through the existing `persephone-guide://` rewrite and route
      through About location/history, with missing or filter-excluded pages leaving state unchanged.
- [ ] Same-document `#anchors` and guide-scheme same-page fragments scroll within the right-pane
      body using the existing queue, heading IDs, and retry machinery without adding history.
- [ ] Back consumes the `AboutEditor` history exactly once per click and never uses a `pageId`.
- [ ] Open in tab sends `persephone-guide://<path>` to the ordinary `md-view` pipeline, dedupes an
      already-open guide through the existing exact-identity path, and leaves About’s location intact.
- [ ] New pane elements are named through `name` props: `about-guide-breadcrumbs`,
      `about-guide-back`, `about-guide-open-in-tab`, and `about-guide-body`; no hand-written
      `data-name` attributes or `data-name` CSS selectors are added.
- [ ] Markdown editor code is loaded through a literal dynamic import only when a guide is opened;
      About contents does not pull the Markdown body chunk into startup.
- [ ] No hardcoded colors, React outside `editors/draw/**`, prohibited direct imports, duplicate
      guide index, page fabrication, unit test, or harness is added.
- [ ] Behavior is verified live through the `persephone` MCP `call` surface, including the
      screenshot requested by the user.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/markdown/MarkdownBodyModel.ts` | **New.** Narrow body state/host/page/queue interfaces and queue request/event types. |
| `src/renderer/editors/markdown/MarkdownEditor.ts` | Reuse/re-export the extracted queue types; concrete editor behavior and persistence remain unchanged. |
| `src/renderer/editors/markdown/MarkdownBodyView.ts` | Accept the narrowed interface, add the optional About link callback, make page/container use honest/optional, and preserve normal page navigation. |
| `src/renderer/editors/markdown/MarkdownBlockView.ts` | Consume the extracted queue type and skip filesystem Git-root lookup for guide identities; renderer behavior otherwise unchanged. |
| `src/renderer/editors/about/AboutGuideBrowserView.ts` | Mount/update the guide-page child and route guide hrefs through About runtime navigation. |
| `src/renderer/editors/about/AboutGuidePageView.ts` | **New.** Native breadcrumbs, Back/Open-in-tab controls, index-backed content loading, pane adapter, and dynamic Markdown body mount. |
| `src/renderer/editors/about/AboutView.css` | Static layout rules needed to keep the guide header fixed and the Markdown body’s own scroll panel authoritative. |

### Files verified and intentionally not changed

| File/area | Reason |
|---|---|
| `src/renderer/editors/about/AboutEditor.ts` | US-1367’s runtime location/history model already supplies the required contract; persisted state must remain unchanged. |
| `src/renderer/editors/about/AboutView.ts` | It already owns the split and mounts the `about-guide-page` seam; no second pane/page host is needed. |
| `src/renderer/guides/index.ts`, `src/renderer/guides/guide-source.ts`, `src/shared/guides/index.ts`, `front-matter.ts`, `guide-links.ts` | The single renderer index, stripped `GuidePage.content`, path resolver, and scheme identity are reused as shipped. |
| `src/renderer/content/providers/GuideProvider.ts`, `registry.ts`, `parsers.ts`, `resolvers.ts`, `open-handler.ts` | These already implement ordinary guide-scheme `md-view` opening and persistence; Open in tab uses that identity. |
| `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts`, `markdown-nav.ts` | Existing guide HAST rewriting and `isGuideHref()` recognition are the input to the pane callback; the page-specific diversion belongs in `MarkdownBodyView`. |
| `src/renderer/editors/markdown/CodeBlock.ts`, `MarkdownImage.ts`, `rehypeHeadingIds.ts` | Their verified model-independent rendering/anchor behavior is reused unchanged. |
| `src/renderer/api/pages/PageModel.ts`, `IPageHost.ts`, `PagesLifecycleModel.ts`, `PageNavigator.ts` | Real page navigation/history and exact guide-tab dedupe remain ordinary md-view behavior; the pane must not instantiate or route through them. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | The About facade is US-1370; this task only supplies named pane elements. |
| `doc/active-work.md` | The EPIC-093 task entry already exists; the user explicitly said not to add a dashboard entry. |
| `assets/guides/**` | No guide prose or assets are changed. |
