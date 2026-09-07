# US-1370: `about-view` agent facade and the About page `data-name` contract

## Goal

Make `pages[i].editor` useful when `editor.id === "about-view"`: the facade will open a shipped
guide in the About page's right pane, navigate its pane history, report the current pane location,
and expose the About page's named elements through the standard `elements`/`highlight` surface.
The implementation must preserve the one-page identity established by EPIC-093: opening a guide
changes About's existing pane state and does not create an `md-view` tab.

**Epic:** [EPIC-093 — About page as guide browser](../../epics/EPIC-093.md)

**Depends on:** [US-1367 — About page split and the contents view](../US-1367-about-split-contents/README.md)
and [US-1368 — In-pane guide rendering](../US-1368-in-pane-guide-rendering/README.md), both
implemented in the current history.

This is a plan only. No product code, tests, harnesses, dashboard entries, guide prose, or user
documentation are changed by this planning task.

## Background

### The current facade gap and the registration path

`src/renderer/scripting/api-wrapper/PageWrapper.ts` chooses an editor facade by the current
editor id in `FACADE_FOR_EDITOR`. It already imports `MarkdownEditorFacade`, includes it in the
`EditorFacade` union, and maps `"md-view"` to it. There is no `"about-view"` entry, so About falls
through to `GenericEditorFacade` even though `AboutEditor.editorId` is already `"about-view"`.
`AboutEditor` is the real `EditorModel` instance created by
`src/renderer/editors/about/index.ts`, and the page wrapper already passes the page's
`mainEditorInstance` to a facade factory when one exists.

The new facade will follow the verified `MarkdownEditorFacade` shape:

- a plain class implementing `IAiVisible`, with no base class;
- `id` and `name` constructor properties alongside the operation surface;
- a static hand-written member list and a hand-written help string;
- `createElements()` from `src/renderer/scripting/ai-vision/elements.ts` for `elements` and
  `highlight`;
- a page-scoped selector from `pageScopeSelector()` and a
  `beforeHighlight` callback using `activatePageAndWaitForLayout()`.

`src/shared/ai-vision/types.ts` confirms that `IAiElementDeclaration` currently supports only
`name`, `purpose`, and an optional CSS `selector`. It has no `where` property. EPIC-094 owns
spatial `where` phrasing, so this task will not extend that type or add an ad-hoc variant.

### The About runtime state already owns the honest pane model

`src/renderer/editors/about/AboutEditor.ts` now keeps the browser state outside persisted
`AboutEditorState`:

```ts
export type AboutGuideLocation =
    | { kind: "contents" }
    | { kind: "guide"; path: string; fragment?: string };

export class AboutGuideBrowserState {
    currentLocation: AboutGuideLocation;
    canGoBack: boolean;
    openGuide(location: Extract<AboutGuideLocation, { kind: "guide" }>): void;
    back(): void;
}
```

`AboutEditor.guideBrowser` is the singleton runtime owner shared by the view and future facade.
`openGuide()` pushes the current location, and `back()` pops one location without pushing. The
state's `back()` deliberately returns without doing anything when history is empty because the
contents view disables its Back button. That view-level behavior is not sufficient for an
external `call` surface: the facade will check `canGoBack` and throw before invoking it when the
history is empty. That `canGoBack` check is the only layer that turns the state's silent
`if (!previous) return;` into an honest `call` error; it is load-bearing and must not be simplified
away just because the state method itself already exists.

`src/renderer/editors/about/AboutGuideBrowserView.ts` validates its own UI route with the
renderer index but uses `guard()` and returns when a lookup produces no page. The facade must not
reuse that method for an agent call, because that would turn a bad path into a successful-looking
silent no-op. It will validate itself, then call the already-shipped
`AboutEditor.guideBrowser.openGuide()` transition. The view's subscription will render the selected
location through `AboutGuidePageView`.

The filter is material to this decision: `AboutGuideBrowserView.openGuide()` chooses `"user"` or
`"all"` from `guideBrowser.showAgentGuides` and passes that filter to
`getGuideIndex().getPage(path, filter)`. With the default `"user"` filter, an agent-audience page
returns `undefined` even though it exists in the corpus. The facade therefore validates against
`"all"` and, for an explicitly requested agent-only page, turns on the existing Show agent guides
toggle before opening it.

The renderer's single index is `src/renderer/guides/index.ts`, whose `getGuideIndex()` returns the
module-level `GuideIndex`. `GuideIndex.getPage(path, audience)` returns `undefined` for an absent
or filter-excluded page. The identity helpers in `src/shared/guides/guide-links.ts` define
`persephone-guide://<path>#<fragment>`, reject unsafe paths and `.md`, and decode fragments.
`GuidePage` also exposes its audience, allowing the facade to validate all shipped corpus pages
without building another index.

### Resolved input and navigation decisions

`open(path)` accepts all three equivalent forms below; the returned `current` representation keeps
the same one identity and omits an empty or absent fragment:

```ts
await pages[aboutIndex].editor.open("editors/grid");
await pages[aboutIndex].editor.open("editors/grid#filtering");
await pages[aboutIndex].editor.open("persephone-guide://editors/grid#filtering");
```

When `path` names a guide folder rather than a page, `open()` resolves it to that folder's `index`
page when one exists (for example, `open("editors")` opens `editors/index` and `current.path` reports
`"editors/index"`). If the folder exists without an index page, it throws an actionable error naming
the folder and its available pages. A path naming neither a page nor a folder keeps the existing
unknown-guide error. Folder lookup uses the same renderer guide tree and all-audience index as page
lookup; it does not create a second corpus or silently choose a different page.

The implementation will normalize a raw corpus path (including an optional `#fragment`) to the
scheme before calling `parseGuideUrl()`. It will reject non-strings, empty/malformed locations,
absolute or unsafe paths, query strings, and `.md` paths with messages that include the bad value,
the accepted forms, a copy-paste call example, and `guides` as the discovery path for valid guide
identities. It will then call `getGuideIndex().getPage(parsed.path, "all")`. If the direct page is
absent, it will inspect `getTree("all")`: a matching folder with an `<folder>/index` page resolves to
that page, while a matching folder without an index throws an error naming the folder's pages. An
absent page and absent folder remain an actionable unknown-guide error, not a no-op; index/tree lookup
failures are rethrown with `errMessage(error, ...)`.

The all-audience lookup is intentional. An agent explicitly asking for an agent-only guide should
be able to put that guide in front of the user even when the user-facing tree is filtered. If the
page's audience is `agent` and `showAgentGuides` is currently false, `open()` will first set the
existing runtime toggle to true, then push the validated location. This is a user-visible,
documented side effect: the contents tree will now include agent guides, the toggle stays on after
`open()` and remains on after `back()`, and no later facade action silently turns it off. It changes
no persisted setting and does not duplicate the tree or index. User and `both` pages leave the
toggle unchanged.

`open()` will activate the About page by calling `activatePageAndWaitForLayout(this.editor.page.id)`
before the state transition. This is part of the action's meaning: an agent asking for the guide it
is quoting means “show it here,” not merely “change an inactive page's model.” The helper calls
`pagesModel.showPage()` and waits for the retained page slot to have a non-zero layout box. That
wait is required because inactive pages measure `0x0`; it is the same reason the existing facades
use the helper before highlighting page-owned controls. `open()` will never call
`app.events.openRawLink`, `createLinkData()`, or the ordinary guide-tab pipeline.

`back()` will also activate About and wait for its slot before consuming history. If
`canGoBack` is false it will throw an actionable error such as “About guide history is empty; open
a guide before calling `back()`.” It will not reset contents, silently return, or open a tab. The
member summary and `$help` text will state this behavior explicitly. This choice applies the
EPIC-091 standing rule to the classic empty-history trap while leaving the existing disabled UI
button and `AboutGuideBrowserState.back()` behavior unchanged.

`current` will return a fresh, JSON-safe projection of the runtime union:

```ts
// Contents view
{ kind: "contents" }

// Guide view without a fragment
{ kind: "guide", path: "editors/grid" }

// Guide view with a fragment
{ kind: "guide", path: "editors/grid", fragment: "filtering" }
```

There is never a `path: null`, `fragment: null`, or `fragment: ""`; absent keys are omitted with
conditional object spreads. The facade's `summarize()` output will use the same projection rather
than inventing a second shape or truncating the caller's current location.

### Verified About names and the UI addressing contract

The source currently supplies these names through UIKit `name` props. `createPanelElement()`,
`ButtonView`, `CheckboxView`, `TreeView`, and `SplitterView` emit the `data-name` on the same root
as their `data-type`. No About source currently uses a hand-written `data-name` attribute.
`src/renderer/uikit/CLAUDE.md` and `doc/architecture/ui-element-contract.md` therefore make the
following the correct addressing route: pass `name`, never call `setAttribute("data-name", ...)`,
and never use a `data-name` selector for styling.

The facade will catalog every existing About name, including the three structural names omitted
from the earlier task summary (`about-root`, `about-content`, and `about-guide-browser`). The
purpose text below is intentionally written from the visible screen rather than derived from DOM
or CSS:

| Name | Owner/state | Hand-written purpose for `elements` |
|---|---|---|
| `about-root` | About split root | The complete About page containing the card and guide browser. |
| `about-content` | Inner card content | The About card's product, version, runtime, update, and link content. |
| `about-card` | Left pane | The left About pane with Persephone identity, runtime information, update status, and external links. |
| `about-check-updates` | Always-visible card button | Check whether a newer Persephone release is available. |
| `about-github` | Card link | Open the Persephone GitHub repository. |
| `about-report-issue` | Card link | Open the Persephone issue tracker to report a problem. |
| `about-update-download` | New conditional card link | Download the available Persephone update release. |
| `about-update-whats-new` | New conditional card link | Open the in-app What's New guide for the available update. |
| `about-splitter` | Desktop split handle | Resize the left About card pane and the right guide pane. |
| `about-guide-browser` | Right-pane root | The right side of About containing either guide contents or the selected guide page. |
| `about-whats-new` | Contents section | In the contents pane, show the inline What's New release-note summary. |
| `about-whats-new-open` | Contents action | In the contents pane, open the complete What's New guide in the About pane. |
| `about-resources` | Contents section | In the contents pane, show the repository, issues, boards, and MCP resources. |
| `about-resource-repository` | Resource action | In the contents pane, open the Persephone repository resource. |
| `about-resource-issues` | Resource action | In the contents pane, open the Persephone issues resource. |
| `about-resource-boards` | Resource action | In the contents pane, open the in-app Boards catalogue guide. |
| `about-resource-mcp-setup` | Resource action | In the contents pane, open the in-app MCP setup guide. |
| `about-show-agent-guides` | Contents toggle | In the contents pane, include agent-audience guides in the contents tree. |
| `about-guide-tree` | Contents tree | In the contents pane, browse the available guide pages and folders. |
| `about-guide-page` | Guide-state mount | In guide state, host the right-pane view that replaces contents for the selected guide. |
| `about-guide-breadcrumbs` | Guide-state header | In guide state, show the current guide's navigable folder and page trail. |
| `about-guide-back` | Guide-state header button | In guide state, return to the previous About guide location. |
| `about-guide-open-in-tab` | Guide-state header button | In guide state, open the current guide as a normal Markdown tab without changing About's location. |
| `about-guide-body` | Guide-state body host | In guide state, display the rendered Markdown body of the selected guide. |

`about-update-download` and `about-update-whats-new` are the only new names planned here. The
conditional Download and What's New buttons in `AboutView.renderUpdateStatus()` are real controls
an agent can plausibly need but currently have no `name`; they will receive these names through
their existing `ButtonView` props. Every already-shipped name remains unchanged.

The guide-state controls are mounted in the DOM while their parent pane is hidden on the contents
view, so `elements` must report their live visibility honestly: on contents,
`about-guide-page`, `about-guide-breadcrumbs`, `about-guide-back`, `about-guide-open-in-tab`, and
`about-guide-body` remain declared but report `visible: false`; the contents-only tree, toggle,
resource, and What's New controls are likewise mounted under a hidden `contentsHost` while a guide
is showing and report `visible: false`. The stable roots and left-card controls remain visible
subject to the normal responsive layout (the desktop splitter can be hidden at the narrow stacked
breakpoint).

`createElements()` does not invent a pane-state explanation. Its `elements` provider maps each
declaration to `{ name, purpose, selector, visible }`, where `visible` is based on the target's
`offsetParent`; the hand-written purposes above carry the “contents pane” / “guide state” reason
and `$help` will tell the caller that `open(path)` reveals guide-only controls. Its `highlight`
provider passes the page-scoped selector to `ui.highlightElement`. For a selector with no DOM
match, the shared overlay returns exactly `{ found: false, count: 0, selector }` (plus its id); for
these About branches the node is normally still mounted beneath `[hidden]`, so the selector may
match while `visible: false` and the overlay may report `{ found: true, count: 1,
highlighted: 1, selector }` even though no on-screen control is available. The facade will not
rewrite that shared result, navigate the pane, or throw a “not found” error for a known name; the
caller must inspect `elements.visible` before highlighting and call `open(path)` when it needs the
guide state. Unknown names still throw the shared actionable error listing all valid names. This
preserves the helper contract while making the state-dependent route discoverable instead of
pretending hidden controls are visible.

## Implementation Plan

### 1. Add the About facade and register it

- Add `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` as a plain `AboutEditorFacade`
  implementing `IAiVisible`; do not extend `EditorModel` or any other base class.
- Use a type-only import of `AboutEditor` from `src/renderer/editors/about/AboutEditor.ts`.
  The facade must not statically import `AboutView`, `AboutGuideBrowserView`, or
  `AboutGuidePageView`; those editor views remain loaded by the editor registry's literal dynamic
  import. Runtime guide access comes from the already-shipped `getGuideIndex()` and shared
  `guide-links` helpers.
- Add `AboutEditorFacade` to the `EditorFacade` union in
  `src/renderer/scripting/api-wrapper/PageWrapper.ts`, import the facade, and add the exact map
  entry below. The editor id remains `"about-view"` and the registry-provided display name is
  passed through unchanged.

Before:

```ts
type EditorFacade =
    | ... | MarkdownEditorFacade | ... | GenericEditorFacade;

const FACADE_FOR_EDITOR: Record<string, EditorFacadeFactory> = {
    ...,
    "md-view": (editor, id, name) => new MarkdownEditorFacade(editor as MarkdownEditor, id, name),
    ...,
};
```

After:

```ts
type EditorFacade =
    | ... | MarkdownEditorFacade | AboutEditorFacade | ... | GenericEditorFacade;

const FACADE_FOR_EDITOR: Record<string, EditorFacadeFactory> = {
    ...,
    "md-view": (editor, id, name) => new MarkdownEditorFacade(editor as MarkdownEditor, id, name),
    "about-view": (editor, id, name) => new AboutEditorFacade(editor as AboutEditor, id as "about-view", name),
    ...,
};
```

The factory cast is only the existing registry boundary: `PageWrapper` has already resolved the
editor id and `AboutEditorFacade` will perform no unguarded view lookup.

### 2. Implement the call members with EPIC-091 failure behavior

- Define the facade's static `ABOUT_MEMBERS` with standard `id` and `name` properties plus:
  - `open(path: string): Promise<void>` — validates and opens an in-pane guide, activates About,
    accepts raw corpus paths, optional fragments, and canonical guide URLs, and resolves a folder
    path to its index page; an agent-audience
    target also reveals the Show agent guides toggle and leaves it enabled;
  - `back(): Promise<void>` — activates About and pops one pane-history entry, throwing when the
    history is empty;
  - `current` — returns the exact contents/guide union documented above, with absent keys omitted.
- Define the facade's `$help` string as operational guidance, not a repetition of the member
  names. It must include the accepted input forms, the `guides` discovery path, the fact that
  `open()` does not create a tab, the activation/layout behavior, the all-audience/agent-toggle
  behavior and its permanent visible side effect, the fact that `back()` does not turn that toggle
  off, the exact `current` shapes, the empty-history `back()` error, and the fact that `open(path)`
  reveals guide-only elements when the pane is on contents.
- Normalize and validate in a dedicated small function in the facade (or a directly owned helper):
  type-check the argument, add the scheme to raw paths, call `parseGuideUrl()`, and reject every
  invalid form with the bad value plus an accepted example. Do not use `URL` for this identity;
  `guide-links.ts` deliberately parses the scheme as an application identity.
- Validate existence by awaiting `getGuideIndex().getPage(parsed.path, "all")`. If it returns no
  page, inspect `getTree("all")` for a folder at the requested path: if its `<folder>/index` page
  exists, open that page and report its resolved path in `current`; if the folder has no index, throw
  an error naming the folder and its page paths; if neither page nor folder exists, keep the actionable
  unknown-guide error. Every branch points to `guides` and the copy-paste example. If a page or tree
  lookup throws, catch `unknown` and use `errMessage()` before rethrowing an actionable error.
- Require `this.editor.page?.id` for both mutating actions. If there is no page host, throw an
  explicit “About action unavailable” error instead of allowing a model-only silent mutation.
- Await `activatePageAndWaitForLayout(pageId)` before changing the runtime location. Then enable
  `showAgentGuides` only for a validated agent-only page when needed, and call
  `this.editor.guideBrowser.openGuide({ kind: "guide", path, ...(fragment ? { fragment } : {}) })`.
  Do not use `guard()` around these facade failures: `guard()` is for toast-and-continue UI
  handlers and would swallow the error a `call` caller needs.
- In `back()`, check `canGoBack` before activation and throw the documented empty-history error
  when false; otherwise await activation and invoke the state object's `back()` once.
- Keep `current` read-only and side-effect-free. Return a new object, not the mutable state
  reference, and use conditional spreads for `fragment`.
- In `aiVision`, report a stable About kind/summary, combine the hand-written members with the
  `createElements()` members, expose `ABOUT_ELEMENTS` for help search, expose `elements.provide`,
  and use `summarize()` with the same current projection. No result field may use `null` as an
  absence marker or truncate a guide path/fragment.

Before:

```ts
const factory = editor
    ? FACADE_FOR_EDITOR[id]
        ?? (isBoardEditorId(id) ? BOARD_FACADE_FACTORY : undefined)
    : undefined;
return factory ? factory(editor, id, name) : new GenericEditorFacade(id, name);
```

After behavior for `id === "about-view"`:

```ts
pages[i].editor.open("editors/grid");
// changes AboutEditor.guideBrowser and activates the existing About page;
// it never sends an openRawLink event and never creates a page tab.
```

### 3. Build the About `elements`/`highlight` catalog from the real names

- Add the 24 declarations listed in the Background table to `ABOUT_ELEMENTS`, with the exact
  hand-written purposes shown there. Use default `[data-name="..."]` selectors so the shared
  helper owns selector construction and validates declaration uniqueness.
- In `aiVision`, derive the page id from `this.editor.page?.id` and pass
  `{ scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
  beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined }` to
  `createElements(ABOUT_ELEMENTS, ui.highlightElement.bind(ui), options)`.
- Do not add `where`, a spatial type extension, `data-name` CSS selectors, or a second highlight
  implementation. Keep the helper's unknown-name error and result shape. State-only controls are
  represented as declarations with live `visible` values rather than being removed from the list.

Before:

```ts
const elements = createElements(MARKDOWN_ELEMENTS, ui.highlightElement.bind(ui), {
    scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
    beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
});
```

After in the new facade:

```ts
const elements = createElements(ABOUT_ELEMENTS, ui.highlightElement.bind(ui), {
    scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
    beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
});
```

### 4. Complete the typed script API without changing the identity contract

- Add mirrored `IAboutEditor` declarations at
  `src/renderer/api/types/about-editor.d.ts` and `assets/editor-types/about-editor.d.ts`.
  The interface will contain `id: "about-view"`, `name`, the standard `elements` shape,
  `highlight`, `open`, `back`, and the `current` discriminated union with optional `fragment`.
- Update `src/renderer/api/types/page.d.ts` and its mirrored
  `assets/editor-types/page.d.ts` to import `IAboutEditor`, add `"about-view"` to
  `IFacadeEditorId`, and add `IAboutEditor` to `IEditorFacade`. `about-view` is already present in
  `common.d.ts`; do not rename or duplicate that existing editor id.
- Keep the two declaration trees identical. No runtime type changes belong in
  `src/shared/ai-vision/types.ts`; in particular, do not add `where` here.

Before:

```ts
export type IFacadeEditorId =
    | ... | "mneme-config" | "mneme-root";

export type IEditorFacade =
    | ... | IMnemeConfigEditor | IMnemeRootEditor | IGenericEditor;
```

After:

```ts
export type IFacadeEditorId =
    | ... | "mneme-config" | "mneme-root" | "about-view";

export type IEditorFacade =
    | ... | IMnemeConfigEditor | IMnemeRootEditor | IAboutEditor | IGenericEditor;
```

### 5. Finish the missing control names without renaming shipped handles

- Modify `src/renderer/editors/about/AboutView.ts` only for the two conditional update actions:
  pass `name: "about-update-download"` to the Download `ButtonView` and
  `name: "about-update-whats-new"` to the update-status What's New `ButtonView`.
- Verify that the existing names remain exactly as shipped in
  `AboutView.ts`, `AboutGuideBrowserView.ts`, and `AboutGuidePageView.ts`: the About root/card,
  card controls, splitter, browser/contents sections, resources, tree/toggle, guide mount,
  breadcrumbs, Back, Open in tab, and body. Do not rename or hand-write any `data-name`.
- Do not change `AboutEditor.ts`, `AboutGuideBrowserView.ts`, or `AboutGuidePageView.ts` for
  facade behavior; their runtime state, pane routing, dynamic Markdown import, and names are
  already the committed US-1367/US-1368 implementation.
- Do not update `doc/architecture/ui-element-contract.md` with editor internals: that document
  explicitly keeps editor internals out of its exhaustive shell table. The facade's declared
  `ABOUT_ELEMENTS` list is the About-specific agent contract, while the UIKit `name` prop remains
  the source of every `data-name`.

### 6. Verify manually through the `persephone` MCP `call` surface

No unit tests, fixtures, or harnesses are added. The user runs these live checks in a running
Persephone instance through the `persephone` MCP `call` tool:

- Open About with `app.pages.showAboutPage()` (or the existing `pages.showAboutPage()` call path),
  locate the page whose `editor.id` is `"about-view"`, and inspect `$help`, `elements`, and
  `current`. The initial current result must be exactly `{ kind: "contents" }`, with no `path` or
  `fragment` key and no `null` placeholders.
- From another active page, call `pages[about].editor.open("editors/grid")`. Confirm the call
  returns after About is active, `current` is `{ kind: "guide", path: "editors/grid" }`, the
  breadcrumbs/body are on screen, and no new page or tab was added. Repeat with
  `persephone-guide://editors/grid#<real-heading>` and verify the optional `fragment` appears
  only when supplied and the body reveals it.
- Call invalid forms such as `open(123)`, `open("no/such/guide")`, and `open("editors/grid.md")`.
  Confirm each throws rather than returning a successful no-op, identifies the bad input, and
  points to `guides` plus an accepted example. Confirm the current location and history remain
  unchanged after each failure.
- Call `open("editors")` and confirm it opens `editors/index`, with `current.path` reporting
  `"editors/index"`. For a corpus folder without an index, confirm the error says the folder has no
  index and names its available pages; for a path that is neither a page nor folder, confirm the
  actionable unknown-guide error remains.
- Call `back()` from the guide and verify it returns to `{ kind: "contents" }` exactly once. Call
  `back()` again and confirm it throws the documented empty-history error. Open two guides, call
  `back()` once, and verify it consumes exactly one entry without creating a tab or resetting the
  rest of the About browser state.
- Inspect `elements` on contents and guide views. Confirm the complete 24-name list is returned,
  structural/card controls have their expected page-scoped selectors, guide-only names report
  `visible: false` on contents, contents-only names report false on a guide, and
  `about-update-download`/`about-update-whats-new` are always declared but become
  `visible: true` only when the update state mounts those controls.
- Call `highlight("about-guide-body")` while About is on contents and inspect the returned
  `found`/`count` result; it must not silently navigate the pane. Then open a guide and highlight
  the same name, plus `about-guide-back` and `about-guide-open-in-tab`, confirming the page is
  activated and the visible controls are ringed. Call an unknown name and confirm the shared
  valid-name error is actionable.
- Confirm `open()` of an agent-only path enables the existing Show agent guides state and displays
  the requested guide, while a normal user guide leaves that toggle unchanged. Confirm
  `about-guide-open-in-tab` remains the separate action that creates/focuses an ordinary `md-view`
  tab and that facade `open()` itself never does so.
- Inspect the rendered DOM/snapshot to confirm all names arrive via UIKit roots as `data-name`
  values, no hand-written About `data-name` attribute or `data-name` CSS selector was added, and
  no `where` metadata is present. Verify the narrow stacked layout reports the splitter's real
  visibility rather than assuming desktop geometry.

## Concerns

- **Async index lookup and activation ordering:** `open()` must not mutate About history until its
  input and index page are validated. It then waits for page activation/layout before mutating the
  state, so an invalid request cannot change location/history and an inactive page does not render
  the guide into a `0x0` slot. Any caught lookup error uses `errMessage`; no caught value is
  stringified manually.
- **Folder identity resolution:** a requested folder is not itself a guide page. The facade uses the
  existing all-audience tree to detect it, opens `<folder>/index` when present, and reports that page
  path in `current`. A folder without an index throws a folder-specific error listing its pages;
  only a path that is neither a page nor a folder uses the generic unknown-guide error.
- **Audience toggle side effect:** the facade uses the all-audience index only to honor an explicit
  agent request. It enables the existing non-persisted toggle for an agent-only page because the
  committed About route otherwise calls `getPage(..., "user")`, which excludes that real page and
  would make it look unknown. It leaves the toggle on after `open()` and `back()`, and documents
  the visible change in the member summary and `$help`. It does not add a setting or a second tree.
- **Existing UI silent no-op:** `AboutGuideBrowserView.openGuide()` is intentionally a
  toast-and-return UI handler. The facade bypasses that handler after doing its own validation and
  uses the shared runtime state transition directly; otherwise EPIC-091's “reports success and did
  nothing” failure would return.
- **Hidden guide controls:** the guide-page controls remain mounted under a hidden pane when
  contents is active. The catalog includes them, `elements.visible` reports the current layout,
  and `highlight` does not navigate. `$help` must tell callers to open a guide first when they need
  a guide-only control.
- **Page-scoped selector and activation:** `createElements()` scopes selectors under the About
  page's `data-page-id`, while its `beforeHighlight` waits for the retained slot. Reading
  `elements` remains side-effect-free; only `highlight`, `open`, and `back` activate the page.
- **Typed facade union:** forgetting either the runtime `PageWrapper` union/map entry or the two
  mirrored `.d.ts` page unions would leave either `call` discovery or script IntelliSense claiming
  the old generic facade. Both changes are acceptance criteria.
- **EPIC-094 boundary:** `IAiElementDeclaration` has no spatial field today. Adding one here would
  change a shared contract and steal EPIC-094 scope; this task records the limitation and leaves
  `where` for that epic.
- **No test harness:** this task intentionally has no unit-test or harness files. The behavior is
  verified live through `persephone` MCP `call`, as EPIC-093 requires, including the page activation,
  hidden-state, error, and no-new-tab checks above.

## Acceptance Criteria

- [ ] `PageWrapper.FACADE_FOR_EDITOR` registers `"about-view"` to a plain `AboutEditorFacade`
      implementing `IAiVisible`; `pages[i].editor` no longer falls back to `GenericEditorFacade`.
- [ ] The facade exposes `id`, `name`, `open`, `back`, `current`, `elements`, and `highlight`;
      its member summaries and `$help` describe real return shapes and failure behavior.
- [ ] `open()` accepts `editors/grid`, a raw path with `#fragment`, and the equivalent
      `persephone-guide://...#fragment`; it validates against the one renderer `GuideIndex` and
      throws actionable errors for wrong types, malformed locations, unknown paths, and lookup
      failures.
- [ ] `open()` resolves an existing folder path such as `editors` to `editors/index`, reports the
      resolved page path in `current`, throws a folder-specific no-index error naming that folder's
      pages, and retains the actionable unknown-guide error for paths naming neither page nor folder.
- [ ] `open()` activates About, waits for `activatePageAndWaitForLayout()`, updates the existing
  `AboutGuideBrowserState`, and never opens a tab or calls the raw-link pipeline. Agent-only
  requests explicitly enable the existing Show agent guides toggle so the requested page can
  render; the toggle remains on after `back()` and is not silently restored.
- [ ] `back()` activates About, consumes exactly one existing pane-history entry, and throws an
  actionable error when history is empty. Its `canGoBack` precondition is the only guard against
  `AboutGuideBrowserState.back()`'s silent `if (!previous) return;`; it never silently returns,
  resets state, or opens a tab.
- [ ] `current` returns exactly `{ kind: "contents" }` for contents or `{ kind: "guide", path,
      fragment? }` for a guide. Optional `fragment` is omitted when absent; no absent field is
      represented by `null` or an empty string.
- [ ] `ABOUT_ELEMENTS` contains hand-written purposes for every existing About name and the two
      new update-action names: `about-root`, `about-content`, `about-card`,
      `about-check-updates`, `about-github`, `about-report-issue`, `about-update-download`,
      `about-update-whats-new`, `about-splitter`, `about-guide-browser`, `about-whats-new`,
      `about-whats-new-open`, `about-resources`, all four `about-resource-*` names,
      `about-show-agent-guides`, `about-guide-tree`, `about-guide-page`,
      `about-guide-breadcrumbs`, `about-guide-back`, `about-guide-open-in-tab`, and
      `about-guide-body`.
- [ ] `elements` and `highlight` are produced by `createElements()` with the About page scope and
  `activatePageAndWaitForLayout()` hook. Contents/guide-only purposes explain the other pane
  state; `elements.visible` uses the helper's `offsetParent` check, and highlighting preserves
  its exact `{ found: false, count: 0, selector }` no-match result (or the hidden-DOM match result)
  without pane navigation or an unknown-name error.
- [ ] All About `data-name` values arrive through UIKit `name` props; no shipped name is renamed,
      no hand-written `data-name` attribute or `data-name` style selector is introduced, and the
      conditional update Download/What's New controls receive names.
- [ ] No `where` field is added to the element declaration type or facade; EPIC-094 retains that
      scope.
- [ ] `IAboutEditor` is present in both renderer and editor-type declarations, and `about-view` is
      included in both typed facade unions while its existing `EditorView` identity remains intact.
- [ ] No unit tests or harnesses are added. All acceptance behavior is verified live through the
      `persephone` MCP `call` tool, including invalid inputs, empty history, activation from an
      inactive page, pane visibility, highlights, current-shape omission, and no-tab semantics.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` | **New.** Plain `IAiVisible` About facade with validated `open`, history-aware `back`, omission-safe `current`, help/member descriptions, and shared page-scoped elements/highlight. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Add `AboutEditorFacade` to the union and register the `"about-view"` factory. |
| `src/renderer/editors/about/AboutView.ts` | Add `name` props for the two conditional update action buttons: `about-update-download` and `about-update-whats-new`. |
| `src/renderer/api/types/about-editor.d.ts` | **New.** Script-facing `IAboutEditor` and current-location types. |
| `assets/editor-types/about-editor.d.ts` | **New mirrored declaration.** Monaco/editor-type copy of `IAboutEditor`. |
| `src/renderer/api/types/page.d.ts` | Import `IAboutEditor`, make `about-view` an operation facade, and add it to `IEditorFacade`. |
| `assets/editor-types/page.d.ts` | Mirror the renderer page-facade union changes for script IntelliSense. |

### Files verified and intentionally not changed

| File/area | Reason |
|---|---|
| `src/renderer/editors/about/AboutEditor.ts` | Its runtime-only `AboutGuideBrowserState`, location union, history, toggle, and reset contract are already the shared source of truth; persisted `AboutEditorState` must remain unchanged. |
| `src/renderer/editors/about/AboutGuideBrowserView.ts` | It already owns the contents projection, guide mount, filter, subscription, and state-to-view transition; the facade validates before using the state seam and does not duplicate the view route. |
| `src/renderer/editors/about/AboutGuidePageView.ts` | It already renders breadcrumbs, the named guide controls/body, the dynamic Markdown body, in-pane link routing, and separate Open in tab behavior. |
| `src/renderer/guides/index.ts` and `src/shared/guides/index.ts` | The facade consumes the one renderer `GuideIndex`; no duplicate scan, tree, front-matter parser, or main-process request is added. |
| `src/shared/guides/guide-links.ts` | Its canonical scheme/path/fragment parser is reused for facade input normalization. |
| `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` | Read-only precedent for the plain facade, `IAiVisible`, shared `createElements`, member/help style, and page layout hook. |
| `src/renderer/scripting/ai-vision/elements.ts` and `page-elements.ts` | Shared helper and page-scope/layout behavior are reused unchanged; they already have the required error/result contracts. |
| `src/shared/ai-vision/types.ts` | `IAiElementDeclaration` has no `where`; EPIC-094 owns any future spatial extension. |
| `src/renderer/uikit/CLAUDE.md` and `doc/architecture/ui-element-contract.md` | Existing naming/addressing rules are followed; About editor internals are not added to the shell contract table. |
| `src/renderer/api/types/common.d.ts` and `assets/editor-types/common.d.ts` | `"about-view"` already exists in `EditorView`; only the facade union needs updating. |
| `src/renderer/content/` guide provider/open-handler pipeline | Facade `open()` must remain a same-page pane action; only the existing Open in tab UI uses the ordinary guide-tab route. |
| `doc/active-work.md` | The US-1370 entry already exists under EPIC-093; the user explicitly said not to add or change a dashboard entry. |
| `assets/guides/**` | Guide content and corpus identities are not changed. |
| Tests, QA harnesses, and `qa/` | The user and epic require live `persephone` MCP `call` verification instead of new tests or harnesses. |
