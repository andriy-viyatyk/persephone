# EPIC-109: Bundled boards and the Excalidraw board

## Status

**Status:** Active
**Created:** 2026-09-20
**Completed:** —

## Overview

Phase F of the [platform roadmap](../platform-roadmap.md), **split in two**. This epic introduces
*bundled boards* — boards that ship inside the installer, are registered because they are part of
the app, and are presented to the user as built-in editors rather than as installed boards — and
uses that mechanism to ship Excalidraw as a board.

The built-in `draw-view` editor **stays** for the whole of this epic. The board wins by priority;
the built-in remains behind it as a working fallback. Deleting `editors/draw`, dropping React and
`@excalidraw/*` from `package.json`, and closing the De-React programme's last exception are
**EPIC-110**, and only begin once this epic's board is proven against real `.excalidraw` files.

*(User decision, 2026-09-20: reprioritize Phase F ahead of Phase E, and split it. Phase F depends
on A, B and D — all shipped — and not on C, so taking it first violates no phase dependency.)*

## Goals

- A bundled board is discovered, registered and usable with **no trust dialog and no trust-file
  write**, because it shipped with the app.
- A bundled board appears under **Tools & Editors → Built-in**, never under **Registered boards**,
  and carries a **Disable** action there.
- Disabling a bundled board removes it completely — its creatable item, its file masks and its
  capability handlers — so another board claiming `image.edit` can take over.
- Excalidraw ships as a bundled board that opens every existing `.excalidraw` page and handles
  `image.edit` / `diagram.edit` for the image viewer, SVG, Mermaid and the snip tool.
- Nothing about the installer changes: `assets/` already ships outside the asar.

## Non-goals

- Removing `editors/draw`, React, or `@excalidraw/*` — **EPIC-110**.
- Explicit user-facing priority ordering between two live `image.edit` handlers. Roadmap §6 parks
  this; **Disable** covers the stated case. Deferred.
- A general "install a bundled board from the catalog and have it inherit the grant" story. A
  catalog copy of the same board id is an ordinary untrusted board and prompts normally (D2).
- The `DataHandle` store deferred from EPIC-108 D7. This epic **measures** the trigger (US-1488);
  crossing it is a separate task.

## Decisions

**D1 — Bundled boards live in `assets/boards/<id>/`, and the installer does not change.**

`electron-builder.yml:15-18` already copies the whole `assets/` tree to `resources/assets`,
**outside the asar**, and `getAssetPath()` (`src/main/utils.ts:28-36`) already resolves it in both
dev and packaged builds. `assets/demo-board/` and `assets/board-template/` are the precedent. A
top-level `boards/` folder beside the exe would need a new `extraFiles` entry and a new path
resolver and buys nothing.

**D2 — A bundled board is registered because it is part of the app. Nothing is copied, and the
trust file is never written.**

This supersedes two pieces of roadmap §6 / Phase F.2:

- *"First run copies the board into the install dir"* is **dropped as unworkable.** The install
  directory is not writable at runtime without elevation.
- *"trusted at install-time identity with their hash recorded"* is **dropped as unnecessary.** The
  hash record existed only to protect a copy that could drift from the installer. With no copy,
  the bytes cannot diverge without replacing the application itself.

Seeding the resources path into `trustedBoards.txt` was also considered and rejected: the path is
install-location dependent, so an upgrade or a reinstall elsewhere would leave a dangling entry and
an unregistered board.

The provenance argument is the existing one, one step further: `board-scaffold.ts:69-72` already
auto-trusts a board Persephone *created*. Bytes inside the signed installer have at least that
provenance.

**Trust attaches to the location, not to the board id.** A catalog-installed board with the same id
lands in a user folder and prompts normally.

**D3 — Bundled boards are presented as a kind of built-in editor, not as a board.**

*(User decision, 2026-09-20.)* Two facts make this nearly free:

- **Tools & Editors → Built-in** is a list of *creatable items* (`getCreatableItems()`,
  `ui/sidebar/tools-editors-registry.ts:190-202`), and `draw-view` is already one of them
  (`:94-99`), already in `DEFAULT_PINNED_EDITORS` (`:35-37`). The bundled board takes over that row
  and the user sees the same "Drawing" entry, with the same icon, in the same place, still
  pinnable.
- **Tools & Editors → Boards** is driven directly by `boardTrust.listPaths()`
  (`ui/sidebar/TrustedBoardsListView.ts:231,246`). Because D2 does not write the trust file, a
  bundled board never appears there. No filtering code is required.

A separate in-code registry for bundled boards is required regardless, because
`custom-editor-registry.refresh()` (`editors/board/custom-editor-registry.ts:216-280`) enumerates
the trust list and bundled roots must enter it as their own source.

**D4 — Disable is one settings flag, read in two places.**

The Built-in tab governs creatable items only; it is **not** the registration path. A toggle wired
there alone would hide the row while the board kept opening every `.excalidraw` file. The flag must
gate both `getCreatableItems()` and the bundled source feeding `custom-editor-registry.refresh()`.
Registration already re-runs reactively, so a disable takes effect without a restart.

**D5 — Bundled boards keep a real filesystem root in their editor id; staleness is repaired at
restore.**

Board editor ids are `board-editor:<absolute board root>` (`custom-editor-registry.ts:54,268`) and
**25 call sites outside that file parse the root back out**. Registering a bundled board under a
synthetic id, or under the literal `draw-view`, would mean special-casing all of them — rejected.

But a bundled board's root is inside the install directory, so it **differs between dev and
packaged builds and changes if the user reinstalls elsewhere**, which would orphan every persisted
`.excalidraw` page. This project has hit this class before: EPIC-107 D1 kept provider types verbatim
precisely because deriving them from the board root would orphan persisted state.

So: keep the real path as the root, and re-alias a stale bundled root to the current one by the
stable folder id.

> **Corrected by US-1484, 2026-09-20.** This decision originally named
> `api/pages/PagesLifecycleModel.ts:137` as "the restore seam", and "one place". Both were wrong.
> That line is the *runtime construction* branch; the real session restore runs through
> `PagesPersistenceModel.restorePage()`, and `BoardEditorModel.getRestoreData()` deliberately
> persists the **stable** `board-view` id while stashing `boardRoot` in editor state. So the alias
> applies to the descriptor's `boardRoot`, not only to an editor id, and US-1484's audit found
> twelve persistence sites in total — including board vars, which fall back to the absolute root
> when a manifest lacks `author` + `name`.
>
> The alias also needs a **staleness test**, not just a shape match: it fires only when the
> persisted root no longer holds a readable manifest. Keying on basename plus a `boards` parent
> alone would let a user board at `<any>/boards/<name>` be silently re-pointed at the app-shipped
> board of the same name — which is permitted without being user-trusted.

Board storage has the same path dependence — keyed `sha256(normalized root)`
(`main/board-storage.ts:15-18`) — and takes the same fix: bundled boards key on the stable folder
id, domain-separated as `bundled:<id>`, while every non-bundled root keeps its existing hash.

**D6 — Disabling with no replacement installed falls back to the built-in. The `no-handler`
message moves to EPIC-110.**

> **Amended 2026-09-20, during US-1485.** As first written this decision was unreachable, and the
> investigation caught it. `draw-view` registers `image.edit` and `diagram.edit`
> (`register-editors.ts:173`) and **this epic deliberately keeps that handler registered** — the
> built-in is the coexistence fallback, so gating or removing it would defeat the epic's purpose.
> Disabling the bundled board therefore falls back to the built-in drawing editor, and *"no image
> editor is registered"* is **not a state a user can reach in EPIC-109**.
>
> The message is deferred to **EPIC-110**, where removing the built-in makes it both reachable and
> necessary. Shipping it here would be untested code for an unreachable state. The original
> reasoning is kept below because it still applies in EPIC-110.

`image.edit` and `diagram.edit` are registered from `editors/draw` today (`api/capabilities.ts:109`,
`register-editors.ts:173`) and are consumed by the image viewer, SVG, Mermaid and the snip tool.
Disabling the bundled board with nothing else registered leaves those intents unhandled. EPIC-108's
bus already types this rejection; this epic only has to make the user-facing message read as *"no
image editor is registered"* rather than as a failure. The intended flow — install a replacement,
then disable — is unaffected.

**D7 — The board must declare `editorPriority: 60`, not the roadmap's 50.**

Roadmap §4 Phase F.3 specifies `editorPriority: 50`. That is **wrong for a coexistence epic**: the
built-in `draw-view` accepts `.excalidraw` at priority 50 (`editors/base/editor-matchers.ts:136`)
and `custom-editor-registry.ts:495` resolves with a strict `>` so that built-ins win exact ties. A
board at 50 would lose to the editor it is replacing. 50 becomes correct again only in EPIC-110,
once the built-in row is gone.

**D8 — EPIC-106's D1 (`permissions` as disclosure, not a security boundary) is parked a fourth
time, deliberately, and this epic explains why that is now safe.**

EPIC-108's hand-back flagged Phase F as the deadline for this question, on the grounds that it is
the first phase whose board ships inside the installer and therefore meets the bundled-board trust
decision of roadmap §6. D2 dissolves that collision: a bundled board shows **no trust dialog at
all**, so `permissions`-as-disclosure has nothing to disclose to. The question stays open for
catalog-installed boards and is untouched here — no code in this epic extends or entrenches it.

**D9 — The board's `lib/` is generated once by hand and committed. No Persephone build rebuilds
it.**

*(User decision, 2026-09-20, correcting this epic's original "build pipeline" framing.)* The board's
`lib/` is a pure function of the pinned `@excalidraw/excalidraw` version, so regenerating it on every
`npm run dist` buys nothing and makes each Persephone build depend on a bundler run that can fail.
`scripts/build-board-lib.mjs` is therefore invoked manually — when the Excalidraw version is bumped
and at no other time — and `assets/boards/excalidraw/lib/` is committed. The board stays what every
other board is: a plain folder that is copied, not built.

The same decision fixes what is committed. Shipping the package's assets wholesale would add 14 MB
of fonts and 1.8 MB of locales, and **13 MB of that is the Xiaolai family alone** — Chinese
handwriting, which the other eight families do not need:

| Committed | Size |
|---|---|
| Excalidraw vendor graph, verbatim | ~2.9 MB |
| Fonts — 8 families, Xiaolai excluded | ~500 KB |
| English locale (`en-*.js`) | 4 KB |
| Bundled externals, excluding mermaid | ~600 KB |
| `@excalidraw/mermaid-to-excalidraw` | **3.4 MB** |
| **Total** | **7.3 MB** |

**Amended during US-1486, after measurement.** The estimate above was ~3.8 MB, which held for
everything except one dependency. The board needs **33** bare specifiers, not the 15 visible in
`index.js` — the rest live in the chunks and four more are reached only through lazy `import()`.
One of those four, `@excalidraw/mermaid-to-excalidraw`, bundles mermaid and is 3.4 MB on its own.

It is kept. Excalidraw's Mermaid-to-diagram conversion is a feature of the editor this epic
replaces, `@excalidraw/mermaid-to-excalidraw` is already a dependency of the current `editors/draw`,
and dropping it would ship a regression rather than a like-for-like replacement. It loads only when
the user actually converts a diagram, so it costs repository and installer size, not startup.
Excluding it would return the board to ~3.9 MB and is the one lever available if that size ever
becomes a problem.

Xiaolai and the other 54 locales are excluded deliberately. A user wanting Chinese handwriting loses
that one font family; everything else renders identically. The exclusion is recorded here so a
future version bump does not silently re-add 13 MB to the repository.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1483 | Bundled board registry and discovery | Planned |
| US-1484 | Stable identity for bundled boards across install paths | Planned |
| US-1485 | Built-in tab presentation and the Disable action | Planned |
| US-1486 | The board's prebuilt `lib/`, generated once and committed | Planned |
| US-1487 | The Excalidraw board | Planned |
| US-1488 | Capability routing into the board, and the payload measurement | Planned |

### US-1483 — Bundled board registry and discovery

A `bundled-boards` module that enumerates `getAssetPath("boards")`, reads each
`board-manifest.json`, and exposes the results as a distinct source with `origin: "bundled"`. A real
directory scan, but of one small app-owned folder — the "no subtree discovery" rule
(`custom-editor-registry.ts:12-14`) protects user folders and does not apply. Feeds
`custom-editor-registry.refresh()` alongside `boardTrust.listPaths()`. Must **not** enter
`mergeBoardSources()` (`api/boards.ts:150-186`), which is what the Boards tab reads.

### US-1484 — Stable identity for bundled boards across install paths

D5. The restore alias at `PagesLifecycleModel.ts:137`, and board storage keyed on manifest id.
Verified by moving a board root and confirming an existing page restores and keeps its stored state.

### US-1485 — Built-in tab presentation and the Disable action

D3, D4 and D6. A bundled board contributes a `CreatableItem`; the Disable action on that row; the
settings flag read in both places; the `no-handler` message.

### US-1486 — The board's prebuilt `lib/`, generated once and committed

Roadmap Phase F.1. `@excalidraw/excalidraw@0.18.1` **already ships a prebuilt browser ESM bundle**
(`dist/prod/index.js`, 2.7 MB) — nothing in this epic recompiles Excalidraw itself. What that bundle
does not carry is its fifteen bare externals (`react`, `react-dom`, `react/jsx-runtime`, `jotai`,
`jotai-scope`, `clsx`, `nanoid`, `roughjs/bin/rough`, `@radix-ui/react-popover`,
`@radix-ui/react-tabs`, `fuzzy`, `lodash.debounce`, `lodash.throttle`, `open-color`, `tunnel-rat`),
and React 19's npm package is **CJS only** — `node_modules/react/` holds `index.js` plus `cjs/`,
with no ESM and no UMD build. So no import map can resolve them from a plain board page, and one
bundler pass is unavoidable. esbuild is already a devDependency.

Per **D9** that pass is a standalone script, run by hand, with its output committed; it is not
referenced by `build-prod`, `dist`, or anything a Persephone build runs. Fonts ship inside the board
rather than through `app-asset://`.

### US-1487 — The Excalidraw board

`editorKind: "content-host"`, `fileMasks: ["*.excalidraw"]`, `editorPriority: 60` (D7),
`capabilities: [image.edit, diagram.edit]`. The exposed `aiVision` model re-provides the
`DrawEditorFacade` surface — `addImage`, `exportAsSvg`, `exportAsPng`
(`scripting/api-wrapper/DrawEditorFacade.ts:54,101,110`). Undo stays inside Excalidraw.

### US-1488 — Capability routing and the payload measurement

Toolbar export and the screen-snip integration become `image.edit` intents into the board; the image
viewer, SVG and Mermaid handoffs resolve to it by priority. Measures structured-clone size and p95
clone cost on the Phase D inline path against EPIC-108 D7's documented threshold, and records the
result — crossing it is the trigger for the deferred data-handle protocol, as its own task, not
here.

## Exit criteria

1. A fresh install with **no network** opens a `.excalidraw` file in the bundled board.
2. The board appears under **Built-in**, with a Disable action, and **not** under Registered boards;
   no trust dialog is ever shown for it; `trustedBoards.txt` is unchanged.
3. Every existing `.excalidraw` page restores into the board, including after the board root path
   changes (D5).
4. `image.edit` from the image viewer, SVG, Mermaid and the snip tool lands in the board.
5. Disabling it removes the creatable item, the file-mask claim and both capability handlers;
   re-enabling restores all three without a restart.
6. With it disabled, an `image.edit` intent falls back to the still-registered built-in drawing
   editor. *(Amended — see D6. The "no image editor is registered" message belongs to EPIC-110,
   because the built-in handler deliberately remains registered throughout this epic.)*
7. `editors/draw` is still present and still works if the board is disabled.
8. The payload measurement from US-1488 is recorded against EPIC-108 D7's threshold.

## Notes

### 2026-09-20

- Epic created. Scope agreed with the user in discussion: bundled boards as a kind of built-in
  editor, `assets/boards/`, no trust-file write, disable on the Built-in page, separate in-code
  registry.
- Two roadmap corrections found while verifying, both recorded as decisions: Phase F.2's "first run
  copies the board into the install dir" is unworkable (D2), and Phase F.3's `editorPriority: 50`
  would lose to the built-in it replaces (D7).
- Phase F split into this epic and EPIC-110 (React removal) at the user's agreement, so the built-in
  remains a fallback until the board is proven on real files.
