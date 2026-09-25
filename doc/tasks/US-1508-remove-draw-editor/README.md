# US-1508: Remove the built-in drawing editor and every seam that names it

Status: Planned investigation for [EPIC-110](../../epics/EPIC-110.md). US-1507 must land first;
this document deliberately contains no implementation changes.

## Goal

Remove the built-in `src/renderer/editors/draw/**` editor, its registry/matcher/sidebar/capability
seams, and its script facade while leaving the bundled Excalidraw content-host board as the sole
`image.edit`/`diagram.edit` provider. Existing `.excalidraw` pages and the migrated pinned `+`
slot must continue to open through the board.

The task must remain independently buildable before US-1509 removes React-specific configuration.
There are two documented script/API breaks to announce at EPIC-110 close: a drawing page's
`pages[i].editor` changes from the built-in `IDrawEditor` facade to the bundled board's
`IBoardEditor` facade, and the published `{ editor: "draw-view" }` data-image route stops routing.
`/userdoc` owns both announcements.

## Background

### Governing decisions and current repository state

EPIC-110 decisions D2, D3, D5, D6, and D8 govern this task. The dashboard already contains the
US-1508 child under EPIC-110; it is intentionally not edited. The worktree also contains the
US-1507 task/document changes, so `PagesPersistenceModel.ts`, `settings.ts`, and
`tools-editors-registry.ts` are cited by symbol rather than unstable line number.

The live source tree has exactly eight files under `src/renderer/editors/draw/`, but their current
total is 1,309 physical lines (not the 1,447-line figure in EPIC-110's table). The eight files are:
EPIC-110's seam table should be corrected at epic close so the reviewed epic and this task document
do not permanently disagree.

```text
capability-handlers.ts
DrawBodyView.ts
DrawEditor.ts
drawExport.ts
drawLibrary.ts
ExcalidrawIsland.tsx
index.ts
react-island.ts
```

There is no `src/renderer/editors/index.ts` export of the draw module. The root barrel exports
only base, text, grid, markdown, and compare; draw is reached only by the literal dynamic import
in the registry row.

### Verified source inventory

The epic table is correct for its principal deletion seams, but incomplete. The exact source
references found by walking the requested names are:

| Source | Verified finding and disposition |
|---|---|
| `src/renderer/editors/register-editors.ts`, `EDITORS` | Delete the `draw-view` row, including its `guidePath`, content-host flag, capability declarations, and dynamic `./draw` import. This is the only registry/barrel entry for the module. |
| `src/renderer/editors/base/editor-matchers.ts`, `EDITOR_MATCHERS` | Delete the `.excalidraw` matcher keyed by `draw-view`. The bundled board's `fileMasks`/`editorPriority` then owns default file resolution. |
| `src/renderer/api/capabilities.ts`, `createDrawHandler` and `createHandler` | Delete the built-in draw handler and the editor-id branch. `seedPlatformCandidates()` will no longer add platform `image.edit` or `diagram.edit` candidates. |
| `src/renderer/content/builtin-schemes.ts`, `resolveData` | Replace the `data.target === "draw-view"` route selector with the neutral image-edit capability target described below. Keep `pagesModel.addDrawPage()` and its capability-bus call; make the caught error text neutral rather than saying “Drawing editor”. |
| `src/renderer/api/types/io.link-data.d.ts`, `ILinkNav.target` | **Missed by the epic table.** Clarify that the routing field accepts an editor ID or capability ID, and that Layer 2 resolvers may set/override it before Layer 3 consumes it. This documents the D6 route change rather than pretending the field remains editor-only. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts`, `DEFAULT_PINNED_EDITORS`, `staticItems` | US-1507 owns migration of persisted/default pin IDs. US-1508 removes the static built-in Drawing item; the bundled board item remains dynamically supplied as `bundled-board:excalidraw` and keeps its manifest label, **Excalidraw**. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` | Delete the whole facade. Its dynamic `drawExport` imports and `DrawEditor` type import die with it. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts`, `EditorFacade`, `FACADE_FOR_EDITOR` | Remove the `DrawEditor` import, `DrawEditorFacade` import/union member, and `draw-view` factory row. The dynamic board-id fallback already selects `BOARD_FACADE_FACTORY`. |
| `src/renderer/api/types/draw-editor.d.ts` | Delete `IDrawEditor`. |
| `src/renderer/api/types/common.d.ts`, `EditorView`; `src/renderer/api/types/page.d.ts`, facade imports/unions | Remove the `draw-view` union member and `IDrawEditor` import/union member. The `IBoardEditor` union already accepts `board-editor:${string}`. |
| `src/renderer/api/types/capabilities.d.ts`, `CapabilityInfo.handlerKey` comment | **Missed by the epic table.** Remove `draw-view` from the example of platform handler IDs; the type itself remains. |
| `src/renderer/editors/board/board-api.d.ts`, `openContent` documentation | **Missed by the epic table.** Remove `draw-view` from the content-host editor-id example; the board API and `openContent` behavior remain. |
| `src/renderer/api/types/editors.d.ts`, text-host editor list comment | **Missed by the epic table.** Remove the deleted Draw editor from the explanatory list; this is a comment-only cleanup. |
| `src/renderer/editors/base/TextHostEditorModel.ts`, subclass-surface comment | **Missed by the epic table.** Remove “Draw” from the adoption-pattern examples; the lifecycle implementation is generic and remains. |
| `src/renderer/editors/html/HtmlEditor.ts`, image-capture comment | **Missed by the epic table.** Rename the stale “Draw editor” comment to the surviving Excalidraw-board wording; the `addDrawPage()` call remains. |
| `src/renderer/editors/board/board-manifest.ts`, `editorPriority` documentation | **Missed by the epic table.** Remove the stale `draw 50` rung from the priority-ladder comment after the built-in matcher is deleted; manifest normalization and priority comparison remain. |
| `src/renderer/api/pages/PagesPersistenceModel.ts`, `normalizeEditorDescriptor` | US-1507-owned migration reference. It must remain until that migration is complete, then it is the compatibility rewrite from persisted `draw-view` to the bundled board; US-1508 must not duplicate or remove it. |
| `src/renderer/api/settings.ts`, `migrateLegacyPinnedEditors` | US-1507-owned pinned-settings migration reference. It must remain; it rewrites old persisted `draw-view` to `bundled-board:excalidraw`. The separate `pinned-editors` help/default changes are also US-1507. |
| `src/renderer/editors/draw/DrawEditor.ts`, `DrawBodyView.ts` | The only `editorSettings["draw-view"]` slot is inside the deleted editor. No surviving code reads that slot, so no settings migration is required for it. |
| `src/renderer/editors/base/editorRegistry.ts`, `preloadContentHostModules` | Generic preload logic has no draw-specific entry or string. Keep it; after the row disappears it simply preloads the remaining content-host definitions. |
| `src/renderer/editors/shared/image-export.ts`, module comment | The comment names `addDrawPage`, not the deleted editor. Keep it because `addDrawPage` survives and remains its consumer. |
| `src/renderer/editors/index.ts` | No draw export exists; no barrel edit is needed. |

The folder's `ExcalidrawIsland.tsx` and `react-island.ts` are therefore removed with the folder;
their React-root adapter is not reused by the board, whose React bundle is already inside the
committed board `lib/`.

### D6: data-image link routing

`resolveData()` in `src/renderer/content/builtin-schemes.ts` currently checks
`data.target === "draw-view"` before normal file/board resolution. The target is not assigned by a
hidden internal drawing call: `App.openRawLink` in `src/renderer/api/app.ts` creates link data with
`target: options?.editor`; `RendererEventsService.handleBoardOpenRawLink` in
`src/renderer/api/internal/RendererEventsService.ts` forwards a board's requested editor into the
same `ILinkData` field; and `createLinkData()` in `src/shared/link-data.ts` preserves a caller's
`ILink.target`. The Layer 1 parsers preserve that field while setting `data.url`.

The replacement selector must be the capability name `"image.edit"`, not a board editor id. Board
ids are virtual `board-editor:<boardRoot>` values derived from the board root and cannot be a
stable constant. This deliberately overloads the documented `ILinkNav.target` routing field: its
comment in `src/renderer/api/types/io.link-data.d.ts` must change from “Target editor ID” to
“Target editor ID or capability ID”, while retaining that callers may seed it from `ILink.target`
and Layer 2 scheme/file resolvers may set or override it before Layer 3 consumes it. The route
therefore becomes:

```ts
// Before
if (data.target === "draw-view" && data.url?.startsWith("data:image/")) {
    await pagesModel.addDrawPage(data.url, ...);
}

// After
if (data.target === "image.edit" && data.url?.startsWith("data:image/")) {
    await pagesModel.addDrawPage(data.url, ...);
}
```

This keeps the link route as a request for an image-edit capability and lets
`PagesLifecycleModel.addDrawPage()` invoke the same `image.edit` bus used by Image, SVG, Mermaid,
HTML, and snip handoffs. It must not call `addBundledBoardPage()` or compare against a
`board-editor:<root>` string.

This is a second public API break, separate from the `pages[i].editor` facade break:
published `{ editor: "draw-view" }` calls in `assets/guides/agents/boards.md`,
`assets/guides/scripting/api/app.md`, and the shipped `assets/guides/whats-new.md` entry stop
routing after this change. `/userdoc` must announce that break and update those examples to
`{ editor: "image.edit" }` at epic close.

Decision: do **not** accept `"draw-view"` as a legacy alias alongside `"image.edit"`. An alias
would preserve published calls, but it would retain the deleted editor identifier in the runtime
route and make the removal seam permanent. The explicit migration is intentional; the persisted
page/pin migrations in US-1507 are compatibility rewrites, not a runtime alias.

### D5: capability ownership after removal

`createDrawHandler()` dynamically imports `editors/draw/capability-handlers`, and `createHandler()`
selects it only when the registry definition id is `draw-view`. Removing the row and both branches
leaves the generic platform handlers (`text.open` and the `content.view` representations) intact,
but leaves no platform handler for `image.edit` or `diagram.edit`.

`CustomEditorRegistry.refresh()` reads enabled bundled/trusted manifests and calls
`registerCapability()` for each manifest capability. The bundled
`assets/boards/excalidraw/board-manifest.json` declares exactly `image.edit` and `diagram.edit`;
with the built-in row gone, it is the sole remaining platform/bundled handler for both in this
repository's shipped board set. Trusted third-party boards may still register capabilities through
the existing board contract by design. When the bundled board is disabled and no replacement is
installed, no handler is expected; US-1510 owns the new actionable no-handler state.

### D3: priorities and the shipped board

The manifest currently sets `editorPriority: 60` and both capability priorities to `60`. Three
separate mechanisms matter:

1. **File resolution:** `resolveEditorIdForFile()` in
   `src/renderer/editors/board/custom-editor-registry.ts` keeps the first board on a priority tie
   because it updates `best` only when `b.priority > best.priority`. `CustomEditorRegistry.refresh()`
   builds `entries` trusted-first and bundled-second, so a trusted replacement at 50 precedes the
   bundled board at 50 and wins that tie.
2. **The safety gate is the next comparison, not the board tie rule:**
   `resolveEditorIdForFile()` returns the board only when `best.priority > builtinPriority`.
   After the `draw-view` matcher is deleted, `.excalidraw` resolves to Monaco, whose
   `EDITOR_MATCHERS.monaco.acceptFile()` is the file-resolution floor `0`. This is distinct from
   Monaco's `accepts()` value of `50` in the `EDITORS` row, which serves page/switch acceptance;
   it must not be used for this file-resolution check. Therefore the new board priority `50`
   still satisfies `50 > 0` and a real `.excalidraw` file remains board-opened rather than falling
   back to Monaco.
3. **Capability resolution:** `compareCandidates()` in `src/renderer/api/capabilities.ts` sorts
   priority descending, then prefers `origin: "platform"`, then registration order. After the
   built-in row is removed there is no platform `image.edit`/`diagram.edit` candidate, so a trusted
   board declaration at 50 wins capability ties by registration order. The 50 default is verified
   separately in `seedPlatformCandidates()` (`priority: 50`) and
   `registrationFromDeclaration()` (`declaration.priority ?? 50`).

Change all three manifest priorities from 60 to 50. No source code depends on retaining 60 after
the matcher and built-in capability handler are removed. The bundled board has no `WHATS-NEW` file
and its manifest has no version field; this is a shipped board in this repository, so no
board-version bump or generated `lib/` regeneration is needed.

### D8: `drawLibrary.ts` and settings migration

`drawLibrary.ts` is only referenced by `DrawBodyView.ts` and is deleted with the folder. The long
`settings.get` escape-hatch comment in `src/renderer/api/settings.ts` is now stale once that file
is gone: trim the draw-library-specific rationale, but keep the general rule that the generic
overload returns `unknown` and callers must opt into a narrow `settings.get<T>(key)` type.

Do not touch the legacy migration in `src/renderer/api/board-settings/board-settings-bridge.ts`.
`migrateLegacyExcalidrawLibraryPath()` still reads the old `drawing.library-path` settings key and
uses `boards.excalidraw-library-migrated` to import a user-selected path into the bundled board's
`library-path`; neither names the deleted editor as runtime code. Its explanatory prose may later
say “legacy built-in drawing editor” as historical context, but the migration and bookkeeping key
must remain.

### Public script API and bundled-board wrapping

The deleted `DrawEditorFacade` implements `IDrawEditor`, whose discriminant is `id: "draw-view"`.
`PageWrapper.editor` first obtains the page's live `mainEditorInstance`, then uses the editor id
to select a static facade or, for `isBoardEditorId(id)`, `BOARD_FACADE_FACTORY`.

`BoardContentEditorModel.editorId` returns `board-editor:<root>` whenever its board root is set.
`PagesLifecycleModel.addBundledBoardPage()` constructs that content-host model from the bundled
board root, adopts a text host, and adds it to the page. Consequently, after US-1507 rewrites an
old persisted drawing descriptor and after the built-in row is gone, a drawing page wraps as:

```ts
// Before
page.editor.id === "draw-view";       // IDrawEditor / DrawEditorFacade

// After
page.editor.id === `board-editor:${boardRoot}`; // IBoardEditor / BoardEditorFacade
```

The root is dynamic and must not be hardcoded. `IBoardEditor` operations are the surviving public
facade; the old `addImage`, export, mount-state, and element-count members are not promised on the
new board facade. This is the first of two breaking changes to announce in `/userdoc` at epic
close; the second is the D6 `{ editor: "draw-view" }` route break.

### Guide and user-facing wording decision

The `guidePath: "editors/draw"` registry value is removed with the built-in row. Keep
`assets/guides/editors/draw.md` for now rather than deleting or moving it: existing guide links
already point at that stable path, and the user-facing Excalidraw drawing workflow still exists.
At epic close, `/userdoc` must rewrite it in place as the bundled Excalidraw-board guide, remove
the `editorId: "draw-view"` frontmatter and built-in fallback/API claims, and update the guide
corpus' other `draw-view`/built-in-drawing references. The US-1508 source commit does not edit the
guide corpus.

Verified interim behavior before that `/userdoc` rewrite: the bundled board manifest has no
`guides` declaration, and `resolveRendererBoardGuideMounts()` mounts only trusted boards, so the
bundled Excalidraw board contributes no board-owned guide branch. The drawing page's live id is
`board-editor:<root>`, while `KeyboardService.findGuidePath()` requires an exact editor-id match
(or a mounted board's `editorId: "board"` claim). After this task removes the built-in row, F1 on
a drawing page therefore finds neither `editors/draw` nor a bundled-board guide and opens the About
guide contents fallback. The retained `assets/guides/editors/draw.md` is still directly reachable
by existing guide URLs, but no registry `guidePath` or drawing-page F1 path points to it.

The scripting guide link is different: `withEditorGuideHelp()` recognizes `board-editor:<root>`
and falls back to the `board-view` registry guide, so a board facade's help points to
`guides.editors.board`. That is the only interim guide link a drawing page's board facade exposes;
the F1 behavior above is a temporary, documented epic-internal regression until `/userdoc` updates
the guide corpus and guide matching as needed.

Source toolbar/action labels such as “Open in Drawing Editor” are capability handoffs, not static
`draw-view` registry references; their calls already invoke `image.edit`/`diagram.edit`. Keep the
behavior in US-1508, and have `/userdoc` decide the final product wording consistently with the
bundled board's **Excalidraw** label.

### Build gate and ordering

US-1509 owns the React import-ban rule and its `editors/draw/**` exemption, plus the tsconfig JSX
setting and Excalidraw type-path configuration. Deleting the folder after US-1508's import/registry
and facade removals leaves those settings harmless: an ESLint ignore/exemption for a nonexistent
folder matches no files, and `jsx: "react-jsx"` is accepted even when the source tree contains no
`.tsx` file. The Vite config's board `lib/` optimize/watch rules are also unrelated and stay.

The implementation must run `npm run typecheck`, `npm run lint`, and `npm run build-prod` after the
US-1508 edits, before US-1509 changes configuration. The checks must include a source-wide search
that leaves only the explicitly retained US-1507 migration references and non-editor historical
documentation until `/userdoc` handles the guide corpus.

Investigation baseline on the current worktree (with the US-1507 changes present): all three
commands exited 0 on 2026-09-25. `build-prod` emitted existing ineffective-dynamic-import and
large-chunk warnings but completed successfully. This is a baseline, not a post-deletion claim;
the implementation must rerun the same gates after applying the plan while US-1509's config is
still unchanged.

## Implementation Plan

1. Confirm US-1507 is present and tested before changing this task's seams. Preserve the
   `normalizeEditorDescriptor` migration in `PagesPersistenceModel` and
   `migrateLegacyPinnedEditors` in `settings`; do not add a second migration.
2. Delete all eight files in `src/renderer/editors/draw/` together. This removes
   `DrawEditor`, `drawLibrary`, `drawExport`, `capability-handlers`, `ExcalidrawIsland`, and the
   React island adapter as one unit.
3. In `src/renderer/editors/register-editors.ts`, remove the `draw-view` entry from `EDITORS`.
   In `src/renderer/editors/base/editor-matchers.ts`, remove its `.excalidraw` matcher. Do not
   edit `src/renderer/editors/index.ts`; it has no draw export.
4. In `src/renderer/api/capabilities.ts`, remove `createDrawHandler` and the `draw-view` branch
   from `createHandler`. Verify platform seeding no longer registers `image.edit` or `diagram.edit`.
5. In `src/renderer/api/types/io.link-data.d.ts`, change `ILinkNav.target`'s comment to document
   editor IDs and capability IDs, caller seeding from `ILink.target`, and Layer 2 resolver
   overrides. In `src/renderer/content/builtin-schemes.ts`, change the data-image selector to
   `data.target === "image.edit"`; retain `pagesModel.addDrawPage()` and its error boundary, but
   change the caught notification from “Drawing editor” to neutral image-edit wording.
   Do not point it at a board root or board editor id. At epic close, `/userdoc` updates the
   published `{ editor: "draw-view" }` examples and announces that they no longer route; do not
   add a runtime alias.
6. In `src/renderer/ui/sidebar/tools-editors-registry.ts`, remove only the static built-in Drawing
   creatable row. Leave dynamic `bundled-board:excalidraw` creation, disable/enable rows, and
   migrated pin ordering intact.
7. Remove the draw imports, facade union member, and factory row from
   `src/renderer/scripting/api-wrapper/PageWrapper.ts`; delete
   `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts`.
8. Remove `IDrawEditor` and its imports/unions from `src/renderer/api/types/draw-editor.d.ts`,
   `common.d.ts`, and `page.d.ts`. Remove the stale `draw-view` examples from
   `src/renderer/api/types/capabilities.d.ts` and
   `src/renderer/editors/board/board-api.d.ts`. Also clean the explanatory Draw references in
   `src/renderer/api/types/editors.d.ts`, `src/renderer/editors/base/TextHostEditorModel.ts`, and
   `src/renderer/editors/html/HtmlEditor.ts`.
9. Trim only the deleted-file rationale from the arbitrary-key `settings.get` comment in
   `src/renderer/api/settings.ts`. Do not alter `board-settings-bridge.ts`, its legacy key, or
   `PagesLifecycleModel.addDrawPage()`.
10. Change `assets/boards/excalidraw/board-manifest.json` priorities 60 → 50 for `editorPriority`,
    `image.edit`, and `diagram.edit`; update the stale priority ladder comment in
    `src/renderer/editors/board/board-manifest.ts`. Do not regenerate
    `assets/boards/excalidraw/lib/` or invent a board version/WHATS-NEW change.
11. Run the three build gates while US-1509's JSX/eslint configuration is still present. Confirm
    the bundled board is the sole shipped platform/bundled handler for both edit capabilities, a
    real `.excalidraw` file resolves to the board after the matcher deletion and priority drop, and
    an upgraded page restores with a dynamic `board-editor:<root>` id.
12. Leave guide-corpus edits for `/userdoc` at EPIC-110 close. That pass must rewrite the retained
    drawing guide and all user-facing `draw-view`/built-in-fallback documentation, and announce
    the `pages[i].editor` facade break.

## Concerns / Open Questions

There are no unresolved implementation questions after source verification. The important
boundaries are:

- Do not remove US-1507 migration references from `PagesPersistenceModel` or `settings`.
- Do not rename `addDrawPage`; its capability implementation is already editor-neutral.
- Do not use a constant board editor id in the data-image route; use the `image.edit` capability
  target and let the capability registry select the enabled board.
- Do not preserve `draw-view` as a runtime alias in the data-image route; the published route break
  is intentional and must be documented.
- Do not delete the board settings migration or its bookkeeping key.
- Do not move the guide in US-1508; rewrite it in place during the epic-level `/userdoc` pass.
- Do not run US-1509's dependency/configuration cleanup as part of this task.

## Acceptance Criteria

- [ ] `src/renderer/editors/draw/` and every runtime import/factory/registry/matcher seam naming it
      are gone; no `DrawEditor`, `IDrawEditor`, `ExcalidrawIsland`, or `react-island` source seam
      remains outside deleted files.
- [ ] The static built-in Drawing creatable item and its `.excalidraw` matcher are gone; the
      bundled Excalidraw board remains the single drawing row and has its migrated pin position.
- [ ] `resolveData()` routes image data URLs through the neutral `image.edit` target and
      `addDrawPage()` remains unchanged and capability-based.
- [ ] `ILinkNav.target` documents editor IDs and capability IDs, with caller seeding and Layer 2
      resolver override behavior explicit; the runtime accepts `image.edit` and deliberately does
      not alias `draw-view`.
- [ ] The two public breaks are recorded for `/userdoc`: drawing pages expose `IBoardEditor` instead
      of `IDrawEditor`, and published `{ editor: "draw-view" }` data-image calls no longer route.
- [ ] Opening a real `.excalidraw` file—not merely creating an untitled page—resolves to the bundled
      board after matcher deletion and the manifest priority drop, because board priority 50 is
      greater than Monaco's surviving file-resolution floor 0.
- [ ] With the built-in row removed, `image.edit` and `diagram.edit` have no platform candidate;
      the enabled bundled Excalidraw manifest supplies the sole platform/bundled board candidate
      for each in the shipped repository (trusted third-party board registrations remain supported).
- [ ] The bundled manifest's three priorities are 50, with no board library regeneration or version
      bump.
- [ ] The arbitrary `settings.get<T>` safety rationale remains while its deleted-file-specific
      prose is removed; the legacy library migration and `boards.excalidraw-library-migrated` key
      remain unchanged.
- [ ] A restored bundled-board drawing page exposes `IBoardEditor` with a dynamic
      `board-editor:<root>` id; the old `IDrawEditor` surface is removed and this is recorded for
      the epic-close user documentation.
- [ ] The interim guide behavior is understood and tested/documented: F1 on the bundled drawing
      page falls back to About guide contents until the guide corpus/matching is updated, while
      the board facade's scripting help points to `guides.editors.board`.
- [ ] Existing eslint React exemptions and tsconfig JSX settings remain untouched, and
      `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass after US-1508 alone.
- [ ] No guide-corpus file is changed in this task; the retained drawing guide and related public
      docs are explicitly queued for `/userdoc` at epic close.

## Files Changed

| Path | Planned action |
|---|---|
| `doc/epics/EPIC-110.md` | Correct D3's file/capability priority mechanisms and record D6's second public route break. |
| `src/renderer/editors/draw/**` | Delete all eight built-in editor files. |
| `src/renderer/editors/register-editors.ts` | Remove the `draw-view` registration row. |
| `src/renderer/editors/base/editor-matchers.ts` | Remove the built-in `.excalidraw` matcher. |
| `src/renderer/api/capabilities.ts` | Remove built-in draw handler creation and dispatch branch. |
| `src/renderer/content/builtin-schemes.ts` | Route data-image requests by `image.edit`, retain `addDrawPage`, and neutralize the caught error text. |
| `src/renderer/api/types/io.link-data.d.ts` | Document `target` as accepting editor IDs or capability IDs and explain Layer 2 overrides. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Remove the static Drawing item only; preserve board rows and US-1507 migration behavior. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` | Delete. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Remove draw model/facade imports, union member, and factory row. |
| `src/renderer/api/types/draw-editor.d.ts` | Delete `IDrawEditor`. |
| `src/renderer/api/types/common.d.ts` | Remove `draw-view` from `EditorView`. |
| `src/renderer/api/types/page.d.ts` | Remove `IDrawEditor` and `draw-view` facade members. |
| `src/renderer/api/types/capabilities.d.ts` | Correct the stale handler-key example comment. |
| `src/renderer/api/types/editors.d.ts` | Remove the deleted Draw editor from the explanatory editor list. |
| `src/renderer/editors/base/TextHostEditorModel.ts` | Remove the deleted Draw editor from the lifecycle comment. |
| `src/renderer/editors/html/HtmlEditor.ts` | Rename the stale Draw-editor comment; preserve `addDrawPage()`. |
| `src/renderer/editors/board/board-api.d.ts` | Correct the stale `openContent` editor-id example. |
| `src/renderer/editors/board/board-manifest.ts` | Remove the stale `draw 50` priority-ladder comment. |
| `src/renderer/api/settings.ts` | Trim only the deleted `drawLibrary.ts` justification from the escape-hatch comment. |
| `assets/boards/excalidraw/board-manifest.json` | Lower the three priorities from 60 to 50. |

Files intentionally needing no US-1508 source change: `src/renderer/api/pages/PagesPersistenceModel.ts`
and `src/renderer/api/settings.ts`'s US-1507 migration logic, `src/renderer/api/pages/PagesLifecycleModel.ts`
and `src/renderer/api/pages/PagesModel.ts`'s `addDrawPage`,
`src/renderer/api/board-settings/board-settings-bridge.ts`, `src/renderer/editors/shared/image-export.ts`,
`src/renderer/editors/index.ts`, `assets/boards/excalidraw/lib/**`, the React eslint exemption, and
the `eslint.config.mjs` React restriction/exemption, `tsconfig.json`, `vite.renderer.config.ts`,
and `package.json` configuration owned by US-1509. `assets/guides/editors/draw.md` and the rest of
the guide corpus are intentionally deferred to the epic-level `/userdoc` pass.
