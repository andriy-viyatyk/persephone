# EPIC-112: Board toolbar controls

## Status

**Status:** Complete
**Created:** 2026-09-21
**Completed:** 2026-09-21

## Overview

A board can render anything it likes *inside its own frame*, and nothing at all outside it. The page
toolbar is Persephone chrome: `BoardToolbarView` ([`BoardToolbar.ts:72`](../../src/renderer/editors/board/BoardToolbar.ts#L72))
owns the board switcher, board info, trust and update affordances, and a board has no way to put
anything beside them. So a board whose feature belongs on a toolbar — an export, a mode switch, a
filter — either hides it inside its own canvas, where it competes with the board's content and looks
nothing like the rest of the app, or does without.

This epic lets a board **declare** toolbar controls and have Persephone render them in its page
toolbar, delivering an event to the board when the user operates one.

*(User decision, 2026-09-21: "persephone should provide to board posibility to define toolbar items
… Persephone may have designed set of controls … board can use that method to pass json array with
control descriptors, and on control action … persephone send some event to the board".)*

## Why now

EPIC-109 D11 commits the bundled Excalidraw board to matching the built-in Drawing editor **from the
user's perspective** before EPIC-110 deletes `editors/draw`. US-1490 closed the library gap and then
recorded one it could not close: the built-in's Persephone-owned toolbar has five controls — theme,
copy image, save SVG/PNG, open SVG/image, and screen snip
([`draw/index.ts:31-80`](../../src/renderer/editors/draw/index.ts#L31-L80)) — and the board has no
way to offer any of them. That gap was explicitly left for a follow-up so EPIC-110 could not mistake
the library fix for complete parity.

This epic is that follow-up, which makes it **a prerequisite of EPIC-110**, alongside
[EPIC-111](EPIC-111.md). Deleting `editors/draw` before it lands ships a user-visible regression.

## Why declarative descriptors are the right shape

Recorded because the alternative looks cheaper and is not.

- **The toolbar is outside the iframe.** A board cannot reach it without being handed DOM access to
  the shell, which would dissolve the frame boundary that the whole board model rests on.
- **It is already the house pattern.** `persephone.setSecondaryViews([...])`
  ([`board-shim.ts:1241`](../../src/board-shim.ts#L1241)) has exactly this shape: the board pushes a
  declarative array and Persephone renders it as app chrome.
- **Theming comes free and stays correct.** Persephone-rendered controls use the theme tokens and
  follow a theme change; board-authored markup would drift the moment either side changed.
- **Agent addressability, which is the decisive one.** The UI element contract requires addressable
  controls to carry `data-name` and surface through the editor's `elements` node, which is how an
  agent lists, highlights and clicks them. Controls Persephone renders can be registered there
  automatically. A toolbar a board drew inside its own frame could never be addressed that way, and
  this project's whole direction is toward the app being drivable by an agent.

## Goals

- A board declares toolbar controls as a JSON descriptor array (`set`), patches individual controls
  without resending the rest (`update`), and receives an event per interaction.
- Persephone renders them from a **fixed catalog** of control types, themed and `data-name`-addressable,
  registered in the board editor's `elements` node.
- The toolbar's text slot is board-settable, falling back to the board path when the board sets
  nothing; its legacy click-to-switch popover is removed.
- The five built-in Draw toolbar controls are reimplemented as board-declared items on the bundled
  Excalidraw board, closing the EPIC-109 D11 toolbar gap.

## Non-goals

- Board-authored markup or styling in Persephone chrome. Boards pick control types from the catalog;
  a board that needs a bespoke control builds it inside its own page. Custom **icons** are the one
  carved-out exception, with a defined and narrow mechanism — see D7.
- Menus, context menus, sidebars, status bar, or the window title. This epic is the page toolbar only.
- Replacing `setSecondaryViews`. Secondary views are panels; these are controls.

## Design decisions

### D1 — The catalog is derived from the Draw toolbar, not invented

The five built-in controls are the acceptance test, and running that exercise already corrects the
first guess at the catalog. Theme is a **toggle**; copy image and screen snip are **buttons**; but
save SVG/PNG and open SVG/image are **menus** — the built-in implements both with a `MenuHandle`
([`draw/index.ts:38-50`](../../src/renderer/editors/draw/index.ts#L38-L50)), not a value picker.

So "dropdown" is two distinct controls and must not be conflated:

| Control | What it is | Draw toolbar user |
|---|---|---|
| `button` | fires an action | copy image, screen snip |
| `toggle` | owns a boolean | theme |
| `menu` | a list of actions, one chosen | save SVG/PNG, open SVG/image |
| `select` | owns a value from a fixed list | *(none yet)* |
| `input` | owns free text | *(none yet)* |

`select` and `input` are in the catalog because the user asked for them and they are cheap beside
the others, but nothing in the migration exercises them — a task should treat them as less proven
and keep them minimal.

**Amended at epic close, 2026-09-21: theme ships as a `button`, not a `toggle`.** *(User decision,
after seeing the two toolbars side by side: "remove togle from theme button - it should just chagne
the icon on switch".)* The built-in draws theme as a bare icon button whose glyph swaps between sun
and moon; rendering it as a switch made the board toolbar visibly unlike the editor toolbar it was
supposed to match, which is the whole point of the migration. The board now owns the boolean and
patches its own icon and title through `update()` on each click. `toggle` stays in the catalog —
it is the right control for a board that wants a labelled switch — but the migration no longer
exercises it, which puts it in the same "less proven" bucket as `select` and `input` above.

The **widgets** in `PageToolbarView.ts`
([`SwitchWidgetView`](../../src/renderer/editors/base/PageToolbarView.ts#L229) and friends),
`IconButtonView`, `SelectView`, `InputView`, `SwitchView` and the `MenuHandle` machinery the Draw
toolbar uses already exist and are reused rather than reimplemented.

**Reuse the widgets, not the shell.** `BoardToolbarView` keeps its own composition; board controls
are a group added to it. Migrating the board toolbar onto the `PageToolbarView` shell is explicitly
out of scope — it would replace `board-toolbar-explorer` with the shell's `page-nav-panel`, and that
name is a published agent-facing address, declared in `BOARD_ELEMENTS`
([`BoardEditorFacade.ts:52`](../../src/renderer/scripting/api-wrapper/BoardEditorFacade.ts#L52)) and
documented in [`assets/guides/editors/board.md:35,94`](../../assets/guides/editors/board.md#L35).
Breaking a documented address is not a side effect this epic is entitled to.

### D2 — Values are uncontrolled; Persephone owns the live value

A control's value lives in Persephone, and the board is **notified** of changes. The board may push
a value explicitly for the rare case it must override one, but it is not required to echo every
change back for the control to update.

The alternative — the board owns the value and Persephone renders what it is told — round-trips
every keystroke through `postMessage` and will both feel laggy and fight the user's typing. The
Excalidraw board already carries an echo-suppression fingerprint for exactly this reason on scene
content ([`assets/boards/excalidraw/index.html`](../../assets/boards/excalidraw/index.html), the
`lastFingerprint` path), and a toolbar should not reproduce that problem for a text field.

Change events for `input` must be debounced. A task decides the interval; the built-in scene write
uses 500ms and is a reasonable starting reference.

### D3 — Two methods: `set` replaces, `update` patches

*(User decision, 2026-09-21.)* The board gets both:

- **`set(controls[])`** — the full array. It is the only call that defines which controls exist and
  in what order, and the only one that can add or remove.
- **`update(partial[])`** — one or more partial descriptors, each identified by `id`, patch-merged
  into the existing control. It cannot reorder, add, or remove.

`update` exists because the overwhelmingly common change is a field on one control — flipping
`disabled`, changing a label, updating a count — and resending a dozen descriptors to do that is
both wasteful over `postMessage` and needlessly destructive. Splitting the two also makes the
board's intent explicit, which is what lets Persephone guarantee that an `update` never disturbs a
control the user is interacting with.

Semantics a task must pin down:

- `update` patch-merges named fields only; omitted fields keep their current value.
- An `id` in `update` that does not exist is **ignored**, with a warning to the board's `ui.log`. It
  must not append — appending would let `update` change structure and destroy the guarantee above.
- `update` never changes order. Order is `set`'s alone.

### D3a — `set` must still diff by id and preserve interaction state

`update` reduces how often the destructive path runs; it does not remove it. A board legitimately
calls `set` when its control structure changes — entering a mode that adds a button — and the user
may be typing in a text control at that moment.

So `set` must reconcile by control `id` and preserve focus, caret position and scroll of a control
that survives the change, rather than tearing down and rebuilding the toolbar.

This is called out separately because of how the bug would present if it were skipped: with a
careful `update` and a naive `set`, focus loss stops happening on the common path and starts
happening only on structure changes — rarer, non-obvious, and correspondingly harder to find than
if `update` had never been added.

### D4 — The toolbar text slot is board-settable, with the board path as fallback

*(User decision, 2026-09-21: "board path is not mandatory design — it can be fallback if board do
not change it".)* Today the toolbar's wide middle slot always shows the board root
([`BoardToolbar.ts:76,181`](../../src/renderer/editors/board/BoardToolbar.ts#L76)). For most boards
that is the least interesting string available: a dashboard would rather show its data source, a
file-backed board the file it is editing, a viewer the document title.

The board sets it with a dedicated method, **not** through the control descriptor array — this slot
is one Persephone already owns and merely lets the board fill, which is a different thing from a
control the board adds. The shape is already established by `persephone.setStatusText()` (US-892,
[`board-shim.ts:1256`](../../src/board-shim.ts#L1256),
[`BoardEditorModel.ts:786`](../../src/renderer/editors/board/BoardEditorModel.ts#L786)): a transient
board-set string that Persephone renders in its own chrome, never persisted, re-set by the board on
load. Follow it exactly, including the transience — a stale label outliving the state it described
is the bug `statusText` already avoids by being cleared on reload.

Empty or unset reverts to the board path, so a board that does nothing looks exactly as it does now.

**Amended 2026-09-21, after US-1493 landed:** the method is `persephone.toolbar.setText(text)`, not a
top-level `persephone.setToolbarText()`. `setStatusText` is the precedent for the *semantics* —
transient, host-rendered, re-set by the board on load — not for where the method lives. US-1493
introduced a `toolbar` namespace holding `set`, `update`, and `onAction`
([`board-shim.ts:1298`](../../src/board-shim.ts#L1298)), and two APIs that write the same toolbar
belong together. `setStatusText` itself stays top-level: it targets the content-host footer, which is
a different surface.

### D4a — The path's click-to-switch popover is removed first

*(User decision, 2026-09-21: "lets plan to remove it. It is not so usefull, I am never use it, user
have Boards panel at the left side bar to switch between boards".)*

The slot is currently an interactive control rather than a label: clicking it opens a board switcher
popover when `explorerRoot` is set, with `hoverUnderline` advertising the affordance
([`BoardToolbar.ts:179,243`](../../src/renderer/editors/board/BoardToolbar.ts#L243)). Leaving it in
place would force an awkward compromise — either a board's override silently deletes a way to switch
boards, or a switcher stays bolted to text now reading `report-2026.csv`, where clicking a filename
opens a board list.

It is removed instead, and nothing is lost. The popover lists `getScopedBoards()`, which filters
`boardTrust.listPaths()` down to boards under the current `explorerRoot`
([`BoardToolbar.ts:278-284`](../../src/renderer/editors/board/BoardToolbar.ts#L278)). The sidebar
Boards list renders the **unfiltered** `boardTrust.listPaths()` through the same `BoardsTreeView`
([`TrustedBoardsListView.ts:246`](../../src/renderer/ui/sidebar/TrustedBoardsListView.ts#L246)), as
does the explorer's Boards panel. So the sidebar is a strict superset of the popover; the only
casualty is workspace-scoped filtering, a convenience and not a capability, and one the user reports
never using.

Removal also deletes a meaningful amount of `BoardToolbar.ts` — `BoardSwitcherContentView`,
`handlePathClick`, `popoverProps`, `closePopover`, `getScopedBoards`, the `open`/`canSwitch`/
`popover`/`switcherContent` state and the `PopoverView`/`BoardsTreeView` imports — which is the kind
of simplification this project prefers to accumulating a conditional.

`assets/guides/editors/board.md` documents the switch menu in two places (the "board toolbar switch
menu is open" layout, and a "Drawn controls without `elements`" entry) and both must go with it.

With the popover gone, the slot is a plain label and D4 is a string swap with a tooltip, not a
negotiation with an existing affordance. The full board path stays discoverable via that tooltip,
and the properties popover already exposes board identity.

### D5 — Board items are visually separated from Persephone's own

Board controls are grouped and separated from the app's own toolbar affordances. A trusted board is
user-approved, so this is not a security boundary; it is so a board control cannot be mistaken for
Persephone's own chrome, which matters as soon as a board can put a label of its choosing next to
the trust and update controls.

### D6 — No new trust gate is needed

An untrusted board never runs: `BoardEditorView` renders `UntrustedBoardView` instead of the frame
([`BoardEditorView.ts:234`](../../src/renderer/editors/board/BoardEditorView.ts#L234)), so its code
cannot call the API at all. Trusted and bundled boards are the only ones that can declare anything.
Recorded so a task does not spend effort building a gate that provenance already provides.

### D7 — Custom icons: named, inline SVG, or a file in the board folder

*(User question, 2026-09-21: "board may need some custom icon for the buttons. Can we accept raw
xml/svg from the board and draw it as icon?" and "board may have .svg files in its folder and
provide button icon as a path within board folder".)* Yes to both, but not raw.

**Source and rendering are separate choices.** A descriptor's `icon` names a source:

1. **`{ name }`** — an icon from Persephone's registry ([`theme/icons.ts`](../../src/renderer/theme/icons.ts)).
   Preferred: free theming, zero risk, visually identical to the rest of the app. The Draw migration
   uses only these.
2. **`{ svg }`** — inline SVG markup in the descriptor, for an icon the board generates or wants to
   change at runtime.
3. **`{ file }`** — a path relative to the board root, e.g. `icons/export.svg`. The natural authoring
   form: the board keeps its art as files beside its code, and this extends the convention boards
   already use for their own `icon.svg`
   ([`board-icon-cache.ts`](../../src/renderer/editors/board/board-icon-cache.ts)).

Rendering is then decided by what the source contains, not by which form supplied it:

- **SVG is read, sanitized, and inlined**, with `fill`/`stroke` forced to `currentColor`. This is the
  house convention — Persephone's own icons are inline SVG strings drawn in `currentColor` and
  colored by CSS — and it is why an `{ svg }` and an `{ file }` pointing at SVG behave identically.
  A board that hardcodes `fill="#000"` would otherwise be invisible in dark mode, which is the most
  likely real failure here by a wide margin.
- **Raster (`.png`, `.ico`) renders through `<img src={path}>`**, reusing the existing cache pattern.
  It cannot inherit `currentColor` and so will not follow the theme.
- **`preserveColors: true`** opts an SVG out of recolouring, keeping its own palette — for a
  multicolour logo that recolouring would ruin. The board takes on the theming consequence knowingly.

  *Amended during US-1493 review:* it opts out of the **recolouring only**. The markup is still
  parsed, allowlisted and inlined exactly as any other SVG. An earlier draft rendered it through an
  `<img>` data URL, which gave it different failure modes and different sizing than every other
  icon for no gain.

**Sanitizing inlined SVG.** Parse with `DOMParser` and rebuild the tree element by element against
an allowlist — never `innerHTML`, never a regex over markup. Allow the shape elements (`svg`, `g`,
`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`) with their geometry and stroke
attributes. Reject `script`, `style`, `foreignObject`, `image`, `use`, every `on*` handler, and any
`href`/`xlink:href` that is not a local fragment. Require a `viewBox`; cap the markup at a few KB.

*Amended at epic close, 2026-09-21.* An earlier draft of this list also promised `defs`, gradients,
`stop` and `title`. The shipped allowlist does not carry them, and the list above is the contract.
Gradients are not merely more elements: they need `id` on the gradient and a `url(#…)` reference to
it, and an inlined icon lives in the app's own document, where a second icon declaring the same id
would silently capture the first one's reference. Supporting them properly means namespacing every
id and rewriting every reference at sanitize time — real machinery for a case a board can already
serve by shipping a raster `{ file }`, which takes any palette and bypasses the sanitizer entirely.
An SVG icon is therefore a single-colour glyph that Persephone tints; multicolour art is a PNG.

**Confine `{ file }` to the board root.** Reject absolute paths, `..` traversal, and anything
resolving outside the board folder. Not because the board could not read those files itself — it has
`persephone.readFile` — but so that "Persephone resolves a path on the board's behalf" never quietly
becomes a way to pull arbitrary disk content into app chrome.

Icons need a cache keyed by **board root plus path**, invalidated on board reload. The existing
`board-icon-cache` holds one icon per board root and cannot be reused as-is.

**The sanitizer is not a security boundary, and must not be described as one.** A trusted board
already has `persephone.executeNode` (arbitrary Node) and `persephone.call` into the AiVision tree;
an untrusted board never runs at all (D6). A board intending harm has better routes than an icon.
What the allowlist buys is protection against *accidents* — a pasted SVG carrying a `<style>` block
that restyles the whole app, an `<image href="https://…">` that beacons on every render, a stray
handler — plus the theming normalization above. Recorded so a later reader does not mistake it for
the thing keeping boards contained; D6 and the trust gate are that.

## Resolved questions

The three questions this epic opened were resolved on 2026-09-21 without further user input, per the
standing pattern of recording the reasoning rather than blocking.

### Q1 — Toolbar space and overflow: cap, do not build an overflow menu

Board controls are capped (**8** is the proposed number, a task may adjust it with the rendered
toolbar in front of it). Declaring more than the cap renders the first N and warns the rest into the
board's `ui.log`, rather than silently dropping them.

No overflow menu on the first pass. The row already degrades sensibly: the text slot is
`flex, width: 0, overflow: hidden` ([`BoardToolbar.ts:75-77`](../../src/renderer/editors/board/BoardToolbar.ts#L75)),
so it absorbs the squeeze and truncates before any control is harmed. An overflow menu is a
meaningful amount of machinery for a pressure no board has yet applied, and D1's principle — drive
the catalog from boards that actually exist — applies equally here.

### Q2 — All five built-in Draw controls are board-reachable. Verified, not assumed

Each was traced to a concrete board-side equivalent before committing the migration:

| Built-in control | Built-in implementation | Board-side route |
|---|---|---|
| Theme | toggles the editor's own `darkMode` setting | board-local; the board already owns the `theme` prop it passes to Excalidraw |
| Copy image | `exportAsPngBlob` → `copyPngBlobToClipboard` ([`draw/index.ts:192-198`](../../src/renderer/editors/draw/index.ts#L192)) | `exportToBlob` (the board already calls it for `exportAsPng`) → `navigator.clipboard.write()`, permitted because the board iframe carries `allow="clipboard-read; clipboard-write"` ([`BoardWebview.ts:220`](../../src/renderer/editors/board/BoardWebview.ts#L220)) |
| Save SVG / PNG | `fs.showSaveDialog` + write | `persephone.saveFileDialog` + `persephone.writeFile`; PNG uses `encoding: "binary"` with a `Uint8Array` |
| Open SVG / image | ~~open dialog + read + insert~~ — **wrong, corrected below** | see the correction |
| Screen snip | `api.startScreenSnip(true)` ([`draw/index.ts:200-203`](../../src/renderer/editors/draw/index.ts#L200)) | `persephone.call("shell.startScreenSnip", { args: [true] })` — present in the AiVision tree ([`namespaces/shell.ts:5`](../../src/renderer/scripting/ai-vision/namespaces/shell.ts#L5)) — then the existing `insertImage` |

No control is display-only, so the migration in Goals is safe to commit to.

**Correction, 2026-09-21, found while writing US-1495.** The "Open SVG / image" row above was wrong.
The control is titled *Open in new tab* and does not read a file at all: "Open as SVG" exports the
current scene and hands it to `app.capabilities.invoke("content.view", …)`, and "Open as Image"
exports a PNG blob and calls `pagesModel.openImageInNewTab(blobUrl)`
([`draw/index.ts:269-300`](../../src/renderer/editors/draw/index.ts#L269)). It exports *out* of the
scene; it never imports into it. The board-side route is therefore
`persephone.capabilities.invoke("content.view", …)` and `persephone.openRawLink(dataUrl,
{ editor: "image-view" })` — not `openFileDialog`/`readFile`/`insertImage`, which would have built a
file importer the built-in never had.

The row was written from the control's name rather than its body, which is the failure mode Q2's own
heading warns against. The other four rows were re-verified against current source while correcting
this one and they hold.

### Q3 — EPIC-111 shares the value-type vocabulary, not the envelope

Board settings and toolbar controls align on the **types that bear a value** — `toggle`, `select`,
`input` — using the same type names, the same `id`/`label`/`options` field names, and the same value
semantics, so a board author learns them once.

They do not share a descriptor envelope, because the two differ in every other respect: settings are
declared in the manifest, persisted, and carry defaults; toolbar controls are declared at runtime,
transient, and include `button` and `menu`, which are actions and have no settings analogue. Forcing
one schema over both would mean a settings schema carrying action types it can never render.

EPIC-111 is still in planning, so this is recorded in both epics rather than imposed on one.

## Exit criteria

1. A board declaring toolbar controls gets them rendered in its page toolbar, with no Persephone
   code change for that board.
2. Interacting with a control delivers an event to the board identifying the control and its value.
3. Controls appear in the board editor's `elements` node with `data-name`, and an agent can list,
   highlight and operate them.
4. `update` patches a named control without disturbing the others, and calling `set` with a changed
   control structure while a text control has focus preserves that control's focus and caret.
5. Board controls follow the Persephone theme, including a live theme change. A control with an
   inline-SVG icon themes with them; an icon carrying script, external references or a `<style>`
   block is rejected or stripped rather than rendered.
6. A board that sets toolbar text sees it in place of the board path; a board that sets none still
   sees the path; the full path stays discoverable when overridden.
7. The toolbar path's click-to-switch popover is gone, along with its now-dead code and its two
   entries in `assets/guides/editors/board.md`. Board switching is unaffected: the sidebar Boards
   list already offers a superset of what the popover listed.
8. The bundled Excalidraw board offers theme, copy image, save SVG/PNG, open SVG/image and screen
   snip as declared controls, and each performs what the built-in's equivalent performs.
9. The EPIC-109 D11 toolbar gap is recorded as closed, unblocking EPIC-110 on this axis.

## Tasks

| Task | Title | Depends on | Status |
|---|---|---|---|
| US-1492 | [Remove the board toolbar's click-to-switch popover](../tasks/US-1492-board-toolbar-remove-switcher/README.md) | — | Complete |
| US-1493 | [Board toolbar control descriptors and the control catalog](../tasks/US-1493-board-toolbar-controls/README.md) | — | Complete |
| US-1494 | [Board-settable toolbar text, with the board path as fallback](../tasks/US-1494-board-toolbar-text/README.md) | US-1492 | Complete |
| US-1495 | [Migrate the Draw toolbar's five controls onto the Excalidraw board](../tasks/US-1495-excalidraw-board-toolbar/README.md) | US-1493 | Complete |

US-1492 and US-1493 are independent and can run in parallel; both touch `BoardToolbar.ts`, so
whichever lands second rebases onto the first. US-1495 is the epic's proof: it is what closes the
EPIC-109 D11 gap, and it is deliberately last so the catalog is exercised by a real consumer rather
than declared complete.

## Notes

### 2026-09-21

- Epic created from a user proposal. The descriptor design was the user's; this document records why
  it is right (frame boundary, existing `setSecondaryViews` precedent, theming, agent
  addressability) rather than only that it was chosen.
- Scope includes migrating the Draw toolbar's five controls (user decision, 2026-09-21), because the
  migration is what closes the D11 gap and it forces the catalog to be complete rather than
  plausible.
- D1's split of "dropdown" into `menu` and `select` came from checking the built-in against the
  proposed catalog: the built-in's two dropdown-looking controls are action menus, not value pickers.
- D3's `set`/`update` split was the user's, proposed on reading the first draft's single-array
  design. Accepted, with D3a recording why it narrows the focus-preservation problem rather than
  removing it.
- D4 (board-settable toolbar text, path as fallback) was the user's, proposed 2026-09-21. Checking
  the code found the slot is a switcher trigger rather than a label, which is what turned a one-line
  change into a decision with a constraint attached.
- D7 (custom icons) answers a user question raised after the first draft, which had ruled icons out
  as board-authored markup. Narrowed rather than refused: named registry icons preferred, inline SVG
  sanitized and forced to `currentColor`, board files through the existing `<img>` cache. The
  sanitizer is explicitly recorded as an accident-prevention and theming measure, not a containment
  boundary, since a trusted board already holds `executeNode`.
- D4a resolves that constraint by deleting the affordance rather than working around it (user
  decision, same day). Verified before agreeing: the sidebar Boards list renders the unfiltered
  trusted-board set through the same tree component, so the popover's scoped list is a subset and
  nothing becomes unreachable.
