# EPIC-109: Bundled boards and the Excalidraw board

## Status

**Status:** Completed
**Created:** 2026-09-20
**Completed:** 2026-09-23

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

**D10 — Browser-navigation return URLs are a general board platform feature, and Persephone mints
them. A board never supplies a pattern.**

*(User decision, 2026-09-20, rejecting an Excalidraw-specific implementation.)* Excalidraw's library
browser hands a third-party site a return URL and expects the user to be sent back to it. The
built-in editor solves this privately: `ExcalidrawIsland.tsx:21` invents the sentinel
`https://jsnotepad.excalidraw-library/`, and `DrawBodyView.ts:256-284` subscribes to
`browserUrlChanged` and claims any navigation starting with it. The board has no such mechanism, so
Excalidraw falls back to `window.location` and the library site navigates the browser to
`board://<host>/index.html#addLibrary=...`, which Windows offers to the shell — *"Get an app to open
this 'board' link"*.

A partial seam exists, but **it is weaker than it looks, and US-1489's investigation corrected an
earlier draft of this decision that overstated it.** `BrowserUrlEvent` (`core/state/events.ts:39-46`)
carries a `handled` flag, and `editors/draw` both sets it and honors it (`DrawBodyView.ts:258`). But
`browserUrlChanged` is a plain `Subscription`, not an `EventChannel` — the `handled` short-circuit
lives in `EventChannel.send` (`api/events/EventChannel.ts:71`) and has no equivalent here. Neither
publish site reads the flag back: `BrowserWebviewModel.ts:222` fires *after* the navigation has
committed and the tab's URL, history and URL bar are already updated, and `:286` fires *after*
`addTab()` has created a whole new tab for a `new-window`.

So `handled` is a convention between subscribers, not a way to cancel or rewind a navigation. A
claim therefore cannot prevent the browser from going somewhere — it can only react once it has.
Any design that assumes the navigation can be intercepted before it commits is wrong, and the
service must instead deal with the tab that already exists. `editors/draw` today only calls
`pagesModel.showPage(hostId)`, which refocuses the drawing and leaves the library tab stranded on
the sentinel URL; the general service is expected to do better than that, and US-1489 owns deciding
what "better" is.

**Persephone mints the URL; the board asks for one and never describes what to match.** This is the
load-bearing half of the decision. A board that could register its own pattern could claim
`https://github.com/login` and silently swallow a real navigation — a phishing primitive, and one
that would be very hard to withdraw once boards depended on it. Minting removes the possibility
rather than policing it. The minted form is
`https://<nonce>.board-return.persephone.invalid/`: `.invalid` is reserved by RFC 2606 and can never
resolve to a real site, and the nonce scopes the claim to one board instance.

`editors/draw` is migrated onto the same service and `LIBRARY_RETURN_URL` deleted. That is not
tidying — it is the test of whether the feature is general. If the built-in cannot be expressed
through it, it is still Excalidraw-shaped.

**No new network capability is introduced.** An earlier sketch had the renderer fetch the library on
the board's behalf, because the board CSP is `connect-src 'self'`. That was unnecessary: boards
already have `persephone.executeNode()` — Persephone's bundled Node runtime, no install required —
plus `readFile`/`writeFile` (`board-shim.ts:1184-1197,1314-1329`). The board fetches and stores the
library itself. This matters beyond convenience: a general "fetch this URL for me" primitive would
have been board-initiated network egress, which collides directly with the EPIC-106 D1 question that
**D8 parks for the fourth time**. Using the capabilities boards already have keeps D1 parked
honestly.

**D11 — Parity before removal. EPIC-110 does not begin until the board matches the built-in.**

*(User decision, 2026-09-20: "I want in-board excalidraw to be identical to in-persephone one before
removing persephone code" — clarified the same day as **identical from the user's perspective**, so
that anything the user can do with the built-in editor they can also do in the board.)*

Parity is therefore **behavioural, not structural**. The two are different implementations by
design — one a React island holding a direct API reference, the other a board page across a bridge —
and nothing requires their internals, their facades or their file layouts to converge. What must
match is the set of things a user can do. A difference the user cannot observe is not a gap; a
menu entry that is present but does nothing is.

This epic's original framing kept `editors/draw` as a fallback; D11
makes the stronger commitment that the built-in is not removed until nothing is lost by removing it.
Two gaps are already known and are tracked here as US-1489 and US-1490, and one — user-visible
configuration of the library path — cannot be closed inside this epic at all, because Persephone has
no concept of board settings. That becomes **EPIC-111**, and it is therefore a prerequisite of
EPIC-110 rather than an improvement that can follow it.

Parity runs in both directions, and the board currently offers **more** than the built-in in a way
that is a defect rather than a bonus. `ExcalidrawIsland.tsx:22-30` deliberately disables four canvas
actions — `loadScene`, `saveToActiveFile`, `export` and `toggleTheme` — because in Persephone the
host owns the file and the app owns the theme. The board passes no `UIOptions`, so all four are
live: "Open" would replace the scene behind the host's back, "Save to disk" would start a browser
download, and `toggleTheme` now fights the Persephone theme the board follows as of US-1487. These
are user-visible differences and belong to the audit.

So D11 requires an explicit **parity audit** against the built-in's user-facing surface, not an
impression that the board "works". US-1490 carries it, and the known entries are: library browse and
add, the library path being configurable, the four suppressed canvas actions, and the scripting
surface (`addImage`, `exportAsSvg`, `exportAsPng`, `elementCount`) already matched in US-1487.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1483 | Bundled board registry and discovery | Planned |
| US-1484 | Stable identity for bundled boards across install paths | Planned |
| US-1485 | Built-in tab presentation and the Disable action | Planned |
| US-1486 | The board's prebuilt `lib/`, generated once and committed | Planned |
| [US-1487](../tasks/US-1487-excalidraw-board/README.md) | The Excalidraw board | Planned |
| [US-1488](../tasks/US-1488-excalidraw-capability-routing/README.md) | Capability routing into the board, and the payload measurement | Planned |
| [US-1489](../tasks/US-1489-board-navigation-return/README.md) | Board navigation return URLs | Planned |
| [US-1490](../tasks/US-1490-excalidraw-library/README.md) | The Excalidraw board's library flow | Planned |

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

**The manifest declaration belongs to this task, not to US-1487.** US-1487 shipped
`image.edit`/`diagram.edit` at priority 60 in `board-manifest.json` before any handler existed;
resolution honoured it at once and the board shadowed `draw-view`, so the image viewer's Edit
button opened a board that ignored the intent (fixed by removing the declarations). Restore them
here, in the same change as `persephone.intent.onRequest`.

### US-1489 — Board navigation return URLs

D10. A board-facing service that mints a unique return URL, claims any browser navigation matching
it through the existing `BrowserUrlEvent.handled` flag, returns focus to the host page, and delivers
the URL and its parsed parameters to the owning board frame. `editors/draw` migrates onto it and
`LIBRARY_RETURN_URL` is deleted, which is what proves the feature is general rather than
Excalidraw-shaped. Boards never supply a match pattern.

### US-1490 — The Excalidraw board's library flow

The board passes the minted URL as Excalidraw's `libraryReturnUrl`, receives the `addLibrary`
callback, fetches the `.excalidrawlib` with `persephone.executeNode()` and stores it with
`writeFile`, then feeds it to `updateLibrary()`. Library persistence must **adopt the existing
library** rather than start empty: `drawing.library-path` already holds what the user has collected
(`drawLibrary.ts:12-19` defaults it to `<userData>/data/excalidraw-lib`). Until EPIC-111 exists the
path is not user-configurable from the board, which is acceptable only because the location is
unchanged — the data does not move when the setting later appears.

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
9. **Parity (D11).** Browsing and adding an Excalidraw library works in the board, using a minted
   return URL that no board pattern-matched for, and the user's existing library is still there.
   `editors/draw` uses the same navigation service, with `LIBRARY_RETURN_URL` gone.

## Notes

### 2026-09-23 — epic close

**Exit criteria verified.** All nine were checked against the running app or against source before
close. Criterion 2 was confirmed by reading `trustedBoards.txt` directly: 27 entries, none under
`assetsoards`, so the bundled board is registered by provenance and the trust file is untouched
exactly as D2 requires. Criterion 5 was exercised in both directions — disabling dropped both
capability handlers and released the file-mask claim, and a reopened `.excalidraw` went to
`draw-view`; re-enabling restored all three with no restart. D4's "one flag read in two places"
holds literally: `custom-editor-registry.ts:251` and `tools-editors-registry.ts:213`, and nowhere
else.

**D3 did not survive implementation, and the epic closes with it corrected rather than met.**
D3 says the bundled board "takes over that row and the user sees the same 'Drawing' entry, with the
same icon, in the same place, still pinnable." It does not. The board contributes its own row
labelled from its manifest `name` — "Excalidraw" — while the built-in keeps its own "Drawing" row,
which is additionally pinned by default (`DEFAULT_PINNED_EDITORS` includes `draw-view`). The user
therefore sees **two** entries in Tools & Editors → Built-in, not one.

That is not a defect *in this epic*, because EPIC-109 deliberately keeps `draw-view` registered and
working as the coexistence fallback (D6 as amended) — two entries is the honest presentation of two
live editors. But D3's prediction was about the user-visible result, and it was wrong. The
single-entry outcome D3 describes becomes available only in **EPIC-110**, when the built-in row is
deleted and the board can take the pinned slot. EPIC-110 should treat "the board inherits
`draw-view`'s pin and label position" as explicit work rather than assuming D3 already delivered it.

**A defect found by `/review` at close, and fixed here: Disable was a one-way door.**
`disableBundledBoard()` and a "Disable" context menu shipped, but there was no `enableBundledBoard`
and no Enable affordance anywhere — and because `getCreatableItems()` filters disabled boards out by
contract (D4), the row vanished along with the only place the action lived. A user who disabled the
bundled board could only restore it by hand-editing `settings.json`, which makes exit criterion 5's
"re-enabling restores all three" untrue through the UI even though it was true of the mechanism.

Fixed without weakening D4: `getCreatableItems()` still excludes disabled boards, and a separate
`getDisabledBundledBoardItems()` contributes inert rows that carry only Enable. Those rows are
dimmed, not creatable, not pinnable, not draggable, and a click on one does nothing and does not
close the popover — closing on a click that did nothing reads as the action having been taken.
Verified through the real UI path: right-click on the dimmed row, click Enable, both capability
handlers and the file-mask claim return.

**A second defect, found by the cold-start test and fixed here: the board's `lib/` silently
disabled dependency pre-bundling for the whole app.**

US-1486 committed `assets/boards/excalidraw/lib/`, whose files carry 33 bare specifiers resolved at
runtime by the board page's own `<script type="importmap">`. Vite's **dependency scanner** crawls
the project root rather than the renderer's module graph, so it reached those files, found
`clsx` and `@radix-ui/react-tabs` unresolvable — it has no import map — and aborted:

```
(!) Failed to run dependency scan. Skipping dependency pre-bundling.
```

The damage is wider than the message suggests: pre-bundling is skipped for **every** dependency in
the application, not only the board's. It reproduces only on a cold start, because a populated
`node_modules/.vite/deps` hides it — which is why it survived US-1486's review and this epic's
per-task verification, and why it was found only by deleting the cache and running `npm start` for
real. The existing `**/assets/boards/*/lib/**` watch-ignore does not help: that governs chokidar,
not the scanner.

Fixed in `vite.renderer.config.ts` by scoping the scan to the real entry —
`optimizeDeps.entries: ["index.html"]` — which is what the renderer actually loads. Verified by
clearing `node_modules/.vite` and cold-starting twice: before, zero dependencies pre-bundled and
the scan error present; after, **627** pre-bundled, no error, and the board still opens a
`.excalidraw` file and reports 25 elements through its frame.

**Material lifted out of the task folders, so it survives their deletion.**

*US-1488's payload measurement, against EPIC-108 D7.* The trigger for the deferred `DataHandle`
store is a single `image.edit` payload above the 8 MiB inline cap in ordinary use, or a clone cost
above ~50 ms at p95. Measured in the live renderer over 100 `structuredClone` calls per case after
10 warm-ups, on Chromium 150 / Windows: the largest p95 was **6.1 ms**, an order of magnitude below
the trigger. A 1920×1080 PNG came to 7,801,462 bytes, under the cap; JPEG cases stayed under it
through 2560×1440. The only case above the cap was a deliberately maximum-entropy 3840×2160
synthetic JPEG at 9,077,514 bytes, which is a worst case rather than ordinary-use evidence. **No
threshold was crossed, so the handle store remains deferred** — and the numbers suggest the cap is
sized about right rather than that the store should be built now.

*US-1489's same-tab return gap, recorded and deliberately not fixed.* A minted return URL is
`https://<nonce>.board-return.persephone.invalid/`, and `.invalid` is unresolvable by construction.
So a **same-tab** navigation to it dies at `ERR_NAME_NOT_RESOLVED (-105)` before `did-navigate`
fires; `browser-service.ts` relays nothing and `browserUrlChanged` is never published. The path that
works is `window.open` — Excalidraw asks for `?target=_blank`, and the `new-window` publish site does
not wait for a navigation to complete, which is also why the pre-US-1489 built-in flow worked with
its equally unresolvable sentinel. **Consequence: a board whose third-party site returns in the same
tab is not heard and strands that tab on a Chromium error page.** Fixing it needs `did-fail-load`
relayed from `src/main/browser-service.ts`, which is a D10 design question rather than an
implementation detail. Both board guides tell authors to open the return URL in a new tab.
`restoreClaimedNavigation()` is kept and is currently unreachable for minted URLs — it is correct
for the event it handles and is the only thing that would prevent a stranded tab if a same-tab
return ever became observable.

### 2026-09-20

- Epic created. Scope agreed with the user in discussion: bundled boards as a kind of built-in
  editor, `assets/boards/`, no trust-file write, disable on the Built-in page, separate in-code
  registry.
- Two roadmap corrections found while verifying, both recorded as decisions: Phase F.2's "first run
  copies the board into the install dir" is unworkable (D2), and Phase F.3's `editorPriority: 50`
  would lose to the built-in it replaces (D7).
- Phase F split into this epic and EPIC-110 (React removal) at the user's agreement, so the built-in
  remains a fallback until the board is proven on real files.
