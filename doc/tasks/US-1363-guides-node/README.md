# US-1363 — The `guides` node, resource aliases, and the agent-facing pointers

## Goal

Expose the committed `assets/guides/` corpus through a main-process `guides` node, preserve the
twelve published MCP resource identities while repointing their content at the moved corpus, and
make every agent-facing discovery surface lead to the tree first. This task is a document-only
plan; it does not implement the node, resource callbacks, or pointer text.

## Background

EPIC-092 is active and this is task 3, after US-1361 moved the corpus and US-1362 implemented
`src/shared/guides/`. The dashboard entry already exists at
[`doc/active-work.md`](../../active-work.md), and the task remains under EPIC-092 rather than
being completed or moved.

The shared module's exported contract is the implementation boundary:

- `createGuideIndex(source: GuideSource)` receives only relative paths below
  `assets/guides/` and exposes async `getTree`, `getPage`, `search`, and `getLayout` operations.
- `GuideTreeNode` is a folder or page; page keys are slash-separated and omit `.md`.
- `GuidePage.content` has valid front matter removed. `getLayout` returns `undefined` when no
  `## Layout` exists, while an existing empty section returns `""`.
- The index rescans directories, filters to Markdown, performs corpus membership before lookup,
  and keeps the optional `editorId` key absent when it was not present. The JSON fixture at
  `assets/guides/examples/greek-gods.fg.json` is not a guide page.

There are 43 Markdown pages. The four folders currently containing pages are `agents`, `editors`,
`formats`, and `scripting`; `scripting` contains the `api` subfolder. The main process currently
owns the two root nodes `windows` and `main` in `MainAiRoot`, whose descriptor kind is
`"PersephoneMain"`. Its descriptors use module-level `readonly IAiMember[]` object literals,
with dynamic children/indexing for live collections; the new descriptors must follow that style.

`getAssetPath(...paths)` in `src/main/utils.ts:28-35` is variadic and returns
`path.join(resourcesPath, ...paths)`. It has no containment check. The new adapter must therefore
resolve `getAssetPath("guides")` as its root and require every resolved candidate to equal that
root or begin with that root plus the platform separator before reading. The index's fresh
enumerated-corpus check remains the primary gate; the adapter check is defense in depth for
absolute, drive-qualified, and traversal paths.

The path parser in `src/shared/ai-vision/path-parser.ts` accepts identifiers, JSON-string or
integer bracket indexes, and calls. Its exact behavior is:

| Expression | Parser result today |
|---|---|
| `guides.mcp-setup` | Rejected: `mcp` is read as an identifier and the `-` is not a valid identifier character. |
| `guides["mcp-setup"]` | Accepted: member `guides`, then a string index `"mcp-setup"`. |
| `guides.editors.grid` | Accepted: three identifier members. |

Parser acceptance is syntax only; object existence is checked later by the resolver. The node must
advertise bracket paths for root or page segments that contain hyphens (including
`guides["mcp-setup"]`, `guides["tabs-and-navigation"]`, `guides["whats-new"]`,
`guides["agents/ui-editors"]`, `guides["formats/ui-push"]`, and `guides["scripting/api/ui-log"]`).
For identifier-only segments it should expose the convenient dotted form as well. Every advertised
canonical page key must remain reachable through `guides["<folder/page>"]`, which is the universal
form and preserves the slash key emitted by the shared tree.

The returned `guides` tree is an agent-facing projection of the shared tree: keep each node's
canonical `path`, and add a `call` field containing a complete ready-to-copy parser-valid call
path. Pages and folders both carry `call`; for example, a page has
`{ path: "mcp-setup", call: "guides[\"mcp-setup\"]", ... }`, while the `editors` folder has
`{ path: "editors", call: "guides.editors", ... }`. Use dotted syntax when every segment is a
valid identifier (`guides.editors.grid`) and bracket the complete canonical key when a segment has
a hyphen or slash (`guides["agents/ui-editors"]`). `path` remains the canonical corpus key;
`call` answers how the agent reaches it. Appending `.layout` to a page's `call` reaches its
layout member. Improving `PathSyntaxError` itself to suggest bracket syntax for a `-` inside an
identifier is explicitly out of scope; that shared-parser improvement belongs in a separate task.

`validateCallArguments` in `src/shared/ai-vision/argument-validation.ts` reports the received value,
runtime type, reason, and a concrete usage example. It is already used by renderer methods, but
the main process has no current consumer of these helpers; `guides` is the first main-process
consumer and must import the shared helpers directly. Resolver error shaping already preserves
the thrown actionable message through `errMessage`; no main-specific validation error wrapper is
needed.

## Implementation Plan

### 1. Add the main-process source adapter

Add `src/main/mcp/ai-vision/guide-source.ts`, alongside the other main-process AiVision nodes.
This is the correct home because it adapts main-owned packaged/development assets to the
process-neutral `GuideSource` interface and owns the security check; `manifest.ts` should remain
the MCP identity/resource manifest rather than become the guide index implementation.

The adapter will:

1. Set its root to `path.resolve(getAssetPath("guides"))`. `getAssetPath` remains unchanged.
2. Implement `readDirectory(relativeDirectory)` with directory enumeration below that root,
   returning the shared `GuideSourceEntry` shape and `mtimeMs` for files. It must reject or avoid
   unsafe directory components and surface raced/missing filesystem errors rather than turning them
   into an empty directory.
3. Implement `readFile(relativePath)` only after resolving the candidate and checking that the
   resolved path is exactly the guide root or starts with `guideRoot + path.sep`; reject an
   absolute path, drive-qualified path, `..` traversal, or a sibling-prefix path such as
   `guides-other`. The index normally calls this only as `enumeratedKey + ".md"`, but this check
   must remain independent defense in depth.
4. Keep all filesystem and asset-root details in this adapter. `src/shared/guides/` must continue
   to import neither Node filesystem/path APIs nor Electron.

The node may use a small adapter-owned, synchronous name snapshot solely for AiVision live-child
advertising if the current synchronous `children()` contract requires it; it must be derived from
the same guide root on demand, never a page manifest. The actual tree, page loading, search, and
layout operations must go through one `createGuideIndex(new MainGuideSource())` instance.

### 2. Add the `guides` node to `MainAiRoot`

Add the node implementation in `src/main/mcp/ai-vision/guides.ts` and inject one index/source into
`MainAiRoot` from `src/main/mcp/ai-vision/main-root.ts`; `MainAiRoot` constructs the source/index
once for its session, so `src/main/mcp/tools/call-tools.ts` remains unchanged. `MainAiRoot`'s descriptor changes from
exactly two `node: true` members to three, preserving `kind: "PersephoneMain"` and adding the
same `guides` node to its `members` array. Move the current inline array to a module-level
`const MAIN_ROOT_MEMBERS: readonly IAiMember[]` and add the exact three object literals there;
the descriptor returns `MAIN_ROOT_MEMBERS`.

Use module-level `readonly IAiMember[]` constants for the static member declarations, not helper
factories. The node/folder/page descriptors should use live children and/or the descriptor index
hook for corpus-generated pages. Page wrappers are needed so the terminal page result can be the
front-matter-stripped text while the same page object still exposes `.layout`.

The async shared index has to remain fresh. Update the existing AiVision bridge in
`src/shared/ai-vision/types.ts`, `hint.ts`, `help-search.ts`, and `resolver.ts` so descriptor
`children()` and `summarize()` may return either their current synchronous value or a Promise;
the hint builders, help search, and resolver await those values before validating, shaping, or
rendering them. This must be strictly additive: a descriptor returning a plain value behaves
byte-identically, and no existing descriptor is converted to async. Before and after the change,
capture the live `helpSearch("add rows")` hit list and require it to remain identical for the
synchronous object-model nodes. Re-verify live hints, `$help`, and member lists on `pages` (live
children with instances), `boards` (async methods), and `ui` (an `elements` list). If this
additive change cannot be maintained, use a synchronous main-process source plus a node snapshot
as the fallback instead of pushing async behavior through the shared resolver.
The direct `guides` result and folder result must be the awaited plain `GuideTreeNode` data, not a
Promise-shaped object and not a stale empty cache. Keep the tree's folder/page nesting below the
result shaper's existing depth limit; do not flatten it or return `{ kind: "truncated" }` markers
for a normal corpus tree. This small shared resolver adjustment is required by the async
`GuideIndex` contract, not a second guide loader.

The node behavior is:

- `guides` returns the complete `GuideIndex.getTree()` result: every indexed page's canonical
  `path`, parser-valid ready-to-copy `call`, `title`, and `summary`, grouped under folder
  `children` in deterministic order. Every returned folder also carries its canonical `path` and
  parser-valid `call`.
- A folder node returns that folder's `children`, and advertises only paths that actually exist on
  the latest scan.
- A page node's terminal summary is `GuidePage.content`, with valid front matter stripped. Its
  `layout` member awaits `getLayout`; when the result is `undefined`, return the exact clear
  no-schema message `No layout schema is available for this guide yet; layout schemas arrive per
  screen in a later task.` An existing empty `## Layout` section remains an empty string; absence
  is not an error and never becomes `null`.
- Page lookup accepts canonical slash keys through `guides["folder/page"]`. Dotted page members
  are provided for identifier-only segments, including `guides.editors.grid`; hyphenated segments
  are advertised with JSON-string bracket syntax. The tree must make the usable form discoverable,
  not advertise a parser-invalid dotted spelling.
- `guides.search(query, limit = 10)` calls the shared Markdown search over all pages. Its member
  summary and `$help` must say that it is text search over documentation, while `helpSearch` is the
  descriptor-graph search for where a live object-model member lives.
- `guides.whatsNew` returns the selected release-notes body described in step 3 below.

Use `validateCallArguments` and the rule helpers for every method argument. The planned rules are:

- `query`: required `stringRule`; after helper validation, reject a blank/whitespace-only string
  with an actionable error naming the received value and showing `guides.search("grid")`.
- `limit`: optional `numberRule` with minimum `1`, default `10`; after helper validation, require
  a finite integer. Reject `0`, `NaN`, infinity, fractions, negatives, and wrong types with the
  received value and an example such as `guides.search("grid", 10)`. A zero limit is never a
  success-shaped empty search result.
- Property paths (`guides`, folders, pages, `.layout`, and `whatsNew`) take no positional
  arguments. The resolver's property-argument warning remains the standard response. Unknown
  or unsafe indexed page keys must produce an actionable not-found error naming the key and
  pointing to `guides` or `guides["editors/grid"]`, never silently return an empty value.

### 3. Define release selection for `guides.whatsNew`

Read `electronApp.getVersion()` in `src/main/mcp/manifest.ts` (the current package version is
`5.0.0`) and select a level-two heading in `assets/guides/whats-new.md` using this rule:

1. Prefer `## Version ${version} (Upcoming)` when present. This is the active development
   convention: `whats-new.md` currently has `## Version 5.0.0 (Upcoming)`, and
   `doc/standards/release-process.md` says the working branch/package version matches the upcoming
   version.
2. Otherwise select the exact released heading `## Version ${version}`.
3. Return the selected section with its `## Version ...` heading line, followed by the trimmed
   body up to the next `## Version ...` heading or EOF, retaining its `###` subsections and
   entries. Retaining the heading lets an agent identify the exact release and distinguish
   `(Upcoming)` notes from released notes without loading the full history.
4. If neither heading exists, return a clear non-error message such as
   `No release notes are available for Persephone ${version}.` The node must not throw, return an
   empty string, or silently select the newest unrelated version. If both exact and Upcoming
   headings ever exist for the same version, the explicit Upcoming preference is deterministic.

The heading structure verified in the 2,261-line file starts with `# What's New`, then the current
`## Version 5.0.0 (Upcoming)` section and its `### Breaking Changes`, `### For agent integrations`,
and `### Bug Fixes`/`### Improvements` subsections, followed by `## Version 4.0.23` and older
version sections. Do not infer the release from file order alone; match the runtime version.

### 4. Repoint and preserve the twelve focused MCP resources

In `src/main/mcp/manifest.ts`, retain every resource's `name`, `uri`, and `description`
byte-identically. The already-updated `file` values must remain exactly these existing nested
paths, and each must be verified to resolve below `assets/guides/`:

| URI | Name | File served |
|---|---|---|
| `persephone://guides/overview` | `overview-guide` | `guides/agents/index.md` |
| `persephone://guides/ui-push` | `ui-push-guide` | `guides/formats/ui-push.md` |
| `persephone://guides/pages` | `pages-guide` | `guides/agents/pages.md` |
| `persephone://guides/scripting` | `scripting-guide` | `guides/agents/scripting.md` |
| `persephone://guides/graph` | `graph-guide` | `guides/formats/graph.md` |
| `persephone://guides/notebook` | `notebook-guide` | `guides/formats/notebook.md` |
| `persephone://guides/links` | `links-guide` | `guides/formats/links.md` |
| `persephone://guides/boards` | `boards-guide` | `guides/agents/boards.md` |
| `persephone://guides/tools` | `tools-guide` | `guides/agents/tools.md` |
| `persephone://guides/ui` | `ui-guide` | `guides/agents/ui.md` |
| `persephone://guides/ui-editors` | `ui-editors-guide` | `guides/editors/index.md` |
| `persephone://guides/browser` | `browser-guide` | `guides/agents/browser.md` |

Recommend keeping `readGuideFile` as the existing mtime-cached raw-file loader rather than
delegating focused resources through `GuideIndex.getPage`: it preserves the focused resource
payload and cache behavior, while `GuideIndex` deliberately strips front matter for page text and
has a separate recursive directory cache. The resource file list is trusted application data; the
new adapter's containment check protects agent-derived guide paths.

Change only `persephone://guides/full`'s payload selection. It must concatenate the tree's
`audience: agent` and `audience: both` pages, in the filtered tree's deterministic folder-before-
page, canonical-path order, using the shared page content (front matter stripped) and the existing
`\n\n---\n\n` separator. The exact 24-page order is:

1. `agents/boards`, `agents/browser`, `agents/index`, `agents/pages`, `agents/scripting`,
   `agents/tools`, `agents/ui`, `agents/ui-editors`.
2. `editors/browser`, `editors/grid`, `editors/index`, `editors/notebook`.
3. `formats/graph`, `formats/links`, `formats/notebook`, `formats/ui-push`.
4. `scripting/index`.
5. Root pages `agent-tools`, `boards`, `encryption`, `mneme`, `shortcuts`,
   `tabs-and-navigation`, `whats-new`.

The 19 user-only `scripting/api/*`, `getting-started`, `index`, and `mcp-setup` pages are not in
`full`. The URI, registered resource name `full-api-guide`, description, and MIME type remain
unchanged.

### 5. Rewrite the agent-facing instructions and pointers

Replace `SERVER_INSTRUCTIONS` in full with this 12-line text, keeping the session-short shape:

```text
Persephone is a developer notepad with tabbed pages, specialized editors, and JavaScript/TypeScript scripting. GitHub: https://github.com/andriy-viyatyk/persephone
Use Persephone to display rich content to the user: code, diagrams, tables/grids, images, and web pages.
Start with `call` and no path to see the overview; follow its hints and node `$help`.
Use `pages.logView.push(...)` for output, rich results, and questions.
Create pages with `pages.addEditorPage(...)`; assign `pages[i].content` to update text.
Open a web URL with `pages.openUrlInBrowserTab(...)`, then use `pages[i].editor.*`.
Use `window.screen.*` for Persephone's own window and `pages[i].editor.*` for browser or board pages.
Run renderer code with `script.execute(code)`; use `main.script.execute(code)` only when enabled.
For editor choices, start with `guides.editors.index` or `guides.editors.<editor>`; for notebook, links, or graph JSON use `guides.formats.<page>` (the matching resources remain available as an alternative).
For boards, use `boards.*` and `guides.agents.boards`; the `persephone://guides/boards` resource is an alternative.
For Agent Tools, find registered tools with `tools.search()` and run one with `tools.execute(id, args)`.
For Persephone controls, start with `guides.agents.ui`; for browser automation use `guides.agents.browser`. The focused `persephone://guides/*` resources remain available as an alternative.
```

Add this exact line to `ROOT_OVERVIEW` in `src/renderer/scripting/ai-vision/root.ts`, following
the existing lowercase-summary/example convention:

```text
guides - documentation tree and text search for how to do something or where it is; e.g. guides.editors.grid
```

Add this exact `ROOT_MEMBERS` entry; `guides` is already present in `RESERVED_ROOT_NAMES` but is
currently absent from `ROOT_MEMBERS`:

```ts
{ name: "guides", kind: "property", node: true, summary: "Documentation tree and text search for how to do something or where it is; use guides paths before resources." },
```

The main root gets the matching exact member line:

```ts
{ name: "guides", kind: "property", node: true, summary: "Documentation tree, page text, layouts, and text search; served by the main process." },
```

Append one pointer sentence to the existing descriptors, preserving their operational help:

- `src/renderer/scripting/ai-vision/namespaces/ui.ts`, `describeUserInterface().help`:
  `Use \`guides.agents.ui\` for the app's control documentation; use \`ui.elements\` for live selectors and \`ui.highlight\` to point at a named control.`
- `src/renderer/scripting/ai-vision/namespaces/editors.ts`, `describeEditorRegistry().help`:
  `Use \`guides.editors.index\` for the editor catalog and \`guides.editors.<editor>\` for a specific editor's guide.`

The `helpSearch` direction should receive the same one-line distinction as the guides help:
`guides.search` searches documentation text; `helpSearch` searches the live descriptor graph for
object-model paths. Change the existing help-search member/overview wording to these exact lines;
do not duplicate the full guide corpus in help text:

```ts
{ name: "helpSearch", kind: "method", signature: "helpSearch(query: string, limit = 20)", summary: "Search the live descriptor graph for object-model paths; use guides.search for documentation text." },
```

```text
helpSearch - search the live descriptor graph for object-model paths; use guides.search for documentation text; e.g. helpSearch("add rows")
```

### 6. Confirm packaging and verification boundaries

`electron-builder.yml` already has the required one-line behavior and needs no change:

```yaml
extraResources: [{ from: assets, to: assets }]
```

It copies `assets` recursively outside the asar, so `assets/guides/**` is present in packaged
builds. This task adds no tests or test harnesses; US-1364 owns the QA run and live verification.

### Guide path matrix

The tree's page `path` is always the canonical slash key. The bracket form in the second column is
the universal call spelling; the third column is the shorter dotted alias only where every segment
is a parser identifier. Each page path takes no positional arguments, is resolved only after a
fresh Markdown-corpus scan, and returns a page node whose terminal result is front-matter-stripped
text. A missing, filtered, unsafe, absolute, drive-qualified, `.`/`..`, or non-Markdown key must
produce an actionable not-found error rather than an empty result. The same page node's `layout`
member applies the layout rule above.

Declared members take precedence over corpus page lookup. In particular, `search` and `whatsNew`
resolve to the node's declared method/property even if a future page key collides with either name;
the colliding page remains reachable through its canonical bracket/slash form. `$help` is likewise
handled as the resolver's help segment before member or page lookup.

| Tree key | Universal call path | Dotted alias, when parser-valid | Returns / validation |
|---|---|---|---|
| `agents/boards` | `guides["agents/boards"]` | `guides.agents.boards` | Agent Boards page text; fresh indexed `.md` membership, no args. |
| `agents/browser` | `guides["agents/browser"]` | `guides.agents.browser` | Agent browser automation page text; fresh indexed `.md` membership, no args. |
| `agents/index` | `guides["agents/index"]` | `guides.agents.index` | Agent overview page text; fresh indexed `.md` membership, no args. |
| `agents/pages` | `guides["agents/pages"]` | `guides.agents.pages` | Agent pages/windows page text; fresh indexed `.md` membership, no args. |
| `agents/scripting` | `guides["agents/scripting"]` | `guides.agents.scripting` | Agent scripting page text; fresh indexed `.md` membership, no args. |
| `agents/tools` | `guides["agents/tools"]` | `guides.agents.tools` | Agent Tools page text; fresh indexed `.md` membership, no args. |
| `agents/ui` | `guides["agents/ui"]` | `guides.agents.ui` | Agent UI page text; fresh indexed `.md` membership, no args. |
| `agents/ui-editors` | `guides["agents/ui-editors"]` | — | Agent editor-catalog page text; bracket syntax is required for the hyphen, no args. |
| `editors/browser` | `guides["editors/browser"]` | `guides.editors.browser` | Browser editor page text; fresh indexed `.md` membership, no args. |
| `editors/grid` | `guides["editors/grid"]` | `guides.editors.grid` | Grid editor page text; fresh indexed `.md` membership, no args. |
| `editors/index` | `guides["editors/index"]` | `guides.editors.index` | Editor overview page text; fresh indexed `.md` membership, no args. |
| `editors/notebook` | `guides["editors/notebook"]` | `guides.editors.notebook` | Notebook editor page text; fresh indexed `.md` membership, no args. |
| `formats/graph` | `guides["formats/graph"]` | `guides.formats.graph` | Agent graph-format page text; fresh indexed `.md` membership, no args. |
| `formats/links` | `guides["formats/links"]` | `guides.formats.links` | Agent links-format page text; fresh indexed `.md` membership, no args. |
| `formats/notebook` | `guides["formats/notebook"]` | `guides.formats.notebook` | Agent notebook-format page text; fresh indexed `.md` membership, no args. |
| `formats/ui-push` | `guides["formats/ui-push"]` | — | Agent Log View page text; bracket syntax is required for the hyphen, no args. |
| `scripting/index` | `guides["scripting/index"]` | `guides.scripting.index` | Scripting overview page text; fresh indexed `.md` membership, no args. |
| `scripting/api/ai` | `guides["scripting/api/ai"]` | `guides.scripting.api.ai` | `ai` scripting API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/app` | `guides["scripting/api/app"]` | `guides.scripting.api.app` | `app` scripting API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/downloads` | `guides["scripting/api/downloads"]` | `guides.scripting.api.downloads` | `app.downloads` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/editors` | `guides["scripting/api/editors"]` | `guides.scripting.api.editors` | `app.editors` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/events` | `guides["scripting/api/events"]` | `guides.scripting.api.events` | `app.events` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/fs` | `guides["scripting/api/fs"]` | `guides.scripting.api.fs` | `app.fs` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/index` | `guides["scripting/api/index"]` | `guides.scripting.api.index` | Scripting API reference page text; fresh indexed `.md` membership, no args. |
| `scripting/api/io` | `guides["scripting/api/io"]` | `guides.scripting.api.io` | `io` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/page` | `guides["scripting/api/page"]` | `guides.scripting.api.page` | `page` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/pages` | `guides["scripting/api/pages"]` | `guides.scripting.api.pages` | `app.pages` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/recent` | `guides["scripting/api/recent"]` | `guides.scripting.api.recent` | `app.recent` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/settings` | `guides["scripting/api/settings"]` | `guides.scripting.api.settings` | `app.settings` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/shell` | `guides["scripting/api/shell"]` | `guides.scripting.api.shell` | `app.shell` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/ui` | `guides["scripting/api/ui"]` | `guides.scripting.api.ui` | `app.ui` API page text; fresh indexed `.md` membership, no args. |
| `scripting/api/ui-log` | `guides["scripting/api/ui-log"]` | — | Log View scripting API page text; bracket syntax is required for the hyphen, no args. |
| `scripting/api/window` | `guides["scripting/api/window"]` | `guides.scripting.api.window` | `app.window` API page text; fresh indexed `.md` membership, no args. |
| `agent-tools` | `guides["agent-tools"]` | — | Root Agent Tools page text; bracket syntax is required for the hyphen, no args. |
| `boards` | `guides["boards"]` | `guides.boards` | Root Boards page text; fresh indexed `.md` membership, no args. |
| `encryption` | `guides["encryption"]` | `guides.encryption` | Root encryption page text; fresh indexed `.md` membership, no args. |
| `getting-started` | `guides["getting-started"]` | — | Root getting-started page text; bracket syntax is required for the hyphen, no args. |
| `index` | `guides["index"]` | `guides.index` | Root user-guide index text; fresh indexed `.md` membership, no args. |
| `mcp-setup` | `guides["mcp-setup"]` | — | Root MCP setup page text; bracket syntax is required for the hyphen, no args. |
| `mneme` | `guides["mneme"]` | `guides.mneme` | Root Mneme page text; fresh indexed `.md` membership, no args. |
| `shortcuts` | `guides["shortcuts"]` | `guides.shortcuts` | Root keyboard-shortcuts page text; fresh indexed `.md` membership, no args. |
| `tabs-and-navigation` | `guides["tabs-and-navigation"]` | — | Root tabs/navigation page text; bracket syntax is required for the hyphens, no args. |
| `whats-new` | `guides["whats-new"]` | — | Complete What's New page text; bracket syntax is required for the hyphen, no args. |

| Non-page path | Returns / validation |
|---|---|
| `guides` | Full all-audience tree (`GuideTreeNode[]`), fresh scan, no args; nested folders/pages retain depth and omit absent keys. |
| `guides.agents`, `guides.editors`, `guides.formats`, `guides.scripting` | One folder's current children, fresh scan, no args; unknown folders are not advertised. |
| `guides.<page>.layout` / `guides["<path>"].layout` | The trimmed exact `## Layout` body; no args. No current page has one, so absent layout returns the clear later-task message, not `""` or an error. |
| `guides.search(query, limit = 10)` | Ranked Markdown text-search hits, all-token matching, default 10, query non-empty string and limit finite integer at least 1; `0` is rejected with the received value and an example. |
| `guides.whatsNew` | Current `electronApp.getVersion()` release section, including its selected `## Version ...` heading and preferring matching `(Upcoming)`; no args. Missing section returns the clear versioned message, not an error or empty string. |

## Concerns / Open Questions

The choices below resolve the implementation risks before coding begins; none is a user decision
or a reason to block the task.

- **Async index versus synchronous descriptor discovery.** The shared source contract is async,
  while the current AiVision descriptor type renders `children()` and `summarize()` synchronously.
  The implementation must add the strictly additive bridge specified in the plan: plain-value
  descriptors retain byte-identical behavior, existing descriptors are not converted to async,
  and live `helpSearch("add rows")` plus `pages`, `boards`, and `ui` checks remain unchanged. If
  that guard cannot hold, use a synchronous main-process source and node snapshot instead of
  pushing async behavior through the shared resolver. A guide-specific duplicate loader is not
  an acceptable workaround.
- **Page wrapper versus plain text.** A page wrapper is required to make both terminal page text
  and `.layout` addressable. Its awaited summary is only the page body; it must not expose a
  second `content` key or front matter in the agent-facing terminal value. Optional metadata keys
  such as `editorId` are omitted, never represented as `null`.
- **Resource payload versus shared page payload.** Focused resources stay on `readGuideFile` so
  their raw moved-file behavior and mtime cache are preserved. Only `full` switches to the
  audience-filtered tree/page sequence, whose shared page content intentionally strips front
  matter. This is compatible with the published contract because URI, name, description, and
  registration remain unchanged.
- **Hyphenated paths.** `guides.mcp-setup` is not fixable in the parser without changing the
  global grammar. The node and tree/help output must use `guides["mcp-setup"]` (and the analogous
  bracket form for every hyphenated page) and retain dotted aliases only for valid identifiers.
- **Release notes convention.** The runtime version, not the newest heading, controls
  `whatsNew`. The explicit Upcoming-first rule matches the working-branch convention and the
  current `5.0.0` corpus; missing notes are a clear informational result.
- **Packaging and scope.** `electron-builder.yml` already copies `assets` recursively. Do not
  touch the About page, guide browser/link scheme/F1, layout schemas, corpus splitting/merging,
  `docs/` deletion, or the US-1364 QA harness.

## Acceptance Criteria

- [ ] `src/main/mcp/ai-vision/guide-source.ts` injects a `GuideSource` rooted at
      `getAssetPath("guides")`, enumerates only below that root with `mtimeMs`, and applies the
      resolved-prefix containment check before every file read.
- [ ] `MainAiRoot` remains `kind: "PersephoneMain"`, exposes `windows`, `main`, and `guides` as
      its three node members, and answers guide calls in main when the renderer is busy or closed.
- [ ] The shared `createGuideIndex` is the sole tree/page/search/layout data source; the node
      returns all 43 Markdown pages, excludes the JSON fixture, preserves folder grouping/order,
      and does not truncate the normal tree depth.
- [ ] `guides`, all four folder paths, every canonical page key in the path matrix, dotted
      identifier aliases, and universal bracket aliases resolve as documented. Every returned
      folder and page carries canonical `path` plus a parser-valid ready-to-copy `call`; hyphenated
      paths are advertised in bracket form, and `guides.mcp-setup` is not advertised.
- [ ] Page results contain front-matter-stripped text; `.layout` returns the exact section when
      present and the clear later-task message for every current page without a layout schema.
      No absent optional key is returned as `null`.
- [ ] `guides.search` validates every received argument with `validateCallArguments` and the rule
      helpers, rejects blank queries, zero, and non-finite/non-integer limits with received values
      and examples, defaults to 10, and states that it searches documentation text. Its help and
      the `helpSearch` direction distinguish documentation search from descriptor-graph search.
- [ ] The async AiVision extension is strictly additive: existing synchronous descriptor values
      are byte-identical before and after, no existing descriptor becomes async, and the captured
      `helpSearch("add rows")` hits remain identical. Live hints, `$help`, and member lists are
      reverified on `pages`, `boards`, and `ui`; if additive behavior fails, implementation uses
      the documented synchronous-source/node-snapshot fallback.
- [ ] `guides.whatsNew` selects `Version ${electronApp.getVersion()} (Upcoming)` first, then the
      exact released heading, retains the selected `## Version ...` heading, stops at the next
      version heading, and returns a clear versioned message if neither exists; the retained
      heading identifies the release and its Upcoming status without the full history.
- [ ] All twelve focused resources keep their URI, registered `name`, and `description`
      byte-identical and resolve the listed nested file. `persephone://guides/full` serves exactly
      the 24 agent/both pages in the specified tree order and excludes the 19 user-only pages.
- [ ] `SERVER_INSTRUCTIONS` is exactly the proposed 12-line call-first text; the root overview
      and `ROOT_MEMBERS` both contain the exact proposed `guides` lines; UI and editor help each
      contain the exact guide pointer sentence.
- [ ] `electron-builder.yml` remains unchanged and its recursive `extraResources` behavior is
      recorded. No tests, test harnesses, commits, or out-of-scope EPIC-093/094/095 work are added.

## Files Changed

| File | Change |
|---|---|
| `doc/tasks/US-1363-guides-node/README.md` | This implementation plan and verified path/resource contract. |
| `src/main/mcp/ai-vision/guide-source.ts` | **New.** Main-owned root-scoped `GuideSource`, mtime directory entries, file reads, and resolved-prefix containment check. |
| `src/main/mcp/ai-vision/guides.ts` | **New.** Main `guides` node, folder/page wrappers, search/layout/whatsNew methods, static member/help declarations, path aliases, and validation. |
| `src/main/mcp/ai-vision/main-root.ts` | Add the injected `guides` node and third `node: true` root member. |
| `src/main/mcp/tools/call-tools.ts` | **No change.** `MainAiRoot` constructs its source/index; the existing main routing and session root remain intact. |
| `src/main/mcp/manifest.ts` | Replace `SERVER_INSTRUCTIONS`; preserve resource URIs/names/descriptions and the already-correct nested `file` values; keep `readGuideFile` raw and mtime-cached. |
| `src/main/mcp/server-factory.ts` | Keep focused resource callbacks; change `persephone://guides/full` to use the 24-page audience-filtered tree order. |
| `src/renderer/scripting/ai-vision/root.ts` | Add the exact `guides` `ROOT_MEMBERS` entry and overview line; keep its existing reservation. |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Add the exact pointer sentence to the existing UI help. |
| `src/renderer/scripting/ai-vision/namespaces/editors.ts` | Add the exact pointer sentence to the existing editor help. |
| `src/shared/ai-vision/types.ts`, `hint.ts`, `help-search.ts`, `resolver.ts` | Allow descriptor `children()`/`summarize()` results to be awaited for the async guide tree while retaining synchronous return compatibility for every existing descriptor. |
| `src/shared/guides/**` | **No change.** US-1362's exported index API and behavior are the contract consumed here. |
| `src/main/utils.ts` | **No change.** `getAssetPath` has been verified as variadic and intentionally containment-free; the adapter supplies the defense-in-depth check. |
| `assets/guides/**` | **No change.** US-1361's committed corpus, front matter, headings, and fixture are inputs. |
| `electron-builder.yml` | **No change.** `extraResources` already copies `assets` recursively. |
| `doc/active-work.md`, `doc/epics/EPIC-092.md` | **No change.** The dashboard task link and EPIC-092 task row already exist. |
| About/guide-browser/layout/`docs`/QA files | **No change.** Owned by EPIC-093, EPIC-094, EPIC-095, or US-1364. |
