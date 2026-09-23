# EPIC-111: Board settings

## Status

**Status:** Active
**Created:** 2026-09-20
**Completed:** —

## Overview

Boards can persist state, but the user cannot see or change any of it. `persephone.storage`
(`board-shim.ts:1284-1287`) is a private key/value store keyed on the board root, and nothing in
`board-manifest.json` declares user-facing configuration — `board-manifest.ts` has no settings
concept at all. So a board that needs a choice from the user has three bad options: hardcode it,
hide it in storage where it cannot be changed, or ask for it in its own UI, inconsistently with
every other board and with Persephone itself.

This epic gives a board a way to **declare** settings in its manifest and have Persephone render
them in its own Settings page, storing the values in the board's existing scoped storage.

It also **redesigns the Settings page itself**, because the page as it stands has nowhere to put
them. *(User decision, 2026-09-23 — see "The Settings page redesign" below.)* Today `SettingsView`
is one 560-pixel column holding fifteen sections separated by dividers
(`editors/settings/SettingsView.ts:55-100`), with no grouping and no navigation. Appending a
per-board section to the bottom of that column would bury board settings under fifteen unrelated
ones and make the page longer without making it navigable. The two halves of this epic are
therefore one piece of work: the redesign creates the structure, and board settings are its first
new occupant.

*(User decision, 2026-09-20, raised while planning the Excalidraw board's library flow: "probably
excalidraw library path should be moved to board settings, and we do not have any boards settings
for now".)*

## Why now

**Persephone should know nothing about an Excalidraw library path.** Excalidraw is a board like any
other — it merely ships in the installer — and its library folder is that board's setting, not the
application's. Today `drawing.library-path` is a first-class app setting with its own key, default,
Settings row and AI-vision catalog entry, and the bundled board reaches back into Persephone to read
it. That is the wrong direction of dependency, and it is the concrete case that board settings exist
to fix. *(User decision, 2026-09-23.)*

An earlier version of this section argued instead that EPIC-110 would **orphan** the setting by
deleting `editors/draw`. Pre-investigation disproved that (Concern 1): every surviving reader lives
outside `editors/draw`, and the board already reads the key through `persephone.call`. The setting
would keep working untouched. The argument was wrong; the goal was not.

So this epic is a prerequisite of EPIC-110 **by choice of scope, not by technical necessity** — see
S6. EPIC-110 could ship first and leave the key behind as debt.

## Goals

- A board declares settings in `board-manifest.json`: id, type, label, description, default.
- Persephone's Settings page shows a sub-page per declaring board, grouped so boards do not crowd
  the app's own settings.
- Values persist in the board's scoped storage and are readable by the board with change
  notification.
- The Excalidraw board's library path becomes one of these, adopting the existing configured value.
- The Settings page becomes a two-pane page: a Content tree on the left, and a scrolling stack of
  per-group panels on the right, linked in both directions.

## Non-goals

- Arbitrary board-authored UI inside Persephone's Settings. Boards declare typed fields; Persephone
  renders them. A board wanting a bespoke control can build it in its own page.
- Per-page or per-file settings. These are per board, like the board's storage.
- Replacing `persephone.storage`. Settings are the subset a user is meant to see; storage stays the
  place for everything else.

## The Settings page redesign

*(User vision, 2026-09-23. Recorded as stated, with the code checked against it; the judgement
calls it raises are in "Open decisions" below, not resolved here.)*

### What the user asked for

> Currently the settings page is a single panel of 560px width centered on the page and usually
> there is lots of space on both sides of the panel. I want to split that long panel into smaller
> panels with some margin vertically between them. And to the left of the panel show a Content tree
> — a tree with two levels, the first level is a group like "General", "Editors", and the sub-nodes
> are a specific group of settings like "MCP", "Browser". Under "Editors" I actually want to see an
> "Excalidraw" sub-node and other boards' settings, and also built-in editor settings if any. When
> the user clicks an item in the Content, the related panel should scroll into view (the Content
> should not scroll), and when the user scrolls the panels, the Content item related to the top
> visible panel should be auto-selected.

Five requirements, restated as acceptance-shaped statements:

1. **One panel per settings group**, not one panel for the page. Vertical margin between panels
   replaces the current `DividerView` separators.
2. **A Content tree to the left of the panel stack**, two levels deep: group → settings group.
3. **Boards appear as sub-nodes under "Editors"**, alongside any built-in editor settings —
   "Excalidraw" is a peer of the app's own editor entries, not a separate second-class list.
4. **Clicking a Content node scrolls its panel into view.** The Content pane itself never scrolls
   with the panels — it is fixed, and only the panel stack scrolls.
5. **Scrolling the panels re-selects the Content node** owning the topmost visible panel.

### What is there today

- `SettingsView.onMount()` (`editors/settings/SettingsView.ts:52-112`) builds one
  `createPanelElement` at `maxWidth: 560`, appends an `<h1>`, then fifteen sections each followed by
  `appendDivider()`. Flat, ordered by nothing in particular, and the only structure is the divider.
- Each section is already an independent `VanillaView` mounted through `appendSection()`, wrapped in
  a `div.settings-section-wrapper` carrying `data-name="settings-section-<id>"`. **This is the
  redesign's biggest piece of luck**: the sections are already separable units with stable
  addressable names, so the work is regrouping and re-hosting them, not rewriting fifteen views.
- `uikit/Tree` already does everything the Content pane needs: two-level `items`, controlled
  selection through `value`/`isSelected` with `onChange` (`uikit/Tree/types.ts:83-138`). No new
  primitive is required.
- There is **no scroll-spy anywhere in the codebase** — no `IntersectionObserver` outside
  `editors/video/AudioVisualizer.ts`. Requirement 5 is genuinely new behaviour, and it is the one
  part of this redesign that is not assembly of existing pieces.

### The fifteen sections, and where they would go

A proposed mapping, to be confirmed when the tasks are written. It is listed here because the
grouping *is* the design — the panels and the tree are both derived from it.

| Group | Settings groups |
|---|---|
| General | Theme, Window Behavior, Clipboard, Terminal, File Search |
| Editors | Editor Behavior, Script Library, Video Player, **Excalidraw** (was Drawing Library), and any other board declaring settings |
| Browser | Browser Profiles, Default Browser, Links |
| Integrations | MCP, Git Integration, Board Vars |

`DrawingLibrarySectionView` is the migration case and the proof of the type system at once. It and
`ScriptLibrarySectionView` are both thin subclasses of one `LibraryPathSectionView`
(`SettingsSections.ts:343-396`) parameterised by a `pathKey`, a title, a description and a browse
handler — which is, field for field, what a board-declared `folder` setting would have to carry.
That the app already needed this shape twice is the strongest available evidence that `folder` is
the right first type, and that the board-declared renderer should be the same view rather than a
parallel one.

### The scroll-spy, and the trap in it

Requirements 4 and 5 are two directions of one link, and naively implemented they fight each other:
a click drives `scrollIntoView`, the resulting scroll events drive the spy, and the spy re-selects
whatever the animation is passing over — so the selection flickers through intermediate groups and
can land somewhere other than the clicked node. Any implementation needs the programmatic scroll to
suppress the spy until it settles. This is the known failure mode; recording it here so the task
document treats it as a requirement rather than discovering it in testing.

"Topmost visible panel" is also not what `IntersectionObserver` reports directly — it reports
intersection *changes*, so the spy has to keep the intersecting set and pick the first in document
order. A scroll handler reading `getBoundingClientRect()` is the simpler alternative and the stack
is fifteen panels, not a virtualised list. The choice is an implementation detail; the *result* is
specified above.

## Open decisions

These need resolving during epic planning, before any task document is written.

**Trust gate.** **Decided — see S10.** There is no gate: an untrusted board never gets a frame
(`BoardEditorView.ts:193-195`), so reaching the bridge is itself the proof of permission. Disabling
a bundled board is a registration preference rather than a trust revocation, so what remains is a
display-list rule — a disabled bundled board contributes no panel because Disable removes every
surface, not because it is untrusted.

**Where the values live.** ~~Board storage, reusing its bundled keying.~~ **Decided — see S2, S3 and
S4.** Values live in one renderer-owned `board-settings.json` namespaced by board; board storage is
main-process-only and unreachable from the Settings page (Concern 2), and board vars are a different
mechanism with a different threat model. Board identity reuses `resolveBoardNamespace()`, which
already carries EPIC-109 D5's bundled keying.

**Migration of `drawing.library-path`.** **Decided — see S6.** The key is removed from Persephone
entirely, and the board's new `library-path` setting takes the old app value as its initial value.
The board's existing `<userData>/data/excalidraw-lib` fallback stays the default, so a user who
never set a path is unaffected.

**What a type system needs to cover.** **Decided — see S5.** A `type` plus an optional `format`
behaviour subtype, starting with `string`/`boolean`/`number`/`enum` and the single format
`folderPath`, with unknown formats degrading to the base control rather than failing to render.

**Does a group node scroll, or only expand?** **Decided — see S12** (expand and scroll to the first
child). Original framing: the user specified two levels and said clicking "an item" scrolls its
panel. Level-1 groups ("General", "Editors") have no panel of their own.
Recommended: a group click scrolls to its first child's panel and expands, so every node in the
tree does something and the user never clicks a dead row. Confirm — the alternative (groups are
expand-only, level-2 rows navigate) is also defensible and is what a file tree would do.

**Where do non-editor boards go?** **Decided — see S13** (`getBoardEditorAssociation()` decides;
an empty "Boards" group is omitted). Original framing: the user placed boards under "Editors", which is right for
Excalidraw and for any board that claims file masks. But the trust list holds boards that are not
editors at all — Dev Dashboard, todo, Local Env. Putting those under "Editors" would be a lie, and
a fifth "Boards" group re-creates exactly the segregation the user's structure avoids.
Recommended: classify by what the manifest declares — a board with `fileMasks` or an
`editorPriority` lands under Editors, anything else under a "Boards" group that appears only when
such a board exists.

**The tree is in-page, not a sidebar panel.** The user asked for it "at the left from the panel",
inside the Settings page. Persephone also has a secondary-views sidebar
([secondary-views.md](../architecture/secondary-views.md)) that could host a contents panel
instead. Going with the in-page tree as asked; recorded so the alternative is a decision rather
than an oversight.

**Addressability.** Every panel and every tree row needs a `data-name` per
[ui-element-contract.md](../architecture/ui-element-contract.md), and the existing
`settings-section-<id>` names on the section wrappers should be preserved rather than renamed —
they are already what an agent addresses today.

**Sequencing.** The redesign and the board-settings mechanism are separable: the redesign is
useful on its own and touches no board code, while board settings need the redesign to have
somewhere to render. Recommended task order is redesign first, board settings second, the
Excalidraw library migration last — which also means the epic has a shippable halfway point if it
has to be interrupted.

**Relationship to EPIC-106 D1.** `permissions` as disclosure rather than a security boundary has now
been parked four times (most recently EPIC-109 D8). Settings are a UI surface, not a capability, so
this epic probably does not force that question — but check rather than assume, because a settings
page is the first thing a board contributes *into Persephone's own chrome*.

## Design decisions (user, 2026-09-23)

**S1 — Persephone owns every settings value. A board declares and reads; it does not own and does
not write.**

The decisive argument is mechanical, not philosophical: the Settings page is renderer code that
renders **before any board frame exists**, and must work when the board is disabled, not installed
in this window, or has never been opened. A board-owned value has nobody to ask in all three
cases. Board storage makes that concrete — it is main-process-only and bound to `entry.root`
(`main/board-bridge.ts:267-274`), so the Settings page cannot reach it at all.

It is also the split every other acted-on manifest field already uses: the board declares
`fileMasks`, `editorPriority`, `capabilities`; Persephone acts on them. Settings is that same
shape, with a UI attached.

The board reads and is notified of changes. It does **not** write: a setting is the user's to
change, and a board wanting to mutate its own state already has `persephone.storage`. If a board
ever genuinely needs to write one back, that is a later decision with a concrete case behind it.

**S2 — Settings are not board vars, and do not share their file.**

*(User decision, correcting an earlier draft of this epic that proposed reusing the board-vars
store.)* Board vars are environment variables and secrets: encrypted, in a user-chosen file, behind
an unlock prompt (`api/board-vars/BoardEnvStore.ts`). Settings are plain user-facing configuration.
Different lifetimes, different threat model, different audience — so they get their own file and
their own UI, and **the Settings page renders declared settings only, never vars**.

The existing "Board Environment Variables" row on the Settings page is not an exception to that
rule: it configures *where the vars file lives* (`SettingsSections.ts:276-288`, the `board-vars.file`
setting), and edits no variable. It stays as it is.

**S3 — One `board-settings.json`, namespaced by board, owned by the renderer.**

Values live in a single file under the app's data folder, shaped
`{ "<namespace>": { "<settingId>": <value> } }` — not in `settings.json` (board values are not app
settings), and not per-board inside `board-storage/<key>/` (that folder is main-process-owned, and
the Settings page would need a new IPC channel to reach it).

One namespaced file is what `BoardEnvStore` already does for vars, minus the encryption, so the
load/watch/reset pattern is a known quantity rather than a new one.

**Sharing code with board vars is welcome; sharing the store is not.** *(User decision,
2026-09-23.)* S2 separates the two **stores**, not the two implementations. `BoardEnvStore` already
solves, for a namespaced per-board file, the problems settings will hit in the same order: lazy
load, a settings-driven file path, reset-on-path-change (`BoardEnvStore.ts:44,68`), namespace
lookup, and a renderer-side bridge that binds the namespace from the calling board's root so a
board can never address another's (`board-vars-bridge.ts`). Factoring a common base out of it — or
building settings on the same shape and extracting later — is the preferred route, and is cheaper
than two parallel implementations that drift.

What must not be shared is the file and the UI: settings are plaintext, unlocked, user-facing and
rendered on the Settings page; vars are encrypted, unlock-gated, and rendered nowhere. A single
store holding both would force the weaker requirement onto the stronger one — settings would
inherit the unlock prompt, or vars would lose it.

**S4 — Board identity reuses `resolveBoardNamespace()`. There is not a second scheme.**

`api/board-vars/namespace.ts:20-33` already derives a stable board identity: `<author>/<name>` from
the manifest, falling back to `bundled:<id>` for a bundled board, falling back to the root path.
`findNamespaceCollision()` beside it already handles two boards resolving to the same namespace.
That is precisely the identity board settings need, including EPIC-109 D5's requirement that a
bundled board survive a reinstall to a different path.

Settings must use it rather than inventing a parallel id. Since it would then serve two subsystems,
it should move out of `api/board-vars/` to a shared location — a mechanical extraction, but one the
task document has to name, because leaving settings importing from `board-vars/` would contradict
S2 in the code while honouring it in the file layout. This is the first and most obvious piece of
the common ground S3 invites; it is not the only one.

**S5 — A setting has a `type` and an optional `format` behaviour subtype.**

*(User decision.)* The library path is a `string`, but Persephone must render it as a folder picker
rather than a text box. So the declaration carries both:

```json
"settings": [
    {
        "id": "library-path",
        "type": "string",
        "format": "folderPath",
        "label": "Library folder",
        "description": "Folder for Excalidraw library items (reusable shapes)",
        "default": ""
    }
]
```

`type` is the storage and validation contract; `format` selects the control. The split is JSON
Schema's, which is worth following rather than re-deriving.

First pass: types `string`, `boolean`, `number`, and `enum` (with `options`); the one format is
`folderPath`. `filePath` is the obvious second and should wait for a board that needs it.

**An unknown `format` degrades to the base type's default control — it never refuses to render.**
Boards are versioned independently of Persephone, so an older Persephone will meet a newer board's
manifest, and the failure mode for that must be a plain text box, not a missing settings page.

`LibraryPathSectionView` (`SettingsSections.ts:343-396`) is already `string` + `folderPath`
parameterised by a key, serving two sections. It is the renderer for that format, not a model for
one.

**S6 — `drawing.library-path` is removed from Persephone, not relabelled.**

*(User decision, 2026-09-23: Persephone should know nothing about an Excalidraw library path —
Excalidraw is a board like any other, shipped in the installer, and the library path is that
board's setting.)*

This supersedes the pre-investigation's recommendation to keep it as an app setting under an
"Excalidraw" label. That recommendation answered the question the epic *asked* (does EPIC-110
orphan the key? — it does not, see Concern 1) rather than the question that motivates the epic.

So: the key, its default and its description leave `api/settings.ts:42,116,153`;
`DrawingLibrarySectionView` leaves `SettingsSections.ts:392-396`; the catalog row leaves
`ai-vision/namespaces/settings.ts:162`; and `drawLibrary.ts` dies with `editors/draw` in EPIC-110.
The board declares `library-path` per S5 and reads it with `persephone.settings.get("library-path")`
in place of today's `persephone.call("settings.get", ["drawing.library-path"])`
(`assets/boards/excalidraw/index.html:153-156`).

Migration is a one-time read of the old app key as the new setting's initial value, so an existing
library is still found. The board's own `<userData>/data/excalidraw-lib` fallback
(`index.html:160-164`) stays as the default, which is what makes the migration safe: a user who
never set the path is already on the default and nothing moves.

**Effect on EPIC-110, stated precisely.** EPIC-110 can ship without this epic — leaving the key
behind is debt, not breakage, and Concern 1 disproves the orphaning argument this epic was
originally founded on. But removing Excalidraw-specific code from Persephone is what EPIC-110 is
*for*, and `drawing.library-path` is Excalidraw-specific code in Persephone. Treating EPIC-111 as
a prerequisite is therefore a choice about scope rather than a technical necessity, and it is the
recorded one.

**S7 — A board without `author` + `name` gets no settings, and is told so when it asks.**

*(User decision, 2026-09-23, resolving the namespace-portability concern below.)* `author` and
`name` are what make a board's identity survive moving or reinstalling — without both,
`resolveBoardNamespace()` falls back to the raw root path (`api/board-vars/namespace.ts:20-33`) and
the values are stranded the first time the folder changes. Since
`assets/board-template/board-manifest.json:4` ships `author: ""` with no `name`, that is the
default state of every template-derived board, so this has to be an enforced requirement rather
than advice in a guide.

Two halves, deliberately different:

- **Declaration is ignored, quietly, with a registration issue.** A `settings` block on a manifest
  lacking either field is dropped by `normalizeBoardSettings`, which pushes a
  `CustomEditorRegistrationIssue` (`custom-editor-registry.ts:148,184-191`) — the channel every
  other malformed manifest field already reports through. No Settings panel and no tree node
  appear for that board. This follows the existing "never throw, drop what it cannot understand"
  contract, and it is where a board author finds out.
- **Reading throws — to the board, never to Persephone.** `persephone.settings.get(id)` from such a
  board **rejects** with a clear message naming the missing field, rather than returning `undefined`
  and letting the board conclude the user has not configured anything. Silence would be the worse
  failure: a board would fall back to its default forever and nobody would learn why.

The transport for that already exists and needs no new mechanism: the bridge replies carry an
`error` field and the shim rejects the pending promise on it (`board-shim.ts:1085`, the `var:result`
handler). A rejected board promise is an ordinary error inside the board frame — it cannot reach
Persephone's renderer, which is exactly the isolation this decision asks for.

`normalizeBoardSettings` must therefore validate identity **before** it validates the settings
array, so a board missing `author` gets that message rather than a list of per-field complaints
about settings that were never going to be honoured.

**S8 — The epic fixes the scaffolding so S7 is satisfiable by default.**

*(User decision, 2026-09-23.)* S7 requires `author` + `name`. A survey of real manifests shows the
requirement is already met in the wild — sampled user boards carry both — so S7 is not a broad
migration. The gap is entirely in Persephone's own scaffolding, and this epic closes it:

| What | State today | Change |
|---|---|---|
| `assets/demo-board/board-manifest.json` | `author` set, **no `name`** | add `name` |
| `assets/board-template/board-manifest.json:4` | `author: ""`, **no `name`** | carry both, with `name` filled at scaffold time |
| `createBoardFromTemplate()` (`board-scaffold.ts:49`) | copies the template manifest verbatim | write `name` into the copied manifest |
| `defaultBoardManifest()` (`board-manifest.ts:220-222`) | returns `{ schemaVersion }` only | same treatment for the no-manifest path |

`name` is free in the scaffold path: `createBoardFromTemplate(name, dir, template)` already receives
the board name as its first parameter and uses it for the folder, but `ensureBoardManifest()` only
writes a manifest when the folder has none (`board-manifest.ts:682-685`) — and the template ships
one, so the copy is taken verbatim and the chosen name never reaches it. Writing it through is a
small change at a seam that already has the value.

`author` is the open half. Prompting during board creation adds friction to a flow that is usually
driven by an agent, so the suggestion is an app setting for a default author, consulted by the
scaffold and left empty if unset. A board scaffolded without one still works — it simply gets no
settings until its author fills the field, which S7 makes a visible, recoverable state rather than
silent breakage. Decide this when the task is written.

**The migration hazard this creates, and it applies beyond settings.** `resolveBoardNamespace()`
serves **board vars** today. Adding `author` or `name` to a board that previously lacked either
moves its namespace from the root-path fallback to `<author>/<name>`, which strands any variables
already stored under the old key. That is the real cost of this change, it lands on vars rather than
on settings, and it is why the demo board and the template are worth fixing **now**, before boards
accumulate values under fallback namespaces.

**Resolved — no migration is written.** *(User decision, 2026-09-23.)* An existing board should not
change its identity: keeping it as it is, including with no `name`, is a supported state. Such a
board simply gets no settings, which S7 already makes explicit rather than silent. If someone does
add or change `author`/`name` on a board that already holds variables, rewriting those variables
under the new namespace is the user's or their agent's job, not Persephone's.

This is what makes S7 and S8 backward compatible: nothing that works today stops working, and no
value is silently moved or dropped by an upgrade. The cost is pushed onto a deliberate act by
whoever performs it, and it only has to be documented — the board guides must state that changing
`author` or `name` after a board has stored variables orphans them.

A second, quieter hazard for the guides: the namespace is built from free text, so two boards from
the same person can land in different namespaces if the author field is spelled differently between
them. `findNamespaceCollision()` catches collisions, not near-misses.

**S10 — There is no trust gate on settings. The question dissolves rather than being answered.**

*(User decision, 2026-09-23: "if a board reads settings then it is already trusted, otherwise it
should not have been loaded and run".)* This closes the epic's longest-standing open decision, and
the source agrees on both halves.

**The read path needs no gate because an untrusted board never runs.** `BoardEditorView.syncBranch`
computes a branch key of `"untrusted"` whenever `isBoardPermitted()` is false
(`BoardEditorView.ts:193-195`), and that branch mounts no `BoardWebview` — so there is no iframe, no
`MessageChannel` port, and nothing to call `persephone.settings.get()` with. Reaching the bridge at
all *is* the proof of permission. This is the same argument EPIC-109's clipboard RPC settled on, and
it is why `board:var` carries no `isBoardPermitted` check in its dispatch arm either
(`BoardWebview.ts:542-552`) — not an oversight to be corrected here, but the existing and correct
reading.

**Disabled is not untrusted, so the second half of the question was malformed.** The revised
concerns framed the choice between the bridge's "trusted or bundled" rule and the registry's
three-part rule as a decision. It is not one. A bundled board is permitted by provenance — it
shipped inside the installer (EPIC-109 D2) — and disabling it is a **registration preference about
editor surfaces**, not a revocation of trust. A disabled bundled board reading its own settings
would be harmless even if it could, so no code needs to distinguish the two on the read path.

**What remains is a display-list question, not a security one.** The Settings page has to choose
which boards contribute panels, and that is ordinary UI: permitted boards that declare settings and
satisfy S7. A *disabled* bundled board contributes no panel and no tree node — not for safety, but
because EPIC-109's Disable action means every surface of that board goes away, and a Settings panel
is a surface. That keeps disable consistent with the creatable item, the file masks and the
capability handlers it already removes.

**S11 — Orphaned values are kept, deliberately. Reinstalling a board restores its settings.**

*(User decision, 2026-09-23.)* When a board is untrusted, deleted, or disabled, its object stays in
`board-settings.json`. Nothing prunes it and nothing surfaces it. If the user installs that board
again it finds its values waiting and the user reconfigures nothing — the retention is the feature,
not the leak.

So the epic writes **no** prune step, and needs no admin surface to remove entries. That closes the
three-way choice the concern below left open by taking the third option and giving it a reason.

**S7 is what makes this promise actually hold**, and the two decisions are worth reading together.
"Reinstall and your settings come back" is only true if the namespace is the same after the
reinstall — which is exactly what `<author>/<name>` guarantees and what the root-path fallback does
not. Since S7 refuses settings to any board lacking `author` + `name`, every board that *has*
settings necessarily has a portable namespace, so the restore is reliable rather than
circumstantial. Had S7 gone the other way, S11 would have been a promise that quietly failed for
the majority of boards.

The retained data is small, plain JSON, and per board. Unbounded growth is not a practical concern
at this scale, and if it ever becomes one, pruning is a later, additive change that breaks nothing
recorded here.

**S12 — A group node expands and scrolls to its first child.**

*(Decided by Claude under the user's autonomous-work authorisation, 2026-09-23. Overturnable — the
alternative is stated.)* Level-1 groups ("General", "Editors") own no panel, so a click has nothing
of its own to scroll to. Every row in the Content tree should do something: clicking a group expands
it and scrolls to the first panel it contains, which is also the top of that group's region, so the
result reads as "go to General" rather than as a no-op.

The alternative — groups are expand-only, level-2 rows navigate — is what a file tree does, and is
defensible. It is rejected because this tree is a table of contents, not a file system: its rows
name places in a document, and a place a user can click but not go to is a dead row.

**S13 — A board is filed under "Editors" when it declares an editor association, and under "Boards"
otherwise. The "Boards" group appears only when it has members.**

*(Decided by Claude under the user's autonomous-work authorisation, 2026-09-23.)* The user placed
boards under "Editors", which is right for Excalidraw and any board claiming files, but the trust
list also holds boards that are not editors at all — dashboards, task boards, viewers of their own
data. Filing those under "Editors" would be untrue.

The predicate already exists and needs no new manifest field:
`getBoardEditorAssociation(manifest)` (`board-manifest.ts:566-582`) returns `null` precisely when a
board declares no `fileMasks`, `contentMasks` or `folderEditorMasks` — that is, when it is not an
editor. Non-null goes under **Editors**, null goes under **Boards**.

The "Boards" group is **omitted entirely when empty**, so a user with no such boards sees exactly
the structure the user described, and one with them sees an honest extra group rather than
mislabelled rows.

**S14 — The scaffold takes its default author from an app setting, and a board with no author still
scaffolds.**

*(Decided by Claude under the user's autonomous-work authorisation, 2026-09-23.)* S8 left this open.
Prompting for an author during board creation adds friction to a flow that is usually driven by an
agent rather than by a person at a dialog, so instead: a `boards.default-author` app setting, read
by `createBoardFromTemplate()` and written into the new manifest alongside the board name it already
receives.

When the setting is unset the field is written empty and **the board is still created**. It simply
gets no settings until someone fills it in — which S7 makes a visible, recoverable state with a
registration issue and a clear error on read, not silent breakage. Board creation must never fail
over a field that only matters to a feature the board may not use.

## Concerns (revised 2026-09-23, post-S1–S6)

Rewritten after S1–S6 replaced the board-storage assumption the first pass was written under.
Everything below is verified against source. The first three complicate a decision; the next three
record what S1–S6 dissolved, so a later reader does not re-derive them.

### S4 is unsafe as written: only one shipping manifest resolves to a portable namespace

`resolveBoardNamespace()` returns `<author>/<name>` only when **both** manifest fields are trimmed
and non-empty, then `bundled:<folder-id>` for a board under `assets/boards`, and otherwise the raw
board root path (`namespace.ts:20-33`). Of the three manifests that ship,
`assets/boards/excalidraw/board-manifest.json:2-3` is the only one with both.
`assets/demo-board/board-manifest.json` has `author: "Persephone"` and **no `name` key at all**, and
`assets/board-template/board-manifest.json:4` ships `author: ""` — and neither lives under
`assets/boards`, so neither gets the bundled fallback either. Both resolve to their root path.
Every board authored from the template inherits that, so the non-portable namespace is the default
state of a new board, not an edge case.

For vars that is a cost paid by a user who hand-edits `.env.json`. For settings it means a board
that moves folder, or is reinstalled elsewhere, silently shows an empty panel and reads defaults
again — with no editor (S2) in which the user could see that the old values are still sitting in
`board-settings.json` under a dead path key.

Exit criterion 2 already scopes its path-change promise to bundled boards, so it is not literally
broken — the bundled Excalidraw board carries both fields *and* would take the `bundled:<id>` branch
regardless. The gap is the one the criterion does not cover: an ordinary installed board that moves.
That case is currently undefined rather than contradicted, which is worse, because nothing in the
epic tells an implementer it needs an answer.

**Resolved by S7** *(user, 2026-09-23)*: a `settings` block is honoured only when the manifest
carries `author` and `name`; otherwise it is dropped with a registration issue, and a read from such
a board rejects with an error inside the board frame. The path-fallback alternative was rejected —
it trades a one-time authoring error for silent data loss the user discovers only after moving a
folder.

What remains for the task document is the **template**: `assets/board-template/board-manifest.json`
ships `author: ""` and no `name`, so under S7 every board scaffolded from it would be refused
settings on day one. The template needs both fields populated or clearly marked as required, and
`board-scaffold.ts` needs to be checked for whether it fills them in.

Collision handling is also weaker than S4 implies. `findNamespaceCollision()` scans only
`boardTrust.listPaths()` (`namespace.ts:51`), and bundled boards are permitted by provenance and
never appear in that list (`board-access.ts:7-9`) — so a user board declaring `Persephone` /
`Excalidraw` collides with the bundled one and is never flagged. And the check is advisory:
`confirmNamespaceNotColliding()` returns the dialog's boolean and the caller proceeds on yes
(`namespace.ts:66-72`, `NamespaceCollisionDialog.ts:16-24`, called from `api/boards.ts:319-320`,
`BoardEditorView.ts:283-284`, `BoardInfoEditorModel.ts:656-657`). Two boards sharing a namespace is
therefore a supported outcome, and for settings it means two boards' declared ids sharing one
object — an id clash between them writes one value read by both. The epic must say what that is:
last declaration wins, two panels over one value set, or settings refused for a colliding board.

### S3's shared base is thinner than it reads, and the seam falls below the store

`BoardEnvStore` is entangled with configurability and encryption in exactly three places, all
removable: the constructor's `settings.onChanged` listener for `board-vars.file`
(`BoardEnvStore.ts:43-45`), `ensureLoaded()`'s path-from-setting plus the two `not-configured`
returns for an empty path and a missing file (`:68-70`), and the
`isEncrypted`/`ui.password`/`decrypt` block (`:88-100`). Settings keep none of them: the path is
fixed, the file is plaintext, there is no locked state — which collapses `BoardVarsLoadResult`'s
four statuses (`types.ts:23`) to `ok` / `error`.

What is genuinely common is smaller than that subtraction suggests: build a `TextFileModel` with
`skipSave = true` over a path and `restore()` it, re-parse `model.state.get().content` on each load,
deep-clone-set-then-`saveFile()` (`:135-147`), and `reset()` (`:55-60`). The **shape** does not
transfer. `BoardVarsFile` is namespace → profile → key → `string` (`types.ts:11-17`) and `get()`
discards any non-string (`:115-118`); settings are namespace → key → `string | number | boolean |
enum` with no profile level. A shared base must be generic in the value type *and* one level
shallower than the vars file, which is a real refactor of `BoardEnvStore` rather than a
subclassing. That is still the right route per S3, but budget it as "rewrite `BoardEnvStore` onto a
generic base", not "extract a base class".

Two operations the template does not have at all. There is **no delete/unset anywhere** in
`BoardEnvStore` — a "reset to default" control on a settings panel, and any uninstall cleanup, have
no store method to call. And `ensureLoaded()` treats a non-existent file as `not-configured`
(`:70`), while settings need "missing file = empty store, created on first write". Whether
`TextFileModel.restore()` tolerates a missing path and whether `saveFile()` creates it is
**unverified** — check before the store task is written, because it decides whether first run needs
an explicit create step.

### The store has no change event, and that — not the bridge — is the push problem

The transport half of the old "no push channel" concern is dissolved (below). What survives, and
what the epic does not mention, is that `BoardEnvStore` has no subscription of any kind: nothing in
it emits when a value changes, and its only reactive input is the settings listener settings will
lose. Exit criterion 3 therefore needs a fan-out built from scratch — the Settings panel writes, the
store emits, every mounted frame of that board receives it. That is plural: `BoardWebview` is
instantiated per frame, main plus each secondary view (`BoardWebview.ts:147-148`), so the push must
reach every frame whose `boardRoot` resolves to the changed namespace, not just the main one. The
file's own pipe watch will also fire on an external edit of `board-settings.json`, and that has to
land in the same fan-out rather than a second path.

A `BOARD_BRIDGE_VERSION` bump past 1.12.0 (`shared/board-bridge-version.ts:2`,
`board-shim.ts:1255-1265`) and a `minBridgeVersion` story for `persephone.settings` still apply, and
so does the board-side unsubscribe shape — `onChange` returning a disposer, as
`persephone.state.onChange` already does (`board-shim.ts:1691-1698`).

### Dissolved: "the bridge has no push channel, so a board cannot be notified"

Dissolved by S1 and S3 moving the store into the renderer. The old concern measured the **main**
port (`MainToBoard`, `ipc/board-bridge-channels.ts:225-229`), which `persephone.var.*` never
touches. The shim posts `board:var` to `window.parent` and the renderer answers with a `var:result`
`postMessage` straight to `frame.contentWindow` (`BoardWebview.ts:981-1003`,
`board-shim.ts:1076-1086`). That host-frame channel already carries three unsolicited
renderer→board pushes — `state:sync` (`BoardWebview.ts:406-412`), `toolbar:control` (`:556-570`) and
`navigation:return` (`board-shim.ts:1114-1131`) — so `settings:changed` is one more message kind on
a channel built for exactly this, not a new bridge verb. Settings can reuse the `var.*` transport
verbatim, including its namespace binding: the namespace is resolved renderer-side from
`this.props.boardRoot` and never read from the message (`BoardWebview.ts:994`), so a board cannot
address another board's namespace.

### Dissolved: "board storage is unreachable from the renderer"

Dissolved by S3. The finding stands — `main/board-storage.ts` is exposed only through the bridge
RPCs that take their root from `entry.root` (`main/board-bridge.ts:267-274`) and through
`main/module-service-storage.ts`, with no renderer IPC channel anywhere — but since values never go
there, the renderer channel and the `contextForRoot` path-gating problem both evaporate. It is now
an argument *for* S3 rather than a defect, and S1 already cites it as one.

### Dissolved: "namespaced app settings are the cheaper alternative"

Dissolved by S1/S3 — the user chose a separate file. One fact from it stays load-bearing for S6:
`Settings.get/set` carry a `(key: string)` overload over a plain record (`api/settings.ts:221-235`),
`loadSettings` merges the file over the defaults (`:283-286`) and `saveSettings` reserializes the
whole object (`:307`), so `drawing.library-path` stays readable from `appSettings.json` after the
key leaves `AppSettingsKey`. That is what makes S6's one-time migration read work without keeping
the key in the union.

### Dissolved: "nothing is orphaned, so keep `drawing.library-path` an app setting"

Superseded by S6, which answers the question that motivates the epic rather than the one the epic
asked. The factual half is unchanged and is the migration's starting point: the board reads the key
through `persephone.call` (`assets/boards/excalidraw/index.html:153-164`) and falls back to the same
`<userData>/data/excalidraw-lib` path `drawLibrary.ts:13-19` writes, so board and built-in editor
already share one library.

### The trust gate is answerable from source, and the answer is not the rule assumed

Settling the open decision **Trust gate**. The closest precedent is `board:var`, and it is **not**
gated in its dispatch arm. `handleMessage`'s blanket checks are only `live`, origin `board://<host>`
and `event.source === frame.contentWindow` (`BoardWebview.ts:417-425`); the `board:var` arm
(`:542-552`) calls `resolveVariable`, which — unlike `resolveOpenContent` (`:973-975`) and every
toolbar arm (`:477`, `:486`, `:498`, `:565`) — never calls `isBoardPermitted`. Vars rely entirely on
an untrusted board not being mounted. Settings should be explicit rather than inheriting that,
because the read path also runs from the Settings page with no frame involved.

Second, and sharper: `isBoardPermitted` is "trusted **or** bundled" (`board-access.ts:7-14`), and
`bundledBoardRegistry` knows nothing about `disabled-bundled-boards` — that set is read only inside
`custom-editor-registry.refresh()` (`:251`, `:267`). The three-part rule the first pass recorded is
therefore the **registry's** rule, not the bridge's: a disabled bundled board still passes
`isBoardPermitted`. **Superseded by S10** — this was framed as a choice between two rules, and it is
not one: disabling a bundled board is a registration preference, not a trust revocation, so nothing
on the read path needs to tell them apart. What survives from this finding is the display rule: a
disabled bundled board contributes no panel and no tree node, because Disable removes every surface
of that board.

### Namespace resolution is a per-call disk read, and settings make it a hot path

`resolveBoardNamespace()` does an `fs` read and a `JSON.parse` of `board-manifest.json` on every
call (`namespace.ts:21`), plus `bundledBoardRegistry.ensureInitialized()` on the fallback path, and
`BoardWebview` awaits it per request (`:994`). For a handful of var calls that is invisible. A board
reading its settings at start-up, a manifest read behind every default resolution (below), and a
namespace resolution per change push together make it a hot path. The extraction S4 already requires
is the moment to add a board-root-keyed cache, invalidated where `bundledBoardRegistry` and
`boardTrust` already notify (`board-access.ts:18-25`).

### Defaults should be computed at read time, and the epic has not said so

`BoardEnvStore` has no notion of a default — `get()` returns `undefined` for an unset key
(`:115-118`). Settings should keep that and resolve the default from the manifest at read time
rather than materialising it into `board-settings.json` when the panel first renders. That is what
makes a board version bump behave: a board shipping a changed `default` takes effect immediately for
every user who never touched the setting, with nothing to migrate, and the file stays a record of
user *decisions* rather than a snapshot of a manifest. Three consequences to state: clearing a
setting is a **delete** from the file (the operation the store lacks, above); a board reads its
declared default, never `undefined`, for a setting the user has never touched; and
`persephone.settings.get()` is manifest-dependent, so a read issued before the manifest is readable
must still answer with the declared default rather than failing — an argument for resolving each
board's declaration set once at registry/panel build time and caching it beside the namespace.

### Values are orphaned on uninstall and nothing can see them

Untrusting a board, deleting its folder, or disabling a bundled one leaves its namespace object in
the file, and — per the first concern — that key may be a bare root path that identifies nothing.
Vars accept this deliberately, documented as "the documented cost of using display fields as
identity" (`namespace.ts:14-18`), because a user can open `.env.json` and delete the block. S2 gives
settings no editor at all, so the orphans are invisible *and* unremovable.

**Resolved by S11** — the third option, taken deliberately: values are retained so that reinstalling
a board restores its configuration. No prune step and no admin surface are written.

### What settings should deliberately not copy from `persephone.var.*`

Profiles. Vars are namespace → **profile** → key (`types.ts:13-17`) because a connection string
differs per environment; a setting does not, and adding the level speculatively buys a migration
later. `set` — S1 forbids a board writing, so the board surface is `get` / `onChange` with no
`varMethod: "set"` counterpart (`board-vars-bridge.ts:69-75`). `show()` (`:76-78`) opens the raw
JSON file in an editor; the settings analogue must open the Settings page at the board's panel,
which is what `settings.highlight` already does for app settings. The dialog-on-demand behaviour
(`:50-54`) — a var read can pop a creation dialog from inside a board's RPC — must not carry over:
a settings read must never block a board on UI. And `list()` is the wrong shape: vars list the keys
that happen to be stored (`BoardEnvStore.ts:121-123`), whereas a board's settings are the ids its own
manifest declares, so a stored-keys `list` would omit every untouched setting.

### No registry enumerates boards that are not editors

`CustomEditorRegistry.refresh()` assembles the right source list — trusted roots plus bundled boards
minus `disabled-bundled-boards` (`custom-editor-registry.ts:250-268`) — then discards every board
without an editor association (`if (!assoc) continue`, `:305`), so the reactive `entries` state
cannot answer "which boards declare settings". Rendering a per-board panel needs that source list
exposed, which is a small addition to a registry that already computes it.

This also settles the open decision **"Where do non-editor boards go?"** mechanically:
`getBoardEditorAssociation(manifest)` (`board-manifest.ts:566`) returns null exactly for a board
with no `fileMasks`, `folderEditorMasks` or `contentMasks` — so "under Editors if it has an
association, under Boards otherwise" needs no new predicate.

On the manifest side there is no validation to inherit. `readBoardManifest`
(`board-manifest.ts:233-245`) is a bare `JSON.parse` plus a cast returning null on any failure;
unknown fields pass through untouched, and every acted-on field is validated by its own `normalize*`
consumer. `normalizeBoardSettings` is therefore mandatory, to the same contract — and it is also
where S5's "unknown `format` degrades to the base control" is enforced, and where the
`author`+`name` requirement from the first concern would live.

### A manifest edit does not reach the renderer

`bundledBoardRegistry.refresh()` reads and caches each manifest once
(`bundled-board-registry.ts:41-66`), and the custom-editor registry is explicitly "an in-memory
subscription to trust and bundled-source changes (NOT a filesystem watcher — CE7)"
(`custom-editor-registry.ts:8-9`), re-running only on a trust, bundled-source or
`disabled-bundled-boards` change (`:213-224`). Adding a `settings` block to a manifest while
Persephone runs will not produce a panel. Exit criterion 1 should say "once the board is trusted or
installed" rather than implying live pickup, unless the epic accepts a manifest watcher — which CE7
deliberately declined.

### `SettingsView` is built once and has no reactive wiring

`onMount` (`SettingsView.ts:52-112`) instantiates a fixed list of sections and never rebuilds;
`SettingsEditor.ts` subscribes to nothing; and `PageContentView` only forwards
`renderEditor.update({ model })` when the identity is unchanged (`PageContentView.ts:160-163`). The
primitive exists one level down — `BrowserProfilesSection.ts:457` subscribes to `settings.onChanged`
and re-renders itself — so a board-panel list that rebuilds on registry change is ordinary work, but
it is work the epic currently treats as implicit.

### The scroll container belongs to the page host, not to Settings

This is the redesign's real structural risk. The element with `overflow-y: auto` is
`.page-editor-container` (`ui/app/Pages.css:2`), created by `PageContentView.ts:176-178` as
`[data-name="page-editor"]` and shared by every editor. Because `SettingsEditor` sets
`showBackgroundOrnament = true` (`SettingsEditor.ts:27`), that container is nested inside
`.ornament-page-area`, which is `overflow: hidden` (`Pages.css:6`). Settings owns no scroll region
today.

Requirement 4 — the Content pane never scrolls — cannot be met while the host scrolls the whole
page: the tree would scroll away with the panels, and `scrollIntoView` from a tree click would
resolve against the host container. `SettingsView` must become height-constrained (so
`.page-editor-container` has nothing to scroll) and own an inner scroll element that is both the
`scrollIntoView` boundary and the spy's event source. Settle this before the spy is written.

### Spy targets are the wrappers; the section roots have no box

`[data-type="settings-section"]` is `display: contents` (`settings.css:117-119`), so a section root
generates no box — only `.settings-section-wrapper` (`display: block`, `:121-124`) does.
Measurement, `scrollIntoView` and any `IntersectionObserver` must target the wrapper, which is also
where the `settings-section-<id>` names already live.

Nothing under `sections/` sets `hidden` today, and the `[data-type="settings-section"][hidden]` rule
(`settings.css:126-128`) has no producer. A board panel that vanishes when its board is disabled
would be the first, so "a hidden panel is neither a tree node nor a spy target" must be stated as a
requirement rather than observed from existing behavior.

### An agent-facing catalog duplicates the page structure and will go stale

`SETTINGS_CATALOG` (`scripting/ai-vision/namespaces/settings.ts:23` onward) is a second hand-written
model of this page: per section an id, title, description, `data-name` and a `where` string, plus 27
rows keyed by setting key. It backs `settings.sections`, the `settings.elements` declarations and
`settings.highlight(key)` (`:263-270`), and the namespace's `help` hardcodes "15 fixed-order
sections and 27 catalogued setting rows". The [ui-element-contract](../architecture/ui-element-contract.md)
table is a third copy. The regrouping changes every `where` string and the section-to-group
relation, and a board-declared setting has no catalog key at all — so `settings.highlight("<board
setting>")` lands in the unknown-key error path, which matters more now that S1 makes this page the
only place a board setting can be changed. Whatever the redesign produces, the grouping should be
one exported structure that both the page and this namespace read, with board panels contributed
into it at runtime.

One thing keeps working: `waitForSettingsSection` (`:235-261`) requires only an on-screen box
(`offsetParent` plus a non-zero rect, `:230-233`), which a panel below the fold still has. It breaks
only if a panel is unmounted or collapsed rather than merely scrolled away.

### EPIC-106 D1 does not need reopening

Answering the open decision **Relationship to EPIC-106 D1**. `permissions` is documented in the
manifest type as disclosure that is "forward-compatible", with unknown values kept visible
(`board-manifest.ts:88-92`), and no consumer gates on it — the trust flag is the only boolean that
decides whether a manifest field is acted upon. A `settings` declaration is another acted-on field
behind the same gate, so it forces nothing.

### Not determined

- ~~Whether `uikit/Tree` scrolls its own selected row into view when `value` changes~~ **Answered,
  2026-09-23, and the answer is favourable.** `TreeView.syncActiveScroll()`
  (`uikit/Tree/TreeView.ts:598`) scrolls the **active** row, not the selected one — the Tree keeps
  `value`/`isSelected` (selection) separate from the active row (`onActiveChange`). So the
  scroll-spy can drive selection on every scroll tick without the Content pane moving, which is
  exactly requirement 4's "the Content should not scroll". The implementation must therefore update
  selection only and never set the active row from the spy; a click, which legitimately sets both,
  is the one case where the tree may scroll itself
  programmatically — requirement 5 re-selects a node on every scroll, and a tree that chased its
  selection would move the pane the user was told is fixed. Check before the tree task is written.
- Whether `TextFileModel.restore()` tolerates a missing file and whether `saveFile()` creates one,
  which decides how first-run `board-settings.json` creation is written.
- Whether a bundled board listed in `disabled-bundled-boards` can still be opened as a board page at
  all, which decides whether the bridge-side gate needs its own disabled check.

## Linked Tasks

Sequenced so each task leaves the app in a shippable state. The redesign depends on none of the
board-settings decisions, and board settings depend on the redesign only for somewhere to render —
so an interruption after any task is a coherent stopping point rather than a half-migrated page.

| Task | Title | Status |
|------|-------|--------|
| [US-1497](../tasks/US-1497-settings-panels-tree/README.md) | Settings page: per-group panels and the Content tree | Implemented `ef052d24` |
| [US-1498](../tasks/US-1498-settings-scroll-linkage/README.md) | Scroll linkage: click-to-scroll and the scroll-spy | Implemented `63d3aaf5` |
| [US-1499](../tasks/US-1499-board-identity/README.md) | Board identity: shared namespace, `author` + `name` requirement, scaffolding | Implemented `f29d5838` |
| [US-1500](../tasks/US-1500-board-settings-store/README.md) | The board settings store and its board-facing API | Implemented `bdb8b970` |
| [US-1501](../tasks/US-1501-board-settings-rendering/README.md) | Manifest `settings` declaration and Settings-page rendering | Implemented `a393771b` |
| [US-1502](../tasks/US-1502-excalidraw-library-setting/README.md) | Excalidraw's library path becomes a board setting | Implemented `1391b4bc` |

**All six implemented 2026-09-23, none reviewed.** The epic's `/review`, `/document` and
`/userdoc` have not been run and the commits are local only. Per the epic-task rule the dashboard
entries stay `[ ]` until review.

### US-1497 — Settings page: per-group panels and the Content tree

The structural half of the redesign, with no scroll behaviour. Replace the single 560px column
(`SettingsView.ts:52-112`) with one panel per settings group separated by vertical margin rather
than `DividerView`, and add the fixed two-level Content tree beside them using `uikit/Tree`. Group
the fifteen existing sections per the table in "The Settings page redesign"; every existing section
must remain reachable and keep its `data-name="settings-section-<id>"` wrapper, which is what agents
already address.

Carries the scroll-container problem: Settings owns no scroll region today — the container is the
shared `.page-editor-container`, nested in an `overflow:hidden` area — so the view must become
height-constrained and own an inner scroller before US-1498 can work at all. Also updates the three
hand-written models of the page that the regrouping invalidates: `SETTINGS_CATALOG` and its help
string hardcoding "15 fixed-order sections and 27 catalogued setting rows"
(`ai-vision/namespaces/settings.ts`), and the ui-element-contract table.

### US-1498 — Scroll linkage: click-to-scroll and the scroll-spy

Clicking a Content node scrolls its panel into view (S12 for group nodes); scrolling the stack
selects the node owning the topmost visible panel. The programmatic scroll must suppress the spy
until it settles, or the selection flickers through intermediate groups and can land on the wrong
node.

Two constraints already established: spy and scroll targets are `.settings-section-wrapper`
elements, because section roots are `display:contents` (`settings.css:117-124`) and have no box; and
the spy must update **selection only**, never the active row, because `TreeView.syncActiveScroll()`
scrolls the *active* row — which is exactly what would make the Content pane scroll itself, against
the stated requirement.

### US-1499 — Board identity: shared namespace, `author` + `name` requirement, scaffolding

S4, S7 and S8, with no settings yet — this is the seam every later task stands on, and it touches
board vars, so it ships and is verified on its own. Move `resolveBoardNamespace()` out of
`api/board-vars/` to shared ground and update its callers. Add the `author` + `name` requirement as
a reusable identity check. Fix the scaffolding: `name` written through by
`createBoardFromTemplate()` (which already receives it), `author` from the `boards.default-author`
setting per S14, the same treatment for `defaultBoardManifest()`, and both fields added to
`assets/demo-board/board-manifest.json` and `assets/board-template/board-manifest.json`.

Must document, in the board guides, that changing `author` or `name` on a board that already holds
variables orphans them (S8) — no migration is written.

### US-1500 — The board settings store and its board-facing API

S1, S2, S3: a renderer-owned `board-settings.json` shaped `{ "<namespace>": { "<id>": value } }`,
modelled on `BoardEnvStore` but plaintext, unconfigured and always available. Per Concern 2 the
shape does not transfer directly — vars are namespace → profile → key → string and settings are one
level shallower with typed values — so expect a sibling built on the same pattern rather than a
literal extraction, and factor out only what genuinely matches.

Needs what vars lack: **a delete/unset**, for "reset to default" and nothing else; missing file
means an empty store created on first write, not `not-configured`; and defaults computed at read
time rather than materialised, so a board's new version can change a default.

Board-facing: `persephone.settings.get(id)` and an `onChange`, namespace bound renderer-side from
the calling frame's root, riding the host-frame postMessage channel that already carries unsolicited
pushes. **No `set`** — S1. A read from a board failing S7 rejects with an error naming the missing
field. No trust gate (S10). Deliberately not copied from vars: profiles, `show()`, dialog-on-demand,
and `list()` of stored keys.

Change notification must reach **every** frame of a board, not just its main one — a board's
secondary views are separate frames.

### US-1501 — Manifest `settings` declaration and Settings-page rendering

`normalizeBoardSettings` per S5, validating identity **before** the settings array so an
identity failure reports once rather than as a list of per-field complaints. Types `string`,
`boolean`, `number`, `enum` with `options`; the single format `folderPath`; an unknown `format`
degrades to the base control rather than refusing to render. `LibraryPathSectionView`
(`SettingsSections.ts:343-396`) is the renderer for `folderPath`, not a model for a new one.

Tree placement per S13. The Settings view must rebuild when board registration changes — it builds
once today with no reactive wiring — so installing, untrusting, disabling or re-enabling a board
adds or removes its panel and node live. Manifest edits do not reach the renderer (manifests are
cached, and the registry is deliberately not a watcher), so exit criterion 1 means "once
trusted/installed", and the guides must say so.

### US-1502 — Excalidraw's library path becomes a board setting

S6, last because it is the migration and wants everything else proven. The board declares
`library-path` as `string` + `folderPath` and reads it with `persephone.settings.get("library-path")`
in place of `persephone.call("settings.get", ["drawing.library-path"])`
(`assets/boards/excalidraw/index.html:153-156`). Remove the key, default and description from
`api/settings.ts:42,116,153`, `DrawingLibrarySectionView` from `SettingsSections.ts:392-396`, and
the catalog row from `ai-vision/namespaces/settings.ts:162`.

Migration is a one-time read of the old app key as the new setting's initial value. The board's
`<userData>/data/excalidraw-lib` fallback stays the default, so a user who never set a path is
untouched. `drawLibrary.ts` is left alone — it dies with `editors/draw` in EPIC-110.

Verify against a real library before and after, since this is the one task that can lose user data.

## Exit criteria

1. A board declaring settings in its manifest gets a Settings sub-page, with no code change in
   Persephone for that board.
2. Values persist across restart and across a reinstall to a different path (bundled boards).
3. The board reads values and is notified of changes without a reload.
4. An untrusted board contributes no settings page — which holds by construction (S10), so the case
   actually worth exercising is a **disabled bundled** board: its panel and tree node disappear, and
   reappear on re-enable, without a restart.
5. The Excalidraw board's library path is configured here, and a user who had a library before the
   change still has it afterwards.
6. Settings renders as a fixed Content tree beside a scrolling stack of per-group panels; no
   single-column 560px layout remains.
7. Clicking a Content node brings its panel into view, and scrolling the stack selects the node
   owning the topmost visible panel — without the two fighting each other during a programmatic
   scroll.
8. Every existing settings section is reachable from the tree, and none was lost in the regrouping.

## Notes

### 2026-09-20

- Epic created from a user observation while planning EPIC-109's US-1490. Recorded as a prerequisite
  of EPIC-110 under EPIC-109 D11 (parity before removal).

### 2026-09-23 — implementation

- All six tasks implemented and committed locally (unpushed) in one overnight session under the
  user's autonomous-work authorisation. Each was verified live against the running app rather than
  on a green build alone.
- **Three defects were found by that live verification, not by typecheck/lint/build**, which passed
  throughout. US-1498 decided section navigability partly from geometry, and since the view builds
  before first layout — and a non-active page measures 0x0 — every section was filtered out and the
  Content tree rendered **empty**. US-1499 shipped a namespace cache invalidated on trust and
  bundled-registry changes, neither of which is what the namespace depends on, so adding a missing
  `name` to enable settings would have appeared to do nothing until a restart. US-1501/US-1502 keyed
  the board panel's `data-name` on the absolute board root, repeating precisely the instability
  EPIC-109 D5 exists to prevent; it now keys on the portable `<author>/<name>`.
- One proposal was rejected on review: relaxing `settings.get<T = unknown>` to `<T = any>` so the
  doomed `drawLibrary.ts` would keep compiling. Explicit `<string>` call sites in that file achieve
  the same thing without weakening the default generic for every untyped settings read.
- **Not verified:** scaffolding a new board end to end (it writes board folders outside the repo),
  and a board with a declared *secondary view* receiving a settings-change push — the multi-frame
  fan-out is implemented per frame and reviewed, but no such fixture was exercised.

### 2026-09-23

- The user specified a **Settings page redesign** and folded it into this epic: per-group panels
  replacing the single 560px column, a two-level Content tree beside them, and two-way linkage
  between the tree and the scroll position. Recorded verbatim in "The Settings page redesign"
  above.
- Checked against source while recording. Three findings shaped how it is written down: the fifteen
  sections are **already** independent views with stable `data-name` wrappers, so this is a
  regrouping rather than a rewrite; `uikit/Tree` already supports controlled two-level selection,
  so no new primitive is needed; and there is **no scroll-spy anywhere in the codebase**, making
  requirement 5 the only genuinely new behaviour in the redesign.
- `LibraryPathSectionView` already serves two sections through one parameterised config, which is
  the same shape a board-declared `folder` setting needs. That is now the epic's argument for
  `folder` being the first setting type, replacing the earlier "at minimum a folder path" guess.
- The pre-investigation concerns were **re-evaluated against S1–S6** and rewritten as "Concerns
  (revised 2026-09-23, post-S1–S6)". Three were dissolved outright (board storage unreachable from
  the renderer; the bridge has no push channel; namespaced app settings as the cheaper route), each
  recorded with the decision that dissolved it. Investigating `api/board-vars/` as the new template
  surfaced three findings the epic did not account for: only `assets/boards/excalidraw` has both
  `author` and `name`, so S4's namespace falls back to a non-portable root path for the demo board
  and for every board made from the template; `BoardEnvStore` has no change event and no delete, so
  S3's shared base is a rewrite rather than an extraction; and the `var.*` host-frame channel
  already carries unsolicited renderer-to-board pushes, so change notification is a message kind,
  not a new bridge seam.
