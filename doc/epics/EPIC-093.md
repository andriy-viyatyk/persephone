# EPIC-093 — About page as guide browser

**Status:** Active
**Started:** 2026-09-07
**Roadmap:** epic 2 of 4 in the [in-app guides roadmap](../in-app-guides-roadmap.md)
**Builds on:** [EPIC-092](EPIC-092.md) — the guide corpus in `assets/guides/`, front matter,
`src/shared/guides/` (index, tree, lookup, search) and the main-process `guides` node

## Goal

Give the **user** the reader that EPIC-092 gave the agent. The corpus is already in the app and
already reachable by path; today the only way a user reads it is to leave the app for
`github.com/.../assets/guides/`. This epic makes the About page a **guide browser**: the existing
About card on the left, the guide tree and rendered guide pages on the right, reachable from the
Menu Bar, from `F1`, from the update-available flow, and from `call` — and every guide openable as
an ordinary `md-view` page next to the work.

The measure of success is the same shape as EPIC-092's: not that the pane renders, but that a
question a user actually asks ("show me the grid guide", "where is the filter control") **ends on the
About page with the answer on screen**, and that the agent can put it there.

## Why this is not just a view

Three things make it an epic rather than a screen:

1. **A guide has no page identity today.** `guides.editors.grid` is a `call` path, not something the
   app can open. Every entry point in this epic — a menu item, `F1`, a link in a toast, a facade
   call, a relative link inside a guide — needs *one* way to say "open this guide", in two different
   hosts (the About pane and an `md-view` page). That is a content-pipeline scheme, and it is
   US-1366's whole job.
2. **The markdown renderer is not reusable as it stands.** `MarkdownBodyView` requires a
   `MarkdownEditor` model — it reads `model.host.state`, `model.typedQueue` and `model.page`
   (`src/renderer/editors/markdown/MarkdownBodyView.ts:20-52`). The roadmap forbids a second
   renderer, and rightly: two markdown renderers would drift in exactly the details (anchors,
   nav-back, code blocks, local links) the pane depends on. So the coupling has to be narrowed, and
   that is a change to a shipped editor, not new code beside it.
3. **Relative links between guides must work in both hosts.** `markdown-nav.ts` recognises a local
   markdown link only once it is already a `file://` URL. The pane has no file URL, and a guide's
   identity should not be an install path. One resolver, used by both hosts, or the two hosts
   disagree about what `[grid](./grid.md)` means.

## Decisions

Recorded here so the tasks do not re-litigate them. Where a decision has a fallback, the fallback is
named and the task that settles it is named.

### 1. The link scheme is `persephone-guide://<corpus-path>`

Taken, and it matches the two schemes the pipeline already carries —
`src/renderer/content/persephone-board-link.ts` and `persephone-toolset-link.ts`. The path is the
guide's **corpus-relative path without the `.md` extension**, the same string `guides.<path>` and the
guide tree's `path` field already use: `persephone-guide://editors/grid`,
`persephone-guide://whats-new`, `persephone-guide://scripting/api/page`. An `#anchor` may follow.

One string means one identity: the tree entry an agent reads, the `call` path it types, the link a
guide page carries and the URL a page persists are the same text. Nothing has to translate.

### 2. A `guide` pipe provider, not a bare `file` pipe

Guides are real files on disk in dev **and** in the packaged app (`extraResources`), so the cheap
option is to resolve `persephone-guide://editors/grid` to an absolute path with
`api.getAssetsPath("guides/editors/grid.md")` (`src/ipc/renderer/api.ts:62`) and hand the existing
`file` provider that path. It would work today and it would make relative links free, since the page
would be an ordinary file page.

It is rejected as the **default** for one reason: the absolute path is install-dependent. A guide
page persisted in `IEditorState.pipe` would restore to a path that is wrong after an update, wrong in
a packaged build if authored in dev, and wrong on another machine — and `sourceLink` would show the
user a path inside the install directory instead of the guide's name. So a **new `guide` provider
type** (`src/renderer/content/registry.ts:18` `registerProvider`, joining `file`, `cache`, `http`,
`data`, `mneme`) is registered, whose config is the corpus-relative path and which resolves the
asset path at read time. Install-independent, and the pipe descriptor says what it actually is.

The provider is read-only: guides ship with the app and are not user files. Editing them is a repo
operation, not an in-app one — `md-view`, not the text editor, is what a guide link opens.

**Fallback** if the provider proves to fight the resolver or the restore path: the `file` pipe above,
with the guide path kept in the descriptor for re-resolution. US-1366 settles it and records which
shipped.

### 3. One relative-link resolver, shared by both hosts

`resolveGuideHref(fromGuidePath, href)` — corpus-relative, in `src/shared/guides/` beside the index
that already knows what pages exist, so it can reject a link to a page that is not there instead of
opening a blank pane. Both hosts call it: the About pane on a click inside the rendered body, and
`markdown-nav.ts` for a `persephone-guide://` page whose relative link must stay in the scheme.
`markdown-nav.ts` keeps its `file://` branch unchanged — this is an added branch, not a rewrite.

### 4. `MarkdownBodyView` is reused through a narrowed host interface

The body view's dependency on `MarkdownEditor` is narrowed to an interface describing what it
actually consumes (content, source path, the typed queue, the nav callbacks), which `MarkdownEditor`
then satisfies unchanged in behaviour and the About pane satisfies with a small host object. This is
preferred over the two alternatives:

- **A second renderer** — forbidden by the roadmap, and it would drift.
- **Instantiating a real `MarkdownEditor` and `PageModel` inside the About page** — it fabricates a
  page. Either `pages` lists a page the user cannot see, or it hides one that exists; both are the
  failure class EPIC-091 spent an epic removing from the `call` surface.

**Fallback** if the interface extraction turns out to reach further than the body view (into
`MarkdownBlockView`, `CodeBlock` or the typed queue): an adapter object implementing the same members
the view reads, with the extraction deferred. US-1368 measures the real surface and its plan review
is where this epic's judgement is spent.

### 5. No second guide index in the renderer

`src/shared/guides/` takes a `GuideSource` (`readDirectory`, `readFile` —
`src/shared/guides/index.ts:14-17`) precisely so it can run on both sides. The renderer implements
**one** `GuideSource` over `app.fs` plus `api.getAssetsPath`, and feeds the existing index. No
duplicate tree builder, no duplicate front-matter parser, and no IPC round trip to the main-process
`guides` node for tree data the renderer can read directly. Anything the About page needs that only
main has today (the What's New section selection, notably) is **moved into `src/shared/guides/`** and
used by both, not copied.

### 6. Audience filtering: `user` and `both` by default, agent pages behind a toggle

Roadmap rule, taken as written. The toggle is browser state on the About editor, not a new
`app.settings` entry: it is a browsing mode a user flips while reading, not a preference about how the
app behaves, and the About page is re-created on each open anyway. If the user wants it sticky that
is a one-line setting later — recorded under Needs user check rather than guessed at.

### 7. `F1` is free, and its mapping is mostly empty until EPIC-094

There is no global `F1` binding in the renderer (the only hit is a keycode-map entry in
`src/renderer/automation/input.ts:34`), so this epic takes it. It opens the **active page's** guide
when a guide's front matter carries a matching `editorId`, otherwise the contents view. EPIC-092's
front matter already has the `editorId` field, but EPIC-094 writes the per-screen pages that will
carry it — so today the mapping resolves for very few editors, and the fallback to contents is the
normal path, not an error path. `F1` must never surface "no guide for this screen" as a failure.

### 8. The About card's content does not change

Left pane is today's card: icon, name, version, runtime versions, *Check for Updates* with its status
line, GitHub repository, *Report issue* (`src/renderer/editors/about/AboutView.ts:121-198`). The only
behavioural change anywhere in the card is the *What's New* link that appears when an update is
available (`AboutView.ts:261`), which stops opening GitHub and opens the in-app page. Layout changes
because the page splits; content does not.

### 9. One facade, one `data-name` contract, both by the existing route

`about-view` has no facade (`src/renderer/scripting/api-wrapper/PageWrapper.ts` `FACADE_FOR_EDITOR`
has no entry). It gets one: a plain class implementing `IAiVisible` with no base class, as
`MarkdownEditorFacade` is, with `elements`/`highlight` built by the shared `createElements` helper
from `../ai-vision/elements` that every other facade uses. Members: `open(path)`, `back()`,
`current`, `elements`, `highlight`. Every standing `call` rule from EPIC-091 applies — validate and
throw actionable messages, no silent no-ops, absent keys omitted and never `null`, hints, no
truncation.

For addressing, About's views already pass a `name` prop (`about-root`, `about-github`,
`about-check-updates`), which is the route `doc/architecture/ui-element-contract.md` prescribes and
which survives the UIKit re-render that strips hand-written `data-name` attributes
(`src/renderer/uikit/CLAUDE.md`). New elements follow it. No hand-written attributes.

### 10. The epic also clears one EPIC-092 deferral

`PathSyntaxError` does not suggest bracket syntax for a hyphenated segment (US-1371). EPIC-092 fixed
that class *per tree*, by having every guide tree entry carry a parser-valid `call` string; the root
fix is a parser message change and belongs with the epic that makes hyphenated guide paths a thing
users' agents type. It is independent of everything else here and runs first.

## Scope

**In scope.**

- The `persephone-guide://` scheme end to end: Layer 1 parser, Layer 2 resolver and `guide` pipe
  provider, Layer 3 opening `md-view`; the shared relative-link resolver; the `markdown-nav.ts`
  branch.
- A renderer `GuideSource` and whatever moves from main into `src/shared/guides/` to avoid a
  duplicate.
- The About page split: vertical divider, the card unchanged on the left, the browser on the right.
- The contents view: guide tree with summaries, audience filtering with the *Show agent guides*
  toggle, *What's New* at the top with the current version's headline entries inline, and the
  *Resources* group (GitHub repository, issues, boards catalogue, MCP setup page).
- In-pane rendering: breadcrumbs from the path, `MarkdownBodyView` reused, in-pane navigation for
  relative links and `#anchors`, a back button, *Open in tab*.
- Entry points: Menu Bar *User Guide*, `F1`, the update flow's *What's New*, and re-pointing any
  other hard-coded link into the GitHub copy of the docs.
- The `about-view` facade and the About page's `data-name` contract.
- US-1371, the `PathSyntaxError` bracket hint.
- A QA surface file for the About page / guide browser, and a gate run of `mcp-test-agent-call`.

**Out of scope**, each with the epic that owns it:

- Writing `## Layout` schemas, splitting `editors/index.md` per screen, merging the duplicate
  editor catalogues, `where` on `elements`, and the in-editor "?" affordance — **EPIC-094**.
- Deleting `docs/`, the README and `CONTRIBUTING.md` pointers, and the release-process rewrite —
  **EPIC-095**.
- Any prose edit to a guide page beyond what re-pointing a link requires. This epic ships plumbing
  and a reader; the corpus's words are EPIC-094's.
- Search **in** the browser. `guides.search` exists for the agent; a search box in the pane is a
  natural next step and is deliberately not in this epic — the contents view with summaries is the
  navigation this epic owes, and adding search on top of an unproven pane widens the riskiest task.
  Recorded as a follow-up.

## Tasks

| Task | Title |
|------|-------|
| [US-1371](../tasks/US-1371-path-syntax-bracket-hint/README.md) | `PathSyntaxError` suggests bracket syntax for a hyphenated segment |
| [US-1366](../tasks/US-1366-guide-link-scheme/README.md) | The `persephone-guide://` scheme, the guide pipe, and renderer guide access |
| [US-1367](../tasks/US-1367-about-split-contents/README.md) | About page split and the contents view |
| [US-1368](../tasks/US-1368-in-pane-guide-rendering/README.md) | In-pane guide rendering: breadcrumbs, navigation, back, *Open in tab* |
| [US-1369](../tasks/US-1369-guide-entry-points/README.md) | Entry points: Menu Bar, `F1`, and the update flow's *What's New* |
| [US-1370](../tasks/US-1370-about-view-facade/README.md) | `about-view` agent facade and `data-name` contract |
| [US-1372](../tasks/US-1372-guide-browser-qa/README.md) | About / guide-browser QA surface and gate run |

Order is dependency order. US-1371 is independent and runs alongside US-1366. US-1367 and US-1368
both touch the About view and are separated only because the split plus the contents view is
reviewable on its own, while the reuse of `MarkdownBodyView` is the risk that deserves its own plan
review. US-1372 is the gate and closes the epic.

## Risks

1. **`MarkdownBodyView`'s coupling is deeper than the constructor suggests** (decision 4). The
   measured mitigation is US-1368's investigation; the fallback is an adapter. The failure mode to
   watch for is a "reuse" that quietly forks the block renderer.
2. **A guide page that does not restore.** The whole point of decision 2 is that a persisted guide
   page must reopen after an update. It is the one thing a green build cannot show — verify by
   opening a guide in a tab, restarting the app, and confirming it comes back.
3. **The pane rendering, and the app booting, are different questions.** EPIC-092 found three
   defects past a green build, all by running it. Every task here ends with live `call` verification,
   not a build.
4. **`F1` colliding with Monaco.** Monaco binds `F1` to its command palette in some
   configurations; the binding must not steal it from a focused editor, or must be chosen not to.
   US-1369 checks it live in a text page, not by reading the config.

## Needs user check

Recorded rather than blocking; work proceeds on the stated default.

1. **The scheme name.** Shipping `persephone-guide://` (decision 1), matching
   `persephone-board://` and `persephone-toolset://`. A shorter `guide://` was considered and
   declined for consistency with its two siblings.
2. **Whether the *Show agent guides* toggle should be sticky** (decision 6). Shipping as browser
   state that resets when the About page is re-opened. A persisted `app.settings` entry is a small
   follow-up if the user wants it.
3. **Whether the guide browser needs its own search box** (out of scope, above). `guides.search`
   already exists for the agent; the user-facing equivalent is deliberately deferred so it lands on a
   proven pane.
4. **`pages` and `pages.closePage` do not see folder pages** — an EPIC-092 observation. Sized in this
   epic rather than assumed small; see Notes. It is a `call`-surface correctness question about the
   *page collection*, not about guides, and it is recorded here so it is not lost.
5. **The root name `guides` vs `userGuide`** — carried forward from EPIC-092's Needs-user-check.
   This epic wires the About page to `guides`; the rename gets more expensive from here, so if it is
   wanted it is wanted now.

## Notes

### 2026-09-07

- Epic opened from the roadmap. Decisions 1-10 recorded above. The three the roadmap asked this epic
  to settle are 1 (the scheme name), 2 (how a guide link becomes a pipe) and 4 (how the markdown
  renderer is reused rather than duplicated).
- Verified before writing the plan, rather than assumed: `src/shared/guides/` is renderer-safe behind
  the `GuideSource` abstraction and imports no `fs`/`path`; the renderer can resolve an asset path
  through `Endpoint.getAssetsPath` (`src/ipc/renderer/api.ts:62`); the content pipeline has **no**
  asset or app-resource provider (`registry.ts` carries `file`, `cache`, `http`, `data`, `mneme`),
  which is what makes decision 2 a decision; `about-view` has no facade entry in
  `PageWrapper.ts`'s `FACADE_FOR_EDITOR`; `F1` is unbound in the renderer; `MarkdownBodyView`
  requires a `MarkdownEditor` model, which is risk 1.
- The only hard-coded link into the GitHub copy of the corpus inside `src/` is `AboutView.ts:261`
  (*What's New*), which US-1369 re-points. `assets/board-template/CLAUDE.md:724` also points at
  `assets/guides/boards.md` on GitHub, but that file is authoring guidance read from the repo, and
  EPIC-095 owns the repo-side pointers.
