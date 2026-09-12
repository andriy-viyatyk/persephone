# US-1408: AiVision cannot see or act on a page with no main editor

## Goal

Make every page the user sees in the tab strip visible and actionable through AiVision. A page
whose main editor has been detached (`mainEditorId === null`) renders as a real "Empty" tab for
the user, but is absent from `pages`, `pages.all`, `pages.activePage`, `page` and
`pages.findPage`, and `pages.closePage` refuses its id.

## Background

### How the gap was found

US-1407 changed `ensureBoardIdle` to detach and dispose the board editor instead of closing the
page, so "Delete board" now leaves the tab open and empty. The user saw two `Empty` tabs; the
agent reading `pages` saw neither, and reported the pages as closed. The user corrected it.

Editorless pages were always representable — `PageModel.detach()` nulls `_mainEditorId`
(`src/renderer/api/pages/PageModel.ts:300-303`) and `setMainEditor(null)` is documented as
"Replace (or **clear**) the main editor" (`PageModel.ts:431`) — so this is a latent gap that
US-1407 made reachable through ordinary use, not a defect US-1407 introduced.

### The renderer treats an editorless page as first-class

- `PageContentView.syncContent(null)` builds a dedicated `empty-page-root` element with
  `data-name="page-empty"` and the background ornament
  (`src/renderer/ui/app/PageContentView.ts:154-170`).
- `PageModel.title` falls back to `"Empty"` (`PageModel.ts:238`).
- The tab strip, `OpenTabsListView` and `PageTabView` all read `page.mainEditor` with optional
  chaining and render fine without one.

Confirmed live: with one such page active, `document.querySelector('[data-name="page-empty"]')`
is non-null and the tab strip shows a fifth tab reading `Empty`.

### The single cause

`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`:

```ts
get all(): PageWrapper[] {
    return this.pages.pages
        .filter((p) => p.mainEditor)                      // <-- line 164
        .map((p) => new PageWrapper(p.mainEditor, this.releaseList, undefined, this.callContext));
}

private wrap(page: PageModel | null | undefined): PageWrapper | undefined {
    const editor = page?.mainEditor;                      // <-- line 151
    return editor ? new PageWrapper(editor, ...) : undefined;
}
```

`PageWrapper` is constructed from an `EditorOrHost` and derives its page from `model.page`
(`PageWrapper.ts:160-179`), so a page with no editor has nothing to build a wrapper *from*. The
filter and the `wrap()` guard are the consequence of that identity choice, not an independent
decision.

Everything downstream inherits it:

| Member | Line | Behavior on an editorless page |
|---|---|---|
| `pages` summarize (`count`) | 118 | Undercounts; the user's tab count and the agent's disagree |
| `pages` children / `pages[i]` | 117, 128 | Page absent; **numeric indices shift** past it |
| `pages.all` | 163 | Page absent |
| `pages.activePage`, `page` | 159 | `null` **while that page is active** |
| `pages.findPage(id)` | 167 | `null` for an id that exists |
| `pages.closePage(id)` | 200-203 | **Refuses** — `choiceRule` validates against `this.all` |
| `pages.showPage(id)` | 330 | **Succeeds** (guards on `this.pages.findPage`), but its error text lists only editor-bearing ids |

The `showPage` / `activePage` pair is the worst of it: `showPage` accepts the id, activates the
page, and then `pages.activePage` and `page` both return `null`. Verified live, in this order:

```
pages.closePage("9f83aa15-...")  -> Error: expected one of the current pageId values: <four other ids>
pages.showPage("9f83aa15-...")   -> null   (succeeded)
pages.activePage                 -> null
page                             -> null
window.screen.evaluate(...)      -> tabs: ... | Empty    empty-page-rendered: true
```

`summarize()` already reports `activePageId` from the real model (`this.pages.activePage?.id`),
so `pages` reports an `activePageId` that is not among its own children — the incoherence an
agent actually trips over.

### What is NOT affected

- `window.screen.*` — the accessibility snapshot shows the `Empty` tab correctly; it reads the DOM.
- `attention.ts:134` — iterates `pagesModel.pages` directly and only looks for `LogViewEditor`.
- `PageEditorSwitchesNode`, `PageTabNode`, `PagePanelsNode` — all constructed from
  `() => PageModel | null`, so they already work without an editor.
- `PagesPersistenceModel.ts:212` drops an editorless page with no sidebar **on restore**. That is
  deliberate and out of scope: the tab is session-only, which is fine, but it must still be
  visible while it exists.
- `pages.isLastPage` / `pages.isGrouped` delegate straight to `pagesModel` and already count
  editorless pages — they are correct today and are the precedent for the fix.

## Implementation plan

The whole change is in two files. The principle: **a `PageWrapper` is identified by its page, and
its editor is a property that may be absent** — which is what `PageWrapper` already half-assumes.

### 1. `src/renderer/scripting/api-wrapper/PageWrapper.ts`

Allow a null model. `PageWrapper` already tolerates a missing *main* editor — `currentEditorId()`
falls back to `"monaco"` and `get editor()` returns a `GenericEditorFacade` when no factory
matches (`PageWrapper.ts:167-211`) — so only the constructor and the `this.model.*` reads need
widening.

- Change the constructor to take the page alongside the model:
  `constructor(private readonly model: EditorOrHost | null, private readonly pageModel: PageModel | null, ...)`.
  Keep the existing single-argument call sites working by deriving `pageModel` from
  `model.page` when not supplied.
- Route every `this.model.page` read through a single `private get page(): PageModel | null`
  that returns `this.pageModel ?? this.model?.page ?? null`.
- Null-guard the model-backed members, matching what the empty page genuinely has:
  - `id` -> `this.page?.id ?? ""`
  - `title` -> `this.model?.title ?? this.page?.title ?? "Empty"` (`PageModel.title` already
    returns `"Empty"`)
  - `modified` -> `false`; `filePath` -> `undefined`; `content` -> `""`; `language` -> `""`
  - `content` / `language` setters: no-op when there is no model (they already no-op for a
    non-text model)
  - `data` -> the page's script data if reachable, else an empty object
- `get editor()`: when `this.mainEditor` is null AND there is no model, return
  `new GenericEditorFacade("", "Empty")` so the facade reports the page as having no editor rather
  than claiming `"monaco"`. **Do not** let `currentEditorId()` keep defaulting to `"monaco"` in
  this case — an agent reading `page.editor.id === "monaco"` on an empty page would act on a text
  editor that is not there.
- `aiSummary()` must report the empty state explicitly (e.g. `editor: null`), so the agent can
  tell an empty page from an unreadable one.

### 2. `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`

- `all` (line 163): drop `.filter((p) => p.mainEditor)` and construct
  `new PageWrapper(p.mainEditor ?? null, p, this.releaseList, undefined, this.callContext)`.
- `wrap()` (line 150): return a wrapper whenever `page` is non-null, passing
  `page.mainEditor ?? null` as the model. This fixes `activePage`, `groupedPage`, `findPage` and
  `getGroupedPage` in one edit.
- `aiChildren()` (line 128): `page.editor.id` is already routed through the facade; confirm the
  summary line reads sensibly for an empty page (expected: `"Empty" id=... (no editor)`).
- `closePage` (line 200): `openPageIds` now includes editorless pages automatically once `all` is
  fixed — no separate edit, but it is the acceptance case that matters most.
- `showPage` (line 331): its `known` list now includes them too; no code change.

### 3. Help text

`PAGES_MEMBERS` / `PAGE_MEMBERS` describe `editor` as "Current editor facade; inspect its id to
discover the available operations." Add one clause noting that a page can have **no** editor (a
tab left open after its editor was closed) and what that reads as. Keep it to a clause — these
strings are sent to every agent session.

## Concerns

- **`page.content` on an empty page returns `""`, which is indistinguishable from an empty text
  page.** Accepted: `editor` reporting no id is the discriminator, and `window.screen` remains the
  ground truth. Do not invent an error here — an agent iterating `pages` must not throw on one.
- **`GroupedPageWrapper` / `requireGroupedText`** (`PageWrapper.ts:293`): `grouped` currently
  falls back to `pagesModel.requireGroupedText(pageId)` when the grouped page has no main editor.
  Verify that path still behaves after `wrap()` stops returning `undefined`; it is the one place
  where an editorless page previously produced a *deliberate* throw.
- **Numeric index stability.** Once empty pages appear in `all`, `pages[i]` renumbers. This is the
  correct behavior (it now matches the tab strip) but it is a visible change for any agent holding
  an index across calls. Ids are unaffected.
- This task is the reason to re-check the same question for any other collection wrapper that
  filters by a derived property. A grep at the time of writing found exactly one such filter
  (`PageCollectionWrapper.ts:164`), so no other surface is implicated.

## Acceptance criteria

With one page whose main editor has been detached (reproduce by opening any board and running
`ensureBoardIdle(root, "deleting")`, or by deleting an open board from the Boards panel):

1. `pages` reports a `count` equal to the number of tabs the user sees, and lists the empty page
   as a child.
2. `pages.activePage` and `page` return that page while it is active — never `null` for a page
   that exists. `pages` no longer reports an `activePageId` absent from its own children.
3. `pages.findPage("<id>")` returns it.
4. `pages.closePage("<id>")` closes it, and the tab disappears from `window.screen.snapshot`.
5. `pages[i].editor` reports no editor rather than claiming `"monaco"`.
6. Reading every member of that page (`content`, `language`, `filePath`, `modified`, `tab`,
   `panels`, `editorSwitches`) returns a value instead of throwing.
7. `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Files changed

| File | Change |
|---|---|
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Accept a null model; identify by page (`pageModel` 5th ctor arg + `page` getter); null-guard every model-backed member; `hasEditor`; empty `currentEditorId()` instead of "monaco"; `editor: null` plus a recovery `note` in the summary; no `.editor` child; clear throws from `runScript` and the `language` setter; help text |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Drop the `mainEditor` filter in `all`; build wrappers from the page in `wrap()`; child summary reads `(no editor)` |
| `src/renderer/scripting/ai-vision/page-editor-switches.ts` | **Added during implementation.** `current` returned `"monaco"` for an editorless page, contradicting `page.editor` and inviting a `switchTo()` against a page with nothing to rebuild over. Now empty, with matching help text. |

### Files that need no changes

`src/renderer/ui/app/PageContentView.ts`, `src/renderer/api/pages/PageModel.ts`,
`src/renderer/api/pages/PagesModel.ts`, `src/renderer/api/pages/PagesPersistenceModel.ts`,
`src/renderer/scripting/ai-vision/attention.ts`,
`src/renderer/scripting/ai-vision/page-tab.ts`,
`src/renderer/scripting/ai-vision/page-panels.ts`,
`src/renderer/scripting/ai-vision/namespaces/window-screen.ts`.

## Outcome

Implemented and verified live against a page emptied by detaching its board editor:

```
pages                      -> count 5; pages[4] "Empty" id=351cb0ce... (no editor) <- active
page                       -> { editor: null, note: "This tab is open but has no editor. ..." }
pages[4].editorSwitches    -> { current: "", options: [] }
pages[4].content / .tab / .panels  -> "", tab node, panels node  (no throw)
pages.findPage("351cb0ce...")      -> the page
pages.navigatePageTo(id, "doc/active-work.md") -> true; page then reports md-view
pages.pinTab / unpinTab / closePage(id)        -> all succeed; tab gone from the DOM
```

`navigatePageTo` needed no change and is the documented way to make an empty tab useful again;
it is named in the `note`, in `PAGE_HELP` and in the switches help. `typecheck`, `lint` and
`build-prod` pass.

Not addressed, deliberately: `PagesPersistenceModel.ts:212` still drops an editorless page on
restore, so the tab is session-only. That is existing, intentional behavior and orthogonal to
seeing the page while it exists.
